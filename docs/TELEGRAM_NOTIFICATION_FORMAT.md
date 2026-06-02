# Telegram Notification Format

## BUY Template
- Header: `?? The Dipper bought <SYMBOL>`
- Includes strategy, entry price, entry rationale, confidence/risk, position size, TP/SL plan, status line.

## PROFIT Template
- Header: `?? [PROFIT]`
- Includes bot, mode, symbol, entry/exit, positive PnL, strategy, exit reason, entry signal summary, clean-win status line.

## LOSS Template
- Header: `?? [LOSS]`
- Includes bot, mode, symbol, entry/exit, negative PnL, strategy, exit reason, entry signal summary, controlled-loss status line.

## WAIT/BLOCK Template
- Header: `?? [WAIT]`
- Includes bot, symbol, strategy, confidence, reason, and `Needs` checklist lines.

## ERROR Template
- Header: `?? [ERROR]`
- Includes module, safe error message, and timestamp.

## Secret Safety Rules
- All template text is sanitized before send.
- Any token/secret-like fragments are redacted.
- Never include Binance API keys, API secret, Telegram bot token, or chat secret values.
- Templates strip unsafe markup delimiters.

## Notification Toggles
- `notifyOnBuy`
- `notifyOnSell`
- `notifyOnStopLoss`
- `notifyOnTakeProfit`
- `notifyOnBlock`
- `notifyOnError`
- `notifyOnDailySummary`
