# CryptoBud V4 â€” Settings Control Center

## Overview

Phase 14 adds a full settings page with BTC/ETH anchor toggles, demo trading reset, ML brain reset, Binance API configuration, and Telegram notification settings.

---

## 1. BTC Anchor ON/OFF

**UI:** Settings â†’ Trading Anchors â†’ BTC Anchor toggle

When **ON** (default):
- BTC dump detection can block or reduce confidence for alt entries
- `btcDumping` flag in `CoinMarketContext` is propagated to playbooks, EntryGate, and strategy rules
- `btcRegime` in `CoinMarketContext` influences playbook decisions (e.g., conservative blocks alts in downtrend)

When **OFF**:
- `btcDumping` is forced to `false` regardless of market conditions
- `btcRegime` is forced to `'sideways'`
- No BTC-based hard blocks or confidence penalties
- Logged as `BTC_ANCHOR_DISABLED`

**Implementation:** `TraderBrain.setAnchorSettings(btcEnabled, ethEnabled)` sets flags on each brain. `buildMarketContext()` gates `btcDumping` and `btcRegime` based on these flags.

---

## 2. ETH Anchor ON/OFF

**UI:** Settings â†’ Trading Anchors â†’ ETH Anchor toggle

When **ON** (default):
- ETH trend/regime affects alt decisions where relevant
- ETH weakness can lower confidence or add warnings

When **OFF**:
- ETH context is info-only
- No ETH hard block or confidence penalty
- Logged as `ETH_ANCHOR_DISABLED`

---

## 3. Reset Demo Trading

**UI:** Settings â†’ Demo Trading Reset

Three options:
- **Reset Balance Only** â€” resets paper balance to 10000; preserves positions, locks, settings, journal, ML
- **Reset Positions Only** â€” clears all open paper positions and order locks; preserves balance, settings
- **Full Demo Reset** â€” resets balance, positions, locks, runtime state, and PnL stats; preserves settings, API config, telegram settings, journal, ML

All options require typing `RESET DEMO` to confirm.

**Engine actions:**
- `PositionManager.clearAllPositions()`
- `OrderLockManager.releaseAllLocks()`
- `TradingEngine.resetPaperPositions()` â€” clears brain positions, positions, locks, runtime counters
- `TradingEngine.setAccountBalance(10000)`

**Logs:** `DEMO_TRADING_RESET_REQUESTED`, `DEMO_TRADING_RESET_COMPLETED`

---

## 4. Reset ML Brain

**UI:** Settings â†’ ML Brain Reset

Clears:
- ML predictions memory
- Learned weights/cache
- Coin memory used by ML
- Regime memory used by ML
- Advisory counters

Preserves:
- Journal trades
- Raw trade records
- Exported reports
- App settings
- API keys
- Telegram settings

Requires typing `RESET ML` to confirm.

**Logs:** `ML_BRAIN_RESET_REQUESTED`, `ML_BRAIN_RESET_COMPLETED`

---

## 5. Binance API

**UI:** Settings â†’ Binance API

Fields:
- API Key (password field, masked after save)
- API Secret (password field, never displayed after save)
- Save API Keys
- Test Connection (public ping + server time)
- Clear API Keys (requires typing `CLEAR API`)

Status badge:
- `NOT_CONFIGURED` (grey)
- `CONFIGURED` (yellow)
- `TESTING` (blue)
- `VALID` (green)
- `INVALID` (red)
- `ERROR` (red)

**Safety rules:**
- Full API key never returned to UI after save (key is masked: `my-s...2345`)
- API secret never returned to UI after save
- No live order execution permitted
- No API keys logged

**Test Connection:**
- `GET /api/v3/ping` â€” public endpoint, no key required
- `GET /api/v3/time` â€” public endpoint, no key required
- Private API test is placeholder (live remains blocked)

**Logs:** `API_KEYS_SAVED`, `API_KEYS_CLEARED`, `API_TEST_STARTED`, `API_TEST_SUCCESS`, `API_TEST_FAILED`

---

## 6. Telegram Notifications

**UI:** Settings â†’ Telegram Notifications

Fields:
- Enable Telegram toggle
- Bot Token (password field)
- Chat ID
- Save Telegram
- Test Message button
- Event type checkboxes: Buy, Sell/SL/TP, Blocks, Errors, Daily Summary

**Notifier:** `src/core/notifications/TelegramNotifier.ts`

Events:
- `BUY_OPENED` â€” when a trade is opened
- `SELL_CLOSED` â€” when a trade is closed
- `STOP_LOSS` â€” when SL is hit
- `TP_HIT` â€” when TP is reached
- `ERROR` â€” on errors
- `DAILY_SUMMARY` â€” daily PnL summary (placeholder)

**Rules:**
- No notifications sent when disabled
- No notifications sent when token/chat ID missing (logs `TELEGRAM_NOT_CONFIGURED`)
- Test message sends only on button click
- No secrets logged

