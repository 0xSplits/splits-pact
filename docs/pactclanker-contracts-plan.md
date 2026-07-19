# PartyClanker — Smart Contract Implementation Plan

Status: plan only, nothing implemented. Written 2026-07-19 to hand off to a
fresh session. Read [pactclanker-prd.md](pactclanker-prd.md) first — all
DD-references below point there. The playable mock (`/party`) and modeler
(`pactclanker-model.html`) encode the intended behavior and are the UX
ground truth for what the contract's read functions must serve. §"The model"
below restates the mechanism so this doc stands alone; §"References" has
every external link.

## The model (self-contained recap)

**PartyClanker**: a crowd pools ETH, all-or-nothing, inside a time window.
On success, one settlement transaction launches a completely vanilla
Clanker v4 coin where the crowd is, collectively, the "dev": the pool funds
the atomic **dev buy** (first fill, inside the deploy tx, before any
sniper), a **vault** streams a 1:1 bonus coin per coin bought, and **every
trading fee's creator side flows forever to a 0xSplits Liquid Split** — a
1,000-unit ERC-1155 cap table minted at settlement and allocated to the
backers. **Nobody is paid**: no founder cash, no team coins, no organizer
carve-out; the settlement contract itself is Clanker's creator-of-record
and provably can't keep anything. The launcher's only edge is being first
to commit.

**Allocation is time-weighted** (MetaDAO-style accumulator): weight =
ETH x seconds-in-pool, measured at close — equivalently, `amount x
time-remaining-at-deposit`. Withdrawals ("yank") are allowed any time and
wipe accrued weight pro-rata, so weight is always backed by capital; a
yank-then-rebacker equals a fresh backer. Backers whose share floors below
1 unit (0.1%) are refunded at close (the "dust bar"). Failure (< min at
close) refunds everyone in full.

**Pricing (DD-6 rev 2, the newest decision)**: the coin's list mcap is
computed at settlement as **5x the actual raise, no floor**. This makes the
deal size-invariant — every party, 0.4 ETH or 10 ETH, enters at ~0.62x
list, pays ~40% of what the first outside buyer pays, and holds ~32% of
supply (~16% bought + ~16% vault bonus; 68% float). (Caveat: those numbers
come from a constant-product approximation; see §6.2.) Fee flow assumed:
1% pool fee, 80% creator side / 20% Clanker; units get 100% of the creator
side.

