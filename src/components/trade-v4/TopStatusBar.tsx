import { memo } from "react";
import { getTitleSymbol } from "../../lib/ui/uiSymbolMapper";
import { logger } from "../../utils/logger";
import { getExecutionModeDisplay } from "../../lib/execution/executionDisplay";

export const TopStatusBar = memo(function TopStatusBar(props: {
  scannerRunning: boolean;
  engineOnline: boolean;
  mode: "PAPER" | "LIVE_LOCKED";
  capital: number;
  usedCapital: number;
  openPositions: number;
  maxPositions: number;
  pnlToday: number;
  dataQuality: "GOOD" | "MEDIUM" | "BAD" | "UNKNOWN";
  onStartScanner: () => void;
  onStopScanner: () => void;
  onTogglePaperAuto?: () => void;
  paperAutoEnabled?: boolean;
}) {
  logger.throttled('INFO', `OPEN_POSITIONS_LIMIT_SOURCE: openCount=${props.openPositions} displayedMax=${props.maxPositions} sourceKey=maxOpenPositions source=user_parameters_via_TradeV4Page`, 'open_positions_limit_source', 30000);
  if (props.openPositions > props.maxPositions) {
    logger.throttled('WARN', `OPEN_POSITIONS_OVER_USER_LIMIT_RESTORED: openCount=${props.openPositions} maxOpenPositions=${props.maxPositions} reason=restored_positions_kept_block_new_buys`, 'open_positions_over_limit_restored', 30000);
  }
  return (
    <header className="top-status-bar panel">
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--cyan)" }}>{getTitleSymbol("3D AIR SCANNER")}</span>
          CryptoBud V4
        </div>
        <div className="status-info mono" style={{ fontSize: 11, letterSpacing: "0.18em" }}>3D AIR SCANNER</div>
      </div>

      <Status label="ENGINE" value={props.engineOnline ? "ONLINE" : "OFFLINE"} good={props.engineOnline} />
      <Status label="SCANNER" value={props.scannerRunning ? "RUNNING" : "STOPPED"} good={props.scannerRunning} />
      <Status label="MODE" value={props.mode === "PAPER" ? "DEMO" : props.mode} good={getExecutionModeDisplay(props.mode) === "demo"} />
      <Status label="CAPITAL" value={`$${props.capital.toFixed(2)}`} />
      <Status label="USED" value={`$${props.usedCapital.toFixed(2)}`} />
      <Status label="OPEN POSITIONS" value={`${props.openPositions} / ${props.maxPositions}`} />
      <Status label="PNL TODAY" value={`${props.pnlToday >= 0 ? "+" : ""}$${props.pnlToday.toFixed(2)}`} good={props.pnlToday >= 0} />
      <Status label="DATA QUALITY" value={props.dataQuality} good={props.dataQuality === "GOOD"} />
      <button
        className={props.scannerRunning ? "btn btn-danger" : "btn btn-primary"}
        onClick={props.scannerRunning ? props.onStopScanner : props.onStartScanner}
      >
        {props.scannerRunning ? "STOP SCANNER" : "START SCANNER"}
      </button>
      <button
        className={props.paperAutoEnabled ? "btn btn-sm btn-primary" : "btn btn-sm btn-default"}
        onClick={props.onTogglePaperAuto}
        title="Toggle AutoBots Execution"
      >
        AutoBots: {props.paperAutoEnabled ? "ON" : "OFF"}
      </button>
    </header>
  );
});

function Status(props: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <div style={{ color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.12em" }}>{props.label}</div>
      <div className={props.good === undefined ? "mono" : props.good ? "mono status-good" : "mono status-warn"} style={{ fontSize: 13, fontWeight: 700 }}>
        {props.value}
      </div>
    </div>
  );
}


