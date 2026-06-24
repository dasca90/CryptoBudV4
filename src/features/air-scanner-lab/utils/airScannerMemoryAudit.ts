interface TraversableObject {
  traverse?: (visitor: (node: unknown) => void) => void;
  remove?: (...objects: any[]) => unknown;
  children?: any[];
}

interface RendererInfoLike {
  info?: {
    memory?: {
      geometries?: number;
      textures?: number;
    };
  };
  renderLists?: {
    dispose?: () => void;
  };
}

export interface AirScannerMemoryAuditSnapshot {
  airScannerMeshCount: number;
  airScannerMaterialCount: number;
  airScannerGeometryCount: number;
  airScannerTextureCount: number;
  lightningEffectCount: number;
  pulseImpactCount: number;
  rafActive: boolean;
  cleanupCount: number;
  lastAirScannerCleanupAt: number | null;
}

export interface AirScannerCleanupAudit {
  disposedGeometries: number;
  disposedMaterials: number;
  disposedTextures: number;
  removedSceneObjects: number;
}

let cleanupCount = 0;
let lastAirScannerCleanupAt: number | null = null;

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isTextureLike(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture === true);
}

function countMaterialTextures(material: unknown, textures: Set<unknown>): void {
  if (!material || typeof material !== 'object') return;
  for (const value of Object.values(material as Record<string, unknown>)) {
    if (isTextureLike(value)) textures.add(value);
  }
}

export function recordAirScannerCleanup(now = Date.now()): { cleanupCount: number; lastAirScannerCleanupAt: number } {
  cleanupCount += 1;
  lastAirScannerCleanupAt = now;
  return { cleanupCount, lastAirScannerCleanupAt };
}

export function getAirScannerCleanupStats(): { cleanupCount: number; lastAirScannerCleanupAt: number | null } {
  return { cleanupCount, lastAirScannerCleanupAt };
}

export function resetAirScannerMemoryAuditForTests(): void {
  cleanupCount = 0;
  lastAirScannerCleanupAt = null;
}

export function disposeAirScannerRenderLists(renderer: RendererInfoLike | null | undefined): void {
  renderer?.renderLists?.dispose?.();
}

function disposeMaybe(value: unknown): void {
  if (value && typeof value === 'object' && typeof (value as { dispose?: unknown }).dispose === 'function') {
    (value as { dispose: () => void }).dispose();
  }
}

export function disposeAirScannerSceneResources(root: TraversableObject | null | undefined): AirScannerCleanupAudit {
  const children = [...(root?.children ?? [])];
  const geometries = new Set<unknown>();
  const materials = new Set<unknown>();
  const textures = new Set<unknown>();
  root?.traverse?.((node) => {
    if (!node || typeof node !== 'object') return;
    const object = node as { geometry?: unknown; material?: unknown };
    if (object.geometry) geometries.add(object.geometry);
    disposeMaybe(object.geometry);
    for (const material of asArray(object.material)) {
      materials.add(material);
      countMaterialTextures(material, textures);
      disposeMaybe(material);
    }
  });
  for (const texture of textures) disposeMaybe(texture);
  if (children.length > 0) root?.remove?.(...children);
  return {
    disposedGeometries: geometries.size,
    disposedMaterials: materials.size,
    disposedTextures: textures.size,
    removedSceneObjects: children.length,
  };
}

export function buildAirScannerMemoryAuditSnapshot(input: {
  root?: TraversableObject | null;
  renderer?: RendererInfoLike | null;
  lightningEffectCount: number;
  pulseImpactCount: number;
  rafActive: boolean;
}): AirScannerMemoryAuditSnapshot {
  const meshes = new Set<unknown>();
  const materials = new Set<unknown>();
  const geometries = new Set<unknown>();
  const textures = new Set<unknown>();

  input.root?.traverse?.((node) => {
    if (!node || typeof node !== 'object') return;
    const object = node as { isMesh?: boolean; isInstancedMesh?: boolean; geometry?: unknown; material?: unknown };
    if (object.isMesh === true || object.isInstancedMesh === true) meshes.add(object);
    if (object.geometry) geometries.add(object.geometry);
    for (const material of asArray(object.material)) {
      materials.add(material);
      countMaterialTextures(material, textures);
    }
  });

  const rendererMemory = input.renderer?.info?.memory;
  return {
    airScannerMeshCount: meshes.size,
    airScannerMaterialCount: materials.size,
    airScannerGeometryCount: Math.max(geometries.size, rendererMemory?.geometries ?? 0),
    airScannerTextureCount: Math.max(textures.size, rendererMemory?.textures ?? 0),
    lightningEffectCount: input.lightningEffectCount,
    pulseImpactCount: input.pulseImpactCount,
    rafActive: input.rafActive,
    cleanupCount,
    lastAirScannerCleanupAt,
  };
}

export function formatAirScannerMemoryAudit(snapshot: AirScannerMemoryAuditSnapshot): string {
  return `AIR_SCANNER_MEMORY_AUDIT meshCount=${snapshot.airScannerMeshCount} materialCount=${snapshot.airScannerMaterialCount} geometryCount=${snapshot.airScannerGeometryCount} textureCount=${snapshot.airScannerTextureCount} lightningEffectCount=${snapshot.lightningEffectCount} pulseImpactCount=${snapshot.pulseImpactCount} rafActive=${String(snapshot.rafActive)} cleanupCount=${snapshot.cleanupCount} lastAirScannerCleanupAt=${snapshot.lastAirScannerCleanupAt ?? 'never'}`;
}
