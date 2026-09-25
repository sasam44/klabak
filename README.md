# Klabak: Gachapon Claw Machine

**Chain Jam Vol. 1 submission.** A gachapon claw machine as an on-chain casino game: three
capsule cabinets, one claw, and an outcome that is decided by the chain's VRF, not by the page.
The prizes are charms you keep on a shelf — pull caps until the set is complete.

> Play it: **https://klabak.vercel.app** — the page runs standalone (play-money demo outside a
> host) and inside chain.wtf it plays real sessions against `KlabakGame.sol`.

**Declared RTP: 96.00% on every cabinet.**

---

## The game

You pick one of three cabinets, set a bet, and pull. The claw travels the rail, drops, and closes
on a capsule. Sometimes the grip holds, the claw lifts the prize out of the pile and drops it in
the tray — you are paid a multiple of your bet. Sometimes it slips, and the capsule falls back
into the pile. That is the whole game.

| Cabinet | Volatility | Prizes (chance · pays) | Top prize | RTP |
| --- | --- | --- | --- | --- |
| **Penny Arcade** | low | slip 50% · Tin Robot 36% ×1.60 · Glass Cat 11% ×2.40 · Porcelain Swan 3% ×4.00 | ×4 | 96.00% |
| **Midway** | medium | slip 78% · Neon Jelly 15% ×2.00 · Crystal Fox 5.5% ×6.00 · Golden Koi 1.5% ×22.00 | ×22 | 96.00% |
| **The Vault** | high | slip 73.5% · Obsidian Beetle 24% ×1.50 · Ivory Idol 2% ×6.00 · Sunken Crown 0.5% ×96.00 | ×96 | 96.00% |

The claw's grip is not decoration: the tier the chain settles is the tier the cabinet plays back.
A slip drops the claw back with nothing; a prize makes the claw carry it to the tray, the win
banner names the charm and the multiple, and the charm is stamped onto your shelf.

## Why it is a claw machine and not a slot

A slot with a claw skin would have been simpler and would have scored the same on "novelty" —
badly. What makes this a machine rather than a re-spin is that the player has a *decision with a
taste*: each cabinet is a different volatility with the same 96% return, so the choice is about
how often you want the claw to hold, not about which one pays more. The three cabinets are
visible side by side, each with its own pile, its own prices and its own lamp; the state you
watch (where the claw is, what it is holding, whether the pile moved) is the chain state.

## What is on chain

`simulator/contracts/KlabakGame.sol` — one contract, no proxies, no owner, no admin:

* `ICasinoGameV2`: `quoteCaps` · `quoteRiskParams` · `onSessionStart` · `onPlayerAction` ·
  `onRandomness` · `quoteForfeitPayout` · `paytable` · `declaredRtpPpm`.
* `gameData` is one byte: the cabinet id. `onSessionStart` validates it, escrows the bet, moves
  the session to `WAITING_RANDOMNESS` and asks for the VRF.
* `onRandomness` draws a tier with rejection sampling over the cabinet's weight row
  (`DRAW_LIMIT = 4_294_000_000`, the largest multiple of the 1e6 probability scale below 2^32, so
  every roll is exactly as likely as every other; eight candidates out of the 256-bit word, then a
  keccak fallback that in practice is unreachable), settles, and writes
  `abi.encode(uint8 cabinet, uint8 tier, uint32 roll, bytes32 randomness)` as the final state.
  The randomness is echoed in the state so anyone can replay the round off-chain.
* `onPlayerAction` reverts with `KlabakGame__NoPlayerAction`: the game has no player actions —
  pulling the claw *is* opening the session. No second call, nothing to time, nothing to time out.
* `declaredRtpPpm(cabinet)` is not a constant: it recomputes `Σ(weight × multiplier)` from the
  same weight and multiplier arrays the settlement path uses, so the declared number cannot drift
  from the paytable that actually pays.

## Verify it yourself

Three commands, no trust required.

