# CryptoBud V4 — V3 Strategy Parity Goal

**Document pentru DeepSeek / Codex / orice coder care lucrează pe CryptoBud V4**  
**Scop:** V4 trebuie să folosească aceeași logică de strategie și piață ca V3, dar fără să strice regression lock-ul deja verificat în V4.  
**Data:** 2026-06-02

---

## 0. Context

Acest document transformă auditul V3 într-un **goal/contract clar pentru V4**.

V3 avea o separare mai clară între:

```text
dip_and_rebound = intrare după dip + rebound
conservative = intrare strictă după dip + rebound, folosită în market slab/risk-off
balanced = momentum/uptrend entry, fără dip obligatoriu
momentum = breakout/uptrend puternic, fără dip obligatoriu
wait = stare finală, nu strategie reală
```

În V4 vrem aceeași logică de strategie/market ca V3.

---

# 1. Reguli care NU se schimbă în V4

Înainte să modifici strategii, respectă regression lock-ul actual.

Nu modifica și nu slăbi:

```text
TP1 = dynamic per coin pentru Scanner AUTO / The Dipper / AutoBots
TP2 = 0 pentru Scanner AUTO / The Dipper / AutoBots
SL = user-defined
riskSnapshotPresent=true înainte de PositionManager.addPosition
strategySnapshotPresent=true înainte de PositionManager.addPosition
Open Positions citește din PositionManager + entryConfigSnapshot
Closed Positions citește din Journal / closed trade snapshot
Telegram citește din același canonical snapshot
F5 / refresh nu șterge open/closed/journal/ML
Manual Buy rămâne separat
```

Nu schimba pipeline-ul critic:

```text
TradingEngine
PositionManager
entryConfigSnapshot.riskParams
entryConfigSnapshot.strategySnapshot
Persistence / hydration
Telegram/Open/Closed canonical binding
```

Orice schimbare trebuie să treacă regression suites:

```bash
npx.cmd tsx src/__tests__/tp1-safety-guards.test.ts
npx.cmd tsx src/__tests__/telegram-buy-opened-risk-snapshot.test.ts
npx.cmd tsx src/__tests__/open-positions-ui.test.ts
npx.cmd tsx src/__tests__/closed-positions-ui.test.ts
npx.cmd tsx src/__tests__/execution-planner.test.ts
npx.cmd tsx src/__tests__/f5-reload-persistence.test.ts
npm.cmd run build
```

---

# 2. Goal final

V4 trebuie să aleagă strategia ca V3:

```text
Market bullish/uptrend + momentum bun
→ balanced sau momentum

Market range/sideways
→ dip_and_rebound / grid-like / balanced dacă are momentum

Market bearish/risk_off
→ conservative / wait
→ balanced și momentum pot fi downgrade dacă nu există confirmare strictă

Dip clar + rebound confirmat
→ dip_and_rebound

Dip mare + rebound strict + safety overlay
→ conservative

Breakout/uptrend puternic
→ momentum
```

---

# 3. Strategiile V3 care trebuie replicate în V4

---

## 3.1 dip_and_rebound

### Familie

```text
dip_and_rebound
```

### Ce face

Cumpără după un dip detectat și rebound confirmat.

### Condiții de intrare

```text
dipPercent >= dipThreshold
AND
reboundPercent >= reboundThreshold
```

### Required fields

```text
dipConfirmed=true
reboundConfirmed=true
spreadOk=true
tpRoomOk=true
priceFresh=true
fallingKnifeBlocked=false
overextended=false
```

### Advisory fields

```text
momentumConfirmed
volumeRelative
confidence
group trend
```

### Când cumpără

```text
Dip + rebound sunt ambele confirmate.
Nu există hard blockers.
```

### Când așteaptă

```text
dipConfirmed=false → WAITING_FOR_DIP
reboundConfirmed=false → WAITING_FOR_REBOUND
```

### Hard blockers

```text
stale_price
no_tp_room
overextended
falling_knife
spread_slippage_too_high
price_not_fresh
```

### Piață potrivită

```text
Uptrend cu pullback
Range cu dip + rebound
Piață cu volatilitate sănătoasă
```

### Piață nepotrivită

```text
Downtrend profund
Falling knife
Spread mare
Book stale
```

---

## 3.2 conservative

### Familie

```text
strict dip_and_rebound
```

### Ce face

Cea mai sigură strategie. Cere dip + rebound mai stricte și blochează condițiile slabe.

### Condiții V3

```text
dipPercent >= max(threshold, 1.2)
AND
reboundPercent >= max(threshold, 0.8)
AND
marketState !== downtrend
```

### Condiții V4 dinamice permise

V4 poate păstra pragurile dinamice discutate:

