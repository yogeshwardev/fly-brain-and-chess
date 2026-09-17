/**
 * FLY CHESS — complete chess rules (engineered, not learned).
 *
 * Squares are 0..63 with a1 = 0, h1 = 7, a8 = 56. Pieces are signed: white > 0, black < 0,
 * |piece| ∈ {PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING}. Positions are immutable (copy-make).
 * Legal move generation covers castling, en passant, promotion, check, checkmate, stalemate,
 * the fifty-move rule, threefold repetition and insufficient material.
 */

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const WHITE = 1;
export const BLACK = -1;
export type Color = 1 | -1;

/** conventional material values (king 0: it is never captured) */
export const VALUE = [0, 1, 3, 3, 5, 9, 0];
export const PIECE_LETTER = ["", "P", "N", "B", "R", "Q", "K"];
/** filled glyphs for both colours; the renderer colours them */
export const PIECE_GLYPH = ["", "♟︎", "♞︎", "♝︎", "♜︎", "♛︎", "♚︎"];
export const PIECE_NAME = ["", "pawn", "knight", "bishop", "rook", "queen", "king"];

const CASTLE_WK = 1;
const CASTLE_WQ = 2;
const CASTLE_BK = 4;
const CASTLE_BQ = 8;

export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3;
export const sqName = (sq: number) => "abcdefgh"[fileOf(sq)] + (rankOf(sq) + 1);
export const parseSq = (s: string) => s.charCodeAt(0) - 97 + (s.charCodeAt(1) - 49) * 8;

export interface Move {
  from: number;
  to: number;
  /** signed moving piece */
  piece: number;
  /** signed captured piece (0 = none); for en passant the captured pawn */
  captured: number;
  /** promotion piece type (unsigned), 0 = none */
  promo: number;
  castle: 0 | 1 | 2;
  ep: boolean;
}

export interface Position {
  board: Int8Array;
  turn: Color;
  castling: number;
  ep: number;
  halfmove: number;
  fullmove: number;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function fromFen(fen: string): Position {
  const [placement, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Int8Array(64);
  const rows = placement.split("/");
  if (rows.length !== 8) throw new Error(`bad FEN: ${fen}`);
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        const t = " pnbrqk".indexOf(ch.toLowerCase());
        if (t <= 0) throw new Error(`bad FEN piece ${ch}`);
        board[(7 - i) * 8 + f] = ch === ch.toUpperCase() ? t : -t;
        f++;
      }
    }
  });
  let castling = 0;
  if (castle?.includes("K")) castling |= CASTLE_WK;
  if (castle?.includes("Q")) castling |= CASTLE_WQ;
  if (castle?.includes("k")) castling |= CASTLE_BK;
  if (castle?.includes("q")) castling |= CASTLE_BQ;
  return {
    board,
    turn: turn === "b" ? BLACK : WHITE,
    castling,
    ep: ep && ep !== "-" ? parseSq(ep) : -1,
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}

export function toFen(p: Position): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const v = p.board[r * 8 + f];
      if (!v) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const l = PIECE_LETTER[Math.abs(v)];
      row += v > 0 ? l : l.toLowerCase();
    }
    rows.push(row + (empty ? empty : ""));
  }
  const c = (p.castling & CASTLE_WK ? "K" : "") + (p.castling & CASTLE_WQ ? "Q" : "") + (p.castling & CASTLE_BK ? "k" : "") + (p.castling & CASTLE_BQ ? "q" : "");
  return `${rows.join("/")} ${p.turn === WHITE ? "w" : "b"} ${c || "-"} ${p.ep >= 0 ? sqName(p.ep) : "-"} ${p.halfmove} ${p.fullmove}`;
}

/** key for repetition detection (placement, side, castling, en passant) */
export function positionKey(p: Position): string {
  return toFen(p).split(" ").slice(0, 4).join(" ");
}

const KNIGHT_D: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_D: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_D: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_D: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** precomputed jump targets */
const KNIGHT_T: number[][] = [];
const KING_T: number[][] = [];
for (let s = 0; s < 64; s++) {
  const f = fileOf(s), r = rankOf(s);
  KNIGHT_T.push(KNIGHT_D.filter(([df, dr]) => f + df >= 0 && f + df < 8 && r + dr >= 0 && r + dr < 8).map(([df, dr]) => s + df + dr * 8));
  KING_T.push(KING_D.filter(([df, dr]) => f + df >= 0 && f + df < 8 && r + dr >= 0 && r + dr < 8).map(([df, dr]) => s + df + dr * 8));
}

