import { type CSSProperties } from 'react';

/**
 * The win moment, played over the glass.
 *
 * Only the rungs that are actually worth shouting about reach this overlay —
 * a ×1.60 grip still gets the plain result line under the machine, because if
 * every win is a fireworks show then none of them is. The payout figure is read
 * straight from the settled round, never recomputed here.
 */
export type WinOverlayProps = {
  /** Multiplier in the display unit, e.g. 22 or 96. */
  multiplier: number;
  prize: string;
  /** Already-formatted payout, exactly as the banner prints it. */
  payoutText: string;
  /** True when the round hit this cabinet's top rung — its jackpot. */
  isJackpot: boolean;
  onDismiss: () => void;
};

function title(multiplier: number, isJackpot: boolean): string {
  if (isJackpot) return 'JACKPOT';
  if (multiplier >= 6) return 'MEGA WIN';
  return 'BIG WIN';
}

function format(multiplier: number): string {
  return Number.isInteger(multiplier) ? `×${multiplier}` : `×${multiplier.toFixed(2)}`;
}

/** Twelve sparks on fixed spokes: deterministic, so the burst is identical each time. */
const SPARKS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2;
  return {
    dx: `${Math.round(Math.cos(angle) * 132)}px`,
    dy: `${Math.round(Math.sin(angle) * 132)}px`,
    delay: `${(i % 4) * 45}ms`,
  };
});

export function WinOverlay({ multiplier, prize, payoutText, isJackpot, onDismiss }: WinOverlayProps) {
  return (
    <button
      type="button"
      className="kl-win"
      onClick={onDismiss}
      aria-label={`${title(multiplier, isJackpot)}: ${prize} at ${format(multiplier)}`}
    >
      <span className="kl-win-rays" aria-hidden="true" />
      <span className="kl-win-sparks" aria-hidden="true">
        {SPARKS.map((spark, i) => (
          <i key={i} style={{ '--dx': spark.dx, '--dy': spark.dy, animationDelay: spark.delay } as CSSProperties} />
        ))}
      </span>
      <span className="kl-win-card">
        <span className="kl-win-title">{title(multiplier, isJackpot)}</span>
        <strong className="kl-win-mult">{format(multiplier)}</strong>
        <span className="kl-win-prize">{prize}</span>
        <span className="kl-win-payout">+{payoutText}</span>
        <span className="kl-win-hint">click to dismiss</span>
      </span>
      <span className="kl-win-timer" aria-hidden="true" />
    </button>
  );
}
