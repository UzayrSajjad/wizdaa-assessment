const {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
} = require('@nestjs/common');
const { InjectRepository } = require('@nestjs/typeorm');
const { v4: uuidv4 } = require('uuid');
const { LeaveBalance } = require('./balance.entity');
const { SyncSource } = require('../../common/enums');

/**
 * BalanceService — manages leave balances with concurrency-safe operations.
 *
 * CRITICAL DESIGN:
 *   - Balances are keyed by (employeeId, leaveType, locationId)
 *   - All balance mutations use optimistic locking (TypeORM @VersionColumn)
 *   - On version conflict, operations are retried with fresh data
 *   - `pendingDays` reserves days for PENDING requests to prevent over-commitment
 *   - `availableDays` = totalDays - usedDays - pendingDays
 *
 * This is the most concurrency-sensitive service in the system.
 */
let BalanceService = class BalanceService {
    constructor(balanceRepository) {
        this.balanceRepository = balanceRepository;
        this.logger = new Logger('BalanceService');
        this.MAX_RETRY_ATTEMPTS = 3;
    }

    /**
     * Retrieves all leave balances for an employee with computed available days.
     * Optionally filtered by locationId.
     * @param {string} employeeId
     * @param {string} [locationId]
     * @returns {Promise<Object[]>}
     */
    async getBalances(employeeId, locationId) {
        const where = { employeeId };
        if (locationId) {
            where.locationId = locationId;
        }

        const balances = await this.balanceRepository.find({ where });

        return balances.map((b) => ({
            ...b,
            availableDays: this._computeAvailable(b),
        }));
    }

    /**
     * Gets a specific balance by employee, leave type, and location.
     * @param {string} employeeId
     * @param {string} leaveType
     * @param {string} locationId
     * @returns {Promise<Object|null>}
     */
    async getBalance(employeeId, leaveType, locationId) {
        const balance = await this.balanceRepository.findOne({
            where: { employeeId, leaveType, locationId },
        });

        if (balance) {
            balance.availableDays = this._computeAvailable(balance);
        }

        return balance;
    }

    /**
     * Ensures a balance record exists for the given employee + leave type + location.
     * Creates one with zero values if it doesn't exist.
     * @param {string} employeeId
     * @param {string} leaveType
     * @param {string} locationId
     * @returns {Promise<Object>}
     */
    async ensureBalance(employeeId, leaveType, locationId) {
        let balance = await this.balanceRepository.findOne({
            where: { employeeId, leaveType, locationId },
        });

        if (!balance) {
            balance = this.balanceRepository.create({
                id: uuidv4(),
                employeeId,
                leaveType,
                locationId,
                totalDays: 0,
                usedDays: 0,
                pendingDays: 0,
                syncSource: SyncSource.LOCAL,
            });
            balance = await this.balanceRepository.save(balance);
            this.logger.log(`Created balance record: ${employeeId}/${leaveType}@${locationId}`);
        }

        balance.availableDays = this._computeAvailable(balance);
        return balance;
    }

    /**
     * Reserves days by incrementing pendingDays (for PENDING leave requests).
     * Uses optimistic locking to prevent race conditions.
     *
     * @param {string} employeeId
     * @param {string} leaveType
     * @param {string} locationId
     * @param {number} days
     * @returns {Promise<Object>} Updated balance
     * @throws {BadRequestException} If insufficient balance
     */
    async reserveDays(employeeId, leaveType, locationId, days) {
        return this._withOptimisticRetry(async () => {
            const balance = await this.ensureBalance(employeeId, leaveType, locationId);
            const available = this._computeAvailable(balance);

            if (available < days) {
                throw new BadRequestException({
                    errorCode: 'INSUFFICIENT_BALANCE',
                    message: `Insufficient ${leaveType} balance. Available: ${available}, Requested: ${days}`,
                    details: {
                        leaveType,
                        locationId,
                        totalDays: Number(balance.totalDays),
                        usedDays: Number(balance.usedDays),
                        pendingDays: Number(balance.pendingDays),
                        availableDays: available,
                        requestedDays: days,
                    },
                });
            }

            balance.pendingDays = Number(balance.pendingDays) + days;
            balance.syncSource = SyncSource.LOCAL;
            const updated = await this.balanceRepository.save(balance);

            this.logger.log(
                `Reserved ${days} ${leaveType} days for employee ${employeeId}@${locationId}. ` +
                `Pending: ${updated.pendingDays}, Available: ${this._computeAvailable(updated)}`,
            );

            return { ...updated, availableDays: this._computeAvailable(updated) };
        }, 'reserveDays');
    }

    /**
     * Confirms a reservation by moving days from pending to used.
     * Called when a leave request is APPROVED.
     *
     * @param {string} employeeId
     * @param {string} leaveType
     * @param {string} locationId
     * @param {number} days
     * @returns {Promise<Object>}
     */
    async confirmDays(employeeId, leaveType, locationId, days) {
        return this._withOptimisticRetry(async () => {
            const balance = await this.getBalance(employeeId, leaveType, locationId);
            if (!balance) {
                throw new NotFoundException({
                    errorCode: 'BALANCE_NOT_FOUND',
                    message: `No ${leaveType} balance found for employee ${employeeId}@${locationId}`,
                });
            }

            balance.pendingDays = Math.max(0, Number(balance.pendingDays) - days);
            balance.usedDays = Number(balance.usedDays) + days;
            balance.syncSource = SyncSource.LOCAL;
            const updated = await this.balanceRepository.save(balance);

            this.logger.log(
                `Confirmed ${days} ${leaveType} days for employee ${employeeId}@${locationId}. ` +
                `Used: ${updated.usedDays}, Pending: ${updated.pendingDays}`,
            );

            return { ...updated, availableDays: this._computeAvailable(updated) };
        }, 'confirmDays');
    }

    /**
     * Releases reserved days back to available (when a PENDING request is cancelled).
     *
     * @param {string} employeeId
     * @param {string} leaveType
     * @param {string} locationId
     * @param {number} days
     * @returns {Promise<Object>}
     */
    async releasePendingDays(employeeId, leaveType, locationId, days) {
        return this._withOptimisticRetry(async () => {
            const balance = await this.getBalance(employeeId, leaveType, locationId);
            if (!balance) return null;

            balance.pendingDays = Math.max(0, Number(balance.pendingDays) - days);
            balance.syncSource = SyncSource.LOCAL;
            const updated = await this.balanceRepository.save(balance);

            this.logger.log(
                `Released ${days} pending ${leaveType} days for employee ${employeeId}@${locationId}`,
            );

            return { ...updated, availableDays: this._computeAvailable(updated) };
        }, 'releasePendingDays');
    }

    /**
     * Restores used days (when an APPROVED request is cancelled).
     *
     * @param {string} employeeId
     * @param {string} leaveType
     * @param {string} locationId
     * @param {number} days
     * @returns {Promise<Object>}
     */
    async restoreUsedDays(employeeId, leaveType, locationId, days) {
        return this._withOptimisticRetry(async () => {
            const balance = await this.getBalance(employeeId, leaveType, locationId);
            if (!balance) return null;

            balance.usedDays = Math.max(0, Number(balance.usedDays) - days);
            balance.syncSource = SyncSource.LOCAL;
            const updated = await this.balanceRepository.save(balance);

            this.logger.log(
                `Restored ${days} used ${leaveType} days for employee ${employeeId}@${locationId}`,
            );

            return { ...updated, availableDays: this._computeAvailable(updated) };
        }, 'restoreUsedDays');
    }

    /**
     * Overwrites local balance with HCM data during sync.
     * Preserves pending days from active local requests.
     *
     * @param {string} employeeId
     * @param {string} leaveType
     * @param {string} locationId
     * @param {number} hcmTotalDays
     * @param {number} hcmUsedDays
     * @param {string} syncSource
     * @returns {Promise<Object>}
     */
    async syncFromHcm(employeeId, leaveType, locationId, hcmTotalDays, hcmUsedDays, syncSource) {
        const balance = await this.ensureBalance(employeeId, leaveType, locationId);
        const previousTotal = Number(balance.totalDays);
        const previousUsed = Number(balance.usedDays);

        balance.totalDays = hcmTotalDays;
        balance.usedDays = hcmUsedDays;
        // Keep pendingDays as-is — they represent active local state
        balance.lastSyncedAt = new Date();
        balance.syncSource = syncSource;

        const updated = await this.balanceRepository.save(balance);

        if (previousTotal !== hcmTotalDays || previousUsed !== hcmUsedDays) {
            this.logger.warn(
                `HCM sync adjusted balance for ${employeeId}/${leaveType}@${locationId}: ` +
                `total ${previousTotal}→${hcmTotalDays}, used ${previousUsed}→${hcmUsedDays}`,
            );
        }

        return { ...updated, availableDays: this._computeAvailable(updated) };
    }

    /**
     * Computes available days from a balance record.
     * @param {Object} balance
     * @returns {number}
     */
    _computeAvailable(balance) {
        return Math.max(
            0,
            Number(balance.totalDays) - Number(balance.usedDays) - Number(balance.pendingDays),
        );
    }

    /**
     * Wraps an operation with optimistic locking retry logic.
     * On version conflict (OptimisticLockVersionMismatchError), retries
     * with fresh data up to MAX_RETRY_ATTEMPTS times.
     *
     * @param {Function} operation
     * @param {string} operationName
     * @returns {Promise<*>}
     */
    async _withOptimisticRetry(operation, operationName) {
        for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                return await operation();
            } catch (error) {
                // Check for optimistic lock conflict
                const isLockError =
                    error.name === 'OptimisticLockVersionMismatchError' ||
                    error.message?.includes('version') ||
                    error.message?.includes('optimistic');

                if (isLockError && attempt < this.MAX_RETRY_ATTEMPTS) {
                    this.logger.warn(
                        `[${operationName}] Optimistic lock conflict on attempt ${attempt}/${this.MAX_RETRY_ATTEMPTS}. Retrying...`,
                    );
                    // Small random delay to reduce contention
                    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
                    continue;
                }

                throw error;
            }
        }
    }
};

const { Inject } = require('@nestjs/common');
const { getRepositoryToken } = require('@nestjs/typeorm');

Reflect.decorate([Injectable()], BalanceService);
Inject(getRepositoryToken(LeaveBalance))(BalanceService, undefined, 0);

module.exports = { BalanceService };