/**
 * Value of the least valuable piece of `by` attacking `sq` (king counts as 100), 0 if unattacked.
 * `board` may be any board array (used on hypothetical boards).
 */
export function leastAttacker(board: Int8Array, sq: number, by: Color): number {
  let best = 0;
  const take = (v: number) => { if (!best || v < best) best = v; };
  const f = fileOf(sq), r = rankOf(sq);
  // pawns
  const pr = r - by;
  if (pr >= 0 && pr < 8) {
    if (f > 0 && board[pr * 8 + f - 1] === by * PAWN) return 1;
    if (f < 7 && board[pr * 8 + f + 1] === by * PAWN) return 1;
  }
  for (const t of KNIGHT_T[sq]) if (board[t] === by * KNIGHT) { take(3); break; }
  if (best === 3) return 3;
  const slide = (dirs: [number, number][], a: number, b: number) => {
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const v = board[rr * 8 + ff];
        if (v) {
          if (v === by * a) take(VALUE[a]);
          else if (v === by * b) take(9);
          break;
        }
        ff += df;
        rr += dr;
      }
    }
  };
  slide(BISHOP_D, BISHOP, QUEEN);
  if (best === 3) return 3;
  slide(ROOK_D, ROOK, QUEEN);
  if (!best) for (const t of KING_T[sq]) if (board[t] === by * KING) { take(100); break; }
  return best;
}

export function isAttacked(board: Int8Array, sq: number, by: Color): boolean {
  return leastAttacker(board, sq, by) > 0;
}

export function kingSquare(board: Int8Array, color: Color): number {
  for (let s = 0; s < 64; s++) if (board[s] === color * KING) return s;
  return -1;
}

export function inCheck(p: Position, color: Color = p.turn): boolean {
  const k = kingSquare(p.board, color);
  return k >= 0 && isAttacked(p.board, k, -color as Color);
}

function mv(from: number, to: number, piece: number, captured: number, promo = 0, castle: 0 | 1 | 2 = 0, ep = false): Move {
  return { from, to, piece, captured, promo, castle, ep };
}

export function pseudoMoves(p: Position, out: Move[] = []): Move[] {
  const b = p.board;
  const c = p.turn;
  for (let s = 0; s < 64; s++) {
    const v = b[s];
    if (!v || Math.sign(v) !== c) continue;
    const t = Math.abs(v);
    const f = fileOf(s), r = rankOf(s);
    if (t === PAWN) {
      const one = s + 8 * c;
      const lastRank = c === WHITE ? 7 : 0;
      const pushPromo = (to: number, cap: number) => {
        if (rankOf(to) === lastRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push(mv(s, to, v, cap, pr));
        else out.push(mv(s, to, v, cap));
      };
      if (one >= 0 && one < 64 && !b[one]) {
        pushPromo(one, 0);
        const startRank = c === WHITE ? 1 : 6;
        const two = s + 16 * c;
        if (r === startRank && !b[two]) out.push(mv(s, two, v, 0));
      }
      for (const df of [-1, 1]) {
        if (f + df < 0 || f + df > 7) continue;
        const to = s + 8 * c + df;
        if (to < 0 || to > 63) continue;
        if (b[to] && Math.sign(b[to]) === -c) pushPromo(to, b[to]);
        else if (to === p.ep) out.push(mv(s, to, v, -c * PAWN, 0, 0, true));
      }
    } else if (t === KNIGHT || t === KING) {
      for (const to of (t === KNIGHT ? KNIGHT_T : KING_T)[s]) {
        if (b[to] && Math.sign(b[to]) === c) continue;
        out.push(mv(s, to, v, b[to]));
      }
      if (t === KING) {
        const home = c === WHITE ? 4 : 60;
        const opp = -c as Color;
        if (s === home) {
          const kFlag = c === WHITE ? CASTLE_WK : CASTLE_BK;
          const qFlag = c === WHITE ? CASTLE_WQ : CASTLE_BQ;
          if (p.castling & kFlag && b[home + 3] === c * ROOK && !b[home + 1] && !b[home + 2]
            && !isAttacked(b, home, opp) && !isAttacked(b, home + 1, opp) && !isAttacked(b, home + 2, opp)) {
            out.push(mv(s, home + 2, v, 0, 0, 1));
          }
          if (p.castling & qFlag && b[home - 4] === c * ROOK && !b[home - 1] && !b[home - 2] && !b[home - 3]
            && !isAttacked(b, home, opp) && !isAttacked(b, home - 1, opp) && !isAttacked(b, home - 2, opp)) {
            out.push(mv(s, home - 2, v, 0, 0, 2));
          }
        }
      }
    } else {
      const dirs = t === BISHOP ? BISHOP_D : t === ROOK ? ROOK_D : [...ROOK_D, ...BISHOP_D];
      for (const [df, dr] of dirs) {
        let ff = f + df, rr = r + dr;
        while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
          const to = rr * 8 + ff;
          if (b[to]) {
            if (Math.sign(b[to]) === -c) out.push(mv(s, to, v, b[to]));
            break;
          }
          out.push(mv(s, to, v, 0));
          ff += df;
          rr += dr;
        }
      }
    }
  }
  return out;
}

