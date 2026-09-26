import { useState } from 'react';
import { type Cabinet } from '../lib/tables.generated';
import { isSlip } from '../lib/klabak';

/**
 * The cabinet: carnival / fairground retro claw machine.
 *
 * One row of six identical iridescent capsules. One row on purpose: the claw
 * reaches the front row and nothing else, so the case shows exactly the
 * capsules that can be taken.
 *
 * The case is wide and short (1.56:1) so the whole machine — case plus control
 * deck — fits a laptop viewport without zooming out.
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
const VIEW = { w: 880, h: 565 };
/** Six capsules across — the row the claw can actually reach. */
const COLS = 6;
const COL_X = [165, 245, 325, 405, 485, 565];
const ROW_Y = 356;
/** The glass window as drawn in the cabinet illustration. */
const CASE = { x: 94, y: 154, w: 692, h: 246 };
const RAIL = { y: 185, h: 6 };
const REST_Y = 194;
const LIFT_Y = 188;
const DESCEND_Y = 296;
const CHUTE_X = 672;

/** Arch bulbs that twinkle along the curved marquee. */
const BULBS = [
  { cx: 110, cy: 112 },
  { cx: 158, cy: 113 },
  { cx: 204, cy: 104 },
  { cx: 245, cy: 78 },
  { cx: 292, cy: 56 },
  { cx: 342, cy: 38 },
  { cx: 390, cy: 30 },
  { cx: 439, cy: 27 },
  { cx: 489, cy: 30 },
  { cx: 538, cy: 38 },
  { cx: 588, cy: 56 },
  { cx: 635, cy: 78 },
  { cx: 676, cy: 104 },
  { cx: 722, cy: 113 },
  { cx: 770, cy: 112 },
];

/** Capsule colour per cabinet — identical capsules, cabinet identity. */
export const CABINET_SHELL = ['#1e9aa8', '#7d8bff', '#ffcd6b'];
/** Prize rarity palette, shared with the paytable chips. */
export const TIER_COLORS = ['#6f6a7d', '#1e9aa8', '#7d8bff', '#ffcd6b'];

/**
 * A gachapon capsule, drawn from the illustrated sprite in public/art:
 * iridescent translucent dome, colored candy shell, chrome tab on top.
 */
