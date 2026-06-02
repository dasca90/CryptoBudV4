# Scanner Universe Filter Flow

## BINANCE_TOP_250
- Universe mode `BINANCE_TOP_250` fetches Binance public `exchangeInfo` and `24hr` tickers.
- Candidate symbols are USDT-quoted pairs sorted by `quoteVolume` descending.
- Dynamic scanner ban filtering is applied before final selection.
- Final universe is top 250 filtered symbols (or fewer if less are valid).

## Dynamic Ban Categories
- Stablecoin pair base assets are banned.
- Fiat pair base assets are banned.
- Metal/commodity proxy base assets are banned.
- Wrapped/pegged BTC variants are banned.
- Wrapped/pegged ETH variants are banned.
- Synthetic or leveraged style symbols (UP/DOWN patterns) are banned.
- Non-USDT quote symbols are banned.
- Non-spot tradable symbols are banned.
- Symbols not in TRADING status are banned.
- Symbols missing Binance filters are banned.
- Manual scanner banlist symbols are banned.

## Manual Banlist
- Settings/config include `manualScannerBanlist: string[]`.
- Filter applies manual banlist after normal symbol metadata checks.

## Diagnostics Counters
- Scanner diagnostics include:
  - universe before/after filter counts
  - banned stablecoin/fiat/metal/wrapped BTC/wrapped ETH/non-tradable/manual counts
  - top ban reasons summary

## BTCUSDT and ETHUSDT
- `BTCUSDT` and `ETHUSDT` remain valid and are not banned.
- Only wrapped/pegged variants (for example `WBTCUSDT`, `WETHUSDT`, `WBETHUSDT`) are filtered out.
