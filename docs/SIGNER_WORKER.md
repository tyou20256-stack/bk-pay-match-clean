# Hot Wallet Signer Worker

> **Status:** Implemented (code), deployed with feature flag OFF. Launch
> with flag ON after Nile testnet validation + runbook rehearsal.
>
> **Critical:** This is a security control. Rolling it out correctly is
> more important than rolling it out quickly.

## Why we have this

The main `bk-pay-match` app is an Express server that runs Puppeteer
(headless Chromium, huge attack surface), WebSocket, and multiple HTTP
clients. Any remote code execution (RCE) in this process — through a
supply-chain attack on `puppeteer`, `axios`, `tronweb`, or a prototype
pollution bug — can read environment variables and memory, which means
it can exfiltrate `TRON_WALLET_PRIVATE_KEY` and drain the hot wallet.

The signer worker moves private key access into a minimal, isolated
Node process with:

1. **Separate container** (`bk-pay-match-signer`) — separate memory space
2. **No public ports** — communicates via Redis over the internal
   Docker network only
3. **No Puppeteer/Chromium** — ~200MB smaller attack surface
4. **Read-only root filesystem** (`read_only: true`)
5. **All Linux capabilities dropped** (`cap_drop: [ALL]`)
6. **No-new-privileges** security option
7. **Minimal image** (~256MB memory cap vs 2GB for main app)
8. **SQLite data volume mounted read-only** (audit logs written by main
   app only)

An RCE in the main app can still observe the enqueued `usdt-send` jobs
in Redis, but it cannot sign them — only the signer process holds the
private key.

## Architecture

```
┌──────────────────────┐       ┌─────────────┐       ┌──────────────────┐
│  bk-pay-match (main) │       │  bk-pay-    │       │ bk-pay-match-    │
│  - Express           │ push  │  match-     │ pop   │ signer           │
│  - Puppeteer         ├──────>│  redis      │──────>│ - tronweb        │
│  - WebSocket         │       │  (bullmq)   │       │ - PRIVATE_KEY    │
│  - TrupayPoller      │       │             │       │ - minimal image  │
│  - NO PRIVATE_KEY    │       └─────────────┘       └──────────────────┘
└──────────────────────┘                                     │
                                                             │ TronGrid
                                                             v
                                                      TRON mainnet
```

When `ENABLE_SIGNER_WORKER=true`:
- Main app still has `enqueueOrSendUSDT()` — it enqueues jobs to Redis
- Main app does NOT start its in-process usdt-send worker
- Signer container consumes jobs, signs, broadcasts, reports via Redis
- Main app observes completion via `QueueEvents` and updates order state

When `ENABLE_SIGNER_WORKER=false` (current default):
- Main app runs the usdt-send worker in-process (if `ENABLE_JOB_QUEUE=true`)
- Or bypasses the queue entirely (legacy sync path, if `ENABLE_JOB_QUEUE=false`)

## Feature-flag matrix

| ENABLE_JOB_QUEUE | ENABLE_SIGNER_WORKER | Main app behavior           | Signer container |
|------------------|----------------------|-----------------------------|------------------|
| false            | false                | Legacy sync sendUSDT        | Not running      |
| true             | false                | Worker runs in-process      | Not running      |
| true             | true                 | Enqueues only, no worker    | **Consumes jobs** |
| false            | true                 | **Invalid** — signer fails  | Exits with error |

**Current production state:** row 1 (both false). Legacy sync path.

## Deployment: sync to queue-based (Phase 1b)

Migrate from the legacy sync path to the in-process queue. No new
containers. Useful for testing BullMQ integration before the full
signer separation.

```bash
ssh root@5.104.87.106
cd /opt/bk-pay-match

# Update .env.production
echo "ENABLE_JOB_QUEUE=true" >> .env.production
echo "ENABLE_SIGNER_WORKER=false" >> .env.production

# Restart main app
docker compose up -d --build app

# Verify
docker logs bk-pay-match 2>&1 | grep -E "queue|worker"
# Expect: "Job queue enabled" + "usdt-send worker started"
```

Rollback: remove the two env vars and `docker compose up -d --build app`.

## Deployment: queue to separate signer (Phase 1c)

Move signing to a dedicated container.

### Step 1: Move the private key into a signer-only env

Create a new env file readable only by the signer container:

