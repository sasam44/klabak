/**
 * Demo mode: what a visitor gets when they open the hosted URL directly,
 * outside the chain.wtf iframe. The jam requires the page to be a playable
 * standalone demo, so this path mirrors the contract exactly — same tables,
 * same draw, same floor payout — and is labelled DEMO everywhere in the UI.
 *
 * It never touches a wallet and never claims to be real wagering.
 */
import { CABINETS, PROB_SCALE, payoutFor, type Cabinet } from './tables.generated';

export const DEMO_START_BALANCE = 10_000n * 10n ** 18n; // 10,000 play tokens

export type DemoOutcome = { tier: number; draw: number; randomness: bigint };

/** 32 bytes of browser randomness, then the same rejection-sampled draw. */
export function playDemoRound(cabinet: Cabinet): DemoOutcome {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let randomness = 0n;
  for (const b of bytes) randomness = (randomness << 8n) | BigInt(b);

  const limit = Math.floor(2 ** 32 / PROB_SCALE) * PROB_SCALE;
  for (let i = 0; i < 8; i++) {
    const candidate = Number((randomness >> BigInt(i * 32)) & 0xffffffffn);
    if (candidate >= limit) continue;
    const r = candidate % PROB_SCALE;
    let acc = 0;
    for (let t = 0; t < cabinet.tiers.length; t++) {
      acc += cabinet.tiers[t].weight;
      if (r < acc) return { tier: t, draw: r, randomness };
    }
  }
  return { tier: 0, draw: 0, randomness };
}

export function demoPayout(wager: bigint, cabinet: Cabinet, tier: number): bigint {
  return payoutFor(wager, cabinet, tier);
}

export function cabinetById(id: number): Cabinet {
  return CABINETS[id] ?? CABINETS[0];
}
