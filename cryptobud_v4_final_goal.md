# CryptoBud V4 — Scopul Final al Aplicației

**Document pentru toți coderii / agenții care lucrează pe proiect**  
**Versiune:** 1.0  
**Data:** 2026-06-02

---

## 1. Scopul final

CryptoBud V4 trebuie să fie o aplicație de trading crypto stabilă, clară și complet auditată, unde fiecare trade poate fi urmărit de la scanare până la închidere.

Flow-ul final dorit:

```text
Scanner / The Dipper / AutoBots
→ EntryGate
→ ExecutionPlanner
→ TradingEngine
→ PositionManager
→ Open Positions
→ Exit Engine
→ Closed Positions
→ Journal / ML / Telegram / Export
```

Când un coin este cumpărat, toate zonele aplicației trebuie să spună aceeași poveste:

```text
strategie
setup
entry rule
TP1
TP2
SL
capital
owner/source
entry price
exit reason
PnL
snapshot
```

Dacă Open Positions, Closed Positions, Telegram, Journal și Logs nu arată aceleași valori, aplicația nu este terminată.

---

## 2. Principiul principal

Orice coder trebuie să respecte:

```text
Nu patch superficial.
Nu ascunde buguri în UI/CSS.
Nu inventa date fake.
Nu folosi fallback legacy pentru poziții noi.
Nu citi poziții deschise din candidate state.
Repară cauza reală la sursă.
Adaugă teste de regresie.
Dovedește cu logs runtime când bugul este P0.
```

---

## 3. Source of Truth

| Zonă | Sursă canonică |
|---|---|
| Open Positions | PositionManager |
| Closed Positions | Journal / closed trade snapshot |
| TP1 / TP2 / SL | `entryConfigSnapshot.riskParams` |
| Strategie la entry | `entryConfigSnapshot.strategySnapshot` |
| Owner / Source | canonical trade source resolver |
| Telegram | același entry snapshot ca PositionManager |
| Journal / Export | snapshot complet de entry + exit |
| ML Training | doar trade-uri curate din Journal |
| Settings | SettingsPersistence |
| Capital Per Coin | user trading settings snapshot |

Nu este permis pentru poziții noi:

```text
TP1=0.00
TP2!=0 pentru AutoBots / The Dipper AUTO
sourceTp1=user pentru scanner AUTO
sourceTp2=user pentru scanner AUTO
selectedStrategy=UNKNOWN/N/A
finalEntryRule=UNKNOWN/N/A
ownerDisplay=trader_brain
Legacy/Unknown
WAITING/observed în Open Positions default
```

---

## 4. Reguli AutoBots / The Dipper / Scanner AUTO

Orice trade venit din:

```text
executePlannedScannerBuy
executeScannerBuy
The Dipper AUTO
Scanner AUTO
AutoBots
```

trebuie tratat ca:

```text
isAutoTargetOwned=true
isScannerAutoTrade=true
isManualOverride=false
```

Reguli risk:

```text
TP1 = dynamic per coin, calculat de AutoTpCalculator
TP1 > 0
TP1 target = entryPrice * (1 + tp1Pct / 100)

TP2 = 0 întotdeauna
SL = user-defined
Dynamic trailing, dacă este ON, începe la TP1
Trail pullback = user-defined
```

Greșit:

```text
resolverPath=unknown_non_auto
isAutoTargetOwned=false
tp1Source=user
tp2Source=user
tp2Pct=5
```

Corect:

```text
isAutoTargetOwned=true
isScannerAutoTrade=true
tp1Source=AutoBots dynamic per coin / scanner_auto_dynamic
tp2Pct=0
tp2Source=scanner_auto_enforced_zero
slSource=user
```

---

## 5. Manual Buy

Manual Buy este separat.

Manual Buy poate folosi TP/SL manuale doar când:

```text
source=Manual
ownerType=manual
isManualTrade=true
isManualOverride=true
```

Manual Buy nu trebuie confundat cu The Dipper AUTO sau Scanner AUTO.

---

## 6. Snapshot obligatoriu înainte de PositionManager.addPosition

Nicio poziție nouă AUTO nu trebuie să intre în PositionManager fără snapshot complet.

### 6.1 Risk snapshot obligatoriu

```text
riskSnapshotPresent=true
tp1Pct > 0
tp1TargetPrice > entryPrice
tp1Source=AutoBots dynamic per coin / scanner_auto_dynamic
tp2Pct=0
tp2Source=scanner_auto_enforced_zero
slPct=user-defined
slSource=user
capitalPerCoinSnapshotPresent=true
```

Dacă lipsește, poziția trebuie blocată înainte de `PositionManager.addPosition`.

### 6.2 Strategy snapshot obligatoriu

