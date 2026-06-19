import { describe, it, expect } from 'vitest';
import { v4, botRng } from '../src/bot/index.js';
import { makeV4Bot } from '../src/bot/v4.js';
import { fastTopKMoves } from '../src/bot/rollout.js';
import { evaluateRollout, V4_SPATIAL } from '../src/bot/evaluate.js';
import {
  createGameState, submitSetup, legalMovesForTurn,
  type GameState, type SeatInfo,
} from '../src/engine.js';
import { randomValidSetup } from '../src/setup.js';
import { projectView } from '../src/view.js';
import { ZONES, type ZoneId } from '../src/board.js';

function seat(id: string): SeatInfo {
  return { playerId: id, displayName: id, isBot: false, eliminated: false, setupReady: false };
}

function freshState(s = 1): GameState {
  let state = createGameState('2v2', { N: seat('n'), E: seat('e'), S: seat('s'), W: seat('w') });
  for (const z of ZONES) {
    const r = submitSetup(state, z as ZoneId, randomValidSetup(z as ZoneId, s));
    if ('errors' in r) throw new Error(r.errors.join(','));
    state = r.state;
  }
  return state;
}

describe('fastTopKMoves (reply-min probe)', () => {
  it('returns at most k legal moves for the current seat, deterministically', () => {
    const state = freshState(3);
    const replies = fastTopKMoves(state, 3);
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.length).toBeLessThanOrEqual(4); // k + possible quiet add-on
    const legal = new Set(legalMovesForTurn(state).map((m) => `${m.from}>${m.to}`));
    for (const r of replies) {
      expect(legal.has(`${r.from}>${r.to}`)).toBe(true);
    }
    // Deterministic: same input → same output.
    expect(fastTopKMoves(state, 3)).toEqual(replies);
  });
});

describe('v4 evaluation extensions', () => {
  it('clock term: leading + stale clock scores worse than leading + fresh clock', () => {
    const state = freshState(4);
    // Manufacture a material lead for N's team by deleting an E piece.
    const victim = Object.values(state.pieces).find((p) => p.owner === 'E' && p.kind === 'JUNZHANG')!;
    const pieces = { ...state.pieces };
    const cellIndex = { ...state.cellIndex };
    delete pieces[victim.id];
    delete cellIndex[victim.cellId];
    const leading: GameState = { ...state, pieces, cellIndex };

    const fresh = evaluateRollout({ ...leading, movesSinceCapture: 0 }, 'N', V4_SPATIAL);
    const stale = evaluateRollout({ ...leading, movesSinceCapture: 60 }, 'N', V4_SPATIAL);
    expect(stale).toBeLessThan(fresh);
  });

  it('clock term flips for the trailing side (a draw is a save)', () => {
    const state = freshState(4);
    const victim = Object.values(state.pieces).find((p) => p.owner === 'N' && p.kind === 'JUNZHANG')!;
    const pieces = { ...state.pieces };
    const cellIndex = { ...state.cellIndex };
    delete pieces[victim.id];
    delete cellIndex[victim.cellId];
    const trailing: GameState = { ...state, pieces, cellIndex };

    const fresh = evaluateRollout({ ...trailing, movesSinceCapture: 0 }, 'N', V4_SPATIAL);
    const stale = evaluateRollout({ ...trailing, movesSinceCapture: 60 }, 'N', V4_SPATIAL);
    expect(stale).toBeGreaterThan(fresh);
  });

  it('v4 pickSetup is valid and pickMove returns a legal move', () => {
    const layout = v4.pickSetup({ seat: 'N', random: botRng(9) });
    expect(Object.keys(layout).length).toBe(25);
    const state = freshState(5);
    const view = projectView(state, 'N');
    const pick = v4.pickMove({ view, seat: 'N', history: state.moveHistory, random: botRng(2) });
    expect(pick).not.toBeNull();
  });
});

describe('v4 search variants', () => {
  it('greedy/safe playout policy returns a legal move deterministically', () => {
    const bot = makeV4Bot('t-greedy', {
      samples: 6,
      playoutPolicy: { greedyEps: 0.7, avoidHanging: true },
    });
    const state = freshState(6);
    const view = projectView(state, 'N');
    const legal = new Set(legalMovesForTurn(state).map((m) => `${m.from}>${m.to}`));
    const a = bot.pickMove({ view, seat: 'N', history: state.moveHistory, random: botRng(11) })!;
    const b = bot.pickMove({ view, seat: 'N', history: state.moveHistory, random: botRng(11) })!;
    expect(legal.has(`${a.from}>${a.to}`)).toBe(true);
    expect(b).toEqual(a);
  });

  it('UCB root bandit returns a legal move deterministically', () => {
    const bot = makeV4Bot('t-ucb', {
      playoutPolicy: { greedyEps: 0.7, avoidHanging: true },
      ucb: { c: 300, pullBudget: 90, warmupPulls: 1, worldEvery: 8, clip: 2500 },
    });
    const state = freshState(6);
    const view = projectView(state, 'N');
    const legal = new Set(legalMovesForTurn(state).map((m) => `${m.from}>${m.to}`));
    const a = bot.pickMove({ view, seat: 'N', history: state.moveHistory, random: botRng(12) })!;
    const b = bot.pickMove({ view, seat: 'N', history: state.moveHistory, random: botRng(12) })!;
    expect(legal.has(`${a.from}>${a.to}`)).toBe(true);
    expect(b).toEqual(a);
  });
});
