const { EntitySchema } = require('typeorm');

/**
 * LeaveBalance entity — tracks available leave days per employee per leave type.
 *
 * Critical design decisions:
 *   - `locationId` makes this per-employee per-location as required by HCM
 *   - `version` column enables optimistic locking to prevent concurrent
 *     deductions (e.g., two leave requests processed simultaneously)
 *   - `pendingDays` tracks days in PENDING requests, preventing over-commitment
 *   - `availableDays` = totalDays - usedDays - pendingDays (computed in service layer)
 *   - `syncSource` and `lastSyncedAt` provide audit trail for HCM reconciliation
 *   - Unique constraint on (employeeId, leaveType, locationId) prevents duplicate balances
 */
const LeaveBalance = new EntitySchema({
    name: 'LeaveBalance',
    tableName: 'leave_balances',
    columns: {
        id: {
            type: 'varchar',
            primary: true,
            length: 36,
        },
        employeeId: {
            type: 'varchar',
            length: 36,
            name: 'employee_id',
        },
        leaveType: {
            type: 'varchar',
            length: 20,
            name: 'leave_type',
        },
        locationId: {
            type: 'varchar',
            length: 50,
            name: 'location_id',
        },
        totalDays: {
            type: 'decimal',
            precision: 5,
            scale: 1,
            default: 0,
            name: 'total_days',
        },
        usedDays: {
            type: 'decimal',
            precision: 5,
            scale: 1,
            default: 0,
            name: 'used_days',
        },
        pendingDays: {
            type: 'decimal',
            precision: 5,
            scale: 1,
            default: 0,
            name: 'pending_days',
        },
        version: {
            type: 'int',
            default: 1,
            version: true,
        },
        lastSyncedAt: {
            type: 'datetime',
            nullable: true,
            name: 'last_synced_at',
        },
        syncSource: {
            type: 'varchar',
            length: 20,
            nullable: true,
            name: 'sync_source',
        },
        createdAt: {
            type: 'datetime',
            createDate: true,
            name: 'created_at',
        },
        updatedAt: {
            type: 'datetime',
            updateDate: true,
            name: 'updated_at',
        },
    },
    relations: {
        employee: {
            type: 'many-to-one',
            target: 'Employee',
            joinColumn: { name: 'employee_id' },
            onDelete: 'CASCADE',
        },
    },
    indices: [
        {
            name: 'IDX_balance_employee_type_location',
            columns: ['employeeId', 'leaveType', 'locationId'],
            unique: true,
        },
        {
            name: 'IDX_balance_employee',
            columns: ['employeeId'],
        },
        {
            name: 'IDX_balance_location',
            columns: ['locationId'],
        },
    ],
});

module.exports = { LeaveBalance };
