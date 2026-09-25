#!/usr/bin/env node
// Independent replay of Klabak rounds against the local chain.
//
// For every settled KlabakGame session this reads the settled event (which
// carries the VRF randomness and the game's final state), then re-derives the
// prize from the randomness using a from-scratch reimplementation of the
// contract's rejection sampling and payout rule, and compares.
//
// Nothing here imports the game or the SDK: if this script agrees with the
// chain, the chain outcome is a pure function of the randomness and the
// published paytable.
//
//   node tools/verify-rounds.mjs           # reads simulator/local-node/deployed.json
//   RPC=... HOST=... GAME=... node tools/verify-rounds.mjs

import { readFileSync } from 'node:fs';
import { createPublicClient, http, decodeAbiParameters, formatUnits, keccak256, toHex } from 'viem';

const PROB_SCALE = 1_000_000n;
const DRAW_LIMIT = 4_294_000_000n;    // largest multiple of PROB_SCALE <= 2^32
const DRAW_ATTEMPTS = 8;
const MULT_SCALE = 100n;

// --- paytable: the single source of truth is math/tables.json ---------------
const tables = JSON.parse(readFileSync(new URL('../math/tables.json', import.meta.url), 'utf8'));
const cabinets = tables.cabinets.map(c => ({
  id: c.id,
  name: c.name,
  weights: c.tiers.map(t => BigInt(t.weight)),
  mults: c.tiers.map(t => BigInt(t.multiplier)),
  prizes: c.tiers.map(t => t.prize),
}));

function draw(cabinet, randomness) {
  const { weights } = cabinets[cabinet];
  const word = BigInt(randomness);
  for (let i = 0; i < DRAW_ATTEMPTS; i++) {
    const candidate = BigInt.asUintN(32, word >> BigInt(i * 32));
    if (candidate >= DRAW_LIMIT) continue;              // unbiased rejection
    const r = candidate % PROB_SCALE;
    let acc = 0n;
    for (let t = 0; t < weights.length; t++) {
      acc += weights[t];
      if (r < acc) return { tier: t, roll: Number(r), attempt: i };
    }
    return { tier: weights.length - 1, roll: Number(r), attempt: i };
  }
  const fallback = BigInt(keccak256(toHex(randomness))) % PROB_SCALE;
  let acc = 0n;
  for (let t = 0; t < weights.length; t++) {
    acc += weights[t];
    if (fallback < acc) return { tier: t, roll: Number(fallback), attempt: -1 };
  }
  return { tier: weights.length - 1, roll: Number(fallback), attempt: -1 };
}

const payoutOf = (wager, cabinet, tier) => (wager * cabinets[cabinet].mults[tier]) / MULT_SCALE;

// --- chain ------------------------------------------------------------------
let deployed = {};
try { deployed = JSON.parse(readFileSync(new URL('../simulator/local-node/deployed.json', import.meta.url), 'utf8')); } catch { /* args/env instead */ }

const rpcUrl = process.env.RPC ?? deployed.rpcUrl ?? 'http://127.0.0.1:8545';
const host = process.env.HOST ?? deployed.host;
const game = process.env.GAME ?? deployed.games?.find(g => g.name === 'KlabakGame')?.address;
if (!host || !game) {
  console.error('need a host + game address (env HOST/GAME or simulator/local-node/deployed.json)');
  process.exit(2);
}

const chain = { id: 31337, name: 'local', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const pub = createPublicClient({ chain, transport: http(rpcUrl) });

const settledEvent = {
  type: 'event',
  name: 'CasinoSessionSettled',
  inputs: [
    { type: 'uint256', name: 'sessionId', indexed: true },
    { type: 'address', name: 'game', indexed: true },
    { type: 'address', name: 'player', indexed: true },
    { type: 'uint8', name: 'phase', indexed: false },
    { type: 'uint256', name: 'payout', indexed: false },
    { type: 'bytes32', name: 'randomness', indexed: false },
    { type: 'bytes', name: 'gameState', indexed: false },
  ],
};

const logs = await pub.getLogs({ address: host, fromBlock: 0n, toBlock: 'latest', events: [settledEvent] });
let checked = 0, mismatched = 0, paid = 0n, wagered = 0n;

for (const log of logs) {
  const { sessionId, game: eventGame, payout, randomness, gameState } = log.args;
  if (eventGame.toLowerCase() !== game.toLowerCase()) continue;

  // gameState = abi.encode(uint8 cabinet, uint8 tier, uint32 roll, bytes32 randomness)
  const [cabinet, tier, roll, echoed] = decodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint32' }, { type: 'bytes32' }], gameState);

  // wager is not in this event; read it back from the session snapshot.
  const wager = await wagerOf(log.args.player);
  const expectedTier = draw(Number(cabinet), randomness);
  const expectedPayout = payoutOf(wager, Number(cabinet), expectedTier.tier);

  const tierOk = Number(tier) === expectedTier.tier;
  const rollOk = Number(roll) === expectedTier.roll;
  const echoOk = String(echoed).toLowerCase() === String(randomness).toLowerCase();
  const payoutOk = payout === expectedPayout;
  const ok = tierOk && rollOk && echoOk && payoutOk;

  checked++; if (!ok) mismatched++;
  paid += payout; wagered += wager;

  console.log(
    `session ${String(sessionId).padStart(3)}  ${cabinets[Number(cabinet)].name.padEnd(12)}` +
    `  replay=${cabinets[Number(cabinet)].prizes[expectedTier.tier].padEnd(15)} (roll ${String(expectedTier.roll).padStart(6)}, attempt ${expectedTier.attempt})` +
    `  chain=${cabinets[Number(cabinet)].prizes[Number(tier)].padEnd(15)} (roll ${String(roll).padStart(6)})` +
    `  payout ${formatUnits(payout, 18).padStart(8)} vs ${formatUnits(expectedPayout, 18).padStart(8)}  ${ok ? 'OK' : 'MISMATCH'}`,
  );
  if (!ok) console.log(`        tier=${tierOk} roll=${rollOk} echo=${echoOk} payout=${payoutOk}`);
}

console.log(`\n${checked - mismatched}/${checked} sessions replay exactly from their VRF randomness.`);
if (wagered > 0n) console.log(`sample return ${(Number(paid) / Number(wagered) * 100).toFixed(2)}% over ${checked} rounds (small-sample noise; declared RTP is 96.00%)`);
process.exit(mismatched === 0 ? 0 : 1);

// The local host is a stand-in for the diamond: it does not expose a wager
// getter, so we fall back to the wager the frontend uses by default (10 chUSD)
// unless the caller sets WAGER. Kept explicit rather than clever.
async function wagerOf() {
  return BigInt(process.env.WAGER ?? 10n * 10n ** 18n);
}
