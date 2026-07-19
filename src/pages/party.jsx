// PartyClanker playable mock — UX playground only, no chain, no API.
// Throwaway rainbow-dark styling (deliberately NOT the PACT app design system).
// House rules follow the PRD: fixed-multiple vault (DD-6), mcap = 5x the actual
// raise (DD-6 rev 2 — size-invariant deal, no floor), time-weighted shares
// (DD-3), dust bar 0.1% (DD-4), ETH (DD-5).
//
// Time mechanics, as the mock models them: a pledge's weight is locked at
// commit (amount x window-remaining — equal to MetaDAO's accumulator measured
// at close). Your share of the party therefore moves only when others join
// (down) or yank (up). What DOES grow with the clock is your worst-case floor:
// unfilled capacity can earn less weight every second, so the floor only ever
// ratchets upward. The mock-state card has a clock scrubber to watch it.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './party.css';

const S = 1e9;
const HOUSE = {
  ticker: '$PARTY',
  icon: '🎈',
  min: 1,
  max: 10,
  mult: 1,           // one bonus coin per coin bought, per DD-6
  windowDays: 4,
  boughtStreamDays: 7,
  bonusStreamDays: 90,
  dustShare: 0.001,
};

const NAMES = ['abram', 'gerry', 'kae', 'mint', 'dot', 'ren', 'pip', 'juno', 'flo', 'ossi', 'nadia', 'remy', 'sol', 'tulip', 'vera', 'wren', 'yuki', 'zorb', 'ida', 'bee', 'cosmo', 'dex', 'echo', 'lumi'];
const rnd = i => ((((i + 13) * 2654435761) >>> 0) % 1000) / 1000;

// Deterministic crowd: the launcher commits at t=0; everyone else arrives
// spread through the window with skewed check sizes (few whales, many small).
function genCrowd(n, totalEth) {
  const weights = Array.from({ length: n }, (_, i) => 0.04 + rnd(i) * rnd(i) * 2.2);
  const wSum = weights.reduce((s, w) => s + w, 0);
  const crowd = weights.map((w, i) => ({
    name: NAMES[i % NAMES.length] + (i >= NAMES.length ? i : '') + '.eth',
    eth: totalEth * w / wSum,
    tFrac: i === 0 ? 0 : rnd(i * 7) * 0.92,
    launcher: i === 0,
  }));
  // Guaranteed near-dust: the last 1-2 backers are tiny early checks riding just
  // above the 0.1% dust bar, so a moderate back (or bigger crowd) bumps them under it.
  [{ eth: 0.0008, tFrac: 0.12 }, { eth: 0.0013, tFrac: 0.2 }]
    .slice(0, n >= 5 ? 2 : 1)
    .forEach((t, j) => Object.assign(crowd[n - 1 - j], t));
  return crowd;
}

const weightOf = p => p.eth * (1 - p.tFrac);
const fmtEth = v => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + ' ETH';
const fmtPct = v => {
  const p = v * 100;
  return (p < 10 && p % 1 ? p.toFixed(p < 1 ? 2 : 1) : p.toFixed(0)) + '%';
};
const fmtCoins = v => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Dev buy on the launch curve with a fixed-multiple vault (DD-6). The list mcap
// is computed from the ACTUAL raise (DD-6 rev 2): 5x raised, no floor. Because
// mcap scales with the raise, party size cancels out entirely — every party,
// however small, enters at the same multiple of list and holds the same share.
function partyEcon(D) {
  const mcap = 5 * D;
  const p0 = mcap / S;
  let v = 0, bought = 0;
  for (let i = 0; i < 25; i++) {
    const x0 = S - v, y0 = x0 * p0;
    bought = x0 * D / (y0 + D);
    v = HOUSE.mult * bought;
  }
  const y0 = (S - v) * p0;
  const prem = 1 + D / y0;
  return {
    mcap, bought, vault: v,
    partyShare: (bought + v) / S,
    prem,
    blended: prem / (1 + HOUSE.mult),
    vsTge: 1 / ((1 + HOUSE.mult) * prem),
  };
}