```text
strategySnapshotPresent=true
ownerType
ownerName
ownerDisplay
source
mode
strategy
selectedStrategy
strategySource
marketRecommendedStrategy
runtimeActiveStrategy
finalPerCoinStrategy
finalEntryRule
entryRule
setupResult
finalExecutableAtEntry
entryConfirmedAtEntry
primaryBlocker / why
confidence
score
riskGroup
trendAtEntry
refPriceAtEntry
dipAtEntry
reboundAtEntry
momentumAtEntry
spreadAtEntry
```

Nu este acceptat pentru poziții noi:

```text
strategySnapshotPresent=false
selectedStrategy=UNKNOWN/N/A
finalEntryRule=UNKNOWN/N/A
finalExecutableAtEntry=UNKNOWN/N/A
entryConfirmedAtEntry=UNKNOWN/N/A
ownerDisplay=trader_brain
```

---

## 7. Open Positions — target final ca în V3

Open Positions default trebuie să fie curat, compact și asemănător cu V3.

Coloane default:

```text
Symbol
State
Strategy
Qty
Entry Value
Entry
Ref
Last
Dip
Trend
PnL %
Unrealized
TP1 (%)
TP2 (%)
Stop (%)
Stop Trigger
Decision
Owner
Opened At
Hold
```

Nu se afișează în default:

```text
MOM
Setup Result
WHY
Rebound/Req
Dip/Req
observed / required
WAITING setup state
UNKNOWN/N/A debug fields
raw candidate state
```

Acestea pot exista doar în Detailed / Inspect / Debug.

Open Positions citește doar din:

```text
PositionManager
position.entryConfigSnapshot.riskParams
position.entryConfigSnapshot.strategySnapshot
```

---

## 8. Closed Positions — target final ca în V3

Coloane default:

```text
Symbol
Owner
Strategy
Mode
Qty
Entry Value
Entry Price
Exit Price
Exit Value
Realized PnL %
Realized PnL $
Gross Result
Opened At
Closed At
Hold
Exit Reason
Ref@Entry
Dip@Entry
Rebound@Entry
Trend@Entry
Notes
```

Exit Reason trebuie să fie clar:

```text
TP1 Hit (+2.70%)
Stop Loss (-1.50%)
Trailing Stop (+1.40% / pullback 0.25%)
Manual Close
Emergency Close
```

Important:

```text
Exit Reason = trigger-ul planificat
Realized PnL = rezultatul real după fill/slippage/fee
```

---

## 9. F5 / Refresh / Persistence — P0 critic

F5 / refresh NU este reset.

F5 trebuie să facă:

```text
reload UI
hydrate runtime state from persistence
rebuild UI from canonical storage
```

F5 NU trebuie să facă:

```text
clear open positions
clear closed positions
clear journal
clear ML data
clear demo account
clear backups
overwrite persisted data with empty arrays
```

Hard fail:

```text
openPositionsBeforeReload > 0
openPositionsAfterReload = 0
```

sau:

```text
closedPositionsBeforeReload > 0
closedPositionsAfterReload = 0
```

fără reset explicit cerut de user.

Audituri necesare:

```text
APP_RELOAD_DETECTED_AUDIT
PERSISTENCE_BOOT_START
PERSISTENCE_HYDRATION_START
PERSISTENCE_HYDRATION_COMPLETE
POSITION_PERSISTENCE_LOAD_AUDIT
POSITION_MANAGER_HYDRATED_AUDIT
JOURNAL_HYDRATION_AUDIT
EMPTY_STATE_WRITE_BLOCKED_DURING_HYDRATION
PERSISTENCE_EMPTY_OVERWRITE_PREVENTED
RESET_MARKER_AUDIT
```

---

## 10. Reset behavior

### Reset Trading

Șterge:

```text
open positions
closed positions
journal trades
paper/demo orders
runtime trade state
position manager state
backup stale data
```

### Full Demo Reset

Șterge:

```text
trading state
demo account state
open/closed positions
journal trades
stale backups
```

### Reset ML

Șterge:

```text
ML training data
ML memory/cache
ML journal export data dacă este separat
```

Resetul trebuie să fie explicit, nu declanșat de F5.

---

## 11. Capital Per Coin

Dacă user setează:

```text
Capital Per Coin = 200
```

trade-ul AUTO trebuie să intre cu aproximativ 200 USDT.

Acceptăm diferențe doar dacă există motiv logat:

```text
capital insuficient
exchange minNotional / stepSize
max position cap
risk cap explicit
```

Nu este acceptat:

```text
UI arată 200
runtime folosește userCapitalPerCoin=0
finalOrderNotionalUsd=87.66 fără motiv
```

Audituri:

```text
CAPITAL_PER_COIN_SETTINGS_SOURCE_AUDIT
CAPITAL_PER_COIN_ENTRY_AUDIT
CAPITAL_PER_COIN_POSITION_CREATED_AUDIT
```

