import { getTabSymbol, type NavTabKey } from "../../lib/ui/uiSymbolMapper";

const items: { key: NavTabKey; label: string; tooltip: string }[] = [
  { key: "Overview", label: "OVR", tooltip: "Overview — System status" },
  { key: "Scanner", label: "SCN", tooltip: "Scanner — 3D Air Scanner view" },
  { key: "Positions", label: "POS", tooltip: "Positions — Open & closed trades" },
  { key: "Journal", label: "JRN", tooltip: "Journal — Switch to Journal tab" },
  { key: "ML Lab", label: "ML", tooltip: "ML Lab — Machine Learning tools" },
  { key: "Settings", label: "SET", tooltip: "Settings — Switch to Settings tab" },
];

export function SideNavigation() {
  return (
    <nav className="side-nav panel">
      {items.map((item, index) => (
        <div
          key={item.key}
          className="side-nav-item"
          style={{
            height: 42,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            marginBottom: 6,
            color: index === 0 ? "var(--neon-cyan)" : "var(--text-muted)",
            background: index === 0 ? "rgba(0,234,255,0.08)" : "transparent",
            cursor: "pointer",
            transition: "background 0.12s, color 0.12s",
          }}
          title={item.tooltip}
        >
          <span style={{ fontSize: 12, lineHeight: 1, fontWeight: 700 }}>{getTabSymbol(item.key)}</span>
          <span style={{ fontSize: 7, color: "var(--text-muted)", marginTop: 2, letterSpacing: "0.04em" }}>{item.label}</span>
        </div>
      ))}
    </nav>
  );
}
