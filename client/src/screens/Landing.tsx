import { useState } from 'react';
import { useGame } from '../state.js';
import type { GameMode } from '@siguo/shared';

export function Landing() {
  const send = useGame((s) => s.send);
  const lastError = useGame((s) => s.lastError);
  const clearError = useGame((s) => s.clearError);
  const debug = useGame((s) => s.debug);
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('Player');
  const [mode, setMode] = useState<GameMode>('2v2');
  const [code, setCode] = useState('');

  return (
    <div className="screen-center">
      <div className="card" style={{ minWidth: 360 }}>
        <h1>四国军棋</h1>
        <div className="muted">Si Guo Jun Qi — LAN multiplayer</div>
        {debug && (
          <div style={{ color: 'var(--accent)', fontSize: 12 }}>
            🔍 Debug mode (opponent pieces will be revealed)
          </div>
        )}
        <div className="row">
          <button onClick={() => setTab('create')} disabled={tab === 'create'}>Create game</button>
          <button onClick={() => setTab('join')} disabled={tab === 'join'}>Join game</button>
        </div>
        {tab === 'create' ? (
          <>
            <label className="col">
              <span className="muted">Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
            </label>
            <label className="col">
              <span className="muted">Mode</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as GameMode)}>
                <option value="2v2">2 vs 2 (teams: N+S vs E+W)</option>
                <option value="ffa">Free-for-all (4 players)</option>
              </select>
            </label>
            <button
              onClick={() => send({ type: 'CreateRoom', hostName: name || 'Host', mode, debug })}
            >
              Create room
            </button>
          </>
        ) : (
          <>
            <label className="col">
              <span className="muted">Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
            </label>
            <label className="col">
              <span className="muted">Room code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                style={{ fontFamily: 'monospace', letterSpacing: '0.3rem', textTransform: 'uppercase' }}
              />
            </label>
            <button
              onClick={() => send({ type: 'JoinRoom', roomCode: code, playerName: name || 'Player', debug })}
              disabled={code.length !== 4}
            >
              Join
            </button>
          </>
        )}
        {lastError && (
          <div style={{ color: 'var(--danger)' }}>
            {lastError}
            <button style={{ marginLeft: '0.5rem' }} onClick={clearError}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}
