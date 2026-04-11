# MPC 2-of-3 Hot Wallet Migration Plan (Phase 2)

> **Status:** Design document. Implementation deferred until after
> launch + Phase 1c (signer container) has been running stable for
> at least 2 weeks.
>
> **Prerequisites:** `docs/SIGNER_WORKER.md` fully rolled out. All
> launch-time secrets rotated per `memory/project_bk_pay_match_prelaunch.md`.
>
> **Last updated:** 2026-04-11

## 1. Why MPC

The Phase 1c signer worker (already implemented in `src/workers/signer.ts`
and `docker-compose.yml` under the `signer` profile) reduces the blast
radius of an RCE in the main app — an attacker who compromises the
Express/Puppeteer process cannot read `TRON_WALLET_PRIVATE_KEY` because
it lives only in the signer container's memory.

But the signer container itself is still a **single point of
compromise**. If an attacker:

1. Gains code execution in the signer container (supply-chain attack on
   `tronweb`, `ioredis`, `bullmq`, or `better-sqlite3`)
2. Escalates within the VPS host (Docker escape, misconfigured
   capabilities, kernel CVE)
3. Physically accesses or legal-seizes the VPS
4. Compromises the SSH key used to deploy

... they can drain the entire hot wallet in a single transaction.

**MPC 2-of-3 threshold signatures** eliminate this single point of
compromise by splitting the private key across 3 independent
locations, requiring any 2 of them to sign jointly. No single machine
ever holds the full private key in memory.

## 2. Threat model

| Attacker capability | Phase 1c (signer container) | Phase 2 (MPC 2-of-3) |
|---|---|---|
| RCE in main app | Cannot drain ✅ | Cannot drain ✅ |
| RCE in signer container | **Drains wallet** ❌ | Cannot drain ✅ |
| Physical VPS seizure | **Drains wallet** ❌ | Cannot drain ✅ |
| Compromise 1 of 3 MPC nodes | — | Cannot drain ✅ |
| Compromise 2 of 3 MPC nodes | — | **Drains wallet** ❌ |
| Compromise all 3 MPC nodes | — | **Drains wallet** ❌ |
| Insider collusion (2 of 3 operators) | — | **Drains wallet** ❌ |

MPC raises the attack bar from "compromise one host" to "compromise
two geographically/administratively independent hosts simultaneously."

## 3. Architecture overview

```
┌──────────────┐            ┌─────────────┐
│  bk-pay-match│──enqueue──>│   Redis     │
│  main app    │            │  bullmq     │
└──────────────┘            └──────┬──────┘
                                   │
                            ┌──────┴──────┐
                            │             │
                            ▼             ▼
                  ┌─────────────┐  ┌─────────────┐
                  │ MPC coord.  │  │ MPC coord.  │  (one of
                  │ (on VPS)    │  │ (backup)    │   these
                  └──────┬──────┘  └─────────────┘   runs per
                         │                            deploy)
                         │ GG20/CMP signing protocol
                         │ (off-chain message passing)
           ┌─────────────┼─────────────┐
           │             │             │
           ▼             ▼             ▼
     ┌─────────┐   ┌─────────┐   ┌─────────┐
     │ Node A  │   │ Node B  │   │ Node C  │
     │ VPS Tokyo│   │ Laptop  │   │ Offline │
     │ (hot)   │   │ (founder)│  │ (paper) │
     │ share 1 │   │ share 2 │   │ share 3 │
     └─────────┘   └─────────┘   └─────────┘
```

**Distribution:**

- **Node A — VPS Tokyo (online)**: Auto-signs during business hours.
  Can sign transactions on its own using its share + another node's
  signature fragment.
- **Node B — Founder laptop (warm)**: Online during active approval
  windows. Reviews each pending transaction and co-signs via a local
  bksign client. Physical isolation from VPS.
- **Node C — Offline paper backup (cold)**: Air-gapped. Used only for
  key resharing ceremonies or emergency recovery when either A or B
  is permanently lost. Stored in a bank deposit box or geographically
  separated safe.

