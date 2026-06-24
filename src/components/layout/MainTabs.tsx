import type { MainTab } from '../../state/ui-store';

interface Props {
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
}

const TABS: { key: MainTab; label: string }[] = [
  { key: 'trade', label: 'Trade' },
  { key: 'air-scanner', label: '3D Scanner' },
  { key: 'journal', label: 'Journal' },
  { key: 'ml-lab', label: 'ML Lab' },
  { key: 'logs', label: 'Logs' },
  { key: 'settings', label: 'Settings' },
];

export function MainTabs({ activeTab, onTabChange }: Props) {
  return (
    <nav className="main-tabs">
      {TABS.map(t => (
        <button
          key={t.key}
          className={`main-tab ${activeTab === t.key ? 'active' : ''}`}
          onClick={() => onTabChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
