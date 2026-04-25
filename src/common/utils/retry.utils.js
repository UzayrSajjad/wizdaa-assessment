/**
 * @fileoverview Generic retry utility with exponential backoff.
 * Used primarily for HCM API calls but designed to be reusable.
 */

const { Logger } = require('@nestjs/common');

const logger = new Logger('RetryUtil');

/**
 * Executes an async function with retry and exponential backoff.
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} options.baseDelayMs - Base delay in ms (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay cap in ms (default: 10000)
 * @param {Function} options.shouldRetry - Predicate to determine if error is retryable
 * @param {string} options.operationName - Name for logging
 * @returns {Promise<*>} Result of the function
 * @throws {Error} Last error if all retries exhausted
 */
async function retryWithBackoff(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        maxDelayMs = 10000,
        shouldRetry = () => true,
        operationName = 'operation',
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            const result = await fn();
            if (attempt > 1) {
                logger.log(
                    `[${operationName}] Succeeded on attempt ${attempt}/${maxRetries + 1}`,
                );
            }
            return result;
        } catch (error) {
            lastError = error;

            if (attempt > maxRetries || !shouldRetry(error)) {
                logger.error(
                    `[${operationName}] Failed permanently after ${attempt} attempt(s): ${error.message}`,
                );
                throw error;
            }

            // Exponential backoff with jitter
            const delay = Math.min(
                baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500,
                maxDelayMs,
            );

            logger.warn(
                `[${operationName}] Attempt ${attempt}/${maxRetries + 1} failed: ${error.message}. ` +
                `Retrying in ${Math.round(delay)}ms...`,
            );

            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * Determines if an HTTP error is retryable (network errors, 5xx, 429).
 * 4xx errors (except 429) are NOT retried since they indicate client errors.
 *
 * @param {Error} error
 * @returns {boolean}
 */
function isRetryableError(error) {
    // Network errors (no response received)
    if (!error.response) {
        return true;
    }

    const status = error.response?.status;

    // 429 Too Many Requests — retry after backoff
    if (status === 429) {
        return true;
    }

    // 5xx Server Errors — transient, retry
    if (status >= 500) {
        return true;
    }

    // 4xx Client Errors — not retryable (except 429 above)
    return false;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    retryWithBackoff,
    isRetryableError,
    sleep,
};
