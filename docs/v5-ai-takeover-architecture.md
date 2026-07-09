# V5 AI Takeover Architecture

This companion note points to the implementation contract in [v5-ai-takeover-api.md](./v5-ai-takeover-api.md).

The important architectural invariant is simple:

```text
AI_TAKEOVER_MODE=OFF -> existing V4 decision logic owns trading decisions.
AI_TAKEOVER_MODE=ON  -> AI owns the decision, CryptoBud still owns execution.
```

There are no AI-specific paper, demo, live, live-locked, or adapter-selection modes. The current CryptoBud execution adapter remains the only order-routing authority.

Main modules:

- `src/core/ai/AiTakeoverTypes.ts`
- `src/core/ai/AiTakeoverTrader.ts`
- `src/core/ai/AiDecisionSchema.ts`
- `src/core/ai/AiDecisionValidator.ts`
- `src/core/ai/AiTakeoverRiskGuard.ts`
- `src/core/ai/AiTakeoverAudit.ts`
- `src/core/ai/providers/*`
- `src/core/ai/retrospective/*`
- `src/core/ai/guards/*`
- `src/core/ai/command/*`
- `src/core/ai/hunting/*`

Regression coverage lives in `src/__tests__/ai-takeover-regression.test.ts`.
