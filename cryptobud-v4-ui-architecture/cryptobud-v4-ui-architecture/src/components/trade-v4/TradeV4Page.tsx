import { useMemo, useState } from "react";
import "../../design-system/theme.css";
import "../../design-system/components.css";
import type { TradeV4Candidate, TradeV4ClosedPosition, TradeV4OpenPosition } from "../../types/trade-v4";
import { TopStatusBar } from "./TopStatusBar";
import { SideNavigation } from "./SideNavigation";
import { ControlTowerPanel } from "./ControlTowerPanel";
import { AirScanner3D } from "./AirScanner3D";
import { SelectedCoinInspector } from "./SelectedCoinInspector";
import { OpenPositionsPanel } from "./OpenPositionsPanel";
import { ClosedPositionsPanel } from "./ClosedPositionsPanel";
import { CandidateTable } from "./CandidateTable";
import { getTabSymbol } from "../../lib/ui/uiSymbolMapper";

/**
 * TradeV4Page is UI-only.
 *
 * It must receive data from existing store/selectors.
 * It must never decide BUY/SELL.
 * It only maps real engine state to visual state.
 */
export function TradeV4Page(props: {
  candidates: TradeV4Candidate[];
  openPositions: TradeV4OpenPosition[];
  closedPositions: TradeV4ClosedPosition[];
  scannerRunning: boolean;
  engineOnline: boolean;
  mode: "PAPER" | "LIVE";
  capital: number;
  usedCapital: number;
  pnlToday: number;
  dataQuality: "GOOD" | "MEDIUM" | "BAD";
  onStartScanner: () => void;
  onStopScanner: () => void;
  onManualBuy: (symbol: string) => void;
  onAddWatchlist: (symbol: string) => void;
}) {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(props.candidates[0]?.symbol ?? null);

  const selectedCandidate = useMemo(
    () => props.candidates.find((c) => c.symbol === selectedSymbol) ?? props.candidates[0],
    [props.candidates, selectedSymbol],
  );

  return (
    <div className="trade-v4-shell">
      <div className="trade-v4-grid">
        <TopStatusBar
          scannerRunning={props.scannerRunning}
          engineOnline={props.engineOnline}
          mode={props.mode}
          capital={props.capital}
          usedCapital={props.usedCapital}
          openPositions={props.openPositions.length}
          maxPositions={4}
          pnlToday={props.pnlToday}
          dataQuality={props.dataQuality}
          onStartScanner={props.onStartScanner}
          onStopScanner={props.onStopScanner}
        />

        <SideNavigation />

        <ControlTowerPanel
          scannerRunning={props.scannerRunning}
          candidateCount={props.candidates.length}
          engineReviewCount={props.candidates.filter((c) => c.engineState === "engine_review").length}
          openCount={props.openPositions.length}
          closedTodayCount={props.closedPositions.length}
          capital={props.capital}
          usedCapital={props.usedCapital}
        />

        <div className="air-scanner-wrap panel">
          <AirScanner3D
            candidates={props.candidates}
            openPositions={props.openPositions}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            active={props.scannerRunning}
          />
        </div>

        <div className="inspector-wrap panel">
          <SelectedCoinInspector
            candidate={selectedCandidate}
            onManualBuy={props.onManualBuy}
            onAddWatchlist={props.onAddWatchlist}
          />
        </div>

        <div className="bottom-trade-panels">
          <OpenPositionsPanel positions={props.openPositions} />
          <ClosedPositionsPanel positions={props.closedPositions} />
          <CandidateTable
            candidates={props.candidates}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
          />
        </div>

        <div className="bottom-nav panel">
          {getTabSymbol("Overview")} Dashboard · {getTabSymbol("Scanner")} Scanner · {getTabSymbol("Positions")} Positions · {getTabSymbol("Journal")} Journal · {getTabSymbol("Reports")} Reports · {getTabSymbol("ML Lab")} ML Lab · {getTabSymbol("Settings")} Settings
        </div>
      </div>
    </div>
  );
}