**Signing quorum:** Any 2 of 3. In normal operation: A + B. In
emergencies: A + C or B + C (after air-gap signing ceremony).

## 4. Library selection

### Primary candidate: `bnb-chain/tss-lib`

- https://github.com/bnb-chain/tss-lib
- Go library (not Node.js — runs as sidecar service communicating via
  gRPC or HTTP)
- License: MIT
- Battle-tested: used by Binance, Thorchain, and multiple institutional
  custodians
- Protocols: GG18, GG20, ECDSA CMP (more secure variant)
- Curve: secp256k1 (same as Ethereum; TRON uses secp256k1 under
  keccak256 address derivation, so tss-lib outputs are TRON-compatible
  with no extra translation)
- Active maintenance as of 2026 (last commit < 30 days)

### Alternative: `ZenGo-X/multi-party-ecdsa`

- https://github.com/ZenGo-X/multi-party-ecdsa
- Rust library (similar sidecar pattern)
- License: GPL-3.0 (⚠ GPL contagion — evaluate legal implications)
- Slightly older protocol family (GG18 only)

### Alternative: Commercial (rejected)

- Fireblocks, Coincover, Liminal: all gated behind enterprise contracts
  (>$50k/year). Not viable for a pre-launch independent operation.

**Recommendation:** Start with `bnb-chain/tss-lib`. MIT license, most
mature, widest adoption. Build a Go sidecar per MPC node and
communicate from `src/workers/signer.ts` via HTTP RPC.

## 5. Implementation phases

### Phase 2a: Key generation ceremony (offline)

1. Generate 3 ECDSA key shares using tss-lib's DKG (Distributed Key
   Generation) protocol. All 3 nodes must be online simultaneously
   during this step (one-time event).
2. Each node writes its share to a local encrypted file (age or SOPS).
3. Derive the public TRON address from the aggregated public key.
4. **Critical:** Never export the full private key. The whole point
   of MPC is that the full key never exists in one place.
5. Fund the new MPC address with a small test amount on Nile testnet.
6. Perform 3 test signings:
   - A + B
   - A + C (air-gap via QR code or USB)
   - B + C
7. Document the recovery runbook for the case where one node is lost.

### Phase 2b: Sidecar deployment

- **Node A (VPS)**: Deploy tss-lib as a Go sidecar in the signer
  container. Expose only a unix socket to the existing Node.js signer
  process. No external network access — communication with Node B and
  C happens via a separate Redis pub/sub channel.
- **Node B (laptop)**: Local bksign client, same tss-lib binary.
  Connects to VPS Redis over an SSH tunnel. Only runs when the
  founder explicitly authorizes a signing session.
- **Node C (offline)**: Not deployed. Used only via manual ceremony.

### Phase 2c: Integration with signer worker

Modify `src/workers/signer.ts` to use MPC instead of direct tronweb
signing:

```typescript
// Current (Phase 1c):
const tx = await contract.methods.transfer(toAddress, amountSun).send({
  feeLimit: 20_000_000,
});

// Future (Phase 2):
const unsignedTx = await tronWeb.transactionBuilder.triggerSmartContract(
  USDT_CONTRACT, 'transfer(address,uint256)', { feeLimit: 20_000_000 },
  [{ type: 'address', value: toAddress }, { type: 'uint256', value: amountSun }]
);
// Submit to MPC coordinator, which collects signature shares from A + B
const signature = await mpcSign(unsignedTx.raw_data_hex);
const signedTx = { ...unsignedTx.transaction, signature: [signature] };
const result = await tronWeb.trx.sendRawTransaction(signedTx);
```

### Phase 2d: Production cutover

1. Fund the MPC address on mainnet with a small amount (~$100)
2. Run in parallel with the Phase 1c signer container for 1-2 weeks
3. Gradually migrate volume: route 10% of sends through MPC, monitor,
   ramp to 50%, then 100%
