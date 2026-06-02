# CryptoBud V3 UI Style Guide

## 1. Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-primary` | `#0d1117` | Main background, inputs |
| `--bg-secondary` | `#161b22` | Panel/card surface |
| `--bg-tertiary` | `#21262d` | Hover states, active rows |
| `--text-primary` | `#c9d1d9` | Body text |
| `--text-secondary` | `#8b949e` | Secondary/muted text |
| `--border` | `#30363d` | Default borders |
| `--accent-primary` | `#58a6ff` | Blue accent, links, active tabs |
| `--accent-success` | `#3fb950` | Green — BUY, RUNNING, positive PnL |
| `--accent-danger` | `#f85149` | Red — BLOCK, STOP, negative PnL |
| `--accent-warning` | `#d29922` | Yellow/Orange — WAIT, PAPER mode |
| `--glow` | `rgba(88,166,255,0.4)` | General blue glow |

## 2. Background Style

- **Body**: `#050816` (deep navy base)
- **App shell**: Layered radial/linear gradient:
  ```
  radial-gradient(circle at 15% 20%, rgba(0,255,255,0.06), transparent 28%),
  radial-gradient(circle at 82% 12%, rgba(170,80,255,0.06), transparent 32%),
  radial-gradient(circle at 50% 85%, rgba(0,255,140,0.05), transparent 34%),
  linear-gradient(135deg, #071019 0%, #0a1120 45%, #120c22 100%)
  ```
- **Page surface**: Semi-transparent gradient overlay
- **Sidebar**: Darker gradient variant
- **Header**: Horizontal gradient `rgba(8,17,30,0.95) → rgba(14,14,33,0.9) → rgba(18,12,34,0.88)`

## 3. Card / Panel Style

- **Background**: `#161b22` (panel surface)
- **Border**: `1px solid var(--panel-border)` — blue-tinted `rgba(88,166,255,0.18)`
- **Border radius**: `8px` standard, `6px` for small cards, `12px` for charts
- **Shadow**: `0 0 12px var(--panel-glow)` — `rgba(88,166,255,0.06)`
- **Strong variant**: `box-shadow: 0 0 16px var(--panel-glow-strong)` — `rgba(88,166,255,0.14)`
- **Inner spacing**: `padding: 12px` (panels), `margin-bottom: 12px` (sections)
- **Chart surface**: `inset 0 0 0 1px var(--panel-border), 0 0 14px var(--panel-glow)`
- **Layout**: All panels stack/side-by-side with `6px` gap

## 4. Glow / Neon Effects

- **Pulse glow animation**: `2s infinite` — box-shadow oscillates between `10px` and `20px+30px`
- **Rainbow glow**: `3s infinite` — cycles through red/yellow/green/blue/purple
- **Running status glow**: Green `box-shadow: 0 0 10px rgba(63,185,80,0.18)`
- **Waiting status glow**: Orange `box-shadow: 0 0 10px rgba(240,136,62,0.18)`
- **Loss status glow**: Red `box-shadow: 0 0 10px rgba(248,81,73,0.2)`
- **Button glow**: Neutral/buy/sell variants with `rgba` shadows
- **Title glow**: `text-shadow: 0 0 6px var(--title-glow)`
- **Performance mode**: Disables all glow, pulse, and animation effects

## 5. Badges (StatusBadge)

- **Style**: `inline-flex` with dot + label
- **Dot**: `8px` circle filled with status color
- **Background**: `color + 20` alpha tint (e.g. `#3fb95020`)
- **Border**: `1px solid color + 40` alpha
- **Text**: Capitalized, same color as dot
- **Border radius**: `999px` (pill shape)
- **Padding**: `2px 8px`
- **Glow**: Optional class for extra visibility

## 6. Scanner / Candidate Table Style

- **Font**: `monospace`, `11px`
- **Grid layout**: Multi-column with `gap: 4px`
- **Rows**: `padding: 3px 4px`, `border-bottom: 1px solid #21262d`
- **Header**: Uppercase, `#8b949e`, `9px`, `font-weight: 600`
- **Selected row**: Blue tint background `#1f6feb11`, blue border
- **Hover**: `#1c2128` background
- **Status badges**: Inline inside cells (BUY=green, WAIT=yellow, BLOCK=red, AVOID=gray)