// FLIP: rows spring to their new slot when the ranking changes. The spring is
// gated on data-rank (rendered order), not raw pixel position, so reflow from
// the ticking numbers alone never causes micro-animations.
function useFlip() {
  const containerRef = useRef(null);
  const positions = useRef(new Map());
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll('[data-flip]').forEach(el => {
      const key = el.dataset.flip;
      const now = el.getBoundingClientRect().top;
      const rank = el.dataset.rank;
      const prev = positions.current.get(key);
      if (prev != null && prev.rank !== rank && Math.abs(prev.top - now) > 1 && !reducedMotion()) {
        el.animate(
          [{ transform: `translateY(${prev.top - now}px)` }, { transform: 'translateY(0)' }],
          { duration: 500, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
        );
      }
      positions.current.set(key, { top: now, rank });
    });
  });
  return containerRef;
}

// Party state at simulated time nowT: only crowd members who have already
// arrived exist; preview weight is priced at nowT.
function useParty({ joined, previewEth, nowT, crowd }) {
  const [pledges, setPledges] = useState([]);
  useEffect(() => { setPledges(joined ? [{ eth: 1, tFrac: 0.1 }] : []); }, [joined]);

  const present = crowd.filter(p => p.tFrac <= nowT);
  const committedEth = pledges.reduce((s, p) => s + p.eth, 0);
  const crowdEth = present.reduce((s, p) => s + p.eth, 0);
  const room = Math.max(0, HOUSE.max - crowdEth - committedEth);
  const preview = Math.min(Math.max(0, previewEth || 0), room);

  const yourWeight = pledges.reduce((s, p) => s + weightOf(p), 0) + preview * (1 - nowT);
  const crowdWeight = present.reduce((s, p) => s + weightOf(p), 0);
  const totalWeight = crowdWeight + yourWeight;
  const yourEth = committedEth + preview;
  const raised = crowdEth + yourEth;

  const yourShare = totalWeight > 0 ? yourWeight / totalWeight : 0;
  const capacityLeft = Math.max(0, HOUSE.max - raised);
  // The ratchet: unfilled capacity earns (1 - nowT) weight per ETH, so this
  // number can only rise as the clock runs — joins convert reserved weight
  // into real weight 1:1 and leave it unchanged; yanks push it up.
  const floorShare = yourWeight > 0 ? yourWeight / (totalWeight + capacityLeft * (1 - nowT)) : 0;

  // Three views of the same pledge, all coexisting:
  //   · LIVE accrued weight = amount x max(0, nowT - tFrac). MetaDAO's
  //     per-second accumulator — what you'd own if the party closed THIS second.
  //     A just-arrived backer starts near 0 and climbs toward its at-close value.
  //   · AT-CLOSE (projected) weight = amount x (1 - tFrac). Where live converges
  //     as nowT -> 1; moves only when others join/yank. (yourShare above.)
  //   · FLOOR = worst case if the party fills to the brim (floorShare above).
  // A typed-but-uncommitted preview has NO live accrual — it isn't a position yet.
  const liveWeightOf = p => p.eth * Math.max(0, nowT - p.tFrac);
  const yourLive = pledges.reduce((s, p) => s + liveWeightOf(p), 0);
  const crowdLive = present.reduce((s, p) => s + liveWeightOf(p), 0);
  const totalLive = crowdLive + yourLive;
  const yourLiveShare = totalLive > 0 ? yourLive / totalLive : 0;

  const commit = () => { if (preview > 0) setPledges(p => [...p, { eth: preview, tFrac: nowT }]); };
  const yank = () => setPledges([]);

  return { present, pledges, committedEth, preview, yourEth, yourWeight, yourShare, floorShare, raised, room, capacityLeft, totalWeight, yourLive, totalLive, yourLiveShare, liveWeightOf, commit, yank };
}

