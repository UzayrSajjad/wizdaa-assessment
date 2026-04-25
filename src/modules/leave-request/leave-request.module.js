const { Module, forwardRef } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { LeaveRequest } = require('./leave-request.entity');
const { LeaveRequestService } = require('./leave-request.service');
const { LeaveRequestController } = require('./leave-request.controller');
const { BalanceModule } = require('../balance/balance.module');
const { EmployeeModule } = require('../employee/employee.module');
const { HcmSyncModule } = require('../hcm-sync/hcm-sync.module');

/**
 * LeaveRequestModule — depends on Balance, Employee, and HcmSync modules.
 * Uses forwardRef for HcmSync to avoid circular dependency.
 */
class LeaveRequestModule { }

Reflect.decorate(
    [
        Module({
            imports: [
                TypeOrmModule.forFeature([LeaveRequest]),
                BalanceModule,
                EmployeeModule,
                forwardRef(() => HcmSyncModule),
            ],
            controllers: [LeaveRequestController],
            providers: [LeaveRequestService],
            exports: [LeaveRequestService],
        }),
    ],
    LeaveRequestModule,
);

module.exports = { LeaveRequestModule };
