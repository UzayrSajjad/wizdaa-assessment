const { EntitySchema } = require('typeorm');

/**
 * HcmSyncLog entity — audit trail for all HCM synchronization operations.
 *
 * Every sync attempt (single or batch) creates a log entry.
 * This enables:
 *   - Debugging sync failures
 *   - Auditing data flow between systems
 *   - Monitoring sync health over time
 *   - Detecting systematic HCM issues (consecutive failures)
 */
const HcmSyncLog = new EntitySchema({
    name: 'HcmSyncLog',
    tableName: 'hcm_sync_logs',
    columns: {
        id: {
            type: 'varchar',
            primary: true,
            length: 36,
        },
        syncType: {
            type: 'varchar',
            length: 10,
            name: 'sync_type',
        },
        status: {
            type: 'varchar',
            length: 20,
        },
        direction: {
            type: 'varchar',
            length: 10,
            default: 'INBOUND',
            comment: 'INBOUND = HCM→Local, OUTBOUND = Local→HCM',
        },
        employeeId: {
            type: 'varchar',
            length: 36,
            nullable: true,
            name: 'employee_id',
        },
        employeesAffected: {
            type: 'int',
            default: 0,
            name: 'employees_affected',
        },
        balancesUpdated: {
            type: 'int',
            default: 0,
            name: 'balances_updated',
        },
        errorDetails: {
            type: 'text',
            nullable: true,
            name: 'error_details',
        },
        requestPayload: {
            type: 'text',
            nullable: true,
            name: 'request_payload',
        },
        responsePayload: {
            type: 'text',
            nullable: true,
            name: 'response_payload',
        },
        startedAt: {
            type: 'datetime',
            name: 'started_at',
        },
        completedAt: {
            type: 'datetime',
            nullable: true,
            name: 'completed_at',
        },
    },
    indices: [
        {
            name: 'IDX_sync_log_type_status',
            columns: ['syncType', 'status'],
        },
        {
            name: 'IDX_sync_log_started',
            columns: ['startedAt'],
        },
        {
            name: 'IDX_sync_log_employee',
            columns: ['employeeId'],
        },
    ],
});

module.exports = { HcmSyncLog };
