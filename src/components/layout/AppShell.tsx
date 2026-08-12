import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { MainTabs } from './MainTabs';
import type { MainTab } from '../../state/ui-store';
import type { TradingEngine } from '../../core/trading/TradingEngine';
import type { LiveSafetyState, LiveSafetyCheckResult } from '../../core/types';

interface Props {
  engine: TradingEngine;
  children: ReactNode;
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
  isRunning: boolean;
  liveState: LiveSafetyState;
  liveCheckResult: LiveSafetyCheckResult | null;
  totalEquity: number;
  openPositionCount: number;
  persistenceStatus: 'OK' | 'FALLBACK' | 'ERROR' | 'CHECKING';
  onStart: () => void;
  onStop: () => void;
  onEmergencyStop: () => void;
  onRunLiveCheck: () => void;
  onExecutionModeChange: (mode: 'DEMO' | 'LIVE') => Promise<{ ok: boolean; error?: string }>;
  onExportTrades: () => void;
  onExportML: () => void;
  onExportTraining: () => void;
}

export function AppShell({
  engine, children, activeTab, onTabChange,
  isRunning, liveState, liveCheckResult, totalEquity, openPositionCount,
  persistenceStatus,
  onStart, onStop, onEmergencyStop, onRunLiveCheck, onExecutionModeChange,
  onExportTrades, onExportML, onExportTraining,
}: Props) {
  return (
    <div className="app-shell">
      <TopBar
        liveState={liveState}
        liveCheckResult={liveCheckResult}
        isRunning={isRunning}
        totalEquity={totalEquity}
        openPositionCount={openPositionCount}
        adapterName={engine.getAdapter().name}
        persistenceStatus={persistenceStatus}
        onStart={onStart}
        onStop={onStop}
        onEmergencyStop={onEmergencyStop}
        onRunLiveCheck={onRunLiveCheck}
        onExecutionModeChange={onExecutionModeChange}
        onExportTrades={onExportTrades}
        onExportML={onExportML}
        onExportTraining={onExportTraining}
      />
      <MainTabs activeTab={activeTab} onTabChange={onTabChange} />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
