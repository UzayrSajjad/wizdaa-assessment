/**
 * @fileoverview Unit tests for retry utility.
 */

const { retryWithBackoff, isRetryableError } = require('../../src/common/utils/retry.utils');

describe('Retry Utilities', () => {
    describe('retryWithBackoff', () => {
        it('should return result on first success', async () => {
            const fn = jest.fn().mockResolvedValue('success');

            const result = await retryWithBackoff(fn, {
                maxRetries: 3,
                baseDelayMs: 10,
                operationName: 'test',
            });

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure and eventually succeed', async () => {
            const fn = jest.fn()
                .mockRejectedValueOnce(new Error('fail1'))
                .mockRejectedValueOnce(new Error('fail2'))
                .mockResolvedValue('success');

            const result = await retryWithBackoff(fn, {
                maxRetries: 3,
                baseDelayMs: 10,
                operationName: 'test',
            });

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should throw after exhausting retries', async () => {
            const fn = jest.fn().mockRejectedValue(new Error('persistent failure'));

            await expect(
                retryWithBackoff(fn, {
                    maxRetries: 2,
                    baseDelayMs: 10,
                    operationName: 'test',
                }),
            ).rejects.toThrow('persistent failure');

            expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
        });

        it('should not retry when shouldRetry returns false', async () => {
            const fn = jest.fn().mockRejectedValue(new Error('client error'));

            await expect(
                retryWithBackoff(fn, {
                    maxRetries: 3,
                    baseDelayMs: 10,
                    shouldRetry: () => false,
                    operationName: 'test',
                }),
            ).rejects.toThrow('client error');

            expect(fn).toHaveBeenCalledTimes(1);
        });
    });

    describe('isRetryableError', () => {
        it('should retry on network errors (no response)', () => {
            expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
        });

        it('should retry on 500 errors', () => {
            const error = { response: { status: 500 } };
            expect(isRetryableError(error)).toBe(true);
        });

        it('should retry on 503 errors', () => {
            const error = { response: { status: 503 } };
            expect(isRetryableError(error)).toBe(true);
        });

        it('should retry on 429 errors', () => {
            const error = { response: { status: 429 } };
            expect(isRetryableError(error)).toBe(true);
        });

        it('should NOT retry on 400 errors', () => {
            const error = { response: { status: 400 } };
            expect(isRetryableError(error)).toBe(false);
        });

        it('should NOT retry on 404 errors', () => {
            const error = { response: { status: 404 } };
            expect(isRetryableError(error)).toBe(false);
        });
    });
});
