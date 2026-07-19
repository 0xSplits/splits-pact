# PACT Note (v2 design)

Status: design note, not implemented. Builds on [PACT Equity](pact-equity.md);
read that first. Assumes the revenue-first posture (revenue routed before
launch) and the v1 fixes (distribution sweeping, escrowed unit delivery).

## Thesis: seniority and a cap

PACT Equity sells a perpetual, uncapped, pari-passu revenue share. That is the
right instrument pre-PMF, but for proven revenue two things are missing:

- **Seniority** — investors paid first, founder paid after.
- **A cap** — investors earn up to a fixed multiple, then stop forever.

Both come from composing the existing Liquid Split with a 0xSplits Waterfall.
No new payout code; waterfall recipients are just addresses, and a Liquid
Split is an address.

## Structure

```text
revenue source
   |
   v
Waterfall (single token, e.g. USDC)
   |-- Tranche 1: investor Liquid Split, threshold = multiple x raised
   |       (PACT sells these 1155 units on the curve)
   `-- Residual: treasury (or a founder split), uncapped
```

Waterfall thresholds are cumulative and never reset. That is the desired
semantics: once `multiple x raised` has flowed through tranche 1, investors
are done permanently. Every dollar of revenue services the investor tranche
first, so seniority is structural, not contractual.

## Instrument semantics

The unit changes character from equity-like to debt-like:

- **Known face value.** Each unit's maximum lifetime payout is
  `trancheCap / 1000`. Pricing becomes discount-to-face: a unit with $100 face
  sold at $60 is a 1.67x maximum multiple.
- **The curve prices commitment, not speculation.** The curve sells from a
  deeper discount toward face. All tranche-1 holders fill pro-rata, so early
  buyers simply earn a higher capped multiple for committing early.
- **IRR is the only unknown.** The multiple is fixed; fill speed depends on
  revenue. Trailing onchain revenue gives buyers the underwriting input:
  "TTM revenue $40k/yr against a $75k tranche is roughly a 2-year payback."

The tradfi analogue is a revenue bond crossed with a private-equity
distribution waterfall: senior claim on a project's receipts, capped payout,
no equity.

## Sequencing: the cap depends on the actual raise

Waterfall recipients and thresholds are immutable at creation, but the cap is
`multiple x raised` — unknown until the offering closes. Deploying the
waterfall upfront against the maximum raise oversizes the investor claim if
the round comes in short.

Required sequencing:

1. Run the PACT raise against the investor Liquid Split as today.
2. At close, compute `trancheCap = multiple x raised`.
3. Deploy the waterfall with tranche 1 = the investor Liquid Split,
   residual = treasury.
4. Re-point the revenue source at the waterfall.

Steps 2–4 must be atomic with `closeAndWithdraw()` (or verifiably scripted),
otherwise the design reintroduces "trust me, I'll point the revenue later" —
the exact gap PACT Equity closes. During the funding window revenue keeps
flowing through the v1 path (pari-passu split), which is acceptable: buyers
earn uncapped during the raise and convert to capped-senior at close.

## Known problems

1. **Unsold units poison the tranche.** Unsold carve-out units return to
   treasury at close, and those units would then collect part of the investor
   tranche — the founder eating the senior claim. Fix: at close, size the
   tranche split from sold units only (burn unsold units, or exclude them via
   a fresh split for tranche 1).
2. **Waterfalls are single-token.** One waterfall handles one token. Revenue
   in mixed tokens needs a 0xSplits Swapper in front (everything converts to
   USDC, then enters the waterfall).
3. **Escrowed delivery matters more here.** Units carry a hard face value from
   day one, so the v1 refund-exploit fix is a prerequisite, not an option.

## Variants

- **Simple RBF** (default): tranche 1 investors at `multiple x raised`,
  residual to treasury.
- **PE-style waterfall**: tranche 1 investors at 1.0x (return of capital),
  tranche 2 founder catch-up, tranche 3 a shared residual split (e.g. 80/20).
- **Bond with warrants** (hybrid): capped senior tranche plus a small
  perpetual tail — the residual is itself a Liquid Split where investors keep
  ~5% forever. Fixes the alignment cliff where capped investors stop caring
  the moment their tranche fills.

Same curve, same escrow, same 1155 across all variants; only the address the
revenue points at changes.

## Open questions

- Is the multiple fixed at creation (shown to buyers upfront) or chosen at
  close? Fixed-at-creation is the honest default.
- Who deploys the waterfall — the Offering inside `closeAndWithdraw()`, or the
  factory via a `close` helper? Atomicity argues for the Offering.
- Can the revenue source re-point be enforced onchain, or is it verified
  socially/by indexer? Depends on the source contract's ownership model.
- Secondary transfers of capped units: fine mechanically (it is a note
  changing hands), but the buy/receipt UI should show remaining tranche
  capacity so buyers know how much face value is left.
