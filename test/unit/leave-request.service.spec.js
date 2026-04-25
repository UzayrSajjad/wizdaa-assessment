/**
 * @fileoverview Unit tests for LeaveRequestService.
 * Tests leave request lifecycle: create, approve, reject, cancel.
 */

const { LeaveRequestService } = require('../../src/modules/leave-request/leave-request.service');
const { LeaveRequestStatus, HcmSyncStatus, LeaveType } = require('../../src/common/enums');

describe('LeaveRequestService', () => {
    let service;
    let mockRepo;
    let mockBalanceService;
    let mockEmployeeService;
    let mockHcmSyncService;

    beforeEach(() => {
        mockRepo = {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn((data) => ({ ...data })),
            save: jest.fn((data) => Promise.resolve({ ...data })),
            createQueryBuilder: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([]),
            }),
        };

        mockBalanceService = {
            reserveDays: jest.fn().mockResolvedValue({}),
            confirmDays: jest.fn().mockResolvedValue({}),
            releasePendingDays: jest.fn().mockResolvedValue({}),
            restoreUsedDays: jest.fn().mockResolvedValue({}),
        };

        mockEmployeeService = {
            validateActive: jest.fn().mockResolvedValue({
                id: 'emp-1',
                isActive: true,
                firstName: 'John',
                lastName: 'Doe',
                locationCode: 'US',
            }),
            findById: jest.fn().mockResolvedValue({ id: 'emp-1', externalHcmId: 'HCM-001' }),
        };

        mockHcmSyncService = {
            notifyLeaveApproval: jest.fn().mockResolvedValue({}),
        };

        service = new LeaveRequestService(
            mockRepo,
            mockBalanceService,
            mockEmployeeService,
            mockHcmSyncService,
        );
    });

    // ─── create ────────────────────────────────────────────────

    describe('create', () => {
        const validDto = {
            employeeId: 'emp-1',
            leaveType: 'ANNUAL',
            startDate: '2027-06-01',
            endDate: '2027-06-05',
            reason: 'Vacation',
        };

        it('should create request and reserve balance', async () => {
            const result = await service.create(validDto);

            expect(mockEmployeeService.validateActive).toHaveBeenCalledWith('emp-1');
            expect(mockBalanceService.reserveDays).toHaveBeenCalledWith('emp-1', 'ANNUAL', 'US', expect.any(Number));
            expect(mockRepo.save).toHaveBeenCalled();
            expect(result.status).toBe(LeaveRequestStatus.PENDING);
            expect(result.hcmSyncStatus).toBe(HcmSyncStatus.NOT_SYNCED);
        });

        it('should reject invalid leave type', async () => {
            await expect(
                service.create({ ...validDto, leaveType: 'INVALID_TYPE' }),
            ).rejects.toThrow('Invalid leave type');
        });

        it('should reject when end date before start date', async () => {
            await expect(
                service.create({ ...validDto, startDate: '2027-06-10', endDate: '2027-06-05' }),
            ).rejects.toThrow();
        });

        it('should return existing request for duplicate idempotency key', async () => {
            const existing = { id: 'existing-req', idempotencyKey: 'key-123', status: 'PENDING' };
            mockRepo.findOne.mockResolvedValue(existing);

            const result = await service.create(validDto, 'key-123');

            expect(result.id).toBe('existing-req');
            expect(mockBalanceService.reserveDays).not.toHaveBeenCalled();
        });

        it('should reject overlapping requests', async () => {
            // First findOne: idempotency check returns null
            mockRepo.findOne.mockResolvedValueOnce(null);
            // QueryBuilder: overlapping request found
            mockRepo.createQueryBuilder.mockReturnValue({
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{
                    id: 'existing-req',
                    startDate: '2027-06-02',
                    endDate: '2027-06-04',
                }]),
            });

            await expect(
                service.create(validDto),
            ).rejects.toThrow('active leave request already exists');
        });
    });

    // ─── approve ───────────────────────────────────────────────

    describe('approve', () => {
        it('should approve pending request and confirm balance', async () => {
            const pending = {
                id: 'req-1',
                employeeId: 'emp-1',
                leaveType: 'ANNUAL',
                locationId: 'US',
                totalDays: 5,
                status: LeaveRequestStatus.PENDING,
                hcmSyncStatus: HcmSyncStatus.NOT_SYNCED,
                hcmSyncAttempts: 0,
            };
            mockRepo.findOne.mockResolvedValue(pending);
            mockRepo.save.mockImplementation((data) => Promise.resolve({ ...data }));

            const result = await service.approve('req-1', {
                reviewerId: 'mgr-1',
                reviewNote: 'Approved',
            });

            expect(result.status).toBe(LeaveRequestStatus.APPROVED);
            expect(result.reviewerId).toBe('mgr-1');
            expect(mockBalanceService.confirmDays).toHaveBeenCalledWith('emp-1', 'ANNUAL', 'US', 5);
        });

        it('should reject approval of non-PENDING request', async () => {
            mockRepo.findOne.mockResolvedValue({
                id: 'req-1',
                status: LeaveRequestStatus.APPROVED,
            });

            await expect(
                service.approve('req-1', { reviewerId: 'mgr-1' }),
            ).rejects.toThrow('Cannot approve');
        });

        it('should throw for non-existent request', async () => {
            mockRepo.findOne.mockResolvedValue(null);

            await expect(
                service.approve('nonexistent', { reviewerId: 'mgr-1' }),
            ).rejects.toThrow('not found');
        });
    });

    // ─── reject ────────────────────────────────────────────────

    describe('reject', () => {
        it('should reject pending request and release pending days', async () => {
            const pending = {
                id: 'req-1',
                employeeId: 'emp-1',
                leaveType: 'SICK',
                locationId: 'US',
                totalDays: 2,
                status: LeaveRequestStatus.PENDING,
            };
            mockRepo.findOne.mockResolvedValue(pending);
            mockRepo.save.mockImplementation((data) => Promise.resolve({ ...data }));

            const result = await service.reject('req-1', {
                reviewerId: 'mgr-1',
                reviewNote: 'Denied',
            });

            expect(result.status).toBe(LeaveRequestStatus.REJECTED);
            expect(mockBalanceService.releasePendingDays).toHaveBeenCalledWith('emp-1', 'SICK', 'US', 2);
        });
    });

    // ─── cancel ────────────────────────────────────────────────

    describe('cancel', () => {
        it('should cancel PENDING request and release pending days', async () => {
            const pending = {
                id: 'req-1',
                employeeId: 'emp-1',
                leaveType: 'ANNUAL',
                locationId: 'US',
                totalDays: 3,
                status: LeaveRequestStatus.PENDING,
            };
            mockRepo.findOne.mockResolvedValue(pending);
            mockRepo.save.mockImplementation((data) => Promise.resolve({ ...data }));

            const result = await service.cancel('req-1');

            expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
            expect(mockBalanceService.releasePendingDays).toHaveBeenCalledWith('emp-1', 'ANNUAL', 'US', 3);
            expect(mockBalanceService.restoreUsedDays).not.toHaveBeenCalled();
        });

        it('should cancel APPROVED request and restore used days', async () => {
            const approved = {
                id: 'req-1',
                employeeId: 'emp-1',
                leaveType: 'ANNUAL',
                locationId: 'US',
                totalDays: 3,
                status: LeaveRequestStatus.APPROVED,
            };
            mockRepo.findOne.mockResolvedValue(approved);
            mockRepo.save.mockImplementation((data) => Promise.resolve({ ...data }));

            const result = await service.cancel('req-1');

            expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
            expect(mockBalanceService.restoreUsedDays).toHaveBeenCalledWith('emp-1', 'ANNUAL', 'US', 3);
            expect(mockBalanceService.releasePendingDays).not.toHaveBeenCalled();
        });

        it('should reject cancellation of already cancelled request', async () => {
            mockRepo.findOne.mockResolvedValue({
                id: 'req-1',
                status: LeaveRequestStatus.CANCELLED,
            });

            await expect(service.cancel('req-1')).rejects.toThrow('Cannot cancel');
        });
    });
});