function Clock({ phase, nowT }) {
  if (phase !== 'funding') {
    const label = { closing: 'window over — goal met, waiting on launch', launched: 'launched — streams running, fees flowing', failed: 'goal missed — refunds open' }[phase];
    return <div className="clock">{label}</div>;
  }
  const remainDays = (1 - nowT) * HOUSE.windowDays;
  const d = Math.floor(remainDays), h = Math.floor((remainDays - d) * 24), m = Math.floor((((remainDays - d) * 24) - h) * 60);
  return (
    <div className="clock">
      <span className="time">{d}d {String(h).padStart(2, '0')}h {String(m).padStart(2, '0')}m</span> left
      <span className="decay"> · 1 ETH now = <b>{(1 - nowT).toFixed(2)}</b> weight</span>
    </div>
  );
}

function TokenCard({ phase, party, nowT }) {
  // Two-stage denominator: below the goal the whole bar spans the minimum (so an
  // on-track party reads full, not underfunded); once met it rescales to the max.
  const goalMet = party.raised >= HOUSE.min;
  const denom = goalMet ? HOUSE.max : HOUSE.min;
  const crowdFrac = Math.min(1, (party.raised - party.yourEth) / denom);
  const youCommittedFrac = Math.min(1, party.committedEth / denom);
  const youPreviewFrac = Math.min(1, party.preview / denom);
  return (
    <div className="card">
      <div className="token">
        <div className="icon">{HOUSE.icon}</div>
        <div>
          <div className="ticker">{HOUSE.ticker}</div>
          <div className="sub">a vanilla Clanker coin, launched by its crowd</div>
        </div>
      </div>
      <div className="bar">
        <div className="fill" style={{ width: `calc(${crowdFrac * 100}% - 3px)` }} />
        {youCommittedFrac > 0 && <div className="you" style={{ left: `${crowdFrac * 100}%`, width: `${youCommittedFrac * 100}%` }} />}
        {youPreviewFrac > 0 && <div className="you preview" style={{ left: `${Math.min(1, crowdFrac + youCommittedFrac) * 100}%`, width: `${youPreviewFrac * 100}%` }} />}
        {goalMet && <div className="min-tick met" style={{ left: `${(HOUSE.min / HOUSE.max) * 100}%` }} title={`min ${HOUSE.min} ETH`} />}
      </div>
      <div className="bar-caps">
        <span><b>{fmtEth(party.raised)}</b>{party.yourEth > 0 && <span className="you-amt"> · {fmtEth(party.yourEth)} you</span>}</span>
        <span>{goalMet ? `max ${HOUSE.max} ETH` : `goal ${HOUSE.min} ETH`}</span>
      </div>
      <Clock phase={phase} nowT={nowT} />
    </div>
  );
}

function Gets() {
  return (
    <ul className="gets checks">
      <li>100% of the dev buy</li>
      <li>1:1 bonus, streamed over {HOUSE.bonusStreamDays}d</li>
      <li>Every trading fee, forever</li>
      <li>Full refund if the goal fails</li>
    </ul>
  );
}

function MathBox({ party, econ, onModel }) {
  return (
    <div className="mathbox">
      <div className="t">the math <button className="act" onClick={onModel}>full model →</button></div>
      <ul className="checks">
        <li>Lists at <b>{econ.mcap.toFixed(0)} ETH</b> — always 5× what's raised; same deal at every size, however small</li>
        <li>Enters at <b>{econ.blended.toFixed(2)}x list</b> — <b>{Math.round(econ.vsTge * 100)}%</b> of a TGE buyer's price</li>
        <li><b>{fmtPct(econ.partyShare)}</b> of supply to the party, <b>{fmtPct(1 - econ.partyShare)}</b> to the market</li>
        {party.yourWeight > 0 && <li>Floor if it fills: <b>{fmtPct(party.floorShare)}</b> ({Math.floor(party.floorShare * 1000)} units) — only goes up</li>}
      </ul>
    </div>
  );
}

