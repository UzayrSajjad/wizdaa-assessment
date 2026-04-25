const { Catch, HttpException, HttpStatus } = require('@nestjs/common');

/**
 * Global exception filter that normalizes all error responses into a
 * consistent JSON envelope. Handles both NestJS HttpExceptions and
 * unexpected errors, ensuring no stack traces leak in production.
 */
let AllExceptionsFilter = class AllExceptionsFilter {
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';
        let errorCode = 'INTERNAL_ERROR';
        let details = null;

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            if (typeof exceptionResponse === 'string') {
                message = exceptionResponse;
            } else if (typeof exceptionResponse === 'object') {
                message = exceptionResponse.message || message;
                errorCode = exceptionResponse.errorCode || this._statusToErrorCode(status);
                details = exceptionResponse.details || null;

                // Handle class-validator errors (array of messages)
                if (Array.isArray(message)) {
                    details = message;
                    message = 'Validation failed';
                    errorCode = 'VALIDATION_ERROR';
                }
            }
        } else {
            // Unexpected errors — log full details server-side, return generic message to client
            console.error('[UnhandledException]', {
                timestamp: new Date().toISOString(),
                path: request.url,
                method: request.method,
                error: exception?.message || 'Unknown error',
                stack: exception?.stack,
            });
        }

        const errorResponse = {
            success: false,
            error: {
                code: errorCode,
                message,
                ...(details && { details }),
            },
            meta: {
                timestamp: new Date().toISOString(),
                path: request.url,
                method: request.method,
                requestId: request.headers['x-request-id'] || null,
            },
        };

        response.status(status).json(errorResponse);
    }

    /**
     * Maps HTTP status codes to semantic error codes.
     */
    _statusToErrorCode(status) {
        const map = {
            [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
            [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
            [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
            [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
            [HttpStatus.CONFLICT]: 'CONFLICT',
            [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
            [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
            [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
        };
        return map[status] || 'INTERNAL_ERROR';
    }
};

Reflect.decorate([Catch()], AllExceptionsFilter);

module.exports = { AllExceptionsFilter };
