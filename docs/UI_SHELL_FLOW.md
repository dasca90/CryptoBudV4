# UI Shell Flow

## Architecture

```
App.tsx (controller)
├── TradingEngine (orchestrator)
├── Journal (persistence)
├── UIStore (state)
└── AppShell (layout wrapper)
    ├── TopBar (title, status, buttons)
    ├── MainTabs (5 tabs)
    └── Content (page by activeMainTab)
        ├── TradePage (3-panel: scan/chart/positions)
        ├── JournalPage (trade table + filter)
        ├── MLLabPage (dataset counts, quality chart, export)
        ├── LogsPage (log viewer + level filter)
        └── SettingsPage (paper config, live check)
```

## Main Tabs

| Tab | Key | Description |
|-----|-----|-------------|
| Trade | `trade` | Coin scanning, chart, positions |
| Journal | `journal` | Trade history with ML quality columns |
| ML Lab | `ml-lab` | Dataset counts, quality breakdown, export |
| Logs | `logs` | Log viewer with level filter |
| Settings | `settings` | Paper/live config |

## Trade Layout (3-panel)

### Left Panel — Brain List
- AUTO / MANUAL / SCALPER mode tabs
- Add coin input + quick-add buttons (BTC, ETH, BNB, SOL, etc.)
- Scrollable brain list: each row shows coin name, mode badge, decision badge, enable checkbox
- Position rows show PnL % and Close button
- Status footer: candidate count, position count

### Center Panel — Selected Coin Analysis
- Coin header with mode selector dropdown
- PriceChart (SVG) with entry/TP1/TP2/SL markers
- Trader Brain decision detail: strategy, playbook, confidence, entry plan, blocks, next actions
- Candidate table: all brains with symbol, strategy, confidence arrow, status badge, reason

### Right Panel — Positions & Recent Trades
- Open position cards with PnL %, entry price, quantity
- MiniSparkline per position
- Recent trades list (last 5)

## Journal Page
- Table columns: Time, Coin, Side, Entry, Exit, PnL%, PnL$, Data Quality, ML Use, Training Eligible
- Filter bar: ALL / GOOD / MEDIUM / BAD / Training / Excluded
- Scrollable table body

## ML Lab Page
- Counts grid: Total Trades, Training Rows, Advisory Rows, Excluded Rows
- Quality breakdown bar chart (GOOD / MEDIUM / BAD with colored bars)
- Equity curve chart
- Export buttons: Full Dataset, Training Rows (green), Advisory Rows (yellow), Excluded Rows

## Logs Page
- Filter bar: ALL / INFO / WARN / ERROR / TRADE buttons + search input
- Log entries: timestamp, level badge (colored), message
- Clear button

## Settings Page
- Paper settings: starting balance, risk style selector, max positions, max capital per position, coin groups
- Journal info: total trades display
- Live section: mode display, Run Live Check button, status message

## Chart Components

### PriceChart
- SVG line chart with price data
- Horizontal markers for entry price (green), TP1 (blue), TP2 (cyan), SL (red)
- Empty state when no data

### MiniSparkline
- Small inline SVG sparkline (80x24)
- Green/red gradient based on trend (positive green, negative red)

### EquityCurveChart
- SVG line chart with gradient fill
- Labeled axes
- Empty state when no data

## Button States

| Button | Running | Stopped |
|--------|---------|---------|
| START | disabled | enabled |
| STOP | enabled | disabled |
| EMERGENCY STOP | enabled | disabled |
| Export buttons | always enabled | always enabled |
| Add/Remove coin | always enabled | always enabled |
| Close position | always enabled | always enabled |

## Badge Variants (StatusBadge)
- PAPER (green), LIVE_READY/LIVE_RUNNING (blue), LIVE_DISABLED/LIVE_BLOCKED/LIVE_ERROR (red)
- AUTO (blue), MANUAL (yellow), SCALPER (cyan)
- BUY (green), WAIT (yellow), BLOCK (red), AVOID (gray)
- GOOD (green), MEDIUM (yellow), BAD (red)
- TRAINING (green), ADVISORY (yellow), EXCLUDED (gray)
- OPEN (blue), CLOSED (green)
