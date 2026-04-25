const { Injectable, CanActivate, UnauthorizedException } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const { Reflector } = require('@nestjs/core');

const PUBLIC_KEY = 'isPublic';

/**
 * Custom decorator to mark routes as public (bypass API key check).
 * Usage: @SetMetadata(PUBLIC_KEY, true) on controller method
 */
const SetPublic = () => {
    const { SetMetadata } = require('@nestjs/common');
    return SetMetadata(PUBLIC_KEY, true);
};

/**
 * Guard that validates the X-API-Key header against the configured API key.
 * Routes decorated with @SetPublic() bypass this check.
 *
 * In production, this would be replaced by OAuth2/JWT but API key auth
 * is appropriate for service-to-service communication in a microservice context.
 */
let ApiKeyGuard = class ApiKeyGuard {
    constructor(configService, reflector) {
        this.configService = configService;
        this.reflector = reflector;
    }

    canActivate(context) {
        // Check if route is marked as public
        const isPublic = this.reflector.getAllAndOverride(PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (isPublic) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const apiKey = request.headers['x-api-key'];
        const validKey = this.configService.get('API_KEY');

        if (!validKey) {
            // If no API key is configured, allow all requests (dev mode)
            return true;
        }

        if (!apiKey) {
            throw new UnauthorizedException({
                errorCode: 'MISSING_API_KEY',
                message: 'X-API-Key header is required',
            });
        }

        if (apiKey !== validKey) {
            throw new UnauthorizedException({
                errorCode: 'INVALID_API_KEY',
                message: 'Invalid API key',
            });
        }

        return true;
    }
};

Reflect.decorate([Injectable()], ApiKeyGuard);

module.exports = { ApiKeyGuard, SetPublic, PUBLIC_KEY };
