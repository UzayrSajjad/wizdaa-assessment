const {
    Controller,
    Get,
    Post,
    Put,
    Param,
    Body,
    Query,
    HttpCode,
    HttpStatus,
    Inject,
} = require('@nestjs/common');
const { EmployeeService } = require('./employee.service');

/**
 * EmployeeController — REST endpoints for employee management.
 * API prefix: /api/v1/employees
 */
class EmployeeController {
    constructor(employeeService) {
        this.employeeService = employeeService;
    }

    async createEmployee(body) {
        return this.employeeService.create(body);
    }

    async listEmployees(locationCode) {
        return this.employeeService.findAll(locationCode);
    }

    async getEmployee(id) {
        return this.employeeService.findById(id);
    }

    async updateEmployee(id, body) {
        return this.employeeService.update(id, body);
    }
}

// Class decorator
Reflect.decorate([Controller('api/v1/employees')], EmployeeController);

// Constructor injection
Inject(EmployeeService)(EmployeeController, undefined, 0);

// createEmployee(body) — POST /
Reflect.decorate(
    [Post(), HttpCode(HttpStatus.CREATED)],
    EmployeeController.prototype,
    'createEmployee',
    Object.getOwnPropertyDescriptor(EmployeeController.prototype, 'createEmployee'),
);
Body()(EmployeeController.prototype, 'createEmployee', 0);

// listEmployees(locationCode) — GET /
Reflect.decorate(
    [Get()],
    EmployeeController.prototype,
    'listEmployees',
    Object.getOwnPropertyDescriptor(EmployeeController.prototype, 'listEmployees'),
);
Query('locationCode')(EmployeeController.prototype, 'listEmployees', 0);

// getEmployee(id) — GET /:id
Reflect.decorate(
    [Get(':id')],
    EmployeeController.prototype,
    'getEmployee',
    Object.getOwnPropertyDescriptor(EmployeeController.prototype, 'getEmployee'),
);
Param('id')(EmployeeController.prototype, 'getEmployee', 0);

// updateEmployee(id, body) — PUT /:id
Reflect.decorate(
    [Put(':id')],
    EmployeeController.prototype,
    'updateEmployee',
    Object.getOwnPropertyDescriptor(EmployeeController.prototype, 'updateEmployee'),
);
Param('id')(EmployeeController.prototype, 'updateEmployee', 0);
Body()(EmployeeController.prototype, 'updateEmployee', 1);

module.exports = { EmployeeController };
