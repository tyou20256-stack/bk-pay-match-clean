# TRON Energy Strategy — bk-pay-match

> **Status:** Pre-launch planning document. Decide and implement before funding
> the hot wallet with production volume.
>
> **Last updated:** 2026-04-10
>
> **Context:** Currently, every USDT TRC-20 send burns raw TRX for energy
> (~13 TRX for first-time recipients, ~6.5 TRX for repeat recipients at 2026
> mainnet prices). At 100 transfers/day this is **~722 TRX/day ≈ $224/day ≈
> $6,720/month** in pure gas burn. This document compares the three paths to
> reduce or eliminate that cost, with a concrete recommendation.

---

## 1. Cost baseline (current state)

**Assumptions** (mainnet, Jan 2026):
- TRX price: ~$0.31
- USDT TRC-20 transfer energy: ~65,000 (repeat) / ~130,000 (first-time activation)
- 10% of transfers are to new addresses (activation cost)
- Volume: 100 transfers/day

**Current burn-only cost:**
- 10 first-time × 13.14 TRX = 131.4 TRX
- 90 repeat × 6.57 TRX = 591.3 TRX
- **Total: 722.7 TRX/day ≈ $224/day ≈ $6,720/month**

At 1,000 transfers/day (post-scale): **~$67,200/month in gas burn.** This is
the single largest operating cost after the VPS itself.

---

## 2. Three strategic options

### Option A: Stay with TRX burn (do nothing)

**Pros:**
- Zero integration work
- Zero counterparty risk
- Instant settlement (no rental wait)

**Cons:**
- Highest cost by far
- Scales linearly with transfer volume
- Requires maintaining large TRX liquidity in hot wallet

**Recommendation:** Only for pre-launch. Migrate before $5k/month in gas burn.

---

### Option B: Third-party energy rental (TronZap / TronSave / TronEnergy.io)

**Concept:** Pay a rental marketplace pre-funded balance, and at send time,
the marketplace delegates just-in-time energy to your hot wallet for ~1 hour.

**Pros:**
- ~50-60% cheaper than burn (per the Blockchain Security Auditor report:
  **~$1,860/month savings at 100 tx/day**)
- No TRX staking lockup required
- Can start with $50 prepaid balance for testing

**Cons:**
- **Counterparty risk:** rental marketplace could go down, rate-limit, or
  lose your prepaid balance
- **Minimum rental duration:** typically 1 hour, overkill for instant sends
- **Rental latency:** 2-10 seconds of activation wait before broadcast
- **SDK maturity:** `tronzap-sdk-nodejs` is thin on documentation (confirmed
  via docs-lookup research 2026-04-10). Method signatures must be verified
  against the actual repo README before integration.
- **Pre-funded balance management:** adds a new treasury line to monitor
- **Single vendor risk** unless fallback to Option A or C is implemented

**Candidate providers:**

| Provider                      | URL                      | Notes                                                |
|-------------------------------|--------------------------|------------------------------------------------------|
| TronZap                       | https://tronzap.com      | `tronzap-sdk-nodejs` on npm; thin docs, thin community |
| TronSave                      | https://tronsave.io      | REST API + blog evidence of active use               |
| TronEnergy.io                 | https://tronenergy.io    | Alternative, similar pricing                         |
| TRONGas (tron.network/gas)    | (official-adjacent)      | Requires verification                                |

**Integration sketch** (NOT yet implemented — placeholder for when we're
ready to ship):

```typescript
// In src/services/walletService.ts, before the actual transfer:
import { rentEnergyForTransfer } from './energyRental'; // NEW FILE

// Inside sendUSDT, after blacklist check but before contract.transfer.send():
let rentalReceipt: { orderId: string } | null = null;
try {
  rentalReceipt = await rentEnergyForTransfer(toAddress, amount);
  logger.info('Energy rented', { orderId: rentalReceipt.orderId, toAddress });
} catch (e: unknown) {
  logger.warn('Energy rental failed, falling back to TRX burn', {
    error: e instanceof Error ? e.message : String(e),
    toAddress,
  });
  // Fall through to burn-TRX path — transfer proceeds either way
}
// ... existing contract.methods.transfer(...).send({ feeLimit: 20_000_000, ... })
```

**Fallback contract:** rental failure must NEVER block a send. The burn path
is the correct fallback — we eat ~13 TRX but the customer gets their USDT.

---

### Option C: Self-stake TRX and delegate energy (recommended)

