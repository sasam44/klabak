import { useEffect, useMemo, useState } from 'react';
import { CABINETS, type Cabinet } from '../lib/tables.generated';
import { isSlip } from '../lib/klabak';

/**
 * The cabinet. One SVG, no external assets, so it paints on the first frame
 * instead of after a network round trip.
 *
 * Animation philosophy: the claw's travel and descent are *generic* — they show
 * nothing about the outcome, because it is not known yet. Only the grip reveals
 * it: the servo closes, and either the prize comes up or it tumbles back. That
 * is the whole game, and it is why a loss still feels like a near miss rather
 * than a blank.
 */
export type Phase = 'idle' | 'positioning' | 'descending' | 'gripping' | 'lifting' | 'dumping' | 'settled';

export type ClawMachineProps = {
  cabinet: Cabinet;
  cabinetId: number;
  phase: Phase;
  /** Tier that came back from the draw, once known. */
  outcomeTier: number | null;
  /** Which of the pile slots the claw went for this round. */
  targetSlot: number;
  onSelectCabinet: (id: number) => void;
  disabled: boolean;
};

/** Prize pile: a deterministic spread per cabinet, so the machine keeps its character. */
function pileLayout(cabinet: Cabinet): { cx: number; cy: number; tier: number; rot: number }[] {
  const tiers = cabinet.tiers;
  const spread: { dx: number; dy: number; tier: number; rot: number }[] = [
    { dx: -120, dy: 6, tier: 1, rot: -14 },
    { dx: -72, dy: -8, tier: 2, rot: 8 },
    { dx: -24, dy: 4, tier: 1, rot: 16 },
    { dx: 24, dy: -10, tier: 3, rot: -8 },
    { dx: 72, dy: 2, tier: 2, rot: 12 },
    { dx: 120, dy: -4, tier: 1, rot: -18 },
    { dx: 0, dy: -26, tier: 2, rot: 4 },
  ];
  return spread.map((s, i) => ({
    cx: 300 + s.dx,
    cy: 372 + s.dy,
    tier: Math.min(s.tier, tiers.length - 1),
    rot: s.rot + (i % 2 === 0 ? 2 : -2),
  }));
}

/** Rarity palette: the rarer the prize, the hotter the rim. */
export const TIER_COLORS = ['#6f6a7d', '#5fd0c5', '#7d8bff', '#ffcd6b'];

