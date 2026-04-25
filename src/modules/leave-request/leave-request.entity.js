const { EntitySchema } = require('typeorm');

/**
 * LeaveRequest entity — represents a single time-off request.
 *
 * State machine:
 *   PENDING → APPROVED (deducts from balance, notifies HCM)
 *   PENDING → REJECTED (no balance change)
 *   PENDING → CANCELLED (releases pending days)
 *   APPROVED → CANCELLED (restores used days, notifies HCM)
 *
 * Design notes:
 *   - `idempotencyKey` prevents duplicate submissions (unique constraint)
 *   - `hcmSyncStatus` + `hcmSyncAttempts` track async HCM notification state
 *   - `hcmLastError` stores the last HCM error for debugging
 *   - `totalDays` is computed at creation time and stored (denormalized for perf)
 *   - Multiple indices support common query patterns
 */
const LeaveRequest = new EntitySchema({
    name: 'LeaveRequest',
    tableName: 'leave_requests',
    columns: {
        id: {
            type: 'varchar',
            primary: true,
            length: 36,
        },
        idempotencyKey: {
            type: 'varchar',
            length: 100,
            nullable: true,
            unique: true,
            name: 'idempotency_key',
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
        startDate: {
            type: 'date',
            name: 'start_date',
        },
        endDate: {
            type: 'date',
            name: 'end_date',
        },
        totalDays: {
            type: 'decimal',
            precision: 5,
            scale: 1,
            name: 'total_days',
        },
        status: {
            type: 'varchar',
            length: 20,
            default: 'PENDING',
        },
        reason: {
            type: 'text',
            nullable: true,
        },
        reviewerId: {
            type: 'varchar',
            length: 36,
            nullable: true,
            name: 'reviewer_id',
        },
        reviewedAt: {
            type: 'datetime',
            nullable: true,
            name: 'reviewed_at',
        },
        reviewNote: {
            type: 'text',
            nullable: true,
            name: 'review_note',
        },
        hcmSyncStatus: {
            type: 'varchar',
            length: 20,
            default: 'NOT_SYNCED',
            name: 'hcm_sync_status',
        },
        hcmSyncAttempts: {
            type: 'int',
            default: 0,
            name: 'hcm_sync_attempts',
        },
        hcmLastError: {
            type: 'text',
            nullable: true,
            name: 'hcm_last_error',
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
            name: 'IDX_request_employee',
            columns: ['employeeId'],
        },
        {
            name: 'IDX_request_status',
            columns: ['status'],
        },
        {
            name: 'IDX_request_dates',
            columns: ['startDate', 'endDate'],
        },
        {
            name: 'IDX_request_hcm_sync',
            columns: ['hcmSyncStatus'],
        },
        {
            name: 'IDX_request_employee_dates',
            columns: ['employeeId', 'startDate', 'endDate'],
        },
    ],
});

module.exports = { LeaveRequest };
