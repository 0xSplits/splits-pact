// PartyClanker playable mock — UX playground only, no chain, no API.
// Throwaway rainbow-dark styling (deliberately NOT the PACT app design system).
// House rules follow the PRD: fixed-multiple vault (DD-6), mcap = 2.5x max
// raise (DD-6), time-weighted shares (DD-3), dust bar 0.1% (DD-4), ETH (DD-5).
// Typing an amount previews everything live: the raise bar, your row in the
// partier list, and anyone your yolo would bump under the dust bar.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './party.css';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// FLIP: rows keep their identity and spring to their new slot when the
// ranking changes — the "jump up the party list" moment.
function useFlip() {
  const containerRef = useRef(null);
  const positions = useRef(new Map());
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rows = container.querySelectorAll('[data-flip]');
    rows.forEach(el => {
      const key = el.dataset.flip;
      const now = el.getBoundingClientRect().top;
      const prev = positions.current.get(key);
      if (prev != null && Math.abs(prev - now) > 1 && !reducedMotion()) {
        el.animate(
          [{ transform: `translateY(${prev - now}px)` }, { transform: 'translateY(0)' }],
          { duration: 500, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
        );
      }
      positions.current.set(key, now);
    });
  });
  return containerRef;
}

const S = 1e9;
const HOUSE = {
  ticker: '$PARTY',
  icon: '🎈',
  min: 1,
  max: 10,
  mcap: 25,          // 2.5x max, per DD-6
  mult: 1,           // one bonus coin per coin bought, per DD-6
  windowDays: 4,
  boughtStreamDays: 7,
  bonusStreamDays: 90,
  dustShare: 0.001,
};

const CROWD = [
  { name: 'abram.eth', eth: 0.5, tFrac: 0.0, launcher: true },
  { name: 'gerry.eth', eth: 1.2, tFrac: 0.2 },
  { name: 'kae.eth', eth: 0.8, tFrac: 0.3 },
  { name: 'mint.eth', eth: 0.65, tFrac: 0.45 },
  { name: 'dot.eth', eth: 0.05, tFrac: 0.5 },
  { name: 'ren.eth', eth: 0.006, tFrac: 0.1 },
  { name: 'pip.eth', eth: 0.003, tFrac: 0.3 },
];

const NOW_T = 0.4; // "now" = day 1.6 of the 4-day window
const pageLoad = Date.now();

const weightOf = p => p.eth * (1 - p.tFrac);
const fmtEth = v => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + ' ETH';
const fmtPct = v => {
  const p = v * 100;
  return (p < 10 && p % 1 ? p.toFixed(p < 1 ? 2 : 1) : p.toFixed(0)) + '%';
};
const fmtCoins = v => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0));

// Dev buy on the launch curve with a fixed-multiple vault (DD-6).
// Constant-product approximation — same math as the modeler.
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
    partyShare: (bought + v) / S,
    prem,
    blended: prem / (1 + HOUSE.mult),
    vsTge: 1 / ((1 + HOUSE.mult) * prem),
  };
}

// All weights, live: committed crowd + your committed pledges + your typed preview.
function useParty(joined, previewEth) {
  const [pledges, setPledges] = useState([]);
  useEffect(() => { setPledges(joined ? [{ eth: 1, tFrac: 0.25 }] : []); }, [joined]);

  const committedEth = pledges.reduce((s, p) => s + p.eth, 0);
  const crowdEth = CROWD.reduce((s, p) => s + p.eth, 0);
  const room = Math.max(0, HOUSE.max - crowdEth - committedEth);
  const preview = Math.min(Math.max(0, previewEth || 0), room);

  const yourWeight = pledges.reduce((s, p) => s + weightOf(p), 0) + preview * (1 - NOW_T);
  const crowdWeight = CROWD.reduce((s, p) => s + weightOf(p), 0);
  const totalWeight = crowdWeight + yourWeight;
  const yourEth = committedEth + preview;
  const raised = crowdEth + yourEth;

  const yourShare = totalWeight > 0 ? yourWeight / totalWeight : 0;
  const capacityLeft = Math.max(0, HOUSE.max - raised);
  // Floor: the rest of the max arrives this instant at full remaining weight.
  const floorShare = yourWeight > 0 ? yourWeight / (totalWeight + capacityLeft * (1 - NOW_T)) : 0;

  const commit = () => { if (preview > 0) setPledges(p => [...p, { eth: preview, tFrac: NOW_T }]); };
  const yank = () => setPledges([]);

  return { pledges, committedEth, preview, yourEth, yourWeight, yourShare, floorShare, raised, room, capacityLeft, totalWeight, commit, yank };
}

