const { Module } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { HcmSyncLog } = require('./hcm-sync-log.entity');
const { HcmSyncService } = require('./hcm-sync.service');
const { HcmClientService } = require('./hcm-client.service');
const { HcmSyncController } = require('./hcm-sync.controller');
const { BalanceModule } = require('../balance/balance.module');
const { EmployeeModule } = require('../employee/employee.module');

class HcmSyncModule { }

Reflect.decorate(
    [
        Module({
            imports: [
                TypeOrmModule.forFeature([HcmSyncLog]),
                BalanceModule,
                EmployeeModule,
            ],
            controllers: [HcmSyncController],
            providers: [HcmClientService, HcmSyncService],
            exports: [HcmSyncService, HcmClientService],
        }),
    ],
    HcmSyncModule,
);

module.exports = { HcmSyncModule };
