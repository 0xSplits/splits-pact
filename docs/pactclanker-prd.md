# PACTCLANKER PRD (working draft)

Status: sketch, lives on branch `pactclanker`. Everything below is a proposal
until marked decided. Two models are on the table:

- **Model A** (below): stripped-down PACT — same primitive (sell Liquid Split
  units for USDC on a curve, proceeds to founder), fewer moving parts.
- **Model B rev 2** ("Crowd-launched vanilla Clanker", working name
  **PartyClanker**): the direction currently favored — a crowd pools ETH
  all-or-nothing and launches a completely standard Clanker coin; nobody is
  paid; the crowd's return is the pre-bought coins, a vault bonus, and the
  perpetual trading-fee stream, all pro-rata to Liquid Split units.

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

## Model B rev 2: crowd-launched vanilla Clanker (working name: PartyClanker)

Rev 2 folds in two artifacts produced outside this doc (2026-07-12): the
PartyClanker v0 build prompt and the interactive economics model. Rev 1's
LP-pairing settlement is superseded by the **vanilla Clanker launch path**;
rev 2 also settles the founder question harder than rev 1 did.

The pivot: **nobody is paid, ever.** The raise is not a sale of anything —
it is a crowd pooling ETH, all-or-nothing, to launch a completely standard
Clanker coin as a single fair actor. The creator receives no money, no
special units, no vault of their own, no fee carve-out. They contribute like
everyone else — in many launches the "creator" is just the group member who
clicked the button. Their only edge is the time-weighting's natural
advantage: they know about the launch earliest and can commit at t=0, an
earned, capital-backed advantage rather than a granted one.

The crowd's return is threefold, all pro-rata to Liquid Split units: the
pre-bought coin position (streamed), the vault bonus (streamed slower), and
a cut of every trading fee (perpetual).

**Live modeler:** [pactclanker-model.html](pactclanker-model.html) — a
backer-POV calculator. House rules (DD-3..6) are locked; the free knobs are
your commit size/timing, party size, the crowd, and frame assumptions. It
computes your units (with the DD-4 dust rule live), your % of supply, entry
price vs list and vs a TGE buyer, the claim schedule, and fee payback.
Client-side; open in a browser.

**Playable mock:** `/party` in the app (`npm run dev`) — the full backer UX
with mock data and a floating mock-state card (lifecycle states, crowd
size/total, a clock scrubber). Throwaway styling, real mechanism math. See
"UX prototype findings" below for what it established.

### Mechanism sketch

```text
1. announce()   creator/agent creates a LaunchPool: token params, window,
                min raise, MAX raise, vault multiple + stream lengths
2. deposit()    backers deposit ETH during the window (DD-5); weight
                accrues per second: accumulator += amount x elapsed_seconds.
                withdraw() wipes accrued weight pro-rata (DD-1).
                deposits past the max raise revert (DD-4)
3. finalize()   at close, if min met, one settlement transaction:
                  ├─ dust pass: refund any depositor whose weight share
                  │    rounds below 1 unit (DD-4); recompute shares
                  ├─ compute list mcap = 5x raised (DD-6 rev 2)
                  ├─ call Clanker factory, vanilla v4 config:
                  │    ├─ DevBuy extension funded with the pool — the
                  │    │    atomic first swap, inside the deploy tx,
                  │    │    before any sniper can act
                  │    ├─ Vault extension = the early-backer bonus,
                  │    │    beneficiary = Splits Vesting stream → LS
                  │    ├─ reward recipient = the Liquid Split, forever
                  │    └─ standard MEV module, standard locked LP
                  ├─ mint Liquid Split (1000 units) allocated by
                  │    time-weighted shares (quantized to 0.1%)
                  └─ arm streams: pre-bought coins over ~7d, vault
                       slower (≥3x), both terminating at the LS
4. refund()     if min not met at close: deposits return, nothing launched
```

**The settlement contract is the creator-of-record.** Because it is the
deployer, every role Clanker grants a creator — token admin, dev-buy
originator, vault admin — lands on an immutable contract whose only behavior
is streaming to the crowd. Egalitarianism is enforced by construction: the
"creator" address provably cannot keep anything.

### Two incentives, two questions (decided)

Time-weighting and the vault bonus are not competing designs — they answer
different questions, and rev 2 keeps both:

- **Vault bonus** answers *"why commit before TGE instead of buying at
  launch?"* — bonus coins per coin the pool bought, streamed slower. It also
  arithmetically cancels the pre-buy's own price impact (the dev buy fills
  above list; free vault coins pull the crowd's blended entry to ~0.62x
  list — constant at every party size under DD-6 rev 2).
