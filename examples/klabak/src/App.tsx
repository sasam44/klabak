import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeMaxWager } from '@chain/casino-sdk/guest';
import { formatUnits, parseUnits } from 'viem';

import { ClawMachine, type Phase } from './components/ClawMachine';
import { Paytable } from './components/Paytable';
import { useCasinoHost } from './lib/useCasinoHost';
import {
  CABINETS,
  DECLARED_RTP_PPM,
  PHASE_SETTLED,
  cabinetById,
  decodeGameState,
  encodeGameData,
  isSlip,
  isTerminalPhase,
  outcomeFromPayout,
  outcomeFromRandomness,
  payoutFor,
  topMultiplier,
  type KlabakOutcome,
} from './lib/klabak';
import {
  DEMO_START_BALANCE,
  demoPayout,
  playDemoRound,
} from './lib/demo';
import { allCharms, loadCollection, saveCollection, shelfCompletion, type Collection } from './lib/collection';
import { initAudio, sfxChute, sfxClick, sfxDescend, sfxGrip, sfxMotor, sfxSlip, sfxWin, setMuted } from './lib/audio';

type RoundStatus = Phase | 'opening' | 'gripping-wait';

type Round = {
  /** Stable identity for the round: the settle effect must fire exactly once. */
  id: string;
  kind: 'hosted' | 'demo';
  cabinetId: number;
  wager: bigint;
  /** Column the claw plays. Cosmetic: the tier comes from the chain, not the column. */
  targetCol: number;
  status: RoundStatus;
  sessionKey?: string;
  sessionId?: string;
  outcome?: KlabakOutcome;
  payout?: bigint;
  revealed?: boolean;
};

type HistoryEntry = { cabinetId: number; tier: number; multiplier: number };

const FAST_MODE_KEY = 'klabak.fast';
const STORAGE_WAGER = 'klabak.wager';

