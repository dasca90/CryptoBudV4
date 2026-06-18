# 3D Air Scanner Integration Freeze

Status: Phase 1 freeze candidate
Scope: read-only production integration preparation
Last updated: 2026-06-17

## Objective

Integrate the 3D Air Scanner into the main app as a read-only visual scanner.

The first production integration must not connect to execution actions. It must not change trading logic, BUY/SELL logic, strategies, TP/SL, trailing, risk execution, order placement, or live exchange adapters.

## Approved Visual States

### State 01 Scanning

- 40-coin scanner layout.
- Interactive floating spheres with readable symbol, price, and coin mark.
- Single dome-style scan pulse every 10 seconds.
- Scan pulse color: electric cyan / teal / blue with a subtle neon pink accent.
- Scan pulse behaves like a 5D dome/supernova: it expands outward and upward, not just as a flat ring.
- Scan pulse particles travel with the dome.
- Spheres glow briefly when the scan wave touches them.

### State 02 Wait

- Amber/orange wait candidate.
- Stable pulsing sphere.
- No aggressive camera movement.
- Wait status remains visually distinct from buy and blocked states.

### State 03 Buy Transfer

- Bought coin is fixed near the scanner center and visually emphasized.
- Bought coin is shiny/glowy, with additive halo and local particles.
- Teleport beam travels from bought coin to the Open Positions card.
- Beam endpoint stops at the beginning/left edge of the Open Positions card, not inside the row.
- Beam has subtle oscillation.
- Particles flow through the beam from coin toward Open Positions.
- No dotted helper line is visible.
- Beam/overlay lifecycle lasts 30 seconds, then disappears.
- Sphere/beam fade timing must feel smooth and intentional.

### State 04 Blocked

- Blocked/rejected coins push outward.
- Blocked coins use red/pink rejection particles.
- Blocked label stays camera-facing and readable.
- The effect communicates rejection/pushed out, not destruction.

### State 05 Open Position

- Open Positions remains a separate card from the scanner surface.
- Newly opened position row can be highlighted.
- Confirmed open position is visual-only during first integration.

## Approved Layout Rules

- Scanner should preview at production-like size.
- Open Positions card stays separate from the scanner card.
- The 3D scanner must not overlap critical app panels.
- Text must remain readable with up to 40 coins.
- Spheres stay clickable for selection/inspection only.

## Lab-Only Controls

The following stay in the prototype/lab unless explicitly approved later:

- Left-side animation state buttons.
- Quality segment controls.
- Graphics toggles.
- Visual debug card.
- Auto demo loop.
- Mock data and mock state sequencing.

## Integration-In Scope

The production integration can reuse:

- 3D scanner canvas and scene composition.
- Coin sphere visual language.
- Camera-facing labels.
- Coin selection interaction.
- Scan pulse.
- Wait, buy, blocked, and open-position visual states.
- Read-only Open Positions visual mapping.

## Integration-Out Of Scope For First Pass

Do not include in the first integration:

- Real BUY/SELL execution from 3D scanner clicks.
- Trading engine writes.
- Strategy changes.
- Risk engine changes.
- Position manager behavior changes.
- TP/SL/trailing changes.
- Exchange adapter changes.
- Production scanner replacement without feature flag.

## Safety Rules

- First integration is read-only.
- Existing scanner remains available behind feature flag fallback.
- Feature flag must keep an explicit rollback path to the old scanner.
- No production trading logic may be modified.
- No new live order path may be introduced.
- Any interaction must be UI selection/inspection only.

## Freeze Acceptance Checklist

- [ ] User approves these five visual states.
- [ ] User approves Open Positions as separate card.
- [ ] User approves 30-second buy transfer beam lifecycle.
- [ ] User approves 10-second scan pulse interval.
- [ ] User approves read-only integration as the next phase.

## Current Checkpoint

Phase 1 is documented.

## Phase 2 Audit: Production Scanner

Status: audit started
Scope: read-only production integration discovery

### Production Mount Points

- Main route/page owner: `src/ui/pages/TradePage.tsx`.
- Trade layout shell: `src/components/trade-v4/TradeV4Page.tsx`.
- Current production scanner component: `src/components/trade-v4/AirScanner3D.tsx`.
- Current production scanner coin node: `src/components/trade-v4/AirCoin.tsx`.
- Current production Open Positions panel: `src/components/trade-v4/OpenPositionsPanel.tsx`.
- Current production model types: `src/components/trade-v4/types.ts`.
- Current production data adapter: `src/lib/air-scanner/tradeV4DataAdapter.ts`.

### Current Production Data Flow

`TradePage.tsx` builds a `TradeV4PageModel` with `buildTradeV4PageModel`.

The model already exposes the read-only visual inputs needed by the new scanner:

- `model.candidates`
- `model.openPositions`
- `model.closedPositions`
- `model.selectedSymbol`
- `model.scannerRunning`
- `model.executionPlan`
- `model.paperAutoResult`
- `model.emptyUniverseReason`

