import { useState, useEffect } from 'react';
import type { AiTakeoverMode } from '../../core/ai/AiTakeoverTypes';
import { AI_TAKEOVER_DEFAULT_CONFIG } from '../../core/ai/AiTakeoverTypes';

interface Props {
  mode: AiTakeoverMode;
  onModeChange: (mode: AiTakeoverMode) => void;
  providerConfigured: boolean;
  activePositionCount: number;
}

const MODE_OPTIONS: { key: AiTakeoverMode; label: string; color: string }[] = [
  { key: 'OFF', label: 'OFF', color: '#8b949e' },
  { key: 'PAPER_ONLY', label: 'PAPER ONLY', color: '#d29922' },
  { key: 'LIVE_LOCKED', label: 'LIVE LOCKED', color: '#f0883e' },
  { key: 'LIVE_ENABLED', label: 'LIVE ENABLED', color: '#f85149' },
];

export function AiTakeoverCard({ mode, onModeChange, providerConfigured, activePositionCount }: Props) {
  return (
    <div className="v5-ai-takeover-card">
      <div className="v5-ai-takeover-header">
        <span className="v5-ai-takeover-title">AI TAKEOVER</span>
        <span className="v5-ai-takeover-badge">V5 Experimental</span>
      </div>
      <div className="v5-ai-takeover-modes">
        {MODE_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={`v5-ai-mode-btn${mode === opt.key ? ' v5-ai-mode-btn--active' : ''}`}
            style={mode === opt.key ? { borderColor: opt.color, color: opt.color, background: `${opt.color}15` } : undefined}
            onClick={() => onModeChange(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="v5-ai-takeover-info">
        <span>Provider: {providerConfigured ? 'Configured' : 'Not configured'}</span>
        <span>Positions: {activePositionCount}</span>
      </div>
    </div>
  );
}
