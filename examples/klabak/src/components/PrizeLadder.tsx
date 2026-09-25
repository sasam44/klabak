import { type Cabinet } from '../lib/tables.generated';

/**
 * The ladder that sits directly above the pull button: every rung this cabinet
 * can pay, with the odds printed next to each one and the top rung flagged.
 *
 * This is the one piece of the genre we deliberately lean into. In this kind of
 * game the ceiling is what people come for, so the ceiling never scrolls off the
 * screen: it stays one line above the button that can pay it. The slip is on the
 * ladder too — a prize board that only shows prizes is an advertisement, not a
 * paytable.
 */
export type PrizeLadderProps = { cabinet: Cabinet };

function odds(weight: number): string {
  if (weight <= 0) return '';
  const oneIn = 1_000_000 / weight;
  if (oneIn < 10) return `1 in ${oneIn.toFixed(1)}`;
  return `1 in ${Math.round(oneIn)}`;
}

function mult(multiplier: number): string {
  const value = multiplier / 100;
  return `×${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export function PrizeLadder({ cabinet }: PrizeLadderProps) {
  const top = cabinet.tiers[cabinet.tiers.length - 1].multiplier;
  const slip = cabinet.tiers[0];
  const prizes = cabinet.tiers.filter(tier => tier.multiplier > 0);

  return (
    <div className="kl-ladder" aria-label={`${cabinet.name} prize ladder`}>
      <span className="kl-ladder-label">Prizes</span>
      {prizes.map(tier => {
        const isTop = tier.multiplier === top;
        return (
          <span key={tier.tier} className={`kl-rung ${isTop ? 'top' : ''}`}>
            <b>{mult(tier.multiplier)}</b>
            <i>{tier.prize}</i>
            <em>{odds(tier.weight)}</em>
          </span>
        );
      })}
      <span className="kl-rung slip">
        <b>slip</b>
        <i>nothing comes up</i>
        <em>{odds(slip.weight)}</em>
      </span>
    </div>
  );
}
