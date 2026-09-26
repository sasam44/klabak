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
const COL_X = Array.from({ length: COLS }, (_, i) => 104 + i * 82); // 104 .. 514
const ROW_Y = 152;
const RADIUS = 26;
/** The glass window as drawn in the cabinet illustration. */
const CASE = { x: 44, y: 68, w: 792, h: 140 };
const RAIL = { y: 86, h: 5 };
const REST_Y = 92;
const LIFT_Y = 90;
const DESCEND_Y = ROW_Y - RADIUS - 6;
const CHUTE = { x: 688, y: 118, w: 132, h: 78 };
const CHUTE_X = CHUTE.x + CHUTE.w / 2;

/** Capsule colour per cabinet — identical capsules, cabinet identity. */
export const CABINET_SHELL = ['#5fd0c5', '#7d8bff', '#ffcd6b'];
/** Prize rarity palette, shared with the paytable chips. */
export const TIER_COLORS = ['#6f6a7d', '#5fd0c5', '#7d8bff', '#ffcd6b'];

/**
 * A gachapon capsule, drawn from the illustrated sprite in public/art instead of
 * vector circles: same 68px slot, same centre, so the claw, the aim rings and the
 * chute keep working untouched. All three cabinet colours come from one sheet, so
 * the capsules stay identical across cabinets — which is the game's central claim.
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
        x={-37}
        y={-40}
        width={74}
        height={77}
        preserveAspectRatio="xMidYMid meet"
      />
      {label && (
        <g className="kl-grab-mark">
          <circle cx="0" cy="0" r="42" fill="none" stroke="#ffcd6b" strokeWidth="1.6" strokeDasharray="5 7" opacity="0.75" />
          <path d="M0 -52 V -60" stroke="#ffcd6b" strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />
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

  /**
   * The machine prints its own result. The banner under the deck already reports
   * the tier, but a player watching the claw should not have to look away to
   * learn what they won — and a plate that reads "JACKPOT x4" must never be the
   * only thing on screen when the grip was a x1.60. Shown while the round is
   * settled and kept while idle, so the last prize stays readable.
   */
  const showReadout = outcomeTier !== null && (phase === 'settled' || phase === 'idle');
  const readoutTier = showReadout && outcomeTier !== null ? cabinet.tiers[outcomeTier] : null;
  const readoutWin = !!readoutTier && readoutTier.multiplier > 0;
  const readoutPlateText = readoutTier
    ? readoutWin
      ? `PRIZE ×${(readoutTier.multiplier / 100).toFixed(2)} · ${readoutTier.prize}`
      : 'SLIP · NO PRIZE'
    : 'INSERT BET';

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
        {/* The cabinet itself: an illustrated cel-shaded body (public/art).
            Everything interactive — rail, claw, capsules, chute, plates, HUD — is
            still vector and drawn on top, so the art can be swapped without
            touching a single line of game logic. */}
        <image href="/art/cabinet.webp" x="0" y="0" width={VIEW.w} height={VIEW.h} preserveAspectRatio="none" />

        {/* bulbs the art already draws; these are the lit overlay that twinkles */}
        {Array.from({ length: 17 }).map((_, i) => (
          <circle
            key={i}
            cx={62 + i * 49.1}
            cy={40}
            r="4.6"
            fill="url(#lamp)"
            className="kl-bulb"
            style={{ animationDelay: `${(i % 6) * 0.24}s` }}
          />
        ))}

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
              <CapsuleSprite shell={heldShell} />
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
                <CapsuleSprite shell={shell} label={aimed && !inFlight} />
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
          {/* narrow carriage only: the claw itself is the illustrated sprite, so
              it reads as a real gripper against the painted cabinet */}
          <rect x="-13" y={RAIL.y - 5} width="26" height="15" rx="5" fill="#6d7295" />
          <rect x="-8" y={RAIL.y - 8} width="16" height="4" rx="2" fill="#c3c8e6" opacity="0.55" />
        </g>
        <g className="kl-claw" style={{ transform: `translate(${clawX}px, ${clawY}px)` }}>
          <line x1="0" y1={RAIL.y + RAIL.h - clawY} x2="0" y2="-20" stroke="#7d82a8" strokeWidth="1.4" />
          <image
            href="/art/claw.webp"
            x={-30}
            y={-24}
            width={60}
            height={76}
            className={`kl-claw-art ${gripperOpen ? 'open' : 'closed'}`}
          />
          {holding && (
            <g transform="translate(0 68)" className={`kl-held ${phase === 'dumping' ? 'dropping' : ''}`}>
              <CapsuleSprite shell={heldShell} scale={0.94} />
            </g>
          )}
        </g>

        {/* ------------------------------------------------------- plates */}
        <g className={`kl-plate ${slipped ? 'tilt-on' : ''}`}>
          <rect x="52" y="240" width="190" height="52" rx="8" />
          <text x="147" y="272">TILT</text>
        </g>
        <g className={`kl-plate ${isJackpot ? 'jackpot-on' : ''}`}>
          <rect x="630" y="240" width="198" height="52" rx="8" />
          <text x="729" y="272">JACKPOT ×{Math.round(cabinet.tiers[cabinet.tiers.length - 1].multiplier / 100)}</text>
        </g>
        <g className={`kl-plate kl-plate-coin ${readoutWin ? 'readout-win' : ''} ${readoutTier && !readoutWin ? 'readout-slip' : ''}`}>
          <rect x="304" y="240" width="290" height="52" rx="8" />
          <text x="449" y="272">{readoutPlateText}</text>
        </g>

        <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx="14" fill="url(#glass)" className="kl-glass" />

        {/* drawn last, so neither the rail nor the glass can cross the readouts */}
        <g className="kl-hud-pill">
          <rect x={CASE.x + 12} y={CASE.y + 10} width="112" height="22" rx="11" />
          <text x={CASE.x + 26} y={CASE.y + 25} className="kl-hud">PULL #{pullNumber}</text>
        </g>
        <g className="kl-chip-hud">
          <rect x={CASE.x + CASE.w - 160} y={CASE.y + 10} width="148" height="22" rx="11" />
          <text x={CASE.x + CASE.w - 24} y={CASE.y + 25} textAnchor="end">
            {chipLabel}
          </text>
        </g>


      </svg>

      {/* aim strip: one button per column, so the claw can be placed without a drag */}
      <div className="kl-aim" aria-hidden={disabled}>
        {COL_X.map((cx, column) => (
          <button
            key={column}
            type="button"
            className="kl-aim-col"
            style={{
              left: `${((cx - 41) / VIEW.w) * 100}%`,
              width: `${(82 / VIEW.w) * 100}%`,
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
