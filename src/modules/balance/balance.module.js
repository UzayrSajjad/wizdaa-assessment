const { Module } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { LeaveBalance } = require('./balance.entity');
const { BalanceService } = require('./balance.service');
const { BalanceController } = require('./balance.controller');

class BalanceModule { }

Reflect.decorate(
    [
        Module({
            imports: [TypeOrmModule.forFeature([LeaveBalance])],
            controllers: [BalanceController],
            providers: [BalanceService],
            exports: [BalanceService],
        }),
    ],
    BalanceModule,
);

module.exports = { BalanceModule };
