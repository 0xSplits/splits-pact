# PACT Equity (v1 design)

Status: design note, not implemented. This describes the intended evolution of
the current `Offering` contract, not its current behavior. Current behavior is
documented in [Onchain Offering](onchain.md).

## Thesis: revenue-first, not promise-first

The current flow implicitly assumes a founder raises first and points revenue
at the Liquid Split later. That is the maximal-trust configuration: buyers fund
a promise, and nothing onchain obligates the founder to ever route a dollar.

PACT Equity inverts the order. **Routing the revenue source at the Liquid
Split is the first step, done before the offering launches, as the act of good
faith.** Buyers purchase a slice of a pipe that is already flowing:

1. Founder points an existing onchain revenue source (NFT royalties, protocol
   fee switch, mint proceeds) at a new Liquid Split.
2. Pre-sale, the founder still receives effectively 100% of revenue (their own
   units plus the unsold carve-out's share, forwarded to treasury — see below).
3. As units sell along the curve, ownership drains from founder to buyers one
   unit at a time. There is no activation switch; the splitter "turns on"
   gradually as the carve-out sells.

This is the pre-PMF instrument: revenue may be small, buyers underwrite the
trajectory from verifiable onchain history, and the perpetual pro-rata upside
compensates the risk. Capped/senior structures for proven revenue are v2 — see
[PACT Note](pact-note.md).

## What breaks today with live revenue

The current contracts silently assume revenue is not routed until the offering
closes. Three things break when that assumption is dropped:

1. **Stranded distributions.** The Offering contract holds the unsold units, so
   it is itself a cap-table holder. Distributions on unsold units accrue to the
   Offering's address, and 0xSplits withdrawals are permissionless, so USDC can
   be pushed onto the contract. The Offering's accounting only knows how to
   move `raised - withdrawn` (`withdraw()`) and per-buyer `deposits`
   (`refund()`). Revenue USDC matches neither bucket and strands permanently.
2. **Refund exploit.** Buyers receive units immediately, before `minMet`. With
   live revenue, a buyer can purchase units, collect distributions during the
   funding window, and — if the raise fails — `refund()` their full USDC while
   keeping both the units and the yield already collected. Riskless carry.
3. **Look-back windfall.** Distributions pay balances at distribute-time. If
   revenue pools undistributed in the split, a new buyer collects a share of
   revenue earned before they bought. Sale timing vs. distribute timing
   matters.

## Design changes

### 1. `sweepDistributions()`

New permissionless function on the Offering. Claims the Offering's accrued
share from the 0xSplits payout infrastructure and forwards any payment-token
balance beyond escrow obligations (`raised - withdrawn` plus refundable
deposits) to `treasury`.

This is what implements "founder earns the unsold share": pre-sale, the entire
carve-out's revenue routes to treasury; post-sale it belongs to buyers.

### 2. Escrowed unit delivery until `minMet`

Recommended fix for the refund exploit: hold purchased units in the Offering
until the minimum is met. `buy()` records `unitsOwed[buyer]`; a `claim()`
call delivers units once `minMet` is true (or delivery happens lazily on the
next interaction). On failure, refunds return USDC and the units never left —
the cap table resets cleanly, which also fixes the current wart where failed
raises leave free units with refunded buyers.

Alternatives considered:

- Clawback on refund via ERC-1155 operator approval granted at buy time —
  works but adds an approval step and fails if the buyer moved the units.
- Documentation-only ("don't distribute during the funding window") — weak,
  and unenforceable since `distribute` is permissionless.

Escrowed delivery is the standard all-or-nothing crowdfund pattern and closes
the hole structurally.

### 3. Proof of revenue in the UI

The buy page should display verifiable trailing revenue, not projections:

- Distribution history for the Liquid Split (already indexable via Splits
  Explorer).
- Trailing revenue per unit and the implied yield at the current curve price.
- A check that the claimed revenue source actually pays the split (event scan
  on the source contract).

The create flow should treat "revenue source is already pointed at the split"
as the expected path and say so explicitly.

## Pricing

Because a unit is a claim on an observable revenue stream, the curve can be
anchored to trailing yield instead of vibes. Founders should not be asked for
`priceStart`/`priceSlope` directly. They know:

- `T` — target raise
- `N` — units offered (`offeringUnits`)
- `r` — how much more the last unit costs vs the first (`r = 1` is flat)

Since the schedule is linear, average price is the midpoint price:

```text
priceStart = 2T / (N * (1 + r))
priceSlope = priceStart * (r - 1) / (N - 1)
```

The UI can then display the implied payback at the curve floor and ceiling,
e.g. "unit #1 prices the stream at a 3-year payback; the last unit at 2x
that." A flat curve (`r = 1`) is a legitimate choice and the least
speculative framing.

## Open questions

- Should `sweepDistributions()` run automatically inside `buy()` /
  `closeAndWithdraw()` to keep balances clean, or stay a separate call?
- Escrowed delivery changes the buyer receipt UX ("you hold a claim until the
  minimum is met") — how is that shown on `buy.html`?
- Does the factory verify anything about the revenue source at creation, or is
  proof-of-revenue purely an indexing/UI concern?
- Post-`minMet`, the owner can keep selling indefinitely. With live revenue
  this dilutes nobody (units are a fixed 1,000), but the close date's meaning
  should be spelled out to buyers.
