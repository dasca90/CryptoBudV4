export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private capacity: number) {}

  push(item: T): { trimmed: number } {
    this.items.push(item);
    const trimmed = Math.max(0, this.items.length - this.capacity);
    if (trimmed > 0) this.items.splice(0, trimmed);
    return { trimmed };
  }

  toArray(): T[] {
    return [...this.items];
  }

  recent(count: number): T[] {
    return this.items.slice(-Math.max(0, count));
  }

  clear(): void {
    this.items = [];
  }

  trimTo(capacity: number): { trimmed: number } {
    this.capacity = Math.max(0, capacity);
    const trimmed = Math.max(0, this.items.length - this.capacity);
    if (trimmed > 0) this.items.splice(0, trimmed);
    return { trimmed };
  }

  get length(): number {
    return this.items.length;
  }

  get max(): number {
    return this.capacity;
  }
}

export interface MemoryHealthAudit {
  jsHeapUsed: number | null;
  jsHeapLimit: number | null;
  visibleLogCount: number;
  internalAuditCount: number;
  scannerCandidateCount: number;
  scannerSnapshotCount: number;
  activeIntervalsCount: number;
  activeSubscriptionsCount: number;
  airScannerObjectCount: number;
  openPositionsCount: number;
  closedPositionsCount: number;
}

export interface MemoryPressureState {
  active: boolean;
  level: 'normal' | 'warning' | 'critical';
  reason: string;
  heapRatio: number | null;
  updatedAt: number;
}

let pressureState: MemoryPressureState = {
  active: false,
  level: 'normal',
  reason: 'none',
  heapRatio: null,
  updatedAt: Date.now(),
};

export function getBrowserHeap(): { used: number | null; limit: number | null; ratio: number | null } {
  try {
    const memory = (performance as any).memory;
    if (!memory || typeof memory.usedJSHeapSize !== 'number') {
      return { used: null, limit: null, ratio: null };
    }
    const used = memory.usedJSHeapSize;
    const limit = typeof memory.jsHeapSizeLimit === 'number' ? memory.jsHeapSizeLimit : null;
    return {
      used,
      limit,
      ratio: limit && limit > 0 ? used / limit : null,
    };
  } catch {
    return { used: null, limit: null, ratio: null };
  }
}

export function updateMemoryPressure(input: {
  heapRatio: number | null;
  visibleLogCount: number;
  visibleLogMax: number;
  internalAuditCount: number;
  internalAuditMax: number;
}): MemoryPressureState {
  const heapWarning = input.heapRatio != null && input.heapRatio >= 0.72;
  const heapCritical = input.heapRatio != null && input.heapRatio >= 0.86;
  const bufferWarning =
    input.visibleLogCount >= input.visibleLogMax ||
    input.internalAuditCount >= input.internalAuditMax;

  const level: MemoryPressureState['level'] = heapCritical
    ? 'critical'
    : heapWarning || bufferWarning
      ? 'warning'
      : 'normal';

  pressureState = {
    active: level !== 'normal',
    level,
    reason: heapCritical ? 'heap_ratio_critical' : heapWarning ? 'heap_ratio_warning' : bufferWarning ? 'buffer_at_capacity' : 'none',
    heapRatio: input.heapRatio,
    updatedAt: Date.now(),
  };
  return pressureState;
}

export function getMemoryPressureState(): MemoryPressureState {
  return pressureState;
}

export function isNonCriticalUiAudit(message: string): boolean {
  return (
    message.startsWith('OPEN_POSITION_UI_CELL_AUDIT') ||
    message.startsWith('POSITION_MANAGER_REACTIVE_RENDER_AUDIT') ||
    message.startsWith('OPEN_POSITIONS_TABLE_COLUMNS_AUDIT') ||
    message.startsWith('VIRTUALIZED_TABLE_RENDER_AUDIT') ||
    message.startsWith('SCANNER_3D_VISUAL_STATE_AUDIT') ||
    message.startsWith('SCANNER_3D_PERFORMANCE_AUDIT') ||
    message.startsWith('AIR_SCANNER_ANIMATION_LOOP_AUDIT')
  );
}

export function formatMemoryHealthAudit(audit: MemoryHealthAudit): string {
  return `MEMORY_HEALTH_AUDIT: jsHeapUsed=${audit.jsHeapUsed ?? 'n/a'} jsHeapLimit=${audit.jsHeapLimit ?? 'n/a'} visibleLogCount=${audit.visibleLogCount} internalAuditCount=${audit.internalAuditCount} scannerCandidateCount=${audit.scannerCandidateCount} scannerSnapshotCount=${audit.scannerSnapshotCount} activeIntervalsCount=${audit.activeIntervalsCount} activeSubscriptionsCount=${audit.activeSubscriptionsCount} airScannerObjectCount=${audit.airScannerObjectCount} openPositionsCount=${audit.openPositionsCount} closedPositionsCount=${audit.closedPositionsCount}`;
}
