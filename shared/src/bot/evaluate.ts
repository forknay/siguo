// Terminal-aware utility for v3-mc rollouts. Returns a single number per
// rollout-end state, from MY team's perspective. Higher = better for me.

import { type GameState, type SeatId } from '../engine.js';
import { PIECE_VALUE } from './values.js';
import { TEAMS_2V2 } from '../engine.js';

const WIN_BONUS = 100_000;
const LOSE_PENALTY = -100_000;
const MARSHAL_ALIVE_BONUS = 500;

/** Score the rollout end state from `mySeat`'s perspective. */
export function evaluateRollout(state: GameState, mySeat: SeatId): number {
  // Terminal result short-circuits.
  if (state.result) {
    if (state.result.kind === 'TEAM_WIN') {
      return state.result.team === TEAMS_2V2[mySeat] ? WIN_BONUS : LOSE_PENALTY;
    }
    if (state.result.kind === 'PLAYER_WIN') {
      return state.result.seat === mySeat ? WIN_BONUS : LOSE_PENALTY;
    }
    if (state.result.kind === 'DRAW') return 0;
  }

  // Non-terminal: material delta + 司令-alive bonus.
  let myTeamMaterial = 0;
  let oppTeamMaterial = 0;
  let myMarshalAlive = false;
  let partnerMarshalAlive = false;
  const myTeam = state.mode === '2v2' ? TEAMS_2V2[mySeat] : null;

  for (const p of Object.values(state.pieces)) {
    if (state.seats[p.owner].eliminated) continue;
    const v = PIECE_VALUE[p.kind];
    const isMyTeam = state.mode === '2v2'
      ? TEAMS_2V2[p.owner] === myTeam
      : p.owner === mySeat;
    if (isMyTeam) {
      myTeamMaterial += v;
      if (p.kind === 'SILING') {
        if (p.owner === mySeat) myMarshalAlive = true;
        else partnerMarshalAlive = true;
      }
    } else {
      oppTeamMaterial += v;
    }
  }

  let utility = (myTeamMaterial - oppTeamMaterial) / 10;
  if (myMarshalAlive) utility += MARSHAL_ALIVE_BONUS;
  if (partnerMarshalAlive) utility += MARSHAL_ALIVE_BONUS / 2;
  return utility;
}
