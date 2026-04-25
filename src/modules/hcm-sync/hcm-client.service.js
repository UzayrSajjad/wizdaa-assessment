const { Injectable, Logger } = require('@nestjs/common');
const axios = require('axios');
const { retryWithBackoff, isRetryableError } = require('../../common/utils/retry.utils');

/**
 * HcmClientService — HTTP client for the external HCM system.
 *
 * This is the ONLY service that makes direct HTTP calls to HCM.
 * All calls go through retryWithBackoff for resilience.
 *
 * Design principles:
 *   - Single Responsibility: only handles HTTP communication
 *   - Defensive: assumes HCM is unreliable (timeouts, 500s, malformed responses)
 *   - Observable: logs all interactions for debugging
 *   - Configurable: timeouts, retries via environment variables
 */
let HcmClientService = class HcmClientService {
    constructor() {
        this.logger = new Logger('HcmClientService');
        this.baseUrl = process.env.HCM_BASE_URL || 'http://localhost:4000/api/hcm';
        this.apiKey = process.env.HCM_API_KEY || '';
        this.timeoutMs = parseInt(process.env.HCM_TIMEOUT_MS || '5000', 10);
        this.maxRetries = parseInt(process.env.HCM_MAX_RETRIES || '3', 10);
        this.baseDelayMs = parseInt(process.env.HCM_RETRY_DELAY_MS || '1000', 10);

        this.httpClient = axios.create({
            baseURL: this.baseUrl,
            timeout: this.timeoutMs,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.apiKey,
            },
        });
    }

    /**
     * Notifies HCM of a leave deduction (when a request is approved).
     *
     * @param {Object} params
     * @param {string} params.employeeHcmId - External HCM employee ID
     * @param {string} params.leaveType
     * @param {number} params.days
     * @param {string} params.startDate
     * @param {string} params.endDate
     * @param {string} params.requestId - Internal request ID for reference
     * @returns {Promise<Object>} HCM response
     */
    async deductBalance(params) {
        return retryWithBackoff(
            async () => {
                this.logger.log(`[deductBalance] Sending to HCM: ${JSON.stringify(params)}`);

                const response = await this.httpClient.post('/balance/deduct', {
                    employeeId: params.employeeHcmId,
                    leaveType: params.leaveType,
                    days: params.days,
                    startDate: params.startDate,
                    endDate: params.endDate,
                    referenceId: params.requestId,
                });

                this._validateResponse(response, 'deductBalance');
                return response.data;
            },
            {
                maxRetries: this.maxRetries,
                baseDelayMs: this.baseDelayMs,
                shouldRetry: isRetryableError,
                operationName: 'HCM.deductBalance',
            },
        );
    }

    /**
     * Fetches current balance for a single employee from HCM.
     *
     * @param {string} employeeHcmId
     * @returns {Promise<Object>} { balances: [{ leaveType, totalDays, usedDays }] }
     */
    async getEmployeeBalance(employeeHcmId) {
        return retryWithBackoff(
            async () => {
                this.logger.log(`[getEmployeeBalance] Fetching from HCM: ${employeeHcmId}`);

                const response = await this.httpClient.get(
                    `/balance/${encodeURIComponent(employeeHcmId)}`,
                );

                this._validateResponse(response, 'getEmployeeBalance');
                return response.data;
            },
            {
                maxRetries: this.maxRetries,
                baseDelayMs: this.baseDelayMs,
                shouldRetry: isRetryableError,
                operationName: 'HCM.getEmployeeBalance',
            },
        );
    }

    /**
     * Fetches balances for all employees from HCM (batch operation).
     *
     * @returns {Promise<Object>} { employees: [{ hcmId, balances: [...] }] }
     */
    async getBatchBalances() {
        return retryWithBackoff(
            async () => {
                this.logger.log('[getBatchBalances] Fetching all balances from HCM');

                const response = await this.httpClient.get('/balance/batch');

                this._validateResponse(response, 'getBatchBalances');
                return response.data;
            },
            {
                maxRetries: this.maxRetries,
                baseDelayMs: this.baseDelayMs,
                shouldRetry: isRetryableError,
                operationName: 'HCM.getBatchBalances',
            },
        );
    }

    /**
     * Validates HCM response structure.
     * HCM is known to sometimes return success status codes with error bodies.
     * @private
     */
    _validateResponse(response, operationName) {
        if (!response.data) {
            throw new Error(`[${operationName}] HCM returned empty response body`);
        }

        if (response.data.error) {
            throw new Error(
                `[${operationName}] HCM returned error in body: ${JSON.stringify(response.data.error)}`,
            );
        }
    }
};

Reflect.decorate([Injectable()], HcmClientService);

module.exports = { HcmClientService };
