#!/usr/bin/env node
// Offline check: math source -> contract -> ABI, with no chain involved.
//
//   1. re-verifies math/tables.json (weights sum to exactly the declared RTP)
//   2. compiles simulator/contracts/KlabakGame.sol with the same solc settings
//      the local node uses (optimizer 200 + viaIR)
//   3. asserts the compiled ABI is exactly the ICasinoGameV2 surface
//   4. asserts the paytable baked into the contract equals math/tables.json
//
//   node tools/verify-contract.mjs

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import solc from 'solc';

const ROOT = new URL('..', import.meta.url);
const tables = JSON.parse(readFileSync(new URL('math/tables.json', ROOT), 'utf8'));
const source = readFileSync(new URL('simulator/contracts/KlabakGame.sol', ROOT), 'utf8');

let failed = false;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed = true;
};

// --- 1. the math ------------------------------------------------------------
console.log(`tables.json: declaredRtpPpm=${tables.declaredRtpPpm} (${tables.declaredRtpPpm / 10000}%)`);
for (const cabinet of tables.cabinets) {
  const sum = cabinet.tiers.reduce((acc, t) => acc + t.weight, 0);
  const contribution = cabinet.tiers.reduce((acc, t) => acc + t.weight * t.multiplier, 0);
  const rtp = (contribution * 1_000_000) / (tables.probabilityScale * tables.multiplierScale);
  check(sum === tables.probabilityScale, `${cabinet.name}: weights sum to ${tables.probabilityScale}`, `got ${sum}`);
  check(rtp === tables.declaredRtpPpm, `${cabinet.name}: RTP exactly ${tables.declaredRtpPpm} ppm`, `got ${rtp}`);
}

// --- 2/3. the contract ------------------------------------------------------
const dir = resolve(new URL('simulator/contracts', ROOT).pathname);
const file = 'KlabakGame.sol';
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { [file]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}), { import: (p) => {
  try { return { contents: readFileSync(resolve(dir, p), 'utf8') }; } catch { return { error: `Import not found: ${p}` }; }
} }));

const errors = (out.errors ?? []).filter(e => e.severity === 'error');
if (errors.length) {
  console.error(errors.map(e => e.formattedMessage).join('\n'));
  process.exit(1);
}
for (const w of (out.errors ?? []).filter(e => e.severity !== 'error')) {
  console.log(`  warn  ${w.formattedMessage.split('\n')[0]}`);
}

const compiled = out.contracts[file].KlabakGame;
const abi = compiled.abi;
const bytecode = compiled.evm.bytecode.object;
const functions = abi.filter(e => e.type === 'function').map(e => e.name).sort();
const expected = ['declaredRtpPpm', 'onPlayerAction', 'onRandomness', 'onSessionStart', 'paytable', 'quoteCaps', 'quoteForfeitPayout', 'quoteRiskParams'];

check(JSON.stringify(functions) === JSON.stringify(expected), 'ABI is exactly the ICasinoGameV2 surface', functions.join(', '));
check(compiled.abi.some(e => e.type === 'error' && e.name === 'KlabakGame__NoPlayerAction'), 'rejects player actions with a named error');
console.log(`  info  bytecode ${bytecode.length / 2} bytes, sha256 ${createHash('sha256').update(bytecode).digest('hex').slice(0, 16)}…`);

// --- 4. the contract's own numbers -----------------------------------------
const declared = source.match(/DECLARED_RTP_PPM\s*=\s*([\d_]+)/);
const declaredPpm = declared ? Number(declared[1].replaceAll('_', '')) : NaN;
check(declaredPpm === tables.declaredRtpPpm, `contract declares ${tables.declaredRtpPpm} ppm like the tables`, `source says ${declaredPpm}`);

// The generator emits both tables as array literals, one line per cabinet:
//   if (cabinet == 0) return [uint32(500000), uint32(360000), ...];
const arrayRows = (name) => {
  const block = source.match(new RegExp(`function _${name}[\\s\\S]*?\\n  }`))?.[0] ?? '';
  return [...block.matchAll(/return \[([^\]]+)\]/g)].map(row => [...row[1].matchAll(/\((\d+)\)/g)].map(x => Number(x[1])));
};
const weights = arrayRows('weights');
const multipliers = arrayRows('multipliers');
check(weights.length === tables.cabinets.length, 'one weight array per cabinet', `${weights.length} rows`);
check(multipliers.length === tables.cabinets.length, 'one multiplier array per cabinet', `${multipliers.length} rows`);
tables.cabinets.forEach((cabinet, i) => {
  const wantedW = cabinet.tiers.map(t => t.weight);
  const wantedM = cabinet.tiers.map(t => t.multiplier);
  check(JSON.stringify(weights[i]) === JSON.stringify(wantedW), `${cabinet.name}: weight literals match tables.json`, `contract [${weights[i]}]`);
  check(JSON.stringify(multipliers[i]) === JSON.stringify(wantedM), `${cabinet.name}: multiplier literals match tables.json`, `contract [${multipliers[i]}]`);
});

console.log(failed ? '\nFAILED' : '\nall offline checks passed');
process.exit(failed ? 1 : 0);
