/**
 * Sanity check on the demo draw: is the browser-side draw actually distributed
 * like the published paytable? The demo path must mirror the contract, so a
 * drift here would mean the standalone page lies about its own odds.
 *
 * run: npx tsx tools/check-demo-draw.ts [samples]
 */
import { CABINETS } from '../examples/klabak/src/lib/tables.generated';
import { playDemoRound } from '../examples/klabak/src/lib/demo';

const samples = Number(process.argv[2] ?? 200_000);
let bad = 0;

for (const cabinet of CABINETS) {
  const hits = new Array(cabinet.tiers.length).fill(0);
  for (let i = 0; i < samples; i++) hits[playDemoRound(cabinet).tier]++;

  const rows = cabinet.tiers.map((tier, i) => {
    const expected = tier.weight / 10_000;                 // ppm -> %
    const actual = (hits[i] / samples) * 100;
    const drift = Math.abs(actual - expected);
    if (drift > 0.35) bad++;
    return `    tier ${i} ${tier.prize.padEnd(16)} expected ${expected.toFixed(3)}%  actual ${actual.toFixed(3)}%  drift ${drift.toFixed(3)}`;
  });
  const winRate = ((samples - hits[0]) / samples) * 100;
  const realRtp = cabinet.tiers.reduce((acc, t, i) => acc + (hits[i] / samples) * (t.multiplier / 100), 0) * 100;
  console.log(`${cabinet.name}  (n=${samples})\n${rows.join('\n')}`);
  console.log(`    win rate ${winRate.toFixed(2)}%   realised RTP ${realRtp.toFixed(2)}%   declared ${(cabinet.tiers.reduce((a, t) => a + (t.weight / 1_000_000) * (t.multiplier / 100), 0) * 100).toFixed(2)}%`);
}

console.log(bad === 0 ? '\nOK: every tier within 0.35 points of its published weight.' : `\nFAIL: ${bad} tier(s) drifted.`);
process.exit(bad === 0 ? 0 : 1);
