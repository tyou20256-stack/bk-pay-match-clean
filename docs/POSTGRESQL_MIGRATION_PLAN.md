# PostgreSQL Migration Plan

## Current State
- SQLite (better-sqlite3) with WAL mode
- Single file: data/bkpay.db (~71MB)
- 15+ tables including orders, trupay_withdrawals, trupay_matches, customer_accounts

## Trigger Conditions (when to migrate)
- Transaction volume > 1,000/day
- DB file size > 500MB
- Need for concurrent write scaling
- Need for multi-server deployment

## Migration Strategy

### Phase 1: Preparation
- Add database abstraction layer (Repository pattern)
- Ensure all queries use parameterized statements (already done)
- Map SQLite types to PostgreSQL types
- Test with PostgreSQL locally

### Phase 2: Dual-Write
- Run both SQLite and PostgreSQL simultaneously
- Write to both, read from SQLite (primary)
- Compare results for consistency

### Phase 3: Switch
- Switch reads to PostgreSQL
- Keep SQLite as fallback for 1 week
- Remove SQLite dependency

### Schema Changes Required
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- `TEXT DEFAULT (datetime('now'))` → `TIMESTAMP DEFAULT NOW()`
- `REAL` → `DECIMAL` for financial amounts
- Remove SQLite-specific pragmas
- Add connection pooling (pg-pool)

### Estimated Effort
- Phase 1: 2-3 days
- Phase 2: 1-2 days
- Phase 3: 1 day
- Total: ~1 week

### Dependencies
- PostgreSQL 15+ server
- pg + @types/pg packages
- Docker Compose service for PostgreSQL
