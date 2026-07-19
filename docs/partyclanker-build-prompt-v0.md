# Build Prompt — Crowd-Launched Vanilla Clanker (working name: PartyClanker v0)
### Rev 2. Vanilla launch only: the crowd funds the creator pre-buy; pre-buy + vault stream to the crowd; nobody is paid; the creator is a peer.

*Prepared 2026-07-12. Explicitly NOT built on the presale extension. Inputs: zach's model, Clanker v4 vanilla deployment (factory + DevBuy + Vault extensions + reward recipients), splits-pact repo (Offering escrow + Liquid Split), session research. Status: shaping — steelman is the contract, decision points stay open.*

---

## 1. The model

A crowd pools USDC, all-or-nothing. On success, one settlement transaction performs a **completely vanilla Clanker launch** — standard factory, standard single-sided LP (locked forever), standard MEV protection — configured so that:

- The pooled money funds the **creator pre-buy (DevBuy extension)**: the atomic first swap, executed inside the deploy transaction, before any external buyer or sniper can act. The crowd is, collectively, the "dev."
- The **pre-bought coin + the vault allocation stream to the crowd** — both flow into the Liquid Split over a short window, pro-rata to units.
- **Trading fees → the Liquid Split, forever** (units as the immutable reward recipient).
- **No money is sent to the creator. Ever.** The creator contributes USDC like everyone else, holds units pro-rata like everyone else, and has no special allocation, no vault of their own, no fee carve-out. In many launches the "creator" is just the group member who clicked the button.

The crowd's return is threefold, all pro-rata to units: the coin position (streamed), the vault allocation (streamed), and the fee income (perpetual).

## 2. Why the vanilla path is the right substrate

- **Zero Clanker dependencies.** DevBuy, Vault, multi-recipient fees, and MEV modules are stock, allowlisted, audited v4 components used thousands of times. We change nothing on their side — no custom extension, no allowlisting request, no partnership prerequisite. The launch is indistinguishable from any other Clanker launch except for who funded it and where the outputs point.
- **The coin is a normal coin.** Same locker, same pool shape, same fee mechanics as every other Clanker token — no exotic structure for traders, aggregators, or the Clanker frontend to special-case.
- **The atomic pre-buy is the fair-entry mechanism.** Being inside the deploy transaction means the crowd's fill happens before block-zero snipers, and Clanker's MEV modules (delay/auction/decaying fees) guard the window right after. The crowd doesn't out-race snipers; it makes the race start behind it.
- **One honest cost, shared equally:** the pre-buy walks the launch curve, so the crowd's average entry is above list price — that's the price of being first, it's identical for every unit holder, and it's tunable (bigger configured starting mcap or smaller pre-buy → smaller markup). This is disclosed, not hidden — the model artifact computes it.

## 3. What actually gets built

