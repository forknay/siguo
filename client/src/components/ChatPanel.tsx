// Minimal chat panel. Sends ChatMsg; renders chatLog from state.

import { useState } from 'react';
import { useGame } from '../state.js';

export function ChatPanel() {
  const log = useGame((s) => s.chatLog);
  const send = useGame((s) => s.send);
  const [draft, setDraft] = useState('');

  function submit() {
    const t = draft.trim();
    if (!t) return;
    send({ type: 'Chat', text: t });
    setDraft('');
  }

  return (
    <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Chat</div>
      <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 12, marginBottom: 6 }}>
        {log.length === 0 ? (
          <span className="muted">No messages yet</span>
        ) : (
          log.map((m, i) => (
            <div key={i}>
              <span style={{ fontWeight: 600 }}>{m.name}:</span> {m.text}
            </div>
          ))
        )}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Say something"
          style={{ flex: 1, fontSize: 12, padding: '0.3rem 0.5rem' }}
          maxLength={200}
        />
        <button onClick={submit} style={{ padding: '0.3rem 0.6rem', fontSize: 12 }}>Send</button>
      </div>
    </div>
  );
}