const CASTLE_MASK = new Uint8Array(64).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;
CASTLE_MASK[7] = 15 & ~CASTLE_WK;
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[56] = 15 & ~CASTLE_BQ;
CASTLE_MASK[63] = 15 & ~CASTLE_BK;
CASTLE_MASK[60] = 15 & ~(CASTLE_BK | CASTLE_BQ);

/** board after a move (no legality check) */
export function applyToBoard(board: Int8Array, m: Move, out = new Int8Array(64)): Int8Array {
  out.set(board);
  out[m.from] = 0;
  out[m.to] = m.promo ? Math.sign(m.piece) * m.promo : m.piece;
  if (m.ep) out[m.to - 8 * Math.sign(m.piece)] = 0;
  if (m.castle === 1) { out[m.to - 1] = out[m.to + 1]; out[m.to + 1] = 0; }
  if (m.castle === 2) { out[m.to + 1] = out[m.to - 2]; out[m.to - 2] = 0; }
  return out;
}

export function makeMove(p: Position, m: Move): Position {
  const board = applyToBoard(p.board, m);
  const pawn = Math.abs(m.piece) === PAWN;
  return {
    board,
    turn: -p.turn as Color,
    castling: p.castling & CASTLE_MASK[m.from] & CASTLE_MASK[m.to],
    ep: pawn && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) >> 1 : -1,
    halfmove: pawn || m.captured ? 0 : p.halfmove + 1,
    fullmove: p.fullmove + (p.turn === BLACK ? 1 : 0),
  };
}

const scratch = new Int8Array(64);

export function legalMoves(p: Position): Move[] {
  const out: Move[] = [];
  const c = p.turn;
  for (const m of pseudoMoves(p)) {
    const b = applyToBoard(p.board, m, scratch);
    const k = Math.abs(m.piece) === KING ? m.to : kingSquare(b, c);
    if (!isAttacked(b, k, -c as Color)) out.push(m);
  }
  return out;
}

/** true if the side to move has at least one legal move; also counts legal king moves */
export function mobilitySummary(p: Position): { any: boolean; kingMoves: number } {
  const c = p.turn;
  let any = false;
  let kingMoves = 0;
  const k0 = kingSquare(p.board, c);
  for (const m of pseudoMoves(p)) {
    const isKing = m.from === k0;
    if (any && !isKing) continue;
    const b = applyToBoard(p.board, m, scratch);
    const k = isKing ? m.to : k0;
    if (!isAttacked(b, k, -c as Color)) {
      any = true;
      if (isKing) kingMoves++;
    }
  }
  return { any, kingMoves };
}

export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1;
  const ms = legalMoves(p);
  if (depth === 1) return ms.length;
  let n = 0;
  for (const m of ms) n += perft(makeMove(p, m), depth - 1);
  return n;
}

export function sameMove(a: Pick<Move, "from" | "to" | "promo">, b: Pick<Move, "from" | "to" | "promo">): boolean {
  return a.from === b.from && a.to === b.to && (a.promo || 0) === (b.promo || 0);
}