---

## 12. Top Candidates

Default compact columns:

```text
Symbol
Trend
Strategy
Conf
Dip
Reb
Mom
Status
WHY
```

WHY trebuie să fie canonic:

```text
WAITING_FOR_DIP
WAITING_FOR_REBOUND
SPREAD_TOO_HIGH
TP_ROOM_MISSING
PRICE_NOT_FRESH
MAX_POSITIONS_REACHED
TP1_INVALID
CANDLE_EXHAUSTION
OVEREXTENDED
ENTRY_GATE_BLOCKED
EXECUTION_NOT_TRIGGERED
BUY_READY
```

Nu este acceptat:

```text
BUY_READY fără motiv
finalNoBuyReason=none când skipReason există
```

---

## 13. DP THE DIPPER Card

Cardul citește live state, nu boot snapshot.

Trebuie să arate:

```text
Last Scan: HH:MM:SS · Xs ago
Scanner Status
Reference Period
Candidates
Engine Review
Open Positions
Closed Today
Market Trend
BTC Context
ETH Context
Volatility
Period Change
Capital Used
Available
```

Color coding:

```text
RUNNING / SCANNING / ACTIVE / OK / BULLISH = green
WAITING / SIDEWAYS / MIXED / NEUTRAL = amber
STOPPED / BLOCKED / BEARISH / ERROR = red
passive info = cyan/muted
```

Dacă datele îngheață:

```text
STALE DATA > 60s
```

---

## 14. Telegram

Telegram citește din același entry snapshot ca PositionManager.

BUY OPENED trebuie să includă:

```text
Symbol
Mode: Demo / Live
Source: AutoBots / The Dipper / Scanner
Strategy
Entry rule
Why
Setup
Dip actual / required
Rebound actual / required
Momentum
Confidence
Risk
Entry price
Qty
Used capital
TP1 %
TP1 target
TP1 source
TP2 = 0 / disabled pentru AutoBots
SL user-defined
Status
```

Nu este acceptat:

```text
TP1: 0.00%
TP2: 5% pentru AutoBots / The Dipper AUTO
Source: unknown
Owner: trader_brain
```

---

## 15. Journal / Export / ML

Journal trebuie să păstreze:

```text
entryRiskSnapshot
entryStrategySnapshot
exitSnapshot
realizedPnl
fees
priceQuality
closeReason
trainingEligibility
```

ML folosește doar trade-uri curate.

Dacă datele sunt incomplete:

```text
trainingEligible=false
reason=snapshot_missing / price_missing / invalid_execution
```

Nu folosi pentru ML trade-uri cu:

```text
TP1 missing
strategy unknown
entry reason missing
exit reason missing
fake fallback price
```

---

## 16. Audituri obligatorii pe trade lifecycle

Pentru fiecare trade nou trebuie să putem urmări:

```text
AUTO_TARGET_OWNERSHIP_RESOLVED
ENTRY_RISK_PARAMS_RESOLVED
POSITION_ENTRY_SNAPSHOT_BUILD_AUDIT
POSITION_ENTRY_SNAPSHOT_SAVED
POSITION_RISK_SNAPSHOT_SAVED
POSITION_MANAGER_ADD_SNAPSHOT_READY_AUDIT
POSITION_MANAGER_ADD
POSITION_MANAGER_ADD_RESULT_AUDIT
OPEN_POSITION_RENDER_ROW_AUDIT
TELEGRAM_BUY_OPENED_RISK_SNAPSHOT_AUDIT
CLOSED_POSITION_RISK_SNAPSHOT_AUDIT
JOURNAL_ENTRY_SNAPSHOT_AUDIT
```

Pentru scanner AUTO corect:

```text
isAutoTargetOwned=true
isScannerAutoTrade=true
isManualOverride=false
tp1Pct > 0
tp1Source=AutoBots dynamic per coin / scanner_auto_dynamic
tp2Pct=0
slPct=user
strategySnapshotPresent=true
riskSnapshotPresent=true
```

---

## 17. Hard Fail Rules

Oricare din acestea este P0:

```text
F5 șterge open positions
F5 șterge closed positions
F5 șterge journal/ML fără reset explicit
Scanner AUTO cu TP2 != 0
Scanner AUTO cu tp1Source=user
Scanner AUTO cu tp2Source=user
Scanner AUTO cu isAutoTargetOwned=false
Scanner AUTO cu resolverPath=unknown_non_auto
New position cu riskSnapshotPresent=false
New position cu strategySnapshotPresent=false
New position cu ownerDisplay=trader_brain
New position cu selectedStrategy UNKNOWN/N/A
Open Position citește TP din candidate state
Open Position afișează TP1=0.00 fără warning
Telegram BUY cu TP1=0.00
Closed Position fără entry snapshot
Journal/export pierde snapshotul
Capital Per Coin ignorat
```

