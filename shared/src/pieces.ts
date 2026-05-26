// Piece roster for Si Guo Jun Qi.
// 25 pieces per player; 9 ranked soldiers (1-9), plus bombs, mines, and a flag.

export type PieceKind =
  | 'SILING'    // 司令 Field Marshal — rank 9
  | 'JUNZHANG'  // 军长 General        — rank 8
  | 'SHIZHANG'  // 师长 Major General  — rank 7
  | 'LUZHANG'   // 旅长 Brigadier      — rank 6
  | 'TUANZHANG' // 团长 Colonel        — rank 5
  | 'YINGZHANG' // 营长 Major          — rank 4
  | 'LIANZHANG' // 连长 Captain        — rank 3
  | 'PAIZHANG'  // 排长 Lieutenant     — rank 2
  | 'GONGBING'  // 工兵 Engineer       — rank 1 (defuses mines, navigates rail corners)
  | 'ZHADAN'    // 炸弹 Bomb           — mutual destruction
  | 'DILEI'     // 地雷 Landmine       — immobile, kills attackers except engineer
  | 'JUNQI';    // 军旗 Flag           — immobile, must sit in an HQ

export interface PieceDef {
  kind: PieceKind;
  chinese: string;
  pinyin: string;
  english: string;
  /** 1-9 for ranked soldiers, null for bomb/mine/flag (resolved by special rules). */
  rank: number | null;
  count: number;
  mobile: boolean;
}

export const PIECE_DEFS: Record<PieceKind, PieceDef> = {
  SILING:    { kind: 'SILING',    chinese: '司令', pinyin: 'Sīlìng',    english: 'Marshal',    rank: 9, count: 1, mobile: true  },
  JUNZHANG:  { kind: 'JUNZHANG',  chinese: '军长', pinyin: 'Jūnzhǎng',  english: 'General',    rank: 8, count: 1, mobile: true  },
  SHIZHANG:  { kind: 'SHIZHANG',  chinese: '师长', pinyin: 'Shīzhǎng',  english: 'Maj. Gen.',  rank: 7, count: 2, mobile: true  },
  LUZHANG:   { kind: 'LUZHANG',   chinese: '旅长', pinyin: 'Lǚzhǎng',   english: 'Brigadier',  rank: 6, count: 2, mobile: true  },
  TUANZHANG: { kind: 'TUANZHANG', chinese: '团长', pinyin: 'Tuánzhǎng', english: 'Colonel',    rank: 5, count: 2, mobile: true  },
  YINGZHANG: { kind: 'YINGZHANG', chinese: '营长', pinyin: 'Yíngzhǎng', english: 'Major',      rank: 4, count: 2, mobile: true  },
  LIANZHANG: { kind: 'LIANZHANG', chinese: '连长', pinyin: 'Liánzhǎng', english: 'Captain',    rank: 3, count: 3, mobile: true  },
  PAIZHANG:  { kind: 'PAIZHANG',  chinese: '排长', pinyin: 'Páizhǎng',  english: 'Lieutenant', rank: 2, count: 3, mobile: true  },
  GONGBING:  { kind: 'GONGBING',  chinese: '工兵', pinyin: 'Gōngbīng',  english: 'Engineer',   rank: 1, count: 3, mobile: true  },
  ZHADAN:    { kind: 'ZHADAN',    chinese: '炸弹', pinyin: 'Zhàdàn',    english: 'Bomb',       rank: null, count: 2, mobile: true  },
  DILEI:     { kind: 'DILEI',     chinese: '地雷', pinyin: 'Dìléi',     english: 'Mine',       rank: null, count: 3, mobile: false },
  JUNQI:     { kind: 'JUNQI',     chinese: '军旗', pinyin: 'Jūnqí',     english: 'Flag',       rank: null, count: 1, mobile: false },
};

/** Total pieces per player. */
export const PIECES_PER_PLAYER = Object.values(PIECE_DEFS).reduce((s, d) => s + d.count, 0);

/** Ordered list (for setup UI consistency) — highest rank first, then specials. */
export const PIECE_KINDS_ORDERED: PieceKind[] = [
  'SILING', 'JUNZHANG', 'SHIZHANG', 'LUZHANG', 'TUANZHANG',
  'YINGZHANG', 'LIANZHANG', 'PAIZHANG', 'GONGBING',
  'ZHADAN', 'DILEI', 'JUNQI',
];
