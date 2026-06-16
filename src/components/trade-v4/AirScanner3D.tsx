import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { AirCoinView, TradeV4CandidateView, TradeV4ClosedPositionView, TradeV4OpenPositionView, TradeV4PageModel } from "./types";
import { mapCandidatesToAirCoins } from "../../lib/air-scanner/airCoinVisualMapper";
import { updateAirCoinMotion } from "../../lib/air-scanner/airCoinMotion";
import { useScannerCoinAnimation } from "../../lib/air-scanner/useScannerCoinAnimation";
import { useRafLoop } from "../../hooks/useRafLoop";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { AirCoinNode } from "./AirCoin";
import { getVisualToken, getAllVisualTokens } from "../../lib/air-scanner/scannerVisualStateTheme";
import { logger } from "../../utils/logger";
import "./air-scanner.css";

export const AirScanner3D = memo(function AirScanner3D(props: {
  candidates: TradeV4CandidateView[];
  openPositions: TradeV4OpenPositionView[];
  closedPositions: TradeV4ClosedPositionView[];
  executionPlan?: TradeV4PageModel["executionPlan"];
  paperAutoResult?: TradeV4PageModel["paperAutoResult"];
  selectedSymbol?: string | null;
  active: boolean;
  onSelectSymbol: (symbol: string) => void;
  emptyUniverseReason?: string;
}) {
  const reducedMotion = useReducedMotion();
  const coinRefs = useRef(new Map<string, HTMLButtonElement>());
  const coinsRef = useRef(new Map<string, AirCoinView>());
  const hiddenRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastMotionAuditRef = useRef(0);
  const lastStateRef = useRef(new Map<string, string>());
  const lifecycle = useScannerCoinAnimation({
    candidates: props.candidates,
    openPositions: props.openPositions,
    closedPositions: props.closedPositions,
    executionPlan: props.executionPlan,
    paperAutoResult: props.paperAutoResult,
  });

  useEffect(() => {
    const states = ["floating", "locked_for_buy", "execution_submitted", "position_opened_hold", "pull_to_center"];
    const tokens = states.map(s => getVisualToken(s)).filter(Boolean);
    const colors = tokens.map(t => t!.dotColor);
    const hasDuplicates = new Set(colors).size !== colors.length;
    logger.info(`AIR_SCANNER_LEGEND_BINDING_AUDIT: renderedStates=${states.join('|')} renderedColors=${colors.join('|')} glowColors=${tokens.map(t => t!.legendDotGlow).join('|')} duplicateStyleTokens=${String(hasDuplicates)}`);
  }, []);

  useEffect(() => {
    logger.info(`AIR_SCANNER_MOUNT_LIFECYCLE_AUDIT: event=mounted reason=initial_render layoutMode=${typeof (props as any).scannerMode !== 'undefined' ? String((props as any).scannerMode) : 'n/a'} candidateCount=${props.candidates.length} visualBallCount=0`);
    return () => logger.info(`AIR_SCANNER_MOUNT_LIFECYCLE_AUDIT: event=unmounted reason=component_unmount candidateCount=${props.candidates.length} visualBallCount=${mappedCoins?.length ?? 0}`);
  }, []);

  useEffect(() => {
    if (!props.active || reducedMotion) logger.throttled("INFO", "AIR_SCANNER_PAUSED", "air-scanner-paused", 5000);
    else logger.throttled("INFO", "AIR_SCANNER_RESUMED", "air-scanner-resumed", 5000);
  }, [props.active, reducedMotion]);

  useEffect(() => {
    const onVisibility = () => {
      hiddenRef.current = document.hidden;
      logger.throttled("INFO", document.hidden ? "AIR_SCANNER_PAUSED" : "AIR_SCANNER_RESUMED", "air-scanner-visibility", 3000);
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const mappedCoins = useMemo(() => mapCandidatesToAirCoins({
    candidates: props.candidates,
    openPositions: props.openPositions,
    selectedSymbol: props.selectedSymbol,
    previousCoins: coinsRef.current,
    lifecycleBySymbol: lifecycle.lifecycleBySymbol,
    maxVisible: 24,
  }), [props.candidates, props.openPositions, props.selectedSymbol, lifecycle.lifecycleBySymbol]);

  useEffect(() => {
    coinsRef.current = new Map(mappedCoins.map((coin) => [coin.symbol, coin]));
    for (const c of mappedCoins) {
      const prev = lastStateRef.current.get(c.symbol);
      if (prev !== c.engineState) {
        logger.throttled("INFO", `AIR_SCANNER_VISUAL_STATE_CHANGED: ${c.symbol} ${prev ?? "none"} -> ${c.engineState}`, `air-state-${c.symbol}`, 5000);
        lastStateRef.current.set(c.symbol, c.engineState);
      }
    }
  }, [mappedCoins]);

  useRafLoop(props.active && !reducedMotion, (nowMs) => {
    if (hiddenRef.current) return;
    const start = performance.now();
    coinsRef.current.forEach((coin, symbol) => {
      const next = updateAirCoinMotion(coin, nowMs);
      coinsRef.current.set(symbol, next);
      const node = coinRefs.current.get(symbol);
      if (!node) return;

      const depth = Math.max(0.45, Math.min(1.35, (next.z + 420) / 620));
      const pullProgress = next.engineState === "pull_to_center" ? Math.max(0, Math.min(1, next.pullProgress ?? 0)) : 0;
      const opacity = Math.max(0.05, Math.min(1, (next.z + 360) / 520) * (1 - pullProgress * 0.9));
      const scale = Math.max(0.12, depth * (1 - pullProgress * 0.82));
      node.style.transform = `translate3d(${next.x}px, ${next.y}px, ${next.z}px) scale(${scale})`;
      node.style.opacity = String(opacity);
      node.style.filter = `blur(${Math.max(0, 1.2 - depth)}px)`;
    });
    const ms = performance.now() - start;
    frameCountRef.current++;
    if (frameCountRef.current % 180 === 0) {
      let moving = 0, frozen = 0, buyReady = 0, pulling = 0, positionOpen = 0, blocked = 0;
      coinsRef.current.forEach(coin => {
        if (coin.x !== coin.baseX || coin.y !== coin.baseY) moving++; else frozen++;
        if (coin.engineState === 'locked_for_buy') buyReady++;
        else if (coin.engineState === 'pull_to_center' || coin.engineState === 'execution_submitted') pulling++;
        else if (coin.engineState === 'position_opened_hold') positionOpen++;
        else if (coin.engineState === 'rejected') blocked++;
      });
      logger.info(`SCANNER_3D_VISUAL_STATE_AUDIT: totalCoinsRendered=${coinsRef.current.size} buyReadyVisualCount=${buyReady} pullingToCoreCount=${pulling} openedPositionVisualCount=${positionOpen} blockedVisualCount=${blocked} maxScannerCoinsRendered=24 graphicsQuality=medium fpsEstimate=n/a particleCount=0 activeLightningEffects=${buyReady + pulling} animationLocksCount=0`);
      logger.info(`SCANNER_3D_PERFORMANCE_AUDIT: fpsEstimate=n/a frameTimeMs=n/a totalMeshes=${coinsRef.current.size} totalMaterials=1 totalParticles=0 activeAnimations=${buyReady + pulling} memoryWarning=false graphicsQuality=medium degradationApplied=false`);
      logger.info(`AIR_SCANNER_ANIMATION_LOOP_AUDIT: animationLoopActive=true frameCount=${frameCountRef.current} candidateCount=${coinsRef.current.size} movingBallCount=${moving} frozenBallCount=${frozen}`);
    }
    if (ms > 12) logger.throttled("WARN", `AIR_SCANNER_PERF_DEGRADED: frame=${ms.toFixed(2)}ms`, "air-scanner-perf", 5000);
  });

  return (
    <section className="air-scanner-3d">
      <header className="air-scanner-head">
        <div>
          <div className="panel-title">3D AIR SCANNER</div>
          <div className="legend">
            {["floating", "locked_for_buy", "execution_submitted", "position_opened_hold", "pull_to_center"].map((state) => {
              const token = getVisualToken(state);
              const dotStyle = token ? { background: token.dotColor, boxShadow: token.legendDotGlow } : {};
              const label = token?.label ?? state;
              return (
                <span key={state} className="legend-item">
                  <i className="dot" style={dotStyle} /> <span>{label}</span>
                </span>
              );
            })}
          </div>
        </div>
      </header>

      <div className="scanner-space">
        <div className="scanner-grid" />
        <div className="scanner-core">
          <div className="capture-beam" />
          <div className="capture-ring ring-a" />
          <div className="capture-ring ring-b" />
        </div>

        {props.candidates.length === 0 && props.emptyUniverseReason && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 10, pointerEvents: "none",
          }}>
            <div style={{
              background: "rgba(0,0,0,0.7)", padding: "16px 24px", borderRadius: 8,
              fontSize: 13, color: "#d29922", textAlign: "center", maxWidth: 320,
            }}>
              {props.emptyUniverseReason === "WATCHLIST_EMPTY" && "Watchlist is empty. Add symbols or switch to Binance Top 250."}
              {props.emptyUniverseReason === "ALL_RISK_GROUPS_DISABLED" && "Enable at least one risk group."}
              {props.emptyUniverseReason === "ALL_SYMBOLS_FILTERED" && "All symbols were filtered out. Check risk groups and ban filters."}
              {props.emptyUniverseReason === "EXCHANGE_INFO_NOT_READY" && "Waiting for public market data..."}
              {props.emptyUniverseReason === "TICKERS_NOT_READY" && "Waiting for public market data..."}
              {props.emptyUniverseReason === "UNKNOWN_EMPTY_UNIVERSE" && "Scanner idle. No universe available."}
            </div>
          </div>
        )}

        {mappedCoins.map((coin) => (
          <AirCoinNode
            key={coin.symbol}
            coin={coin}
            refCallback={(node) => {
              if (node) coinRefs.current.set(coin.symbol, node);
              else coinRefs.current.delete(coin.symbol);
            }}
            onClick={() => props.onSelectSymbol(coin.symbol)}
          />
        ))}
      </div>
    </section>
  );
});