function Countdown({ phase }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  if (phase !== 'funding') {
    const label = { closing: 'window over — goal met, waiting on launch', launched: 'launched — streams running, fees flowing', failed: 'goal missed — refunds open' }[phase];
    return <div className="clock">{label}</div>;
  }
  const remainMs = (1 - NOW_T) * HOUSE.windowDays * 86400e3 - (Date.now() - pageLoad);
  const s = Math.max(0, Math.floor(remainMs / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return (
    <div className="clock">
      <span className="time">{d}d {String(h).padStart(2, '0')}h {String(m).padStart(2, '0')}m {String(s % 60).padStart(2, '0')}s</span> left
      <span className="decay"> · 1 ETH now = <b>{(1 - NOW_T).toFixed(2)}</b> weight</span>
    </div>
  );
}

function TokenCard({ phase, party }) {
  const crowdFrac = (party.raised - party.yourEth) / HOUSE.max;
  const youCommittedFrac = party.committedEth / HOUSE.max;
  const youPreviewFrac = party.preview / HOUSE.max;
  return (
    <div className="card">
      <div className="token">
        <div className="icon">{HOUSE.icon}</div>
        <div>
          <div className="ticker">{HOUSE.ticker}</div>
          <div className="sub">a vanilla Clanker coin — nobody is paid</div>
        </div>
      </div>
      <div className="bar">
        <div className="fill" style={{ width: `calc(${Math.min(1, crowdFrac) * 100}% - 3px)` }} />
        {youCommittedFrac > 0 && <div className="you" style={{ left: `${crowdFrac * 100}%`, width: `${youCommittedFrac * 100}%` }} />}
        {youPreviewFrac > 0 && <div className="you preview" style={{ left: `${(crowdFrac + youCommittedFrac) * 100}%`, width: `${youPreviewFrac * 100}%` }} />}
        <div className="min-tick" style={{ left: `${(HOUSE.min / HOUSE.max) * 100}%` }} title={`min ${HOUSE.min} ETH`} />
      </div>
      <div className="bar-caps">
        <span><b>{fmtEth(party.raised)}</b>{party.yourEth > 0 && <span className="you-amt"> · {fmtEth(party.yourEth)} you</span>}</span>
        <span>max {HOUSE.max} ETH</span>
      </div>
      <Countdown phase={phase} />
    </div>
  );
}

function Gets() {
  return (
    <p className="gets">
      100% of the dev buy · 1:1 bonus streamed over {HOUSE.bonusStreamDays}d ·
      every trading fee, forever · full refund if the goal fails
    </p>
  );
}

function MathBox({ party, econ, onModel }) {
  return (
    <div className="mathbox">
      <div className="t">the math <button className="act" onClick={onModel}>full model →</button></div>
      <span>Lists at <b>{HOUSE.mcap} ETH</b> mcap — house rule: always 2.5x the {HOUSE.max} ETH max, so a full party still enters under list.</span>
      <span>Enters at <b>{econ.blended.toFixed(2)}x list</b> — <b>{Math.round(econ.vsTge * 100)}%</b> of a launch-day buyer's price.</span>
      <span>Party holds <b>{fmtPct(econ.partyShare)}</b> of supply; <b>{fmtPct(1 - econ.partyShare)}</b> stays in the market.</span>
      {party.yourWeight > 0 && <span>Your floor if it fills: <b>{fmtPct(party.floorShare)}</b> ({Math.floor(party.floorShare * 1000)} units).</span>}
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
        <div className="stat-row" style={{ marginBottom: 12 }}>
          <span className="stat hero"><b>{fmtPct(party.yourShare)}</b><span>of the party{party.preview > 0 ? ' (previewing)' : ''}</span></span>
          <span className="stat"><b>{fmtPct(party.floorShare)}</b><span>floor if it fills</span></span>
          <span className="stat"><b>{fmtEth(party.committedEth)}</b><span>pledged</span></span>
        </div>
      )}
      <div className="join-row">
        <input inputMode="decimal" placeholder={isIn ? 'yolo more' : 'how much?'} value={amt}
          onChange={e => setAmt(e.target.value)} aria-label="Amount in ETH" />
        <button className={`btn yolo${party.preview > 0 && !dusty ? ' armed' : ''}`} onClick={yolo} disabled={party.preview <= 0 || dusty}>
          Yolo
          {party.preview > 0 && !dusty && <><span className="sp s1" aria-hidden="true">✨</span><span className="sp s2" aria-hidden="true">✨</span></>}
        </button>
        {burst > 0 && <Burst key={burst} />}
      </div>
      {dusty
        ? <div className="note bad">Too small — a full party would squeeze you under the dust bar and refund you.</div>
        : party.preview > 0 && !isIn && <div className="note"><b>{fmtPct(party.yourShare)}</b> of the party → at least <b>{fmtPct(party.floorShare)}</b> if it fills. That floor is yours.</div>}
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
  const feesTotal = 0.31; // mock: ETH of fees the party has earned so far
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

function Partiers({ party }) {
  const flipRef = useFlip();
  const rows = CROWD.map(p => ({ ...p, weight: weightOf(p) }));
  if (party.yourWeight > 0) rows.push({ name: 'you', you: true, preview: party.committedEth === 0, weight: party.yourWeight });
  const total = rows.reduce((s, r) => s + r.weight, 0);
  const withShare = rows.map(r => ({ ...r, share: total > 0 ? r.weight / total : 0 })).sort((a, b) => b.share - a.share);
  const active = withShare.filter(r => r.share >= HOUSE.dustShare);
  const dust = withShare.filter(r => r.share < HOUSE.dustShare);
  const Row = ({ r, dim }) => (
    <div
      data-flip={r.name}
      className={`partier${dim ? ' dim' : ''}${r.you ? ' is-you enter' : ''}${r.you && r.preview ? ' preview-row' : ''}`}
      title={dim ? 'Below the dust bar — refunded in full at close.' : undefined}
    >
      <span className="ava">{dim ? '😭' : r.you ? '🫵' : '🥳'}</span>
      <span className="who">{r.name}{r.you && <> <span className="badge you">{r.preview ? 'preview' : 'you'}</span></>}{r.launcher && <> <span className="badge">launcher</span></>}</span>
      <span className="pct">{dim ? '0%' : fmtPct(r.share)}</span>
    </div>
  );
  return (
    <div className="card" ref={flipRef}>
      <h2>Party list</h2>
      {active.map(r => <Row key={r.name} r={r} />)}
      {dust.length > 0 && (
        <>
          <div className="rule" data-flip="__rule">refunded at close — under the dust bar</div>
          {dust.map(r => <Row key={r.name} r={r} dim />)}
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
  const [amt, setAmt] = useState(params.get('yolo') || '');
  const [modeling, setModeling] = useState(false);

  const typing = phase === 'funding' ? Math.max(0, parseFloat(amt) || 0) : 0;
  const party = useParty(joined, typing);
  const econ = useMemo(() => partyEcon(party.raised), [party.raised]);

  return (
    <>
      <div className="pc-title"><span className="hue">Party</span>Clanker</div>

      {phase === 'closing' && (
        <div className="banner glow">
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
          <TokenCard phase={phase} party={party} />
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
          <button className={`pill${joined ? ' on' : ''}`} onClick={() => setJoined(true)}>joined day 1</button>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('app')).render(<App />);
