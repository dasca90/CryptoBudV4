# CryptoBud V5 AI Takeover API

## Goal

V5 AI Takeover makes AI the professional trading decision brain while CryptoBud remains the data engine, safety governor, execution planner, trading engine, exchange adapter owner, and position manager.

Core invariant:

```text
AI decision -> schema validation -> retrospective validation -> safety guards
-> hard risk guard -> ExecutionPlanner -> TradingEngine -> current exchange adapter
-> PositionManager
```

AI never routes directly to Binance and never chooses paper/demo/live execution.

## Mode

`AI_TAKEOVER_MODE` has only two states:

| Mode | Provider calls | AI decision owner | BUY_INTENT |
| --- | --- | --- | --- |
| `OFF` | no | no | no |
| `ON` | yes, if provider configured | yes | yes, after validation and guards |

Default is `OFF`.

The existing app execution adapter remains read-only from AI. The adapter decides whether a submitted BUY intent is paper/demo or live.

## Config

```text
AI_TAKEOVER_MODE=OFF
AI_PROVIDER=OFF
AI_MODEL=
AI_TIMEOUT_MS=12000
AI_MAX_CANDIDATES_PER_SCAN=3
AI_MAX_RESULTS_PER_MISSION=3
AI_MIN_CLEAN_UPSIDE_PCT=3
AI_MIN_CONFIDENCE=0.70
AI_MIN_TP1_PCT=1.2
AI_MAX_TP1_PCT=5.0
```

Frontend V5 settings are isolated in `cryptobud_v5_ai_*` keys. API keys are not persisted in frontend state.

## Providers

Provider interface: `src/core/ai/providers/AiProvider.ts`

Implemented providers:

- `OpenCodeProvider`
- `OpenAiProvider`
- `DeepSeekProvider`
- `OllamaProvider`

Provider failure, invalid JSON, timeout, or missing configuration returns a blocked decision instead of crashing the app.

## Safety

Deterministic guard modules:

- `AiAntiFomoGuard`
- `AiManipulationGuard`
- `AiAntiRugpullGuard`
- `AiNewListingGuard`
- `AiTakeoverRiskGuard`

Hard blockers include stale price, stale book, wide spread, missing SL/TP1, duplicate open position, max positions, daily loss, cooldown, min notional, missing retrospective analysis, FOMO risk, manipulation risk, and new-listing risk.

## Decision Schema

AI must return strict JSON with `decision` in `BUY | WAIT | AVOID | BLOCK`, confidence from `0..1`, market read, retrospective summary, TP plan, risk plan, execution intent, and reason.

Rules enforced by CryptoBud:

- Invalid JSON blocks with `AI_SCHEMA_INVALID`.
- Missing retrospective summary blocks.
- Confidence below threshold blocks.
- TP1 outside configured bounds blocks.
- TP2 is forced to `0` with `AI_TP2_FORCED_ZERO_AUDIT`.
- BUY can only create `BUY_INTENT`; execution remains in the existing pipeline.

## Command Center

Natural-language commands are parsed by `AiMissionParser` into structured missions. Free text is never executable. Mission defaults are conservative: max 3 results, minimum clean upside 3%, retrospective analysis required, anti-FOMO, anti-rugpull/manipulation, and new-listing guards enabled.

## V4 Isolation

V4 AutoBots, Unicorn Hunter, Micro Scalper, TP1/TP2/SL behavior, PositionManager, storage keys, and current tests remain unchanged when AI Takeover is OFF.
