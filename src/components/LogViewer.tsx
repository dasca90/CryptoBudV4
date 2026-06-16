import { useState, useEffect, useRef } from 'react';
import { logger } from '../utils/logger';
import { sanitizeExecutionDisplayText } from '../lib/execution/executionDisplay';
import { formatSystemLocalTime } from '../utils/timeFormatter';

export function LogViewer() {
  const [logs, setLogs] = useState(logger.getRecentLogs(100));
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = logger.subscribe(() => {
      setLogs(logger.getRecentLogs(100));
    });
    return unsub;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="log-area">
      {logs.map((l, i) => (
        <div key={i} className="log-entry">
          <span className="log-time">{formatSystemLocalTime(l.timestamp)}</span>
          <span className={`log-level ${l.level}`}>{l.level}</span>
          <span className="log-msg">{sanitizeExecutionDisplayText(l.message)}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