```text
MARKET BULLISH / SELECTIVE ENTRIES:
- dip 0.6–1.0%
- rebound 0.4–0.8%

MARKET SIDEWAYS / RANGE:
- dip 2.0%
- rebound 1.0%

MARKET BEARISH / RISK OFF:
- dip 2.5–3.0%
- rebound 1.2–1.5%
```

### Required fields

```text
dipConfirmed=true
reboundConfirmed=true
spreadOk=true
tpRoomOk=true
priceFresh=true
fallingKnifeBlocked=false
downtrendBlocked=false
finalExecutable=true
```

### Când se folosește

```text
Market slab
Risk-off
Group bearish_or_unsafe
Safety fallback
Coin fără momentum suficient
```

### Când nu cumpără

```text
downtrend profund
dip lipsă
rebound lipsă
spread mare
price stale
falling knife
```

### Important

Conservative are voie să ceară dip/rebound hard.

---

## 3.3 balanced

### Familie V3

```text
balanced_momentum / uptrend entry
```

### Ce face

Balanced NU este dip_and_rebound clasic.  
Balanced este intrare de tip momentum/continuation mai relaxată decât Momentum.

### Contract principal

Balanced trebuie să cumpere pe momentum confirmat, nu pe dip obligatoriu.

### Condiții V3

```text
momentumConfirmed =
  momentum5m > 0.12
  OR momentum15m > 0.2
  OR momentum1h > 0.35
  OR breakoutPercent > 0
  OR uptrend=true
  OR change24h > 2.0
```

### Required fields

```text
momentumConfirmed=true
spreadOk=true
tpRoomOk=true
priceFresh=true
overextended=false
candleExhaustion=false
fallingKnifeBlocked=false
```

### Advisory fields

```text
dipConfirmed
reboundConfirmed
volumeRelative
small pullback
small rebound
confidence boost
```

### Hard rule

Dacă finalStrategy este `balanced`, atunci:

```text
setupMissing MUST NOT include dipConfirmed
setupMissing MUST NOT include reboundConfirmed
primaryBlocker MUST NOT be dip_not_confirmed
primaryBlocker MUST NOT be rebound_not_confirmed
```

Dip/rebound pot crește scorul, dar nu trebuie să blocheze Balanced.

### Când se alege

```text
Market bullish
Market sideways cu impuls bun
Group trend not bearish_or_unsafe
Confidence tier B_70_80
Momentum confirmat
```

### Când se blochează

```text
momentum_not_confirmed
spread_slippage_too_high
no_tp_room
price_not_fresh
overextended
candle_exhaustion
falling_knife
bearish_risk_off
group_bearish_or_unsafe
```

### Când se face downgrade

Balanced poate fi downgrade la conservative/wait dacă:

```text
market_risk_off=true
group bearish_or_unsafe
market bearish
quality poor
overextended
candle_exhaustion
spread too high
```

Dar trebuie log clar:

```text
STRATEGY_DOWNGRADED_AUDIT
fromStrategy=balanced
toStrategy=conservative/wait
reason=bearish_risk_off / safety_fallback / group_risk / overextended / candle_exhaustion
```

---

## 3.4 momentum

### Familie

```text
momentum / breakout continuation
```

### Ce face

Cumpără pe breakout sau tendință ascendentă puternică.

### Condiții V3

```text
momentum5m > 0.12
OR momentum15m > 0.2
OR momentum1h > 0.35
OR breakoutPercent > 0
OR uptrend=true
OR change24h > 2.0
```

### AutoBots eligibility V3

```text
detectedMomentum =
  momentumConfirmed
  && volumeHealthy
  && spreadOk
  && noExtension
  && tpRoomOk
  && isUptrend
  && !isDowntrend
```

### Required fields

```text
momentumConfirmed=true
volumeHealthy=true
spreadOk=true
tpRoomOk=true
priceFresh=true
noExtension=true
isUptrend=true
isDowntrend=false
overextended=false
candleExhaustion=false
fallingKnifeBlocked=false
```

### Advisory fields

```text
dipConfirmed
reboundConfirmed
small pullback
confidence boost
market strength
```

### Hard rule

Dacă finalStrategy este `momentum`, atunci:

```text
setupMissing MUST NOT include dipConfirmed
setupMissing MUST NOT include reboundConfirmed
primaryBlocker MUST NOT be dip_not_confirmed
primaryBlocker MUST NOT be rebound_not_confirmed
```

### Când se alege

```text
Uptrend puternic
Breakout
Momentum puternic
Confidence tier A_80_PLUS
```

### Când se blochează

```text
downtrend
bearish/risk_off fără confirmare strictă
choppy market
overextended
candle_exhaustion
spread too high
book stale
no tp room
falling knife
```

