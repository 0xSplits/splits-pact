// PartyClanker playable mock — UX playground only, no chain, no API.
// All five lifecycle states are switchable from the dev bar so the flow can
// be felt end-to-end before any contract work. House rules follow the PRD:
// fixed-multiple vault (DD-6), mcap = 2.5x max raise (DD-6), time-weighted
// shares (DD-3), dust bar at 1 unit / 0.1% (DD-4), ETH-denominated (DD-5).
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './party.css';
import { Button } from '../components/ui.jsx';

const S = 1e9;
const HOUSE = {
  ticker: '$PARTY',
  icon: '🎈',
  min: 1,            // ETH
  max: 10,           // ETH
  mcap: 25,          // ETH — 2.5x max, per DD-6
  mult: 1,           // vault: one bonus coin per coin bought, per DD-6
  windowDays: 4,
  boughtStreamDays: 7,
  bonusStreamDays: 90,
  dustShare: 0.001,  // 1 unit of 1000
};

// Everyone else in the party: pledge size + when in the window they joined.
const CROWD = [
  { name: 'abram.eth', eth: 0.5, tFrac: 0.0, launcher: true },
  { name: 'gerry.eth', eth: 1.2, tFrac: 0.2 },
  { name: 'kae.eth', eth: 0.8, tFrac: 0.3 },
  { name: 'mint.eth', eth: 0.65, tFrac: 0.45 },
  { name: 'dot.eth', eth: 0.05, tFrac: 0.5 },
  { name: 'ren.eth', eth: 0.006, tFrac: 0.1 },
  { name: 'pip.eth', eth: 0.003, tFrac: 0.3 },
];

const NOW_T = 0.4; // "now" sits at day 1.6 of the 4-day window in the mock

const weightOf = p => p.eth * (1 - p.tFrac);
const fmtEth = v => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + ' ETH';
const fmtPct = v => {
  const p = v * 100;
  return (p < 10 && p % 1 ? p.toFixed(p < 1 ? 2 : 1) : p.toFixed(0)) + '%';
};
const fmtCoins = v => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0));

// Dev buy against the launch curve with a fixed-multiple vault (DD-6).
// Constant-product approximation — same math as docs/pactclanker-model.html.
function partyEcon(D) {
  const p0 = HOUSE.mcap / S;
  let v = 0, bought = 0;
  for (let i = 0; i < 25; i++) {
    const x0 = S - v, y0 = x0 * p0;
    bought = x0 * D / (y0 + D);
    v = HOUSE.mult * bought;
  }
  const y0 = (S - v) * p0;
  const prem = 1 + D / y0;
  return {
    bought, vault: v,
    partyShareOfSupply: (bought + v) / S,
    prem,                                   // avg fill vs list
    spot: prem * prem,                      // pool price right after launch
    blended: prem / (1 + HOUSE.mult),       // party's cost per coin vs list
    vsTge: 1 / ((1 + HOUSE.mult) * prem),   // party price / first outside buyer's price
  };
}

function usePartyState(joined) {
  // Your pledges: tranches of {eth, tFrac}. Joined mock = 1 ETH early on.
  const [pledges, setPledges] = useState([]);
  useEffect(() => { setPledges(joined ? [{ eth: 1, tFrac: 0.25 }] : []); }, [joined]);

  const yourEth = pledges.reduce((s, p) => s + p.eth, 0);
  const yourWeight = pledges.reduce((s, p) => s + weightOf(p), 0);
  const crowdEth = CROWD.reduce((s, p) => s + p.eth, 0);
  const crowdWeight = CROWD.reduce((s, p) => s + weightOf(p), 0);
  const raised = crowdEth + yourEth;
  const totalWeight = crowdWeight + yourWeight;

  const yourShare = totalWeight > 0 ? yourWeight / totalWeight : 0;
  // Worst case: the rest of the max arrives this instant at full remaining weight.
  const capacityLeft = Math.max(0, HOUSE.max - raised);
  const floorShare = yourWeight > 0 ? yourWeight / (totalWeight + capacityLeft * (1 - NOW_T)) : 0;

  return { pledges, setPledges, yourEth, yourWeight, yourShare, floorShare, raised, capacityLeft, totalWeight };
}

