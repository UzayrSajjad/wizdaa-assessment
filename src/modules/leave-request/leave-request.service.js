const {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
    Logger,
} = require('@nestjs/common');
const { v4: uuidv4 } = require('uuid');
const { LeaveRequest } = require('./leave-request.entity');
const { LeaveRequestStatus, HcmSyncStatus, LeaveType } = require('../../common/enums');
const { calculateBusinessDays, validateDateRange } = require('../../common/utils/date.utils');

/**
 * LeaveRequestService — orchestrates the full leave request lifecycle.
 *
 * Responsibilities:
 *   - Validate and create leave requests
 *   - Coordinate balance reservation/confirmation (per-employee per-location)
 *   - Approve/reject with proper state transitions
 *   - Handle cancellation with balance restoration
 *   - Trigger async HCM notifications (fire-and-forget)
 *
 * Key design:
 *   - Business logic lives HERE, not in controllers
 *   - Balance mutations delegated to BalanceService (separation of concerns)
 *   - HCM sync is async and non-blocking (leave approval succeeds locally)
 *   - locationId is snapshotted at request creation from the employee record
 */
let LeaveRequestService = class LeaveRequestService {
    constructor(leaveRequestRepository, balanceService, employeeService, hcmSyncService) {
        this.leaveRequestRepository = leaveRequestRepository;
        this.balanceService = balanceService;
        this.employeeService = employeeService;
        this.hcmSyncService = hcmSyncService;
        this.logger = new Logger('LeaveRequestService');
    }

    /**
     * Creates a new leave request with balance validation and reservation.
     *
     * Flow:
     *   1. Validate employee exists and is active
     *   2. Validate date range and leave type
     *   3. Check for overlapping requests
     *   4. Reserve balance at employee's location (pendingDays incremented)
     *   5. Create leave request record with locationId snapshot
     *
     * @param {import('./dto').CreateLeaveRequestDto} dto
     * @param {string} [idempotencyKey] From X-Idempotency-Key header
     * @returns {Promise<Object>}
     */
    async create(dto, idempotencyKey) {
        // 1. Validate employee
        const employee = await this.employeeService.validateActive(dto.employeeId);
        const locationId = dto.locationId || employee.locationCode;

        // 2. Validate leave type
        if (!Object.values(LeaveType).includes(dto.leaveType)) {
            throw new BadRequestException({
                errorCode: 'INVALID_LEAVE_TYPE',
                message: `Invalid leave type: ${dto.leaveType}. Valid types: ${Object.values(LeaveType).join(', ')}`,
            });
        }

        // 3. Validate date range
        const dateValidation = validateDateRange(dto.startDate, dto.endDate);
        if (!dateValidation.valid) {
            throw new BadRequestException({
                errorCode: 'INVALID_DATE_RANGE',
                message: dateValidation.error,
            });
        }

        const totalDays = calculateBusinessDays(dto.startDate, dto.endDate);

        // 4. Check for idempotency — return existing request if key matches
        if (idempotencyKey) {
            const existing = await this.leaveRequestRepository.findOne({
                where: { idempotencyKey },
            });
            if (existing) {
                this.logger.log(`Returning existing request for idempotency key: ${idempotencyKey}`);
                return existing;
            }
        }

        // 5. Check for overlapping active requests (PENDING or APPROVED)
        const overlapping = await this._findOverlapping(
            dto.employeeId,
            dto.startDate,
            dto.endDate,
        );
        if (overlapping.length > 0) {
            throw new ConflictException({
                errorCode: 'OVERLAPPING_REQUEST',
                message: 'An active leave request already exists for the specified dates',
                details: {
                    existingRequestId: overlapping[0].id,
                    existingDates: `${overlapping[0].startDate} to ${overlapping[0].endDate}`,
                },
            });
        }

        // 6. Reserve balance at the employee's location (optimistic lock handles concurrency)
        await this.balanceService.reserveDays(
            dto.employeeId,
            dto.leaveType,
            locationId,
            totalDays,
        );

        // 7. Create the request (snapshot locationId for audit)
        const leaveRequest = this.leaveRequestRepository.create({
            id: uuidv4(),
            idempotencyKey: idempotencyKey || null,
            employeeId: dto.employeeId,
            leaveType: dto.leaveType,
            locationId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays,
            status: LeaveRequestStatus.PENDING,
            reason: dto.reason || null,
            hcmSyncStatus: HcmSyncStatus.NOT_SYNCED,
            hcmSyncAttempts: 0,
        });

        const saved = await this.leaveRequestRepository.save(leaveRequest);
        this.logger.log(
            `Created leave request ${saved.id}: ${dto.leaveType} ${dto.startDate}→${dto.endDate} (${totalDays} days) @${locationId}`,
        );

        return saved;
    }

    /**
     * Approves a pending leave request.
     *
     * Flow:
     *   1. Validate request exists and is PENDING
     *   2. Move days from pending to used (BalanceService.confirmDays)
     *   3. Update request status
     *   4. Trigger async HCM sync (non-blocking)
     *
     * @param {string} requestId
     * @param {import('./dto').ApproveLeaveRequestDto} dto
     * @returns {Promise<Object>}
     */
    async approve(requestId, dto) {
        const request = await this._findRequestOrFail(requestId);

        if (request.status !== LeaveRequestStatus.PENDING) {
            throw new BadRequestException({
                errorCode: 'INVALID_STATUS_TRANSITION',
                message: `Cannot approve request in ${request.status} status. Only PENDING requests can be approved.`,
            });
        }

        // Confirm the balance at the request's snapshotted location
        await this.balanceService.confirmDays(
            request.employeeId,
            request.leaveType,
            request.locationId,
            Number(request.totalDays),
        );

        // Update request status
        request.status = LeaveRequestStatus.APPROVED;
        request.reviewerId = dto.reviewerId;
        request.reviewedAt = new Date();
        request.reviewNote = dto.reviewNote || null;

        const saved = await this.leaveRequestRepository.save(request);
        this.logger.log(`Approved leave request ${requestId}`);

        // Fire-and-forget HCM sync — approval succeeds even if HCM is down
        this._syncToHcmAsync(saved).catch((err) => {
            this.logger.error(`Failed async HCM sync for request ${requestId}: ${err.message}`);
        });

        return saved;
    }

    /**
     * Rejects a pending leave request and releases reserved balance.
     *
     * @param {string} requestId
     * @param {import('./dto').RejectLeaveRequestDto} dto
     * @returns {Promise<Object>}
     */
    async reject(requestId, dto) {
        const request = await this._findRequestOrFail(requestId);

        if (request.status !== LeaveRequestStatus.PENDING) {
            throw new BadRequestException({
                errorCode: 'INVALID_STATUS_TRANSITION',
                message: `Cannot reject request in ${request.status} status. Only PENDING requests can be rejected.`,
            });
        }

        // Release the reserved balance at the request's location
        await this.balanceService.releasePendingDays(
            request.employeeId,
            request.leaveType,
            request.locationId,
            Number(request.totalDays),
        );

        request.status = LeaveRequestStatus.REJECTED;
        request.reviewerId = dto.reviewerId;
        request.reviewedAt = new Date();
        request.reviewNote = dto.reviewNote;

        const saved = await this.leaveRequestRepository.save(request);
        this.logger.log(`Rejected leave request ${requestId}`);

        return saved;
    }

    /**
     * Cancels a leave request. Handles both PENDING and APPROVED states.
     *
     * @param {string} requestId
     * @returns {Promise<Object>}
     */
    async cancel(requestId) {
        const request = await this._findRequestOrFail(requestId);

        if (![LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED].includes(request.status)) {
            throw new BadRequestException({
                errorCode: 'INVALID_STATUS_TRANSITION',
                message: `Cannot cancel request in ${request.status} status`,
            });
        }

        // Restore balance based on previous status, using the request's snapshotted location
        if (request.status === LeaveRequestStatus.PENDING) {
            await this.balanceService.releasePendingDays(
                request.employeeId,
                request.leaveType,
                request.locationId,
                Number(request.totalDays),
            );
        } else if (request.status === LeaveRequestStatus.APPROVED) {
            await this.balanceService.restoreUsedDays(
                request.employeeId,
                request.leaveType,
                request.locationId,
                Number(request.totalDays),
            );
        }

        request.status = LeaveRequestStatus.CANCELLED;
        const saved = await this.leaveRequestRepository.save(request);
        this.logger.log(`Cancelled leave request ${requestId} (was ${request.status})`);

        return saved;
    }

    /**
     * Finds a leave request by ID.
     * @param {string} id
     * @returns {Promise<Object>}
     */
    async findById(id) {
        return this._findRequestOrFail(id);
    }

    /**
     * Lists leave requests for an employee with optional status filter.
     * @param {string} employeeId
     * @param {string} [status]
     * @returns {Promise<Object[]>}
     */
    async findByEmployee(employeeId, status) {
        const where = { employeeId };
        if (status) {
            where.status = status;
        }
        return this.leaveRequestRepository.find({
            where,
            order: { createdAt: 'DESC' },
        });
    }

    /**
     * Finds requests that failed HCM sync (for retry).
     * @returns {Promise<Object[]>}
     */
    async findFailedHcmSync() {
        return this.leaveRequestRepository.find({
            where: { hcmSyncStatus: HcmSyncStatus.FAILED },
            order: { updatedAt: 'ASC' },
        });
    }

    /**
     * Checks for overlapping active leave requests.
     * @private
     */
    async _findOverlapping(employeeId, startDate, endDate) {
        return this.leaveRequestRepository
            .createQueryBuilder('lr')
            .where('lr.employee_id = :employeeId', { employeeId })
            .andWhere('lr.status IN (:...statuses)', {
                statuses: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED],
            })
            .andWhere('lr.start_date <= :endDate', { endDate })
            .andWhere('lr.end_date >= :startDate', { startDate })
            .getMany();
    }

    /**
     * Finds a request by ID or throws NotFoundException.
     * @private
     */
    async _findRequestOrFail(id) {
        const request = await this.leaveRequestRepository.findOne({
            where: { id },
        });
        if (!request) {
            throw new NotFoundException({
                errorCode: 'LEAVE_REQUEST_NOT_FOUND',
                message: `Leave request ${id} not found`,
            });
        }
        return request;
    }

    /**
     * Async HCM sync — fire-and-forget.
     * Updates sync status on the request regardless of outcome.
     * @private
     */
    async _syncToHcmAsync(request) {
        if (!this.hcmSyncService) return;

        try {
            request.hcmSyncStatus = HcmSyncStatus.SYNCING;
            request.hcmSyncAttempts += 1;
            await this.leaveRequestRepository.save(request);

            await this.hcmSyncService.notifyLeaveApproval(request);

            request.hcmSyncStatus = HcmSyncStatus.SYNCED;
            request.hcmLastError = null;
            await this.leaveRequestRepository.save(request);
        } catch (error) {
            request.hcmSyncStatus = HcmSyncStatus.FAILED;
            request.hcmLastError = error.message;
            await this.leaveRequestRepository.save(request);
            throw error;
        }
    }
};

const { Inject } = require('@nestjs/common');
const { getRepositoryToken } = require('@nestjs/typeorm');
const { BalanceService } = require('../balance/balance.service');
const { EmployeeService } = require('../employee/employee.service');
const { HcmSyncService } = require('../hcm-sync/hcm-sync.service');

Reflect.decorate([Injectable()], LeaveRequestService);
Inject(getRepositoryToken(LeaveRequest))(LeaveRequestService, undefined, 0);
Inject(BalanceService)(LeaveRequestService, undefined, 1);
Inject(EmployeeService)(LeaveRequestService, undefined, 2);
Inject(HcmSyncService)(LeaveRequestService, undefined, 3);

module.exports = { LeaveRequestService };
