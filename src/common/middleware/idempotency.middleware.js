const {
    Injectable,
    NestMiddleware,
    ConflictException,
    Logger,
} = require('@nestjs/common');

/**
 * Idempotency middleware for POST endpoints.
 *
 * Clients include an `X-Idempotency-Key` header. The middleware tracks
 * processed keys in memory (would be Redis in production) and returns
 * cached responses for duplicate requests.
 *
 * This is critical for preventing double-submission of leave requests
 * when clients retry after network timeouts.
 *
 * Design notes:
 *   - In-memory Map is acceptable for single-instance deployments
 *   - Production: replace with Redis + TTL for multi-instance support
 *   - Keys expire after 24 hours to prevent unbounded memory growth
 */
let IdempotencyMiddleware = class IdempotencyMiddleware {
    constructor() {
        this.logger = new Logger('IdempotencyMiddleware');
        /** @type {Map<string, { response: any, timestamp: number }>} */
        this.processedKeys = new Map();

        // Cleanup expired keys every 30 minutes
        this._cleanupInterval = setInterval(() => this._cleanup(), 30 * 60 * 1000);
    }

    use(req, res, next) {
        // Only apply to POST requests
        if (req.method !== 'POST') {
            return next();
        }

        const idempotencyKey = req.headers['x-idempotency-key'];

        // If no key provided, proceed normally (key is optional but recommended)
        if (!idempotencyKey) {
            return next();
        }

        // Check if this key was already processed
        const existing = this.processedKeys.get(idempotencyKey);
        if (existing) {
            this.logger.log(
                `Duplicate request detected for idempotency key: ${idempotencyKey}`,
            );
            return res.status(200).json({
                success: true,
                data: existing.response,
                meta: {
                    timestamp: new Date().toISOString(),
                    path: req.url,
                    idempotent: true,
                    originalTimestamp: new Date(existing.timestamp).toISOString(),
                },
            });
        }

        // Intercept the response to cache it
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            // Only cache successful responses
            if (res.statusCode >= 200 && res.statusCode < 300 && body?.data) {
                this.processedKeys.set(idempotencyKey, {
                    response: body.data,
                    timestamp: Date.now(),
                });
            }
            return originalJson(body);
        };

        // Store the key on the request for use in services (e.g., unique constraint)
        req.idempotencyKey = idempotencyKey;

        next();
    }

    /**
     * Removes keys older than 24 hours.
     */
    _cleanup() {
        const expiryMs = 24 * 60 * 60 * 1000;
        const now = Date.now();
        let cleaned = 0;

        for (const [key, value] of this.processedKeys.entries()) {
            if (now - value.timestamp > expiryMs) {
                this.processedKeys.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.log(`Cleaned up ${cleaned} expired idempotency keys`);
        }
    }
};

Reflect.decorate([Injectable()], IdempotencyMiddleware);

module.exports = { IdempotencyMiddleware };
