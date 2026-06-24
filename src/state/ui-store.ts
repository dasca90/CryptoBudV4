import { useState, useCallback } from 'react';
import type { ScannerSnapshot, ScalperSnapshot, UniverseMode, ManualAnalysisSnapshot } from '../core/types';

export type MainTab = 'trade' | 'air-scanner' | 'journal' | 'ml-lab' | 'logs' | 'settings';
export type TradeMode = 'AUTO' | 'MANUAL' | 'SCALPER';
export type LogLevel = 'ALL' | 'INFO' | 'WARN' | 'ERROR' | 'TRADE';
export type JournalFilter = 'ALL' | 'WINNERS' | 'LOSERS' | 'GOOD' | 'MEDIUM' | 'BAD' | 'training' | 'excluded';
export type ChartPeriod = '5m' | '15m' | '1h' | '4h' | '1d';

export interface UIState {
  activeMainTab: MainTab;
  activeTradeMode: TradeMode;
  selectedSymbol: string | null;
  selectedCandidateId: string | null;
  selectedChartPeriod: ChartPeriod;
  selectedLogLevel: LogLevel;
  selectedJournalFilter: JournalFilter;
  showAdvancedSettings: boolean;
  chartData: { time: number; price: number }[];
  equityHistory: { time: number; equity: number }[];
  universeMode: UniverseMode;
  scannerSnapshot: ScannerSnapshot | null;
  scalperSnapshot: ScalperSnapshot | null;
  manualAnalysisSnapshot: ManualAnalysisSnapshot | null;
  lastScanTime: number;
  scannerRunning: boolean;
  scalperRunning: boolean;
}

export function createUIStore() {
  const [state, setState] = useState<UIState>({
    activeMainTab: 'trade',
    activeTradeMode: 'AUTO',
    selectedSymbol: null,
    selectedCandidateId: null,
    selectedChartPeriod: '1h',
    selectedLogLevel: 'ALL',
    selectedJournalFilter: 'ALL',
    showAdvancedSettings: false,
    chartData: [],
    equityHistory: [],
    universeMode: 'WATCHLIST',
    scannerSnapshot: null,
    scalperSnapshot: null,
    manualAnalysisSnapshot: null,
    lastScanTime: 0,
    scannerRunning: false,
    scalperRunning: false,
  });

  const setMainTab = useCallback((tab: MainTab) => {
    setState(s => ({ ...s, activeMainTab: tab }));
  }, []);

  const setTradeMode = useCallback((mode: TradeMode) => {
    setState(s => ({ ...s, activeTradeMode: mode }));
  }, []);

  const selectSymbol = useCallback((symbol: string | null) => {
    setState(s => ({ ...s, selectedSymbol: symbol, selectedCandidateId: symbol }));
  }, []);

  const setChartPeriod = useCallback((period: ChartPeriod) => {
    setState(s => ({ ...s, selectedChartPeriod: period }));
  }, []);

  const setLogLevel = useCallback((level: LogLevel) => {
    setState(s => ({ ...s, selectedLogLevel: level }));
  }, []);

  const setJournalFilter = useCallback((filter: JournalFilter) => {
    setState(s => ({ ...s, selectedJournalFilter: filter }));
  }, []);

  const toggleAdvanced = useCallback(() => {
    setState(s => ({ ...s, showAdvancedSettings: !s.showAdvancedSettings }));
  }, []);

  const addChartData = useCallback((time: number, price: number) => {
    setState(s => {
      const data = [...s.chartData, { time, price }].slice(-200);
      return { ...s, chartData: data };
    });
  }, []);

  const addEquityPoint = useCallback((time: number, equity: number) => {
    setState(s => {
      const history = [...s.equityHistory, { time, equity }].slice(-500);
      return { ...s, equityHistory: history };
    });
  }, []);

  const setScannerSnapshot = useCallback((snapshot: ScannerSnapshot | null) => {
    setState(s => ({ ...s, scannerSnapshot: snapshot, lastScanTime: Date.now() }));
  }, []);

  const setScannerRunning = useCallback((running: boolean) => {
    setState(s => ({ ...s, scannerRunning: running }));
  }, []);

  const setScalperSnapshot = useCallback((snapshot: ScalperSnapshot | null) => {
    setState(s => ({ ...s, scalperSnapshot: snapshot }));
  }, []);

  const setManualAnalysisSnapshot = useCallback((snapshot: ManualAnalysisSnapshot | null) => {
    setState(s => ({ ...s, manualAnalysisSnapshot: snapshot }));
  }, []);

  const setScalperRunning = useCallback((running: boolean) => {
    setState(s => ({ ...s, scalperRunning: running }));
  }, []);

  const setUniverseMode = useCallback((mode: UniverseMode) => {
    setState(s => ({ ...s, universeMode: mode }));
  }, []);

  return {
    state,
    setMainTab,
    setTradeMode,
    selectSymbol,
    setChartPeriod,
    setLogLevel,
    setJournalFilter,
    toggleAdvanced,
    addChartData,
    addEquityPoint,
    setScannerSnapshot,
    setScannerRunning,
    setScalperSnapshot,
    setManualAnalysisSnapshot,
    setScalperRunning,
    setUniverseMode,
  };
}

export type UIStore = ReturnType<typeof createUIState>;
function createUIState() {
  return {
    state: {
      activeMainTab: 'trade' as MainTab,
      activeTradeMode: 'AUTO' as TradeMode,
      selectedSymbol: null as string | null,
      selectedCandidateId: null as string | null,
      selectedChartPeriod: '1h' as ChartPeriod,
      selectedLogLevel: 'ALL' as LogLevel,
      selectedJournalFilter: 'ALL' as JournalFilter,
      showAdvancedSettings: false,
      chartData: [] as { time: number; price: number }[],
      equityHistory: [] as { time: number; equity: number }[],
      universeMode: 'WATCHLIST' as UniverseMode,
      scannerSnapshot: null as ScannerSnapshot | null,
      scalperSnapshot: null as ScalperSnapshot | null,
      manualAnalysisSnapshot: null as ManualAnalysisSnapshot | null,
      lastScanTime: 0,
      scannerRunning: false,
      scalperRunning: false,
    },
    setMainTab: (tab: MainTab) => {},
    setTradeMode: (mode: TradeMode) => {},
    selectSymbol: (symbol: string | null) => {},
    setChartPeriod: (period: ChartPeriod) => {},
    setLogLevel: (level: LogLevel) => {},
    setJournalFilter: (filter: JournalFilter) => {},
    toggleAdvanced: () => {},
    addChartData: (time: number, price: number) => {},
    addEquityPoint: (time: number, equity: number) => {},
    setScannerSnapshot: (_snapshot: ScannerSnapshot | null) => {},
    setScannerRunning: (_running: boolean) => {},
    setScalperSnapshot: (_snapshot: ScalperSnapshot | null) => {},
    setManualAnalysisSnapshot: (_snapshot: ManualAnalysisSnapshot | null) => {},
    setScalperRunning: (_running: boolean) => {},
    setUniverseMode: (_mode: UniverseMode) => {},
  };
}