```bash
npm install

# 1. offline: tables -> contract -> ABI, and the paytable literals inside the contract
npm run verify:math      # weights sum to 1e6 and RTP comes out at exactly 960000 ppm
npm run verify:contract  # compiles with the simulator's solc settings, ABI == ICasinoGameV2

# 2. run the stack (local chain + simulator + this game on :3200)
npm run start:klabak

# 3. read the deployed contract and replay real rounds
npm run verify:rtp     # on-chain declaredRtpPpm == recomputed == 960000 for all cabinets,
                       # quoteCaps / quoteRiskParams identities (escrow, reserved profit,
                       # max payout, probabilityWad, expectedPayout)
npm run verify:rounds  # every settled session is replayed from its VRF randomness by a
                       # from-scratch reimplementation of the draw + payout rule
npm run verify:simulate  # 200k-word Monte-Carlo of the same draw: realised RTP lands on 96%
```

In the simulator (`http://localhost:3300`), open the setup panel, pick **KlabakGame** in the
deployed-games dropdown, and load `http://localhost:3200` as the game URL. Or skip the panel:

```
http://localhost:3300/?game=http://localhost:3200&gameAddress=<KlabakGame address from deployed.json>
```

## Repository layout

```
math/tables.json                 the only place a paytable number is written by hand
math/generate.py                 verifies the tables, then generates the contract + TS tables + PROOF.md
math/PROOF.md                    the RTP proof the generator emits (weights, contribution, exact total)
simulator/contracts/KlabakGame.sol   GENERATED — do not hand-edit; regenerate with `python3 math/generate.py`
examples/klabak/                 the game page (Vite + React, no wallet code: the host signs)
  src/components/ClawMachine.tsx     the cabinet: rail, claw, prongs, pile, lamps, tray, shelf
  src/components/Paytable.tsx        the printed paytable, read from the generated tables
  src/App.tsx                        the round timeline and the settle path
  src/lib/useCasinoHost.ts           guest bridge (handshake, openSession, revealOutcome)
  src/lib/klabak.ts                  gameData/gameState codec + outcome decoding
  public/game.manifest.json          manifest served from the same origin
  public/og-image.png                1200×630 social card
tools/verify-contract.mjs        offline proof (math -> contract -> ABI)
tools/verify-declared-rtp.mjs    on-chain proof (declaration == paytable)
tools/verify-rounds.mjs          on-chain replay of settled rounds
```

This repository is a fork of the official `@chain/casino-sdk` layout, so both the local simulator
and this game run from one checkout; the upstream README is kept as `README.casino-sdk.md`. All
game code (contract template, math, page, tools) is this submission's; the SDK, simulator and
local chain are the jam's own.

## The settle path in the page

1. `openSession({ wager, gameData: abi.encode(uint8 cabinet) })` — the host signs and pays.
2. Claw animation runs: position (700 ms) → descend (760 ms) → grip and wait. The claw holds at
   the bottom of the stroke for as long as the session takes to reach `SETTLED`; the animation
   never runs ahead of the chain, and the buttons stay disabled while a round is in flight.
3. The settled snapshot is decoded (`gameState` → cabinet, tier, roll, randomness), the claw
   carries the prize or drops it, the banner shows the prize and the multiple, and the page calls
   `revealOutcome({ sessionId })` so the host can close the round.
4. The round is stamped onto the shelf and the history strip; the declared RTP and the local
   count of held grips are shown next to the paytable.

There is a play-money demo path for the same page when it is opened outside a host: identical
paytable, identical draw, in-page balance. That is what makes the standalone URL playable rather
than a dead page.

## Notes

* Everything visible is drawn with CSS and SVG in the page — no external assets, no image
  files, no fonts to load, so the page paints immediately (the manifest, og:image and widget are
  the only static files).
* The contract is generated. To change any number: edit `math/tables.json`, run
  `python3 math/generate.py`, then re-run the three verification commands. The generator refuses
  to write anything unless all three cabinets come out at exactly the declared RTP.
* Sound is synthesised in the page (WebAudio) and off by default.

## License

MIT for everything in this repository's game code (`math/`, `tools/`, `examples/klabak/`, the
generated contract template). The bundled `@chain/casino-sdk` keeps its own license.