`TradeV4Page.tsx` mounts the current scanner with:

- `candidates={props.model.candidates}`
- `openPositions={props.model.openPositions}`
- `closedPositions={props.model.closedPositions}`
- `executionPlan={props.model.executionPlan}`
- `paperAutoResult={props.model.paperAutoResult}`
- `selectedSymbol={selectedSymbol}`
- `active={props.model.scannerRunning}`
- `onSelectSymbol={selectSymbol}`

### Existing Read-Only Boundary

The current scanner sphere click path is selection-only:

- `AirScanner3D.tsx` calls `props.onSelectSymbol(coin.symbol)`.
- `TradeV4Page.tsx` maps selection through `selectSymbol`.
- `TradePage.tsx` maps selection to `store.selectSymbol(symbol)`.

Manual buy is separate and must remain separate:

- `SelectedCoinInspector.tsx` owns the `MANUAL BUY` button.
- `TradeV4Page.tsx` passes `onManualBuy` only into `SelectedCoinInspector`.
- The new 3D scanner must not receive `onManualBuy`.

### Production Data To 3D Visual Map

| Production source | Current type | New scanner visual use |
| --- | --- | --- |
| `model.candidates` | `TradeV4CandidateView[]` | coin spheres, score/confidence, state color, reasons, selected/blocked/wait/buy visual states |
| `model.openPositions` | `TradeV4OpenPositionView[]` | Open Positions card rows, open-position highlights, buy-transfer endpoint and row confirmation |
| `model.closedPositions` | `TradeV4ClosedPositionView[]` | lifecycle cleanup / optional visual removal only |
| `model.selectedSymbol` | `string \| null` | selected sphere highlight and inspector sync |
| `model.scannerRunning` | `boolean` | scan pulse active/paused state |
| `model.executionPlan` | `TradeV4PageModel["executionPlan"]` | read-only visual state hints for selected-for-execution / wait / blocked |
| `model.paperAutoResult` | `TradeV4PageModel["paperAutoResult"]` | read-only buy-transfer animation trigger |
| `model.emptyUniverseReason` | `string \| undefined` | empty scanner message |

### Adapter Direction

The safe integration adapter should translate:

- `TradeV4CandidateView` to lab visual coin data.
- `TradeV4OpenPositionView` to lab Open Positions visual rows.
- `TradeV4PageModel` scanner status to lab animation state.

The adapter must be pure:

- no calls to `TradingEngine`
- no calls to `PositionManager`
- no calls to exchange adapters
- no writes to settings or persistence
- no callbacks that execute orders

### Feature Flag Requirement

No production replacement should happen directly.

Recommended first integration shape:

- add a feature flag such as `enable3DScannerLabPreview`
- default on in browser/app contexts after approval to connect the new scanner
- explicit flag false keeps current `src/components/trade-v4/AirScanner3D.tsx`
- flag true/default mounts the new read-only lab-derived scanner
- keep Open Positions as a separate card

### Forbidden Zones For First Integration

Do not modify these for the first read-only integration:

- `src/core/trading/*`
- `src/core/scanner/*` execution behavior
- `src/core/positions/PositionManager.ts`
- exchange adapters
- BUY/SELL handlers
- TP/SL/trailing calculations
- strategy routing
- order locks

### Phase 2 Checkpoint

Production scanner audit is documented.

## Phase 3 Adapter Checkpoint

Status: first pure adapter created
File: `src/features/air-scanner-lab/airScannerAdapter.ts`

The adapter currently maps production read-only model data into lab visual data:

- `TradeV4PageModel` to `AirScannerLabReadOnlyView`
- `TradeV4CandidateView` to `MockScannerCoin`
- `TradeV4OpenPositionView` to `OpenPositionVisualRow`

Verified adapter behavior:

- caps rendered coins at `MAX_RENDERED_COINS` / 40
- keeps Open Positions as separate visual rows
- maps selected/executing BUY candidate to transfer visual state
- maps blocked production candidates to blocked lab visuals
- highlights the confirmed/opened Open Positions row

Adapter safety rules:

- pure mapping only
- no runtime mount yet
- no order callbacks
- no trading engine calls
- no position manager calls
- no exchange adapter calls

Next step: add feature flag and mount the lab-derived scanner read-only behind the flag, while preserving the existing production scanner as fallback.

## Phase 4 Feature Flag Checkpoint

Status: first read-only mount path created

Files:

- `src/features/air-scanner-lab/featureFlag.ts`
- `src/features/air-scanner-lab/AirScannerProductionPreview.tsx`
- `src/components/trade-v4/TradeV4Page.tsx`

Feature flag:

- key: `enable3DScannerLabPreview`
- default: on in browser/app contexts
- opt-in query: `?enable3DScannerLabPreview=true`
- opt-in local storage: `localStorage.setItem('enable3DScannerLabPreview', 'true')`
- rollback query: `?enable3DScannerLabPreview=false` or `?useLegacyAirScanner3D=true`
- rollback local storage: `localStorage.setItem('useLegacyAirScanner3D', 'true')`

