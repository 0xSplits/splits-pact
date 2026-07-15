# PACTCLANKER PRD (working draft)

Status: sketch, lives on branch `pactclanker`. This is the starting point for a
stripped-down PACT — fewer moving parts, small contract tweaks, same core
primitive. Everything below is a proposal until marked decided.

Related reading: [PACT Equity](pact-equity.md) (v1 design fixes),
[PACT Note](pact-note.md) (waterfall/cap variant), [Onchain](onchain.md)
(current shipped behavior).

## Premise

Keep the one thing PACT actually is — **sell ERC-1155 Liquid Split units for
USDC along a curve, so ownership of a revenue stream drains from founder to
buyers as units sell** — and cut everything that exists to support gated,
managed, multi-step raises. The end state should be deployable and legible in
one sitting: one contract, one transaction to launch, no server-side state
required to understand or participate in an offering.

## Diff mechanism

How this branch tracks divergence from mainline PACT: every mechanism in the
current system gets a **keep / cut / change** verdict below, with the
rationale inline. When we touch code, the PR references the row it implements.
Rows marked `?` are undecided — resolve them here before writing code.

| Mechanism (mainline) | Verdict | Notes |
| --- | --- | --- |
| Liquid Split as cap table (1,000 units, id 0) | keep | The primitive. Untouched. |
| Bonding curve pricing | ? | Keep the curve, or flatten to fixed-price? Curve is most of the pricing code. |
| Minimum threshold + failure state | cut? | See "Contract tweaks" — removing it deletes the refund machinery and the refund exploit with it. |
| `refund()` / `refundAll()` | cut? | Falls out of removing the minimum. |
| Escrowed unit delivery (pact-equity fix) | n/a if min cut | Escrow only exists to protect refunds. No refunds → immediate delivery is safe. |
| Buyer allocation links (fixed $ amounts, wallet-gated) | cut | Open participation: anyone can buy any amount up to what's unsold. |
| Issuer dashboard (`status` page lifecycle actions) | shrink | Read-only state + `close` + `withdraw`. No allocation management. |
| Server DB (`server/db.js`, `server/pacts.js`) | cut | Contract + events are the only source of truth; frontend reads chain/indexer directly. |
| `sweepDistributions()` (pact-equity fix) | keep | Small, closes the stranded-revenue hole, enables revenue-first launches. |
| Revenue-first posture (route revenue before launch) | keep | It's a posture + sweep function, not complexity. |
| Waterfall / note variant (pact-note) | out of scope | Later, if ever, on this branch's simpler base. |

## Contract tweaks (proposed)

1. **Delete the minimum raise.** Every sale is final: `buy()` transfers USDC
   in and units out in one state, no `minMet`, no failure path, no
   `deposits[]` accounting. This removes roughly half the Offering's state
   machine and the entire refund exploit surface (see pact-equity.md
   "Refund exploit") structurally rather than by adding escrow.
   - Cost: buyers lose all-or-nothing protection. Mitigation: revenue-first
     means they're buying a flowing pipe, not a promise — partial fills still
     pay.
2. **Add `sweepDistributions()`** as specced in pact-equity.md: permissionless,
   claims the Offering's accrued share on unsold units, forwards anything
   beyond escrow obligations to treasury. With no deposits to protect, the
   escrow-obligation math collapses to `raised - withdrawn`.
3. **Immutable-at-deploy config.** Price params, carve-out size, treasury —
   set in the constructor / factory call, no owner setters. One transaction
   deploys split + offering fully configured.
4. **Keep:** `withdraw()` (proceeds to treasury), `close()` (return unsold
   units to treasury, end sales).

## Simplified end state

```text
factory tx (one shot)
  ├─ deploys Liquid Split (founder units → founder, carve-out → Offering)
  ├─ deploys Offering (immutable params)
  └─ founder points revenue source at the split  ← the act of good faith

then, forever:
  buy(units)            anyone, USDC in / units out, priced on the curve
  sweepDistributions()  anyone, unsold-unit revenue → treasury
  withdraw()            owner, proceeds → treasury
  close()               owner, unsold units → treasury, sales end
```

Surfaces that remain: a create page (one form → one tx), a buy page (paste an
offering address, see price + revenue history, buy), and a read-only status
view. No accounts, no allocations, no database rows.

## Open questions

- **What does "clanker" commit us to?** If the name implies agent/bot
  deployability (à la Clanker on Base), the factory needs a single-call,
  no-UI-required path and fully onchain discoverability. Cheap to support if
  decided now.
- **Curve vs fixed price.** The curve rewards early buyers and is already
  built; fixed price is simpler to explain. Which does the stripped version
  want?
- **Instrument story without a minimum.** "All-or-nothing crowdfund" becomes
  "open-ended sale." Does that change how we talk about it, or any legal
  posture?
- **Indexing.** Killing the server DB means the buy/status pages need chain
  reads or the Splits indexer for everything (holders, price history,
  distributions). Is the existing explorer proxy enough?
