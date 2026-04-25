const {
    Controller,
    Get,
    Param,
    Query,
    Inject,
    NotFoundException,
} = require('@nestjs/common');
const { BalanceService } = require('./balance.service');

/**
 * BalanceController — REST endpoints for leave balance queries.
 * API prefix: /api/v1/balance
 *
 * Balances are per-employee per-location per-leave-type.
 * Pass ?locationId=X to filter by location.
 */
class BalanceController {
    constructor(balanceService) {
        this.balanceService = balanceService;
    }

    async getBalances(employeeId, locationId) {
        return this.balanceService.getBalances(employeeId, locationId || undefined);
    }

    async getBalance(employeeId, leaveType, locationId) {
        if (!locationId) {
            throw new NotFoundException({
                errorCode: 'LOCATION_REQUIRED',
                message: 'locationId query parameter is required when fetching a specific balance',
            });
        }
        const balance = await this.balanceService.getBalance(employeeId, leaveType, locationId);
        if (!balance) {
            throw new NotFoundException({
                errorCode: 'BALANCE_NOT_FOUND',
                message: `No ${leaveType} balance found for employee ${employeeId} at location ${locationId}`,
            });
        }
        return balance;
    }
}

Reflect.decorate([Controller('api/v1/balance')], BalanceController);

// Constructor injection
Inject(BalanceService)(BalanceController, undefined, 0);

// getBalances(employeeId, locationId?) — GET /:employeeId?locationId=X
Reflect.decorate(
    [Get(':employeeId')],
    BalanceController.prototype,
    'getBalances',
    Object.getOwnPropertyDescriptor(BalanceController.prototype, 'getBalances'),
);
Param('employeeId')(BalanceController.prototype, 'getBalances', 0);
Query('locationId')(BalanceController.prototype, 'getBalances', 1);

// getBalance(employeeId, leaveType, locationId) — GET /:employeeId/:leaveType?locationId=X
Reflect.decorate(
    [Get(':employeeId/:leaveType')],
    BalanceController.prototype,
    'getBalance',
    Object.getOwnPropertyDescriptor(BalanceController.prototype, 'getBalance'),
);
Param('employeeId')(BalanceController.prototype, 'getBalance', 0);
Param('leaveType')(BalanceController.prototype, 'getBalance', 1);
Query('locationId')(BalanceController.prototype, 'getBalance', 2);

module.exports = { BalanceController };
