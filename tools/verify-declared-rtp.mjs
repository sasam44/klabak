#!/usr/bin/env node
// On-chain check: what the deployed KlabakGame declares must equal the paytable.
//
// Reads declaredRtpPpm / paytable / quoteCaps / quoteRiskParams from the chain
// the local node is running, cross-checks every number against math/tables.json,
// and re-derives each RTP from the arrays the contract itself returned.
//
//   npm start            # in another terminal: local node + simulator
//   node tools/verify-declared-rtp.mjs

import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';

const ROOT = new URL('..', import.meta.url);
const tables = JSON.parse(readFileSync(new URL('math/tables.json', ROOT), 'utf8'));
let deployed;
try {
  deployed = JSON.parse(readFileSync(new URL('simulator/local-node/deployed.json', ROOT), 'utf8'));
} catch {
  console.error('no simulator/local-node/deployed.json — run `npm start` first');
  process.exit(2);
}
const game = deployed.games.find(g => g.name === 'KlabakGame');
if (!game) { console.error('KlabakGame is not deployed on this chain'); process.exit(2); }

const abi = parseAbi([
  'function declaredRtpPpm(uint8 cabinet) view returns (uint256)',
  'function paytable(uint8 cabinet) view returns (uint32[4] weightsPpm, uint16[4] multipliersCenti)',
  'function quoteCaps(uint256 wager, bytes gameData) view returns (uint256 maxEscrowStake, uint256 maxReservedProfit)',
  'function quoteRiskParams(uint256 wager, bytes gameData) view returns (uint256 maxPayout, uint256 probabilityWad, uint256 expectedPayout, uint256 bodyVarianceScaled)',
]);
const client = createPublicClient({ transport: http(deployed.rpcUrl) });
const encCabinet = id => `0x${id.toString(16).padStart(64, '0')}`;
const wager = 10n ** 19n;   // 10 tokens

let failed = false;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed = true;
};

console.log(`KlabakGame @ ${game.address} (chainId ${deployed.chainId}, ${deployed.rpcUrl})`);
console.log(`wager ${formatUnits(wager, 18)} tokens\n`);

for (const cabinet of tables.cabinets) {
  const id = cabinet.id;
  const rtp = await client.readContract({ address: game.address, abi, functionName: 'declaredRtpPpm', args: [id] });
  const [weights, multipliers] = await client.readContract({ address: game.address, abi, functionName: 'paytable', args: [id] });
  const [caps, risk] = await Promise.all([
    client.readContract({ address: game.address, abi, functionName: 'quoteCaps', args: [wager, encCabinet(id)] }),
    client.readContract({ address: game.address, abi, functionName: 'quoteRiskParams', args: [wager, encCabinet(id)] }),
  ]);

  // 1. the contract's arrays must be the tables
  check(JSON.stringify(weights.map(Number)) === JSON.stringify(cabinet.tiers.map(t => t.weight)),
    `${cabinet.name}: on-chain weights == tables.json`, `[${weights}]`);
  check(JSON.stringify(multipliers.map(Number)) === JSON.stringify(cabinet.tiers.map(t => t.multiplier)),
    `${cabinet.name}: on-chain multipliers == tables.json`, `[${multipliers}]`);

  // 2. RTP re-derived from the arrays the contract itself returned
  const rederived = weights.reduce((acc, w, i) => acc + Number(w) * Number(multipliers[i]), 0) * 1_000_000
    / (tables.probabilityScale * tables.multiplierScale);
  check(Number(rtp) === tables.declaredRtpPpm && rederived === tables.declaredRtpPpm,
    `${cabinet.name}: declaredRtpPpm == recomputed == ${tables.declaredRtpPpm}`,
    `declared ${rtp} ppm, recomputed ${rederived} ppm = ${(rederived / 10000).toFixed(2)}%`);

  // 3. the risk quotes the host prices the bet with
  const topMultiplier = Math.max(...cabinet.tiers.map(t => t.multiplier));
  const topPayout = (wager * BigInt(topMultiplier)) / 100n;
  const topWeight = cabinet.tiers.find(t => t.multiplier === topMultiplier).weight;
  const expectedPayout = (wager * BigInt(tables.declaredRtpPpm)) / 1_000_000n;
  check(caps[0] === wager && caps[1] === topPayout - wager,
    `${cabinet.name}: quoteCaps`, `escrow ${formatUnits(caps[0], 18)} tokens, reservedProfit ${formatUnits(caps[1], 18)} tokens (top prize ${formatUnits(topPayout, 18)})`);
  check(risk[0] === topPayout && risk[1] === (BigInt(topWeight) * 10n ** 18n) / 1_000_000n,
    `${cabinet.name}: quoteRiskParams maxPayout + probability`, `maxPayout ${formatUnits(risk[0], 18)} tokens, p=${Number(risk[1]) / 1e18}`);
  check(risk[2] === expectedPayout, `${cabinet.name}: expectedPayout is exactly ${(tables.declaredRtpPpm / 10000).toFixed(2)}% of the wager`,
    `${formatUnits(risk[2], 18)} tokens`);
  console.log(`  info  body variance (2nd moment around the stake, excl. top tier): ${formatUnits(risk[3], 18)}\n`);
}

console.log(failed ? 'FAILED' : 'deployed contract declares exactly the published paytable');
process.exit(failed ? 1 : 0);
