# Trade V4 Air Scanner UI

## Integration Summary
- The Air Scanner scaffold was adapted into the main app under `src/components/trade-v4`.
- The archive scaffold folder `cryptobud-v4-ui-architecture` is not a runtime dependency.
- Runtime now uses a data adapter layer from real app objects.

## Runtime Guardrails
- UI-only integration.
- No TradingEngine/TraderBrain/EntryGate/RiskEngine/ExitEngine logic changes.
- No live trading enablement.
- No Binance private order code.
- No mock runtime candidates/trades/positions.

## UI Toggle
- Trade page includes a safe UI switch:
  - `Classic Trade UI`
  - `3D Air Scanner UI`
- Default is Classic unless user previously saved preference locally.

## Real Data Adapter
- File: `src/lib/air-scanner/tradeV4DataAdapter.ts`
- Exposes:
  - `buildTradeV4PageModel(runtimeState)`
  - `mapScannerCandidateToTradeV4View(candidate)`
  - `mapPositionToOpenPositionView(position)`
  - `mapTradeRecordToClosedPositionView(trade)`
- Adapter converts real scanner snapshot, position manager state, and journal records into view models.

## State Mapping
- Visual state files:
  - `src/lib/air-scanner/airScannerStateMachine.ts`
  - `src/lib/air-scanner/airCoinVisualMapper.ts`
- Rules include WAIT/BLOCK/AVOID/BUY mapping, lock-aware `capturing`, and real `open/closed` from runtime data.

## Performance Constraints
- CSS 3D implementation (no WebGL/Three.js).
- Max 24 visual coins in scanner viewport.
- Full candidate list remains in table.
- RAF loop pauses on hidden document, reduced motion, and unmount cleanup.
- No per-frame logs.

## Interaction Safety
- Candidate click selects symbol only.
- Add to Watchlist does not buy.
- Manual Buy uses existing protected manual flow callback from Trade page.

## Adapted vs Not Copied
- Adapted: panel architecture, 3D scanner layout, visual legend, neon card style.
- Not copied: mock runtime data, standalone scaffold types as source of truth, fake trades/candidates, any execution logic.

## Safety Notes
- Candidate click only selects symbol.
- Add to watchlist is separate and does not execute buy.
- Manual buy uses existing protected handler from Trade page.

## Revised Layout (Phase Refinement)
- Top bar unchanged.
- Left compact stack: The Dipper, Market Regime, Active Strategy, Risk Summary.
- Center top: smaller 3D scanner hero.
- Right stack: Selected Coin (top) + Top Candidates (under).
- Bottom main: Open Positions (large), Closed Positions (large), Trading Parameters card.
- Full CandidateTable remains available as source-of-truth table in a dedicated lower panel.

## Pagination
- Open Positions: 25 rows/page with Prev/Next + page indicator.
- Closed Positions: 25 rows/page with Prev/Next + page indicator.

## Trading Parameters Card
- Strategy, SL, TP1, TP2, Ref Window, Ref Mode.
- Optional trailing controls shown as UI-bound state.
- No direct execution calls.
- No trading logic changes.
