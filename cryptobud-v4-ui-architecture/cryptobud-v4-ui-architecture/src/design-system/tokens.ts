export const designTokens = {
  colors: {
    bgMain: "#030711",
    bgPanel: "rgba(8,16,34,0.86)",
    bgPanelSoft: "rgba(11,22,48,0.68)",
    borderSoft: "rgba(80,220,255,0.18)",
    borderHot: "rgba(0,255,220,0.65)",
    textMain: "#e8f6ff",
    textMuted: "#8ea8ba",
    textDim: "#526575",
    cyan: "#00eaff",
    teal: "#00ffc6",
    green: "#42ff88",
    yellow: "#ffd166",
    orange: "#ff9f1c",
    red: "#ff4d6d",
    violet: "#8a5cff",
    magenta: "#ff3df2",
  },
  radius: {
    sm: 8,
    card: 14,
    panel: 18,
    modal: 20,
  },
  scanner: {
    maxVisibleCoins: 24,
    degradedVisibleCoins: 12,
    perspectivePx: 900,
    candidateUiHz: 1,
    positionUiHz: 4,
    logUiHz: 1,
  },
} as const;

export type DesignTokens = typeof designTokens;