### Diferență față de Balanced

```text
Balanced = momentum mai relaxat, tier B_70_80
Momentum = breakout/uptrend mai puternic, tier A_80_PLUS
```

---

## 3.5 wait

### Ce este

WAIT nu este strategie reală.  
WAIT este stare finală după ce o strategie intenționată nu trece gate-urile.

Corect:

```text
intendedStrategy=balanced
finalStrategy=wait
primaryBlocker=spread_slippage_too_high
```

Greșit:

```text
selectedStrategy=wait
requiredDipPct=n/a
dar intendedStrategy pierdut
```

WAIT trebuie să păstreze intendedStrategy:

```text
intendedStrategy
requestedStrategy
marketRecommendedStrategy
runtimeActiveStrategy
primaryBlocker
missingRequirements
```

---

# 4. Market logic ca în V3

---

## 4.1 Market bullish / uptrend

Strategii preferate:

```text
momentum
balanced
dip_and_rebound pe pullback
```

Nu trebuie să forțeze conservative dacă:

```text
momentumConfirmed=true
spreadOk=true
tpRoomOk=true
priceFresh=true
not overextended
not candleExhaustion
```

---

## 4.2 Market sideways / range

Strategii preferate:

```text
dip_and_rebound
balanced dacă există momentum local
grid-like behavior dacă există consolidare
```

Conservative poate fi folosit dacă piața este slabă sau group risk este ridicat.

---

## 4.3 Market bearish / risk_off

Strategii preferate:

```text
conservative
wait
dip_and_rebound doar dacă există setup foarte clar
```

Balanced/momentum pot fi blocate sau downgrade dacă:

```text
market_risk_off=true
group bearish_or_unsafe
downtrend=true
ltf not confirmed
```

Dar dacă sunt blocate/downgrade, logul trebuie să spună clar motivul.

---

# 5. Hard blockers V3 care trebuie respectate

AutoBots strategy selector hard blockers:

```text
market_risk_off
stale_price
no_tp_room
ml_blocked
group_disabled
falling_knife
quality_poor
overextended
candle_exhaustion
spread_slippage_too_high
```

Universal Entry Path blockers:

```text
stale_price
spread_too_high
no_tp_room
overextended
falling_knife
volume_required_missing
book_stale
price_not_fresh
```

Important:

```text
dip_rebound_not_confirmed applies only to dip_and_rebound/conservative.
It must not block balanced/momentum as a required field.
```

---

# 6. Confidence tiers V3

V4 trebuie să folosească minimele V3:

```text
top_majors: 65
large_caps: 68
mid_caps: 70
high_risk_alts: 72
very_high_risk: 72
```

Strategy confidence tiers:

```text
Balanced: B_70_80
Momentum: A_80_PLUS
```

---

# 7. TP logic: diferență V3 vs V4

În V3:

```text
momentum/aggressive → armed + dynamic
restul → user TP
```

În V4 avem deja regression lock:

```text
Scanner AUTO / The Dipper / AutoBots:
TP1 = dynamic per coin
TP2 = 0
SL = user-defined
```

Acest task NU schimbă TP logic în V4.

Scopul acestui task este doar:

```text
strategy selection
market logic
strategy contract
audits
UI explanation
```

Nu atinge:

```text
TP1/TP2/SL
TradingEngine ownership resolver
PositionManager snapshots
Telegram/Open/Closed binding
F5 persistence
```

---

# 8. Required audits în V4

## 8.1 STRATEGY_CONTRACT_APPLIED_AUDIT

Fields:

```text
symbol
requestedStrategy
intendedStrategy
finalStrategy
appliedContract
marketRegime
marketAction
groupTrend
riskGroup
confidence
requiredConfidence
requiredFields
advisoryFields
hardBlockers
setupMissing
primaryBlocker
```

## 8.2 BALANCED_MOMENTUM_CONTRACT_AUDIT

Fields:

```text
symbol
finalStrategy
momentumConfirmed
spreadOk
tpRoomOk
priceFresh
overextended
candleExhaustion
fallingKnifeBlocked
dipConfirmedRole=advisory
reboundConfirmedRole=advisory
finalExecutable
```

## 8.3 MOMENTUM_STRATEGY_SELECTION_AUDIT

Fields:

```text
symbol
momentum5m
momentum15m
momentum1h
breakoutPercent
change24h
isUptrend
isDowntrend
volumeHealthy
spreadOk
noExtension
tpRoomOk
selected
blockedReason
```

## 8.4 STRATEGY_DOWNGRADED_AUDIT

Fields:

```text
symbol
fromStrategy
toStrategy
reason
marketCondition
marketAction
riskGroup
groupTrend
confidence
requiredConfidence
```

