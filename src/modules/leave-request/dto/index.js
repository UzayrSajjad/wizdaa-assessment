class CreateLeaveRequestDto {
    /** @type {string} Employee UUID */
    employeeId;
    /** @type {string} Leave type enum value */
    leaveType;
    /** @type {string} ISO date YYYY-MM-DD */
    startDate;
    /** @type {string} ISO date YYYY-MM-DD */
    endDate;
    /** @type {string|undefined} Reason for leave */
    reason;
}

class ApproveLeaveRequestDto {
    /** @type {string} Reviewer/approver UUID */
    reviewerId;
    /** @type {string|undefined} Optional note */
    reviewNote;
}

class RejectLeaveRequestDto {
    /** @type {string} Reviewer UUID */
    reviewerId;
    /** @type {string} Reason for rejection */
    reviewNote;
}

module.exports = { CreateLeaveRequestDto, ApproveLeaveRequestDto, RejectLeaveRequestDto };