One new contract path plus wiring. The PACT escrow (splits-pact's Offering, adapted) pools USDC and mints units; at close, the settlement adapter:

1. Converts pooled USDC to the pool's quote asset as needed (Swapper or a direct route),
2. Calls the Clanker factory with a vanilla config: DevBuy funded with the pool (output directed to the stream), Vault sized per template (beneficiary = a Splits Vesting stream into the Liquid Split), reward recipients = the Liquid Split at the chosen bps, standard MEV module,
3. Arms the streams (pre-buy tokens over ~7 days; vault per its schedule) — both terminating at the Liquid Split,
4. Done. Nothing left to operate, govern, or trust.

Failure path is inherited from PACT: minimum not met by close → everyone withdraws in full.

**Because the settlement contract is the deployer, it is also the "creator" in Clanker's eyes** — token admin, dev-buy originator, vault admin. Every role Clanker gives a creator lands on an immutable contract whose only behavior is streaming to the crowd. "The creator has equal rights to all other crowd-funders" is enforced by making the creator-of-record a contract with no owner privileges to abuse.

## 4. Steelman: what we ARE building

1. **A crowd that launches a coin as a single, fair actor.** Pooled all-or-nothing escrow (refunds are the trust primitive every durable precedent shares) → one atomic launch where the crowd is first by construction.
2. **Radical egalitarianism as the differentiator.** No founder cash, no founder vault, no team allocation, no privileged party — the flattest launch structure on any chain. Every prior design (including our own earlier sketches) carved something for someone; this carves nothing. Whatever gray remains in "pooled money, shared income," this maximizes every mitigant: no promoter is enriched, no one's efforts are being financed, the coordinator holds the same asset on the same terms.
3. **Units as the single asset.** One transferable Liquid Split unit = pro-rata claim on the streamed position, the streamed vault, and the perpetual fee income. Cash-flowing from day one (fees), fully distributed within days (streams), no cliff events.
4. **Distinct-wallet distribution as a design requirement.** 50+ real day-one holders was the strongest survival predictor in 1.27M launches, and manufactured single-wallet demand underperforms — so units and claims must resolve to each backer's own wallet. The crowd isn't simulating demand; it *is* the demand.
5. **Pre-committed everything.** Split percentages, stream lengths, fee bps, vault size: fixed at creation, executed atomically, no governance, no manager, no discretion after the deploy confirms.
6. **Stock parts end to end.** Clanker factory/extensions + Liquid Split + Splits Vesting; the only new surface is the escrow-to-factory settlement adapter.

## 5. Steelman: what we are NOT building

1. **Not the presale extension, or anything built on it.** Its architecture (per-wallet coin allocations, ETH to the creator) is the opposite of this design on both counts. We use the vanilla launch path only.
2. **Not a fundraise.** Zero dollars to any person — not the creator, not a team, not "costs." The moment the pool pays a person, the group is financing someone and the product changes legal category. That product (treasury, milestones, capital return) exists in the v2/v3 designs and stays parked.
3. **Not founder economics of any kind.** No special units, no carve-outs "for the work of launching." If a launcher wants upside, they put in USDC like everyone else. *Resist: "surely 2% for the organizer" — that 2% recreates the promoter.*
4. **Not an LP-routing custom extension.** Rev 1 of this doc considered sending proceeds to the pool's paired side; dropped — it required Clanker allowlisting and a nonstandard pool structure. The dev buy achieves the same economic end (the pool's money ends up as the pool's paired-side reserves, via the swap) through the standard path. The difference — the crowd gets coin for its money instead of donating pure depth — is a feature.
5. **Not a fund, not governance, not floors, not a platform, not new primitives, not "an investment"** — all carried over from rev 1 verbatim: one coin, one pool, one shot; nothing to vote on; no price support in v0; hand-launched for the first N groups; non-custodial stock contracts; and the honest description stays *"we pooled money to launch a coin together and we own its market's income."*

## 6. Open decision points

1. **DevBuy output routing** — confirm in the contracts whether the dev-buy recipient is configurable or lands with the deployer; either works (the settlement adapter is the deployer and can stream what it receives), but the answer shapes the adapter. *(First thing to check in `ClankerUniv4EthDevBuy`.)*
2. **Vault multiple and stream ratio** (existence settled: the vault is in — it IS the early-backer incentive). The vault streams bonus coins per coin the pool bought; it answers "why commit before launch instead of buying at TGE," and it arithmetically cancels the pre-buy's own price impact (buy fills above list; free vault coins pull the crowd's blended entry back down — sizeable to target blended ≈ 0.8–1.0x list). Open: the multiple (2x coins-per-dollar at 1.0x is the recruiting number; higher multiples grow the crowd's supply share and thin the outside float) and the stream ratio (bonus should stream meaningfully slower than the bought coins — ≥3x longer — so the lowest-cost-basis coins arrive slowest). Supporting evidence: 15%+ vault/airdrop launches showed ~2x adjusted survival odds in the launch-liquidity study, with no cliff-day dumps. The model artifact computes all of this live.
3. **Pre-buy size vs starting mcap** — governs the entry markup; needs a default rule of thumb (e.g., pre-buy ≤ ~50% of configured starting mcap keeps average entry under ~1.5x list; exact curve math depends on Clanker's multi-position shape, worth computing against the real pool presets rather than the constant-product approximation).
4. **USDC → quote-asset conversion** — raise in USDC (PACT as-is) and swap at settlement, vs raise in ETH. UX vs slippage-at-settlement tradeoff.
5. **Stream lengths** — ~7 days for the pre-buy position (meme-native, anti-collective-dump); vault stream longer if a vault exists.
6. **Unit transferability at v0** — flywheel vs optics; still genuinely open.
7. **Fee bps split** — how much of the 80% creator side goes to units (presumably ~all of it, given there's no founder) vs an interface/platform share, and whether a platform share exists at v0 at all.

## 7. What "done" looks like

One real group (50+ people, each in their own wallet), one vanilla Clanker coin on Base mainnet, launched through the full path: USDC in → units → all-or-nothing close → one settlement tx (vanilla deploy + funded dev buy + streams armed + fees pointed at the split) → coin streaming over ~7 days → fees claimable forever → and the refund path exercised at least once (a deliberately failed test raise) with real money, documented publicly. The proof-of-concept is a launch anyone can verify on a block explorer, where the "creator" address is a contract that provably can't keep anything.
