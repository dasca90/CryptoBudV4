# CryptoBud V4 — Goal Plan & P0 Development Contract

## Scopul final

CryptoBud V4 trebuie să devină o aplicație de trading crypto unde fiecare trade este clar, stabil și verificabil de la scanare până la închidere:

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

Regula principală:

```text
Nu afișa date fake.
Nu folosi fallback legacy pentru poziții noi.
Nu repara vizual o problemă de date.
Repară cauza reală la sursă.
Fără regresii.
```

Acest document este contractul de lucru pentru orice coder care atinge CryptoBud V4.

---

# 1. P0 CRITICAL — F5 / refresh NU are voie să șteargă pozițiile

## Problemă actuală

După F5 / refresh app, au dispărut:

```text
Open Positions
Closed Positions
Journal data
ML/training data posibil
```

Asta este P0 critic.

## Regula corectă

F5 / renderer reload / browser refresh NU este reset.

F5 trebuie să facă doar:

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
run reset logic
overwrite persisted data with empty arrays
```

## Source of truth după F5

La boot / reload, app-ul trebuie să hidrateze din:

```text
PositionManager persisted open positions
Journal persisted closed trades
Demo account state
ML training data
Settings persistence
Critical backups
```

## Hard fail

Este bug P0 dacă după F5:

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

## Audituri necesare

```text
APP_RELOAD_DETECTED_AUDIT
PERSISTENCE_BOOT_START
PERSISTENCE_HYDRATION_START
PERSISTENCE_HYDRATION_COMPLETE
POSITION_PERSISTENCE_LOAD_AUDIT
POSITION_MANAGER_HYDRATED_AUDIT
JOURNAL_HYDRATION_AUDIT
F5_RELOAD_DATA_PROTECTION_AUDIT
EMPTY_STATE_WRITE_BLOCKED_DURING_HYDRATION
PERSISTENCE_EMPTY_OVERWRITE_PREVENTED
RESET_MARKER_AUDIT
```

Audit fields:

```text
reloadType
wasExplicitReset
hydrationStarted
hydrationComplete
openPositionsLoaded
closedTradesLoaded
journalTradesLoaded
mlRecordsLoaded
settingsLoaded
attemptedEmptyOverwrite
emptyOverwriteBlocked
sourceUsed
storageKey
backupKey
resetMarkerPresent
resetMarkerConsumed
```

## Root cause de găsit

Coderul trebuie să răspundă exact:

```text
1. Cine scrie open_positions=[] după F5?
2. Cine scrie closed_positions=[] după F5?
3. Există useEffect care salvează default empty state înainte de hydration?
4. PositionManager este creat gol și apoi persistat peste storage?
5. Journal load se face după un save empty?
6. Tauri/localStorage/IndexedDB folosesc chei diferite?
7. Reset marker este interpretat greșit ca reset normal?
8. Backup stale este restaurat sau șters greșit?
9. Settings hydration pornește după trading hydration?
```

## Reguli de protecție

```text
Nu salva state gol înainte de hydrationComplete=true.
Nu permite empty overwrite dacă storage avea poziții/trade-uri.
Nu executa reset logic fără user action explicit.
Nu trata F5 ca Full Demo Reset.
Nu șterge backup-urile la reload normal.
Nu reseta Journal la renderer mount.
```

## Tests necesare

```text
1. open positions survive F5/reload
2. closed positions survive F5/reload
3. journal survives F5/reload
4. ML data survives F5/reload
5. settings survive F5/reload
6. empty runtime state cannot overwrite persisted non-empty state before hydration
7. explicit Reset Trading clears only trading data
8. explicit Full Demo Reset clears demo/trading data
9. explicit Reset ML clears only ML data
10. F5 does not call reset-service
```

---

# 2. Canonical source of truth

Orice coder trebuie să știe sursa corectă pentru fiecare zonă.

| Zonă | Sursă canonică |
|---|---|
| Open Positions | PositionManager open positions |
| Closed Positions | Journal / closed trades canonical snapshot |
| TP1 / TP2 / SL | entryConfigSnapshot.riskParams |
| Strategy/setup at entry | entryConfigSnapshot.strategySnapshot |
| Owner/source | canonical trade source resolver |
| PnL open | entry price + live price + qty + fees |
| PnL closed | entry price + exit price + qty + fees |
| Telegram | same entry snapshot as PositionManager |
| ML training | finalized Journal trade snapshots |
| Settings | SettingsPersistence canonical payload |
| Capital Per Coin | canonical user trading settings snapshot |

Nu este permis:

```text
Open Positions din candidate state
TP1 din settings pentru scanner AUTO
TP2 din settings pentru scanner AUTO
Strategy din live scanner row după poziția deja deschisă
Owner afișat ca trader_brain
UNKNOWN/N/A pentru poziții noi
```

---

# 3. Trading ownership rules

## AutoBots / The Dipper / Scanner AUTO

Pentru orice trade creat de:

```text
executePlannedScannerBuy
executeScannerBuy
The Dipper AUTO
Scanner AUTO
AutoBots
```

trebuie:

```text
isAutoTargetOwned=true
isScannerAutoTrade=true
isManualOverride=false
```

Risk rules:

```text
TP1 = AutoTpCalculator dynamic per coin
TP1 > 0
TP1 target = entryPrice * (1 + tp1Pct / 100)

