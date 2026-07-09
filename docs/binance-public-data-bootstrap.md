# Binance Public Data Bootstrap

## Root Cause

The V5 experimental branch had public market data status represented by local UI booleans while `MarketDataFeed.fetchExchangeInfo()` swallowed fetch failures. When Binance public endpoints failed, the app showed generic OFFLINE state without the failed endpoint/reason, and scanner start retried only a partial ping/exchangeInfo path.

This was unrelated to AI provider configuration. AI Provider OFF and AI Takeover OFF must not affect Binance public market data.

## Fixed Flow

`refreshPublicMarketData()` is now the canonical bootstrap path for:

- app boot
- Settings > Refresh Public Data
- scanner start preflight
- Run Live Check

The refresh performs:

1. exchangeInfo fetch
2. BTCUSDT ticker price probe
3. BTCUSDT bookTicker probe
4. open-position bookTicker refresh
5. canonical `MarketDataFeed` exchangeInfo/bookTicker update
6. exact endpoint/reason status update

Public endpoint fallback order:

```text
https://api.binance.com
https://api1.binance.com
https://api2.binance.com
https://api3.binance.com
https://data-api.binance.vision
```

## Safety Invariants

- Scanner start is blocked with `PUBLIC_MARKET_DATA_OFFLINE` if exchangeInfo/ticker/bookTicker bootstrap fails.
- Exit engine does not use entry snapshot as a real exit price.
- If all close-price sources are unavailable, exit tick is skipped and audited.
- Binance private API keys are not required for public market data.
- AI Command Center does not choose paper/live execution modes.

## Audits

Added or repaired:

- `BINANCE_PUBLIC_CONNECTIVITY_AUDIT`
- `BINANCE_EXCHANGE_INFO_BOOTSTRAP_AUDIT`
- `BINANCE_PUBLIC_TICKER_PROBE_AUDIT`
- `BINANCE_PUBLIC_BOOK_TICKER_PROBE_AUDIT`
- `PUBLIC_MARKET_DATA_STATUS_AUDIT`
- `PUBLIC_MARKET_DATA_REFRESH_AUDIT`
- `SCANNER_START_BLOCKED_AUDIT`
- `SCANNER_MARKET_DATA_DEPENDENCY_AUDIT`
- `EXIT_PRICE_SOURCE_RECOVERY_AUDIT`
- `RUN_LIVE_CHECK_PUBLIC_DATA_AUDIT`
- `AI_TAKEOVER_EXECUTION_MODE_CLEANUP_AUDIT`
