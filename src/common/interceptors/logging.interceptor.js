const { Injectable, Logger } = require('@nestjs/common');
const { tap } = require('rxjs/operators');

/**
 * Logs incoming requests and outgoing responses with timing information.
 * Essential for observability in production environments.
 * 
 * Logs format:
 *   [Incoming] GET /api/v1/balance/abc-123
 *   [Completed] GET /api/v1/balance/abc-123 — 45ms
 */
let LoggingInterceptor = class LoggingInterceptor {
    constructor() {
        this.logger = new Logger('HTTP');
    }

    intercept(context, next) {
        const request = context.switchToHttp().getRequest();
        const { method, url, body } = request;
        const requestId = request.headers['x-request-id'] || 'N/A';
        const startTime = Date.now();

        this.logger.log(
            `[Incoming] ${method} ${url} | ReqID: ${requestId}`,
        );

        // Log request body for mutation operations (but redact sensitive fields)
        if (['POST', 'PUT', 'PATCH'].includes(method) && body) {
            const sanitized = { ...body };
            delete sanitized.password;
            delete sanitized.token;
            this.logger.debug(`[Body] ${JSON.stringify(sanitized)}`);
        }

        return next.handle().pipe(
            tap({
                next: () => {
                    const elapsed = Date.now() - startTime;
                    this.logger.log(
                        `[Completed] ${method} ${url} — ${elapsed}ms | ReqID: ${requestId}`,
                    );
                },
                error: (error) => {
                    const elapsed = Date.now() - startTime;
                    this.logger.error(
                        `[Failed] ${method} ${url} — ${elapsed}ms | Error: ${error.message} | ReqID: ${requestId}`,
                    );
                },
            }),
        );
    }
};

Reflect.decorate([Injectable()], LoggingInterceptor);

module.exports = { LoggingInterceptor };