4. Only after 100% MPC runs cleanly for 2 weeks, sweep the remaining
   Phase 1c wallet balance to the MPC address and decommission the
   single-key hot wallet

## 6. Operational considerations

### Signing latency

MPC adds ~2-5 seconds to each signature (inter-node message passing).
For bk-pay-match's P2P flow where the buyer is already waiting several
minutes for bank confirmation, this is invisible.

### Node B availability

The founder's laptop must be online during active signing windows.
Options:
- **Scheduled windows**: 9am-9pm JST, outside = queue only, no
  signing. Customers see "processing" state.
- **Always-on auxiliary node**: Run Node B on a second VPS with
  different hosting provider (DigitalOcean, Vultr) for geographic
  and administrative isolation. Cost: +$5/mo.
- **Mobile signing app**: Node B as a mobile app with push
  notification for approval. More complex to build.

Recommendation: start with scheduled windows, upgrade to auxiliary VPS
when volume justifies it.

### Key rotation

Unlike single-key wallets, MPC key rotation is a group ceremony: all
3 nodes participate in resharing the key. Schedule annually or when
any node is suspected of compromise.

### Backup and recovery

- Node C (offline paper backup) is the ultimate recovery path
- If Node A is destroyed: reshare key with new Node A' using B + C
- If Node B is destroyed: reshare using A + C
- If both A and B are lost: Node C alone cannot sign (2-of-3 quorum),
  but it holds the share needed to bootstrap a new 2-of-3 set with
  two new nodes

## 7. Open questions (resolve before Phase 2 kickoff)

- [ ] Go sidecar language choice: is the team comfortable maintaining
      a Go service alongside the TypeScript codebase?
- [ ] Alternative: does `Safeheron/multi-party-sig` (Go, TSS
      implementation) offer better compatibility with tronweb than
      bnb-chain/tss-lib?
- [ ] Regulatory implications: does MPC change the service's
      classification under Japanese crypto asset law (FSA)?
- [ ] Insurance: are MPC wallets eligible for cyber insurance in
      Japan?
- [ ] Monitoring: how do we alert on "signing ceremony timeout" when
      Node B is offline during business hours?

## 8. Cost estimate

| Item | One-time | Recurring |
|---|---|---|
| Go sidecar development | ~40 eng hours | — |
| Integration with signer worker | ~20 eng hours | — |
| Key generation ceremony (3 nodes) | ~8 eng hours | — |
| Nile testnet validation | ~16 eng hours | — |
| Auxiliary VPS for Node B (optional) | — | ~$5/month |
| Physical safe for Node C | ~$200 | — |
| **Total first month** | ~84 eng hours + $200 | $5/month |

Compared to the $6,720/month in gas burn that Phase 2 (Option C
self-stake) addresses, the MPC migration has a much smaller cost per
risk unit reduced. MPC is about **insurance**, not optimization.

## 9. Decision: defer or proceed?

**Defer until:**
- Phase 1c signer container has been running for 2+ weeks without
  incident
- Sustained transaction volume justifies the operational overhead
  (>50 tx/day)
- All launch-time secrets rotated and baseline hardening complete
- Team has bandwidth for a multi-week security-critical project

**Proceed when:**
- An incident exposes Phase 1c as insufficient (e.g., discovery of
  a container escape, tss-lib CVE, etc.)
- Transaction volume > 500 tx/day
- Regulatory requirements mandate multi-party custody (FSA, Travel Rule)
- Institutional counterparties require SOC 2 attestation of custody

## 10. Related documents

- [SIGNER_WORKER.md](./SIGNER_WORKER.md) — Phase 1c single-signer
  container
- [ENERGY_STRATEGY.md](./ENERGY_STRATEGY.md) — TRON gas optimization
  (separate concern)
- `memory/project_bk_pay_match_prelaunch.md` (gitignored) — launch-time
  secret rotation checklist
