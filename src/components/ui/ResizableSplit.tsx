import { useRef, useCallback, useState, useEffect } from "react";
import { usePanelSizes, type PanelSizeConfig } from "../../lib/ui/usePanelSizes";
import { logger } from "../../utils/logger";

export function ResizableSplit(props: {
  direction: "horizontal" | "vertical";
  storageKey: string;
  configs: PanelSizeConfig[];
  children: React.ReactNode[];
  style?: React.CSSProperties;
  className?: string;
}) {
  const [sizes, onDrag, resetSizes, commitSizes] = usePanelSizes(props.storageKey, props.configs);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  const startPosRef = useRef<{ x: number; y: number; sizes: number[] }>({ x: 0, y: 0, sizes: [] });
  const rafRef = useRef<number>(0);
  const deltaRef = useRef(0);

  // Log layout dimensions on mount
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const dim = props.direction === "horizontal" ? rect.width : rect.height;
      logger.info(`TRADE_V4_LAYOUT_MOUNTED: storageKey=${props.storageKey} direction=${props.direction} containerPx=${dim.toFixed(0)} sizes=${sizes.join(',')} minConfs=${props.configs.map(c => c.minPx).join(',')}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const currentSizes = [...sizesRef.current];
    startPosRef.current = { x: e.clientX, y: e.clientY, sizes: currentSizes };
    deltaRef.current = 0;

    logger.info(`TRADE_LAYOUT_RESIZE_START: storageKey=${props.storageKey} handle=${index} startX=${e.clientX} startY=${e.clientY} startSizes=${currentSizes.join(',')}`);

    setDragging(index);

    const onMove = (ev: MouseEvent) => {
      const deltaPx = props.direction === "horizontal"
        ? ev.clientX - startPosRef.current.x
        : ev.clientY - startPosRef.current.y;
      deltaRef.current = deltaPx;

      // raf throttling: batch updates at most once per frame
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          if (Math.abs(deltaRef.current) >= 1) {
            onDrag(index, deltaRef.current);
            const current = sizesRef.current;
            const cfg = props.configs[index];
            const clamped = Math.max(cfg.minPx, Math.min(current[index], cfg.maxPx || Infinity));
            logger.throttled('INFO', `TRADE_LAYOUT_RESIZE_UPDATE: storageKey=${props.storageKey} handle=${index} deltaPx=${deltaRef.current.toFixed(0)} proposedSize=${clamped.toFixed(0)} clampedSize=${clamped.toFixed(0)}`, `layout_resize_${props.storageKey}`, 500);
          }
        });
      }
    };

    const onUp = () => {
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      setDragging(null);
      commitSizes();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [props.direction, props.storageKey, props.configs, onDrag, commitSizes]);

  const handleDoubleClick = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resetSizes();
  }, [resetSizes]);

  const isHoriz = props.direction === "horizontal";
  const rawTotal = sizes.reduce((a, b) => a + b, 0);
  const totalPx = isFinite(rawTotal) && rawTotal > 0 ? rawTotal : props.configs.reduce((a, c) => a + c.defaultPx, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "hidden", ...props.style }}>
      <div
        ref={containerRef}
        className={`resizable-split ${isHoriz ? "resizable-split-h" : "resizable-split-v"}${props.className ? ` ${props.className}` : ""}`}
        style={{
          display: "flex",
          flexDirection: isHoriz ? "row" : "column",
          flex: "1 1 0",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          userSelect: dragging !== null ? "none" : undefined,
        }}
      >
        {props.children.map((child, i) => {
          const currentPx = sizes[i] || props.configs[i].defaultPx;
          const safePct = totalPx > 0 ? Math.max(1, (currentPx / totalPx) * 100) : (100 / Math.max(1, props.children.length));
          const tooSmall = currentPx > 0 && currentPx < props.configs[i].minPx * 0.5;
          return (
            <div key={i} className="split-child-panel" style={{ flex: `0 0 ${safePct}%`, overflow: "hidden", minWidth: 0, minHeight: 0 }}>
              {tooSmall ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 10, color: '#f85149', background: 'rgba(248,81,73,0.08)', padding: 8 }}>
                  Panel too small ({currentPx.toFixed(0)}px) — <button className="btn btn-sm" onClick={resetSizes} style={{ marginLeft: 8, fontSize: 9, padding: '2px 6px', background: 'rgba(248,81,73,0.15)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149', cursor: 'pointer' }}>Reset Layout</button>
                </div>
              ) : (
                child
              )}
            </div>
          );
        }).reduce<React.ReactNode[]>((acc, panel, i) => {
          acc.push(panel);
          if (i < props.children.length - 1) {
            acc.push(
              <div
                key={`handle-${i}`}
                className={`resize-handle ${isHoriz ? "resize-handle-h" : "resize-handle-v"}${dragging === i ? " resize-handle-active" : ""}`}
                onMouseDown={(e) => handleMouseDown(i, e)}
                onDoubleClick={(e) => handleDoubleClick(i, e)}
                title={`Drag to resize${isHoriz ? " width" : " height"}. Double-click to reset.`}
              />,
            );
          }
          return acc;
        }, [])}
      </div>
      <button
        className="btn btn-sm"
        onClick={() => resetSizes()}
        style={{
          fontSize: 7,
          padding: '1px 6px',
          background: 'rgba(72,79,88,0.2)',
          border: '1px solid rgba(72,79,88,0.3)',
          color: '#484f58',
          borderRadius: 3,
          cursor: 'pointer',
          marginTop: 2,
          alignSelf: 'center',
        }}
        title="Restore default panel sizes"
      >
        Reset Layout
      </button>
    </div>
  );
}