Behavior:

- default/flag on: lab-derived read-only production preview mounts in the scanner panel
- flag false: existing production `AirScanner3D` remains mounted
- production Open Positions panel remains separate
- lab controls/debug are hidden in production preview
- sphere click selects a coin only
- no BUY/SELL callback is passed into the new scanner preview

Known next integration task:

- wire the teleport beam endpoint to the real production Open Positions card without duplicating the card inside the scanner.

## Phase 5 Read-Only Transfer Overlay Checkpoint

Status: first production transfer overlay created behind feature flag

Files:

- `src/features/air-scanner-lab/ProductionOpenPositionTransferOverlay.tsx`
- `src/features/air-scanner-lab/AirScannerProductionPreview.tsx`
- `src/components/trade-v4/TradeV4Page.tsx`

Behavior:

- production preview reports the bought coin screen point upward to `TradeV4Page`
- transfer overlay anchors to the real `[data-testid="open-positions-panel"]`
- beam endpoint stops at `rect.left`, the left edge of the Open Positions card
- overlay is `position: fixed`, so it can cross from scanner to the separate Open Positions card
- beam and particles fade after 30 seconds
- overlay is mounted only when `enable3DScannerLabPreview` is enabled

Still read-only:

- no duplicated production Open Positions card inside the scanner
- no order callbacks
- no trading engine calls
- no PositionManager calls
- no exchange adapter calls

Next step: visual QA with the feature flag enabled, then tune beam source/target offsets if the production layout needs pixel-level adjustment.

## Production Visual QA Gate

Status: pending user/browser approval
Reason: Codex browser policy blocked opening `http://127.0.0.1:5173` in this session, so rendered QA must be completed in a normal local browser or a permitted browser session.

### Default Preview

The read-only 3D scanner is the default Trade V4 scanner in browser/app contexts.

To force-enable it in the normal browser console on the Trade V4 app:

```js
localStorage.setItem('enable3DScannerLabPreview', 'true');
location.reload();
```

Alternative one-load opt-in:

```text
?enable3DScannerLabPreview=true
```

### Rollback

Run:

```js
localStorage.setItem('useLegacyAirScanner3D', 'true');
location.reload();
```

Expected rollback result:

- the existing production `AirScanner3D` renders again
- Open Positions remains unchanged
- no scanner setting, trading setting, strategy, or execution state is modified

To return to the default new scanner after rollback:

```js
localStorage.removeItem('useLegacyAirScanner3D');
location.reload();
```

### Visual Acceptance Checks

- Scanner mounts in the real Trade V4 scanner panel only when the flag is enabled.
- Existing scanner remains visible when the flag is disabled.
- Open Positions remains a separate production card, not duplicated inside the scanner.
- Scanner height/width fits the real production layout without overlapping Open Positions, Selected Coin, Top Candidates, Market Groups, or bottom panels.
- Up to 40 spheres remain readable enough for visual scanning.
- Sphere clicks select/inspect only; they must not execute BUY/SELL.
- Supernova scan pulse is visible, not too frequent, and does not obscure the table.
- Buy transfer beam starts from the bought coin and ends at the left edge of the Open Positions card.
- Buy transfer beam and particles fade/disappear after 30 seconds.
- Blocked coins stay readable and do not stutter heavily.
- Browser console has no relevant React/Vite/runtime errors after enabling the flag.

### Read-Only Safety Checks

- No real order is created by clicking a sphere.
- No manual buy control is present inside the 3D scanner.
- Existing manual buy remains only in `SelectedCoinInspector`.
- No TP/SL/trailing/strategy values change while toggling the scanner flag.
- Disable flag returns to the old scanner without app restart beyond page reload.

### Completion Rule

The read-only integration can be considered complete only after:

- lint passes
- lab tests pass
- UI tests pass
- build passes
- visual QA checklist above is approved
- user confirms the rendered scanner is acceptable in the real Trade V4 layout

## Tauri Release Checkpoint

Status: release build created
Build date: 2026-06-17

Command used:

```powershell
npm.cmd run tauri -- build
```

Built executable:

```text
D:\Crypto BUD v4\src-tauri\target\release\cryptobud-v4.exe
```

Executable evidence:

- size: `10928640` bytes
- last write time: `17/06/2026 16:56:55`
- SHA256: `39460A2EA2E161F5848D8347283DE27268315E65AD074C8C3FAB97C1002BA884`

Expected scanner behavior in this executable:

- new read-only 3D scanner is enabled by default
- stale `enable3DScannerLabPreview=false` localStorage values do not keep the legacy scanner active
- legacy scanner fallback requires explicit rollback via `useLegacyAirScanner3D=true`
- clearing `useLegacyAirScanner3D` returns to the new scanner
- no BUY/SELL or execution path is connected to sphere clicks
