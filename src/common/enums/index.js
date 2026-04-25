/**
 * @fileoverview Shared enums used across the Time-Off Microservice.
 * Centralized to ensure consistency and prevent magic strings.
 */

/**
 * Types of leave available in the system.
 * Maps to HCM leave type codes for integration compatibility.
 */
const LeaveType = Object.freeze({
    ANNUAL: 'ANNUAL',
    SICK: 'SICK',
    PERSONAL: 'PERSONAL',
    MATERNITY: 'MATERNITY',
    PATERNITY: 'PATERNITY',
    UNPAID: 'UNPAID',
    BEREAVEMENT: 'BEREAVEMENT',
});

/**
 * Lifecycle states for a leave request.
 * 
 * State machine:
 *   PENDING → APPROVED
 *   PENDING → REJECTED
 *   PENDING → CANCELLED
 *   APPROVED → CANCELLED (with balance restoration)
 */
const LeaveRequestStatus = Object.freeze({
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    CANCELLED: 'CANCELLED',
});

/**
 * Tracks the synchronization state of a leave request with the external HCM system.
 * 
 * State machine:
 *   NOT_SYNCED → SYNCING → SYNCED
 *   NOT_SYNCED → SYNCING → FAILED → SYNCING → SYNCED (retry)
 */
const HcmSyncStatus = Object.freeze({
    NOT_SYNCED: 'NOT_SYNCED',
    SYNCING: 'SYNCING',
    SYNCED: 'SYNCED',
    FAILED: 'FAILED',
});

/**
 * Types of HCM synchronization operations.
 */
const SyncType = Object.freeze({
    SINGLE: 'SINGLE',
    BATCH: 'BATCH',
});

/**
 * Source that last updated a balance record.
 * Used for audit trail and conflict resolution during batch sync.
 */
const SyncSource = Object.freeze({
    LOCAL: 'LOCAL',
    HCM_REALTIME: 'HCM_REALTIME',
    HCM_BATCH: 'HCM_BATCH',
    MANUAL: 'MANUAL',
});

module.exports = {
    LeaveType,
    LeaveRequestStatus,
    HcmSyncStatus,
    SyncType,
    SyncSource,
};