function CapsuleSprite({
  shell,
  scale = 1,
  dim = 1,
  label = false,
}: {
  shell: string;
  scale?: number;
  dim?: number;
  /** Draws the dashed "the claw will go here" ring around the capsule. */
  label?: boolean;
}) {
  const file = shell === CABINET_SHELL[1] ? 'violet' : shell === CABINET_SHELL[2] ? 'gold' : 'teal';
  return (
    <g transform={`scale(${scale})`} opacity={dim}>
      <image
        href={`/art/capsule-${file}.webp`}
        x={-36}
        y={-38}
        width={72}
        height={76}
        preserveAspectRatio="xMidYMid meet"
      />
      {label && (
        <g className="kl-grab-mark">
          <circle cx="0" cy="0" r="40" fill="none" stroke="#ffcd6b" strokeWidth="2" strokeDasharray="5 7" opacity="0.85" />
          <path d="M0 -48 V -58" stroke="#ffcd6b" strokeWidth="3" strokeLinecap="round" opacity="0.95" />
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
   * Only the cabinet's own top rung is the jackpot.
   */
  const isJackpot = won && outcomeTier === cabinet.tiers.length - 1;
  const inFlight = phase !== 'idle' && phase !== 'settled';
  const shell = CABINET_SHELL[cabinetId % CABINET_SHELL.length];
  const topX = (cabinet.tiers[cabinet.tiers.length - 1].multiplier / 100).toFixed(2).replace(/\.00$/, '');
  const heldShell = slipped ? shell : CABINET_SHELL[Math.min(outcomeTier ?? 1, CABINET_SHELL.length - 1)];

  const col = (((inFlight ? targetCol : aimCol) % COLS) + COLS) % COLS;
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

  /**
   * The machine prints its own result on the lower cream banner.
   */
  const showReadout = outcomeTier !== null && (phase === 'settled' || phase === 'idle');
  const readoutTier = showReadout && outcomeTier !== null ? cabinet.tiers[outcomeTier] : null;
  const readoutWin = !!readoutTier && readoutTier.multiplier > 0;
  const readoutPlateText = readoutTier
    ? readoutWin
      ? `PRIZE ×${(readoutTier.multiplier / 100).toFixed(2)} · ${readoutTier.prize}`
      : 'SLIP · NO PRIZE'
    : 'READY · PULL TO PLAY';

  return (
    <div className={`kl-cabinet ${phase} ${slipped ? 'is-slip' : ''} ${won ? 'is-win' : ''}`}>
      <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="img" aria-label={`${cabinet.name} claw machine`}>
        <defs>
          <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.3" stopColor="#ffe785" />
            <stop offset="0.7" stopColor="#ffb545" stopOpacity="0.8" />
            <stop offset="1" stopColor="#ff9500" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="glass-sheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.03" />
            <stop offset="0.7" stopColor="#1e9aa8" stopOpacity="0.05" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.08" />
          </linearGradient>
          <clipPath id="case-clip">
            <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx="8" />
          </clipPath>
        </defs>

        {/* --------------------------------------------- Cabinet Illustrated Body */}
        <image
          href="/art/cabinet.webp"
          x="0"
          y="0"
          width={VIEW.w}
          height={VIEW.h}
          preserveAspectRatio="none"
        />

        {/* --------------------------------------------- Arch Bulbs Glowing Overlay */}
        {BULBS.map((b, i) => (
          <circle
            key={i}
            cx={b.cx}
            cy={b.cy}
            r="8.5"
            fill="url(#lamp)"
            className="kl-bulb"
            style={{ animationDelay: `${(i % 5) * 0.28}s` }}
          />
        ))}

        {/* --------------------------------------------- Case Content */}
        <g clipPath="url(#case-clip)">
          {/* Pickable capsules */}
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
                <CapsuleSprite shell={shell} label={aimed && !inFlight} />
              </g>
            );
          })}

          {/* Won prize in chute */}
          {won && (
            <g transform={`translate(${CHUTE_X} 370) scale(0.68)`} className="kl-prize">
              <CapsuleSprite shell={heldShell} />
            </g>
          )}
        </g>

        {/* --------------------------------------------- Glass Sheen Overlay */}
        <rect
          x={CASE.x}
          y={CASE.y}
          width={CASE.w}
          height={CASE.h}
          rx="8"
          fill="url(#glass-sheen)"
          className="kl-glass"
        />

        {/* --------------------------------------------- Rail & Carriage */}
        <g className="kl-claw-x" style={{ transform: `translateX(${clawX}px)` }}>
          <rect x="-14" y={RAIL.y - 7} width="28" height="15" rx="4" fill="#a4a9be" stroke="#5d627b" strokeWidth="1" />
          <rect x="-8" y={RAIL.y - 9} width="16" height="4" rx="2" fill="#ffffff" opacity="0.7" />
        </g>

        {/* --------------------------------------------- Claw & Gripper */}
        <g className="kl-claw" style={{ transform: `translate(${clawX}px, ${clawY}px)` }}>
          <line
            x1="0"
            y1={RAIL.y + RAIL.h - clawY}
            x2="0"
            y2="-26"
            stroke="#a4a9be"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <image
            href="/art/claw.webp"
            x={-38}
            y={-30}
            width={76}
            height={84}
            className={`kl-claw-art ${gripperOpen ? 'open' : 'closed'}`}
            preserveAspectRatio="xMidYMid meet"
          />
          {holding && (
            <g transform="translate(0 54)" className={`kl-held ${phase === 'dumping' ? 'dropping' : ''}`}>
              <CapsuleSprite shell={heldShell} scale={0.96} />
            </g>
          )}
        </g>

        {/* --------------------------------------------- HUD Pills inside glass */}
        <g className="kl-hud-pill">
          <rect x={CASE.x + 10} y={CASE.y + 10} width="108" height="22" rx="11" />
          <text x={CASE.x + 22} y={CASE.y + 25} className="kl-hud">PULL #{pullNumber}</text>
        </g>
        <g className="kl-chip-hud">
          <rect x={CASE.x + CASE.w - 158} y={CASE.y + 10} width="148" height="22" rx="11" />
          <text x={CASE.x + CASE.w - 22} y={CASE.y + 25} textAnchor="end">
            {chipLabel}
          </text>
        </g>

        {/* --------------------------------------------- Lower Cream Plate Banner Readout */}
        <g
          className={`kl-plate-marquee ${readoutWin ? 'readout-win' : ''} ${readoutTier && !readoutWin ? 'readout-slip' : ''} ${isJackpot ? 'jackpot-on' : ''} ${slipped ? 'tilt-on' : ''}`}
        >
          <rect
            x="80"
            y="512"
            width="510"
            height="44"
            rx="8"
            className="kl-plate-rect"
          />
          <text x="335" y="540" textAnchor="middle" className="kl-plate-text">
            {readoutPlateText}
          </text>
        </g>
      </svg>

      {/* Aim click/hover zone: 6 columns over the glass */}
      <div className="kl-aim" aria-hidden={disabled}>
        {COL_X.map((cx, column) => (
          <button
            key={column}
            type="button"
            className="kl-aim-col"
            style={{
              left: `${((cx - 40) / VIEW.w) * 100}%`,
              width: `${(80 / VIEW.w) * 100}%`,
              top: `${(CASE.y / VIEW.h) * 100}%`,
              height: `${(CASE.h / VIEW.h) * 100}%`,
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
