import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import type { HexString } from '@chain/casino-sdk';
import {
  CABINETS,
  PROB_SCALE,
  TIER_TOP,
  payoutFor,
  drawFromRandomness,
  isTerminalPhase,
  type Cabinet,
} from './tables.generated';

export * from './tables.generated';

// ---------------------------------------------------------------------------
// Wire format, mirroring KlabakGame.sol exactly.
//   gameData  = abi.encode(uint8 cabinet)
//   gameState = abi.encode(uint8 cabinet, uint8 tier, uint32 draw, bytes32 randomness)
// Tier 255 is the "no tier yet" marker the contract writes in onSessionStart.
// ---------------------------------------------------------------------------
export const NO_TIER = 255;

const GAME_DATA_PARAMS = [{ type: 'uint8' }] as const;
const GAME_STATE_PARAMS = [
  { type: 'uint8' },
  { type: 'uint8' },
  { type: 'uint32' },
  { type: 'bytes32' },
] as const;

export function encodeGameData(cabinetId: number): HexString {
  return encodeAbiParameters(GAME_DATA_PARAMS, [cabinetId]);
}

export function decodeGameData(gameData: HexString): number | null {
  try {
    const [cabinetId] = decodeAbiParameters(GAME_DATA_PARAMS, gameData);
    return Number(cabinetId);
  } catch {
    return null;
  }
}

export type KlabakOutcome = {
  cabinetId: number;
  tier: number;
  draw: number;
  randomness: bigint;
  /** Present only in demo mode; in a real round the randomness is the source. */
  demo?: boolean;
};

export function decodeGameState(gameState: HexString): KlabakOutcome | null {
  try {
    const [cabinetId, tier, draw, randomness] = decodeAbiParameters(GAME_STATE_PARAMS, gameState);
    if (Number(tier) === NO_TIER) return null; // randomness not delivered yet
    return {
      cabinetId: Number(cabinetId),
      tier: Number(tier),
      draw: Number(draw),
      randomness: BigInt(randomness),
    };
  } catch {
    return null;
  }
}

/** Mirror of the contract draw, used when a settled row arrives without state. */
export function outcomeFromRandomness(cabinetId: number, randomness: bigint): KlabakOutcome {
  const cabinet = cabinetById(cabinetId);
  const { tier, draw } = drawFromRandomness(cabinet, randomness);
  return { cabinetId, tier, draw, randomness };
}

/** Last-resort outcome when neither gameState nor randomness has synced: a win
 *  shows the prize its payout implies (the largest tier the payout can fund). */
export function outcomeFromPayout(cabinetId: number, wager: bigint, payout: bigint): KlabakOutcome {
  const cabinet = cabinetById(cabinetId);
  if (payout <= 0n) return { cabinetId, tier: 0, draw: 0, randomness: 0n };
  for (let t = TIER_TOP; t >= 1; t--) {
    if (payoutFor(wager, cabinet, t) <= payout) return { cabinetId, tier: t, draw: 0, randomness: 0n };
  }
  return { cabinetId, tier: 1, draw: 0, randomness: 0n };
}

// ---------------------------------------------------------------------------
// Cabinet helpers
// ---------------------------------------------------------------------------
export function cabinetById(id: number): Cabinet {
  return CABINETS[id] ?? CABINETS[0];
}

export function isSlip(cabinet: Cabinet, tier: number): boolean {
  return cabinet.tiers[tier]?.multiplier === 0;
}

export function prizeName(cabinet: Cabinet, tier: number): string {
  return isSlip(cabinet, tier) ? 'slipped' : cabinet.tiers[tier].prize;
}

/** Chance of *any* prize on this cabinet, as a percentage string. */
export function holdChancePct(cabinet: Cabinet): number {
  const held = cabinet.tiers.reduce((acc, t) => (t.multiplier > 0 ? acc + t.weight : acc), 0);
  return (held / PROB_SCALE) * 100;
}

/** Best tier the wager could win, for the headline "up to x96" label. */
export function topMultiplier(cabinet: Cabinet): number {
  return cabinet.tiers[TIER_TOP].multiplier / 100;
}

export { isTerminalPhase };