function Capsule({
  tier,
  variant,
  highlight,
}: {
  tier: number;
  variant: number;
  highlight?: boolean;
}) {
  const color = TIER_COLORS[Math.min(tier, TIER_COLORS.length - 1)];
  const shapes = [
    <ellipse key="a" cx="0" cy="0" rx="19" ry="15" />,
    <path key="b" d="M-18 2c0-9 8-16 18-16s18 7 18 16z" />,
    <rect key="c" x="-15" y="-12" width="30" height="24" rx="9" />,
  ];
  return (
    <g>
      <ellipse cx="0" cy="4" rx="20" ry="6" fill="#000" opacity="0.35" />
      <g
        fill={color}
        fillOpacity={highlight ? 0.95 : 0.6}
        stroke={color}
        strokeWidth={highlight ? 2 : 1}
        strokeOpacity={highlight ? 1 : 0.7}
      >
        {shapes[variant % shapes.length]}
      </g>
      <ellipse cx="-5" cy="-5" rx="6" ry="4" fill="#fff" opacity={highlight ? 0.4 : 0.2} />
      {tier >= 3 && (
        <g stroke={color} strokeWidth="1" opacity="0.75">
          <path d="M0 -22 5 -14-5 -14z" fill={color} fillOpacity="0.5" stroke="none" />
          <path d="M22 0 14 5 14-5z" fill={color} fillOpacity="0.35" stroke="none" />
          <path d="M-22 0-14 5-14-5z" fill={color} fillOpacity="0.35" stroke="none" />
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
  targetSlot,
  onSelectCabinet,
  disabled,
}: ClawMachineProps) {
  const pile = useMemo(() => pileLayout(cabinet), [cabinet]);
  const [flash, setFlash] = useState(0);

  // Marquee blink, and a red "TILT" lamp on a slip.
  const slipped = phase === 'settled' && outcomeTier !== null && isSlip(cabinet, outcomeTier);
  const won = phase === 'settled' && outcomeTier !== null && !isSlip(cabinet, outcomeTier);
  useEffect(() => {
    if (phase === 'gripping') setFlash(f => f + 1);
  }, [phase]);

  const target = pile[targetSlot % pile.length];

  // Claw geometry by phase. The claw rides a rail across the top, then a cable
  // pays out; both are pure transforms so nothing re-renders mid-flight.
  const clawX = target.cx;
  const clawY = phase === 'idle' || phase === 'positioning' ? 132 : phase === 'descending' ? 300 : 168;
  const cableTop = 78;
  const holding = phase === 'lifting' || phase === 'dumping' || (phase === 'settled' && won);
  const gripperOpen = phase === 'descending' || phase === 'positioning' || phase === 'idle' || (phase === 'settled' && slipped);

  return (
    <div className={`kl-cabinet ${phase} ${slipped ? 'is-slip' : ''} ${won ? 'is-win' : ''}`}>
      <svg viewBox="0 0 600 560" role="img" aria-label={`${cabinet.name} claw machine`}>
        <defs>
          <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2440" />
            <stop offset="0.55" stopColor="#1a1630" />
            <stop offset="1" stopColor="#120f22" />
          </linearGradient>
          <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9fd7ff" stopOpacity="0.16" />
            <stop offset="0.4" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#6f8fff" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c8cbe6" />
            <stop offset="1" stopColor="#5e6488" />
          </linearGradient>
          <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffe9a8" />
            <stop offset="1" stopColor="#ffb545" stopOpacity="0" />
          </radialGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* ---------- cabinet body ---------- */}
        <rect x="34" y="46" width="532" height="466" rx="18" fill="url(#body)" stroke="#3b3560" strokeWidth="2" />
        <rect x="34" y="46" width="532" height="60" rx="18" fill="#191533" stroke="#3b3560" strokeWidth="1.5" />

        {/* marquee bulbs */}
        {Array.from({ length: 18 }).map((_, i) => (
          <circle
            key={i}
            cx={58 + i * 28.5}
            cy={76}
            r="4.6"
            fill="url(#lamp)"
            className="kl-bulb"
            style={{ animationDelay: `${(i % 6) * 0.24}s` }}
          />
        ))}

        {/* ---------- glass case ---------- */}
        <rect x="62" y="120" width="476" height="290" rx="10" fill="#0b0a17" stroke="#4b4477" strokeWidth="2" />
        <rect
          x="62"
          y="120"
          width="476"
          height="290"
          rx="10"
          fill="url(#glass)"
          className="kl-glass"
        />

        {/* back-panel catenary wires, so the case has depth */}
        <g stroke="#3a3560" strokeWidth="1" opacity="0.55">
          <path d="M62 150 H538" />
          <path d="M62 214 H538" />
          <path d="M78 120 V410" />
          <path d="M522 120 V410" />
        </g>

        {/* ---------- prize pile ---------- */}
        <g>
          {pile.map((slot, i) => {
            const isTarget = i === targetSlot % pile.length;
            const taken = holding && isTarget;
            return (
              <g
                key={i}
                transform={`translate(${slot.cx} ${slot.cy}) rotate(${slot.rot})`}
                className={isTarget ? 'kl-slot-target' : undefined}
                style={taken ? { opacity: 0 } : undefined}
              >
                <Capsule tier={slot.tier} variant={i} highlight={isTarget && (phase === 'descending' || phase === 'gripping')} />
              </g>
            );
          })}
        </g>

        {/* floor of the case + chute mouth */}
        <rect x="62" y="392" width="476" height="18" fill="#151230" />
        <rect x="430" y="392" width="108" height="18" rx="4" fill="#0a0916" stroke="#4b4477" />
        <text x="484" y="386" textAnchor="middle" className="kl-chute-label">
          PRIZE
        </text>

        {/* ---------- rail + claw ---------- */}
        <rect x="70" y="70" width="460" height="7" rx="3.5" fill="url(#rail)" />
        <g className="kl-claw" style={{ transform: `translate(${clawX}px, 0px)` }}>
          <rect x="-13" y="72" width="26" height="14" rx="4" fill="#8f94b8" />
          <line x1="0" y1={cableTop} x2="0" y2={clawY - 26} stroke="#aeb4d6" strokeWidth="1.6" />
          <g style={{ transform: `translateY(${clawY - 132}px)` }}>
            <rect x="-22" y="-4" width="44" height="14" rx="5" fill="#b9bfe0" />
            <rect x="-22" y="-10" width="44" height="8" rx="4" fill="#dfe3ff" opacity="0.7" />
            {/* three prongs; they splay when open, close on the grip */}
            {[-1, 1].map(side => (
              <path
                key={side}
                d={
                  gripperOpen
                    ? `M${side * 15} 8 C ${side * 30} 26, ${side * 34} 40, ${side * 26} 54`
                    : `M${side * 15} 8 C ${side * 24} 26, ${side * 20} 40, ${side * 10} 50`
                }
                stroke="#dfe3ff"
                strokeWidth="3.4"
                fill="none"
                strokeLinecap="round"
                className="kl-prong"
              />
            ))}
            <path
              d={gripperOpen ? 'M-2 8 L-2 40' : 'M-2 8 L-2 34'}
              stroke="#9aa0c4"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            {holding && !isSlip(cabinet, outcomeTier ?? 0) && (
              <g className="kl-held" transform="translate(0 62)">
                <Capsule tier={outcomeTier ?? 1} variant={targetSlot} highlight />
              </g>
            )}
          </g>
        </g>

        {/* ---------- TILT lamp ---------- */}
        <g className={`kl-tilt ${slipped ? 'on' : ''}`}>
          <rect x="256" y="444" width="88" height="30" rx="6" fill="#0d0b1c" stroke="#4b4477" />
          <text x="300" y="464" textAnchor="middle" className="kl-tilt-text">
            TILT
          </text>
        </g>
        <g className={`kl-win-lamp ${won ? 'on' : ''}`}>
          <rect x="356" y="444" width="112" height="30" rx="6" fill="#0d0b1c" stroke="#4b4477" />
          <text x="412" y="464" textAnchor="middle" className="kl-tilt-text">
            JACKPOT
          </text>
        </g>

        {/* coin slot + payout tray */}
        <rect x="92" y="444" width="120" height="30" rx="6" fill="#0d0b1c" stroke="#4b4477" />
        <text x="152" y="464" textAnchor="middle" className="kl-tilt-text">
          INSERT BET
        </text>
        <rect x="92" y="486" width="376" height="18" rx="6" fill="#0a0916" stroke="#4b4477" />
        <text x="280" y="500" textAnchor="middle" className="kl-chute-label">
          PAYOUT TRAY
        </text>
      </svg>

      {/* ---------- cabinet selector, in front of the machine ---------- */}
      <div className="kl-tabs" role="tablist" aria-label="Cabinet">
        {CABINETS.map(c => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === cabinetId}
            className={`kl-tab ${c.id === cabinetId ? 'active' : ''}`}
            onClick={() => onSelectCabinet(c.id)}
            disabled={disabled}
            type="button"
          >
            <span className="kl-tab-name">{c.name}</span>
            <span className="kl-tab-meta">
              {c.volatility} · up to ×{(c.tiers[c.tiers.length - 1].multiplier / 100).toFixed(0)}
            </span>
          </button>
        ))}
      </div>
      <span className="kl-flash" data-flash={flash} aria-hidden />
    </div>
  );
}