TP2 = 0 always
SL = user-defined
Dynamic trailing starts at TP1
Trail pullback = user-defined
```

Greșit pentru scanner AUTO:

```text
tp1Source=user
tp2Source=user
tp2Pct=5
resolverPath=unknown_non_auto
isAutoTargetOwned=false
```

Corect:

```text
tp1Source=AutoBots dynamic per coin / scanner_auto_dynamic
tp2Source=scanner_auto_enforced_zero
tp2Pct=0
slSource=user
```

## Manual Buy

Manual Buy poate folosi manual TP/SL doar când:

```text
source=Manual
ownerType=manual
isManualTrade=true
isManualOverride=true
```

---

# 4. Snapshot obligatoriu înainte de PositionManager.addPosition

Nicio poziție nouă scanner AUTO / The Dipper / AutoBots nu are voie să intre în PositionManager fără snapshot complet.

## 4.1 entryConfigSnapshot.riskParams

Obligatoriu:

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

Dacă lipsește:

```text
BUG_MISSING_RISK_SNAPSHOT_NEW_POSITION
POSITION_ENTRY_SNAPSHOT_INCOMPLETE_BLOCKED
```

Poziția nu trebuie adăugată în PositionManager.

## 4.2 entryConfigSnapshot.strategySnapshot

Obligatoriu:

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
selectedStrategy=UNKNOWN / N/A
finalEntryRule=UNKNOWN / N/A
finalExecutableAtEntry=UNKNOWN / N/A
entryConfirmedAtEntry=UNKNOWN / N/A
ownerDisplay=trader_brain
strategySnapshotPresent=false
```

Dacă aceste date lipsesc, se repară în:

```text
executePlannedScannerBuy
executeScannerBuy
TradingEngine
plannedTrade/candidate metadata handoff
buySnapshot builder
```

Nu în UI.

---

# 5. Capital Per Coin

Dacă user setează:

```text
Capital Per Coin = 200
```

scanner AUTO trebuie să folosească aproximativ 200 USDT pentru trade.

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

Fields:

```text
uiCapitalPerCoin
persistedCapitalPerCoin
resolvedCapitalPerCoin
finalOrderNotionalUsd
availableCapital
sourceUsed
adjustmentReason
```

---

# 6. Open Positions — final ca în V3

Default view trebuie să fie clar, compact și aproape identic cu V3.

Coloane în ordine:

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

## Ce NU trebuie afișat în default Open Positions

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

Acestea pot exista doar în:

```text
Detailed mode
Inspect drawer
Debug logs
```

## State corect

Pentru poziție deschisă:

```text
Running
Hold
Monitoring
Flat
```

Nu:

```text
WAITING_FOR_SETUP
WAITING
observed
candidate status
```

Open Positions citește strict din:

```text
PositionManager
position.entryConfigSnapshot
position.entryConfigSnapshot.riskParams
position.entryConfigSnapshot.strategySnapshot
```

---

# 7. Closed Positions — final ca în V3

Default view trebuie să fie clar și apropiat de V3.

Coloane în ordine:

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

## Exit Reason clar

Nu este suficient:

```text
TP1_FIXED
STOP_LOSS
```

Trebuie afișat user friendly:

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

Audit:

```text
CLOSED_POSITION_EXIT_REASON_DISPLAY_AUDIT
```

---

# 8. Color coding obligatoriu

## Open / Closed Positions

```text
Profit / TP hit / GOOD = green
Loss / Stop Loss / ERROR = red
Waiting / Neutral / Sideways = amber
Passive info = cyan/muted
```

## DP THE DIPPER card

```text
RUNNING / SCANNING / ACTIVE / OK / BULLISH = green
WAITING / SIDEWAYS / MIXED / NEUTRAL = amber
STOPPED / BLOCKED / BEARISH / ERROR = red
passive info = cyan/muted
```

---

# 9. DP THE DIPPER card

Cardul trebuie să citească live state, nu boot snapshot.

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

Dacă datele nu se actualizează:

```text
STALE DATA > 60s
```

Audituri:

```text
DIPPER_CARD_DATA_SOURCE_AUDIT
DIPPER_CARD_STALE_DATA_AUDIT
DIPPER_CARD_RENDER_AUDIT
```

---

# 10. Top Candidates

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

