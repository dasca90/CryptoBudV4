# V5 AI Takeover — Experimental Architecture

## Overview

CryptoBud V5 AI Takeover is an experimental feature that allows an AI provider
(OpenAI or DeepSeek) to make trading decisions. It runs as an isolated layer on
top of the existing V4 trading infrastructure.

**Hard constraint:** AI Takeover is OFF by default. When OFF, V4 behavior is
completely unchanged — no provider calls, no decision paths, no execution.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   AiTakeoverTrader (Orchestrator)           │
│                                                             │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ Provider │─▶│ Schema Valid. │─▶│ Risk Guard           │  │
│  │ (OpenAI  │  │ (decision     │  │ (mode checks,        │  │
│  │ /DeepSeek│  │  must match   │  │  daily limits,       │  │
│  │ )        │  │  schema)      │  │  concurrency)        │  │
│  └──────────┘  └───────────────┘  └───────┬──────────────┘  │
│                                           ▼                  │
│  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │ Retrospective        │◀─│ Risk Guard output            │  │
│  │ Coin Analyzer        │  │ (adjusted TP2=0)             │  │
│  │ (market context      │  └──────────────────────────────┘  │
│  │  validation)         │                                     │
│  └──────────┬───────────┘                                     │
│             ▼                                                 │
│  ┌─────────────────────────────────────────────────────┐      │
│  │ Final Decision → Execution Planner → TradingEngine  │      │
│  │ (guarded by AI_TAKEOVER_MODE)                       │      │
│  └─────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Feature Flag: AI_TAKEOVER_MODE

| Mode           | Provider Calls | Decision Recorded | Paper Execution | Live Execution | BUY Intent |
|----------------|:---:|:---:|:---:|:---:|:---:|
| OFF            | NO  | NO  | NO  | NO  | NO  |
| PAPER_ONLY     | YES | YES | YES | NO  | NO  |
| LIVE_LOCKED    | YES | YES | NO  | NO  | YES |
| LIVE_ENABLED   | YES | YES | YES | YES*| YES |

\* Live execution requires ALL hard guards to pass first.

## Safety Layers (in order)

1. **Mode Gate** — If `AI_TAKEOVER_MODE === OFF`, entire subsystem is skipped.
2. **Schema Validation** — AI response must match `AiDecisionSchema` exactly.
   Invalid JSON, missing fields, out-of-range values → reject.
3. **Risk Guard** — Checks confidence threshold, daily trade limit, max
   concurrent positions, and mode-based restrictions.
4. **Retrospective Analysis** — Validates AI decision against real market
   context (spread, volume, 5m change, risk group). Can reduce confidence or
   block entirely.
5. **Hard Guards (LIVE_ENABLED only)** — Before live execution, the existing V4
   deterministic hard gates must pass (market data quality, filters, min
   notional, position limits, etc.).

## TP2 Rule

AI Takeover **always forces TP2 to 0**. The AI may propose any TP2, but the
validator clamps it to 0. This is a hard-coded safety constraint — AI Takeover
does not support TP2 exits.

## Storage Isolation

| Purpose | V5 Key | V4 Key |
|---------|--------|--------|
| Settings | `cryptobud_v5_ai_settings` | `app_settings` |
| Positions | `cryptobud_v5_ai_positions` | V4 position store |
| Journal | `cryptobud_v5_ai_journal` | V4 journal store |
| Decisions | `cryptobud_v5_ai_decisions` | N/A |
| Audit | `cryptobud_v5_ai_audit` | N/A |

No V5 storage key reuses or overlaps with V4 storage. No V4 position or journal
data is migrated or mutated.

## Module Map

| File | Purpose |
|------|---------|
| `AiTakeoverTypes.ts` | Core types, storage keys, defaults, mode helpers |
| `AiTakeoverTrader.ts` | Main orchestrator — mode gate, provider call, validation pipeline |
| `AiDecisionSchema.ts` | JSON schema definition and system prompt builder |
| `AiDecisionValidator.ts` | Validates AI JSON response against schema |
| `AiProvider.ts` | Abstract provider interface |
| `providers/OpenAiProvider.ts` | OpenAI API integration |
| `providers/DeepSeekProvider.ts` | DeepSeek API integration |
| `AiTakeoverRiskGuard.ts` | Risk checks: confidence, limits, mode enforcement |
| `retrospective/RetrospectiveCoinAnalyzer.ts` | Market context validation |
| `AiTakeoverAudit.ts` | Decision audit trail with persistence |
| `v5Config.ts` | Build-time V5 flags |

## Integration Points with V4

| V4 Component | Integration | Guard |
|-------------|-------------|-------|
| AutoBots pipeline | NOT modified | AI_TAKEOVER_MODE === OFF |
| ExecutionPlanner | NOT modified | AI_TAKEOVER_MODE === OFF |
| PositionManager | NOT modified | AI_TAKEOVER_MODE === OFF |
| TradingEngine | NOT modified | AI_TAKEOVER_MODE === OFF |
| SettingsPersistence | NOT used for V5 data | Isolated storage keys |
| Journal | NOT used for V5 data | Isolated storage keys |

## Regression Tests

| # | Test | File |
|---|------|------|
| 1 | AI Takeover OFF does not call AI provider | `ai-takeover-regression.test.ts` |
| 2 | AI Takeover OFF preserves AutoBots BUY pipeline | `ai-takeover-regression.test.ts` |
| 3 | AI Takeover OFF preserves existing TP1/TP2/SL behavior | `ai-takeover-regression.test.ts` |
| 4 | AI Takeover PAPER_ONLY can create paper BUY intent | `ai-takeover-regression.test.ts` |
| 5 | AI Takeover cannot execute live in LIVE_LOCKED | `ai-takeover-regression.test.ts` |
| 6 | V5 AI storage does not touch V4 storage keys | `ai-takeover-regression.test.ts` |
| 7 | Invalid AI response blocks execution | `ai-takeover-regression.test.ts` |
| 8 | TP2 is always forced to 0 | `ai-takeover-regression.test.ts` |
| 9 | Existing V4 test suite passes unchanged | `ai-takeover-regression.test.ts` |

## Build

- `dev:v4` / `build:v4` — standard V4 build (AI Takeover code exists but OFF by default)
- `dev:v5-ai` / `build:v5-ai` — V5 experimental build with AI Takeover UI visible
