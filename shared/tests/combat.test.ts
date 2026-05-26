import { describe, it, expect } from 'vitest';
import { resolveCombat } from '../src/combat.js';

describe('rank-based combat', () => {
  it('higher rank wins', () => {
    const r = resolveCombat('SILING', 'PAIZHANG');
    expect(r.outcome.winner).toBe('attacker');
    if (r.outcome.winner === 'attacker') {
      expect(r.outcome.defenderRemoved).toBe(true);
      expect(r.outcome.attackerMoves).toBe(true);
      expect(r.outcome.flagCaptured).toBe(false);
    }
  });

  it('lower rank loses', () => {
    const r = resolveCombat('PAIZHANG', 'SILING');
    expect(r.outcome.winner).toBe('defender');
    if (r.outcome.winner === 'defender') {
      expect(r.outcome.attackerRemoved).toBe(true);
      expect(r.outcome.defenderRemoved).toBe(false);
      expect(r.outcome.attackerMoves).toBe(false);
    }
  });

  it('equal rank — mutual destruction', () => {
    const r = resolveCombat('LIANZHANG', 'LIANZHANG');
    expect(r.outcome.winner).toBe('tie');
    if (r.outcome.winner === 'tie') {
      expect(r.outcome.attackerRemoved).toBe(true);
      expect(r.outcome.defenderRemoved).toBe(true);
    }
  });
});

describe('mine interactions', () => {
  it('engineer defuses mine, mine removed', () => {
    const r = resolveCombat('GONGBING', 'DILEI');
    expect(r.outcome.winner).toBe('attacker');
    if (r.outcome.winner === 'attacker') {
      expect(r.outcome.defenderRemoved).toBe(true);
      expect(r.outcome.attackerMoves).toBe(true);
    }
  });

  it('non-engineer hits mine: attacker dies, mine stays (v1)', () => {
    const r = resolveCombat('SILING', 'DILEI');
    expect(r.outcome.winner).toBe('defender');
    if (r.outcome.winner === 'defender') {
      expect(r.outcome.attackerRemoved).toBe(true);
      expect(r.outcome.defenderRemoved).toBe(false);
    }
  });
});

describe('bomb interactions', () => {
  it('attacking bomb: mutual destruction', () => {
    const r = resolveCombat('SILING', 'ZHADAN');
    expect(r.outcome.winner).toBe('tie');
  });

  it('bomb attacking: mutual destruction', () => {
    const r = resolveCombat('ZHADAN', 'SILING');
    expect(r.outcome.winner).toBe('tie');
  });

  it('bomb vs mine: tie (both removed)', () => {
    // Bomb rule fires first → mutual destruction regardless.
    const r = resolveCombat('ZHADAN', 'DILEI');
    expect(r.outcome.winner).toBe('tie');
  });
});

describe('flag capture', () => {
  it('any attacker captures the flag', () => {
    const r = resolveCombat('PAIZHANG', 'JUNQI');
    expect(r.outcome.winner).toBe('attacker');
    if (r.outcome.winner === 'attacker') {
      expect(r.outcome.flagCaptured).toBe(true);
    }
  });
});
