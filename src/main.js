require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { Logger } = require('@nestjs/common');
const { AppModule } = require('./app.module');
const { AllExceptionsFilter } = require('./common/filters/http-exception.filter');
const { TransformInterceptor } = require('./common/interceptors/transform.interceptor');
const { LoggingInterceptor } = require('./common/interceptors/logging.interceptor');

async function bootstrap() {
    const logger = new Logger('Bootstrap');
    const port = process.env.PORT || 3000;

    const app = await NestFactory.create(AppModule, {
        logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });

    // Global pipes, filters, and interceptors
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(
        new LoggingInterceptor(),
        new TransformInterceptor(),
    );

    // Enable CORS for development
    app.enableCors({
        origin: process.env.CORS_ORIGIN || '*',
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        allowedHeaders: 'Content-Type,Authorization,X-API-Key,X-Idempotency-Key,X-Request-Id',
    });

    // Graceful shutdown
    app.enableShutdownHooks();

    await app.listen(port);
    logger.log(`🚀 Time-Off Microservice running on http://localhost:${port}`);
    logger.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.log(`💾 Database: ${process.env.DB_PATH || './data/timeoff.sqlite'}`);
    logger.log(`🔗 HCM Base URL: ${process.env.HCM_BASE_URL || 'http://localhost:4000/api/hcm'}`);
}

bootstrap().catch((err) => {
    console.error('❌ Failed to start application:', err);
    process.exit(1);
});
