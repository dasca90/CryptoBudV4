# UI Polish Final Pass (Phase 19)

## Trade Layout
- Left: mode selector, universe/coin selector, paper settings, risk/lock summaries.
- Center: chart + selected candidate/brain analysis and decisions.
- Right: open positions, candidate pool, recent context.

## AUTO Panel
- Shows scanner status, universe, counts (BUY/WAIT/BLOCK/AVOID), filter summary.
- Candidate table includes rank, status, reason, next action, ML risk, spread.
- No-buy state: `No BUY — candidate pool stopped before execution.`

## Manual Panel
- Analyze, Manual Buy, Manual Sell controls.
- Stale safety message: `Analysis stale — re-analyze before buying.`
- Buy remains disabled unless analysis is fresh and EntryGate allows.

## Scalper Panel
- OFF/ARMED/RUNNING/PAUSED behavior preserved.
- PAPER ONLY guard visible.
- Radar health states and candidate metrics shown.

## Journal / ML / Logs / Settings
- Journal filters include Winners, Losers, GOOD only, Training eligible, Excluded.
- ML Lab warning: ML cannot force BUY; only WAIT/BLOCK/confidence adjustment.
- Logs page includes level filters plus SCANNER/RISK/ML/TELEGRAM quick filters.
- Settings page remains focused on Anchors, API, Telegram, Reset, Persistence, Live safety.
- Paper settings remain only on Trade page.

## Button Safety Rules
- AUTO Start disabled when scanner already running/no data.
- Manual Buy disabled for stale or blocked analysis.
- Scalper Start disabled in live adapter mode/when already running/no data.
- Live remains locked behind safety checks.

## Empty States
- AUTO: `Start AUTO scanner to build candidate pool.`
- Analysis: `Select a candidate or coin to view analysis.`
- Journal: `No trades yet.`
- Logs: `No logs yet.`
- Chart fallback remains no-data safe.

## V3 Visual Consistency
- Existing V3-style structure, badges, compact controls, and panel density preserved.
- No core trading logic moved to React components.

