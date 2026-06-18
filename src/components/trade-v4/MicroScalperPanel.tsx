import { memo, useEffect, useState } from "react";
import type { MicroScalperSettings } from "../../core/scalper/MicroScalperTypes";
import { createDefaultMicroScalperSettings } from "../../core/scalper/MicroScalperTypes";
import { updateScalperSettings, enableScalper, disableScalper } from "../../core/scalper/MicroScalperEngine";
import { logger } from "../../utils/logger";
import { formatLocalTime } from "../../utils/timeFormatter";

interface MicroScalperPanelProps {
  enabled: boolean;
  settings: Partial<MicroScalperSettings>;
  status: string;
  candidates: number;
  executionPool: number;
  watchPool: number;
  lastScanAt: string | null;
  lastBlockReason: string | null;
  openScalpPositions: number;
}

export const MicroScalperPanel = memo(function MicroScalperPanel(props: MicroScalperPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const s = props.settings;

  const statusColors: Record<string, string> = {
    OFF: '#484f58', SCANNING: '#58a6ff', WAITING: '#d29922', BLOCKED: '#f85149', PAPER_READY: '#3fb950', DEMO_READY: '#3fb950',
  };
  const displayStatus = props.status === 'PAPER_READY' ? 'DEMO_READY' : props.status;

  const fullSettings = (() => {
    const def = createDefaultMicroScalperSettings();
    return { ...def, ...s, mode: 'manual' as const } as MicroScalperSettings;
  })();

  const patch = <K extends keyof MicroScalperSettings>(key: K, value: MicroScalperSettings[K]) => {
    const next = { ...fullSettings, [key]: value };
    logger.info(`SCALPER_MANUAL_SETTINGS_APPLIED: scanEverySec=${next.scanEverySec} pollEverySec=${next.pollEverySec} stalePriceSec=${next.stalePriceSec} tp1Pct=${next.tp1Pct} tp2Pct=${next.tp2Pct} stopLossPct=${next.stopLossPct} maxSpreadPct=${next.maxSpreadPct} minVolumeSurge=${next.minVolumeRelative} minMomentum=${next.minMomentumPct} maxCandidates=${next.maxScalpCandidates} maxOpenPositions=${next.maxOpenScalpPositions} dynamicTrailing=${next.trailingEnabled} enabled=${next.enabled}`);
    updateScalperSettings(next);
  };

  const toggleEnabled = () => {
    if (props.enabled) { disableScalper(); } else { enableScalper(); }
  };

  const resetDefaults = () => {
    updateScalperSettings({ ...createDefaultMicroScalperSettings(), mode: 'manual' as const, enabled: fullSettings.enabled });
  };

  const clampSec = (v: number) => Math.max(1, Math.min(120, Math.round(v)));

  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, alignItems: 'center', fontSize: 9 };

  return (
    <div className="panel" style={{ padding: 8, marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`paper-auto-dot ${props.enabled ? 'paper-auto-dot-running' : 'paper-auto-dot-off'}`} />
          <span style={{ fontWeight: 700, fontSize: 10, color: '#d8e6ff' }}>MICRO SCALPER</span>
          <span style={{ fontSize: 8, color: props.enabled ? '#3fb950' : '#484f58', fontWeight: 600 }}>MANUAL</span>
        </div>
        <button className="btn btn-sm" onClick={toggleEnabled} style={{ fontSize: 8, padding: '2px 8px', background: props.enabled ? 'rgba(248,81,73,0.2)' : 'rgba(63,185,80,0.15)', border: props.enabled ? '1px solid rgba(248,81,73,0.3)' : '1px solid rgba(63,185,80,0.3)', color: props.enabled ? '#f85149' : '#3fb950' }}>
          {props.enabled ? 'DISABLE' : 'ENABLE'}
        </button>
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4, fontSize: 8 }}>
        <Chip label="Status" value={displayStatus} color={statusColors[displayStatus] || '#8b949e'} />
        <Chip label="Cand" value={String(props.candidates)} />
        <Chip label="Exec" value={String(props.executionPool)} />
        <Chip label="Watch" value={String(props.watchPool)} />
        <Chip label="Open" value={String(props.openScalpPositions)} />
        <Chip label="SL" value={`${fullSettings.stopLossPct}%`} />
        <Chip label="TP1" value={`${fullSettings.tp1Pct}%`} />
      </div>

      {props.lastBlockReason && (
        <div style={{ fontSize: 8, color: '#f85149', marginBottom: 4, padding: '2px 4px', background: 'rgba(248,81,73,0.08)', borderRadius: 3 }}>{props.lastBlockReason}</div>
      )}

      {props.lastScanAt && (
        <div style={{ fontSize: 7, color: '#484f58', marginBottom: 4 }}>
          Last scan: {formatLocalTime(props.lastScanAt, { format: 'time' })}
        </div>
      )}

      <div style={{ fontSize: 8, color: '#58a6ff', cursor: 'pointer', marginTop: 4, userSelect: 'none' }} onClick={() => setExpanded(!expanded)}>
        {expanded ? '▲' : '▼'} Manual Settings
      </div>

      {expanded && (
        <>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

          {/* Timing section */}
          <div style={{ fontSize: 8, color: '#8b949e', fontWeight: 600, marginBottom: 3 }}>Timing (seconds)</div>
          <div style={gridStyle}>
            <label>Scan Every</label>
            <TimeInput value={fullSettings.scanEverySec} onChange={(v) => patch('scanEverySec', clampSec(v))} min={1} max={120} unit="sec" />
            <label>Poll Every</label>
            <TimeInput value={fullSettings.pollEverySec} onChange={(v) => patch('pollEverySec', clampSec(v))} min={1} max={120} unit="sec" />
            <label style={{ gridColumn: '1 / span 2', fontSize: 7, color: '#7a8ea8' }}>Poll Every = live price/check interval between full scans.</label>
            <label>Stale Price &gt;</label>
            <TimeInput value={fullSettings.stalePriceSec} onChange={(v) => patch('stalePriceSec', clampSec(v))} min={1} max={120} unit="sec" />
            <label style={{ gridColumn: '1 / span 2', fontSize: 7, color: '#7a8ea8' }}>Smart Cooldown: shared with AutoBots</label>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

          {/* Trade params */}
          <div style={{ fontSize: 8, color: '#8b949e', fontWeight: 600, marginBottom: 3 }}>Trade Parameters</div>
          <div style={gridStyle}>
            <label>TP1 %</label>
            <NumInput value={fullSettings.tp1Pct} onChange={(v) => patch('tp1Pct', Math.max(0.1, Math.min(v, 20)))} step={0.1} />
            <label>TP2 %</label>
            <NumInput value={fullSettings.tp2Pct} onChange={(v) => patch('tp2Pct', Math.max(0, Math.min(v, 30)))} step={0.1} />
            <label>SL %</label>
            <NumInput value={fullSettings.stopLossPct} onChange={(v) => patch('stopLossPct', Math.max(0.1, Math.min(v, 10)))} step={0.1} />
            <label>Max Open</label>
            <NumInput value={fullSettings.maxOpenScalpPositions} onChange={(v) => patch('maxOpenScalpPositions', Math.max(1, Math.min(v, 20)))} step={1} />
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

          {/* Trailing */}
          <div style={{ fontSize: 8, color: '#8b949e', fontWeight: 600, marginBottom: 3 }}>Dynamic Trailing</div>
          <div style={gridStyle}>
            <label>Enabled</label>
            <input type="checkbox" checked={fullSettings.trailingEnabled} onChange={(e) => patch('trailingEnabled', e.target.checked)} />
            <label>Trigger %</label>
            <NumInput value={fullSettings.trailTriggerPct} onChange={(v) => patch('trailTriggerPct', Math.max(0.1, Math.min(v, 5)))} step={0.1} />
            <label>Pullback %</label>
            <NumInput value={fullSettings.trailPullbackPct} onChange={(v) => patch('trailPullbackPct', Math.max(0.05, Math.min(v, 2)))} step={0.05} />
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

          {/* Entry filters */}
          <div style={{ fontSize: 8, color: '#8b949e', fontWeight: 600, marginBottom: 3 }}>Entry Filters</div>
          <div style={gridStyle}>
            <label>Max Spread %</label>
            <NumInput value={fullSettings.maxSpreadPct} onChange={(v) => patch('maxSpreadPct', Math.max(0.01, Math.min(v, 2)))} step={0.01} />
            <label>Min Vol Surge</label>
            <NumInput value={fullSettings.minVolumeRelative} onChange={(v) => patch('minVolumeRelative', Math.max(0.5, Math.min(v, 20)))} step={0.1} />
            <label>Min Momentum %</label>
            <NumInput value={fullSettings.minMomentumPct} onChange={(v) => patch('minMomentumPct', Math.max(0.1, Math.min(v, 20)))} step={0.1} />
            <label>Max Candidates</label>
            <NumInput value={fullSettings.maxScalpCandidates} onChange={(v) => patch('maxScalpCandidates', Math.max(1, Math.min(v, 100)))} step={1} />
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

          {/* Risk groups */}
          <div style={{ fontSize: 8, color: '#8b949e', fontWeight: 600, marginBottom: 3 }}>Risk Groups</div>
          <div style={{ display: 'flex', gap: 8, fontSize: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <input type="checkbox" checked={fullSettings.allowedRiskGroups.includes('high_risk')} onChange={(e) => {
                const next = e.target.checked
                  ? [...new Set([...fullSettings.allowedRiskGroups, 'high_risk'])]
                  : fullSettings.allowedRiskGroups.filter(g => g !== 'high_risk');
                patch('allowedRiskGroups', next.length > 0 ? next : ['high_risk']);
              }} />
              High Risk
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <input type="checkbox" checked={fullSettings.allowedRiskGroups.includes('very_high_risk')} onChange={(e) => {
                const next = e.target.checked
                  ? [...new Set([...fullSettings.allowedRiskGroups, 'very_high_risk'])]
                  : fullSettings.allowedRiskGroups.filter(g => g !== 'very_high_risk');
                patch('allowedRiskGroups', next.length > 0 ? next : ['very_high_risk']);
              }} />
              Very High Risk
            </label>
          </div>

          <div style={{ marginTop: 4, fontSize: 7, color: '#58a6ff', background: 'rgba(88,166,255,0.06)', padding: '3px 6px', borderRadius: 3 }}>
            Demo Only &middot; Manual mode: all settings user-controlled.
          </div>

          <button className="btn btn-sm" onClick={resetDefaults} style={{ marginTop: 6, fontSize: 7, padding: '2px 6px', background: 'rgba(72,79,88,0.3)', border: '1px solid rgba(72,79,88,0.4)', color: '#7a8ea8', cursor: 'pointer', width: '100%' }}>
            Reset to Defaults
          </button>
        </>
      )}
    </div>
  );
});