**UX truths the contracts must serve** (found by prototyping; PRD "UX
prototype findings"): a backer's hero number is the **floor** — their
worst-case share if the party fills — which is a pure ratchet (rises every
second, unchanged by joins, raised by yanks); their **ceiling** is the
at-close projection, which only moves when humans act. Read functions must
expose both directly.

## 0. What is already verified (do not re-derive)

Verified against Clanker v4 source (`clanker-devco/v4-contracts`, 2026-07-19):

1. **DevBuy output routing — SOLVED.** `ClankerUniv4EthDevBuy` decodes a
   `Univ4EthDevBuyExtensionData` struct containing a **`recipient` address**;
   bought tokens go `IERC20(token).transfer(devBuyData.recipient, ...)` —
   NOT to the deployer. We can point the pre-buy directly at the streaming
   contract. ETH enters via `receiveTokens(...) payable onlyFactory`.
2. **Finalize atomicity — SOLVED in principle.** Extensions execute inside
   the factory's deploy transaction (`receiveTokens` is `onlyFactory`,
   called during token deployment with the extension's ETH). One call to
   the Clanker factory with extensionConfigs = [DevBuy, Vault] runs the
   whole launch atomically. Our `finalize()` wraps that call plus the LS
   mint and stream arming in one tx.
3. **Vault extension.** Config: `admin`, `lockupDuration`, `vestingDuration`;
   `MIN_LOCKUP_DURATION = 7 days`; linear vest after lockup; claimed tokens
   `transfer(allocation.admin, ...)`; admin may be a contract. Consequence
   for DD-6 streams: the bonus cannot stream from day 0 — spec becomes
   **7d cliff + ~83d linear vest (≈90d total)**, which preserves
   "bonus arrives slower than bought."
4. **Arbitrary starting mcap is permissionless** (Clanker v0.3.1+ docs), so
   DD-6 rev 2's `mcap = 5 x raised` is implementable — it means computing
   custom pool/position config rather than using the stock preset.
5. **ETH raise (DD-5)** means no swap anywhere: pooled ETH funds the ETH
   DevBuy directly.

## 1. Architecture

Two new contracts plus stock parts. No owner keys anywhere (DD-2: the
settlement contract is the creator-of-record and provably can't keep
anything).

```text
PartyFactory ── announce(name, symbol, imageURI, maxRaise)
    │             deploys a Party (minimal proxy), emits PartyCreated
    ▼
Party (one per launch; escrow + accumulator + settlement; immutable config)
    │  back() / yank() / finalize() / refund() + read fns
    ▼  finalize() calls, in one tx:
Clanker v4 factory (stock)          LS1155 factory (stock, Base)
  ├─ DevBuy ext  → recipient = BoughtStream (Splits Vesting → LS)
  ├─ Vault ext   → admin = LS (or thin forwarder; see §6.3)
  ├─ fee reward recipient = LS, forever
  └─ stock MEV module + locked LP
LiquidSplit (1000 units, minted at finalize by time-weighted shares)
```

House rules baked into `Party` as constants/immutables (DD-3..6):
linear dollar-seconds accumulator; dust bar = 1 unit (0.1%); window = 4
days; `min = maxRaise / 10` (micro parties must exist — DD-6 rev 2
knock-on); `minDeposit = maxRaise / 1000` (soft filter; the dust pass is
the guarantee); vault multiple 1:1; bought stream ~7d; vault 7d cliff +
~83d vest; `mcap = 5 x raised`, no floor; fees 100% to units.

## 2. Party: state and function surface

```solidity
struct Backer { uint128 balance; uint128 accrued; uint64 lastUpdate; }
mapping(address => Backer) backers;
address[] backerList;                  // append on first deposit; needed for LS mint arrays
uint128 totalBalance; uint128 totalAccrued; uint64 globalLastUpdate;
uint64  immutable closeTime;           // announce + 4 days
uint256 immutable maxRaise;            // also derives min, minDeposit
enum State { Funding, Launched, Failed }
```

- `back() payable` — settle accumulators, add balance; revert if
  `block.timestamp >= closeTime`, if `totalBalance + msg.value > maxRaise`
  (hard cap, DD-4), or below `minDeposit` for a first-time backer.
- `yank(uint256 amount)` — DD-1 (leaning confirmed by prototype; final
  confirm with Abram): withdraw any time before close; wipe accrued
  **pro-rata**: `accrued -= accrued * amount / balance`. Full capital
  backing invariant: weight never exists without balance behind it.
- `finalize()` — permissionless after `closeTime` when `raised >= min`
  **net of the dust pass** (PRD DD-4 edge case). See §3.
- `markFailed()` / `refund()` — permissionless fail after close below min;
  pull refunds. Prior art: `contracts/Offering.sol` `markFailed`/`refund`
  (lines 178–194) — reuse the shape, drop `refundAll` (no owner).
- **Read functions are a product surface** (PRD "UX prototype findings"
  #2): `projectedShareOf(addr)` (at-close share, the ceiling),
  `floorShareOf(addr)` = `w / (W + capacityLeft * (closeTime - now))`
  (the ratchet — this exact formula powers the mock's hero number),
  `unitsIfClosedNow(addr)`. The frontend should never re-derive these.

Accumulator note: weights are dollar-seconds at close; `amount x
timeRemaining-at-deposit` is the equivalent closed form. Settle lazily
(Synthetix/MasterChef shape, O(1) per op) — see PRD DD-3 and the
complexity-budget section.

## 3. finalize() algorithm

1. Settle global accumulator to `closeTime`.
2. Compute every backer's weight; **dust pass**: mark backers whose share
   floors below 1 unit; their deposits become refundable (excluded from
   the raise). Single pass is safe — removals only raise survivors'
   shares (proof in PRD DD-4). Re-check `raisedNet >= min`; if not, flip
   to Failed.
3. **Quantize units**: floor each survivor's `share x 1000`; distribute the
   remainder by largest-remainder method (deterministic, sums to exactly
   1000). This resolves DD-4's open remainder policy — propose it to
   Abram as the default.
4. Compute `mcap = 5 x raisedNet`; derive the pool's starting tick/position
   config from it (see §6.1 — the one piece of real math to build).
5. Deploy the LS via the Base LS1155 factory with
   `accounts = survivors`, `initAllocations = units` (this repo already
   does exactly this call — `contracts/OfferingFactory.sol:85`).
6. Call the Clanker v4 factory: vanilla config + DevBuy extension funded
   with `raisedNet` (recipient = BoughtStream), Vault extension at the
   1:1-equivalent bps (admin per §6.3), fee reward recipient = LS, stock
   MEV module.
7. Arm the bought-coin stream (Splits Vesting, ~7d, beneficiary = LS).
8. Emit `Launched(token, ls, mcap, raisedNet, units...)`. Nothing left to
   operate: State.Launched is terminal.

Gas bound: `minDeposit = maxRaise/1000` caps backers at 1000; LS mint with
1000-entry arrays is the worst case — **fork-benchmark at 50/200/1000
backers before committing to single-tx finalize**; if it doesn't fit Base's
block gas, fall back to `finalize()` + `launch()` two-step (compute+store
then deploy), still permissionless.

## 4. Invariants → tests (Foundry)

Property tests should encode the exact invariants the UX already teaches:

1. **Floor ratchet**: `floorShareOf(a)` is monotonically non-decreasing in
   time while `a` doesn't yank; unchanged by others' backs; increased by
   others' yanks.
2. **Capital backing**: no address ever has `accrued > 0 && balance == 0`
   mid-window; yank-then-rebacker ≡ fresh backer of same size/time.
3. **Quantization**: units always sum to exactly 1000; every survivor ≥ 1
   unit; dust pass idempotent.
4. **Ceiling**: `projectedShareOf` only changes on back/yank events, never
   with pure time.
5. **No-keep**: after finalize, Party's ETH balance is exactly the dust
   refunds owed; after all refunds, zero. Fuzz ETH donations
   (selfdestruct/coinbase) — must not brick accounting (compare against
   internal `totalBalance`, never `address(this).balance`).
6. Reentrancy on refund/yank (CEI + nonReentrant, as Offering.sol does).

Fork tests (Base mainnet fork): real Clanker v4 factory + extension
addresses (docs "Deployed Contracts" page), real LS1155 factory (address
in `docs/onchain.md`), full announce → back xN → finalize → verify: token
live, LP locked, DevBuy output landed in stream, vault allocation present,
LS holds fee-reward role, units match quantization, fees claimable after a
swap. Then the PRD's "what done looks like": one real mainnet party AND a
deliberately failed raise with real money, refund path exercised publicly.

## 5. Explicitly out of scope (v0)

Fill boost; oversubscription partial refunds; founder economics of any
kind; custom Clanker extensions or LP routing; governance; upgradability
(immutable everything); non-ETH raises; unit transferability restrictions
(LS units are stock 1155s — transferable; PRD open question stands).

## 6. Open items for the implementing session

1. **Tick/position math for arbitrary mcap** — how the v4 factory's pool
   config expresses starting price + the locker's position shape; compute
   from `mcap = 5 x raised`. This is the main novel engineering. Study the
   stock preset's positions and scale them.
2. **Confirm the constant-product approximation** against Clanker's real
   multi-position liquidity (PRD flagged this) — the 0.62x/40%/32% numbers
   quoted everywhere come from the approximation; recompute the effective
   k (or adjust the vault multiple) against the real pool shape so the UI
   numbers stay honest.
3. **Vault claim permissioning** — vested tokens transfer to `admin` on
   claim; check who may call `claim(token)`. If permissionless → set
   `admin = LS` directly and anyone can push the stream along. If
   admin-only → insert a thin immutable forwarder as admin.
4. **Splits Vesting mechanics** for the bought-coin stream (start/cliff
   params, who creates streams, claim cadence into the LS).
5. **DD-1 final confirmation + DD-4 params** (dust threshold exactly 1
   unit? min formula) with Abram — the contract shape above assumes the
   prototype's answers.
6. **LS distribution cadence** — who calls the LS's distribute for fee/
   stream ERC20s (permissionless, but UX wants a "claim" button that
   batches distribute+withdraw).

## 7. References

**In this repo (read in this order):**
- [pactclanker-prd.md](pactclanker-prd.md) — the spec: Model B rev 2,
  DD-1..DD-6 rev 2, complexity budget, UX prototype findings, open questions
- [partyclanker-build-prompt-v0.md](partyclanker-build-prompt-v0.md) — the
  original v0 build prompt (steelman of what we are / are not building;
  legal posture; "what done looks like")
- [partyclanker-crowd-model.html](partyclanker-crowd-model.html) — the
  original crowd-level economics model (source of the curve math)
- [pactclanker-model.html](pactclanker-model.html) — backer-POV modeler,
  locked to house rules (same math the contracts must reproduce)
- `src/pages/party.jsx` — playable mock; `partyEcon()` + `useParty()` are
  the reference implementations of the deal math, accumulator, floor, and
  dust logic the contracts must match
- `contracts/Offering.sol` / `contracts/OfferingFactory.sol` — prior art in
  this repo: escrow/refund shape and a working LS1155-factory mint call

**Clanker (v4):**
- Contracts repo: https://github.com/clanker-devco/v4-contracts
  - DevBuy extension: https://github.com/clanker-devco/v4-contracts/blob/main/src/extensions/ClankerUniv4EthDevBuy.sol
    (verified: `Univ4EthDevBuyExtensionData` has a `recipient`; tokens
    transfer there, not to the deployer; `receiveTokens` is `payable
    onlyFactory` → runs inside the deploy tx)
  - Vault extension: https://github.com/clanker-devco/v4-contracts/blob/main/src/extensions/ClankerVault.sol
    (verified: admin/lockup/vesting config; `MIN_LOCKUP_DURATION = 7 days`;
    claims transfer to admin; admin may be a contract)
- Docs — core contracts v4: https://clanker.gitbook.io/clanker-documentation/references/core-contracts/v4
- Docs — deployed addresses (Base): https://clanker.gitbook.io/clanker-documentation/references/deployed-contracts
- Docs — deploying a token / pool config: https://clanker.gitbook.io/documentation/general/token-deployments/deploying-a-token
- Docs — supported quote tokens (arbitrary quote tokens + arbitrary mcaps
  permissionless since v0.3.1; USDC not on the supported list — one reason
  for DD-5's ETH raise): https://clanker.gitbook.io/documentation/references/supported-quote-tokens
- SDK (useful for config shapes): https://github.com/clanker-devco/clanker-sdk

**0xSplits:**
- Liquid Splits (LS1155, fixed 1e3 supply, mint-once-at-creation):
  https://docs.splits.org/core/liquid
- Vesting (for the bought-coin stream): https://docs.splits.org/core/vesting
- Base LS factory address used by this repo: see `docs/onchain.md`

**MetaDAO (accumulator prior art):**
- ICO mechanism (accumulator += amount x elapsed_seconds; withdrawals open
  until the last second; fill boost — which we deliberately do NOT build):
  https://docs.metadao.fi/how-launches-work/sale

**Unpinned claim (do not ship in public copy until sourced):** the
"1.27M Base launches / 50+ distinct day-one holders predicts survival /
~2x survival for 15%+ vault launches" study cited in the build prompt and
model artifacts — PRD open question.

## 8. Suggested build order

1. `Party` escrow + accumulator + reads, unit/property tests (1–2 days —
   it's the battle-tested shape).
2. Dust pass + quantization + failure path, property tests.
3. Fork harness: deploy against real Clanker + LS factories, hardcoded
   stock-preset mcap first (defer §6.1), prove the whole pipe.
4. §6.1 tick math for `5 x raised`; swap into the fork harness; re-verify
   the economics numbers against real pool shape (§6.2).
5. Gas benchmark at 1000 backers → decide one-tx vs two-step finalize.
6. `PartyFactory` + events for indexing; wire the mock to real reads.
7. Testnet party → the two mainnet proofs (one real, one deliberately
   failed).
