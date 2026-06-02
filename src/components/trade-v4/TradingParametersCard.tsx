import { memo, useEffect, useState } from "react";
import type { TradingParametersView } from "./types";
import { normalizeBannedCoinInput } from "../../core/trading/banned-symbols";
import { logger } from "../../utils/logger";

const ALL_RISK_GROUPS = ['top_caps', 'large_caps', 'mid_caps', 'high_risk', 'very_high_risk'] as const;

function ensureAllGroups(rg: Record<string, boolean>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of ALL_RISK_GROUPS) {
    result[key] = typeof rg[key] === 'boolean' ? rg[key] : true;
  }
  return result;
}

const AUTO_HELPER = "Auto Trader controls this value. Turn Auto OFF to edit manually.";

const disableStyle: React.CSSProperties = {
  opacity: 0.55,
  cursor: 'not-allowed',
};

export const TradingParametersCard = memo(function TradingParametersCard(props: {
  value: TradingParametersView;
  onChange: (next: TradingParametersView) => void;
  scannerRunning?: boolean;
  scannerConfigDirty?: boolean;
  paperAutoEnabled?: boolean;
  onApply?: () => void;
}) {
  const v = props.value;
  const auto = props.paperAutoEnabled ?? v.paperAutoEnabled;
  const manualOverrideActive = v.strategySource === 'manual_override';
  const patch = <K extends keyof TradingParametersView>(k: K, val: TradingParametersView[K]) => props.onChange({ ...v, [k]: val });
  const rg = ensureAllGroups(v.scannerRiskGroups as Record<string, boolean>);

  const [banInput, setBanInput] = useState("");
  const [advExpanded, setAdvExpanded] = useState(false);
  const [bansExpanded, setBansExpanded] = useState(false);
  const [banFeedback, setBanFeedback] = useState("");
  const [manualSetupError, setManualSetupError] = useState("");

  const addBan = () => {
    const normalized = normalizeBannedCoinInput(banInput);
    if (!normalized) return;
    const token = normalized.symbol ?? normalized.baseAsset!;
    if (v.scannerBanlist.includes(token)) { setBanInput(""); return; }
    patch("scannerBanlist", [...v.scannerBanlist, token]);
    logger.info(`BANNED_COIN_ADDED: input=${banInput.trim()} stored=${token} symbol=${normalized.symbol ?? 'none'} baseAsset=${normalized.baseAsset ?? 'none'} quoteAsset=${normalized.quoteAsset ?? 'none'}`);
    setBanFeedback(normalized.symbol ? `${normalized.symbol} added to banned coins` : `${normalized.baseAsset} added to banned coins`);
    setBanInput("");
  };

  const removeBan = (idx: number) => {
    patch("scannerBanlist", v.scannerBanlist.filter((_, i) => i !== idx));
  };

  const DisabledWrap = (p: { children: React.ReactNode; label: string; disabled?: boolean }) => (
    <div style={p.disabled ? disableStyle : undefined} title={p.disabled ? AUTO_HELPER : p.label}>
      {p.children}
    </div>
  );
  const manualDipperLocked = v.strategySource === 'autobots' && !!auto;
  const manualFieldsEditable = !manualDipperLocked;
  const conflictDetected = manualOverrideActive && !!auto && manualDipperLocked;
  const lockReason = manualDipperLocked
    ? 'strategySource_autobots_and_auto_enabled'
    : manualOverrideActive
      ? 'manual_override_priority'
      : (!auto ? 'autobots_off' : 'manual_mode');

  useEffect(() => {
    logger.info(`MANUAL_DIPPER_MODE_STATE_AUDIT: strategySource=${v.strategySource} autoBotsEnabled=${String(!!auto)} manualSetupLocked=${String(manualDipperLocked)} manualFieldsEditable=${String(manualFieldsEditable)} reason=${lockReason} conflictDetected=${String(conflictDetected)}`);
    if (conflictDetected) {
      logger.warn(`MANUAL_DIPPER_AUTOBOTS_LOCK_CONFLICT: strategySource=${v.strategySource} autoBotsEnabled=${String(!!auto)} manualSetupLocked=${String(manualDipperLocked)} resolution=manual_override_unlock_fields`);
    }
  }, [v.strategySource, auto, manualDipperLocked, manualFieldsEditable, lockReason, conflictDetected]);

  useEffect(() => {
    logger.info(`MANUAL_DIPPER_SETUP_RESTORED: momentumMinReboundPct=${v.manualDipperSetup.momentumMinReboundPct} balancedMinDipPct=${v.manualDipperSetup.balancedMinDipPct} balancedMinReboundPct=${v.manualDipperSetup.balancedMinReboundPct} dipReboundMinDipPct=${v.manualDipperSetup.dipReboundMinDipPct} dipReboundMinReboundPct=${v.manualDipperSetup.dipReboundMinReboundPct} conservativeMinDipPct=${v.manualDipperSetup.conservativeMinDipPct} conservativeMinReboundPct=${v.manualDipperSetup.conservativeMinReboundPct}`);
  }, []);
  const patchManualSetup = (key: keyof TradingParametersView["manualDipperSetup"], raw: string, fallback: number) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setManualSetupError('Invalid value: must be numeric and non-negative.');
      return;
    }
    setManualSetupError('');
    patch("manualDipperSetup", { ...v.manualDipperSetup, [key]: n });
    logger.info(`MANUAL_DIPPER_SETUP_SAVE_SUCCESS: field=${String(key)} value=${n} strategySource=${v.strategySource} autoBotsEnabled=${String(!!auto)} manualSetupLocked=${String(manualDipperLocked)}`);
  };

  return (
    <>
      <div className="panel-title" style={{ fontSize: 11, marginBottom: 6 }}>
        Trading Parameters {auto ? <span style={{ fontSize: 9, color: '#58a6ff' }}>— Auto ON</span> : ''}
      </div>
      {props.onApply && (
        <div style={{ marginBottom: 6 }}>
          <button className="btn btn-primary" onClick={props.onApply} style={{ fontSize: 10, padding: '3px 10px', width: '100%' }}>
            Apply Settings
          </button>
        </div>
      )}
      <div className="param-grid">
        <label>Strategy Source</label>
        <select value={v.strategySource} onChange={(e) => patch("strategySource", e.target.value as TradingParametersView["strategySource"])}>
          <option value="autobots">AutoBots</option>
          <option value="manual_override">Manual Override</option>
        </select>

        <label>Strategy</label>
        <DisabledWrap label="Strategy" disabled={!manualOverrideActive}>
          <select value={v.strategy} onChange={(e) => patch("strategy", e.target.value)} disabled={!manualOverrideActive}>
            <option value="balanced">balanced</option>
            <option value="momentum">momentum</option>
            <option value="conservative">conservative</option>
            <option value="smart">smart</option>
          </select>
        </DisabledWrap>

        <label>Entry Confirmation</label>
        <select value={v.entryConfirmationMode} onChange={(e) => patch("entryConfirmationMode", e.target.value as TradingParametersView["entryConfirmationMode"])}>
          <option value="strict">Strict</option>
          <option value="smart">Smart</option>
          <option value="aggressive">Aggressive</option>
        </select>

        <label>Stop Loss (SL)</label>
        <input type="number" value={v.stopLossPct} onChange={(e) => patch("stopLossPct", Number(e.target.value))}
          style={{ borderColor: auto ? 'rgba(88,166,255,0.3)' : undefined }}
          title={auto ? 'SL remains user-controlled for safety' : 'Stop Loss'} />

        <label>TP1</label>
        <DisabledWrap label="TP1" disabled={!manualOverrideActive}>
          <input
            type="text"
            value={manualOverrideActive ? String(v.tp1Pct) : 'AutoBots dynamic per coin'}
            onChange={(e) => patch("tp1Pct", Number(e.target.value))}
            disabled={!manualOverrideActive}
            readOnly={!manualOverrideActive}
          />
        </DisabledWrap>

        <label>TP2</label>
        <DisabledWrap label="TP2" disabled={!manualOverrideActive}>
          <input
            type="text"
            value={manualOverrideActive ? String(v.tp2Pct) : '0 / disabled in AutoBots'}
            onChange={(e) => patch("tp2Pct", Number(e.target.value))}
            disabled={!manualOverrideActive}
            readOnly={!manualOverrideActive}
          />
        </DisabledWrap>

        <label>Ref Window</label>
        <select value={v.refWindow} onChange={(e) => patch("refWindow", e.target.value as TradingParametersView["refWindow"])}
          title={auto ? 'Ref Window remains user-controlled for market context' : 'Reference Window'}>
          <option value="AUTO">Auto</option>
          <option value="LAST_HOUR">1h</option>
          <option value="LAST_DAY">1d</option>
          <option value="LAST_WEEK">1w</option>
          <option value="LAST_3_WEEKS">3w</option>
        </select>

        <label>Ref Mode</label>
        <select value={v.refMode} onChange={(e) => patch("refMode", e.target.value as TradingParametersView["refMode"])}
          title={auto ? 'Ref Mode remains user-controlled for market context' : 'Reference Mode'}>
          <option value="AUTO">Auto</option>
          <option value="SMA">SMA</option>
          <option value="EMA">EMA</option>
          <option value="VWAP">VWAP</option>
          <option value="BOLLINGER">Bollinger</option>
        </select>

        <label>Scanner Ref Period</label>
        <select value={v.scannerReferencePeriod} onChange={(e) => patch("scannerReferencePeriod", e.target.value as TradingParametersView["scannerReferencePeriod"])}>
          <option value="1h">1h</option>
          <option value="4h">4h</option>
          <option value="1d">1d</option>
          <option value="1w">1w</option>
        </select>

        <label>Dynamic Trailing</label>
        <DisabledWrap label="Dynamic Trailing">
          <input type="checkbox" checked={v.dynamicTrailingEnabled} onChange={(e) => patch("dynamicTrailingEnabled", e.target.checked)} />
        </DisabledWrap>

        <label>Trail Trigger</label>
        <DisabledWrap label="Trail Trigger" disabled={!manualOverrideActive}>
          <input
            type="text"
            value={manualOverrideActive ? String(v.trailTriggerPct) : 'Starts at TP1'}
            onChange={(e) => patch("trailTriggerPct", Number(e.target.value))}
            disabled={!manualOverrideActive}
            readOnly={!manualOverrideActive}
          />
        </DisabledWrap>

        <label>Trail Pullback</label>
        <DisabledWrap label="Trail Pullback">
          <input type="number" value={v.trailPullbackPct} onChange={(e) => patch("trailPullbackPct", Number(e.target.value))} />
        </DisabledWrap>
      </div>

      {manualOverrideActive && (
        <div style={{ fontSize: 9, color: '#d29922', marginTop: 4, padding: '4px 6px', background: 'rgba(210,153,34,0.1)', borderRadius: 4 }}>
          <strong>Manual Override active:</strong> {v.strategy.charAt(0).toUpperCase() + v.strategy.slice(1)}
        </div>
      )}

      {auto && (
        <div style={{ fontSize: 9, color: '#d29922', marginTop: 4, padding: '4px 6px', background: 'rgba(210,153,34,0.1)', borderRadius: 4 }}>
          <strong>Auto Trader ON</strong> — Strategy Source defaults to AutoBots. SL stays editable as safety limit.
        </div>
      )}

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />
      <div style={{ fontSize: 10, color: '#79c0ff', marginBottom: 4 }}>
        Manual The Dipper Setup {manualDipperLocked ? <span style={{ fontSize: 9, color: '#d29922' }}>- locked</span> : ''}
      </div>
      {manualDipperLocked && (
        <div style={{ fontSize: 9, color: '#d29922', marginBottom: 6, padding: '4px 6px', background: 'rgba(210,153,34,0.1)', borderRadius: 4 }}>
          AutoBots ON - setup is decided automatically per coin. Manual dip/rebound fields are locked.
        </div>
      )}
      {!manualDipperLocked && manualOverrideActive && (
        <div style={{ fontSize: 9, color: '#3fb950', marginBottom: 6, padding: '4px 6px', background: 'rgba(63,185,80,0.1)', borderRadius: 4 }}>
          Manual Override active — edit dip/rebound setup values manually.
        </div>
      )}
      <div className="param-grid" style={manualDipperLocked ? disableStyle : undefined}>
        <label>Momentum min rebound %</label>
        <input type="number" step="0.01" min={0} value={v.manualDipperSetup.momentumMinReboundPct}
          disabled={manualDipperLocked} onChange={(e) => patchManualSetup('momentumMinReboundPct', e.target.value, 0.4)} />
        <label>Momentum confirmation required</label>
        <input type="checkbox" checked={v.manualDipperSetup.momentumConfirmationRequired}
          disabled={manualDipperLocked} onChange={(e) => patch("manualDipperSetup", { ...v.manualDipperSetup, momentumConfirmationRequired: e.target.checked })} />

        <label>Balanced min dip %</label>
        <input type="number" step="0.01" min={0} value={v.manualDipperSetup.balancedMinDipPct}
          disabled={manualDipperLocked} onChange={(e) => patchManualSetup('balancedMinDipPct', e.target.value, 0.8)} />
        <label>Balanced min rebound %</label>
        <input type="number" step="0.01" min={0} value={v.manualDipperSetup.balancedMinReboundPct}
          disabled={manualDipperLocked} onChange={(e) => patchManualSetup('balancedMinReboundPct', e.target.value, 0.4)} />
        <label>Balanced weak momentum confirmation</label>
        <input type="checkbox" checked={v.manualDipperSetup.balancedWeakMomentumConfirmation}
          disabled={manualDipperLocked} onChange={(e) => patch("manualDipperSetup", { ...v.manualDipperSetup, balancedWeakMomentumConfirmation: e.target.checked })} />

        <label>Dip-and-Rebound min dip %</label>
        <input type="number" step="0.01" min={0} value={v.manualDipperSetup.dipReboundMinDipPct}
          disabled={manualDipperLocked} onChange={(e) => patchManualSetup('dipReboundMinDipPct', e.target.value, 0.8)} />
        <label>Dip-and-Rebound min rebound %</label>
        <input type="number" step="0.01" min={0} value={v.manualDipperSetup.dipReboundMinReboundPct}
          disabled={manualDipperLocked} onChange={(e) => patchManualSetup('dipReboundMinReboundPct', e.target.value, 0.4)} />

        <label>Conservative min dip %</label>
        <input type="number" step="0.01" min={0} value={v.manualDipperSetup.conservativeMinDipPct}
          disabled={manualDipperLocked} onChange={(e) => patchManualSetup('conservativeMinDipPct', e.target.value, 2.0)} />
        <label>Conservative min rebound %</label>
        <input type="number" step="0.01" min={0} value={v.manualDipperSetup.conservativeMinReboundPct}
          disabled={manualDipperLocked} onChange={(e) => patchManualSetup('conservativeMinReboundPct', e.target.value, 1.0)} />
      </div>
      <div style={{ fontSize: 8, color: '#8b949e', marginTop: 4 }}>
        These values affect Manual The Dipper mode only. AutoBots uses automatic per-coin setup.
      </div>
      <div style={{ fontSize: 8, color: '#d29922', marginTop: 2 }}>
        Some fields may be persisted/displayed as not wired to final gate yet.
      </div>
      {manualSetupError && <div style={{ fontSize: 8, color: '#f85149', marginTop: 4 }}>{manualSetupError}</div>}
      <div style={{ fontSize: 8, color: '#8b949e', marginTop: 2 }}>
        MANUAL_DIPPER_SETUP_EDITABLE_STATE_AUDIT: editable={String(manualFieldsEditable)} locked={String(manualDipperLocked)} source={v.strategySource}
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />

      <div style={{ fontSize: 10, color: '#58a6ff', marginBottom: 4 }}>Scanner Universe</div>
      <div className="param-grid">
        <label>Universe Mode</label>
        <select value={v.scannerUniverseMode} onChange={(e) => patch("scannerUniverseMode", e.target.value as TradingParametersView["scannerUniverseMode"])}>
          <option value="BINANCE_TOP_250">Binance Universe</option>
          <option value="TOP_100">Top 100</option>
          <option value="TOP_50">Top 50</option>
          <option value="TOP_20">Top 20</option>
          <option value="WATCHLIST">Watchlist</option>
        </select>

        <label>Universe Size</label>
        <select value={v.scannerUniverseSize} onChange={(e) => patch("scannerUniverseSize", Number(e.target.value))}>
          <option value="250">Top 250</option>
          <option value="100">Top 100</option>
          <option value="50">Top 50</option>
          <option value="20">Top 20</option>
        </select>

        <label>Final Pool Size</label>
        <select value={v.scannerFinalPoolSize} onChange={(e) => patch("scannerFinalPoolSize", Number(e.target.value))}>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="10">10</option>
        </select>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />

      <div style={{ fontSize: 10, color: '#3fb950', marginBottom: 4 }}>Re-entry Protection: Smart</div>
      <div style={{ fontSize: 8, color: '#8b949e', marginBottom: 4, lineHeight: '14px' }}>
        AutoBots manages re-entry automatically. Profit resets the coin, loss requires recovery confirmation before another buy.
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />

      <div style={{ fontSize: 10, color: '#f0883e', marginBottom: 4 }}>Entry Quality</div>
      <div className="param-grid">
        <label title="Difference between bid and ask. High spread = bad entry price.">Max Spread %</label>
        <input type="number" value={v.maxSpreadPct} onChange={(e) => patch("maxSpreadPct", Math.max(0.01, Number(e.target.value)))}
          min={0.01} step={0.01} title="Spread = (ask - bid) / mid. BTC/ETH/BNB normally < 0.1%." />

        <label title="Estimated price deviation between intended entry and actual fill.">Max Slippage %</label>
        <input type="number" value={(v as any).maxSlippagePct ?? 0.25} onChange={(e) => patch("maxSlippagePct" as any, Math.max(0, Number(e.target.value)))}
          min={0} step={0.01} title="Slippage = difference between expected price and estimated fill price." />

        <label title="Spread + Slippage combined. If total exceeds this, trade is blocked.">Max Total Cost %</label>
        <input type="number" value={(v as any).maxTotalEntryCostPct ?? 0.60} onChange={(e) => patch("maxTotalEntryCostPct" as any, Math.max(0, Number(e.target.value)))}
          min={0} step={0.01} title="Total Entry Cost = Spread + Slippage. Ideal < 0.5% for major coins." />
      </div>
      <div style={{ fontSize: 7, color: '#484f58', marginTop: 2, lineHeight: '12px' }}>
        Higher limits allow more candidates but increase risk of bad fills.
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: advExpanded ? 4 : 0 }}
        onClick={() => setAdvExpanded(!advExpanded)}
      >
        <div style={{ fontSize: 10, color: '#484f58' }}>Advanced Entry Diagnostics {advExpanded ? '?' : '?'}</div>
        <div style={{ fontSize: 8, color: '#7a8ea8' }}>AutoBots Smart Re-entry normally handles this.</div>
      </div>
      {advExpanded && (
        <div className="param-grid">
          <label>Max New Buys / Scan</label>
          <input type="number" value={v.maxEntriesPerCycle} onChange={(e) => patch("maxEntriesPerCycle", Math.max(1, Number(e.target.value)))}
            min={1} max={20} title="Max new BUY orders AutoBots can open per scan cycle. Does not force buys." />

          <label>Entry Gate Attempt Limit</label>
          <input type="number" value={v.maxEntryGateAttemptsPerScan} onChange={(e) => patch("maxEntryGateAttemptsPerScan", Math.max(1, Number(e.target.value)))}
            min={1} max={50} title="Performance safety: max candidates sent through EntryGate per scan. Does not control trade count." />

          <label>Max / Coin / Day</label>
          <input type="number" value={v.maxEntriesPerCoinPerDay} onChange={(e) => patch("maxEntriesPerCoinPerDay", Math.max(1, Number(e.target.value)))}
            min={1} max={10} title="Advanced: per-coin daily entry cap" />

          <label>Cooldown After Loss</label>
          <input type="number" value={v.cooldownAfterLossMs} onChange={(e) => patch("cooldownAfterLossMs", Math.max(10000, Number(e.target.value)))}
            min={10000} step={10000} title="Advanced: minimum cooldown after loss" />
        </div>
      )}

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: bansExpanded ? 4 : 0 }}
        onClick={() => setBansExpanded(!bansExpanded)}
      >
        <div style={{ fontSize: 10, color: '#bc8cff' }}>Banned Coins: {v.scannerBanlist.length} {bansExpanded ? '?' : '?'}</div>
      </div>
      {bansExpanded && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <input type="text" placeholder="Add symbol e.g. DOGEUSDT"
              value={banInput}
              onChange={(e) => setBanInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addBan(); }}
              style={{ flex: 1, background: 'rgba(9,15,32,0.85)', color: '#cfe2ff', border: '1px solid rgba(188,140,255,0.2)', borderRadius: 4, padding: '2px 5px', fontSize: 8 }}
            />
            <button className="btn btn-sm" onClick={addBan} style={{ fontSize: 8, padding: '2px 6px', background: 'rgba(188,140,255,0.15)', border: '1px solid rgba(188,140,255,0.3)', color: '#bc8cff', borderRadius: 4, cursor: 'pointer' }}>Ban</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxHeight: 60, overflow: 'hidden auto' }}>
            {v.scannerBanlist.map((sym, i) => (
              <span key={i} style={{ fontSize: 7, background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.2)', borderRadius: 3, padding: '1px 4px', display: 'flex', alignItems: 'center', gap: 3 }}>
                {sym.length > 8 ? sym.slice(0, 8) + '..' : sym}
                <span onClick={() => removeBan(i)} style={{ cursor: 'pointer', color: '#f85149', fontWeight: 700 }}>?</span>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 7, color: '#484f58', marginTop: 2 }}>Default stablecoins/metals always excluded</div>
          {banFeedback && <div style={{ fontSize: 8, color: '#3fb950', marginTop: 4 }}>{banFeedback}</div>}
        </>
      )}

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />

      <div style={{ fontSize: 10, color: '#58a6ff', marginBottom: 4 }}>Capital Settings</div>
      <div className="param-grid">
        <label>Trading Capital</label>
        <input type="number" value={v.autoTradingCapital} onChange={(e) => patch("autoTradingCapital", Math.max(0, Number(e.target.value)))}
          min={0} step={10} title="Total demo/autobot capital" />

        <label>Capital Per Coin</label>
        <input type="number" value={v.capitalPerCoin} onChange={(e) => patch("capitalPerCoin", Math.max(1, Number(e.target.value)))}
          min={1} step={5} title="Fixed amount per position" />

        <label>Reinvest Profit</label>
        <input type="checkbox" checked={v.reinvestProfit} onChange={(e) => patch("reinvestProfit", e.target.checked)}
          title="ON = available capital includes realized demo profit" />

        <label>Max Open Positions</label>
        <input type="number" value={v.maxOpenPositions} onChange={(e) => patch("maxOpenPositions", Math.max(1, Number(e.target.value)))}
          min={1} step={1} />
      </div>

      <div style={{ marginTop: 6, fontSize: 10 }}>
        <div style={{ marginBottom: 4, color: "#58a6ff", fontSize: 9, fontWeight: 600 }}>Dipper Risk Groups</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <label style={{ fontSize: 9 }}><input type="checkbox" checked={rg.top_caps} onChange={(e) => patch("scannerRiskGroups", { top_caps: e.target.checked, large_caps: rg.large_caps, mid_caps: rg.mid_caps, high_risk: rg.high_risk, very_high_risk: rg.very_high_risk })} /> Top Caps</label>
          <label style={{ fontSize: 9 }}><input type="checkbox" checked={rg.large_caps} onChange={(e) => patch("scannerRiskGroups", { top_caps: rg.top_caps, large_caps: e.target.checked, mid_caps: rg.mid_caps, high_risk: rg.high_risk, very_high_risk: rg.very_high_risk })} /> Large Caps</label>
          <label style={{ fontSize: 9 }}><input type="checkbox" checked={rg.mid_caps} onChange={(e) => patch("scannerRiskGroups", { top_caps: rg.top_caps, large_caps: rg.large_caps, mid_caps: e.target.checked, high_risk: rg.high_risk, very_high_risk: rg.very_high_risk })} /> Mid Caps</label>
          <label style={{ fontSize: 9 }}><input type="checkbox" checked={rg.high_risk} onChange={(e) => patch("scannerRiskGroups", { top_caps: rg.top_caps, large_caps: rg.large_caps, mid_caps: rg.mid_caps, high_risk: e.target.checked, very_high_risk: rg.very_high_risk })} /> High Risk</label>
          <label style={{ fontSize: 9 }}><input type="checkbox" checked={rg.very_high_risk} onChange={(e) => patch("scannerRiskGroups", { top_caps: rg.top_caps, large_caps: rg.large_caps, mid_caps: rg.mid_caps, high_risk: rg.high_risk, very_high_risk: e.target.checked })} /> Very High Risk</label>
        </div>
      </div>
      {props.scannerRunning && props.scannerConfigDirty && (
        <div className="param-note">Changes apply on next scan</div>
      )}
    </>
  );
});


