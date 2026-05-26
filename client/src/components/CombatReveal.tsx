// Combat outcome banner. In normal play we deliberately show only the OUTCOME
// (who lived, who died) and not the piece identities — this matches the hidden-
// information rule of physical 四国 with a referee. In debug mode (?debug=1) the
// modal additionally reveals the kinds for testing.

import { useGame } from '../state.js';
import { PIECE_DEFS } from '@siguo/shared';

export function CombatReveal() {
  const combat = useGame((s) => s.pendingCombat);
  const dismiss = useGame((s) => s.dismissCombat);
  const mySeat = useGame((s) => s.seat);
  const debug = useGame((s) => s.debug);
  if (!combat) return null;

  const iAttacked = combat.attackerSeat === mySeat;
  const iDefended = combat.defenderSeat === mySeat;
  const involved = iAttacked || iDefended;

  let outcomeLabel: string;
  if (combat.winner === 'tie') {
    outcomeLabel = involved ? 'Both pieces destroyed' : 'Mutual destruction';
  } else if (combat.winner === 'attacker') {
    outcomeLabel = iAttacked
      ? 'You captured the cell'
      : iDefended
        ? 'Your piece was destroyed'
        : `${combat.attackerSeat} captured ${combat.defenderSeat}'s piece`;
  } else {
    outcomeLabel = iAttacked
      ? 'Your piece was destroyed'
      : iDefended
        ? 'You repelled the attack'
        : `${combat.defenderSeat} repelled ${combat.attackerSeat}'s attack`;
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'grid', placeItems: 'center', zIndex: 100,
      }}
      onClick={dismiss}
    >
      <div
        className="card"
        style={{ minWidth: 320, textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Combat</h2>
        <div style={{ color: 'var(--accent)', fontSize: 18 }}>{outcomeLabel}</div>
        {debug && combat.attackerKind && combat.defenderKind && (
          <div className="row" style={{ justifyContent: 'space-around', fontSize: 32 }}>
            <div>
              <div>{PIECE_DEFS[combat.attackerKind].chinese}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {combat.attackerSeat} · {PIECE_DEFS[combat.attackerKind].english}
              </div>
            </div>
            <div style={{ fontSize: 24 }}>⚔︎</div>
            <div>
              <div>{PIECE_DEFS[combat.defenderKind].chinese}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {combat.defenderSeat} · {PIECE_DEFS[combat.defenderKind].english}
              </div>
            </div>
          </div>
        )}
        <button onClick={dismiss}>OK</button>
      </div>
    </div>
  );
}
