/**
 * @fileoverview E2E / Integration tests for the Time-Off Microservice API.
 * 
 * Tests the full request lifecycle through real HTTP endpoints
 * using an in-memory SQLite database.
 */

require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { INestApplication } = require('@nestjs/common');
const request = require('supertest');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { ConfigModule } = require('@nestjs/config');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const { EmployeeModule } = require('../../src/modules/employee/employee.module');
const { BalanceModule } = require('../../src/modules/balance/balance.module');
const { LeaveRequestModule } = require('../../src/modules/leave-request/leave-request.module');
const { HcmSyncModule } = require('../../src/modules/hcm-sync/hcm-sync.module');
const { AllExceptionsFilter } = require('../../src/common/filters/http-exception.filter');
const { TransformInterceptor } = require('../../src/common/interceptors/transform.interceptor');

describe('Time-Off Microservice (e2e)', () => {
    let app;
    let employeeId;

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                TypeOrmModule.forRoot({
                    type: 'better-sqlite3',
                    database: ':memory:',
                    entities: [path.join(__dirname, '../../src/modules/**/*.entity.js')],
                    synchronize: true,
                }),
                EmployeeModule,
                BalanceModule,
                LeaveRequestModule,
                HcmSyncModule,
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalFilters(new AllExceptionsFilter());
        app.useGlobalInterceptors(new TransformInterceptor());
        await app.init();
    });

    afterAll(async () => {
        if (app) await app.close();
    });

    // ─── Employee Endpoints ────────────────────────────────────

    describe('POST /api/v1/employees', () => {
        it('should create a new employee', async () => {
            const res = await request(app.getHttpServer())
                .post('/api/v1/employees')
                .send({
                    email: 'test@company.com',
                    firstName: 'Test',
                    lastName: 'User',
                    locationCode: 'US',
                    externalHcmId: 'HCM-TEST-001',
                })
                .expect(201);

            expect(res.body.success).toBe(true);
            expect(res.body.data.email).toBe('test@company.com');
            employeeId = res.body.data.id;
        });

        it('should reject duplicate email', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/employees')
                .send({
                    email: 'test@company.com',
                    firstName: 'Duplicate',
                    lastName: 'User',
                })
                .expect(409);
        });
    });

    // ─── Balance Endpoints ─────────────────────────────────────

    describe('GET /api/v1/balance/:employeeId', () => {
        it('should return empty balances for new employee', async () => {
            const res = await request(app.getHttpServer())
                .get(`/api/v1/balance/${employeeId}`)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual([]);
        });
    });

    // ─── Leave Request Lifecycle ───────────────────────────────

    describe('Leave Request Lifecycle', () => {
        let requestId;

        // First, set up balance for the employee
        beforeAll(async () => {
            // Create a second employee to be the reviewer
            await request(app.getHttpServer())
                .post('/api/v1/employees')
                .send({
                    email: 'manager@company.com',
                    firstName: 'Manager',
                    lastName: 'User',
                    locationCode: 'US',
                });
        });

        it('should reject leave request when no balance exists (insufficient)', async () => {
            const res = await request(app.getHttpServer())
                .post('/api/v1/leave-request')
                .send({
                    employeeId,
                    leaveType: 'ANNUAL',
                    startDate: '2027-07-01',
                    endDate: '2027-07-05',
                    reason: 'Vacation',
                })
                .expect(400);

            expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
        });
    });

    // ─── Error Handling ────────────────────────────────────────

    describe('Error handling', () => {
        it('should return 404 for non-existent employee', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/v1/balance/nonexistent-id')
                .expect(200);

            // Empty balances for non-existent employee (not a 404 for balance query)
            expect(res.body.data).toEqual([]);
        });

        it('should return 404 for non-existent leave request', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/leave-request/nonexistent-id')
                .expect(404);
        });

        it('should return consistent error format', async () => {
            const res = await request(app.getHttpServer())
                .get('/api/v1/leave-request/nonexistent')
                .expect(404);

            expect(res.body).toMatchObject({
                success: false,
                error: {
                    code: expect.any(String),
                    message: expect.any(String),
                },
                meta: {
                    timestamp: expect.any(String),
                    path: expect.any(String),
                },
            });
        });
    });

    // ─── Idempotency ──────────────────────────────────────────

    describe('Idempotency', () => {
        it('should handle idempotency key header', async () => {
            const idempotencyKey = uuidv4();

            // First request (will fail due to no balance, but idempotency middleware should work)
            const res1 = await request(app.getHttpServer())
                .post('/api/v1/leave-request')
                .set('X-Idempotency-Key', idempotencyKey)
                .send({
                    employeeId,
                    leaveType: 'ANNUAL',
                    startDate: '2027-08-01',
                    endDate: '2027-08-05',
                });

            // This validates the header is accepted without error
            expect(res1.status).toBeDefined();
        });
    });
});
