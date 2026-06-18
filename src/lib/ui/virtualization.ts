import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface VirtualWindow {
  scrollRef: RefObject<HTMLDivElement>;
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
  totalHeightPx: number;
  isVirtualized: boolean;
  onScroll: () => void;
}

export function getVirtualRange(params: {
  total: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
  threshold?: number;
}): Omit<VirtualWindow, 'scrollRef' | 'onScroll'> {
  const total = Math.max(0, params.total);
  const rowHeight = Math.max(1, params.rowHeight);
  const overscan = Math.max(0, params.overscan ?? 6);
  const threshold = Math.max(0, params.threshold ?? 0);
  const isVirtualized = total > threshold;
  if (!isVirtualized || total === 0) {
    return {
      startIndex: 0,
      endIndex: total,
      visibleCount: total,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
      totalHeightPx: total * rowHeight,
      isVirtualized,
    };
  }

  const viewportHeight = Math.max(rowHeight, params.viewportHeight || rowHeight * 10);
  const firstVisible = Math.floor(Math.max(0, params.scrollTop) / rowHeight);
  const visibleRows = Math.ceil(viewportHeight / rowHeight);
  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(total, firstVisible + visibleRows + overscan);
  return {
    startIndex,
    endIndex,
    visibleCount: endIndex - startIndex,
    topSpacerPx: startIndex * rowHeight,
    bottomSpacerPx: Math.max(0, (total - endIndex) * rowHeight),
    totalHeightPx: total * rowHeight,
    isVirtualized,
  };
}

export function useVirtualWindow(params: {
  total: number;
  rowHeight: number;
  threshold?: number;
  overscan?: number;
}): VirtualWindow {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    measure();
  }, [params.total, measure]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  }, []);

  const range = useMemo(() => getVirtualRange({
    total: params.total,
    scrollTop,
    viewportHeight,
    rowHeight: params.rowHeight,
    threshold: params.threshold,
    overscan: params.overscan,
  }), [params.total, params.rowHeight, params.threshold, params.overscan, scrollTop, viewportHeight]);

  return { scrollRef, onScroll, ...range };
}
