const {
    Controller,
    Get,
    Post,
    Param,
    Body,
    Query,
    Req,
    HttpCode,
    HttpStatus,
    Inject,
} = require('@nestjs/common');
const { LeaveRequestService } = require('./leave-request.service');

/**
 * LeaveRequestController — REST endpoints for leave request management.
 * API prefix: /api/v1/leave-request
 */
class LeaveRequestController {
    constructor(leaveRequestService) {
        this.leaveRequestService = leaveRequestService;
    }

    async create(body, req) {
        const idempotencyKey = req?.headers?.['x-idempotency-key'] || req?.idempotencyKey || null;
        return this.leaveRequestService.create(body, idempotencyKey);
    }

    async findById(id) {
        return this.leaveRequestService.findById(id);
    }

    async findByEmployee(employeeId, status) {
        return this.leaveRequestService.findByEmployee(employeeId, status);
    }

    async approve(id, body) {
        return this.leaveRequestService.approve(id, body);
    }

    async reject(id, body) {
        return this.leaveRequestService.reject(id, body);
    }

    async cancel(id) {
        return this.leaveRequestService.cancel(id);
    }
}

Reflect.decorate([Controller('api/v1/leave-request')], LeaveRequestController);

// Constructor injection
Inject(LeaveRequestService)(LeaveRequestController, undefined, 0);

// create(body, req) — POST /
Reflect.decorate(
    [Post(), HttpCode(HttpStatus.CREATED)],
    LeaveRequestController.prototype,
    'create',
    Object.getOwnPropertyDescriptor(LeaveRequestController.prototype, 'create'),
);
Body()(LeaveRequestController.prototype, 'create', 0);
Req()(LeaveRequestController.prototype, 'create', 1);

// findById(id) — GET /:id
Reflect.decorate(
    [Get(':id')],
    LeaveRequestController.prototype,
    'findById',
    Object.getOwnPropertyDescriptor(LeaveRequestController.prototype, 'findById'),
);
Param('id')(LeaveRequestController.prototype, 'findById', 0);

// findByEmployee(employeeId, status) — GET /employee/:employeeId
Reflect.decorate(
    [Get('employee/:employeeId')],
    LeaveRequestController.prototype,
    'findByEmployee',
    Object.getOwnPropertyDescriptor(LeaveRequestController.prototype, 'findByEmployee'),
);
Param('employeeId')(LeaveRequestController.prototype, 'findByEmployee', 0);
Query('status')(LeaveRequestController.prototype, 'findByEmployee', 1);

// approve(id, body) — POST /:id/approve
Reflect.decorate(
    [Post(':id/approve')],
    LeaveRequestController.prototype,
    'approve',
    Object.getOwnPropertyDescriptor(LeaveRequestController.prototype, 'approve'),
);
Param('id')(LeaveRequestController.prototype, 'approve', 0);
Body()(LeaveRequestController.prototype, 'approve', 1);

// reject(id, body) — POST /:id/reject
Reflect.decorate(
    [Post(':id/reject')],
    LeaveRequestController.prototype,
    'reject',
    Object.getOwnPropertyDescriptor(LeaveRequestController.prototype, 'reject'),
);
Param('id')(LeaveRequestController.prototype, 'reject', 0);
Body()(LeaveRequestController.prototype, 'reject', 1);

// cancel(id) — POST /:id/cancel
Reflect.decorate(
    [Post(':id/cancel'), HttpCode(HttpStatus.OK)],
    LeaveRequestController.prototype,
    'cancel',
    Object.getOwnPropertyDescriptor(LeaveRequestController.prototype, 'cancel'),
);
Param('id')(LeaveRequestController.prototype, 'cancel', 0);

module.exports = { LeaveRequestController };