## 7. Log Panel Style

- **Font**: `'Consolas', 'Courier New', monospace`, `11px`
- **Line height**: `1.5`
- **Entry**: `padding: 2px 4px`, `border-bottom: 1px solid #21262d`
- **Flex layout**: `gap: 8px` between time, level, message
- **Time**: `#484f58` (gray)
- **Level colors**: INFO=blue `#58a6ff`, WARN=yellow `#d29922`, ERROR=red `#f85149`, TRADE=green `#3fb950`
- **Level**: `font-weight: 600`, fixed width `40px`

## 8. Chart Card Style

- **Container**: `border-radius: 12px` with chart-surface effect
- **Background**: `linear-gradient(180deg, rgba(8,18,32,0.92), rgba(6,14,26,0.88))`
- **Border**: `inset` panel-border
- **Shadow**: Outer panel glow
- **Empty state**: Clean placeholder with muted text
- **SVG charts**: Polyline with `strokeWidth: 1.5`, `round` linecap/linejoin

## 9. Button Style

- **Base**: `#21262d` background, `#30363d` border, `6px` radius
- **Padding**: `4px 12px` (default), `2px 8px` (sm)
- **Font**: `12px` (default), `11px` (sm), `font-family: inherit`
- **Green (START/BUY)**: `#238636` bg, `#2ea043` border, white text — glow on hover
- **Red (STOP/SELL)**: `#da3633` bg, `#f85149` border, white text — glow on hover
- **Yellow (LIVE CHECK)**: `#9e6a03` bg, `#d29922` border, white text
- **Outline**: Transparent bg, `#30363d` border
- **Disabled**: `opacity: 0.4`, `cursor: not-allowed`
- **Hover**: Slightly lighter shade
- **Active**: `transform: scale(0.98)`
- **Focus-visible**: `box-shadow` with focus glow

## 10. Selected Coin Panel Style

- **Header**: Flex row with coin symbol (large monospace) and mode badge
- **Symbol**: `16px`, `font-weight: 700`, `font-family: monospace`
- **Decision detail**: Compact rows with label (left, uppercase, muted) and value (right)
- **Border between rows**: `1px solid #21262d`
- **Position indicator**: Green/red PnL text with monospace font

## 11. Micro Scalper Radar Style

- **Radar card**: `box-shadow: inset 0 0 0 1px rgba(0,200,150,0.08), inset 0 0 28px rgba(10,180,140,0.12)`
- **Background**: Radial green glow with linear gradient overlay
- **Grid lines**: Repeating linear gradients at 45° and 90°
- **Center dot**: Pulsing green radial gradient
- **Rings**: Repeating radial gradient pulse
- **Side pulses**: Left/right animated sweep
- **Rocket animations**: Profit (green up), Loss (red crash), Flat (yellow)
- **Freshness badges**: LIVE (green), STALE (yellow), DEAD (red)

## 12. Status Colors Reference

| Item | Color |
|------|-------|
| BUY / RUNNING / POSITIVE | `#3fb950` (green) |
| BLOCK / STOP / NEGATIVE | `#f85149` (red) |
| WAIT / PAPER / WARN | `#d29922` (yellow/orange) |
| AVOID / DISABLED | `#8b949e` (gray) |
| ACTIVE / SELECTED | `#58a6ff` (blue) |
| NEUTRAL / MUTED | `#8b949e` (gray) |

## 13. Spacing / Radius / Shadow Rules

- **Panel radius**: `8px` (standard)
- **Small card radius**: `6px`
- **Chart radius**: `12px`
- **Badge radius**: `999px` (pill)
- **Input/select radius**: `4px`
- **Panel gap**: `6px` (grid/flex spacing)
- **Panel padding**: `12px`
- **Section margin**: `12px` bottom
- **Panel shadow**: `0 0 12px rgba(88,166,255,0.06)`
- **Chart shadow**: `0 0 14px rgba(88,166,255,0.06)`
- **Focus shadow**: `0 0 8px rgba(88,166,255,0.18)`
- **Scrollbar**: `8px` wide, blue-tinted `rgba(88,166,255,0.28)` thumb
