class SyncSingleDto {
    /** @type {string} Employee UUID to sync */
    employeeId;
}

class SyncBatchDto {
    /** @type {string|undefined} Optional location code filter */
    locationCode;
    /** @type {boolean|undefined} Force overwrite local balances */
    forceOverwrite;
}

module.exports = { SyncSingleDto, SyncBatchDto };