```bash
# /opt/bk-pay-match/.env.signer
# MINIMAL secrets needed by the signer only.
TRON_WALLET_PRIVATE_KEY=<rotated hex value>
TRONGRID_API_KEY=<optional>
REDIS_URL=redis://redis:6379
BK_ENC_KEY=<same as main app — needed by shared init>
ENABLE_JOB_QUEUE=true
ENABLE_SIGNER_WORKER=true
NODE_ENV=production
```

```bash
chmod 0400 /opt/bk-pay-match/.env.signer
chown root:root /opt/bk-pay-match/.env.signer
```

### Step 2: Remove the private key from the main app's .env.production

Delete `TRON_WALLET_PRIVATE_KEY` from `.env.production`. The main app
will still work — `getTronWeb()` falls back to reading the key from the
DB system config, and if neither is set, `isWalletReady()` returns false
and the app enqueues jobs without attempting direct signing.

### Step 3: Update docker-compose override for signer env_file

The `signer` service in `docker-compose.yml` uses `.env` by default.
Override with `.env.signer`:

Create `docker-compose.override.yml`:

```yaml
services:
  signer:
    env_file:
      - .env.signer
```

### Step 4: Start the signer

```bash
docker compose --profile signer up -d signer

# Verify
docker logs bk-pay-match-signer 2>&1 | tail -20
# Expect: "[signer] ready — consuming usdt-send queue"

docker compose --profile signer ps
# Expect: bk-pay-match-signer  Up  (healthy)
```

### Step 5: Update main app env to delegate

```bash
# /opt/bk-pay-match/.env.production
ENABLE_JOB_QUEUE=true
ENABLE_SIGNER_WORKER=true   # main app will NOT consume usdt-send
```

```bash
docker compose up -d --build app
```

### Step 6: Verification test (Nile testnet recommended first)

Send a small USDT transfer via the admin UI or API. Watch the logs:

```bash
# Main app should enqueue:
docker logs -f bk-pay-match 2>&1 | grep "USDT send enqueued"

# Signer should process:
docker logs -f bk-pay-match-signer 2>&1 | grep "signer.*processing"

# Redis confirms:
docker exec bk-pay-match-redis redis-cli LLEN bull:usdt-send:completed
```

## Rollback

At any stage, revert by:
1. Setting both env vars to `false` in `.env.production`
2. `docker compose stop signer` (if running)
3. `docker compose up -d --build app`

The main app will fall back to the legacy sync path.

## Monitoring

Key metrics (to be added when Prometheus/Grafana is wired up):
- `bullmq_jobs_waiting{queue="usdt-send"}` — should be near 0
- `bullmq_jobs_active{queue="usdt-send"}` — max 1 (concurrency=1)
- `bullmq_jobs_failed{queue="usdt-send"}` — alert on any non-zero
- `bullmq_jobs_delayed{queue="usdt-send"}` — indicates backoff retries

Alerts:
- Signer container exit → critical
- Redis connection lost → high
- Jobs in failed state > 5 minutes → high
- Main app `usdt-send enqueue failed` → medium

## Pre-launch checklist

Before flipping `ENABLE_SIGNER_WORKER=true` in production:

- [ ] Nile testnet dry run: send 1 TRX + 1 TestUSDT through the full
      pipeline (main app → Redis → signer → TRON)
- [ ] Verify signer container has read-only root filesystem
      (`docker inspect bk-pay-match-signer | grep ReadonlyRootfs` → true)
- [ ] Verify signer has no public ports exposed
      (`docker port bk-pay-match-signer` → empty)
- [ ] Verify main app no longer has `TRON_WALLET_PRIVATE_KEY` in env
      (`docker exec bk-pay-match env | grep -c TRON_WALLET_PRIVATE_KEY`
      → 0)
- [ ] Verify signer has it (`docker exec bk-pay-match-signer env | grep
      -c TRON_WALLET_PRIVATE_KEY` → 1)
- [ ] Rollback rehearsal: flip flag to false, verify legacy path works,
      flip back
- [ ] Alerting wired up: Telegram notification on signer container exit
- [ ] First production run with a small amount (< $100) before scaling

## Related docs

- [ENERGY_STRATEGY.md](./ENERGY_STRATEGY.md) — TRON gas optimization path
- [PRODUCTION_STATUS.md](./PRODUCTION_STATUS.md) — VPS ops (gitignored)