function Countdown({ phase }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (phase !== 'funding') return <span className="time">0h 00m 00s</span>;
  // Freeze "now" at page load; the visible clock runs from there.
  const remainMs = (1 - NOW_T) * HOUSE.windowDays * 86400e3 - (Date.now() - pageLoad);
  const s = Math.max(0, Math.floor(remainMs / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return <span className="time">{d}d {String(h).padStart(2, '0')}h {String(m).padStart(2, '0')}m {String(s % 60).padStart(2, '0')}s</span>;
}
const pageLoad = Date.now();

function PartyHeader({ phase, state }) {
  const othersFrac = (state.raised - state.yourEth) / HOUSE.max;
  const youFrac = state.yourEth / HOUSE.max;
  const decayWeight = 1 - NOW_T;
  return (
    <div className="pc-card">
      <div className="pc-token">
        <div className="pc-icon">{HOUSE.icon}</div>
        <div>
          <div className="pc-ticker">{HOUSE.ticker}</div>
          <div className="t-muted text-sm">a vanilla Clanker coin, launched by this party — nobody is paid</div>
        </div>
      </div>
      <div className="pc-bar">
        <div className="fill" style={{ width: `calc(${Math.min(1, othersFrac) * 100}% - 2px)` }} />
        {youFrac > 0 && <div className="you" title={`you: ${fmtEth(state.yourEth)}`} style={{ left: `calc(${othersFrac * 100}% + 2px)`, width: `${youFrac * 100}%` }} />}
        <div className="min-tick" style={{ left: `${(HOUSE.min / HOUSE.max) * 100}%` }}><span>min {HOUSE.min} ETH</span></div>
      </div>
      <div className="pc-bar-caps">
        <span><b className="t-ink">{fmtEth(state.raised)}</b> raised{state.yourEth > 0 ? <> — <span style={{ color: 'var(--marker)' }}>{fmtEth(state.yourEth)} you</span></> : null}</span>
        <span>max {HOUSE.max} ETH</span>
      </div>
      <div className="pc-clock">
        <Countdown phase={phase} />
        {phase === 'funding' && (
          <span className="pc-decay">left in the window — 1 ETH yolo'd now carries <b>{decayWeight.toFixed(2)}</b> weight; the same ETH on day one carried <b>1.00</b></span>
        )}
        {phase === 'closing' && <span className="pc-decay">window over — goal met, waiting on launch</span>}
        {phase === 'launched' && <span className="pc-decay">launched — streams running, fees flowing</span>}
        {phase === 'failed' && <span className="pc-decay">window over — goal missed, refunds open</span>}
      </div>
    </div>
  );
}

function DealCard({ econ, raised }) {
  return (
    <div className="pc-card">
      <h2 className="mt-0 text-lg font-bold mb-3">This party gets</h2>
      <ul className="pc-gets">
        <li><span className="tick">✓</span><span>100% of the dev buy — the first fill, before any sniper</span></li>
        <li><span className="tick">✓</span><span>A matching bonus coin for every coin the party buys <span className="why">(streams over {HOUSE.bonusStreamDays} days)</span></span></li>
        <li><span className="tick">✓</span><span>100% of trading fees, forever</span></li>
        <li><span className="tick">✓</span><span>100% refunded if the goal fails</span></li>
      </ul>
      <div className="pc-readouts" style={{ marginTop: 14 }}>
        <span>At the current {fmtEth(raised)}, this party enters at <b>{econ.blended.toFixed(2)}x list</b> — every partier pays <b>{Math.round(econ.vsTge * 100)}%</b> of what the first outside buyer pays.</span>
        <span>Party would hold <b>{fmtPct(econ.partyShareOfSupply)}</b> of supply ({fmtPct(econ.bought / S)} bought + {fmtPct(econ.vault / S)} bonus), leaving <b>{fmtPct(1 - econ.partyShareOfSupply)}</b> to the market.</span>
      </div>
    </div>
  );
}

function JoinCard({ state, econ }) {
  const [amt, setAmt] = useState('0.5');
  const eth = Math.max(0, parseFloat(amt) || 0);
  const capped = eth > state.capacityLeft;
  const useEth = Math.min(eth, state.capacityLeft);
  const w = useEth * (1 - NOW_T);
  const share = (state.totalWeight + w) > 0 ? w / (state.totalWeight + w) : 0;
  const floor = w > 0 ? w / (state.totalWeight + w + Math.max(0, state.capacityLeft - useEth) * (1 - NOW_T)) : 0;
  const floorUnits = Math.floor(floor * 1000);
  const dusty = useEth > 0 && floorUnits < 1;
  const yolo = () => state.setPledges(p => [...p, { eth: useEth, tFrac: NOW_T }]);
  return (
    <div className="pc-card">
      <h2 className="mt-0 text-lg font-bold mb-1">Join this party</h2>
      <div className="pc-input-row">
        <input inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} aria-label="Amount in ETH" />
        <span className="unit">ETH</span>
        <Button onClick={yolo} disabled={useEth <= 0 || dusty}>Yolo</Button>
      </div>
      <div className="pc-readouts">
        {capped && <span className="warn">Only {fmtEth(state.capacityLeft)} of room left — that's what would go in.</span>}
        <span><b>{fmtPct(share)}</b> of the party right now → at least <b>{fmtPct(floor)}</b> ({floorUnits} units) if the party fills.</span>
        {dusty
          ? <span className="bad">Too little to survive a full party — below the dust bar (0.1%), you'd be refunded at close. Yolo more.</span>
          : useEth > 0 && <span>Ownership only drifts down as more join; the floor number is yours to keep.</span>}
      </div>
    </div>
  );
}

function JoinedCard({ state, phase }) {
  const [amt, setAmt] = useState('');
  const [confirming, setConfirming] = useState(false);
  const eth = Math.max(0, parseFloat(amt) || 0);
  const useEth = Math.min(eth, state.capacityLeft);
  const topUp = () => { if (useEth > 0) { state.setPledges(p => [...p, { eth: useEth, tFrac: NOW_T }]); setAmt(''); } };
  const units = Math.floor(state.yourShare * 1000);
  const dusty = units < 1;
  return (
    <div className="pc-card">
      <h2 className="mt-0 text-lg font-bold mb-2">You're in</h2>
      <div className="pc-hero">
        <span className="big">{fmtPct(state.yourShare)}<span className="sub">of the party now</span></span>
        <span className="pc-stat">{fmtPct(state.floorShare)}<span className="sub">floor if it fills ({Math.floor(state.floorShare * 1000)} units)</span></span>
        <span className="pc-stat">{fmtEth(state.yourEth)}<span className="sub">pledged</span></span>
      </div>
      {dusty && <div className="pc-banner bad" style={{ marginTop: 10 }}>You've been diluted below the dust bar (0.1%) — at close you'd be refunded in full instead of joining the launch. Yolo more to rejoin the party.</div>}
      {phase === 'funding' && (
        <>
          <div className="pc-input-row">
            <input inputMode="decimal" placeholder="add more" value={amt} onChange={e => setAmt(e.target.value)} aria-label="Additional ETH" />
            <span className="unit">ETH</span>
            <Button variant="secondary" onClick={topUp} disabled={useEth <= 0}>Yolo more</Button>
          </div>
          <div className="pc-readouts">
            <span>New ETH joins at today's weight ({(1 - NOW_T).toFixed(2)}) — your earlier pledge keeps the weight it earned.</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="warning" onClick={() => setConfirming(true)}>Yank</Button>
          </div>
        </>
      )}
      {confirming && (
        <div className="pc-modal-scrim" onClick={() => setConfirming(false)}>
          <div className="pc-modal" onClick={e => e.stopPropagation()}>
            <h3 className="mt-0 text-lg font-bold mb-2">Yank your {fmtEth(state.yourEth)}?</h3>
            <p className="text-sm" style={{ color: 'var(--muted2)' }}>
              You get every wei back right now — and your weight goes to zero. If you re-join later,
              you start from scratch at that day's weight. Your spot frees up for someone else.
            </p>
            <div className="actions">
              <Button variant="secondary" onClick={() => setConfirming(false)}>Stay in</Button>
              <Button variant="warning" onClick={() => { state.setPledges([]); setConfirming(false); }}>Yank it all</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LaunchedCard({ state }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const econ = partyEcon(state.raised);
  const units = Math.floor(state.yourShare * 1000);
  const f = units / 1000;
  const yourBought = f * econ.bought, yourBonus = f * econ.vault;
  // Launched 2.1 days ago in the mock; the live clock keeps it moving.
  const daysSince = 2.1 + (Date.now() - pageLoad) / 86400e3;
  const bFrac = Math.min(1, daysSince / HOUSE.boughtStreamDays);
  const vFrac = Math.min(1, daysSince / HOUSE.bonusStreamDays);
  const feesTotal = 0.31; // ETH collected by the party so far (mock)
  if (units < 1) {
    return <div className="pc-card"><h2 className="mt-0 text-lg font-bold mb-2">Not in this one</h2><p className="text-sm" style={{ color: 'var(--muted2)' }}>You weren't in this party (or were refunded at close under the dust bar). The launch happened without you — the next party is a fresh start.</p></div>;
  }
  return (
    <div className="pc-card">
      <h2 className="mt-0 text-lg font-bold mb-2">Your side of the launch</h2>
      <div className="pc-hero">
        <span className="big">{fmtCoins((yourBought * bFrac + yourBonus * vFrac))}<span className="sub">coins claimable now</span></span>
        <span className="pc-stat">{units} / 1000<span className="sub">your units</span></span>
        <span className="pc-stat">{fmtEth(f * feesTotal)}<span className="sub">your fees so far</span></span>
      </div>
      <div className="pc-stream">
        <div className="lane">
          <div className="lane-top"><span>Coins your ETH bought — {HOUSE.boughtStreamDays}-day stream</span><b>{fmtCoins(yourBought * bFrac)} / {fmtCoins(yourBought)}</b></div>
          <div className="track"><div className="done bought" style={{ width: `${bFrac * 100}%` }} /></div>
        </div>
        <div className="lane">
          <div className="lane-top"><span>Bonus coins — {HOUSE.bonusStreamDays}-day stream</span><b>{fmtCoins(yourBonus * vFrac)} / {fmtCoins(yourBonus)}</b></div>
          <div className="track"><div className="done bonus" style={{ width: `${vFrac * 100}%` }} /></div>
        </div>
      </div>
      <div className="pc-input-row" style={{ marginTop: 4 }}>
        <Button>Claim coins</Button>
        <Button variant="secondary">Claim fees</Button>
      </div>
      <div className="pc-readouts">
        <span>Fees never stop — your {units} units earn {fmtPct(f)} of every trade's fee, forever.</span>
      </div>
    </div>
  );
}

function FailedCard({ state }) {
  if (state.yourEth <= 0) {
    return <div className="pc-card"><h2 className="mt-0 text-lg font-bold mb-2">Party's over</h2><p className="text-sm" style={{ color: 'var(--muted2)' }}>The goal wasn't met — everyone who joined gets every wei back. You weren't in this one.</p></div>;
  }
  return (
    <div className="pc-card">
      <h2 className="mt-0 text-lg font-bold mb-2">Goal missed — full refund</h2>
      <div className="pc-hero">
        <span className="big">{fmtEth(state.yourEth)}<span className="sub">yours to take back</span></span>
      </div>
      <p className="text-sm" style={{ color: 'var(--muted2)' }}>All-or-nothing means all or nothing: no launch, no coins, no haircut. Claim your refund below.</p>
      <Button>Refund me</Button>
    </div>
  );
}

function Partiers({ state }) {
  const rows = CROWD.map(p => ({ ...p, weight: weightOf(p) }));
  if (state.yourWeight > 0) rows.push({ name: 'you', you: true, eth: state.yourEth, weight: state.yourWeight });
  const total = rows.reduce((s, r) => s + r.weight, 0);
  const withShare = rows.map(r => ({ ...r, share: total > 0 ? r.weight / total : 0 })).sort((a, b) => b.share - a.share);
  const active = withShare.filter(r => r.share >= HOUSE.dustShare);
  const dust = withShare.filter(r => r.share < HOUSE.dustShare);
  const Row = ({ r, dim }) => (
    <div className={`pc-partier${dim ? ' dim' : ''}`} title={dim ? 'Below the dust bar — refunded in full at close. Yolo more to rejoin the party.' : undefined}>
      <span className="ava">{r.you ? '🫵' : '🥳'}</span>
      <span className="who">{r.name}{r.you && <> <span className="pc-badge you">you</span></>}{r.launcher && <> <span className="pc-badge">launcher</span></>}</span>
      <span className="pct">{dim ? '0%' : fmtPct(r.share)}</span>
    </div>
  );
  return (
    <div className="pc-card">
      <h2 className="mt-0 text-lg font-bold mb-2">Fellow partiers</h2>
      {active.map(r => <Row key={r.name} r={r} />)}
      {dust.length > 0 && (
        <>
          <div className="pc-refunded-rule">refunded at close — below the dust bar</div>
          {dust.map(r => <Row key={r.name} r={r} dim />)}
        </>
      )}
    </div>
  );
}

const PHASES = [
  ['funding', 'Funding'],
  ['closing', 'Goal met, window over'],
  ['launched', 'Launched'],
  ['failed', 'Failed'],
];

function App() {
  // Deep-linkable mock state: /party?state=launched&you=joined
  const params = new URLSearchParams(location.search);
  const initialPhase = PHASES.some(([k]) => k === params.get('state')) ? params.get('state') : 'funding';
  const [phase, setPhase] = useState(initialPhase);
  const [joined, setJoined] = useState(params.get('you') === 'joined');
  const state = usePartyState(joined);
  const econ = useMemo(() => partyEcon(state.raised), [state.raised]);
  const isIn = state.yourEth > 0;

  return (
    <div>
      <div className="pc-devbar">
        <span className="label">mock state:</span>
        {PHASES.map(([k, label]) => (
          <button key={k} className={`pc-pill${phase === k ? ' on' : ''}`} onClick={() => setPhase(k)}>{label}</button>
        ))}
        <span className="label" style={{ marginLeft: 10 }}>you:</span>
        <button className={`pc-pill${!joined ? ' on' : ''}`} onClick={() => setJoined(false)}>fresh</button>
        <button className={`pc-pill${joined ? ' on' : ''}`} onClick={() => setJoined(true)}>joined 1 ETH on day 1</button>
      </div>

      {phase === 'closing' && (
        <div className="pc-banner ok">
          <b>Goal met.</b> The window is over — anyone can pull the trigger. One transaction launches the coin,
          fills the party's dev buy, arms both streams, and points every trading fee at the party.
          <div style={{ marginTop: 8 }}><Button>Launch the party 🎉</Button></div>
        </div>
      )}

      <div className="pc-col">
        <PartyHeader phase={phase} state={state} />
        <div className="pc-grid">
          <div className="pc-col">
            {(phase === 'funding' || phase === 'closing') && <DealCard econ={econ} raised={state.raised} />}
            {phase === 'funding' && (isIn ? <JoinedCard state={state} phase={phase} /> : <JoinCard state={state} econ={econ} />)}
            {phase === 'closing' && isIn && <JoinedCard state={state} phase={phase} />}
            {phase === 'launched' && <LaunchedCard state={state} />}
            {phase === 'failed' && <FailedCard state={state} />}
          </div>
          <Partiers state={state} />
        </div>
      </div>

      <div className="pc-foot">
        The launcher of record is a smart contract that provably can't keep anything — no founder cash, no team
        coins, no knobs. House rules are the same for every party; only the coin differs.
        {' '}<a href="/pactclanker-model.html" target="_blank" rel="noreferrer">Model this launch out</a> ·
        mock data only — numbers use the PRD's curve approximation.
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')).render(<App />);
