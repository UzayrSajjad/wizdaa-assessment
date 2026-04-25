const { EntitySchema } = require('typeorm');

/**
 * Employee entity — represents an employee in the system.
 * Maps to the HCM system via externalHcmId for cross-system reference.
 *
 * Design notes:
 *   - externalHcmId is nullable because employees can be created locally
 *     before HCM linkage is established
 *   - locationCode drives locale-specific leave policies
 *   - isActive soft-deletes employees without losing historical data
 */
const Employee = new EntitySchema({
    name: 'Employee',
    tableName: 'employees',
    columns: {
        id: {
            type: 'varchar',
            primary: true,
            length: 36,
        },
        externalHcmId: {
            type: 'varchar',
            length: 100,
            nullable: true,
            unique: true,
            name: 'external_hcm_id',
        },
        email: {
            type: 'varchar',
            length: 255,
            unique: true,
        },
        firstName: {
            type: 'varchar',
            length: 100,
            name: 'first_name',
        },
        lastName: {
            type: 'varchar',
            length: 100,
            name: 'last_name',
        },
        department: {
            type: 'varchar',
            length: 100,
            nullable: true,
        },
        locationCode: {
            type: 'varchar',
            length: 10,
            name: 'location_code',
            default: 'US',
        },
        isActive: {
            type: 'boolean',
            default: true,
            name: 'is_active',
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
        balances: {
            type: 'one-to-many',
            target: 'LeaveBalance',
            inverseSide: 'employee',
        },
        leaveRequests: {
            type: 'one-to-many',
            target: 'LeaveRequest',
            inverseSide: 'employee',
        },
    },
    indices: [
        {
            name: 'IDX_employee_email',
            columns: ['email'],
        },
        {
            name: 'IDX_employee_hcm_id',
            columns: ['externalHcmId'],
        },
        {
            name: 'IDX_employee_location',
            columns: ['locationCode'],
        },
    ],
});

module.exports = { Employee };
