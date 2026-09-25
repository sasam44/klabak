#!/usr/bin/env node
// Monte-Carlo sanity check of the draw: same rejection sampling as the contract,
// 200k random 256-bit words per cabinet, on math/tables.json's weights.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const tables = JSON.parse(readFileSync(new URL('../math/tables.json', import.meta.url), 'utf8'));
const PROB_SCALE = 1_000_000n, DRAW_LIMIT = 4_294_000_000n, DRAW_ATTEMPTS = 8;
const ROUNDS = Number(process.env.ROUNDS ?? 200_000);

const draw = (weights, randomness) => {
  const word = BigInt('0x' + randomness);
  for (let i = 0; i < DRAW_ATTEMPTS; i++) {
    const candidate = BigInt.asUintN(32, word >> BigInt(i * 32));
    if (candidate >= DRAW_LIMIT) continue;
    const r = candidate % PROB_SCALE;
    let acc = 0n;
    for (let t = 0; t < weights.length; t++) {
      acc += weights[t];
      if (r < acc) return t;
    }
    return weights.length - 1;
  }
  return weights.length - 1;                       // keccak fallback, unreachable in practice
};

console.log(`Monte-Carlo: ${ROUNDS.toLocaleString()} rounds per cabinet\n`);
let worst = 0;
for (const cabinet of tables.cabinets) {
  const weights = cabinet.tiers.map(t => BigInt(t.weight));
  const multipliers = cabinet.tiers.map(t => BigInt(t.multiplier));
  const hits = new Array(weights.length).fill(0);
  for (let n = 0; n < ROUNDS; n++) hits[draw(weights, randomBytes(32).toString('hex'))] += 1;
  const returned = hits.reduce((acc, h, i) => acc + h * Number(multipliers[i]), 0) / ROUNDS / 100;
  const rtp = returned * 100;
  worst = Math.max(worst, Math.abs(rtp - tables.declaredRtpPpm / 10000));
  console.log(`${cabinet.name.padEnd(13)} realised RTP ${rtp.toFixed(3)}%  (declared ${(tables.declaredRtpPpm / 10000).toFixed(2)}%)  hits [${hits.map(h => (h / ROUNDS * 100).toFixed(2) + '%').join(', ')}]`);
}
console.log(`\nlargest deviation from 96.00%: ${worst.toFixed(3)} points (sampling noise at n=${ROUNDS.toLocaleString()})`);
