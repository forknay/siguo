import { useGame, leaveRoom } from '../state.js';
import type { BotSpeed, SeatId } from '@siguo/shared';
import { ChatPanel } from '../components/ChatPanel.js';
import { copyToClipboard } from '../clipboard.js';

const SEATS: SeatId[] = ['N', 'E', 'S', 'W'];
const SEAT_COLORS: Record<SeatId, string> = { N: 'var(--p-n)', E: 'var(--p-e)', S: 'var(--p-s)', W: 'var(--p-w)' };
const TEAM_OF: Record<SeatId, 'A' | 'B'> = { N: 'A', S: 'A', E: 'B', W: 'B' };

export function Lobby() {
  const lobby = useGame((s) => s.lobby);
  const send = useGame((s) => s.send);
  const playerToken = useGame((s) => s.playerToken);
  const mySeat = useGame((s) => s.seat);

  if (!lobby) {
    return <div className="screen-center">Loading lobby…</div>;
  }
  const isHost = lobby.hostToken === playerToken;
  const seatsFilled = SEATS.every((s) => (lobby.seats[s]?.kind ?? 'empty') !== 'empty');

  return (
    <div className="screen-center">
      <div className="card" style={{ minWidth: 480 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2>Room {lobby.roomCode}</h2>
            <div className="muted">Mode: {lobby.mode === '2v2' ? '2 vs 2 (N+S vs E+W)' : 'Free-for-all'}</div>
          </div>
          <button onClick={leaveRoom}>Leave</button>
        </div>

        {isHost && lobby.lanUrls.length > 0 && (
          <div className="col">
            <div className="muted">Invite links — the first one is the most likely to work:</div>
            {lobby.lanUrls.map((u) => {
              const link = `${u}/?room=${lobby.roomCode}`;
              const isLan = u.startsWith('http://');
              return (
                <div key={u} className="row" style={{ gap: '0.5rem' }}>
                  <code
                    style={{
                      background: 'var(--bg)',
                      padding: '0.4rem 0.6rem',
                      borderRadius: 4,
                      flex: 1,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {link}
                  </code>
                  <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {isLan ? 'same Wi-Fi' : 'internet'}
                  </span>
                  <button onClick={() => void copyToClipboard(link)}>Copy</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="col">
          {SEATS.map((seat) => {
            const occ = lobby.seats[seat] ?? { kind: 'empty' as const, displayName: null, ready: false };
            const isMe = mySeat === seat;
            const teamLabel = lobby.mode === '2v2' ? ` · Team ${TEAM_OF[seat]}` : '';
            return (
              <div
                key={seat}
                className="row"
                style={{
                  padding: '0.5rem 0.75rem',
                  background: 'var(--bg)',
                  borderRadius: 6,
                  border: `2px solid ${isMe ? SEAT_COLORS[seat] : 'transparent'}`,
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontWeight: 600, color: SEAT_COLORS[seat] }}>
                  {seat}{teamLabel}
                </span>
                <span style={{ flex: 1, paddingLeft: '0.75rem' }}>
                  {occ.kind === 'empty'
                    ? <span className="muted">empty</span>
                    : occ.kind === 'bot'
                      ? <span>🤖 {occ.displayName}</span>
                      : <span>{occ.displayName}{isMe ? ' (you)' : ''}</span>}
                </span>
                {isHost && (
                  <span className="row">
                    {occ.kind === 'empty' && (
                      <button onClick={() => send({ type: 'SetSeat', seat, action: 'addBot' })}>
                        + Bot
                      </button>
                    )}
                    {occ.kind === 'bot' && (
                      <button onClick={() => send({ type: 'SetSeat', seat, action: 'removeBot' })}>
                        Remove bot
                      </button>
                    )}
                    {occ.kind === 'human' && !isMe && (
                      <button onClick={() => send({ type: 'SetSeat', seat, action: 'release' })}>
                        Kick
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {isHost && (
          <div className="col" style={{ gap: '0.5rem' }}>
            <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12 }}>Bot speed:</span>
              {(['slow', 'normal', 'fast', 'instant'] as BotSpeed[]).map((spd) => (
                <button
                  key={spd}
                  onClick={() => send({ type: 'SetRoomConfig', botSpeed: spd })}
                  style={{
                    fontSize: 11,
                    padding: '0.2rem 0.5rem',
                    background: lobby.botSpeed === spd ? 'var(--accent)' : 'var(--bg-elev)',
                    color: lobby.botSpeed === spd ? '#0e1530' : 'var(--text)',
                    fontWeight: lobby.botSpeed === spd ? 700 : 400,
                  }}
                >
                  {spd}
                </button>
              ))}
            </div>
            <details>
              <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
                Variants (v1: locked to canonical rules)
              </summary>
              <div className="col" style={{ gap: '0.2rem', fontSize: 11, padding: '0.4rem 0', color: 'var(--muted)' }}>
                <div>• Rail corners: engineers-only (non-engineer curve = banked curves only)</div>
                <div>• Mine survives non-engineer attack (mine stays on board)</div>
                <div>• HQ-immobility ON · Marshal-death triggers flag-reveal</div>
                <div>• Stalemate at 70 moves without capture</div>
                <div>• Eliminated player's pieces stay as frozen obstacles</div>
                <div style={{ color: 'var(--accent)', marginTop: 4 }}>
                  Toggles for these will live here in a future version — the engine is parameterized internally.
                </div>
              </div>
            </details>
          </div>
        )}

        {isHost ? (
          <button
            disabled={!seatsFilled}
            onClick={() => send({ type: 'StartGame' })}
          >
            {seatsFilled ? 'Start game' : 'Waiting for players…'}
          </button>
        ) : (
          <div className="muted">Waiting for host to start the game… Bot speed: {lobby.botSpeed}</div>
        )}

        <ChatPanel />
      </div>
    </div>
  );
}
