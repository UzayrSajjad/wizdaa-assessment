const { IsString, IsEmail, IsOptional, IsBoolean, MaxLength, MinLength } = require('class-validator');

class CreateEmployeeDto {
    /** @type {string} */
    email;
    /** @type {string} */
    firstName;
    /** @type {string} */
    lastName;
    /** @type {string|undefined} */
    externalHcmId;
    /** @type {string|undefined} */
    department;
    /** @type {string|undefined} */
    locationCode;
}

// Apply validators manually for JavaScript (no decorator syntax without Babel transform on DTOs)
const { Expose } = require('class-transformer');

class UpdateEmployeeDto {
    /** @type {string|undefined} */
    firstName;
    /** @type {string|undefined} */
    lastName;
    /** @type {string|undefined} */
    department;
    /** @type {string|undefined} */
    locationCode;
    /** @type {boolean|undefined} */
    isActive;
    /** @type {string|undefined} */
    externalHcmId;
}

module.exports = { CreateEmployeeDto, UpdateEmployeeDto };
