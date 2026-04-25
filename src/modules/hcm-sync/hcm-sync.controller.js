const {
    Controller,
    Get,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    Query,
    Inject,
} = require('@nestjs/common');
const { HcmSyncService } = require('./hcm-sync.service');

/**
 * HcmSyncController — REST endpoints for HCM synchronization operations.
 * API prefix: /api/v1/hcm
 */
class HcmSyncController {
    constructor(hcmSyncService) {
        this.hcmSyncService = hcmSyncService;
    }

    async syncSingle(body) {
        return this.hcmSyncService.syncSingle(body.employeeId);
    }

    async syncBatch(body) {
        return this.hcmSyncService.syncBatch({
            locationCode: body?.locationCode,
            forceOverwrite: body?.forceOverwrite !== false,
        });
    }

    async getSyncLogs(limit) {
        return this.hcmSyncService.getRecentLogs(parseInt(limit, 10) || 20);
    }
}

Reflect.decorate([Controller('api/v1/hcm')], HcmSyncController);

// Constructor injection
Inject(HcmSyncService)(HcmSyncController, undefined, 0);

// syncSingle(body) — POST /sync/single
Reflect.decorate(
    [Post('sync/single'), HttpCode(HttpStatus.OK)],
    HcmSyncController.prototype,
    'syncSingle',
    Object.getOwnPropertyDescriptor(HcmSyncController.prototype, 'syncSingle'),
);
Body()(HcmSyncController.prototype, 'syncSingle', 0);

// syncBatch(body) — POST /sync/batch
Reflect.decorate(
    [Post('sync/batch'), HttpCode(HttpStatus.OK)],
    HcmSyncController.prototype,
    'syncBatch',
    Object.getOwnPropertyDescriptor(HcmSyncController.prototype, 'syncBatch'),
);
Body()(HcmSyncController.prototype, 'syncBatch', 0);

// getSyncLogs(limit) — GET /sync/logs
Reflect.decorate(
    [Get('sync/logs')],
    HcmSyncController.prototype,
    'getSyncLogs',
    Object.getOwnPropertyDescriptor(HcmSyncController.prototype, 'getSyncLogs'),
);
Query('limit')(HcmSyncController.prototype, 'getSyncLogs', 0);

module.exports = { HcmSyncController };
