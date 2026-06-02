# Persistence & Restore Flow

## Architecture

```
App.tsx startup
  ├── Journal.loadTrades()        → loads from SQLite (Tauri) or in-memory
  ├── appStatePersistence.load()  → loads app state, selected coins, settings
  ├── Restore brains              → engine.addBrain() for each persisted coin
  ├── Restore equity history      → store.addEquityPoint()
  └── Live safety downgrade       → LIVE_RUNNING→LIVE_CHECK_REQUIRED

Periodic save (30s)
  └── appStatePersistence.save()  → persists current state
```

## SQLite Schema

### trades
```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT
trade_id        TEXT
coin            TEXT
mode            TEXT
side            TEXT
adapter         TEXT
entry_price     REAL
exit_price      REAL
quantity        REAL
pnl             REAL
pnl_percent     REAL
pnl_usd         REAL
entry_time      TEXT
exit_time       TEXT
status          TEXT
ml_confidence   REAL
prediction      TEXT
strategy        TEXT
buy_snapshot_json       TEXT
close_snapshot_json     TEXT
ml_label_json           TEXT
ml_quality_json         TEXT
training_eligible       INTEGER
data_quality            TEXT
ml_use                  TEXT
created_at              TEXT
updated_at              TEXT
```

### open_positions
```sql
trade_id            TEXT PRIMARY KEY
symbol              TEXT
position_json       TEXT    (full Position object JSON)
buy_snapshot_json   TEXT
created_at          TEXT
updated_at          TEXT
```

### app_state
```sql
key             TEXT PRIMARY KEY
value_json      TEXT
updated_at      TEXT
```

### schema_meta
```sql
version         INTEGER PRIMARY KEY
```

## What Is Saved

| Data | Method | Frequency |
|------|--------|-----------|
| Trades | `Journal.recordTrade()` | On each trade entry/close |
| App state | `appStatePersistence.save()` | Every 30s |
| Open positions | Via position_json | When position opens/closes |
| Equity history | In app state JSON | Every 30s |
| Selected coins | In app state JSON | Every 30s |
| Settings | In app state JSON | Every 30s |

## Startup Restore Order

1. **Journal.loadTrades()** — loads all trades from SQLite into memory
2. **appStatePersistence.load()** — loads app state JSON
3. **Safe live state downgrade** — if persisted state was LIVE_RUNNING or LIVE_READY, downgrade to LIVE_CHECK_REQUIRED
4. **Brain restore** — for each persisted selected coin, call engine.addBrain()
5. **Equity history restore** — feed persisted points into ui-store
6. **UI update** — force re-render

## In-Memory Fallback

- Outside Tauri (browser dev), all persistence operations fall back to:
  - `InMemoryStore` for trades (in-process array)
  - `localStorage` for app state
- `isTauriAvailable()` checks if `@tauri-apps/api/core` can be imported
- Persistence status badge shows DB OK / DB FALLBACK / DB ERROR

## Backup Format

```json
{
  "schemaVersion": "cryptobud-v4-full-backup-v1",
  "exportedAt": "2026-...",
  "appState": { ... },
  "trades": [ ... ],
  "mlDataset": {
    "featureVectors": [ ... ],
    "counts": { ... }
  }
}
```

Backup is one-click export from Settings page. Import is available via `backupService.importFullBackup()` but has no UI button (user must trigger programmatically or via future feature).

## Live Restore Safety Rule

- If previous session was **LIVE_RUNNING**, restore as **LIVE_CHECK_REQUIRED**
- If previous session was **LIVE_READY**, restore as **LIVE_CHECK_REQUIRED**
- If previous session was **LIVE_CHECK_RUNNING**, restore as **LIVE_CHECK_REQUIRED**
- All other states preserved as-is
- Default (no persisted state): **LIVE_DISABLED**
- Live trading **never auto-starts** on app launch

## Open Position Restore Rule

- Open positions are serialized as JSON in `open_positions` table
- On startup, positions are restored to the in-memory paper adapter
- No forced close until first valid fresh price arrives from MarketDataFeed
- Position PnL recalculated from current market data once feed starts

## Persistence Logs

| Log | When |
|-----|------|
| `PERSISTENCE_START` | Beginning of loadTrades() |
| `PERSISTENCE_LOAD_TRADES_SUCCESS: N trades` | After loading from SQLite |
| `PERSISTENCE_LOAD_TRADES_FAILED` | If SQLite load throws |
| `PERSISTENCE_SAVE_TRADE_SUCCESS: tradeId` | After each successful save |
| `PERSISTENCE_SAVE_TRADE_FAILED: tradeId` | If save throws (non-fatal) |
| `PERSISTENCE_UPDATE_TRADE_FAILED: tradeId` | If update throws (non-fatal) |
| `PERSISTENCE_SAVE_APP_STATE_FAILED` | If app state save throws |
| `PERSISTENCE_LOAD_APP_STATE_FAILED` | If app state load throws |
| `PERSISTENCE: Restored brain for COIN` | During startup restore |
| `PERSISTENCE: Restored N equity history points` | During startup restore |
| `PERSISTENCE: Startup restore complete` | After all restore steps |
| `PERSISTENCE: Live state was active — restoring as LIVE_CHECK_REQUIRED` | Safety downgrade |
| `BACKUP: Loaded backup v...` | During backup import |
| `BACKUP: Failed to parse backup` | Invalid backup JSON |

## Persistence Status Badge

Displayed in TopBar next to PAPER/LIVE badge:

| Status | Color | Meaning |
|--------|-------|---------|
| DB OK | Green | Tauri SQLite available and working |
| DB FALLBACK | Yellow | Non-Tauri (browser) — in-memory + localStorage |
| DB ERROR | Red | Persistence error occurred (last save failed) |

## Browser Fallback Behavior

- In browser/Vite mode, Tauri runtime can be unavailable by design.
- Persistence switches to in-memory fallback and logs once:
- `PERSISTENCE_FALLBACK_ACTIVE: Tauri runtime unavailable; using in-memory fallback`
- Repeated load/save calls do not spam runtime-unavailable errors.
