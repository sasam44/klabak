import { useState } from 'react';
import { type Cabinet } from '../lib/tables.generated';
import { isSlip } from '../lib/klabak';

/**
 * The cabinet: one SVG, no external assets, so it paints on the first frame.
 *
 * One row of six identical capsules. One row on purpose: the claw reaches the
 * front row and nothing else, so the case shows exactly the capsules that can
 * be taken. The faint shapes behind the row are the rest of the basket, drawn
 * as background rather than as a second row of pickable-looking targets.
 *
 * The case is wide and short (2.4:1) so the whole machine — case plus control
 * deck — fits a laptop viewport without zooming out.
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
  pullNumber: number;
  onAim: (col: number) => void;
  disabled: boolean;
};

/* ---------------------------------------------------------------- geometry */
const VIEW = { w: 880, h: 360 };
/** Six capsules across — the row the claw can actually reach. */
const COLS = 6;
const COL_X = Array.from({ length: COLS }, (_, i) => 88 + i * 104); // 88 .. 608
const ROW_Y = 208;
const RADIUS = 34;
const CASE = { x: 36, y: 62, w: 808, h: 200 };
const RAIL = { y: 72, h: 6 };
const REST_Y = 100;
const LIFT_Y = 96;
const DESCEND_Y = ROW_Y - RADIUS - 6;
const CHUTE = { x: 664, y: 190, w: 146, h: 66 };
const CHUTE_X = CHUTE.x + CHUTE.w / 2;

/** Capsule colour per cabinet — identical capsules, cabinet identity. */
export const CABINET_SHELL = ['#5fd0c5', '#7d8bff', '#ffcd6b'];
/** Prize rarity palette, shared with the paytable chips. */
export const TIER_COLORS = ['#6f6a7d', '#5fd0c5', '#7d8bff', '#ffcd6b'];

