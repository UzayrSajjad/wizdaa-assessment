/**
 * @fileoverview Utility functions for date manipulation and leave day calculations.
 * Handles business day counting, date range validation, and normalization.
 */

/**
 * Calculates the number of business days (Mon–Fri) between two dates, inclusive.
 * Excludes weekends but does NOT account for public holidays (location-specific
 * holiday calendars would be a separate concern).
 *
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @returns {number} Number of business days
 */
function calculateBusinessDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Normalize to start of day to avoid time zone issues
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    if (start > end) {
        return 0;
    }

    let count = 0;
    const current = new Date(start);

    while (current <= end) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }

    return count;
}

/**
 * Validates that a date range is valid for a leave request.
 * Rules:
 *   - Start date must not be in the past
 *   - End date must be >= start date
 *   - Range must not exceed maxDays (prevents abuse)
 *
 * @param {string} startDate ISO date string
 * @param {string} endDate ISO date string
 * @param {number} maxDays Maximum allowed span
 * @returns {{ valid: boolean, error?: string }}
 */
function validateDateRange(startDate, endDate, maxDays = 30) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { valid: false, error: 'Invalid date format. Use ISO 8601 (YYYY-MM-DD).' };
    }

    if (start < today) {
        return { valid: false, error: 'Start date cannot be in the past.' };
    }

    if (end < start) {
        return { valid: false, error: 'End date must be on or after start date.' };
    }

    const totalDays = calculateBusinessDays(start, end);
    if (totalDays > maxDays) {
        return {
            valid: false,
            error: `Leave request exceeds maximum of ${maxDays} business days. Requested: ${totalDays} days.`,
        };
    }

    if (totalDays === 0) {
        return { valid: false, error: 'Date range contains no business days.' };
    }

    return { valid: true };
}

/**
 * Normalizes a date string to YYYY-MM-DD format (date-only, no time component).
 * @param {string|Date} date
 * @returns {string}
 */
function normalizeDate(date) {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
}

module.exports = {
    calculateBusinessDays,
    validateDateRange,
    normalizeDate,
};
