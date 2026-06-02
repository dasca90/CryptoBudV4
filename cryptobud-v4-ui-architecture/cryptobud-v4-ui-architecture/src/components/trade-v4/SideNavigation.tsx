import { getTabSymbol, type NavTabKey } from "../../lib/ui/uiSymbolMapper";

const items: NavTabKey[] = ["Overview", "Scanner", "Positions", "Strategies", "Markets", "Alerts", "Journal", "Reports", "ML Lab", "Settings"];

export function SideNavigation() {
  return (
    <nav className="side-nav panel">
      {items.map((item, index) => (
        <div
          key={item}
          style={{
            height: 42,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            marginBottom: 6,
            color: index === 0 ? "var(--cyan)" : "var(--text-muted)",
            background: index === 0 ? "rgba(0,234,255,0.08)" : "transparent",
          }}
          title={item}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>{getTabSymbol(item)}</span>
        </div>
      ))}
    </nav>
  );
}