export function App() {
  const { hostApi, snapshot, mode } = useCasinoHost();

  const [cabinetId, setCabinetId] = useState(0);
  const [aimCol, setAimCol] = useState(2);
  const [wagerInput, setWagerInput] = useState('10');
  const [round, setRound] = useState<Round | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [collection, setCollection] = useState<Collection>({});
  const [demoBalance, setDemoBalance] = useState<bigint>(DEMO_START_BALANCE);
  const [error, setError] = useState<string | null>(null);
  const [fastMode, setFastMode] = useState(false);
  const [muted, setMutedState] = useState(false);

  const cabinet = cabinetById(cabinetId);
  const decimals = mode === 'hosted' ? (snapshot?.token.decimals ?? 18) : 18;
  const symbol = mode === 'hosted' ? (snapshot?.token.symbol ?? '') : 'DEMO';

  // ---------------------------------------------------------------- helpers
  const speed = fastMode ? 0.4 : 1;
  const ms = useCallback((base: number) => base * speed, [speed]);

  useEffect(() => {
    setCollection(loadCollection());
    try {
      setFastMode(window.localStorage.getItem(FAST_MODE_KEY) === '1');
      const stored = window.localStorage.getItem(STORAGE_WAGER);
      if (stored) setWagerInput(stored);
    } catch {
      /* storage may be unavailable in sandboxed iframes */
    }
  }, []);

  const wager = useMemo(() => {
    if (!wagerInput.trim()) return null;
    try {
      const parsed = parseUnits(wagerInput.trim(), decimals);
      return parsed > 0n ? parsed : null;
    } catch {
      return null;
    }
  }, [wagerInput, decimals]);

  const hostedBalance = useMemo(() => {
    const raw = snapshot?.balances.smartVaultBalance;
    return raw !== undefined ? BigInt(raw) : undefined;
  }, [snapshot?.balances.smartVaultBalance]);
  const balance = mode === 'hosted' ? hostedBalance : demoBalance;

  // Clamp to what the chain will actually accept, exactly like the facet does.
  const maxWager = useMemo(() => {
    const top = topMultiplier(cabinet);
    if (mode === 'hosted') {
      const result = computeMaxWager(snapshot, { maxMultiplierX: top });
      const platformLimit = result.kind === 'limit' ? result.maxWager : undefined;
      if (platformLimit !== undefined && balance !== undefined) {
        return platformLimit < balance ? platformLimit : balance;
      }
      return platformLimit ?? balance;
    }
    return balance;
  }, [mode, snapshot, cabinet, balance]);

  // ---------------------------------------------------------------- hosted settle
  useEffect(() => {
    if (!round || round.kind !== 'hosted' || round.outcome || !snapshot) return;
    const row = snapshot.sessions.items.find(item => item.sessionKey === round.sessionKey);
    if (!row || !(row.isSettled || isTerminalPhase(row.phase))) return;

    const rawRandomness = row.raw.randomness !== undefined ? BigInt(row.raw.randomness) : 0n;
    const rowPayout = row.payout !== undefined ? BigInt(row.payout) : undefined;

    if (row.phase !== undefined && row.phase !== PHASE_SETTLED && !row.raw.gameState) {
      setError('That round did not settle normally. Wager handling follows the on-chain rules.');
      setRound(null);
      return;
    }

    // Richest source first: the committed gameState, then the raw VRF word,
    // then the payout alone (a settled row must always resolve to a prize).
    const outcome =
      (row.raw.gameState ? decodeGameState(row.raw.gameState) : null) ??
      (rawRandomness !== 0n ? outcomeFromRandomness(round.cabinetId, rawRandomness) : null) ??
      (rowPayout !== undefined ? outcomeFromPayout(round.cabinetId, round.wager, rowPayout) : null);
    if (!outcome) return; // result not indexed yet

    setRound(current =>
      current && current.sessionKey === round.sessionKey
        ? {
            ...current,
            outcome,
            sessionId: row.sessionId,
            payout: rowPayout ?? payoutFor(current.wager, cabinetById(current.cabinetId), outcome.tier),
          }
        : current,
    );
  }, [snapshot, round]);

  // ---------------------------------------------------------------- timeline
  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach(id => window.clearTimeout(id));
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, delay: number) => {
    timers.current.push(window.setTimeout(fn, delay));
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const advance = useCallback(
    (from: RoundStatus, to: RoundStatus, delay: number) => {
      later(() => {
        setRound(current => (current && current.status === from ? { ...current, status: to } : current));
      }, delay);
    },
    [later],
  );

  // Drive the machine. Travel and descent are generic — they say nothing about
  // the outcome, because it has not arrived yet. The grip is where it lands.
  useEffect(() => {
    if (!round) return;
    switch (round.status) {
      case 'positioning':
        sfxMotor();
        advance('positioning', 'descending', ms(700));
        break;
      case 'descending':
        sfxDescend();
        advance('descending', 'gripping-wait', ms(760));
        break;
      case 'gripping-wait': {
        if (!round.outcome) return; // the servo holds until the chain answers
        sfxGrip();
        advance('gripping-wait', 'gripping', ms(360));
        break;
      }
      case 'gripping':
        advance('gripping', 'lifting', ms(420));
        break;
      case 'lifting': {
        const slipped = round.outcome ? isSlip(cabinet, round.outcome.tier) : false;
        if (slipped) sfxSlip();
        else sfxChute();
        advance('lifting', slipped ? 'settled' : 'dumping', ms(760));
        break;
      }
      case 'dumping':
        advance('dumping', 'settled', ms(560));
        break;
      default:
        break;
    }
  }, [round, advance, ms, cabinet]);

  // Settle bookkeeping, collection, then the required revealOutcome.
  const settledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!round || round.status !== 'settled' || !round.outcome) return;
    // Guard on the round id, never on history length: a length-based stamp
    // re-fires after its own setHistory call and double-counts the round.
    if (settledRef.current === round.id) return;
    settledRef.current = round.id;

    const cab = cabinetById(round.cabinetId);
    const tier = round.outcome.tier;
    const tierRow = cab.tiers[tier];
    const won = tierRow.multiplier > 0;

    if (won) sfxWin(tier);
    setHistory(prev => [{ cabinetId: round.cabinetId, tier, multiplier: tierRow.multiplier }, ...prev].slice(0, 40));
    if (won && tierRow.charm) {
      setCollection(prev => {
        const next = { ...prev, [tierRow.charm as string]: (prev[tierRow.charm as string] ?? 0) + 1 };
        saveCollection(next);
        return next;
      });
    }
    if (round.kind === 'demo') {
      const payout = demoPayout(round.wager, cab, tier);
      setDemoBalance(prev => prev - round.wager + payout);
    }
    if (round.kind === 'hosted' && round.sessionId && !round.revealed) {
      setRound(current => (current ? { ...current, revealed: true } : current));
      void hostApi?.revealOutcome({ sessionId: round.sessionId }).catch(() => {
        // Display only: settlement is already final on-chain.
      });
    }
    later(() => {
      setRound(current => (current && current.status === 'settled' ? { ...current, status: 'idle' } : current));
    }, ms(2400));
  }, [round, cabinet, hostApi, later, ms]);

  // ---------------------------------------------------------------- actions
  const openRound = useCallback(async () => {
    if (!wager) return;
    initAudio();
    setError(null);
    const targetCol = aimCol;
    const base: Round = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind: mode === 'hosted' ? 'hosted' : 'demo',
      cabinetId,
      wager,
      targetCol,
      status: 'positioning',
    };

    if (mode !== 'hosted') {
      // Standalone demo: identical math, local randomness, play money.
      setRound(base);
      later(() => {
        const { tier } = playDemoRound(cabinet);
        setRound(current => (current ? { ...current, outcome: { cabinetId, tier, draw: 0, randomness: 0n, demo: true } } : current));
      }, ms(1400));
      return;
    }

    if (!hostApi) return;
    setRound(base);
    try {
      const { sessionKey } = await hostApi.openSession({
        wager: wager.toString(),
        gameData: encodeGameData(cabinetId),
      });
      setRound(current => (current ? { ...current, sessionKey } : current));
    } catch (cause) {
      clearTimers();
      setRound(null);
      setError(cause instanceof Error ? cause.message : 'The machine refused that pull.');
    }
  }, [wager, mode, cabinetId, hostApi, cabinet, later, ms, clearTimers, aimCol]);

  const busy =
    round !== null && ['positioning', 'descending', 'gripping-wait', 'gripping', 'lifting', 'dumping'].includes(round.status);

  const insufficient = wager !== null && balance !== undefined && wager > balance;
  const walletReady = mode !== 'hosted' ? true : snapshot?.wallet.status === 'ready';
  const canPull = !!wager && !busy && walletReady && !insufficient && mode !== 'connecting';

  const lastRound = round && round.status === 'settled' && round.outcome ? round : null;
  const result = useMemo(() => {
    if (!lastRound?.outcome) return null;
    const cab = cabinetById(lastRound.cabinetId);
    const tierRow = cab.tiers[lastRound.outcome.tier];
    const payout = lastRound.payout ?? payoutFor(lastRound.wager, cab, lastRound.outcome.tier);
    return {
      won: tierRow.multiplier > 0,
      prize: tierRow.prize,
      multiplier: tierRow.multiplier / 100,
      payout,
      isDemo: lastRound.kind === 'demo',
    };
  }, [lastRound]);

  const charmCount = allCharms().filter(c => (collection[c.key] ?? 0) > 0).length;
  const totalCharms = allCharms().length;
  const holdRate = history.length
    ? (history.filter(h => h.multiplier > 0).length / history.length) * 100
    : null;
  // history keeps multipliers in centi-units (160 = 1.60x), like the tables
  const bestGrip = history.reduce((best, h) => Math.max(best, h.multiplier), 0) / 100;

  // Space or Enter pulls the claw, so a long session is playable one-handed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'BUTTON')) return;
      if (!canPull) return;
      event.preventDefault();
      void openRound();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canPull, openRound]);

  // ---------------------------------------------------------------- render
  return (
    <div className="kl-app">
      <header className="kl-top">
        <div className="kl-brand">
          <svg viewBox="0 0 32 32" className="kl-mark" aria-hidden>
            <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10 9v6.5a6 6 0 0 0 12 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 22.5 10.5 26M20 22.5 21.5 26" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <div>
            <h1>Klabak</h1>
            <span className="kl-sub">gachapon claw machine · settles on-chain</span>
          </div>
        </div>
        <div className="kl-top-right">
          <span className={`kl-mode ${mode}`}>
            {mode === 'hosted' ? 'ON-CHAIN' : mode === 'connecting' ? 'CONNECTING' : 'DEMO — PLAY MONEY'}
          </span>
          <button
            type="button"
            className="kl-ghost"
            onClick={() => {
              const next = !muted;
              setMutedState(next);
              setMuted(next);
            }}
          >
            {muted ? 'sound off' : 'sound on'}
          </button>
          <button
            type="button"
            className={`kl-ghost ${fastMode ? 'active' : ''}`}
            onClick={() => {
              const next = !fastMode;
              setFastMode(next);
              try {
                window.localStorage.setItem(FAST_MODE_KEY, next ? '1' : '0');
              } catch {
                /* ignore */
              }
            }}
          >
            {fastMode ? 'fast' : 'normal'}
          </button>
        </div>
      </header>

      <main className="kl-main">
        <div className="kl-machine">
          <div className="kl-tabs" role="tablist" aria-label="Cabinet">
            {CABINETS.map(c => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === cabinetId}
                className={`kl-tab ${c.id === cabinetId ? 'active' : ''}`}
                disabled={busy || mode === 'connecting'}
                type="button"
                onClick={event => {
                  if (c.id === cabinetId) return;
                  sfxClick();
                  setCabinetId(c.id);
                  event.currentTarget.blur();
                }}
              >
                <span className="kl-tab-name">{c.name}</span>
                <span className="kl-tab-meta">
                  {c.volatility} · up to ×{(c.tiers[c.tiers.length - 1].multiplier / 100).toFixed(0)}
                </span>
              </button>
            ))}
          </div>

          <ClawMachine
            cabinet={cabinet}
            cabinetId={cabinetId}
            phase={(round?.status as Phase) ?? 'idle'}
            outcomeTier={round?.outcome?.tier ?? null}
            targetCol={round?.targetCol ?? aimCol}
            aimCol={aimCol}
            pullNumber={history.length + 1}
            disabled={busy || mode === 'connecting'}
            onAim={column => {
              if (column === aimCol) return;
              sfxClick();
              setAimCol(column);
            }}
          />

          {/* -------------------------------------------------- control deck */}
          <div className="kl-deck">
            <div className="kl-deck-row">
              <div className="kl-chips">
                <span className="kl-deck-label">Bet</span>
                {['1', '5', '10', '50'].map(value => (
                  <button
                    key={value}
                    type="button"
                    className={`kl-quick-btn ${wagerInput === value ? 'active' : ''}`}
                    disabled={busy}
                    onClick={event => {
                      setWagerInput(value);
                      try {
                        window.localStorage.setItem(STORAGE_WAGER, value);
                      } catch {
                        /* ignore */
                      }
                      event.currentTarget.blur();
                    }}
                  >
                    {value}
                  </button>
                ))}
                <input
                  className="kl-input"
                  inputMode="decimal"
                  value={wagerInput}
                  onChange={event => {
                    setWagerInput(event.target.value);
                    try {
                      window.localStorage.setItem(STORAGE_WAGER, event.target.value);
                    } catch {
                      /* ignore */
                    }
                  }}
                  disabled={busy}
                  aria-label={`Wager in ${symbol || 'tokens'}`}
                />
                <button
                  type="button"
                  className="kl-ghost"
                  disabled={busy || maxWager === undefined}
                  onClick={() => {
                    if (maxWager === undefined) return;
                    setWagerInput(formatUnits(maxWager, decimals));
                  }}
                >
                  max
                </button>
              </div>
              <div className="kl-deck-stat">
                <span className="kl-deck-label">Balance</span>
                <strong className="kl-balance">
                  {balance !== undefined ? `${formatUnits(balance, decimals)} ${symbol}` : '—'}
                </strong>
              </div>
            </div>

            <button type="button" className="kl-pull" onClick={() => void openRound()} disabled={!canPull}>
              {busy
                ? 'the claw is moving…'
                : insufficient
                  ? 'not enough balance'
                  : !walletReady
                    ? 'wallet not ready'
                    : 'pull the claw'}
            </button>

            {result ? (
              <div className={`kl-banner ${result.won ? 'win' : 'slip'}`} role="status">
                {result.won ? (
                  <>
                    <strong>
                      {result.prize} · ×{result.multiplier.toFixed(2)}
                    </strong>
                    <span>
                      +{formatUnits(result.payout, decimals)} {symbol}
                      {result.isDemo ? ' (demo)' : ''} — the claw dropped it in the chute.
                    </span>
                  </>
                ) : (
                  <>
                    <strong>The claw slipped.</strong>
                    <span>Nothing came up. The capsules settle back — that is the cabinet, not a bug.</span>
                  </>
                )}
              </div>
            ) : (
              <div className="kl-banner idle">
                <strong>{cabinet.name}</strong>
                <span>
                  Click a column to place the claw, then pull. Space also pulls. {topMultiplier(cabinet)}× is this
                  cabinet&rsquo;s top prize.
                </span>
              </div>
            )}

            {error && <p className="kl-error">{error}</p>}
            {mode === 'standalone' && (
              <p className="kl-note">
                You opened this page directly, so it runs as a <strong>play-money demo</strong>: identical paytable and
                identical draw, funded by an in-page balance. Inside chain.wtf the same button opens a real session.
              </p>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------- lower */}
        <section className="kl-lower">
          <div className="kl-panel">
            <div className="kl-panel-head">
              <span className="kl-label">Paytable · {cabinet.name}</span>
              <span className="kl-mono">RTP {(DECLARED_RTP_PPM / 10_000).toFixed(2)}%</span>
            </div>
            <Paytable cabinet={cabinet} />
          </div>

          <div className="kl-panel">
            <div className="kl-panel-head">
              <span className="kl-label">Shelf</span>
              <span className="kl-mono">
                {charmCount}/{totalCharms} · {shelfCompletion(collection).toFixed(0)}%
              </span>
            </div>
            <div className="kl-shelf">
              {allCharms().map(charm => {
                const count = collection[charm.key] ?? 0;
                const owned = count > 0;
                const cab = CABINETS[charm.cabinet];
                return (
                  <div
                    key={charm.key}
                    className={`kl-charm ${owned ? 'owned' : ''}`}
                    title={`${charm.prize} — ${cab.name}${count > 1 ? ` · pulled ${count}×` : ''}`}
                  >
                    <span className={`kl-charm-dot t${charm.tier}`} />
                    <span className="kl-charm-name">{owned ? charm.prize : '· · ·'}</span>
                    <span className="kl-charm-cab">{count > 1 ? `×${count}` : ''}</span>
                  </div>
                );
              })}
            </div>
            <p className="kl-note">
              Charms you actually pull stay on this shelf in your browser. Cosmetic only — the shelf never changes a
              payout, so it cannot touch the RTP.
            </p>
          </div>

          <div className="kl-panel kl-stats">
            <div>
              <span className="kl-label">Pulls</span>
              <strong>{history.length}</strong>
            </div>
            <div>
              <span className="kl-label">Claw held</span>
              <strong>{holdRate === null ? '—' : `${holdRate.toFixed(1)}%`}</strong>
            </div>
            <div>
              <span className="kl-label">Best grip</span>
              <strong>{bestGrip > 0 ? `×${bestGrip.toFixed(2)}` : '—'}</strong>
            </div>
            <div>
              <span className="kl-label">Declared RTP</span>
              <strong>{(DECLARED_RTP_PPM / 10_000).toFixed(2)}%</strong>
            </div>
            <div className="kl-stats-strip">
              <span className="kl-label">Last 12</span>
              <span className="kl-strip">
                {history.slice(0, 12).map((h, i) => (
                  <i key={i} className={h.multiplier > 0 ? `hit t${h.tier}` : 'miss'} title={`cabinet ${h.cabinetId}`} />
                ))}
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="kl-foot">
        <span>
          RTP 96.00% on all three cabinets · outcomes from Chain&rsquo;s VRF, settled by <code>KlabakGame.sol</code>
        </span>
        <span className="kl-foot-right">{mode === 'hosted' ? 'session live' : 'demo mode — no real wagering'}</span>
      </footer>
    </div>
  );
}
