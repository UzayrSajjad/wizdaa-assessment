# Technical Requirement Document: Time-Off Microservice

**Version**: 1.0  
**Author**: Uzair Sajjad  
**Date**: April 2026  
**Status**: Implementation Complete  

---

## 1. System Overview

The Time-Off Microservice manages employee leave requests, balances, and synchronization with an external Human Capital Management (HCM) system such as Workday or SAP SuccessFactors.

### Core Responsibilities
- Track leave balances per employee per leave type
- Process leave request submissions, approvals, rejections, and cancellations
- Synchronize balance data with an external HCM system (source of truth)
- Handle HCM system unreliability gracefully

### Architecture Position
This is a **backend microservice** that sits between the internal company applications (frontend, admin tools) and the external HCM system. It maintains a **local copy** of balance data for low-latency queries while periodically reconciling with HCM.

---

## 2. Goals and Non-Goals

### Goals
- **Correctness**: Prevent double-deduction of leave balances under concurrent requests
- **Resilience**: System remains functional even when HCM is unavailable
- **Consistency**: Eventual consistency with HCM via batch reconciliation
- **Auditability**: Every balance change and sync operation is logged
- **Idempotency**: Duplicate request submissions produce the same result

### Non-Goals
- Full HRIS capabilities (payroll, benefits, etc.)
- Real-time push notifications (webhooks)
- Multi-tenant architecture
- Holiday calendar management (locale-specific holidays)
- Manager approval workflow UI

---

## 3. Architecture

```
┌───────────────────┐
│   Client / UI     │
└────────┬──────────┘
         │ REST API
         ▼
┌───────────────────────────────────────────┐
│          Time-Off Microservice            │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐  │
│  │Employee │ │  Balance  │ │   Leave   │  │
│  │ Module  │ │  Module   │ │  Request  │  │
│  └─────────┘ └──────────┘ │  Module   │  │
│                            └───────────┘  │
│  ┌────────────────────────────────────┐   │
│  │         HCM Sync Module           │   │
│  │  ┌─────────────┐ ┌─────────────┐  │   │
│  │  │ Sync Service │ │ HCM Client  │  │   │
│  │  └─────────────┘ └──────┬──────┘  │   │
│  └──────────────────────────┼────────┘   │
└──────────────────────────────┼────────────┘
                               │ HTTP (with retry)
                               ▼
                    ┌──────────────────┐
                    │  External HCM    │
                    │  (Workday/SAP)   │
                    └──────────────────┘
```

### Data Flow
1. **Leave Request**: Client → LeaveRequestService → BalanceService (reserve) → DB
2. **Approval**: Admin → LeaveRequestService → BalanceService (confirm) → HCM (async)
3. **HCM Sync**: Scheduler → HcmSyncService → HcmClient → BalanceService (overwrite)

---

## 4. Data Model

### Employee
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Internal identifier |
| external_hcm_id | VARCHAR | Links to HCM system |
| email | VARCHAR (unique) | Primary contact |
| first_name, last_name | VARCHAR | Display name |
| location_code | VARCHAR | Drives locale-specific policies |
| is_active | BOOLEAN | Soft delete flag |

### LeaveBalance
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| employee_id | FK → Employee | |
| leave_type | ENUM | ANNUAL, SICK, PERSONAL, etc. |
| total_days | DECIMAL(5,1) | Total allocation |
| used_days | DECIMAL(5,1) | Confirmed used days |
| pending_days | DECIMAL(5,1) | Reserved by PENDING requests |
| version | INT | **Optimistic lock column** |
| last_synced_at | DATETIME | Last HCM sync timestamp |
| sync_source | ENUM | LOCAL, HCM_REALTIME, HCM_BATCH |

**Key constraint**: UNIQUE(employee_id, leave_type)  
**Computed**: available_days = total_days - used_days - pending_days

### LeaveRequest
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| idempotency_key | VARCHAR (unique) | Prevents duplicate submissions |
| employee_id | FK → Employee | |
| leave_type | ENUM | |
| start_date, end_date | DATE | Business day range |
| total_days | DECIMAL | Pre-computed at creation |
| status | ENUM | PENDING, APPROVED, REJECTED, CANCELLED |
| reason | TEXT | Employee's reason |
| reviewer_id | UUID | Who approved/rejected |
| hcm_sync_status | ENUM | NOT_SYNCED, SYNCING, SYNCED, FAILED |
| hcm_sync_attempts | INT | Retry counter |
| hcm_last_error | TEXT | Last sync error message |

### HcmSyncLog
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| sync_type | ENUM | SINGLE, BATCH |
| status | VARCHAR | IN_PROGRESS, SUCCESS, PARTIAL_SUCCESS, FAILED |
| employees_affected | INT | |
| balances_updated | INT | |
| error_details | TEXT | |
| started_at, completed_at | DATETIME | |

---

## 5. API Design

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| POST | /api/v1/employees | Create employee |
| GET | /api/v1/employees | List employees |
| GET | /api/v1/employees/:id | Get employee |
| PUT | /api/v1/employees/:id | Update employee |
| GET | /api/v1/balance/:employeeId | Get all balances |
| GET | /api/v1/balance/:employeeId/:leaveType | Get specific balance |
| POST | /api/v1/leave-request | Submit leave request |
| GET | /api/v1/leave-request/:id | Get request details |
| GET | /api/v1/leave-request/employee/:employeeId | List by employee |
| POST | /api/v1/leave-request/:id/approve | Approve request |
| POST | /api/v1/leave-request/:id/reject | Reject request |
| POST | /api/v1/leave-request/:id/cancel | Cancel request |
| POST | /api/v1/hcm/sync/single | Sync single employee |
| POST | /api/v1/hcm/sync/batch | Batch sync all |
| GET | /api/v1/hcm/sync/logs | View sync history |

