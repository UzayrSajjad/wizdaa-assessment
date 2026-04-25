const { Module, MiddlewareConsumer, NestModule } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { getDatabaseConfig } = require('./config/database.config');
const { EmployeeModule } = require('./modules/employee/employee.module');
const { BalanceModule } = require('./modules/balance/balance.module');
const { LeaveRequestModule } = require('./modules/leave-request/leave-request.module');
const { HcmSyncModule } = require('./modules/hcm-sync/hcm-sync.module');
const { IdempotencyMiddleware } = require('./common/middleware/idempotency.middleware');

/**
 * AppModule — root module that composes the entire application.
 *
 * Module registration order matters for dependency resolution:
 *   1. ConfigModule — makes env vars available globally
 *   2. TypeOrmModule — database connection
 *   3. Feature modules
 */
class AppModule {
    configure(consumer) {
        // Apply idempotency middleware to all POST endpoints
        consumer
            .apply(IdempotencyMiddleware)
            .forRoutes({ path: '*', method: 'POST' });
    }
}

Reflect.decorate(
    [
        Module({
            imports: [
                ConfigModule.forRoot({
                    isGlobal: true,
                    envFilePath: '.env',
                }),
                TypeOrmModule.forRoot(getDatabaseConfig()),
                EmployeeModule,
                BalanceModule,
                LeaveRequestModule,
                HcmSyncModule,
            ],
        }),
    ],
    AppModule,
);

module.exports = { AppModule };