---

## 18. Test Strategy

Testele trebuie să treacă prin runtime real, nu doar snapshot construit manual.

Obligatoriu:

```text
AutoBots/The Dipper candidate real
→ ExecutionPlanner
→ TradingEngine.executePlannedScannerBuy
→ PositionManager
→ Open Positions row
→ Telegram BUY OPENED
→ Close position
→ Closed Positions row
→ Journal/export
→ F5/reload hydration check
```

Nu sunt suficiente:

```text
test care creează manual snapshotul
test care verifică doar audit strings
test care nu trece prin TradingEngine real
test care nu verifică UI rendered row value
test care nu simulează F5/reload
```

Teste necesare:

```text
open-positions-ui.test.ts
closed-positions-ui.test.ts
tp1-safety-guards.test.ts
tp1-visibility-audit.test.ts
telegram-buy-opened-risk-snapshot.test.ts
execution-planner.test.ts
settings.test.ts
persistence.test.ts
reset-service.test.ts
f5-reload-persistence.test.ts
```

---

## 19. Runtime Proof

Pentru fiecare fix P0, testele nu sunt suficiente.

Proof manual:

```text
1. Restart app complet.
2. Start scanner.
3. Așteaptă BUY demo real.
4. Export logs.
5. Verifică același symbol în:
   - ENTRY_RISK_PARAMS_RESOLVED
   - POSITION_MANAGER_ADD_SNAPSHOT_READY_AUDIT
   - OPEN_POSITION_RENDER_ROW_AUDIT
   - TELEGRAM_BUY_OPENED_RISK_SNAPSHOT_AUDIT
   - CLOSED_POSITION_RISK_SNAPSHOT_AUDIT
6. Apasă F5.
7. Verifică pozițiile/open/closed/journal sunt încă acolo.
```

Definition of Done pe UI:

```text
TP1 > 0
TP2 = 0
SL = user-defined
Owner corect
Strategy corect
Capital Per Coin respectat
fără UNKNOWN/N/A
fără Legacy/Unknown
fără WAITING/observed în default Open Positions
după F5 datele rămân
```

---

## 20. Priorități P0 curente

### P0.1 — F5 persistence protection

```text
Open Positions survive F5
Closed Positions survive F5
Journal survives F5
ML survives F5
No empty overwrite before hydration
```

### P0.2 — Real scanner AUTO ownership

```text
isAutoTargetOwned=true
isScannerAutoTrade=true
isManualOverride=false
tp1Source=AutoBots dynamic per coin / scanner_auto_dynamic
tp2Pct=0
slPct=user
```

### P0.3 — Complete entry snapshot

```text
riskSnapshotPresent=true
strategySnapshotPresent=true
selectedStrategy != UNKNOWN/N/A
finalEntryRule != UNKNOWN/N/A
ownerDisplay != trader_brain
```

### P0.4 — V3-like Open/Closed Positions

Default UI are coloanele V3 și citește din snapshot canonic.

### P0.5 — Telegram / Journal / ML parity

Toate arată aceleași valori ca entry snapshot.

### P0.6 — Capital Per Coin

Scanner AUTO respectă valoarea userului, ex. 200 USDT.

---

## 21. Definition of Done Global

CryptoBud V4 este stabil pe trading lifecycle doar când:

```text
1. F5 nu șterge open/closed/journal/ML.
2. The Dipper / AutoBots cumpără cu TP1 dinamic per coin.
3. TP2 este 0 pentru AutoBots / The Dipper AUTO.
4. SL este user-defined.
5. Capital Per Coin este respectat.
6. Open Positions arată ca V3 și citește din PositionManager.
7. Closed Positions arată ca V3 și păstrează snapshotul de entry.
8. Telegram arată aceleași valori ca snapshotul.
9. Journal/export păstrează snapshoturile.
10. ML folosește doar date curate.
11. Reset șterge complet datele promise.
12. Nu există UNKNOWN/N/A pentru poziții noi.
13. Nu există Legacy/Unknown pentru poziții noi.
14. Nu există trader_brain ca owner afișat userului.
15. Nu există TP1=0.00 pentru poziții noi AUTO.
16. Nu există TP2!=0 pentru AutoBots / The Dipper AUTO.
17. Runtime logs dovedesc flow-ul real.
```

---

## 22. Mesaj pentru coderi

Înainte să modifici ceva:

```text
1. Citește acest document.
2. Identifică sursa canonică.
3. Reproduce bugul.
4. Verifică logs.
5. Repară cauza reală.
6. Adaugă test.
7. Rulează build.
8. Dovedește că nu ai creat regresii.
```

Nu lucra doar pe UI dacă bugul este în:

```text
TradingEngine
PositionManager
Snapshot builder
Persistence
Hydration
Journal
Reset service
Settings persistence
```
