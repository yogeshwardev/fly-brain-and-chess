import {
  KING, PAWN, VALUE, applyToBoard, fileOf, inCheck, isAttacked, kingSquare, leastAttacker, makeMove, materialBalance, mobilitySummary, rankOf,
  type Color, type Game, type Move,
} from "./chess";

/**
 * What the fly "sees" of one candidate move (engineered encoder, like Day 2's cube colour/arrow).
 * The rules engine computes these facts; the connectome-derived brain has to learn which of them
 * predict dopamine. All values are roughly in 0..1.
 */
export const FEATURE_NAMES = [
  "moves pawn", "moves knight", "moves bishop", "moves rook", "moves queen", "moves king",
  "captures (value)",
  "destination risk",
  "gives check",
  "gives checkmate",
  "promotes",
  "castles",
  "rescues attacked piece",
  "centralises",
  "pawn advance",
  "leaves piece hanging",
  "enemy king mobility",
  "stalemates",
  "repeats position",
  "shrinks enemy king's box",
  "king approach",
] as const;
export const N_FEATURES = FEATURE_NAMES.length;

export const F_CAPTURE = 6;
export const F_RISK = 7;
export const F_CHECK = 8;
export const F_MATE = 9;
export const F_PROMO = 10;
export const F_RESCUE = 12;
export const F_HANGING = 15;
export const F_STALEMATE = 17;
export const F_REPEAT = 18;
export const F_BOX = 19;
export const F_APPROACH = 20;

const kingDist = (a: number, b: number) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));

/**
 * Squares the enemy king could walk to (flood fill through squares the attacker does not control and
 * its own pieces do not block). The classic "box" of mating technique; 1..64.
 */
export function kingBox(board: Int8Array, attacker: Color): number {
  const k = kingSquare(board, -attacker as Color);
  if (k < 0) return 0;
  const seen = new Uint8Array(64);
  const stack = [k];
  seen[k] = 1;
  let n = 0;
  while (stack.length) {
    const s = stack.pop()!;
    n++;
    const f = fileOf(s), r = rankOf(s);
    for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) {
      const ff = f + df, rr = r + dr;
      if ((!df && !dr) || ff < 0 || ff > 7 || rr < 0 || rr > 7) continue;
      const t = rr * 8 + ff;
      if (seen[t]) continue;
      seen[t] = 1;
      if (Math.sign(board[t]) === -attacker) continue;
      if (isAttacked(board, t, attacker)) continue;
      stack.push(t);
    }
  }
  return n;
}

/** material lead from which the reward also counts the enemy king's box (converting a won position) */
export const CONVERT_LEAD = 5;

/**
 * Engineered scores from `me`'s side, used ONLY to size the reward currents (the fly never sees them).
 * material → the material compartment; the enemy king's box once clearly ahead → the hunt compartment.
 */
export function materialScore(board: Int8Array, me: Color): number {
  return 0.12 * materialBalance(board) * me;
}

export function huntScore(board: Int8Array, me: Color): number {
  return materialBalance(board) * me >= CONVERT_LEAD ? 0.6 * (1 - kingBox(board, me) / 64) : 0;
}

/** material a piece on `sq` is expected to lose to the least valuable attacker (static, one exchange deep) */
function exposure(board: Int8Array, sq: number, owner: Color): number {
  const v = VALUE[Math.abs(board[sq])];
  if (!v) return 0;
  const att = leastAttacker(board, sq, -owner as Color);
  if (!att) return 0;
  const def = leastAttacker(board, sq, owner);
  return def ? Math.max(0, v - att) : v;
}

const centerDist = (s: number) => Math.max(Math.abs(fileOf(s) - 3.5), Math.abs(rankOf(s) - 3.5));
const tmp = new Int8Array(64);

export interface MoveFacts {
  features: Float32Array;
  /** material the move wins immediately (capture + promotion gain) */
  gain: number;
  /** worst static material loss the opponent can inflict next (0 = sound) */
  hanging: number;
  mate: boolean;
  stalemate: boolean;
}

export function moveFacts(game: Game, m: Move): MoveFacts {
  const p = game.pos;
  const me = p.turn;
  const f = new Float32Array(N_FEATURES);
  const t = Math.abs(m.piece);
  f[t - 1] = 1;
  const capV = VALUE[Math.abs(m.captured)];
  f[F_CAPTURE] = capV / 9;
  const after = applyToBoard(p.board, m, tmp);
  const risk = exposure(after, m.to, me);
  f[F_RISK] = risk / 9;
  const next = makeMove(p, m);
  const check = inCheck(next);
  const { any, kingMoves } = mobilitySummary(next);
  const mate = check && !any;
  const stalemate = !check && !any;
  // a mate is its own stimulus, not "a check that also ends the game"
  f[F_CHECK] = check && !mate ? 1 : 0;
  f[F_MATE] = mate ? 1 : 0;
  const promoGain = m.promo ? VALUE[m.promo] - 1 : 0;
  f[F_PROMO] = promoGain / 8;
  f[11] = m.castle ? 1 : 0;
  const before = t === KING ? 0 : exposure(p.board, m.from, me);
  f[F_RESCUE] = Math.max(0, before - risk) / 9;
  f[13] = (centerDist(m.from) - centerDist(m.to)) / 3;
  f[14] = t === PAWN ? (me > 0 ? rankOf(m.to) - 1 : 6 - rankOf(m.to)) / 5 : 0;
  let hang = 0;
  if (!mate) {
    for (let s = 0; s < 64; s++) {
      if (Math.sign(after[s]) !== me || Math.abs(after[s]) === KING) continue;
      const e = exposure(after, s, me);
      if (e > hang) hang = e;
    }
  }
  f[F_HANGING] = hang / 9;
  f[16] = kingMoves / 8;
  f[F_STALEMATE] = stalemate ? 1 : 0;
  f[F_REPEAT] = game.repeats(m) > 0 ? 1 : 0;
  if (!mate) {
    const boxBefore = kingBox(p.board, me);
    const boxAfter = kingBox(next.board, me);
    f[F_BOX] = Math.max(-1, Math.min(1, (boxBefore - boxAfter) / 12));
  }
  if (t === KING) {
    const ek = kingSquare(p.board, -me as Color);
    f[F_APPROACH] = (kingDist(m.from, ek) - kingDist(m.to, ek)) * 0.5;
  }
  return { features: f, gain: capV + promoGain, hanging: hang, mate, stalemate };
}

/** Engineered move-quality label used only for reporting (never for learning). */
export function isBlunder(facts: MoveFacts): boolean {
  return !facts.mate && facts.hanging - facts.gain >= 2;
}
