import { useState } from 'react';
import { type Cabinet } from '../lib/tables.generated';
import { isSlip } from '../lib/klabak';

/**
 * The cabinet: one SVG, no external assets, so it paints on the first frame.
 *
 * The case holds a 5x2 grid of identical capsules, the way a real gachapon
 * machine does. Identical matters: every capsule has the same chance, so the
 * picture never lies about where the prize comes from. Aiming decides where the
 * claw travels, nothing else.
 *
 * Animation philosophy: travel and descent are generic and reveal nothing,
 * because the outcome is not known until the session settles. Only the grip
 * reveals it — the servo closes, and either the capsule comes up or it does not.
 */
export type Phase =
  | 'idle'
  | 'positioning'
  | 'descending'
  /** Claw is closed on a capsule; the case waits for the chain to settle. */
  | 'gripping-wait'
  | 'gripping'
  | 'lifting'
  | 'dumping'
  | 'settled';

export type ClawMachineProps = {
  cabinet: Cabinet;
  cabinetId: number;
  phase: Phase;
  /** Tier that came back from the draw, once known. */
  outcomeTier: number | null;
  /** Column the claw is playing this round. */
  targetCol: number;
  /** Column the claw rests over when nothing is in flight. */
  aimCol: number;
  collected: number;
  totalCharms: number;
  pullNumber: number;
  onAim: (col: number) => void;
  disabled: boolean;
};

/* ---------------------------------------------------------------- geometry */
const COLS = 5;
const GRID_X = [104, 244, 384, 524, 664];
const GRID_Y = [248, 344];
const CASE = { x: 36, y: 96, w: 808, h: 318 };
const RAIL_Y = 76;
const REST_Y = 148;
const LIFT_Y = 132;
const DESCEND_Y = GRID_Y[1] - 30;
const CHUTE = { x: 706, y: 348, w: 124, h: 66 };
const CHUTE_X = CHUTE.x + CHUTE.w / 2;
const VIEW = { w: 880, h: 560 };

/** Capsule colour per cabinet — identical capsules, cabinet identity. */
export const CABINET_SHELL = ['#5fd0c5', '#7d8bff', '#ffcd6b'];
/** Prize rarity palette (used by the paytable chips). */
export const TIER_COLORS = ['#6f6a7d', '#5fd0c5', '#7d8bff', '#ffcd6b'];

