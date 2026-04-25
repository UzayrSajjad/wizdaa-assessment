const { Injectable, CallHandler } = require('@nestjs/common');
const { map } = require('rxjs/operators');

/**
 * Wraps all successful responses in a consistent JSON envelope:
 * {
 *   success: true,
 *   data: <response body>,
 *   meta: { timestamp, path }
 * }
 *
 * This ensures API consumers always receive a predictable response shape
 * regardless of which controller/endpoint they hit.
 */
let TransformInterceptor = class TransformInterceptor {
    intercept(context, next) {
        const request = context.switchToHttp().getRequest();

        return next.handle().pipe(
            map((data) => ({
                success: true,
                data,
                meta: {
                    timestamp: new Date().toISOString(),
                    path: request.url,
                    requestId: request.headers['x-request-id'] || null,
                },
            })),
        );
    }
};

Reflect.decorate([Injectable()], TransformInterceptor);

module.exports = { TransformInterceptor };