Allowed reasons:

```text
bearish_risk_off
safety_fallback
group_risk
spread_slippage_too_high
overextended
candle_exhaustion
falling_knife
price_not_fresh
no_tp_room
```

---

# 9. Hard fail rules

Treat as bug if any of these happen:

```text
finalStrategy=balanced and setupMissing contains dipConfirmed
finalStrategy=balanced and setupMissing contains reboundConfirmed
finalStrategy=balanced and primaryBlocker=dip_not_confirmed
finalStrategy=balanced and primaryBlocker=rebound_not_confirmed

finalStrategy=momentum and setupMissing contains dipConfirmed
finalStrategy=momentum and setupMissing contains reboundConfirmed
finalStrategy=momentum and primaryBlocker=dip_not_confirmed
finalStrategy=momentum and primaryBlocker=rebound_not_confirmed

WAIT erases intendedStrategy
Balanced downgraded but no reason logged
Momentum blocked but no reason logged
Scanner Signal BUY displayed as Execution Ready
```

---

# 10. Required tests

Add or update tests:

```text
strategy-contract-v3-parity.test.ts
balanced-momentum-contract.test.ts
momentum-strategy-selection.test.ts
strategy-downgrade-audit.test.ts
scanner-to-execution-pipeline.test.ts
```

Test cases:

```text
1. Balanced with momentumConfirmed=true, spreadOk=true, tpRoomOk=true, priceFresh=true, no overextended, no candle exhaustion, no falling knife
   → finalExecutable=true even if dipConfirmed=false/reboundConfirmed=false.

2. Balanced requiredFields does not include dipConfirmed/reboundConfirmed.

3. Balanced primaryBlocker is not dip_not_confirmed/rebound_not_confirmed.

4. Momentum with strong momentum/uptrend and no hard blockers
   → finalExecutable=true without dip/rebound.

5. Momentum blocks on overextended.

6. Momentum blocks on candle_exhaustion.

7. Momentum blocks on downtrend/risk_off unless strict confirmation path exists.

8. dip_and_rebound still requires dip + rebound.

9. conservative still requires strict dip + rebound.

10. bearish/risk_off can downgrade balanced/momentum to conservative/wait with explicit reason.

11. WAIT preserves intendedStrategy.

12. Scanner Signal BUY is not shown as Execution Ready unless selectedForExecution=true.
```

Regression lock suites must pass:

```bash
npx.cmd tsx src/__tests__/tp1-safety-guards.test.ts
npx.cmd tsx src/__tests__/telegram-buy-opened-risk-snapshot.test.ts
npx.cmd tsx src/__tests__/open-positions-ui.test.ts
npx.cmd tsx src/__tests__/closed-positions-ui.test.ts
npx.cmd tsx src/__tests__/execution-planner.test.ts
npx.cmd tsx src/__tests__/f5-reload-persistence.test.ts
npm.cmd run build
```

---

# 11. UI requirements

Top Candidates / Strategy Audit UI must show:

```text
Scanner Signal
Intended Strategy
Final Strategy
Execution Status
Why Not Bought
Primary Blocker
Required Fields
Missing Fields
Downgrade Reason
```

Do not show:

```text
BUY ready
```

unless:

```text
selectedForExecution=true
```

Better labels:

```text
Scanner Signal: BUY
Execution Status: WAIT
Why: WAITING_FOR_REBOUND

Scanner Signal: BUY
Execution Status: BLOCKED
Why: SPREAD_TOO_HIGH

Scanner Signal: BUY
Execution Status: READY
Why: selected for execution
```

---

# 12. Definition of Done

Done only when:

```text
1. V4 strategy contracts match V3.
2. Balanced is momentum/uptrend entry, not dip_and_rebound.
3. Momentum is breakout/uptrend entry, not dip_and_rebound.
4. dip_and_rebound still requires dip + rebound.
5. conservative still requires strict dip + rebound.
6. WAIT preserves intendedStrategy.
7. Market risk_off downgrades are explicit.
8. Top Candidates no longer confuses Scanner BUY with Execution Ready.
9. No regression to TP1/TP2/SL.
10. No regression to snapshots/Open/Closed/Telegram/Journal.
11. No regression to F5 persistence.
12. All regression suites pass.
```

---

# 13. Important final instruction

This is a **strategy parity task**, not a trade lifecycle rewrite.

Do not patch UI only.  
Do not weaken safety filters.  
Do not touch TP1/TP2/SL.  
Do not break regression lock.  
Do not hide blockers.

Repair strategy contracts at the source:

```text
strategy selector
strategy audit builder
entry rule matrix
execution planner classification
Top Candidates display mapping
```