- **Time-weighted accumulator** answers *"why deposit on day one instead of
  the last block?"* — without it, unit allocation is time-neutral and the
  window degenerates into a last-block pileup with no mid-raise demand
  signal. It is also the creator's honest compensation (first to know =
  first to commit).

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

Lock vs wipe-on-withdraw is therefore a product choice, not a security one —
see DD-1 below.

### Design decisions

Mechanism design is being worked out in collaboration with Abram. DD-1 and
the parameters of DD-4 are the open collab items; DD-2, DD-3, and DD-5 are
decided.

#### DD-1: Withdrawal policy — OPEN (leaning withdrawable)

Both options are exploit-free; this is signal integrity vs backer optionality.

**Withdrawable any time, wipe weight pro-rata on withdraw** (MetaDAO posture)

- Pro: backers keep an exit option the whole window — can respond to new
  information instead of being trapped by an early commitment.
- Pro: lowers the psychological bar to depositing early, which is exactly
  the behavior time-weighting wants to encourage.
- Pro: matches a mechanism running live in production (MetaDAO), so the
  behavioral dynamics are observable, not theoretical.
- Con: early deposits are free options — a whale can park capital early to
  manufacture momentum and pull it in the last block. The weight wipes, but
  the social proof already worked.
- Con: mid-raise totals are soft; the founder's demand signal is
  provisional until the final block, and backers must monitor the sale
  (MetaDAO's docs say as much).
- Con: slightly more accounting (pro-rata wipe on partial withdraw), though
  still O(1) per op.

**Locked once deposited, refund only on failure**

- Pro: every mid-raise number is real committed capital — unfakeable demand
  signal, no last-block exodus, no monitoring burden.
- Pro: simplest possible accounting (no withdraw path during the window).
- Con: backers wear full risk from deposit onward; rational response is to
  deposit late, which fights the time-weighting incentive head-on.
- Con: harsher UX for exactly the early believers the mechanism is meant to
  reward.

Current lean: **withdrawable** — optionality for backers fits the crowdfund
framing, and the momentum-theater risk is partially self-limiting (a
last-block whale exit is visible onchain and torches the launcher's and
whale's reputation with it).

#### DD-2: Founder reserve — DECIDED: 0% at v0

The v0 build prompt settles this harder than rev 1's middle path: no founder
cash, no founder units, no founder vault, no fee carve-out — and it
pre-rejects the compromise ("resist: 'surely 2% for the organizer' — that 2%
recreates the promoter"). Rationale: radical egalitarianism is both the
differentiator (the flattest launch structure on any chain) and the legal
mitigant (the moment the pool pays a person, the group is financing someone
and the product changes legal category).

The creator's compensation is the time-weighting's natural advantage: they
can commit at t=0 with full knowledge. Earned, capital-backed, same terms as
everyone.

Parked to v2/v3: the founder-reserve-as-barterable-asset idea (a reserved
fee-split slice is retained future profits the founder can later sell for
capital — literally what mainline PACT sells; clean recursion between the
products). It stays interesting and stays out of v0.

#### DD-3: Weight function — DECIDED: linear dollar-seconds, no fill boost

`accumulator += amount x elapsed_seconds`, share = accumulator / total.
Time-weighting is confirmed in (see "Two incentives" above) — it composes
with the vault rather than competing with it. MetaDAO's fill boost stays
out: it's the bespoke, parameter-heavy part of their design (boost curve
shape, sparsity measurement, path-dependence), and these contracts ship
unaudited — see "Complexity budget" below. Revisit if linear weighting
demonstrably over-rewards block-one whales on long windows.

#### DD-4: Dust, minimums, and a max raise — direction decided, params open

The Liquid Split's 0.1% quantization is load-bearing in this design: units
are the *only* asset, so a backer whose share rounds to zero units gets
nothing from any of the three legs. Three interlocking rules:

- **Dust refund (the guarantee).** At finalize, any depositor whose
  time-weighted share rounds below 1 unit is refunded in full and excluded
  from the launch. Safe in one pass: removing dust only *increases*
  everyone else's shares, so no one else can drop below the threshold from
  the removal. Side effect: rounding up to a whole unit is incentive to
  commit more / earlier.
- **Max raise (the sizing anchor).** A hard cap on total deposits, set at
  announce. This is what lets backers size appropriately: $100 is a fine
  check into a $1k raise and dust in a $1M raise — a $10k cap tells
  everyone what game they're in before they commit. Deposits past the cap
  revert (capacity can reopen if someone withdraws, DD-1). Under DD-6
  rev 2 the cap no longer prices anything (the mcap scales with the actual
  raise); it caps party size, anchors dust/min sizing, and a full pool
  restores scarcity-urgency that pure time-weighting lacks.
- **Min deposit (the soft filter).** A static floor (e.g. maxRaise / 1000)
  screens obvious dust at the door. It cannot *guarantee* a unit under
  time-weighting (a floor-sized deposit in the last minute still has tiny
  weight) — the dust refund is the guarantee; the floor just reduces how
  often it fires.

Edge case: the min-raise check must apply **net of dust refunds** — a pool
that clears the minimum gross could fall below it after the dust pass, and
launching on the gross number would launch a raise that "failed."

Open params: the cap size per template, the floor formula, and whether the
dust threshold is exactly 1 unit or slightly above.

#### DD-5: Raise currency — REVISED: raise in ETH, pool pairs WETH

Facts verified against Clanker docs: arbitrary quote tokens are
permissionless since v0.3.1, but USDC is not on the supported quote-token
list (WETH, cbBTC, DEGEN, CLANKER, ANON, HIGHER, A0x, NATIVE) — a USDC pool
is off the indexed/frontend path and violates the "indistinguishable from
any other Clanker launch" principle. And the DevBuy extension is
ETH-denominated (`ClankerUniv4EthDevBuy`): the dev buy starts from ETH no
matter what the pool pairs against.

Rev 2 initially chose a USDC raise with a USDC→ETH swap inside finalize.
Revised to **raise in ETH** on a second look: the swap would be the only
non-Clanker moving part in the settlement transaction — the riskiest tx in
the system — and deleting it buys real simplicity (no router dependency, no
minOut/slippage handling, no sandwich surface at close). USDC deposits never
touch the dev-buy path anyway, so ETH-in/ETH-through is the straightest
line.

Cost accepted: DD-4's sizing rules (min, max, dust) are ETH-denominated and
float against the dollar during the window. Mitigations: windows are short
(days), and the UI shows live USD equivalents next to every ETH figure so
backers still size in dollars mentally.

#### DD-6 (rev 2): Vault shape and raise-scaled list price — DECIDED

Rev 2 (2026-07-16, out of the UX prototype exercise): the rev 1 guardrail
("mcap ≥ 2.5x the MAX raise, fixed at announce") is **superseded**. Anchoring
to the max meant the deal's quality depended on fill level — an underfilled
party entered far under list while a full one brushed the ceiling, which made
every ownership number conditional on fill and made members quietly prefer
the party to stop growing. The prototype surfaced this as UI confusion; the
defect was in the spec.

New rule: **the list mcap is computed at finalize from the ACTUAL raise:
`mcap = 5x raised`. No floor.** This is possible because the token does not
exist until the settlement transaction, and arbitrary starting mcaps are
permissionless on Clanker (v0.3.1+; the 10 ETH figure is only their
default preset). With mcap = k x raised, party size cancels out of the
economics entirely — the deal is **size-invariant at every scale**: every
party enters at ~0.62x list, pays ~40% of the first outside buyer's price,
and holds ~32% of supply (~16% bought + ~16% bonus, 68% float) — whether it
raised 0.4 ETH or 10. (k = 2.5 would put the party at ~52% of supply —
thin float; 5x fixes that too.)

A 10 ETH mcap floor was briefly considered and rejected: it improves a
micro party's entry price (~0.52x) but collapses its supply share to ~6% —
a small crowd that launches a coin and owns almost none of it. Micro
launches must be the same product at smaller scale; what makes a party
feel good is "we own a third of this together," not the entry multiple.
Knock-on: the min raise must scale with the party-size preset (e.g. ~10%
of max), not sit at a fixed 1 ETH, or micro parties can't exist.

Consequences:
- **The join-more disincentive is fully dead.** No backer's arrival changes
  anyone's multiple; growth is purely positive, aligned with the 50+ holder
  survival thesis.
- **Max raise stops pricing anything** — it only caps party size (and
  anchors DD-4's dust/min sizing). The launcher form stays name + icon +
  size cap.
- Cost: the pool config is computed, not Clanker's stock preset — a small
  dent in "indistinguishable from any vanilla launch."

The rev 1 stress-case analysis below is retained for the record.

#### DD-6 (rev 1, superseded): Sizing guardrail and vault shape

The stress case that forced this: 10 ETH committed against a 10 ETH list
price with a flat 5% vault. The party's average fill hits ~2.05x list, spot
opens at ~4.2x, the party holds ~54% of supply (~46% float), and blended
entry is ~1.86x — heavy overpay into a market that is mostly the party
trading with itself. Break-even for that config is ~2.5 ETH; above it the
party enters above list. And the damage is shared: everyone's blended price
is pro-rata, so the marginal ETH dilutes every member including itself —
members quietly want the party to stop growing, at war with the
"bigger crowd = more holders = survival" force the design depends on.

Two rules, both adopted:

1. **Vault is a fixed multiple, not a fixed % of supply.** Bonus coins
   scale with what the party buys ("every coin the party buys comes with a
   matching bonus coin" at 1x). A flat % shrivels as the party grows (5%
   flat = 0.55x effective bonus for a 1 ETH party, 0.10x at 10 ETH); a
   fixed multiple divides the fill premium by (1 + multiple) at every size.
   Cost: the vault's supply share floats — card copy handles it. (The
   modeler already implements this shape; the flat-% framing in the early
   wireframes is superseded.)
2. **Creation-time validation: starting mcap ≥ ~2.5x the max raise.**
   Locked at launch with the rest of the immutable config. This bounds the
   worst case: blended entry stays ≤ list at max exactly when the fill
   premium at max ≤ (1 + multiple) — with a 1x vault, mcap ≥ ~2.2x max
   clears it, and 2.5x adds margin (10 ETH max on a 25 ETH list: fill
   ~1.4x, spot ~2x, blended ~0.7x). A house rule, not a launcher knob.

Two honesty notes recorded with the decision:

- The fixed multiple alone does NOT pin blended entry below list at every
  size — that claim only holds inside the guardrail. Absolute cost basis
  rises with party size under any vault shape (the dev buy walks the
  curve); the guardrail bounds it, nothing eliminates it.
- The join-more incentive depends on the frame. Absolute ("you enter at
  1.6x list") degrades as the party grows; relative to a TGE buyer
  ("you pay 0.4x what the first outside buyer pays" =
  1 / ((1 + multiple) x premium)) improves as the party grows, at every
  size. The UI should show both, headline the relative number, and the
  join card needs the live readout either way: "at the current 8 ETH,
  this party enters at 1.6x list."

### Complexity budget

These contracts will be mostly unaudited; simplicity is a design input, not
a nice-to-have. Ranked by risk:

1. **The accumulator is NOT the risky part.** Per-user `(balance, accrued,
   lastUpdate)` updated on every deposit/withdraw, plus the same three
   fields globally, is the Synthetix StakingRewards / MasterChef accounting
   shape — one of the most battle-tested patterns in DeFi. O(1) per
   operation, no loops, ~50–100 lines. Wipe-on-withdraw adds one line
   (`accrued -= accrued * amount / balance`).
2. **The settlement transaction is the risky part.** One transaction
   spanning: the Clanker factory (vanilla deploy + DevBuy + Vault + reward
   config), Splits Vesting (stream arming), and the Liquid
   Split factory (mint with full allocation arrays). Every Clanker-side
   piece is a stock, allowlisted, audited v4 component used thousands of
   times — the new surface is only the adapter that sequences them.
3. **Distribution mechanics.** The dust pass and LS mint need the full
   `accounts[]` + `initAllocations[]` arrays in the finalize tx, so the
   depositor list must be stored onchain and finalize gas grows with backer
   count (bounded: LS quantization caps meaningful holders at 1000).
   Everything downstream (coin streams, fees) flows through the LS —
   claim-based, no loops.

What we deliberately do NOT build: fill boost (DD-3), oversubscription caps
with partial refunds (MetaDAO has these; our max raise is a hard revert and
the min is one bool), a custom Clanker extension or LP routing (rev 1's
LP-pairing idea required allowlisting and a nonstandard pool — dropped),
and any governance/futarchy machinery.

### Where the pooled ETH goes

All of it funds the **dev buy** — Clanker's DevBuy extension, the atomic
first swap executed inside the deploy transaction. The crowd is,
collectively, the "dev." Consequences:

- The crowd's fill happens before any block-zero sniper can act, and
  Clanker's MEV modules guard the window right after. The crowd doesn't
  out-race snipers; it makes the race start behind it.
- The money still ends up as the pool's paired-side reserves — via the swap
  — but the crowd gets coins for it instead of donating pure depth (why rev
  1's LP-pairing was dropped: same economic end, nonstandard path, and the
  crowd got nothing for its money).
- One honest, disclosed cost: the pre-buy walks the launch curve, so the
  crowd's average entry is above list price. Identical for every unit
  holder, fixed by construction (mcap = 5x raised, DD-6 rev 2), and more
  than offset by the vault bonus (blended entry ~0.62x list at any size).

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

### What "done" looks like (from the v0 build prompt)

One real group (50+ people, each in their own wallet), one vanilla Clanker
coin on Base mainnet, launched through the full path: ETH in → units →
all-or-nothing close → one settlement tx → coin streaming over ~7 days →
fees claimable forever — **and the refund path exercised at least once (a
deliberately failed test raise) with real money, documented publicly.** The
proof is a launch anyone can verify on a block explorer, where the "creator"
address is a contract that provably can't keep anything.

### UX prototype findings (2026-07-16)

A day of building the playable mock + locked modeler settled real design
questions. Recorded here so they survive the throwaway code:

1. **The deal fits on one card.** Four check-marked lines, a raise bar, and
   two ownership numbers explain the entire mechanism to a stranger. The
   biggest UX risk — "is this explainable?" — is retired.
2. **The floor is the hero number.** The honest emotional shape of
   time-weighting is: *your guaranteed minimum only ever rises* (capacity
   weight decays every second; joins replace reserved weight 1:1; yanks
   raise it — a pure ratchet), while *your ceiling drops when humans act*.
   Show ownership as a range: "X% if it fills (only goes up) … Y% if no one
   else backs." The raw live-accumulator share was tried and CUT: it drifts
   toward pro-rata-by-balance, so early/small backers watch it decay —
   mathematically honest, emotionally wrong, and it confused its first
   viewer. Contract read functions should serve floor + at-close-projection
   directly.
3. **The party list must be event-quiet.** Sort and display by at-close
   projections: the list holds perfectly still under ambient time, and
   moves (with a spring) only when someone backs, arrives, or yanks —
   motion means a human acted.
4. **Dust/bump is legible game drama.** A partier falling below 0.1% slides
   to a "refunded at close" section with a 😭 beat. DD-4's rule needs no
   explanation when the UI performs it. Getting bumped from your own party
   (launcher included) works the same way.
5. **House rules validated; launcher form collapsed.** Every knob removed
   made the product more explainable. With DD-6 rev 2, max raise prices
   nothing — the launcher form is name + icon + party-size cap, full stop.
6. **DD-1 pressure-tested.** The mock implements withdraw-any-time with
   full pro-rata weight wipe ("Yank"), and the game feel depends on it
   (floor rising on yanks, capacity reopening). Strengthens the
   withdrawable lean; still to be confirmed with Abram.
7. **Copy that survived playtesting:** "Back" / "Yank" (not Yolo), the
   range framing above, "goal N ETH" as the bar's full width until the goal
   is met (then rescale to max with a "goal met ✓" tick) — a bar
   denominated by max reads as perpetually underfunded.
8. **Spec defect found and fixed:** fixed-at-announce mcap (DD-6 rev 1)
   made the deal fill-dependent and members anti-growth → replaced by
   raise-scaled mcap at finalize (DD-6 rev 2).
9. **Still unproven (all social, none mechanical):** the launcher create
   flow, the share/invite loop (likely a Farcaster frame — the join card is
   already frame-shaped), and launched-state retention (the 90-day claim
   screen had one design pass).

### Model B open questions

(Withdrawal policy → DD-1; founder reserve → DD-2 decided; weight function
→ DD-3 decided; granularity/min/max → DD-4; raise currency → DD-5 decided.)

- **DevBuy output routing.** Confirm in `ClankerUniv4EthDevBuy` whether the
  dev-buy recipient is configurable or lands with the deployer. Either
  works (the settlement adapter is the deployer and can stream what it
  receives), but the answer shapes the adapter. First thing to check.
- **"50+ day-one holders" vs everything-streams.** The survival stat is
  about distinct wallets holding the coin on day one, but here day-one
  supply sits in a vesting stream terminating at the LS until people claim.
  If the effect is behavioral, streamed claims may count; if it's about
  what explorers/traders see, a launch whose crowd supply visibly sits in
  two contracts for a week reads differently. Needs a position.
- **Vault stream parameters.** Multiple (1.0x = "two coins for the price of
  one" is the recruiting number; higher multiples thin the outside float)
  and stream ratio (bonus ≥3x slower than the bought coins, per the model's
  anti-dump check).
- **Unit transferability at v0.** Flywheel vs optics; genuinely open.
- **Platform fee share.** Does any slice of the 80% creator-side fee go to
  an interface/platform at v0, or does everything go to units?
- **Pin the empirical claims.** The 1.27M-launch study (50+ holders, 86%
  never trade, vault→~2x survival odds) is load-bearing for several checks
  in the model; sources should be linked before the PRD treats it as fact.
- **Does anything remain "PACT"?** Model B is a launchpad with a
  revenue-split cap table attached. Naming/positioning question — the
  working name is PartyClanker.

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
