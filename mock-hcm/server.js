/**
 * @fileoverview Mock HCM Server
 * 
 * Simulates an external HCM system (like Workday/SAP) for development and testing.
 * 
 * Features:
 *   - Configurable failure rate (HCM_FAILURE_RATE env var, 0-100)
 *   - Configurable response delay (HCM_DELAY_MS env var)
 *   - Realistic response payloads with locationId dimension
 *   - Supports: balance queries, batch queries, deductions
 *
 * Usage:
 *   node mock-hcm/server.js
 *   HCM_FAILURE_RATE=30 HCM_DELAY_MS=2000 node mock-hcm/server.js
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const PORT = process.env.MOCK_HCM_PORT || 4000;
const FAILURE_RATE = parseInt(process.env.HCM_FAILURE_RATE || '20', 10);
const MAX_DELAY_MS = parseInt(process.env.HCM_DELAY_MS || '2000', 10);

// ─── In-Memory Employee Balance Store ───────────────────────────────────────
// Balances are per-employee per-location per-leave-type (matching the assessment requirement)

const employeeBalances = {
    'HCM-EMP-001': {
        name: 'John Doe',
        locationId: 'US',
        balances: [
            { leaveType: 'ANNUAL', locationId: 'US', totalDays: 20, usedDays: 3 },
            { leaveType: 'SICK', locationId: 'US', totalDays: 10, usedDays: 1 },
            { leaveType: 'PERSONAL', locationId: 'US', totalDays: 5, usedDays: 0 },
        ],
    },
    'HCM-EMP-002': {
        name: 'Jane Smith',
        locationId: 'US',
        balances: [
            { leaveType: 'ANNUAL', locationId: 'US', totalDays: 20, usedDays: 5 },
            { leaveType: 'SICK', locationId: 'US', totalDays: 10, usedDays: 2 },
            { leaveType: 'PERSONAL', locationId: 'US', totalDays: 5, usedDays: 1 },
        ],
    },
    'HCM-EMP-003': {
        name: 'Ahmed Khan',
        locationId: 'PK',
        balances: [
            { leaveType: 'ANNUAL', locationId: 'PK', totalDays: 25, usedDays: 7 },
            { leaveType: 'SICK', locationId: 'PK', totalDays: 12, usedDays: 0 },
            { leaveType: 'PERSONAL', locationId: 'PK', totalDays: 5, usedDays: 2 },
        ],
    },
    'HCM-EMP-004': {
        name: 'Lisa Chen',
        locationId: 'SG',
        balances: [
            { leaveType: 'ANNUAL', locationId: 'SG', totalDays: 22, usedDays: 10 },
            { leaveType: 'SICK', locationId: 'SG', totalDays: 10, usedDays: 3 },
            { leaveType: 'PERSONAL', locationId: 'SG', totalDays: 5, usedDays: 1 },
        ],
    },
};

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Simulates network latency and intermittent failures.
 */
async function simulateUnreliability(req, res, next) {
    const requestId = uuidv4().substring(0, 8);
    const startTime = Date.now();

    console.log(`[${requestId}] ${req.method} ${req.url}`);

    // Simulate random delay
    const delay = Math.random() * MAX_DELAY_MS;
    if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Simulate random failures
    if (Math.random() * 100 < FAILURE_RATE) {
        const failureType = Math.random();

        if (failureType < 0.33) {
            // 500 Internal Server Error
            console.log(`[${requestId}] ❌ Simulated 500 error (${Math.round(delay)}ms)`);
            return res.status(500).json({
                error: {
                    code: 'HCM_INTERNAL_ERROR',
                    message: 'Internal server error in HCM system',
                    transactionId: uuidv4(),
                },
            });
        } else if (failureType < 0.66) {
            // 503 Service Unavailable
            console.log(`[${requestId}] ❌ Simulated 503 error (${Math.round(delay)}ms)`);
            return res.status(503).json({
                error: {
                    code: 'HCM_SERVICE_UNAVAILABLE',
                    message: 'HCM system is undergoing maintenance',
                    retryAfter: 30,
                },
            });
        } else {
            // Timeout (close connection)
            console.log(`[${requestId}] ❌ Simulated timeout/connection drop (${Math.round(delay)}ms)`);
            return req.socket.destroy();
        }
    }

    // Attach timing info
    res.on('finish', () => {
        const elapsed = Date.now() - startTime;
        console.log(`[${requestId}] ✅ ${res.statusCode} (${elapsed}ms)`);
    });

    next();
}

app.use('/api/hcm', simulateUnreliability);

// ─── API Endpoints ──────────────────────────────────────────────────────────

/**
 * GET /api/hcm/balance/batch
 * Returns balances for ALL employees (full corpus with location dimension).
 */
app.get('/api/hcm/balance/batch', (req, res) => {
    const employees = Object.entries(employeeBalances).map(([hcmId, data]) => ({
        hcmId,
        name: data.name,
        locationId: data.locationId,
        balances: data.balances.map((b) => ({ ...b })),
    }));

    res.json({
        success: true,
        employees,
        syncTimestamp: new Date().toISOString(),
        totalEmployees: employees.length,
    });
});

