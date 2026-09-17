import { Rng } from "@neuroprison/shared";
import {
  BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, VALUE, fileOf, legalMoves, makeMove, inCheck, rankOf,
  type Color, type Game, type Move, type Position,
} from "./chess";

/**
 * Engineered sparring partners (no neurons). They only exist so the fly has someone to play against.
 */
export type OpponentKind = "random" | "greedy" | "minimax";

export const OPPONENTS: Record<OpponentKind, { name: string; blurb: string }> = {
  random: { name: "Random mover", blurb: "picks any legal move uniformly" },
  greedy: { name: "Greedy capturer", blurb: "always grabs the most valuable piece it can, else moves at random" },
  minimax: { name: "Club bot", blurb: "2-ply alpha-beta search on material and piece placement" },
};

/** small centralisation table (from white's view), used only by the Club bot's evaluation */
const CENTER = Array.from({ length: 64 }, (_, s) => {
  const f = fileOf(s), r = rankOf(s);
  return 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5));
});

function evaluate(p: Position): number {
  let v = 0;
  const b = p.board;
  for (let s = 0; s < 64; s++) {
    const x = b[s];
    if (!x) continue;
    const t = Math.abs(x);
    const sg = Math.sign(x);
    let w = VALUE[t];
    if (t === KNIGHT || t === BISHOP) w += 0.08 * CENTER[s];
    else if (t === PAWN) w += 0.04 * (sg > 0 ? rankOf(s) - 1 : 6 - rankOf(s)) + 0.03 * CENTER[s];
    else if (t === QUEEN || t === ROOK) w += 0.02 * CENTER[s];
    else if (t === KING) w -= 0.05 * CENTER[s];
    v += sg * w;
  }
  return v * p.turn;
}

function search(p: Position, depth: number, alpha: number, beta: number): number {
  const ms = legalMoves(p);
  if (!ms.length) return inCheck(p) ? -1000 - depth : 0;
  if (depth === 0) {
    // one-level capture extension so the bot does not stop in the middle of an exchange
    let best = evaluate(p);
    if (best >= beta) return best;
    for (const m of ms) {
      if (!m.captured && !m.promo) continue;
      const v = -evaluate(makeMove(p, m));
      if (v > best) best = v;
    }
    return best;
  }
  ms.sort((a, b) => VALUE[Math.abs(b.captured)] - VALUE[Math.abs(a.captured)]);
  for (const m of ms) {
    const v = -search(makeMove(p, m), depth - 1, -beta, -alpha);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

export function chooseOpponentMove(kind: OpponentKind, game: Game, rng: Rng): Move {
  const legal = game.legal;
  if (kind === "random") return rng.pick(legal);
  if (kind === "greedy") {
    let best = 0;
    for (const m of legal) best = Math.max(best, VALUE[Math.abs(m.captured)] + (m.promo ? VALUE[m.promo] : 0));
    if (best === 0) return rng.pick(legal);
    return rng.pick(legal.filter((m) => VALUE[Math.abs(m.captured)] + (m.promo ? VALUE[m.promo] : 0) === best));
  }
  let bestV = -Infinity;
  let best: Move[] = [];
  for (const m of legal) {
    let v = -search(makeMove(game.pos, m), 1, -Infinity, Infinity);
    if (game.repeats(m) >= 1) v -= 0.3;
    if (v > bestV + 1e-9) { bestV = v; best = [m]; }
    else if (Math.abs(v - bestV) <= 1e-9) best.push(m);
  }
  return rng.pick(best);
}

export const otherColor = (c: Color) => -c as Color;