WHY trebuie să fie clar:

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
BUY_READY dar fără motiv de neexecuție
finalNoBuyReason=none când skipReason există
```

---

# 11. Telegram

Telegram trebuie să citească exact același snapshot ca PositionManager.

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
Used
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

# 12. Journal / Export / ML

Journal trebuie să păstreze snapshot complet.

Pentru fiecare trade:

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

ML trebuie să folosească doar date curate.

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

# 13. Reset / Persistence

## Reset Trading

Curăță doar trading data:

```text
open positions
closed positions
journal trades
paper/demo orders
runtime trade state
position manager state
backup stale data
```

## Full Demo Reset

Curăță:

```text
trading state
demo account state
open/closed positions
journal trades
stale backups
```

## Reset ML

Curăță:

```text
ML training data
ML memory/cache
ML journal export data dacă este separat
```

După reset explicit nu trebuie să reapară date din backup.

După F5 normal nu trebuie șters nimic.

---

# 14. Audituri obligatorii pe trade lifecycle

Pentru fiecare trade nou:

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

# 15. Hard fail rules

Tratăm ca P0:

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

# 16. Test strategy

Testele trebuie să acopere runtime-ul real, nu obiecte construite manual.

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
→ reload/F5 hydration check
```

Nu sunt suficiente:

```text
test care creează manual snapshotul
test care verifică doar audit stringuri
test care nu trece prin TradingEngine real
test care nu verifică UI row rendered value
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

# 17. Manual runtime proof

Pentru fiecare fix P0, testele nu sunt suficiente.

Runtime proof:

```text
1. Restart app complet.
2. Clear demo/paper state doar dacă testăm reset explicit.
3. Start scanner.
4. Așteaptă BUY real demo.
5. Export logs.
6. Verifică același symbol în:
   - ENTRY_RISK_PARAMS_RESOLVED
   - POSITION_MANAGER_ADD_SNAPSHOT_READY_AUDIT
   - OPEN_POSITION_RENDER_ROW_AUDIT
   - TELEGRAM_BUY_OPENED_RISK_SNAPSHOT_AUDIT
   - CLOSED_POSITION_RISK_SNAPSHOT_AUDIT
7. Apasă F5.
8. Verifică pozițiile/open/closed/journal sunt încă acolo.
```

Definition of Done pe UI:

```text
Screenshot cu poziție nouă:
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

# 18. Anti-regression contract

Orice task pentru coder trebuie să respecte:

```text
Nu patch superficial.
Nu ascunde problema în UI/CSS.
Nu inventa fallback data.
Nu schimba trading logic fără motiv documentat.
Nu modifica scanner scoring fără cerere explicită.
Nu strica TP2=0 pentru AutoBots.
Nu strica SL user-defined.
Nu strica manual buy.
Nu strica persistence/reset.
Nu strica F5 hydration.
Adaugă teste de regresie.
Documentează root cause.
Dovedește cu runtime logs când este P0.
```

---

# 19. Priorități actuale P0

## P0.1 — F5 persistence protection

Reparat doar când:

```text
Open Positions survive F5
Closed Positions survive F5
Journal survives F5
ML survives F5
No empty overwrite before hydration
```

## P0.2 — Real scanner AUTO ownership

Reparat doar când runtime BUY arată:

```text
isAutoTargetOwned=true
isScannerAutoTrade=true
isManualOverride=false
tp1Source=AutoBots dynamic per coin / scanner_auto_dynamic
tp2Pct=0
slPct=user
```

## P0.3 — Complete entry snapshot

Reparat doar când poziția nouă are:

```text
riskSnapshotPresent=true
strategySnapshotPresent=true
selectedStrategy != UNKNOWN/N/A
finalEntryRule != UNKNOWN/N/A
ownerDisplay != trader_brain
```

## P0.4 — V3-like Open/Closed Positions

Reparat doar când default UI are coloanele V3 și citește din snapshot canonic.

## P0.5 — Telegram / Journal / ML parity

Reparat doar când toate arată aceleași valori ca entry snapshot.

## P0.6 — Capital Per Coin

Reparat doar când scanner AUTO respectă valoarea userului, ex. 200 USDT.

---

# 20. Goal final

Aplicația trebuie să ajungă aici:

```text
Când un coin este cumpărat, putem deschide Open Positions, Telegram, Journal, Logs și Closed Positions și toate spun aceeași poveste.
```

Aceeași:

```text
strategie
setup
entry rule
TP1
TP2
SL
capital
owner
source
entry price
exit reason
PnL
```

Dacă aceste surse nu se potrivesc, appul nu este terminat.

---

# 21. Definition of Done global

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
15. Nu există TP1=0.00 pentru poziții noi Auto.
16. Nu există TP2!=0 pentru AutoBots / The Dipper AUTO.
17. Runtime logs dovedesc flow-ul real.
```

---

# 22. Mesaj pentru orice coder nou

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