/**
 * GET /api/hcm/balance/:employeeId
 * Returns balance for a single employee (real-time API).
 */
app.get('/api/hcm/balance/:employeeId', (req, res) => {
    const { employeeId } = req.params;
    const employee = employeeBalances[employeeId];

    if (!employee) {
        return res.status(404).json({
            error: {
                code: 'EMPLOYEE_NOT_FOUND',
                message: `Employee ${employeeId} not found in HCM system`,
            },
        });
    }

    res.json({
        success: true,
        employeeId,
        name: employee.name,
        locationId: employee.locationId,
        balances: employee.balances.map((b) => ({ ...b })),
        lastUpdated: new Date().toISOString(),
    });
});

/**
 * POST /api/hcm/balance/deduct
 * Deducts leave balance for an employee (outbound sync from ReadyOn).
 */
app.post('/api/hcm/balance/deduct', (req, res) => {
    const { employeeId, leaveType, days, locationId, startDate, endDate, referenceId } = req.body;

    if (!employeeId || !leaveType || !days) {
        return res.status(400).json({
            error: {
                code: 'INVALID_REQUEST',
                message: 'Missing required fields: employeeId, leaveType, days',
            },
        });
    }

    const employee = employeeBalances[employeeId];
    if (!employee) {
        return res.status(404).json({
            error: {
                code: 'EMPLOYEE_NOT_FOUND',
                message: `Employee ${employeeId} not found in HCM system`,
            },
        });
    }

    const balance = employee.balances.find(
        (b) => b.leaveType === leaveType && (!locationId || b.locationId === locationId),
    );
    if (!balance) {
        return res.status(400).json({
            error: {
                code: 'INVALID_LEAVE_TYPE',
                message: `Leave type ${leaveType} not found for employee ${employeeId} at location ${locationId || employee.locationId}`,
            },
        });
    }

    const available = balance.totalDays - balance.usedDays;
    if (available < days) {
        return res.status(400).json({
            error: {
                code: 'INSUFFICIENT_BALANCE',
                message: `Insufficient balance. Available: ${available}, Requested: ${days}`,
            },
        });
    }

    // Apply the deduction
    balance.usedDays += days;

    res.json({
        success: true,
        transactionId: uuidv4(),
        employeeId,
        leaveType,
        locationId: locationId || employee.locationId,
        daysDeducted: days,
        remainingBalance: balance.totalDays - balance.usedDays,
        referenceId,
        processedAt: new Date().toISOString(),
    });
});

/**
 * POST /api/hcm/balance/refresh
 * Simulates a work anniversary or yearly refresh (balance increase).
 * Used for testing balance reconciliation scenarios.
 */
app.post('/api/hcm/balance/refresh', (req, res) => {
    const { employeeId, leaveType, additionalDays, reason } = req.body;

    const employee = employeeBalances[employeeId];
    if (!employee) {
        return res.status(404).json({
            error: {
                code: 'EMPLOYEE_NOT_FOUND',
                message: `Employee ${employeeId} not found`,
            },
        });
    }

    const balance = employee.balances.find((b) => b.leaveType === leaveType);
    if (!balance) {
        return res.status(400).json({
            error: {
                code: 'INVALID_LEAVE_TYPE',
                message: `Leave type ${leaveType} not found`,
            },
        });
    }

    // Increase total days (simulating work anniversary bonus or yearly reset)
    balance.totalDays += additionalDays;

    res.json({
        success: true,
        transactionId: uuidv4(),
        employeeId,
        leaveType,
        locationId: employee.locationId,
        previousTotal: balance.totalDays - additionalDays,
        newTotal: balance.totalDays,
        reason: reason || 'WORK_ANNIVERSARY',
        processedAt: new Date().toISOString(),
    });
});

// ─── Health Check ───────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Mock HCM Server',
        failureRate: `${FAILURE_RATE}%`,
        maxDelay: `${MAX_DELAY_MS}ms`,
        uptime: process.uptime(),
    });
});

// ─── Start Server ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n🏥 Mock HCM Server running on http://localhost:${PORT}`);
    console.log(`   Failure rate: ${FAILURE_RATE}%`);
    console.log(`   Max delay: ${MAX_DELAY_MS}ms`);
    console.log(`   Employees loaded: ${Object.keys(employeeBalances).length}`);
    console.log(`\n   Endpoints:`);
    console.log(`   GET  /api/hcm/balance/:employeeId — Single employee balance`);
    console.log(`   GET  /api/hcm/balance/batch       — All employees (batch)`);
    console.log(`   POST /api/hcm/balance/deduct       — Deduct balance`);
    console.log(`   POST /api/hcm/balance/refresh      — Simulate balance refresh`);
    console.log(`   GET  /health                       — Health check\n`);
});

module.exports = app;