const BURST_EMOJI = ['🎉', '🎈', '✨', '🥳', '🎊'];
function Burst() {
  const bits = useMemo(() => Array.from({ length: 9 }, (_, i) => ({
    x: 8 + (i * 83) % 78,
    dx: ((i * 37) % 60) - 30,
    rot: ((i * 53) % 90) - 45,
    e: BURST_EMOJI[i % BURST_EMOJI.length],
    delay: (i % 4) * 40,
  })), []);
  return (
    <div className="burst" aria-hidden="true">
      {bits.map((b, i) => (
        <span key={i} style={{ '--x': b.x + '%', '--dx': b.dx + 'px', '--rot': b.rot + 'deg', animationDelay: b.delay + 'ms' }}>{b.e}</span>
      ))}
    </div>
  );
}

function FundingCard({ party, econ, amt, setAmt, onModel }) {
  const isIn = party.committedEth > 0;
  // Floor hero at full precision: integer+2dp at hero size, the ticking decimal
  // tail smaller and dimmer. Unlike live weight, the floor only ratchets UP as
  // the ambient drift decays unfilled capacity's weight.
  const floorP = (party.floorShare * 100).toFixed(10);
  const floorCut = floorP.indexOf('.') + 3;
  const floorUnits = Math.floor(party.floorShare * 1000);
  const dusty = party.yourWeight > 0 && floorUnits < 1;
  const [confirming, setConfirming] = useState(false);
  const [burst, setBurst] = useState(0);
  const yolo = () => {
    party.commit();
    setAmt('');
    if (!reducedMotion()) {
      setBurst(b => b + 1);
      setTimeout(() => setBurst(0), 1000);
    }
  };
  return (
    <div className="card">
      <h2>This party gets</h2>
      <Gets />
      <div className="divider" />
      {isIn && (
        <>
          <div className="stat-row">
            <span className="stat hero"><b>{floorP.slice(0, floorCut)}<small className="hero-tail">{floorP.slice(floorCut)}%</small></b><span>if the party fills — only goes up</span></span>
            <span className="stat"><b>{fmtPct(party.yourShare)}</b><span>if no one else backs{party.preview > 0 ? ' (previewing)' : ''}</span></span>
            <span className="stat"><b>{fmtEth(party.committedEth)}</b><span>pledged</span></span>
          </div>
          <div className="range-note">you'll finish somewhere in between</div>
        </>
      )}
      <div className="join-row">
        <span className="inwrap">
          <input inputMode="decimal" placeholder={isIn ? 'back more' : 'how much?'} value={amt}
            onChange={e => setAmt(e.target.value)} aria-label="Amount in ETH" />
          {amt !== '' && <span className="suffix" aria-hidden="true">ETH</span>}
        </span>
        <button className={`btn yolo${party.preview > 0 && !dusty ? ' armed' : ''}`} onClick={yolo} disabled={party.preview <= 0 || dusty}>
          Back
          {party.preview > 0 && !dusty && <><span className="sp s1" aria-hidden="true">✨</span><span className="sp s2" aria-hidden="true">✨</span></>}
        </button>
        {burst > 0 && <Burst key={burst} />}
      </div>
      {isIn && party.yourShare < HOUSE.dustShare
        ? <div className="note bad">You've been bumped under the dust bar — back more to rejoin the party.</div>
        : dusty
          ? <div className="note bad">Too small — a full party would squeeze you under the dust bar and refund you.</div>
          : party.preview > 0 && !isIn && <div className="note"><b>{fmtPct(party.yourShare)}</b> if no one else backs → at least <b>{fmtPct(party.floorShare)}</b> if it fills. That floor is yours.</div>}
      {party.preview > 0 && party.preview < (parseFloat(amt) || 0) && <div className="note">Only {fmtEth(party.room)} of room left.</div>}
      {isIn && <div style={{ marginTop: 12 }}><button className="btn danger sm" onClick={() => setConfirming(true)}>Yank</button></div>}
      <MathBox party={party} econ={econ} onModel={onModel} />
      {confirming && (
        <div className="scrim" onClick={() => setConfirming(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Yank your {fmtEth(party.committedEth)}?</h3>
            <p>Every wei comes back now — and your weight zeroes. Re-joining starts from scratch at that day's weight.</p>
            <div className="actions">
              <button className="btn ghost sm" onClick={() => setConfirming(false)}>Stay in</button>
              <button className="btn danger sm" onClick={() => { party.yank(); setConfirming(false); }}>Yank it all</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LaunchedCard({ party }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  const econ = partyEcon(party.raised);
  const units = Math.floor(party.yourShare * 1000);
  const f = units / 1000;
  if (units < 1) {
    return <div className="card"><h2>Not in this one</h2><p className="note">The launch happened without you. Next party's a fresh start.</p></div>;
  }
  const yourBought = f * econ.bought, yourBonus = f * econ.vault;
  const daysSince = 2.1 + (Date.now() - pageLoad) / 86400e3;
  const bFrac = Math.min(1, daysSince / HOUSE.boughtStreamDays);
  const vFrac = Math.min(1, daysSince / HOUSE.bonusStreamDays);
  const feesTotal = 0.31; // mock: ETH of launcher fees the party has earned
  return (
    <div className="card">
      <h2>Your side of the launch</h2>
      <div className="stat-row">
        <span className="stat hero"><b>{fmtCoins(yourBought * bFrac + yourBonus * vFrac)}</b><span>coins claimable</span></span>
        <span className="stat"><b>{units}<span style={{ color: 'var(--dimmer)', fontSize: 16 }}> /1000</span></b><span>units</span></span>
        <span className="stat"><b>{fmtEth(f * feesTotal)}</b><span>fees so far</span></span>
      </div>
      <div className="lane">
        <div className="lane-top"><span>Bought — {HOUSE.boughtStreamDays}d stream</span><b>{fmtCoins(yourBought * bFrac)} / {fmtCoins(yourBought)}</b></div>
        <div className="track"><div className="done bought" style={{ width: `${bFrac * 100}%` }} /></div>
      </div>
      <div className="lane">
        <div className="lane-top"><span>Bonus — {HOUSE.bonusStreamDays}d stream</span><b>{fmtCoins(yourBonus * vFrac)} / {fmtCoins(yourBonus)}</b></div>
        <div className="track"><div className="done bonus" style={{ width: `${vFrac * 100}%` }} /></div>
      </div>
      <div className="join-row" style={{ marginTop: 6 }}>
        <button className="btn">Claim coins</button>
        <button className="btn ghost">Claim fees</button>
      </div>
      <div className="note">Your {units} units earn {fmtPct(f)} of the launcher fee on every trade, forever.</div>
    </div>
  );
}
const pageLoad = Date.now();

function FailedCard({ party }) {
  if (party.committedEth <= 0) {
    return <div className="card"><h2>Party's over</h2><p className="note">Goal missed — everyone gets every wei back. You weren't in this one.</p></div>;
  }
  return (
    <div className="card">
      <h2>Goal missed — full refund</h2>
      <div className="stat-row">
        <span className="stat hero"><b>{fmtEth(party.committedEth)}</b><span>yours to take back</span></span>
      </div>
      <button className="btn" style={{ marginTop: 12 }}>Refund me</button>
    </div>
  );
}

// Hoisted to module scope on purpose: defining Row inside Partiers gave it a new
// function identity on every render, so React tore down and rebuilt every row's
// DOM on each ambient-drift tick (~12.5x/sec) — replaying the .enter pop-in and
// .just-bumped flash continuously. A stable identity lets React preserve rows
// across re-renders, so pop-in fires once on real entry and FLIP handles reorders.
const Row = ({ r, dim, rank, bumped }) => (
  <div
    data-flip={r.name}
    data-rank={rank}
    className={`partier${dim ? ' dim' : ''}${r.you ? ' is-you enter' : ''}${r.you && r.preview ? ' preview-row' : ''}${dim && bumped ? ' just-bumped' : ''}`}
    title={dim ? 'Below the dust bar — refunded in full at close.' : undefined}
  >
    <span className="ava">{dim ? '😭' : r.you ? '🫵' : '🥳'}</span>
    <span className="who">{r.name}{r.you && <> <span className="badge you">{r.preview ? 'preview' : 'you'}</span></>}{r.launcher && <> <span className="badge">launcher</span></>}</span>
    <span className="pct">{dim ? '0%' : fmtPct(r.proj)}</span>
  </div>
);

function Partiers({ party }) {
  const flipRef = useFlip();
  // Rows sort AND display by the at-close projected share for everyone (you
  // included). Projections are locked at commit, so nothing here moves under
  // the ambient tick — the list reshuffles only on real events (joins, yanks,
  // previews). Dust ("refunded at close") is classified by the same projection.
  const rows = party.present.map(p => ({ ...p, weight: weightOf(p) }));
  if (party.yourWeight > 0) {
    const preview = party.committedEth === 0;
    rows.push({ name: 'you', you: true, preview, weight: party.yourWeight });
  }
  const total = rows.reduce((s, r) => s + r.weight, 0);
  const withShare = rows.map(r => ({ ...r, proj: total > 0 ? r.weight / total : 0 }))
    .sort((a, b) => b.proj - a.proj);
  const active = withShare.filter(r => r.proj >= HOUSE.dustShare);
  const dust = withShare.filter(r => r.proj < HOUSE.dustShare);
  // A row falling active → refunded gets a one-shot flash + 🥳→😭 beat: track
  // each row's previous section, stamp the fall, wear .just-bumped for ~0.8s.
  const prevSection = useRef(new Map());
  const bumpedAt = useRef(new Map());
  dust.forEach(r => { if (prevSection.current.get(r.name) === 'active') bumpedAt.current.set(r.name, Date.now()); });
  useEffect(() => {
    withShare.forEach(r => prevSection.current.set(r.name, r.proj >= HOUSE.dustShare ? 'active' : 'dust'));
  });
  const justBumped = r => Date.now() - (bumpedAt.current.get(r.name) || 0) < 800;
  return (
    <div className="card" ref={flipRef}>
      <h2>Party list</h2>
      {active.map((r, i) => <Row key={r.name} r={r} rank={i} />)}
      {dust.length > 0 && (
        <>
          <div className="rule" data-flip="__rule" data-rank={active.length}>refunded at close — under the dust bar</div>
          {dust.map((r, i) => <Row key={r.name} r={r} dim rank={active.length + 1 + i} bumped={justBumped(r)} />)}
        </>
      )}
    </div>
  );
}

function ModelModal({ onClose }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="bar-top"><button className="btn ghost sm" onClick={onClose}>close</button></div>
        <iframe src="/pactclanker-model.html" title="Launch modeler" />
      </div>
    </div>
  );
}

const PHASES = [
  ['funding', 'funding'],
  ['closing', 'goal met'],
  ['launched', 'launched'],
  ['failed', 'failed'],
];

function App() {
  // Deep-linkable mock state: /party?state=launched&you=joined&yolo=0.5
  const params = new URLSearchParams(location.search);
  const initialPhase = PHASES.some(([k]) => k === params.get('state')) ? params.get('state') : 'funding';
  const [phase, setPhase] = useState(initialPhase);
  const [joined, setJoined] = useState(params.get('you') === 'joined');
  const [amt, setAmt] = useState(params.get('back') || params.get('yolo') || '');
  const [modeling, setModeling] = useState(false);

  // Simulation controls (mock-state card)
  const [nBackers, setNBackers] = useState(7);
  const [crowdTotal, setCrowdTotal] = useState(3.2);
  const [nowT, setNowT] = useState(0.4);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setNowT(t => {
      const next = Math.min(0.99, t + 0.01);
      if (next >= 0.99) setPlaying(false);
      return next;
    }), 200);
    return () => clearInterval(id);
  }, [playing]);
  // Ambient drift: with the clock paused, keep nowT creeping forward (simulated
  // pace) so the live-weight accumulator visibly ticks between arrivals.
  useEffect(() => {
    if (phase !== 'funding' || playing) return;
    const id = setInterval(() => setNowT(t => Math.min(0.99, t + 0.000004)), 80);
    return () => clearInterval(id);
  }, [phase, playing]);

  const crowd = useMemo(() => genCrowd(nBackers, crowdTotal), [nBackers, crowdTotal]);
  const typing = phase === 'funding' ? Math.max(0, parseFloat(amt) || 0) : 0;
  const party = useParty({ joined, previewEth: typing, nowT: phase === 'funding' ? nowT : 1, crowd });
  const econ = useMemo(() => partyEcon(party.raised), [party.raised]);

  return (
    <>
      <div className="pc-title"><span className="hue">Party</span>Clanker</div>

      {phase === 'closing' && (
        <div className="banner">
          <b>Goal met, window over.</b> Anyone can pull the trigger — one transaction launches everything.
          <div style={{ marginTop: 10 }}><button className="btn">Launch the party 🎉</button></div>
        </div>
      )}

      <div className="pc-grid">
        <div className="pc-col left">
          {(phase === 'funding' || phase === 'closing') && <FundingCard party={party} econ={econ} amt={amt} setAmt={setAmt} onModel={() => setModeling(true)} />}
          {phase === 'launched' && <LaunchedCard party={party} />}
          {phase === 'failed' && <FailedCard party={party} />}
        </div>
        <div className="pc-col right">
          <TokenCard phase={phase} party={party} nowT={nowT} />
          <Partiers party={party} />
        </div>
      </div>

      <div className="foot">
        The launcher of record is a contract that provably can't keep anything. Same house rules, every party — only the coin differs.
        {' '}<button className="act" onClick={() => setModeling(true)}>model this launch →</button>
      </div>

      {modeling && <ModelModal onClose={() => setModeling(false)} />}

      <div className="devcard">
        <div className="t">mock state</div>
        <div className="pills">
          {PHASES.map(([k, label]) => (
            <button key={k} className={`pill${phase === k ? ' on' : ''}`} onClick={() => setPhase(k)}>{label}</button>
          ))}
        </div>
        <div className="sect pills">
          <button className={`pill${!joined ? ' on' : ''}`} onClick={() => setJoined(false)}>fresh</button>
          <button className={`pill${joined ? ' on' : ''}`} onClick={() => setJoined(true)}>joined early</button>
        </div>
        <label className="sect slider"><span>backers <b>{nBackers}</b></span>
          <input type="range" min="2" max="40" step="1" value={nBackers} onChange={e => setNBackers(+e.target.value)} /></label>
        <label className="sect slider"><span>crowd <b>{crowdTotal.toFixed(1)} ETH</b></span>
          <input type="range" min="0.2" max="9.5" step="0.1" value={crowdTotal} onChange={e => setCrowdTotal(+e.target.value)} /></label>
        <label className="sect slider"><span>clock <b>day {(nowT * HOUSE.windowDays).toFixed(1)}/{HOUSE.windowDays}</b></span>
          <input type="range" min="0" max="99" step="1" value={Math.round(nowT * 100)} onChange={e => { setPlaying(false); setNowT(+e.target.value / 100); }} /></label>
        <div className="sect pills">
          <button className={`pill${playing ? ' on' : ''}`} onClick={() => setPlaying(p => !p)}>{playing ? '⏸ pause' : '▶ play the clock'}</button>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('app')).render(<App />);