function Chip(props: { label: string; value: string; color?: string }) {
  return (
    <span style={{ padding: '1px 4px', borderRadius: 2, background: 'rgba(255,255,255,0.04)', fontSize: 7 }}>
      <span style={{ color: '#484f58' }}>{props.label}:</span>{' '}
      <span style={{ color: props.color || '#8b949e', fontWeight: 600 }}>{props.value}</span>
    </span>
  );
}

function NumInput(props: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      value={props.value}
      onChange={(e) => props.onChange(Number(e.target.value))}
      step={props.step ?? 1}
      style={{ width: '100%', background: 'rgba(9,15,32,0.85)', color: '#cfe2ff', border: '1px solid rgba(0,234,255,0.12)', borderRadius: 3, padding: '1px 4px', fontSize: 8 }}
    />
  );
}

function TimeInput(props: { value: number; onChange: (v: number) => void; min: number; max: number; unit: string }) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => { setDraft(String(props.value)); }, [props.value]);
  const commit = () => {
    if (draft.trim() === '') return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(props.min, Math.min(props.max, Math.round(parsed)));
    props.onChange(clamped);
    setDraft(String(clamped));
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); } }}
        min={props.min}
        max={props.max}
        style={{ flex: 1, background: 'rgba(9,15,32,0.85)', color: '#cfe2ff', border: '1px solid rgba(0,234,255,0.12)', borderRadius: 3, padding: '1px 4px', fontSize: 8 }}
      />
      <span style={{ color: '#484f58', fontSize: 7, minWidth: 16 }}>{props.unit}</span>
    </div>
  );
}