**Logs:** `TELEGRAM_SETTINGS_SAVED`, `TELEGRAM_TEST_SENT`, `TELEGRAM_TEST_FAILED`, `TELEGRAM_NOT_CONFIGURED`

---

## 7. Confirmation Rules

All destructive actions require typed confirmation:

| Action | Required Text |
|--------|--------------|
| Reset Balance | `RESET DEMO` |
| Reset Positions | `RESET DEMO` |
| Full Demo Reset | `RESET DEMO` |
| Reset ML Brain | `RESET ML` |
| Clear API Keys | `CLEAR API` |

**Component:** `src/components/ui/ConfirmDangerAction.tsx`

Two-step workflow:
1. Click button â†’ text input appears
2. Type exact confirmation text â†’ Confirm button activates
3. Click Confirm â†’ action runs â†’ "Done." shown

---

## 8. What Data Is Cleared/Preserved

| Action | Cleared | Preserved |
|--------|---------|-----------|
| Reset Balance | paper balance | positions, locks, settings, API, Telegram, journal, ML |
| Reset Positions | positions, locks | balance, settings, API, Telegram, journal, ML |
| Full Demo Reset | balance, positions, locks, runtime state, PnL stats | settings, API, Telegram, journal, ML |
| Reset ML Brain | predictions, weights, memory, advisory counters | journal, settings, API, Telegram |
| Clear API Keys | API key, API secret | settings, Telegram, journal, ML |

---

## 9. Settings Persistence

**File:** `src/core/persistence/SettingsPersistence.ts`

Storage:
- Uses `TauriBridge.saveAppState` / `getAppState` with JSON serialization
- Falls back to in-memory `Map` in non-Tauri environments
- Separate keys: `app_settings`, `api_config`, `telegram_settings`

Defaults:
- BTC anchor ON, ETH anchor ON
- Telegram OFF
- API not configured
- Risk style: moderate
- Max positions: 10
- Capital per trade: 100
- Allowed groups: all

---

## 10. Log Events

| Event | When |
|-------|------|
| `SETTINGS_SAVED` | Anchor settings saved |
| `BTC_ANCHOR_ENABLED` | BTC anchor turned ON |
| `BTC_ANCHOR_DISABLED` | BTC anchor turned OFF |
| `ETH_ANCHOR_ENABLED` | ETH anchor turned ON |
| `ETH_ANCHOR_DISABLED` | ETH anchor turned OFF |
| `DEMO_TRADING_RESET_REQUESTED` | Demo reset initiated |
| `DEMO_TRADING_RESET_COMPLETED` | Demo reset completed |
| `ML_BRAIN_RESET_REQUESTED` | ML brain reset initiated |
| `ML_BRAIN_RESET_COMPLETED` | ML brain reset completed |
| `API_KEYS_SAVED` | API keys stored |
| `API_KEYS_CLEARED` | API keys removed |
| `API_TEST_STARTED` | API test connection started |
| `API_TEST_SUCCESS` | API test passed |
| `API_TEST_FAILED` | API test failed |
| `TELEGRAM_SETTINGS_SAVED` | Telegram settings saved |
| `TELEGRAM_TEST_SENT` | Test message sent successfully |
| `TELEGRAM_TEST_FAILED` | Test message failed |
| `TELEGRAM_NOT_CONFIGURED` | Missing token/chat ID |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/core/types/index.ts` | AppSettings, AnchorSettings, TelegramSettings, ApiConfig, ResetResult types |
| `src/core/persistence/SettingsPersistence.ts` | Settings save/load, reset methods |
| `src/core/notifications/TelegramNotifier.ts` | Telegram notification sending |
| `src/core/trading/TraderBrain.ts` | Anchor gating in `buildMarketContext()` |
| `src/core/trading/TradingEngine.ts` | Exposed PositionManager, OrderLockManager for reset |
| `src/core/positions/PositionManager.ts` | `clearAllPositions()` method |
| `src/core/orders/OrderLockManager.ts` | `releaseAllLocks()` method |
| `src/components/ui/ConfirmDangerAction.tsx` | Two-step confirmation for destructive actions |
| `src/ui/pages/SettingsPage.tsx` | Full settings page with all 6 sections |
| `src/__tests__/settings.test.ts` | 67 assertions across 15 test groups (Aâ€“O) |

## Phase 17B Layout Update
- Paper trading controls moved from Settings page to Trade page (left panel) under `PAPER TRADING SETTINGS`.
- Settings page remains focused on API, Telegram, Anchors, Reset, Persistence, Backup, and Live safety.
- Settings page now includes a note: `Paper trading controls moved to Trade page.`


## Public vs Private Binance
- Public Binance scanner data uses public endpoints only and does not require API keys.
- API keys are reserved for future live/private account checks only.
- In paper mode, scanner/manual/scalper can run with empty API keys when public data is online.

