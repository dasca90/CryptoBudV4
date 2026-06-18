import type { AirScannerQuality, CoinVisualState, ScannerToggles } from '../state/airScannerVisualState';

interface StateControlPanelProps {
  visualState: CoinVisualState;
  quality: AirScannerQuality;
  toggles: ScannerToggles;
  onStateChange: (state: CoinVisualState) => void;
  onQualityChange: (quality: AirScannerQuality) => void;
  onToggleChange: (key: keyof ScannerToggles, value: boolean) => void;
  onReset: () => void;
}

const states: Array<{ label: string; value: CoinVisualState }> = [
  { label: 'State 01 Scanning', value: 'scanning' },
  { label: 'State 02 Wait', value: 'wait' },
  { label: 'State 03 Buy Pull', value: 'buy_pull_to_core' },
  { label: 'State 04 Blocked', value: 'blocked_push_out' },
  { label: 'State 05 Open Position', value: 'open_position' },
];

const qualities: AirScannerQuality[] = ['low', 'balanced', 'high'];

export function StateControlPanel({ visualState, quality, toggles, onStateChange, onQualityChange, onToggleChange, onReset }: StateControlPanelProps) {
  return (
    <aside className="air-lab-controls" aria-label="Air scanner lab controls">
      <div className="air-lab-brand">
        <span>CryptoBud v4</span>
        <b>Prototype Lab</b>
      </div>
      <section>
        <h2>Animation Controls</h2>
        {states.map((state) => (
          <button key={state.value} type="button" className={visualState === state.value ? 'is-active' : ''} onClick={() => onStateChange(state.value)}>
            {state.label}
          </button>
        ))}
        <button type="button" className="air-lab-reset" onClick={onReset}>
          Reset Scene
        </button>
      </section>
      <section>
        <h2>Quality</h2>
        <div className="air-lab-segments">
          {qualities.map((item) => (
            <button key={item} type="button" className={quality === item ? 'is-active' : ''} onClick={() => onQualityChange(item)}>
              {item}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>Graphics Toggles</h2>
        {(Object.keys(toggles) as Array<keyof ScannerToggles>).map((key) => (
          <label key={key} className="air-lab-toggle">
            <span>{key.replace(/([A-Z])/g, ' $1')}</span>
            <input type="checkbox" checked={toggles[key]} onChange={(event) => onToggleChange(key, event.target.checked)} />
          </label>
        ))}
      </section>
    </aside>
  );
}