**Concept:** Lock up TRX in your own wallet via `freezeBalanceV2` to receive
energy directly from the TRON network, and delegate that energy to the hot
wallet as needed.

**Pros:**
- **Zero counterparty risk** — energy comes directly from the TRON protocol
- **No ongoing fees** — you pay once (staked TRX is locked, not spent)
- **TRX principal returns to you** when you `unfreezeBalanceV2` (14-day
  unbonding period)
- **Lowest marginal cost** per transfer (effectively zero after initial stake)
- **Official TRON mechanism** — no third-party SDK to maintain

**Cons:**
- **Capital lockup:** need to lock ~30,000-50,000 TRX (~$9,300-$15,500) to
  generate enough energy for 100 transfers/day
- **14-day unbonding period** to retrieve TRX if you stop operations
- **Requires balance management:** staked TRX is not usable for gas/transfers
- **Initial integration work:** 1-2 days to wire `freezeBalanceV2` +
  `delegateResource` calls via tronweb
- **Daily re-delegation needed** (resource rental is per-day on TRON)

**Concrete math for our scale (100 tx/day):**

- 100 × 65k energy = 6.5M energy/day required
- Current staking ratio: ~1 TRX staked → ~70 energy/day (varies with total
  network staking)
- Required stake: **~93,000 TRX → ~$28,800 one-time lockup**
- At 500 tx/day: ~460,000 TRX → ~$142,600 lockup
- Payback period vs burn: **~4.3 months** at 100 tx/day
- After payback: all gas becomes **free** (principal recoverable via
  `unfreezeBalanceV2`)

**Integration path:**

```typescript
// src/services/energyManager.ts (NEW)
// 1. Stake TRX
// await tronWeb.transactionBuilder.freezeBalanceV2(amountSun, 'ENERGY');
// 2. Delegate energy to hot wallet (or keep on stake account)
// await tronWeb.transactionBuilder.delegateResource(amountSun, toAddress, 'ENERGY');
// 3. Monitor daily energy balance; top up stake if needed
// 4. On decommission: undelegateResource → unfreezeBalanceV2 → wait 14 days → withdraw
```

---

## 3. Recommendation

**For bk-pay-match specifically (financial service, pre-launch, 2026-04-10):**

**Phase 1 (now through initial $10k flow):** Stay with Option A (burn TRX).
Cost is small in absolute terms while volume is low. Prioritize security
hardening (hot wallet isolation, MPC) over gas optimization.

**Phase 2 (at ~50-100 tx/day sustained):** Implement Option C (self-stake),
not Option B. Reasons:
1. Zero counterparty risk is non-negotiable for a financial service
2. TRX principal is recoverable (not an opex line forever)
3. Payback period is ~4 months — reasonable given we're already holding TRX
   for hot wallet operations
4. One TRON-native mechanism is simpler than managing a third-party SDK +
   prepaid balance + rental monitoring + failure fallback to burn anyway

**Phase 3 (at >500 tx/day):** Revisit. At very high volume, Option B as a
**supplement** to Option C may make sense for peak absorption, but Option C
remains the baseline.

**Never recommended:** Single-source dependence on Option B without an
Option A fallback. Rental marketplaces have gone dark before.

---

## 4. Pre-requisites for Option C implementation (when ready)

- [ ] Hot wallet funded with initial TRX (separate treasury wallet for
      staking is cleaner — see below)
- [ ] Separate `STAKE_WALLET_ADDRESS` in env for the staking pool
- [ ] New service: `src/services/energyManager.ts`
  - `freezeBalanceV2(amount, 'ENERGY')`
  - `delegateResource(amount, hotWalletAddress, 'ENERGY')`
  - `getEnergyBalance(address)` health check
  - `undelegateResource(amount, hotWalletAddress, 'ENERGY')` (emergency)
- [ ] Scheduled task: daily energy balance check, alert if below 1 day
      buffer
- [ ] Runbook for 14-day unbonding in case of wind-down
- [ ] Documentation in `docs/13_DEPLOY_PRODUCTION.md`

## 5. Alternative (unlikely): Pay transfers on-demand via `triggerSmartContract`

Some exchanges reduce gas by building custom TRC-20 contracts that batch
transfers, but for a P2P single-send pattern this is not applicable.

---

## Decision log

| Date       | Decision                                | Author |
|------------|-----------------------------------------|--------|
| 2026-04-10 | Defer rental integration; plan for Option C post-launch | Phase 1 audit |

