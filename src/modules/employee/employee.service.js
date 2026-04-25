const {
    Injectable,
    NotFoundException,
    ConflictException,
    Logger,
} = require('@nestjs/common');
const { InjectRepository } = require('@nestjs/typeorm');
const { v4: uuidv4 } = require('uuid');
const { Employee } = require('./employee.entity');

/**
 * EmployeeService — manages employee lifecycle and lookups.
 *
 * Responsibilities:
 *   - CRUD operations for employees
 *   - Lookup by internal ID or external HCM ID
 *   - Employee validation for other services
 */
let EmployeeService = class EmployeeService {
    constructor(employeeRepository) {
        this.employeeRepository = employeeRepository;
        this.logger = new Logger('EmployeeService');
    }

    /**
     * Creates a new employee record.
     * @param {import('./dto').CreateEmployeeDto} dto
     * @returns {Promise<Object>}
     */
    async create(dto) {
        // Check for duplicate email
        const existing = await this.employeeRepository.findOne({
            where: { email: dto.email },
        });
        if (existing) {
            throw new ConflictException({
                errorCode: 'EMPLOYEE_EMAIL_EXISTS',
                message: `Employee with email ${dto.email} already exists`,
            });
        }

        // Check for duplicate HCM ID if provided
        if (dto.externalHcmId) {
            const existingHcm = await this.employeeRepository.findOne({
                where: { externalHcmId: dto.externalHcmId },
            });
            if (existingHcm) {
                throw new ConflictException({
                    errorCode: 'EMPLOYEE_HCM_ID_EXISTS',
                    message: `Employee with HCM ID ${dto.externalHcmId} already exists`,
                });
            }
        }

        const employee = this.employeeRepository.create({
            id: uuidv4(),
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            externalHcmId: dto.externalHcmId || null,
            department: dto.department || null,
            locationCode: dto.locationCode || 'US',
        });

        const saved = await this.employeeRepository.save(employee);
        this.logger.log(`Created employee: ${saved.id} (${saved.email})`);
        return saved;
    }

    /**
     * Finds an employee by internal UUID.
     * @param {string} id
     * @returns {Promise<Object>}
     * @throws {NotFoundException}
     */
    async findById(id) {
        const employee = await this.employeeRepository.findOne({
            where: { id },
        });
        if (!employee) {
            throw new NotFoundException({
                errorCode: 'EMPLOYEE_NOT_FOUND',
                message: `Employee ${id} not found`,
            });
        }
        return employee;
    }

    /**
     * Finds an employee by external HCM system ID.
     * @param {string} hcmId
     * @returns {Promise<Object|null>}
     */
    async findByHcmId(hcmId) {
        return this.employeeRepository.findOne({
            where: { externalHcmId: hcmId },
        });
    }

    /**
     * Returns all active employees, optionally filtered by location.
     * @param {string} [locationCode]
     * @returns {Promise<Object[]>}
     */
    async findAll(locationCode) {
        const where = { isActive: true };
        if (locationCode) {
            where.locationCode = locationCode;
        }
        return this.employeeRepository.find({ where, order: { lastName: 'ASC' } });
    }

    /**
     * Updates an employee record.
     * @param {string} id
     * @param {import('./dto').UpdateEmployeeDto} dto
     * @returns {Promise<Object>}
     */
    async update(id, dto) {
        const employee = await this.findById(id);

        // Only update provided fields
        const updateFields = {};
        if (dto.firstName !== undefined) updateFields.firstName = dto.firstName;
        if (dto.lastName !== undefined) updateFields.lastName = dto.lastName;
        if (dto.department !== undefined) updateFields.department = dto.department;
        if (dto.locationCode !== undefined) updateFields.locationCode = dto.locationCode;
        if (dto.isActive !== undefined) updateFields.isActive = dto.isActive;
        if (dto.externalHcmId !== undefined) updateFields.externalHcmId = dto.externalHcmId;

        Object.assign(employee, updateFields);
        return this.employeeRepository.save(employee);
    }

    /**
     * Validates that an employee exists and is active.
     * Used by other services before processing requests.
     * @param {string} id
     * @returns {Promise<Object>}
     * @throws {NotFoundException}
     */
    async validateActive(id) {
        const employee = await this.findById(id);
        if (!employee.isActive) {
            throw new NotFoundException({
                errorCode: 'EMPLOYEE_INACTIVE',
                message: `Employee ${id} is inactive`,
            });
        }
        return employee;
    }
};

// Manual DI decoration for JavaScript
const { Inject } = require('@nestjs/common');
const { getRepositoryToken } = require('@nestjs/typeorm');

Reflect.decorate([Injectable()], EmployeeService);
Inject(getRepositoryToken(Employee))(EmployeeService, undefined, 0);

module.exports = { EmployeeService };