### Response Envelope
All responses follow a consistent format:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-04-25T18:00:00.000Z",
    "path": "/api/v1/balance/emp-123",
    "requestId": "abc-123"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient ANNUAL balance. Available: 2, Requested: 5",
    "details": { ... }
  },
  "meta": { ... }
}
```

---

## 6. HCM Sync Strategy

### Real-Time Sync (Outbound)
- Triggered when a leave request is **approved**
- **Fire-and-forget**: approval succeeds locally regardless of HCM response
- HCM sync status tracked per request (NOT_SYNCED → SYNCING → SYNCED/FAILED)
- Failed syncs can be retried manually or via scheduled job

### Batch Sync (Inbound)
- Pulls all employee balances from HCM
- **Overwrites** local totalDays and usedDays with HCM values
- **Preserves** local pendingDays (active reservations)
- Handles partial failures: continues processing remaining employees
- Logs all changes for audit

### Why This Strategy
- HCM is the **source of truth** but is unreliable in real-time
- Local DB provides fast reads and can operate independently
- Batch sync corrects any drift periodically
- Pending days are never overwritten because they represent **local state** not yet synced

---

## 7. Failure Handling Strategy

### HCM Unavailability
| Scenario | Behavior |
|---|---|
| HCM down during leave approval | Approval succeeds locally, HCM sync marked FAILED |
| HCM returns 5xx | Retry with exponential backoff (3 attempts) |
| HCM returns 4xx | No retry (client error), log and mark FAILED |
| HCM times out | Treat as retryable failure |
| HCM returns malformed data | Validate response, log warning |

### Retry Configuration
- **Max retries**: 3
- **Base delay**: 1000ms
- **Backoff**: Exponential with jitter (1s → 2s → 4s + random)
- **Max delay cap**: 10000ms

### Recovery
- Failed syncs are queryable via API for manual retry
- Batch sync serves as the ultimate reconciliation mechanism

---

## 8. Consistency Model

### Eventual Consistency
The system operates on an **eventual consistency** model:

1. **Local DB** is the operational source for real-time queries
2. **HCM** is the authoritative source of truth
3. **Batch sync** aligns the two periodically

### Consistency Guarantees
- Balance deductions are **immediately consistent** locally (atomic DB operations)
- HCM state is **eventually consistent** (async sync)
- Pending days provide **reservation consistency** preventing over-commitment

### When Data Diverges
- If HCM adjusted a balance (e.g., admin correction), batch sync will overwrite local values
- If an approved leave wasn't synced to HCM, the next batch sync may overreport available days
- Sync logs capture all deltas for audit and investigation

---

## 9. Concurrency Handling

### The Problem
Two concurrent leave requests for the same employee could both pass the balance check and both deduct, leading to over-deduction.

### The Solution: Optimistic Locking
- `LeaveBalance` has a `version` column (auto-incremented by TypeORM)
- When saving a balance update, TypeORM checks that the version hasn't changed
- If another transaction modified the record, an `OptimisticLockVersionMismatchError` is thrown
- The operation is retried with fresh data (up to 3 attempts)

### Why Not Pessimistic Locking
- SQLite has limited locking capabilities (single writer)
- Optimistic locking has lower overhead for the common case (no contention)
- Retry logic handles the rare conflict case gracefully

---

## 10. Security Considerations

- **API Key authentication** via `X-API-Key` header (service-to-service)
- **Input validation** on all DTOs (type checking, range validation)
- **No stack traces** in production error responses
- **SQL injection prevention** via TypeORM parameterized queries
- **Rate limiting** recommended for production (not included—use API gateway)
- **CORS** configured for development, should be locked down in production

---

## 11. Scalability Considerations

### Current Design (Single Instance)
- SQLite handles ~100 concurrent reads efficiently with WAL mode
- Suitable for organizations up to ~1,000 employees
- Single-writer limitation acceptable for leave request volume

### Scaling Path
| Scale Trigger | Action |
|---|---|
| >1000 employees | Migrate to PostgreSQL |
| High write concurrency | Add write queue (Redis/RabbitMQ) |
| Multi-region | Database replication + API gateway |
| >10k req/sec | Kubernetes horizontal scaling |

### Stateless Design
- No server-side sessions
- Idempotency middleware uses in-memory store (swap to Redis for multi-instance)
- All state in database

---

## 12. Trade-offs and Alternatives

| Decision | Alternative | Rationale |
|---|---|---|
| TypeORM | Prisma | TypeORM has native optimistic locking + JS decorator support |
| SQLite | PostgreSQL | Zero-config deployment, single-file, sufficient for microservice scale |
| Optimistic locking | Pessimistic (SELECT FOR UPDATE) | Lower overhead, SQLite compatible, handles low-contention well |
| Fire-and-forget HCM sync | Synchronous sync | User experience unblocked by HCM latency/failures |
| In-memory idempotency | Redis-backed | Simpler for single-instance, documented upgrade path |

---

## 13. Edge Cases

1. **Employee submits leave on a weekend-only range** → Validation rejects (0 business days)
2. **Concurrent leave requests exceed balance** → Optimistic lock allows only one to succeed
3. **HCM batch sync during active pending request** → Pending days preserved, only total/used overwritten
4. **HCM returns success status but error body** → Response validation catches this
5. **Employee deactivated with pending requests** → Active requests remain (manual resolution)
6. **Leave request for 0 days** → Validation rejects
7. **Duplicate idempotency key** → Returns cached original response
8. **HCM sync for employee without HCM linkage** → Returns descriptive error
9. **Cancellation of approved leave** → Used days restored to available
10. **Overlapping date ranges** → Overlap detection prevents double-booking
