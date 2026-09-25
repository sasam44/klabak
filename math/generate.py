#!/usr/bin/env python3
"""Klabak — single-source math generator and verifier.

  python3 math/generate.py            # verify + emit contract, TS tables and PROOF.md
  python3 math/generate.py --check     # verify only (exit 1 on any mismatch)

Why this file exists: the jam requires "declared math matching your actual paytable".
Hand-typing multipliers into a contract and a frontend is how that promise breaks.
Here the paytable lives once, and every artifact — Solidity constants, the TypeScript
mirror, the proof document — is generated from it. If the arithmetic is not exactly
960000 ppm, nothing is written and the script exits non-zero.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]          # repo root (the casino-sdk layout)
CONTRACT_OUT = ROOT / "simulator" / "contracts" / "KlabakGame.sol"
TS_OUT = ROOT / "examples" / "klabak" / "src" / "lib" / "tables.generated.ts"
PROOF_OUT = ROOT / "math" / "PROOF.md"


# --------------------------------------------------------------- verification
def verify(table: dict) -> list[dict]:
    scale = table["probabilityScale"]
    mscale = table["multiplierScale"]
    declared = table["declaredRtpPpm"]
    results = []
    for cab in table["cabinets"]:
        tiers = cab["tiers"]
        total_w = sum(t["weight"] for t in tiers)
        if total_w != scale:
            raise SystemExit(f"[FAIL] cabinet {cab['key']}: weights sum to {total_w}, expected {scale}")
        if tiers[0]["multiplier"] != 0:
            raise SystemExit(f"[FAIL] cabinet {cab['key']}: tier 0 must be the slip (multiplier 0)")
        # RTP in ppm: sum(w_i * m_i) / (scale * mscale) -> x1e6
        num = sum(t["weight"] * t["multiplier"] for t in tiers)
        rtp_ppm = num / (scale * mscale) * 1_000_000
        if abs(rtp_ppm - declared) > 1e-9:
            raise SystemExit(
                f"[FAIL] cabinet {cab['key']}: RTP {rtp_ppm:.4f} ppm != declared {declared} ppm")
        top = max(tiers, key=lambda t: t["multiplier"])
        if top["multiplier"] > 100 * mscale / mscale * 100:   # > x100 trips heavy-tail checks
            raise SystemExit(f"[FAIL] cabinet {cab['key']}: top multiplier above the x100 heavy-tail threshold")
        results.append({
            "cabinet": cab, "total_weight": total_w, "rtp_ppm": rtp_ppm,
            "top": top, "num": num,
        })
    return results


def rtp_rows(cab: dict) -> list[tuple]:
    rows = []
    for t in cab["tiers"]:
        p = t["weight"] / 1_000_000
        m = t["multiplier"] / 100
        rows.append((t["tier"], t["prize"], t["weight"], f"{p:.5f}", t["multiplier"],
                     f"{m:.2f}", f"{p * m:.5f}"))
    return rows


# --------------------------------------------------------------- codegen
SOLIDITY_TEMPLATE = '''// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ┌──────────────────────────────────────────────────────────────────────────┐
// │  KLABAK — a claw machine for the Chain casino SDK.  GENERATED FILE.       │
// │  Do not edit by hand: run `python3 math/generate.py` from the klabak      │
// │  folder. Every constant below is emitted from math/tables.json and the    │
// │  generator refuses to write a contract whose paytable does not sum to     │
// │  exactly {rtp_ppm} ppm ({rtp_pct}%).                                     │
// └──────────────────────────────────────────────────────────────────────────┘

import "./ICasinoGameV2.sol";

contract KlabakGame {{
  // ---- paytable constants (generated) --------------------------------------
  uint8 internal constant CABINET_COUNT = {cabinet_count};
  uint8 internal constant TIER_COUNT = {tier_count};
  uint8 internal constant TIER_TOP = {tier_top};
  uint8 internal constant NO_TIER = 255;

  /// Weight of each tier per cabinet, in ppm. Each row sums to PROB_SCALE.
  uint32 internal constant PROB_SCALE = 1_000_000;
  /// Multiplier in centi-units: 160 = 1.60x, 9600 = 96.00x. Tier 0 is the slip.
  uint16 internal constant MULT_SCALE = 100;
  /// Declared theoretical RTP, ppm of the wager. Verified by `declaredRtpPpm`.
  uint256 internal constant DECLARED_RTP_PPM = {rtp_ppm};

  uint256 internal constant WAD = 1e18;

  error KlabakGame__InvalidCabinet(uint8 cabinet);
  error KlabakGame__InvalidGameData();
  error KlabakGame__NoPlayerAction();
  error KlabakGame__InvalidState();

  // ---- generated tables ----------------------------------------------------
{weight_fn}
{mult_fn}

  // ---- declared math, readable on-chain (the judges' check) ----------------
  /// @notice RTP of a cabinet in ppm, recomputed from the same two tables the
  ///         contract settles with. Must equal DECLARED_RTP_PPM.
  function declaredRtpPpm(uint8 cabinet) public pure returns (uint256 rtpPpm) {{
    _requireCabinet(cabinet);
    uint32[TIER_COUNT] memory w = _weights(cabinet);
    uint16[TIER_COUNT] memory m = _multipliers(cabinet);
    uint256 numerator;
    for (uint8 i = 0; i < TIER_COUNT; i++) {{
      numerator += uint256(w[i]) * uint256(m[i]);
    }}
    // (sum w*m) / (PROB_SCALE * MULT_SCALE) -> fraction of wager, then to ppm
    return (numerator * 1_000_000) / (uint256(PROB_SCALE) * uint256(MULT_SCALE));
  }}

  /// @notice Weight and multiplier tables, so a reviewer can rebuild the RTP
  ///         without reading storage or bytecode.
  function paytable(uint8 cabinet)
    external
    pure
    returns (uint32[TIER_COUNT] memory weightsPpm, uint16[TIER_COUNT] memory multipliersCenti)
  {{
    _requireCabinet(cabinet);
    return (_weights(cabinet), _multipliers(cabinet));
  }}

  // ---- ICasinoGameV2 ------------------------------------------------------
  function quoteCaps(uint256 wager, bytes calldata gameData)
    external
    pure
    returns (uint256 maxEscrowStake, uint256 maxReservedProfit)
  {{
    uint8 cabinet = _decodeCabinet(gameData);
    // The whole wager stays escrowed; the house only risks the top prize.
    maxEscrowStake = wager;
    maxReservedProfit = _reservedProfit(wager, cabinet);
  }}

  function quoteRiskParams(uint256 wager, bytes calldata gameData)
    external
    pure
    returns (uint256 maxPayout, uint256 probabilityWad, uint256 expectedPayout, uint256 bodyVarianceScaled)
  {{
    uint8 cabinet = _decodeCabinet(gameData);
    uint32[TIER_COUNT] memory w = _weights(cabinet);

    maxPayout = _payout(wager, cabinet, TIER_TOP);
    // Top-tier probability, the number the facet prices the heavy tail with.
    probabilityWad = (uint256(w[TIER_TOP]) * WAD) / PROB_SCALE;

    // Expected payout, rounded up: never understate what the vault must hold.
    uint256 expected;
    for (uint8 i = 0; i < TIER_COUNT; i++) {{
      uint256 p = _payout(wager, cabinet, i);
      expected += _ceilDiv(uint256(w[i]) * p, PROB_SCALE);
    }}
    expectedPayout = expected;

    // Body variance: variance of the round's payout with the top tier removed,
    // in wei^2 * 1e18. Second moment around the stake (i.e. profit), which is
    // never smaller than the centred variance, so the reserve is never
    // understated. Cabinets here are single-tier-heavy but not heavy-tail
    // (top multiplier <= 100x), so this is quoted for completeness and safety.
    uint256 variance;
    for (uint8 i = 0; i < TIER_COUNT; i++) {{
      if (i == TIER_TOP) continue;
      uint256 p = _payout(wager, cabinet, i);
      uint256 diff = p > wager ? p - wager : wager - p;
      // mulDiv keeps the 512-bit intermediate exact.
      variance += _mulDiv(uint256(w[i]) * diff, diff, PROB_SCALE) * WAD;
    }}
    bodyVarianceScaled = variance;
  }}

  function onSessionStart(SessionContext calldata ctx)
    external
    pure
    returns (StepResult memory stepResult)
  {{
    uint8 cabinet = _decodeCabinet(ctx.gameData);
    // Commit the whole top-prize budget now; settlement releases it.
    stepResult.newGameState = abi.encode(cabinet, NO_TIER, uint32(0), bytes32(0));
    stepResult.escrowDelta = 0;
    stepResult.reservedProfitDelta = int256(_reservedProfit(ctx.wagerBase, cabinet));
    stepResult.nextPhase = SessionPhase.WAITING_RANDOMNESS;
    stepResult.requestRandomnessNow = true;
    stepResult.payout = 0;
  }}

  /// @dev Klabak is an instant game: one pull, one draw, one settlement.
  function onPlayerAction(SessionContext calldata, bytes calldata)
    external
    pure
    returns (StepResult memory)
  {{
    revert KlabakGame__NoPlayerAction();
  }}

  function onRandomness(SessionContext calldata ctx, bytes32 randomness)
    external
    pure
    returns (StepResult memory stepResult)
  {{
    (uint8 cabinet, uint8 tier, , ) = _decodeState(ctx.gameState);
    if (tier != NO_TIER) revert KlabakGame__InvalidState();

    (uint8 drawnTier, uint32 draw) = _draw(cabinet, randomness);
    uint256 payout = _payout(ctx.wagerBase, cabinet, drawnTier);

    stepResult.newGameState = abi.encode(cabinet, drawnTier, draw, randomness);
    // Settling step: deltas stay 0 so the payout cap is not lowered before the
    // finalize release (see CONTRACT_CONSTRAINTS.md, "Don't release reserved
    // profit on the settling step").
    stepResult.escrowDelta = 0;
    stepResult.reservedProfitDelta = 0;
    stepResult.nextPhase = SessionPhase.SETTLED;
    stepResult.requestRandomnessNow = false;
    stepResult.payout = payout;
  }}

  /// @dev No mid-round cash-out exists, so the honest quote is zero.
  function quoteForfeitPayout(SessionContext calldata) external pure returns (uint256) {{
    return 0;
  }}

  // ---- the single payout path (quoteCaps, quoteRiskParams, settlement) -----
  /// @dev Floor division, and the *only* place a payout is computed, so the
  ///      reserved budget and the settled payout agree to the wei.
  function _payout(uint256 wager, uint8 cabinet, uint8 tier) internal pure returns (uint256) {{
    if (tier >= TIER_COUNT) revert KlabakGame__InvalidState();
    uint16[TIER_COUNT] memory m = _multipliers(cabinet);
    return (wager * uint256(m[tier])) / MULT_SCALE;
  }}

  function _reservedProfit(uint256 wager, uint8 cabinet) internal pure returns (uint256) {{
    uint256 top = _payout(wager, cabinet, TIER_TOP);
    return top > wager ? top - wager : 0;
  }}

  // ---- randomness: rejection sampling, never a bare modulo ----------------
  /// @dev ceil(2^32 / PROB_SCALE) * PROB_SCALE: the largest multiple of the
  ///      weight denominator below 2^32. Candidates at or above it are thrown
  ///      away, so every value in [0, PROB_SCALE) is exactly equally likely.
  uint32 internal constant DRAW_LIMIT = {draw_limit};
  uint8 internal constant DRAW_ATTEMPTS = 8;

  function _draw(uint8 cabinet, bytes32 randomness) internal pure returns (uint8 tier, uint32 draw) {{
    uint32[TIER_COUNT] memory w = _weights(cabinet);
    uint256 word = uint256(randomness);

    for (uint8 i = 0; i < DRAW_ATTEMPTS; i++) {{
      uint32 candidate = uint32(word >> (uint256(i) * 32));
      if (candidate >= DRAW_LIMIT) continue;        // reject bias, redraw
      uint32 r = candidate % uint32(PROB_SCALE);
      uint32 acc = 0;
      for (uint8 t = 0; t < TIER_COUNT; t++) {{
        acc += w[t];
        if (r < acc) return (t, r);
      }}
      return (TIER_TOP, r);                          // unreachable: weights sum to PROB_SCALE
    }}

    // Every candidate rejected: probability 2.5e-4^8, i.e. never in practice.
    // Kept deterministic and documented rather than reverting a settled round.
    uint32 lastResort = uint32(uint256(keccak256(abi.encodePacked(randomness))) % PROB_SCALE);
    uint32 acc2 = 0;
    for (uint8 t = 0; t < TIER_COUNT; t++) {{
      acc2 += w[t];
      if (lastResort < acc2) return (t, lastResort);
    }}
    return (TIER_TOP, lastResort);
  }}

  // ---- encoding ----------------------------------------------------------
  function _decodeCabinet(bytes calldata gameData) internal pure returns (uint8 cabinet) {{
    if (gameData.length != 32) revert KlabakGame__InvalidGameData();
    cabinet = abi.decode(gameData, (uint8));
    _requireCabinet(cabinet);
  }}

  function _decodeState(bytes calldata gameState)
    internal
    pure
    returns (uint8 cabinet, uint8 tier, uint32 draw, bytes32 randomness)
  {{
    (cabinet, tier, draw, randomness) = abi.decode(gameState, (uint8, uint8, uint32, bytes32));
    _requireCabinet(cabinet);
  }}

  function _requireCabinet(uint8 cabinet) internal pure {{
    if (cabinet >= CABINET_COUNT) revert KlabakGame__InvalidCabinet(cabinet);
  }}

  // ---- helpers -----------------------------------------------------------
  function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {{
    return a == 0 ? 0 : (a - 1) / b + 1;
  }}

  /// @dev Full-precision floor(a*b/c) with a 512-bit intermediate (OpenZeppelin
  ///      Math.mulDiv, inlined so the file stays dependency-free).
  function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {{
    unchecked {{
      uint256 prod0;
      uint256 prod1;
      assembly {{
        let mm := mulmod(a, b, not(0))
        prod0 := mul(a, b)
        prod1 := sub(sub(mm, prod0), lt(mm, prod0))
      }}
      if (prod1 == 0) {{
        return prod0 / denominator;
      }}
      require(denominator > prod1, "mulDiv overflow");
      uint256 remainder;
      assembly {{
        remainder := mulmod(a, b, denominator)
      }}
      assembly {{
        prod1 := sub(prod1, gt(remainder, prod0))
        prod0 := sub(prod0, remainder)
      }}
      uint256 twos = denominator & (~denominator + 1);
      assembly {{
        denominator := div(denominator, twos)
        prod0 := div(prod0, twos)
        twos := add(div(sub(0, twos), twos), 1)
      }}
      prod0 |= prod1 * twos;
      uint256 inverse = (3 * denominator) ^ 2;
      inverse *= 2 - denominator * inverse;
      inverse *= 2 - denominator * inverse;
      inverse *= 2 - denominator * inverse;
      inverse *= 2 - denominator * inverse;
      inverse *= 2 - denominator * inverse;
      inverse *= 2 - denominator * inverse;
      result = prod0 * inverse;
      return result;
    }}
  }}
}}
'''

TS_TEMPLATE = '''// GENERATED by math/generate.py — do not edit.
// Mirror of the on-chain paytable. The contract stays authoritative; this file
// exists so the UI can price a pull before a transaction is signed.

export type Tier = {
  tier: number;
  prize: string;
  weight: number;        // ppm, row sums to PROB_SCALE
  multiplier: number;    // centi-units, 100 = 1.00x
  charm: string | null;
};

export type Cabinet = {
  id: number;
  key: string;
  name: string;
  blurb: string;
  volatility: 'low' | 'medium' | 'high';
  tiers: Tier[];
};

export const PROB_SCALE = 1_000_000;
export const MULT_SCALE = 100;
export const DECLARED_RTP_PPM = %%RTP_PPM%%;
export const TIER_TOP = %%TIER_TOP%%;
export const CABINETS: Cabinet[] = %%CABINETS%%;

/** RTP of a cabinet recomputed from the emitted table, in ppm. */
export function rtpPpm(cabinet: Cabinet): number {
  const numerator = cabinet.tiers.reduce((acc, t) => acc + t.weight * t.multiplier, 0);
  return (numerator * 1_000_000) / (PROB_SCALE * MULT_SCALE);
}

/** Probability (0..1) of a tier in a cabinet. */
export function tierProbability(cabinet: Cabinet, tier: number): number {
  return cabinet.tiers[tier].weight / PROB_SCALE;
}

/** Payout in base units for a wager and tier — floor, exactly like `_payout`. */
export function payoutFor(wager: bigint, cabinet: Cabinet, tier: number): bigint {
  return (wager * BigInt(cabinet.tiers[tier].multiplier)) / BigInt(MULT_SCALE);
}

/** Worst-case payout, used to clamp the bet input against host risk limits. */
export function maxMultiplierX(cabinet: Cabinet): number {
  return cabinet.tiers[TIER_TOP].multiplier / MULT_SCALE;
}

/**
 * Client-side mirror of `_draw`: rejection sampling over [0, PROB_SCALE) from a
 * 32-byte randomness word, then cumulative weights. Used for the standalone
 * demo only — inside the host the outcome comes from the chain.
 */
export function drawFromRandomness(cabinet: Cabinet, randomness: bigint): { tier: number; draw: number } {
  const limit = Math.floor(2 ** 32 / PROB_SCALE) * PROB_SCALE;
  for (let i = 0; i < 8; i++) {
    const candidate = Number((randomness >> BigInt(i * 32)) & 0xffffffffn);
    if (candidate >= limit) continue;
    const r = candidate % PROB_SCALE;
    let acc = 0;
    for (let t = 0; t < cabinet.tiers.length; t++) {
      acc += cabinet.tiers[t].weight;
      if (r < acc) return { tier: t, draw: r };
    }
  }
  const fallback = Number((randomness ^ (randomness >> 64n)) % BigInt(PROB_SCALE));
  let acc = 0;
  for (let t = 0; t < cabinet.tiers.length; t++) {
    acc += cabinet.tiers[t].weight;
    if (fallback < acc) return { tier: t, draw: Math.abs(fallback) };
  }
  return { tier: TIER_TOP, draw: 0 };
}

// SessionPhase enum from ICasinoGameV2.sol
export const PHASE_SETTLED = 3;
export const PHASE_FORFEITED = 4;
export const PHASE_CANCELLED = 5;
export const PHASE_WAITING_RANDOMNESS = 1;

export function isTerminalPhase(phase: number | undefined): boolean {
  return phase === PHASE_SETTLED || phase === PHASE_FORFEITED || phase === PHASE_CANCELLED;
}
'''


def emit_solidity(table: dict) -> str:
    cabs = table["cabinets"]
    tier_count = len(cabs[0]["tiers"])
    for cab in cabs:
        if len(cab["tiers"]) != tier_count:
            raise SystemExit(f"[FAIL] cabinet {cab['key']} has {len(cab['tiers'])} tiers, expected {tier_count}")

    w_rows, m_rows = [], []
    for cab in cabs:
        w = ", ".join(f"uint32({t['weight']})" for t in cab["tiers"])
        m = ", ".join(f"uint16({t['multiplier']})" for t in cab["tiers"])
        w_rows.append(f"    if (cabinet == {cab['id']}) return [{w}];")
        m_rows.append(f"    if (cabinet == {cab['id']}) return [{m}];")
    w_rows.append(f"    revert KlabakGame__InvalidCabinet(cabinet);")
    m_rows.append(f"    revert KlabakGame__InvalidCabinet(cabinet);")

    weight_fn = (
        "  /// @notice Tier weights (ppm) for a cabinet.\n"
        "  function _weights(uint8 cabinet) internal pure returns (uint32[TIER_COUNT] memory) {\n"
        + "\n".join(w_rows) + "\n  }"
    )
    mult_fn = (
        "  /// @notice Tier multipliers (centi-units) for a cabinet.\n"
        "  function _multipliers(uint8 cabinet) internal pure returns (uint16[TIER_COUNT] memory) {\n"
        + "\n".join(m_rows) + "\n  }"
    )

    rtp_ppm = table["declaredRtpPpm"]
    draw_limit = (2 ** 32 // table["probabilityScale"]) * table["probabilityScale"]
    return SOLIDITY_TEMPLATE.format(
        rtp_ppm=rtp_ppm,
        rtp_pct=f"{rtp_ppm / 10_000:.2f}",
        cabinet_count=len(cabs),
        tier_count=tier_count,
        tier_top=tier_count - 1,
        weight_fn=weight_fn,
        mult_fn=mult_fn,
        draw_limit=draw_limit,
    )


def emit_ts(table: dict) -> str:
    cabs = [{
        "id": c["id"], "key": c["key"], "name": c["name"], "blurb": c["blurb"],
        "volatility": c["volatility"],
        "tiers": [{"tier": t["tier"], "prize": t["prize"], "weight": t["weight"],
                   "multiplier": t["multiplier"], "charm": t["charm"]} for t in c["tiers"]],
    } for c in table["cabinets"]]
    return (TS_TEMPLATE
            .replace("%%RTP_PPM%%", str(table["declaredRtpPpm"]))
            .replace("%%TIER_TOP%%", str(len(table["cabinets"][0]["tiers"]) - 1))
            .replace("%%CABINETS%%", json.dumps(cabs, indent=2)))


def emit_proof(table: dict, results: list[dict]) -> str:
    lines = [
        "# RTP proof — Klabak",
        "",
        "Generated by `math/generate.py` from `math/tables.json`. Nothing in this file is typed by hand:",
        "it is the arithmetic the contract settles with, printed back out.",
        "",
        f"**Declared theoretical RTP: {table['declaredRtpPpm'] / 10_000:.2f}%** (within the jam's 93–98% window).",
        "",
        "Weights are in ppm and must sum to exactly 1,000,000. Multipliers are in centi-units (160 = 1.60×).",
        "Tier 0 is the slip — the claw opens and the prize falls back.",
        "",
    ]
    for res in results:
        cab = res["cabinet"]
        lines += [
            f"## {cab['name']} (`{cab['key']}`, cabinet id {cab['id']}) — {cab['volatility']} volatility",
            "",
            f"*{cab['blurb']}*",
            "",
            "| tier | prize | weight (ppm) | p | ×mult | multiplier | p × mult |",
            "| ---: | --- | ---: | ---: | ---: | ---: | ---: |",
        ]
        for t, prize, w, p, m_centi, m, contrib in rtp_rows(cab):
            lines.append(f"| {t} | {prize} | {w:,} | {p} | {m_centi} | {m} | {contrib} |")
        total = sum(float(r[6]) for r in rtp_rows(cab))
        lines += [
            "",
            f"* **Weights sum:** {res['total_weight']:,} = 1,000,000 ✓",
            f"* **RTP:** Σ p·mult = **{total:.5f} = {total * 100:.2f}%** ✓",
            f"* **Top prize:** {res['top']['prize']} at ×{res['top']['multiplier'] / 100:.2f}, "
            f"p = {res['top']['weight'] / 1_000_000:.5f} — below the ×100 heavy-tail threshold, "
            "and quoted with a non-zero body variance regardless.",
            "",
        ]
    lines += [
        "## What the contract enforces",
        "",
        "`KlabakGame.declaredRtpPpm(cabinet)` recomputes the table above **on-chain** from the same two",
        "arrays the settlement path uses, so the declaration cannot drift from the paytable:",
        "",
        "```solidity",
        "numerator = Σ w[i] * m[i]",
        "rtpPpm    = numerator * 1e6 / (PROB_SCALE * MULT_SCALE)   // == DECLARED_RTP_PPM",
        "```",
        "",
        "A payout is computed in exactly one function (`_payout`), which `quoteCaps`, `quoteRiskParams`,"
        " `onSessionStart` and `onRandomness` all call — so the reserved budget and the settled payout",
        "agree to the wei, and a top-tier win cannot revert with `InvalidPayout`.",
        "",
        "## Randomness",
        "",
        "The tier is drawn from the VRF word with **rejection sampling** over `[0, 1_000_000)` —",
        f"candidates at or above `{ (2 ** 32 // 1_000_000) * 1_000_000:,}` are discarded, so the modulo never",
        "biases a tier. Eight independent 4-byte candidates are available in one `bytes32`; the chance that",
        "all eight are rejected is `(967296 / 2^32)^8 ≈ 1e-29`.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    table = json.loads((ROOT / "math" / "tables.json").read_text())
    results = verify(table)
    print(f"[ok] {len(results)} cabinets verified at exactly "
          f"{table['declaredRtpPpm'] / 10_000:.2f}% RTP")
    for res in results:
        print(f"     {res['cabinet']['name']:14} top x{res['top']['multiplier'] / 100:>6.2f} "
              f"p={res['top']['weight'] / 1_000_000:.5f}")

    if args.check:
        return 0

    CONTRACT_OUT.parent.mkdir(parents=True, exist_ok=True)
    TS_OUT.parent.mkdir(parents=True, exist_ok=True)
    CONTRACT_OUT.write_text(emit_solidity(table))
    TS_OUT.write_text(emit_ts(table))
    PROOF_OUT.write_text(emit_proof(table, results))
    for p in (CONTRACT_OUT, TS_OUT, PROOF_OUT):
        print(f"[write] {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
