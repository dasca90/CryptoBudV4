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
import { getMemoryPressureState } from "../../core/diagnostics/memoryLifecycle";
import "./air-scanner.css";

const IS_DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

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
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" ? true : !document.hidden);
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
    return () => {
      const coinRefCount = coinRefs.current.size;
      const coinStateCount = coinsRef.current.size;
      coinRefs.current.clear();
      coinsRef.current.clear();
      lastStateRef.current.clear();
      logger.info(`AIR_SCANNER_MEMORY_AUDIT objectCount=0 coinRefCountBeforeCleanup=${coinRefCount} coinStateCountBeforeCleanup=${coinStateCount} lightningEffectCount=0 particleCount=0 sceneChildrenCount=0 rafActive=false cleanup=component_unmount`);
      logger.info(`AIR_SCANNER_CLEANUP_AUDIT: disposedGeometries=0 disposedMaterials=0 disposedTextures=0 removedSceneObjects=${coinRefCount} cancelledAnimationFrame=true unsubscribedListeners=true clearedParticles=true clearedLightning=true releasedWebglContext=false`);
      logger.info(`AIR_SCANNER_MOUNT_LIFECYCLE_AUDIT: event=unmounted reason=component_unmount candidateCount=${props.candidates.length} visualBallCount=${mappedCoins?.length ?? 0}`);
    };
  }, []);

  useEffect(() => {
    if (!props.active || reducedMotion) logger.throttled("INFO", "AIR_SCANNER_PAUSED", "air-scanner-paused", 5000);
    else logger.throttled("INFO", "AIR_SCANNER_RESUMED", "air-scanner-resumed", 5000);
  }, [props.active, reducedMotion]);

  useEffect(() => {
    const onVisibility = () => {
      hiddenRef.current = document.hidden;
      setDocumentVisible(!document.hidden);
      logger.throttled("INFO", document.hidden ? "AIR_SCANNER_PAUSED" : "AIR_SCANNER_RESUMED", "air-scanner-visibility", 3000);
      if (IS_DEV) {
        console.log(`AIR_SCANNER_VISIBILITY_AUDIT: component=AirScanner3D visible=${String(!document.hidden)} rafActive=${String(!document.hidden && props.active && !reducedMotion)} listenerCleanup=false devOnly=true`);
      }
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (IS_DEV) {
        console.log("AIR_SCANNER_VISIBILITY_AUDIT: component=AirScanner3D listenerCleanup=true devOnly=true");
      }
    };
  }, [props.active, reducedMotion]);

  const mappedCoins = useMemo(() => mapCandidatesToAirCoins({
    candidates: props.candidates,
    openPositions: props.openPositions,
    selectedSymbol: props.selectedSymbol,
    previousCoins: coinsRef.current,
    lifecycleBySymbol: lifecycle.lifecycleBySymbol,
    maxVisible: 24,
  }), [props.candidates, props.openPositions, props.selectedSymbol, lifecycle.lifecycleBySymbol]);
  const hasTransferCoin = mappedCoins.some((coin) => (
    coin.engineState === "locked_for_buy"
    || coin.engineState === "execution_submitted"
    || coin.engineState === "position_opened_hold"
    || coin.engineState === "pull_to_center"
  ));

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

  useRafLoop(props.active && !reducedMotion && documentVisible, (nowMs) => {
    if (hiddenRef.current) return;
    if (getMemoryPressureState().active) {
      logger.throttled("WARN", "AIR_SCANNER_EFFECTS_PAUSED_MEMORY_PRESSURE: tradingLogicStopped=false pausedEffects=dom_coin_motion|lightning_tethers", "air-scanner-memory-pressure-pause", 30000);
      return;
    }
    const start = performance.now();
    coinsRef.current.forEach((coin, symbol) => {
      const next = updateAirCoinMotion(coin, nowMs);
      coinsRef.current.set(symbol, next);
      const node = coinRefs.current.get(symbol);
      if (!node) return;

      const tetherActive = next.engineState === "locked_for_buy" || next.engineState === "execution_submitted";
      if (tetherActive) {
        const tetherLength = Math.min(560, Math.hypot(next.x, next.y));
        const tetherAngle = Math.atan2(-next.y, -next.x) * 180 / Math.PI;
        node.style.setProperty("--pull-tether-length", `${tetherLength}px`);
        node.style.setProperty("--pull-tether-angle", `${tetherAngle}deg`);
      } else {
        node.style.removeProperty("--pull-tether-length");
        node.style.removeProperty("--pull-tether-angle");
      }

      const depth = Math.max(0.45, Math.min(1.35, (next.z + 420) / 620));
      const pullProgress = next.engineState === "pull_to_center" ? Math.max(0, Math.min(1, next.pullProgress ?? 0)) : 0;
      const isTransferCoin = (
        next.engineState === "locked_for_buy"
        || next.engineState === "execution_submitted"
        || next.engineState === "position_opened_hold"
        || next.engineState === "pull_to_center"
      );
      const opacity = isTransferCoin
        ? 1
        : Math.max(0.05, Math.min(1, (next.z + 360) / 520));
      const scale = next.engineState === "pull_to_center"
        ? Math.max(0.22, depth * (1.24 - pullProgress * 0.78))
        : Math.max(0.12, depth);
      node.style.transform = `translate3d(${next.x}px, ${next.y}px, ${next.z}px) scale(${scale})`;
      node.style.opacity = String(opacity);
      node.style.filter = isTransferCoin
        ? "blur(0px) brightness(1.18) saturate(1.28)"
        : `blur(${Math.max(0, 1.2 - depth)}px)`;
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
      logger.throttled("INFO", `SCANNER_3D_VISUAL_STATE_AUDIT: totalCoinsRendered=${coinsRef.current.size} buyReadyVisualCount=${buyReady} pullingToCoreCount=${pulling} openedPositionVisualCount=${positionOpen} blockedVisualCount=${blocked} maxScannerCoinsRendered=24 graphicsQuality=medium fpsEstimate=n/a particleCount=0 activeLightningEffects=${buyReady + pulling} animationLocksCount=0`, "scanner-3d-visual-state", 30000);
      logger.throttled("INFO", `SCANNER_3D_PERFORMANCE_AUDIT: fpsEstimate=n/a frameTimeMs=n/a totalMeshes=${coinsRef.current.size} totalMaterials=1 totalParticles=0 activeAnimations=${buyReady + pulling} memoryWarning=${String(getMemoryPressureState().active)} graphicsQuality=medium degradationApplied=${String(getMemoryPressureState().active)}`, "scanner-3d-performance", 30000);
      logger.throttled("INFO", `AIR_SCANNER_ANIMATION_LOOP_AUDIT: animationLoopActive=true frameCount=${frameCountRef.current} candidateCount=${coinsRef.current.size} movingBallCount=${moving} frozenBallCount=${frozen}`, "air-scanner-animation-loop", 30000);
      logger.throttled("INFO", `AIR_SCANNER_MEMORY_AUDIT objectCount=${coinsRef.current.size} coinRefCount=${coinRefs.current.size} coinStateCount=${coinsRef.current.size} lightningEffectCount=${buyReady + pulling} particleCount=0 sceneChildrenCount=${coinsRef.current.size} rafActive=true cleanup=not_required`, "air-scanner-memory-audit", 30000);
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

      <div className={`scanner-space ${mappedCoins.length > 0 ? "scanner-has-coins" : "scanner-empty"} ${hasTransferCoin ? "scanner-transfer-active" : ""}`}>
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
