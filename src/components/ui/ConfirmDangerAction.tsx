import { useState } from 'react';

interface Props {
  confirmText: string;
  buttonLabel: string;
  onConfirm: () => void;
  warning?: string;
}

export function ConfirmDangerAction({ confirmText, buttonLabel, onConfirm, warning }: Props) {
  const [step, setStep] = useState<'idle' | 'typing' | 'done'>('idle');
  const [input, setInput] = useState('');

  const handleConfirm = () => {
    if (input === confirmText) {
      onConfirm();
      setStep('done');
      setInput('');
    }
  };

  const handleReset = () => {
    setStep('idle');
    setInput('');
  };

  if (step === 'done') {
    return (
      <div style={{ fontSize: 12, color: '#3fb950', marginTop: 4 }}>
        Done.
      </div>
    );
  }

  return (
    <div>
      {step === 'idle' && (
        <button className="btn btn-sm btn-red" onClick={() => setStep('typing')}>
          {buttonLabel}
        </button>
      )}
      {step === 'typing' && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {warning && <div style={{ fontSize: 11, color: '#f85149' }}>{warning}</div>}
          <div style={{ fontSize: 11, color: '#8b949e' }}>
            Type <strong>{confirmText}</strong> to confirm:
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              className="settings-input"
              style={{ width: 200 }}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={confirmText}
            />
            <button className="btn btn-sm btn-red" disabled={input !== confirmText} onClick={handleConfirm}>
              Confirm
            </button>
            <button className="btn btn-sm" onClick={handleReset}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
