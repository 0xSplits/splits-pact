# PACTCLANKER PRD (working draft)

Status: sketch, lives on branch `pactclanker`. Everything below is a proposal
until marked decided. Two models are on the table:

- **Model A** (below): stripped-down PACT — same primitive (sell Liquid Split
  units for USDC on a curve, proceeds to founder), fewer moving parts.
- **Model B** (["Crowdfunded clanker launch"](#model-b-crowdfunded-clanker-launch)):
  the direction currently favored — no founder proceeds at all; the pool
  crowdfunds a Clanker token launch and everyone, founder included, is paid
  in tokens and a share of the locked-LP fee stream.

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

## Model B: crowdfunded clanker launch

The pivot: **rip out founder proceeds entirely.** The raise is not a sale of
the founder's carve-out — it is a crowdfund of a Clanker token launch. The
founder receives no USDC; they (like every backer) receive pro-rata tokens
and, optionally, a share of the launch's fee stream. This deletes the
self-dealing exploit at the root: with no proceeds pot, a founder deposit is
just a deposit — it costs real money and buys the same thing it buys anyone.

### Mechanism sketch

```text
1. announce()   founder/agent creates a LaunchPool: token params, window,
                founder carve-out (% of token supply, % of fee split), min raise
2. deposit()    backers deposit USDC during the window; weight accrues
                per second: accumulator += amount x elapsed_seconds.
                withdraw() wipes accrued weight pro-rata (see below)
3. finalize()   at close, if min met, atomically:
                  ├─ deploy Clanker token
                  ├─ pair pooled USDC + token supply into the LP (locked)
                  ├─ distribute token allocation pro-rata by weight
                  ├─ mint Liquid Split (1000 units) allocated by the same
                  │    weights (quantized to 0.1%) + founder carve-out
                  └─ set the Liquid Split as the Clanker fee-reward recipient
4. refund()     if min not met at close: deposits return, nothing launched
```

### Why time-weighting instead of a price curve

A pure pro-rata pool is time-neutral: $1 buys the same share whenever it
arrives, so rational backers wait until the last block and the founder gets
no demand signal mid-raise. A bonding curve fixes that by charging late
buyers a worse price. Time-weighting fixes it differently: early backers
earn more weight per dollar, and the "price" they pay for that edge is the
opportunity cost of committed capital — not a worse unit price.

This is how MetaDAO's launchpad works (verified against their docs):
`accumulator += committed_amount x elapsed_seconds`, share =
`your_accumulator / total_accumulator`, over a fixed (4-day) window, plus a
**fill boost** that multiplies weight for deposits made while the pool was
still sparse — rewarding early discovery, not just clock time. MetaDAO
allows deposits and withdrawals until the last second.

Withdrawals do NOT require locking to stay exploit-free. Rule: withdrawal
wipes accrued weight pro-rata (each dollar carries its own history;
withdrawn dollars lose theirs), and re-deposit restarts the clock. A
withdrawer-then-redepositor is then exactly equivalent to a fresh depositor
— weight can never exist without capital continuously backing it.

Lock vs wipe-on-withdraw is therefore a product choice, not a security one:

- **Wipe-on-withdraw** (MetaDAO posture): backers keep an exit option if the
  launch sours. Cost: early deposits are free options — a whale can park
  capital early to manufacture momentum and pull it in the last block; the
  weight wipes but the social proof already worked, and mid-raise totals
  are soft signals.
- **Lock**: every mid-raise number is real committed capital — unfakeable
  demand signal, no last-block exodus — at the cost of backers wearing full
  risk from deposit onward. Refunds only via the all-or-nothing failure
  path.

### Where the USDC goes

All of it pairs into the LP at finalize. Consequences:

- The launch price is fixed mechanically: `pooled USDC / tokens paired`.
  This — plus the carve-out sizes — is what the founder actually "sets."
- The pool is deep from block one, and the raise can't be rugged: the money
  became permanently locked liquidity, custodied by Clanker's locker.
- Backers effectively bought at the launch price; the market-buy alternative
  (pool sweeps the token at launch) just gifts the price impact to snipers.

### What Model B keeps from PACT

- **The Liquid Split, in a new role.** Clanker streams LP trading fees to a
  configurable reward recipient. Point that at a Liquid Split minted at
  finalize with allocations = the same time-weighted shares. Backers hold a
  perpetual fee-revenue cap table — PACT's revenue-split DNA — and
  mint-once-at-close fits the LS1155 constraint exactly, because final
  weights are only known at that moment.
- **All-or-nothing escrow.** `deposit`/`refund` is the surviving skeleton of
  the Offering's min-raise machinery.

What dies: the bonding curve, `buy()`, `withdraw()` (no proceeds exist),
`closeAndWithdraw()` (becomes `finalize()`), allocation links, the server DB.
The diff-mechanism table above describes Model A; if Model B is chosen it
gets its own table, since the fork is structural, not a trim.

### Model B open questions

- **Founder comp shape.** Fixed % of token supply, % of the fee split, or
  both? Vesting/lock on the founder's tokens to prevent launch-dump?
- **Lock vs wipe-on-withdraw.** See above — signal integrity vs backer
  optionality. MetaDAO chose withdrawable; do we?
- **Weight function.** Linear dollar-seconds is the simple default; does it
  over-reward block-one deposits on long windows (first-hour whale gets ~2x
  a mid-window depositor)? MetaDAO's fill boost (extra weight while the
  pool is sparse) is an alternative shape worth considering.
- **Fee-split granularity.** LS quantizes to 0.1%; small backers may round
  to zero units on the fee split even though token distribution (18
  decimals) pays them fine. Dust rule needed; token-only for the long tail?
- **Clanker integration surface.** Which Clanker version/factory, what the
  reward-recipient config actually allows, single-tx atomicity of
  finalize() across token deploy + LP + LS mint.
- **Does anything remain "PACT"?** Model B is a launchpad with a
  revenue-split cap table attached. Naming/positioning question.

## Open questions (Model A)

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