/** A gachapon capsule: coloured lower shell, pale cap, seam, gloss. */
function Capsule({
  shell,
  scale = 1,
  dim = 1,
  label = false,
}: {
  shell: string;
  scale?: number;
  dim?: number;
  label?: boolean;
}) {
  return (
    <g transform={`scale(${scale})`} opacity={dim}>
      <circle cx="0" cy="0" r="34" fill={shell} fillOpacity="0.92" />
      <path d="M-34 0 A 34 34 0 0 1 34 0 Z" fill="#ffffff" fillOpacity="0.36" />
      <path d="M-34 0 A 34 34 0 0 0 34 0 Z" fill="#000000" fillOpacity="0.22" />
      <circle cx="0" cy="0" r="34" fill="none" stroke="#0d0b17" strokeWidth="1.8" opacity="0.42" />
      <path d="M-33 0 H33" stroke="#0d0b17" strokeWidth="2" opacity="0.45" strokeLinecap="round" />
      <rect x="-8" y="-41" width="16" height="8" rx="3.5" fill={shell} fillOpacity="0.85" />
      <ellipse cx="-12" cy="-14" rx="10" ry="6" fill="#fff" opacity="0.32" />
      <ellipse cx="0" cy="20" rx="20" ry="7" fill="#000" opacity="0.12" />
      {label && (
        <g className="kl-grab-mark">
          <circle cx="0" cy="0" r="42" fill="none" stroke="#ffcd6b" strokeWidth="1.6" strokeDasharray="5 7" opacity="0.75" />
          <path d="M-10 -48 -10 -60M-10 -60 -16 -53M-10 -60 -4 -53" stroke="#ffcd6b" strokeWidth="2.2" fill="none" strokeLinecap="round" />
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
  pullNumber,
  onAim,
  disabled,
}: ClawMachineProps) {
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  const slipped = phase === 'settled' && outcomeTier !== null && isSlip(cabinet, outcomeTier);
  const won = phase === 'settled' && outcomeTier !== null && !isSlip(cabinet, outcomeTier);
  /**
   * Only the cabinet's own top rung is the jackpot. Lighting the JACKPOT plate
   * for a x1.50 grip would tell the player they hit a jackpot every time they
   * won, which is how a truthful paytable turns into a lie on the artwork.
   */
  const isJackpot = won && outcomeTier === cabinet.tiers.length - 1;
  const inFlight = phase !== 'idle' && phase !== 'settled';
  const shell = CABINET_SHELL[cabinetId % CABINET_SHELL.length];
  const topX = (cabinet.tiers[cabinet.tiers.length - 1].multiplier / 100).toFixed(2).replace(/\.00$/, '');
  const heldShell = slipped ? shell : CABINET_SHELL[Math.min(outcomeTier ?? 1, CABINET_SHELL.length - 1)];

  const col = (((inFlight ? targetCol : aimCol) % COLS) + COLS) % COLS;
  // The claw only travels to the chute while dumping; by the time the round is
  // settled it has already gone home, so the case never hides its own readout.
  const carrying = phase === 'dumping';
  const clawX = carrying ? CHUTE_X : COL_X[col];
  const clawY =
    phase === 'descending' || phase === 'gripping' || phase === 'gripping-wait'
      ? DESCEND_Y
      : phase === 'lifting' || phase === 'dumping'
        ? LIFT_Y
        : REST_Y;

  const gripperOpen = phase === 'idle' || phase === 'positioning' || phase === 'descending' || phase === 'settled';
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
          <clipPath id="case-clip">
            <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx="10" />
          </clipPath>
        </defs>

        {/* ---------------------------------------------------------- body */}
        <rect x="12" y="12" width="856" height="336" rx="18" fill="url(#body)" stroke="#3b3560" strokeWidth="2" />
        <rect x="12" y="12" width="856" height="42" rx="18" fill="#191533" stroke="#3b3560" strokeWidth="1.5" />
        {Array.from({ length: 9 }).map((_, i) => (
          <circle
            key={i}
            cx={352 + i * 22}
            cy={33}
            r="3.4"
            fill="url(#lamp)"
            className="kl-bulb"
            style={{ animationDelay: `${(i % 6) * 0.24}s` }}
          />
        ))}
        <text x="34" y="39" className="kl-hud">
          PULL #{pullNumber}
        </text>
        <g className="kl-chip-hud">
          <rect x={CASE.x + CASE.w - 16 - (chipLabel.length * 7.2 + 24)} y="20" width={chipLabel.length * 7.2 + 24} height="26" rx="13" />
          <text x={CASE.x + CASE.w - 28} y="38" textAnchor="end">
            {chipLabel}
          </text>
        </g>

        {/* ---------------------------------------------------------- case */}
        <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx="10" fill="#0b0a17" stroke="#4b4477" strokeWidth="2" />
        <g clipPath="url(#case-clip)">
          <g stroke="#332e57" strokeWidth="1" opacity="0.5">
            <path d={`M${CASE.x} 96 H${CASE.x + CASE.w}`} />
            <path d={`M${CASE.x} 128 H${CASE.x + CASE.w}`} />
            <path d={`M${CASE.x + 22} ${CASE.y} V${CASE.y + CASE.h}`} />
            <path d={`M${CASE.x + CASE.w - 22} ${CASE.y} V${CASE.y + CASE.h}`} />
          </g>

          {/* prize chute, inside the case */}
          <rect x={CHUTE.x} y={CHUTE.y} width={CHUTE.w} height={CHUTE.h} rx="8" fill="#07060e" stroke="#4b4477" strokeWidth="1.6" />
          <text x={CHUTE.x + 14} y={CHUTE.y + 20} className="kl-chute-label">
            PRIZE
          </text>
          {won && (
            <g transform={`translate(${CHUTE_X} ${CHUTE.y + 42}) scale(0.66)`} className="kl-prize">
              <Capsule shell={heldShell} />
            </g>
          )}

          {/* the pickable row */}
          {COL_X.map((cx, column) => {
            const aimed = !inFlight && (hoverCol === column || (hoverCol === null && aimCol === column));
            const playing = inFlight && targetCol === column;
            const taken = holding && targetCol === column;
            return (
              <g
                key={column}
                transform={`translate(${cx} ${ROW_Y})`}
                className={`kl-capsule ${aimed ? 'aimed' : ''} ${playing ? 'playing' : ''} ${taken ? 'taken' : ''}`}
              >
                <Capsule shell={shell} label={aimed && !inFlight} />
              </g>
            );
          })}

          {/* basket floor */}
          <rect x={CASE.x} y={246} width={CASE.w} height="16" fill="#151230" />
          <rect x={CASE.x + 12} y={250} width={CASE.w - 24} height="8" rx="4" fill="#0d0b1c" opacity="0.9" />

        </g>

        {/* -------------------------------------------------------- rail */}
        <rect x="44" y={RAIL.y} width="792" height={RAIL.h} rx="3" fill="url(#rail)" />
        <g className="kl-claw-x" style={{ transform: `translateX(${clawX}px)` }}>
          <rect x="-18" y={RAIL.y - 6} width="36" height="18" rx="6" fill="#8f94b8" />
          <rect x="-11" y={RAIL.y - 10} width="22" height="6" rx="3" fill="#c3c8e6" opacity="0.75" />
        </g>
        <g className="kl-claw" style={{ transform: `translate(${clawX}px, ${clawY}px)` }}>
          <line x1="0" y1={RAIL.y + RAIL.h - clawY} x2="0" y2="-16" stroke="#aeb4d6" strokeWidth="1.8" />
          <rect x="-26" y="-18" width="52" height="10" rx="5" fill="#dfe3ff" opacity="0.7" />
          <rect x="-23" y="-10" width="46" height="15" rx="6" fill="#b9bfe0" />
          <circle cx="0" cy="-2" r="4" fill="#8f94b8" />
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
          <path d={gripperOpen ? 'M0 6 L0 34' : 'M0 6 L0 28'} stroke="#9aa0c4" strokeWidth="2.8" strokeLinecap="round" />
          {holding && (
            <g transform="translate(0 68)" className={`kl-held ${phase === 'dumping' ? 'dropping' : ''}`}>
              <Capsule shell={heldShell} scale={0.94} />
            </g>
          )}
        </g>

        {/* ------------------------------------------------------- plates */}
        <g className={`kl-plate ${slipped ? 'tilt-on' : ''}`}>
          <rect x="60" y="282" width="170" height="30" rx="7" />
          <text x="145" y="302">TILT</text>
        </g>
        <g className={`kl-plate ${isJackpot ? 'jackpot-on' : ''}`}>
          <rect x="650" y="282" width="170" height="30" rx="7" />
          <text x="735" y="302">JACKPOT ×{Math.round(cabinet.tiers[cabinet.tiers.length - 1].multiplier / 100)}</text>
        </g>
        <g className="kl-plate kl-plate-coin">
          <rect x="330" y="282" width="220" height="30" rx="7" />
          <text x="440" y="302">INSERT BET</text>
        </g>

        <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx="10" fill="url(#glass)" className="kl-glass" />
      </svg>

      {/* aim strip: one button per column, so the claw can be placed without a drag */}
      <div className="kl-aim" aria-hidden={disabled}>
        {COL_X.map((cx, column) => (
          <button
            key={column}
            type="button"
            className="kl-aim-col"
            style={{
              left: `${((cx - 52) / VIEW.w) * 100}%`,
              width: `${(104 / VIEW.w) * 100}%`,
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
