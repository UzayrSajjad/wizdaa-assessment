/**
 * @fileoverview Unit tests for date utility functions.
 */

const {
    calculateBusinessDays,
    validateDateRange,
    normalizeDate,
} = require('../../src/common/utils/date.utils');

describe('Date Utilities', () => {
    describe('calculateBusinessDays', () => {
        it('should count only weekdays', () => {
            // Mon Jun 2 to Fri Jun 6, 2025 → 5 business days
            expect(calculateBusinessDays('2025-06-02', '2025-06-06')).toBe(5);
        });

        it('should exclude weekends', () => {
            // Mon Jun 2 to Sun Jun 8, 2025 → 5 business days (Mon-Fri)
            expect(calculateBusinessDays('2025-06-02', '2025-06-08')).toBe(5);
        });

        it('should handle single day (weekday)', () => {
            expect(calculateBusinessDays('2025-06-02', '2025-06-02')).toBe(1);
        });

        it('should handle single day (weekend)', () => {
            // Saturday
            expect(calculateBusinessDays('2025-06-07', '2025-06-07')).toBe(0);
        });

        it('should return 0 when start > end', () => {
            expect(calculateBusinessDays('2025-06-06', '2025-06-02')).toBe(0);
        });

        it('should handle two-week span', () => {
            // Mon Jun 2 to Fri Jun 13 → 10 business days
            expect(calculateBusinessDays('2025-06-02', '2025-06-13')).toBe(10);
        });
    });

    describe('validateDateRange', () => {
        it('should accept valid future date range', () => {
            const result = validateDateRange('2027-06-01', '2027-06-05');
            expect(result.valid).toBe(true);
        });

        it('should reject end date before start date', () => {
            const result = validateDateRange('2027-06-05', '2027-06-01');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('on or after');
        });

        it('should reject dates exceeding max days', () => {
            const result = validateDateRange('2027-06-01', '2027-08-01', 30);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('exceeds maximum');
        });

        it('should reject invalid date format', () => {
            const result = validateDateRange('not-a-date', '2027-06-05');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid date');
        });
    });

    describe('normalizeDate', () => {
        it('should normalize date to YYYY-MM-DD format', () => {
            expect(normalizeDate('2025-06-15T14:30:00Z')).toBe('2025-06-15');
        });

        it('should handle Date objects', () => {
            const date = new Date('2025-06-15');
            expect(normalizeDate(date)).toBe('2025-06-15');
        });
    });
});
