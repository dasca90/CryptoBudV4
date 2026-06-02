# V3 TP1 Behavior Reference

This note documents V3 behavior for V4 parity checks. V3 is a behavior reference only; V4 must keep its own scanner, execution, TP2, SL, and snapshot flow.

## V3 Inputs

V3 resolves TP targets from `src/lib/tp-targeting.ts` using:
- coin group from base asset and 24h quote volume
- confidence score and estimated win chance
- market condition
- trade quality
- short-term momentum: 1h, 15m, 5m
- relative volume and volume surge
- spread
- extension above reference, breakout chase, candle ATR multiple, near-local-high

## V3 Hybrid Mode

V3 group defaults are stored in `DEFAULT_HYBRID_TP_GROUP_RULES`:
- `top_majors`: TP1 `3.0%`, TP2 `5.0%`
- `large_caps`: TP1 `3.5%`, TP2 `6.0%`
- `mid_caps`: TP1 `4.5%`, TP2 `7.5%`
- `high_risk_alts`: TP1 `5.0%`, TP2 `0%`

Values are normalized to a safe `0.1%` to `20%` range.

## V3 Smart Mode

V3 smart mode starts from base TP1 `3%` and TP2 `6%`.
It scores setup strength from momentum, volume, confidence, market condition, trade quality, spread, extension, breakout chase, candle exhaustion, local-high risk, daily extension, and data availability.

Strength adjusts TP1:
- strong: `3.6%`
- medium: `3.0%`
- weak: `2.34%`

V3 may disable TP2 for weak, stretched, poor-quality, or wide-spread setups.

## V4 Parity Rule

V4 does not copy V3 formulas. V4 preserves the behavior contract:
- AutoBots TP1 is dynamic per coin and positive.
- TP1 range is risk-group/confidence based.
- TP1 target is `entryPrice * (1 + tp1Pct / 100)`.
- AutoBots TP2 is always `0`.
- SL is user-defined.
- Dynamic trailing starts at TP1.
- Open Positions, Closed Positions, Journal, and Telegram read TP1 from the canonical entry snapshot.
- Missing risk snapshot is legacy-only; a new missing snapshot is `BUG_MISSING_SNAPSHOT_NEW_POSITION`.

