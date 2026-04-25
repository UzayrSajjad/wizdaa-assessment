const {
    Injectable,
    Logger,
    BadRequestException,
} = require('@nestjs/common');
const { v4: uuidv4 } = require('uuid');
const { SyncType, SyncSource, HcmSyncStatus } = require('../../common/enums');

/**
 * HcmSyncService — orchestrates data synchronization between local DB and HCM.
 *
 * Two sync modes:
 *   1. SINGLE: Sync one employee's balances from HCM (real-time API)
 *   2. BATCH: Sync all employees' balances from HCM (full reconciliation)
 *
 * Key behaviors:
 *   - Batch sync overwrites local totalDays/usedDays with HCM values
 *   - Pending days are PRESERVED during sync (they represent local state)
 *   - All sync operations are logged to HcmSyncLog for audit
 *   - Handles partial failures gracefully (some employees may fail)
 *
 * Also handles outbound sync: notifying HCM of approved leave requests.
 */
let HcmSyncService = class HcmSyncService {
    constructor(
        hcmSyncLogRepository,
        hcmClientService,
        balanceService,
        employeeService,
    ) {
        this.hcmSyncLogRepository = hcmSyncLogRepository;
        this.hcmClientService = hcmClientService;
        this.balanceService = balanceService;
        this.employeeService = employeeService;
        this.logger = new Logger('HcmSyncService');
    }

    /**
     * Syncs a single employee's balances from HCM.
     *
     * @param {string} employeeId Internal employee ID
     * @returns {Promise<Object>} Sync result with updated balances
     */
    async syncSingle(employeeId) {
        const syncLog = await this._createSyncLog(SyncType.SINGLE, employeeId);

        try {
            // 1. Get employee and validate HCM linkage
            const employee = await this.employeeService.findById(employeeId);
            if (!employee.externalHcmId) {
                throw new BadRequestException({
                    errorCode: 'NO_HCM_LINKAGE',
                    message: `Employee ${employeeId} is not linked to HCM (no externalHcmId)`,
                });
            }

            // 2. Fetch balances from HCM
            const hcmData = await this.hcmClientService.getEmployeeBalance(
                employee.externalHcmId,
            );

            // 3. Update local balances
            const updatedBalances = [];
            if (hcmData.balances && Array.isArray(hcmData.balances)) {
                for (const hcmBalance of hcmData.balances) {
                    const locationId = hcmBalance.locationId || employee.locationCode;
                    const updated = await this.balanceService.syncFromHcm(
                        employeeId,
                        hcmBalance.leaveType,
                        locationId,
                        hcmBalance.totalDays,
                        hcmBalance.usedDays,
                        SyncSource.HCM_REALTIME,
                    );
                    updatedBalances.push(updated);
                }
            }

            // 4. Update sync log
            await this._completeSyncLog(syncLog, 'SUCCESS', 1, updatedBalances.length);

            this.logger.log(
                `Single sync completed for employee ${employeeId}: ${updatedBalances.length} balances updated`,
            );

            return {
                syncId: syncLog.id,
                employeeId,
                balancesUpdated: updatedBalances.length,
                balances: updatedBalances,
            };
        } catch (error) {
            await this._failSyncLog(syncLog, error.message);
            throw error;
        }
    }

    /**
     * Batch syncs all employees' balances from HCM.
     * This is the primary reconciliation mechanism.
     *
     * @param {Object} [options]
     * @param {string} [options.locationCode] Filter by location
     * @param {boolean} [options.forceOverwrite=true]
     * @returns {Promise<Object>} Batch sync results
     */
    async syncBatch(options = {}) {
        const syncLog = await this._createSyncLog(SyncType.BATCH);
        const results = {
            syncId: syncLog.id,
            totalEmployees: 0,
            successCount: 0,
            failureCount: 0,
            totalBalancesUpdated: 0,
            errors: [],
        };

        try {
            // 1. Fetch all balances from HCM
            const hcmData = await this.hcmClientService.getBatchBalances();

            if (!hcmData.employees || !Array.isArray(hcmData.employees)) {
                throw new Error('HCM batch response missing employees array');
            }

            results.totalEmployees = hcmData.employees.length;

            // 2. Process each employee
            for (const hcmEmployee of hcmData.employees) {
                try {
                    // Find local employee by HCM ID
                    const localEmployee = await this.employeeService.findByHcmId(
                        hcmEmployee.hcmId,
                    );

                    if (!localEmployee) {
                        this.logger.warn(
                            `Batch sync: HCM employee ${hcmEmployee.hcmId} not found locally, skipping`,
                        );
                        results.errors.push({
                            hcmId: hcmEmployee.hcmId,
                            error: 'Employee not found in local system',
                        });
                        results.failureCount++;
                        continue;
                    }

                    // Apply location filter if specified
                    if (
                        options.locationCode &&
                        localEmployee.locationCode !== options.locationCode
                    ) {
                        continue;
                    }

                    // Update each balance type
                    if (hcmEmployee.balances && Array.isArray(hcmEmployee.balances)) {
                        for (const hcmBalance of hcmEmployee.balances) {
                            const locationId = hcmBalance.locationId || localEmployee.locationCode;
                            await this.balanceService.syncFromHcm(
                                localEmployee.id,
                                hcmBalance.leaveType,
                                locationId,
                                hcmBalance.totalDays,
                                hcmBalance.usedDays,
                                SyncSource.HCM_BATCH,
                            );
                            results.totalBalancesUpdated++;
                        }
                    }

                    results.successCount++;
                } catch (employeeError) {
                    results.failureCount++;
                    results.errors.push({
                        hcmId: hcmEmployee.hcmId,
                        error: employeeError.message,
                    });
                    this.logger.error(
                        `Batch sync failed for HCM employee ${hcmEmployee.hcmId}: ${employeeError.message}`,
                    );
                    // Continue processing other employees — partial failure is acceptable
                }
            }

            // 3. Finalize sync log
            const status =
                results.failureCount === 0
                    ? 'SUCCESS'
                    : results.successCount > 0
                        ? 'PARTIAL_SUCCESS'
                        : 'FAILED';

            await this._completeSyncLog(
                syncLog,
                status,
                results.successCount,
                results.totalBalancesUpdated,
            );

            this.logger.log(
                `Batch sync completed: ${results.successCount}/${results.totalEmployees} employees, ` +
                `${results.totalBalancesUpdated} balances updated, ${results.failureCount} failures`,
            );

            return results;
        } catch (error) {
            await this._failSyncLog(syncLog, error.message);
            throw error;
        }
    }

    /**
     * Notifies HCM of an approved leave request (outbound sync).
     *
     * @param {Object} leaveRequest
     */
    async notifyLeaveApproval(leaveRequest) {
        const employee = await this.employeeService.findById(leaveRequest.employeeId);

        if (!employee.externalHcmId) {
            this.logger.warn(
                `Cannot sync leave request ${leaveRequest.id} to HCM: employee has no HCM linkage`,
            );
            return;
        }

        await this.hcmClientService.deductBalance({
            employeeHcmId: employee.externalHcmId,
            leaveType: leaveRequest.leaveType,
            days: Number(leaveRequest.totalDays),
            startDate: leaveRequest.startDate,
            endDate: leaveRequest.endDate,
            requestId: leaveRequest.id,
        });

        this.logger.log(
            `Notified HCM of leave approval: request ${leaveRequest.id}`,
        );
    }

    /**
     * Returns recent sync logs for monitoring.
     * @param {number} limit
     * @returns {Promise<Object[]>}
     */
    async getRecentLogs(limit = 20) {
        return this.hcmSyncLogRepository.find({
            order: { startedAt: 'DESC' },
            take: limit,
        });
    }

    // ─── Private Helpers ──────────────────────────────────────────────────

    async _createSyncLog(syncType, employeeId = null) {
        const log = this.hcmSyncLogRepository.create({
            id: uuidv4(),
            syncType,
            status: 'IN_PROGRESS',
            direction: syncType === SyncType.SINGLE && employeeId ? 'INBOUND' : 'INBOUND',
            employeeId,
            startedAt: new Date(),
        });
        return this.hcmSyncLogRepository.save(log);
    }

    async _completeSyncLog(log, status, employeesAffected, balancesUpdated) {
        log.status = status;
        log.employeesAffected = employeesAffected;
        log.balancesUpdated = balancesUpdated;
        log.completedAt = new Date();
        return this.hcmSyncLogRepository.save(log);
    }

    async _failSyncLog(log, errorDetails) {
        log.status = 'FAILED';
        log.errorDetails = errorDetails;
        log.completedAt = new Date();
        return this.hcmSyncLogRepository.save(log);
    }
};

const { Inject } = require('@nestjs/common');
const { getRepositoryToken } = require('@nestjs/typeorm');
const { HcmSyncLog } = require('./hcm-sync-log.entity');
const { HcmClientService } = require('./hcm-client.service');
const { BalanceService } = require('../balance/balance.service');
const { EmployeeService } = require('../employee/employee.service');

Reflect.decorate([Injectable()], HcmSyncService);
Inject(getRepositoryToken(HcmSyncLog))(HcmSyncService, undefined, 0);
Inject(HcmClientService)(HcmSyncService, undefined, 1);
Inject(BalanceService)(HcmSyncService, undefined, 2);
Inject(EmployeeService)(HcmSyncService, undefined, 3);

module.exports = { HcmSyncService };