/** Standard Algebraic Notation (needs the position before the move) */
export function toSan(p: Position, m: Move, legal = legalMoves(p)): string {
  let s: string;
  const t = Math.abs(m.piece);
  if (m.castle) s = m.castle === 1 ? "O-O" : "O-O-O";
  else {
    const cap = m.captured !== 0;
    if (t === PAWN) s = (cap ? "abcdefgh"[fileOf(m.from)] + "x" : "") + sqName(m.to) + (m.promo ? "=" + PIECE_LETTER[m.promo] : "");
    else {
      const rivals = legal.filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
      let dis = "";
      if (rivals.length) {
        const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
        const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
        if (!sameFile) dis = "abcdefgh"[fileOf(m.from)];
        else if (!sameRank) dis = String(rankOf(m.from) + 1);
        else dis = sqName(m.from);
      }
      s = PIECE_LETTER[t] + dis + (cap ? "x" : "") + sqName(m.to);
    }
  }
  const next = makeMove(p, m);
  if (inCheck(next)) s += legalMoves(next).length ? "+" : "#";
  return s;
}

export type GameResult =
  | { over: false }
  | { over: true; winner: Color | 0; reason: "checkmate" | "stalemate" | "fifty-move rule" | "threefold repetition" | "insufficient material" | "move limit" };

export function insufficientMaterial(b: Int8Array): boolean {
  const minors: number[] = [];
  for (let s = 0; s < 64; s++) {
    const t = Math.abs(b[s]);
    if (!t || t === KING) continue;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    minors.push(t === BISHOP ? ((fileOf(s) + rankOf(s)) & 1) + 10 : t);
  }
  if (minors.length <= 1) return true;
  // only bishops, all on the same colour
  return minors.every((m) => m >= 10) && new Set(minors).size === 1;
}

/**
 * A game: position, move history with SAN, repetition counting and result.
 */
export class Game {
  pos: Position;
  readonly moves: { move: Move; san: string }[] = [];
  private readonly seen = new Map<string, number>();
  result: GameResult = { over: false };
  private legalCache: Move[] | null = null;

  constructor(fen = START_FEN, readonly maxPlies = 300) {
    this.pos = fromFen(fen);
    this.seen.set(positionKey(this.pos), 1);
    this.updateResult();
  }

  get legal(): Move[] {
    return (this.legalCache ??= legalMoves(this.pos));
  }

  /** how many times the position after `m` has already occurred */
  repeats(m: Move): number {
    return this.seen.get(positionKey(makeMove(this.pos, m))) ?? 0;
  }

  play(m: Move): string {
    if (this.result.over) throw new Error("game is over");
    const legal = this.legal;
    const found = legal.find((o) => sameMove(o, m));
    if (!found) throw new Error(`illegal move ${sqName(m.from)}${sqName(m.to)}`);
    const san = toSan(this.pos, found, legal);
    this.pos = makeMove(this.pos, found);
    this.legalCache = null;
    this.moves.push({ move: found, san });
    const k = positionKey(this.pos);
    this.seen.set(k, (this.seen.get(k) ?? 0) + 1);
    this.updateResult();
    return san;
  }

  private updateResult(): void {
    const legal = this.legal;
    if (!legal.length) {
      this.result = inCheck(this.pos) ? { over: true, winner: -this.pos.turn as Color, reason: "checkmate" } : { over: true, winner: 0, reason: "stalemate" };
    } else if (this.pos.halfmove >= 100) this.result = { over: true, winner: 0, reason: "fifty-move rule" };
    else if ((this.seen.get(positionKey(this.pos)) ?? 0) >= 3) this.result = { over: true, winner: 0, reason: "threefold repetition" };
    else if (insufficientMaterial(this.pos.board)) this.result = { over: true, winner: 0, reason: "insufficient material" };
    else if (this.moves.length >= this.maxPlies) this.result = { over: true, winner: 0, reason: "move limit" };
    else this.result = { over: false };
  }

  /** material balance (white − black) */
  material(): number {
    return materialBalance(this.pos.board);
  }
}

export function materialBalance(b: Int8Array): number {
  let m = 0;
  for (let s = 0; s < 64; s++) m += Math.sign(b[s]) * VALUE[Math.abs(b[s])];
  return m;
}