/** A gachapon capsule: coloured lower shell, pale cap, seam, gloss. */
function Capsule({ shell, scale = 1, label = false }: { shell: string; scale?: number; label?: boolean }) {
  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx="0" cy="30" rx="26" ry="6" fill="#000" opacity="0.32" />
      <circle cx="0" cy="0" r="28" fill={shell} fillOpacity="0.9" />
      <path d="M-28 0 A 28 28 0 0 1 28 0 Z" fill="#ffffff" fillOpacity="0.5" />
      <path d="M-28 0 A 28 28 0 0 0 28 0 Z" fill="#000000" fillOpacity="0.18" />
      <circle cx="0" cy="0" r="28" fill="none" stroke="#0d0b17" strokeWidth="1.6" opacity="0.4" />
      <path d="M-27 0 H27" stroke="#0d0b17" strokeWidth="1.8" opacity="0.45" strokeLinecap="round" />
      <rect x="-7" y="-34" width="14" height="7" rx="3" fill={shell} fillOpacity="0.85" />
      <ellipse cx="-10" cy="-12" rx="8" ry="5" fill="#fff" opacity="0.35" />
      <circle cx="13" cy="-16" r="3" fill="#fff" opacity="0.22" />
      {label && (
        <g className="kl-grab-mark">
          <circle cx="0" cy="0" r="34" fill="none" stroke="#ffcd6b" strokeWidth="1.4" strokeDasharray="4 6" opacity="0.7" />
          <path d="M-9 -40 -9 -50M-9 -50 -14 -44M-9 -50 -4 -44" stroke="#ffcd6b" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}

export function ClawMachine({
  cabinet,
  cabinetId,
  phase,
  outcomeTier,
  targetCol,
  aimCol,
  collected,
  totalCharms,
  pullNumber,
  onAim,
  disabled,
}: ClawMachineProps) {
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  const slipped = phase === 'settled' && outcomeTier !== null && isSlip(cabinet, outcomeTier);
  const won = phase === 'settled' && outcomeTier !== null && !isSlip(cabinet, outcomeTier);
  const inFlight = phase !== 'idle' && phase !== 'settled';
  const shell = CABINET_SHELL[cabinetId % CABINET_SHELL.length];
  const topX = (cabinet.tiers[cabinet.tiers.length - 1].multiplier / 100).toFixed(2).replace(/\.00$/, '');
  const heldShell = slipped ? shell : CABINET_SHELL[Math.min(outcomeTier ?? 1, CABINET_SHELL.length - 1)];

  const col = ((inFlight ? targetCol : aimCol) % COLS + COLS) % COLS;
  // The claw only travels to the chute while dumping; by the time the round is
  // settled it has already gone home, so the case never hides its own readout.
  const carrying = phase === 'dumping';
  const clawX = carrying ? CHUTE_X : GRID_X[col];
  const clawY =
    phase === 'descending' || phase === 'gripping' || phase === 'gripping-wait'
      ? DESCEND_Y
      : phase === 'lifting' || phase === 'dumping'
        ? LIFT_Y
        : REST_Y;

  const gripperOpen =
    phase === 'idle' || phase === 'positioning' || phase === 'descending' || phase === 'settled';
  const holding = phase === 'lifting' || phase === 'dumping';
  const chipLabel = `GRAB TO WIN  ×${topX}`;

  return (
    <div className={`kl-cabinet ${phase} ${slipped ? 'is-slip' : ''} ${won ? 'is-win' : ''}`}>
      <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="img" aria-label={`${cabinet.name} claw machine`}>
        <defs>
          <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2440" />
            <stop offset="0.55" stopColor="#1a1630" />
            <stop offset="1" stopColor="#120f22" />
          </linearGradient>
          <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9fd7ff" stopOpacity="0.13" />
            <stop offset="0.42" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#6f8fff" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c8cbe6" />
            <stop offset="1" stopColor="#5e6488" />
          </linearGradient>
          <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffe9a8" />
            <stop offset="1" stopColor="#ffb545" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ---------------------------------------------------------- body */}
        <rect x="12" y="12" width="856" height="536" rx="20" fill="url(#body)" stroke="#3b3560" strokeWidth="2" />
        <rect x="12" y="12" width="856" height="58" rx="20" fill="#191533" stroke="#3b3560" strokeWidth="1.5" />
        {Array.from({ length: 19 }).map((_, i) => (
          <circle
            key={i}
            cx={40 + i * 44.4}
            cy={41}
            r="4.4"
            fill="url(#lamp)"
            className="kl-bulb"
            style={{ animationDelay: `${(i % 6) * 0.24}s` }}
          />
        ))}

        {/* ---------------------------------------------------------- case */}
        <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx="12" fill="#0b0a17" stroke="#4b4477" strokeWidth="2" />
        <g stroke="#332e57" strokeWidth="1" opacity="0.55">
          <path d={`M${CASE.x} ${CASE.y + 54} H${CASE.x + CASE.w}`} />
          <path d={`M${CASE.x} ${CASE.y + 108} H${CASE.x + CASE.w}`} />
          <path d={`M${CASE.x + 20} ${CASE.y} V${CASE.y + CASE.h}`} />
          <path d={`M${CASE.x + CASE.w - 20} ${CASE.y} V${CASE.y + CASE.h}`} />
        </g>

        {/* the prize bin, behind the grid so a carried capsule lands in front of it */}
        <rect x={CHUTE.x} y={CHUTE.y} width={CHUTE.w} height={CHUTE.h} rx="8" fill="#07060e" stroke="#4b4477" strokeWidth="1.6" />
        <text x={CHUTE.x + 12} y={CHUTE.y + 19} textAnchor="start" className="kl-chute-label">
          PRIZE
        </text>

        {/* ------------------------------------------------- capsule grid */}
        {GRID_Y.map((cy, row) =>
          GRID_X.map((cx, column) => {
            const index = row * COLS + column;
            const isGrabRow = row === GRID_Y.length - 1;
            const aimed = isGrabRow && !inFlight && (hoverCol === column || (hoverCol === null && aimCol === column));
            const playing = inFlight && targetCol === column;
            const taken = holding && targetCol === column && row === 1;
            const tilt = ((index * 29) % 9) - 4;
            return (
              <g
                key={index}
                transform={`translate(${cx} ${cy + tilt * 0.5}) rotate(${tilt * 0.5})`}
                className={`kl-capsule ${aimed ? 'aimed' : ''} ${playing ? 'playing' : ''} ${taken ? 'taken' : ''}`}
              >
                <Capsule shell={shell} label={aimed && !inFlight} />
              </g>
            );
          }),
        )}

        {/* ------------------------------------------------------- HUD */}
        <text x="60" y="128" className="kl-hud">
          PULL #{pullNumber}
        </text>
        <text x="72" y="400" className="kl-hud-small">
          COLLECTED
        </text>
        {Array.from({ length: totalCharms }).map((_, i) => (
          <circle key={i} cx={172 + i * 15} cy={396} r="4.4" className={`kl-pip ${i < collected ? 'on' : ''}`} />
        ))}
        <g className="kl-chip-hud">
          <rect x={CASE.x + CASE.w - 16 - (chipLabel.length * 7.6 + 26)} y="108" width={chipLabel.length * 7.6 + 26} height="28" rx="14" />
          <text x={CASE.x + CASE.w - 29} y="127" textAnchor="end">
            {chipLabel}
          </text>
        </g>

        {/* ------------------------------------------------------- floor */}
        <rect x={CASE.x} y={CASE.y + CASE.h - 34} width={CASE.w} height="34" fill="#151230" />
        <rect x={CASE.x + 16} y={CASE.y + CASE.h - 30} width={CASE.w - 32} height="26" rx="6" fill="#0d0b1c" stroke="#2f2a4d" />

        {won && (
          <g transform={`translate(${CHUTE_X} ${CHUTE.y + 34}) scale(0.7)`} className="kl-prize">
            <Capsule shell={heldShell} />
          </g>
        )}

        {/* -------------------------------------------------------- rail */}
        <rect x="40" y={RAIL_Y} width="800" height="8" rx="4" fill="url(#rail)" />
        <g className="kl-claw-x" style={{ transform: `translateX(${clawX}px)` }}>
          <rect x="-18" y={RAIL_Y - 6} width="36" height="20" rx="6" fill="#8f94b8" />
          <rect x="-11" y={RAIL_Y - 10} width="22" height="6" rx="3" fill="#c3c8e6" opacity="0.75" />
        </g>
        <g className="kl-claw" style={{ transform: `translate(${clawX}px, ${clawY}px)` }}>
          <line x1="0" y1={RAIL_Y + 12 - clawY} x2="0" y2="-16" stroke="#aeb4d6" strokeWidth="1.8" />
          {/* hub */}
          <rect x="-26" y="-18" width="52" height="10" rx="5" fill="#dfe3ff" opacity="0.7" />
          <rect x="-23" y="-10" width="46" height="15" rx="6" fill="#b9bfe0" />
          <circle cx="0" cy="-2" r="4" fill="#8f94b8" />
          {/* two prongs that open wide and close on the capsule */}
          {[-1, 1].map(side => (
            <g key={side}>
              <circle cx={side * 13} cy="0" r="4.6" fill="#8f94b8" />
              <path
                d={
                  gripperOpen
                    ? `M${side * 12} 2 C ${side * 24} 14, ${side * 27} 28, ${side * 26} 44`
                    : `M${side * 12} 2 C ${side * 19} 14, ${side * 14} 28, ${side * 8} 44`
                }
                stroke="#e6e9ff"
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
                className="kl-prong"
              />
            </g>
          ))}
          {/* middle prong keeps the capsule centred while lifting */}
          <path
            d={gripperOpen ? 'M0 6 L0 34' : 'M0 6 L0 28'}
            stroke="#9aa0c4"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          {holding && (
            <g transform="translate(0 62)" className={`kl-held ${phase === 'dumping' ? 'dropping' : ''}`}>
              <Capsule shell={heldShell} />
            </g>
          )}
        </g>

        {/* ------------------------------------------------------- plates */}
        <g className={`kl-plate ${slipped ? 'tilt-on' : ''}`}>
          <rect x="60" y="474" width="180" height="34" rx="7" />
          <text x="150" y="496">TILT</text>
        </g>
        <g className={`kl-plate ${won ? 'jackpot-on' : ''}`}>
          <rect x="640" y="474" width="180" height="34" rx="7" />
          <text x="730" y="496">JACKPOT</text>
        </g>
        <g className="kl-plate kl-plate-coin">
          <rect x="330" y="474" width="220" height="34" rx="7" />
          <text x="440" y="496">INSERT BET</text>
        </g>

        <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx="12" fill="url(#glass)" className="kl-glass" />
      </svg>

      {/* aim strip: one button per column, so the claw can be placed without a drag */}
      <div className="kl-aim" aria-hidden={disabled}>
        {GRID_X.map((cx, column) => (
          <button
            key={column}
            type="button"
            className="kl-aim-col"
            style={{
              left: `${((cx - 70) / VIEW.w) * 100}%`,
              width: `${(140 / VIEW.w) * 100}%`,
            }}
            disabled={disabled}
            aria-label={`Aim the claw at column ${column + 1}`}
            onMouseEnter={() => setHoverCol(column)}
            onMouseLeave={() => setHoverCol(null)}
            onFocus={() => setHoverCol(column)}
            onBlur={() => setHoverCol(null)}
            onClick={event => {
              onAim(column);
              event.currentTarget.blur();
            }}
          />
        ))}
      </div>
    </div>
  );
}
