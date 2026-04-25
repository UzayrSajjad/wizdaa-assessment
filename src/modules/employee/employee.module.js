const { Module } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { Employee } = require('./employee.entity');
const { EmployeeService } = require('./employee.service');
const { EmployeeController } = require('./employee.controller');

class EmployeeModule { }

Reflect.decorate(
    [
        Module({
            imports: [TypeOrmModule.forFeature([Employee])],
            controllers: [EmployeeController],
            providers: [EmployeeService],
            exports: [EmployeeService],
        }),
    ],
    EmployeeModule,
);

module.exports = { EmployeeModule };
