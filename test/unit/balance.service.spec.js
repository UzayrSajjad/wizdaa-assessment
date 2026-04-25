/**
 * @fileoverview Unit tests for BalanceService.
 * Tests the most critical service in the system — balance management
 * with optimistic locking, reservation, and HCM sync.
 *
 * Balances are keyed by (employeeId, leaveType, locationId).
 */

const { BalanceService } = require('../../src/modules/balance/balance.service');
const { SyncSource } = require('../../src/common/enums');

describe('BalanceService', () => {
    let balanceService;
    let mockRepository;

    beforeEach(() => {
        mockRepository = {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn((data) => ({ ...data })),
            save: jest.fn((entity) => Promise.resolve({ ...entity })),
        };

        balanceService = new BalanceService(mockRepository);
    });

    // ─── getBalances ───────────────────────────────────────────

    describe('getBalances', () => {
        it('should return balances with computed availableDays', async () => {
            mockRepository.find.mockResolvedValue([
                { id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US', totalDays: 20, usedDays: 5, pendingDays: 3 },
                { id: '2', employeeId: 'emp-1', leaveType: 'SICK', locationId: 'US', totalDays: 10, usedDays: 2, pendingDays: 0 },
            ]);

            const result = await balanceService.getBalances('emp-1');

            expect(result).toHaveLength(2);
            expect(result[0].availableDays).toBe(12); // 20 - 5 - 3
            expect(result[1].availableDays).toBe(8);  // 10 - 2 - 0
        });

        it('should return empty array for employee with no balances', async () => {
            mockRepository.find.mockResolvedValue([]);

            const result = await balanceService.getBalances('emp-nonexistent');

            expect(result).toEqual([]);
        });

        it('should filter by locationId when provided', async () => {
            mockRepository.find.mockResolvedValue([]);
            await balanceService.getBalances('emp-1', 'US');

            expect(mockRepository.find).toHaveBeenCalledWith({
                where: { employeeId: 'emp-1', locationId: 'US' },
            });
        });

        it('should not filter by locationId when not provided', async () => {
            mockRepository.find.mockResolvedValue([]);
            await balanceService.getBalances('emp-1');

            expect(mockRepository.find).toHaveBeenCalledWith({
                where: { employeeId: 'emp-1' },
            });
        });
    });

    // ─── ensureBalance ─────────────────────────────────────────

    describe('ensureBalance', () => {
        it('should return existing balance if found', async () => {
            const existing = { id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US', totalDays: 20, usedDays: 5, pendingDays: 0 };
            mockRepository.findOne.mockResolvedValue(existing);

            const result = await balanceService.ensureBalance('emp-1', 'ANNUAL', 'US');

            expect(result.id).toBe('1');
            expect(result.availableDays).toBe(15);
            expect(mockRepository.save).not.toHaveBeenCalled();
        });

        it('should create new balance with zero values if not found', async () => {
            mockRepository.findOne.mockResolvedValue(null);
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity, id: 'new-id' }));

            const result = await balanceService.ensureBalance('emp-1', 'ANNUAL', 'US');

            expect(mockRepository.create).toHaveBeenCalled();
            expect(mockRepository.save).toHaveBeenCalled();
            expect(result.totalDays).toBe(0);
            expect(result.usedDays).toBe(0);
            expect(result.pendingDays).toBe(0);
            expect(result.locationId).toBe('US');
        });

        it('should create balance with correct locationId', async () => {
            mockRepository.findOne.mockResolvedValue(null);
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            await balanceService.ensureBalance('emp-1', 'SICK', 'PK');

            expect(mockRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({ locationId: 'PK', leaveType: 'SICK' }),
            );
        });
    });

    // ─── reserveDays ───────────────────────────────────────────

    describe('reserveDays', () => {
        it('should increment pendingDays when sufficient balance exists', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 5, pendingDays: 0,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.reserveDays('emp-1', 'ANNUAL', 'US', 3);

            expect(result.pendingDays).toBe(3);
            expect(result.availableDays).toBe(12); // 20 - 5 - 3
        });

        it('should throw INSUFFICIENT_BALANCE when not enough days', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 18, pendingDays: 1,
            });

            await expect(
                balanceService.reserveDays('emp-1', 'ANNUAL', 'US', 3),
            ).rejects.toThrow('Insufficient');
        });

        it('should consider pendingDays when computing available balance', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 10, pendingDays: 8,
            });

            // Available = 20 - 10 - 8 = 2, requesting 3 → should fail
            await expect(
                balanceService.reserveDays('emp-1', 'ANNUAL', 'US', 3),
            ).rejects.toThrow('Insufficient');
        });

        it('should include locationId in error details', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'PK',
                totalDays: 5, usedDays: 5, pendingDays: 0,
            });

            try {
                await balanceService.reserveDays('emp-1', 'ANNUAL', 'PK', 1);
                fail('Expected error');
            } catch (error) {
                expect(error.response?.errorCode || error.message).toContain('INSUFFICIENT_BALANCE');
            }
        });

        it('should reserve days for a specific location without affecting other locations', async () => {
            // Balance exists at US location
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 5, pendingDays: 0,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.reserveDays('emp-1', 'ANNUAL', 'US', 3);

            // Verify it looked up balance with the correct locationId
            expect(mockRepository.findOne).toHaveBeenCalledWith({
                where: { employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US' },
            });
            expect(result.pendingDays).toBe(3);
        });
    });

    // ─── confirmDays ───────────────────────────────────────────

    describe('confirmDays', () => {
        it('should move days from pending to used', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 5, pendingDays: 3,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.confirmDays('emp-1', 'ANNUAL', 'US', 3);

            expect(result.usedDays).toBe(8);        // 5 + 3
            expect(result.pendingDays).toBe(0);      // 3 - 3
            expect(result.availableDays).toBe(12);   // 20 - 8 - 0
        });

        it('should throw when balance not found', async () => {
            mockRepository.findOne.mockResolvedValue(null);

            await expect(
                balanceService.confirmDays('emp-1', 'ANNUAL', 'US', 3),
            ).rejects.toThrow('balance found');
        });

        it('should clamp pending days to zero if underflow', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 5, pendingDays: 1,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.confirmDays('emp-1', 'ANNUAL', 'US', 3);
            expect(result.pendingDays).toBe(0); // Math.max(0, 1-3)
            expect(result.usedDays).toBe(8);
        });
    });

    // ─── releasePendingDays ────────────────────────────────────

    describe('releasePendingDays', () => {
        it('should decrement pendingDays without affecting usedDays', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 5, pendingDays: 3,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.releasePendingDays('emp-1', 'ANNUAL', 'US', 3);

            expect(result.pendingDays).toBe(0);
            expect(result.usedDays).toBe(5); // unchanged
            expect(result.availableDays).toBe(15);
        });

        it('should not go below zero for pendingDays', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 5, pendingDays: 1,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.releasePendingDays('emp-1', 'ANNUAL', 'US', 5);

            expect(result.pendingDays).toBe(0); // Math.max(0, 1-5) = 0
        });

        it('should return null when balance not found', async () => {
            mockRepository.findOne.mockResolvedValue(null);

            const result = await balanceService.releasePendingDays('emp-1', 'ANNUAL', 'US', 3);
            expect(result).toBeNull();
        });
    });

    // ─── restoreUsedDays ───────────────────────────────────────

    describe('restoreUsedDays', () => {
        it('should decrement usedDays (for approved request cancellation)', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 8, pendingDays: 0,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.restoreUsedDays('emp-1', 'ANNUAL', 'US', 3);

            expect(result.usedDays).toBe(5); // 8 - 3
            expect(result.availableDays).toBe(15); // 20 - 5 - 0
        });

        it('should not go below zero for usedDays', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 2, pendingDays: 0,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.restoreUsedDays('emp-1', 'ANNUAL', 'US', 5);
            expect(result.usedDays).toBe(0); // Math.max(0, 2-5)
        });
    });

    // ─── syncFromHcm ──────────────────────────────────────────

    describe('syncFromHcm', () => {
        it('should overwrite totalDays and usedDays but preserve pendingDays', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 5, pendingDays: 3,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.syncFromHcm(
                'emp-1', 'ANNUAL', 'US', 25, 8, SyncSource.HCM_BATCH,
            );

            expect(result.totalDays).toBe(25);       // overwritten by HCM
            expect(result.usedDays).toBe(8);          // overwritten by HCM
            expect(result.pendingDays).toBe(3);       // preserved (local state)
            expect(result.syncSource).toBe(SyncSource.HCM_BATCH);
            expect(result.lastSyncedAt).toBeDefined();
        });

        it('should handle work anniversary balance refresh correctly', async () => {
            // Simulates HCM sending increased totalDays after work anniversary
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 10, pendingDays: 2,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.syncFromHcm(
                'emp-1', 'ANNUAL', 'US', 25, 10, SyncSource.HCM_REALTIME,
            );

            expect(result.totalDays).toBe(25);    // Increased from 20 to 25
            expect(result.usedDays).toBe(10);
            expect(result.pendingDays).toBe(2);    // Local pending preserved
            expect(result.availableDays).toBe(13); // 25 - 10 - 2
        });

        it('should handle year-start balance reset correctly', async () => {
            // Simulates HCM resetting balances at start of year
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'ANNUAL', locationId: 'US',
                totalDays: 20, usedDays: 18, pendingDays: 1,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.syncFromHcm(
                'emp-1', 'ANNUAL', 'US', 20, 0, SyncSource.HCM_BATCH,
            );

            expect(result.totalDays).toBe(20);     // Same allocation
            expect(result.usedDays).toBe(0);        // Reset to 0 for new year
            expect(result.pendingDays).toBe(1);     // Preserved
            expect(result.availableDays).toBe(19);  // 20 - 0 - 1
        });

        it('should set syncSource to HCM_REALTIME for single sync', async () => {
            mockRepository.findOne.mockResolvedValue({
                id: '1', employeeId: 'emp-1', leaveType: 'SICK', locationId: 'PK',
                totalDays: 10, usedDays: 2, pendingDays: 0,
            });
            mockRepository.save.mockImplementation((entity) => Promise.resolve({ ...entity }));

            const result = await balanceService.syncFromHcm(
                'emp-1', 'SICK', 'PK', 12, 2, SyncSource.HCM_REALTIME,
            );

            expect(result.syncSource).toBe(SyncSource.HCM_REALTIME);
            expect(result.locationId).toBe('PK');
        });
    });

    // ─── _computeAvailable ────────────────────────────────────

    describe('_computeAvailable', () => {
        it('should never return negative', () => {
            const result = balanceService._computeAvailable({
                totalDays: 5, usedDays: 10, pendingDays: 3,
            });
            expect(result).toBe(0); // Math.max(0, 5-10-3) = 0
        });

        it('should handle decimal values', () => {
            const result = balanceService._computeAvailable({
                totalDays: '20.0', usedDays: '5.5', pendingDays: '2.0',
            });
            expect(result).toBe(12.5);
        });
    });
});
