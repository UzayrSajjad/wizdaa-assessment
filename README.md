# Time-Off Microservice

A production-grade NestJS (JavaScript) microservice for managing employee leave requests, balances, and HCM system synchronization.

## Architecture

```
Client → REST API → NestJS App → SQLite
                         ↕
                    External HCM (via HTTP + retry)
```

### Module Structure
| Module | Responsibility |
|---|---|
| **Employee** | Employee CRUD, HCM linkage |
| **Balance** | Leave balance management with optimistic locking |
| **Leave Request** | Request lifecycle (create → approve/reject → cancel) |
| **HCM Sync** | Bidirectional HCM data synchronization |

### Key Engineering Patterns
- **Optimistic Locking** on balances prevents concurrent overdraft
- **Idempotency** via `X-Idempotency-Key` header prevents duplicate submissions
- **Fire-and-forget HCM sync** — approvals succeed locally even when HCM is down
- **Retry with exponential backoff** for HCM API calls
- **Eventual consistency** with periodic batch reconciliation

---

## Quick Start

### Prerequisites
- Node.js >= 18
- npm >= 9

### Installation

```bash
# Clone and install
cd wizdaa-assessment
npm install

# Install mock HCM server dependencies
cd mock-hcm && npm install && cd ..

# Copy environment config
cp .env.example .env
```

### Running

```bash
# Terminal 1: Start Mock HCM Server
npm run mock-hcm

# Terminal 2: Seed database and start app
npm run seed
npm run start:dev
```

The service will be available at `http://localhost:3000`.

---

## API Reference

### Employees
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/employees` | Create employee |
| GET | `/api/v1/employees` | List employees |
| GET | `/api/v1/employees/:id` | Get employee |
| PUT | `/api/v1/employees/:id` | Update employee |

### Balances
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/balance/:employeeId` | Get all balances |
| GET | `/api/v1/balance/:employeeId/:leaveType` | Get specific balance |

### Leave Requests
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/leave-request` | Submit leave request |
| GET | `/api/v1/leave-request/:id` | Get request details |
| GET | `/api/v1/leave-request/employee/:employeeId` | List by employee |
| POST | `/api/v1/leave-request/:id/approve` | Approve request |
| POST | `/api/v1/leave-request/:id/reject` | Reject request |
| POST | `/api/v1/leave-request/:id/cancel` | Cancel request |

### HCM Sync
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/hcm/sync/single` | Sync single employee from HCM |
| POST | `/api/v1/hcm/sync/batch` | Batch sync all employees |
| GET | `/api/v1/hcm/sync/logs` | View sync history |

### Example: Create Leave Request

```bash
curl -X POST http://localhost:3000/api/v1/leave-request \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: unique-key-123" \
  -d '{
    "employeeId": "<employee-uuid>",
    "leaveType": "ANNUAL",
    "startDate": "2027-06-01",
    "endDate": "2027-06-05",
    "reason": "Family vacation"
  }'
```

---

## Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# With coverage
npm run test:cov
```

### Test Coverage
- **Unit tests**: BalanceService, LeaveRequestService, date utilities, retry utilities
- **E2E tests**: Full API lifecycle with in-memory SQLite
- **Edge cases**: Insufficient balance, concurrent requests, HCM failures, idempotency

---

## Mock HCM Server

The mock server simulates an unreliable external HCM system:

```bash
# Default: 20% failure rate, 0-2s delay
npm run mock-hcm

# Reliable mode (no failures)
cd mock-hcm && npm run start:reliable

# Flaky mode (50% failure rate)
cd mock-hcm && npm run start:flaky
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | Application port |
| `NODE_ENV` | development | Environment mode |
| `DB_PATH` | ./data/timeoff.sqlite | SQLite database file path |
| `HCM_BASE_URL` | http://localhost:4000/api/hcm | External HCM API base URL |
| `HCM_API_KEY` | | API key for HCM authentication |
| `HCM_TIMEOUT_MS` | 5000 | HCM request timeout |
| `HCM_MAX_RETRIES` | 3 | Max retry attempts for HCM |
| `HCM_RETRY_DELAY_MS` | 1000 | Base retry delay |
| `API_KEY` | | API key for this service |

---

## Project Structure

```
src/
├── main.js                          # App bootstrap
├── app.module.js                    # Root module
├── config/
│   └── database.config.js           # TypeORM + SQLite config
├── common/
│   ├── enums/index.js               # Shared enums
│   ├── filters/                     # Global exception filter
│   ├── interceptors/                # Logging + response transform
│   ├── middleware/                   # Idempotency middleware
│   ├── guards/                      # API key guard
│   └── utils/                       # Date + retry utilities
├── modules/
│   ├── employee/                    # Employee CRUD
│   ├── balance/                     # Balance management
│   ├── leave-request/               # Leave request lifecycle
│   └── hcm-sync/                   # HCM synchronization
├── seeds/
│   └── seed.js                      # Dev seed data
mock-hcm/
├── server.js                        # Mock HCM Express server
test/
├── unit/                            # Unit tests
├── e2e/                             # Integration tests
docs/
└── TRD.md                           # Technical Requirement Document
```

---

## Technology Choices

| Technology | Justification |
|---|---|
| **NestJS** | Enterprise-grade Node.js framework with DI, modules, and middleware |
| **TypeORM** | Native optimistic locking, JS support, NestJS integration |
| **SQLite** | Zero-config, ACID compliant, WAL mode for concurrent reads |
| **Babel** | Enables JavaScript decorator syntax for NestJS |
| **Jest** | Standard testing framework with mocking support |
| **Express** | Lightweight mock server (mock-hcm) |
