// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ┌──────────────────────────────────────────────────────────────────────────┐
// │  KLABAK — a claw machine for the Chain casino SDK.  GENERATED FILE.       │
// │  Do not edit by hand: run `python3 math/generate.py` from the klabak      │
// │  folder. Every constant below is emitted from math/tables.json and the    │
// │  generator refuses to write a contract whose paytable does not sum to     │
// │  exactly 960000 ppm (96.00%).                                     │
// └──────────────────────────────────────────────────────────────────────────┘

import "./ICasinoGameV2.sol";

contract KlabakGame {
  // ---- paytable constants (generated) --------------------------------------
  uint8 internal constant CABINET_COUNT = 3;
  uint8 internal constant TIER_COUNT = 4;
  uint8 internal constant TIER_TOP = 3;
  uint8 internal constant NO_TIER = 255;

  /// Weight of each tier per cabinet, in ppm. Each row sums to PROB_SCALE.
  uint32 internal constant PROB_SCALE = 1_000_000;
  /// Multiplier in centi-units: 160 = 1.60x, 9600 = 96.00x. Tier 0 is the slip.
  uint16 internal constant MULT_SCALE = 100;
  /// Declared theoretical RTP, ppm of the wager. Verified by `declaredRtpPpm`.
  uint256 internal constant DECLARED_RTP_PPM = 960000;

  uint256 internal constant WAD = 1e18;

  error KlabakGame__InvalidCabinet(uint8 cabinet);
  error KlabakGame__InvalidGameData();
  error KlabakGame__NoPlayerAction();
  error KlabakGame__InvalidState();

  // ---- generated tables ----------------------------------------------------
  /// @notice Tier weights (ppm) for a cabinet.
  function _weights(uint8 cabinet) internal pure returns (uint32[TIER_COUNT] memory) {
    if (cabinet == 0) return [uint32(500000), uint32(360000), uint32(110000), uint32(30000)];
    if (cabinet == 1) return [uint32(780000), uint32(150000), uint32(55000), uint32(15000)];
    if (cabinet == 2) return [uint32(735000), uint32(240000), uint32(20000), uint32(5000)];
    revert KlabakGame__InvalidCabinet(cabinet);
  }
  /// @notice Tier multipliers (centi-units) for a cabinet.
  function _multipliers(uint8 cabinet) internal pure returns (uint16[TIER_COUNT] memory) {
    if (cabinet == 0) return [uint16(0), uint16(160), uint16(240), uint16(400)];
    if (cabinet == 1) return [uint16(0), uint16(200), uint16(600), uint16(2200)];
    if (cabinet == 2) return [uint16(0), uint16(150), uint16(600), uint16(9600)];
    revert KlabakGame__InvalidCabinet(cabinet);
  }

  // ---- declared math, readable on-chain (the judges' check) ----------------
  /// @notice RTP of a cabinet in ppm, recomputed from the same two tables the
  ///         contract settles with. Must equal DECLARED_RTP_PPM.
  function declaredRtpPpm(uint8 cabinet) public pure returns (uint256 rtpPpm) {
    _requireCabinet(cabinet);
    uint32[TIER_COUNT] memory w = _weights(cabinet);
    uint16[TIER_COUNT] memory m = _multipliers(cabinet);
    uint256 numerator;
    for (uint8 i = 0; i < TIER_COUNT; i++) {
      numerator += uint256(w[i]) * uint256(m[i]);
    }
    // (sum w*m) / (PROB_SCALE * MULT_SCALE) -> fraction of wager, then to ppm
    return (numerator * 1_000_000) / (uint256(PROB_SCALE) * uint256(MULT_SCALE));
  }

  /// @notice Weight and multiplier tables, so a reviewer can rebuild the RTP
  ///         without reading storage or bytecode.
  function paytable(uint8 cabinet)
    external
    pure
    returns (uint32[TIER_COUNT] memory weightsPpm, uint16[TIER_COUNT] memory multipliersCenti)
  {
    _requireCabinet(cabinet);
    return (_weights(cabinet), _multipliers(cabinet));
  }

  // ---- ICasinoGameV2 ------------------------------------------------------
  function quoteCaps(uint256 wager, bytes calldata gameData)
    external
    pure
    returns (uint256 maxEscrowStake, uint256 maxReservedProfit)
  {
    uint8 cabinet = _decodeCabinet(gameData);
    // The whole wager stays escrowed; the house only risks the top prize.
    maxEscrowStake = wager;
    maxReservedProfit = _reservedProfit(wager, cabinet);
  }

  function quoteRiskParams(uint256 wager, bytes calldata gameData)
    external
    pure
    returns (uint256 maxPayout, uint256 probabilityWad, uint256 expectedPayout, uint256 bodyVarianceScaled)
  {
    uint8 cabinet = _decodeCabinet(gameData);
    uint32[TIER_COUNT] memory w = _weights(cabinet);

    maxPayout = _payout(wager, cabinet, TIER_TOP);
    // Top-tier probability, the number the facet prices the heavy tail with.
    probabilityWad = (uint256(w[TIER_TOP]) * WAD) / PROB_SCALE;

    // Expected payout, rounded up: never understate what the vault must hold.
    uint256 expected;
    for (uint8 i = 0; i < TIER_COUNT; i++) {
      uint256 p = _payout(wager, cabinet, i);
      expected += _ceilDiv(uint256(w[i]) * p, PROB_SCALE);
    }
    expectedPayout = expected;

    // Body variance: variance of the round's payout with the top tier removed,
    // in wei^2 * 1e18. Second moment around the stake (i.e. profit), which is
    // never smaller than the centred variance, so the reserve is never
    // understated. Cabinets here are single-tier-heavy but not heavy-tail
    // (top multiplier <= 100x), so this is quoted for completeness and safety.
    uint256 variance;
    for (uint8 i = 0; i < TIER_COUNT; i++) {
      if (i == TIER_TOP) continue;
      uint256 p = _payout(wager, cabinet, i);
      uint256 diff = p > wager ? p - wager : wager - p;
      // mulDiv keeps the 512-bit intermediate exact.
      variance += _mulDiv(uint256(w[i]) * diff, diff, PROB_SCALE) * WAD;
    }
    bodyVarianceScaled = variance;
  }

  function onSessionStart(SessionContext calldata ctx)
    external
    pure
    returns (StepResult memory stepResult)
  {
    uint8 cabinet = _decodeCabinet(ctx.gameData);
    // Commit the whole top-prize budget now; settlement releases it.
    stepResult.newGameState = abi.encode(cabinet, NO_TIER, uint32(0), bytes32(0));
    stepResult.escrowDelta = 0;
    stepResult.reservedProfitDelta = int256(_reservedProfit(ctx.wagerBase, cabinet));
    stepResult.nextPhase = SessionPhase.WAITING_RANDOMNESS;
    stepResult.requestRandomnessNow = true;
    stepResult.payout = 0;
  }

  /// @dev Klabak is an instant game: one pull, one draw, one settlement.
  function onPlayerAction(SessionContext calldata, bytes calldata)
    external
    pure
    returns (StepResult memory)
  {
    revert KlabakGame__NoPlayerAction();
  }

  function onRandomness(SessionContext calldata ctx, bytes32 randomness)
    external
    pure
    returns (StepResult memory stepResult)
  {
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
  }

  /// @dev No mid-round cash-out exists, so the honest quote is zero.
  function quoteForfeitPayout(SessionContext calldata) external pure returns (uint256) {
    return 0;
  }

  // ---- the single payout path (quoteCaps, quoteRiskParams, settlement) -----
  /// @dev Floor division, and the *only* place a payout is computed, so the
  ///      reserved budget and the settled payout agree to the wei.
  function _payout(uint256 wager, uint8 cabinet, uint8 tier) internal pure returns (uint256) {
    if (tier >= TIER_COUNT) revert KlabakGame__InvalidState();
    uint16[TIER_COUNT] memory m = _multipliers(cabinet);
    return (wager * uint256(m[tier])) / MULT_SCALE;
  }

  function _reservedProfit(uint256 wager, uint8 cabinet) internal pure returns (uint256) {
    uint256 top = _payout(wager, cabinet, TIER_TOP);
    return top > wager ? top - wager : 0;
  }

  // ---- randomness: rejection sampling, never a bare modulo ----------------
  /// @dev ceil(2^32 / PROB_SCALE) * PROB_SCALE: the largest multiple of the
  ///      weight denominator below 2^32. Candidates at or above it are thrown
  ///      away, so every value in [0, PROB_SCALE) is exactly equally likely.
  uint32 internal constant DRAW_LIMIT = 4294000000;
  uint8 internal constant DRAW_ATTEMPTS = 8;

  function _draw(uint8 cabinet, bytes32 randomness) internal pure returns (uint8 tier, uint32 draw) {
    uint32[TIER_COUNT] memory w = _weights(cabinet);
    uint256 word = uint256(randomness);

    for (uint8 i = 0; i < DRAW_ATTEMPTS; i++) {
      uint32 candidate = uint32(word >> (uint256(i) * 32));
      if (candidate >= DRAW_LIMIT) continue;        // reject bias, redraw
      uint32 r = candidate % uint32(PROB_SCALE);
      uint32 acc = 0;
      for (uint8 t = 0; t < TIER_COUNT; t++) {
        acc += w[t];
        if (r < acc) return (t, r);
      }
      return (TIER_TOP, r);                          // unreachable: weights sum to PROB_SCALE
    }

    // Every candidate rejected: probability 2.5e-4^8, i.e. never in practice.
    // Kept deterministic and documented rather than reverting a settled round.
    uint32 lastResort = uint32(uint256(keccak256(abi.encodePacked(randomness))) % PROB_SCALE);
    uint32 acc2 = 0;
    for (uint8 t = 0; t < TIER_COUNT; t++) {
      acc2 += w[t];
      if (lastResort < acc2) return (t, lastResort);
    }
    return (TIER_TOP, lastResort);
  }

  // ---- encoding ----------------------------------------------------------
  function _decodeCabinet(bytes calldata gameData) internal pure returns (uint8 cabinet) {
    if (gameData.length != 32) revert KlabakGame__InvalidGameData();
    cabinet = abi.decode(gameData, (uint8));
    _requireCabinet(cabinet);
  }

  function _decodeState(bytes calldata gameState)
    internal
    pure
    returns (uint8 cabinet, uint8 tier, uint32 draw, bytes32 randomness)
  {
    (cabinet, tier, draw, randomness) = abi.decode(gameState, (uint8, uint8, uint32, bytes32));
    _requireCabinet(cabinet);
  }

  function _requireCabinet(uint8 cabinet) internal pure {
    if (cabinet >= CABINET_COUNT) revert KlabakGame__InvalidCabinet(cabinet);
  }

  // ---- helpers -----------------------------------------------------------
  function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
    return a == 0 ? 0 : (a - 1) / b + 1;
  }

  /// @dev Full-precision floor(a*b/c) with a 512-bit intermediate (OpenZeppelin
  ///      Math.mulDiv, inlined so the file stays dependency-free).
  function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
    unchecked {
      uint256 prod0;
      uint256 prod1;
      assembly {
        let mm := mulmod(a, b, not(0))
        prod0 := mul(a, b)
        prod1 := sub(sub(mm, prod0), lt(mm, prod0))
      }
      if (prod1 == 0) {
        return prod0 / denominator;
      }
      require(denominator > prod1, "mulDiv overflow");
      uint256 remainder;
      assembly {
        remainder := mulmod(a, b, denominator)
      }
      assembly {
        prod1 := sub(prod1, gt(remainder, prod0))
        prod0 := sub(prod0, remainder)
      }
      uint256 twos = denominator & (~denominator + 1);
      assembly {
        denominator := div(denominator, twos)
        prod0 := div(prod0, twos)
        twos := add(div(sub(0, twos), twos), 1)
      }
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
    }
  }
}
