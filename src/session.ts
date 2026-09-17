import type { SimGraph } from "@neuroprison/neural-engine";
import { Rng, deriveSeed } from "@neuroprison/shared";
import {
  BLACK, KING, PAWN, QUEEN, ROOK, START_FEN, WHITE, Game, fileOf, isAttacked, rankOf, sameMove, toFen, toSan, type Color, type GameResult, type Move } from "./chess";
import { F_CHECK, huntScore, isBlunder, materialScore, moveFacts } from "./features";
import { chooseOpponentMove, type OpponentKind } from "./opponents";
import { ChessFly, REWARD_TICKS, type Checkpoint, type Deliberation, type Outcome, type PlayerOptions } from "./player";

/** Opponent of the fly: an engineered bot, or a person moving through the UI. */
export type Rival = OpponentKind | "human";

export interface Candidate {
  from: number;
  to: number;
  promo: number;
  san: string;
  p: number;
  gain: number;
  hanging: number;
  check: boolean;
  mate: boolean;
}

export type PlyEvent =
  | {
      kind: "fly";
      move: Move;
      san: string;
      candidates: Candidate[];
      legalCount: number;
      spread: number;
      blunder: boolean;
    }
  | { kind: "rival"; move: Move; san: string }
  | { kind: "dopamine"; reward: Outcome; burst: Outcome; expected: number; rpe: number; rpes: Outcome; reason: string }
  | { kind: "gameover"; result: Extract<GameResult, { over: true }>; flyColor: Color; outcome: "win" | "draw" | "loss"; plies: number; material: number };

export interface GameRecord {
  game: number;
  outcome: "win" | "draw" | "loss";
  reason: string;
  plies: number;
  /** final material balance from the fly's side */
  material: number;
  flyMoves: number;
  blunders: number;
  freeCaptures: number;
  freeCapturesTaken: number;
  mateChances: number;
  matesTaken: number;
  rival: Rival;
  drill: boolean;
}

export interface SessionStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  movesTrained: number;
  dopamineReleased: number;
  /** blunder rate over the last 200 fly moves */
  recentBlunders: number;
  /** share of available free captures (gain ≥ 3, sound) taken, last 200 opportunities */
  recentCaptures: number;
  lastRpe: number;
}

export interface SessionOptions extends PlayerOptions {
  rival: Rival;
  /** colour the fly plays; "alternate" swaps every game (training default) */
  flyColor?: Color | "alternate";
  checkpoint?: Checkpoint | null;
  /** seed for the opponent's choices (defaults to the fly seed) */
  gameSeed?: number;
  maxPlies?: number;
  /** "games": full games · "drills": mating drills · "puzzles": drills that start with a mate in one · "mixed": every third game is a drill */
  curriculum?: Curriculum;
}

export type Curriculum = "games" | "drills" | "puzzles" | "mixed";
const DRILL_PLIES = 50;

/**
 * Mating drill: the fly has its king plus heavy pieces against a lone king (a curriculum choice so checkmate,
 * which is rare in whole games, is experienced often enough to be reinforced). Random legal placement.
 */
export function drillFen(rng: Rng, flyColor: Color): string {
  const sets = [[QUEEN], [ROOK], [ROOK, ROOK], [QUEEN, ROOK], [QUEEN, QUEEN], [QUEEN, PAWN, PAWN]];
  for (;;) {
    const set = rng.pick(sets);
    const b = new Int8Array(64);
    const free = () => { let s; do s = rng.int(64); while (b[s]); return s; };
    const fk = free();
    b[fk] = flyColor * KING;
    const ek = free();
    b[ek] = -flyColor * KING;
    if (Math.abs(fileOf(fk) - fileOf(ek)) <= 1 && Math.abs(rankOf(fk) - rankOf(ek)) <= 1) continue;
    let ok = true;
    for (const t of set) {
      const s = free();
      if (t === PAWN && (rankOf(s) === 0 || rankOf(s) === 7)) { ok = false; break; }
      b[s] = flyColor * t;
    }
    if (!ok) continue;
    const pos = { board: b, turn: flyColor, castling: 0, ep: -1, halfmove: 0, fullmove: 1 };
    if (isAttacked(b, ek, flyColor)) continue;
    const fen = toFen(pos);
    const g = new Game(fen);
    if (g.result.over || g.legal.every((m) => moveFacts(g, m).mate)) continue;
    return fen;
  }
}

/** A mating-drill position in which the fly has at least one mate in one (random legal play until one appears). */
export function puzzleFen(rng: Rng, flyColor: Color): string {
  for (;;) {
    const g = new Game(drillFen(rng, flyColor));
    for (let i = 0; i < 16 && !g.result.over; i++) {
      if (g.pos.turn === flyColor && g.legal.some((m) => moveFacts(g, m).mate)) return toFen(g.pos);
      g.play(rng.pick(g.legal));
    }
  }
}

/** reward for a draw while ≥ 3 points ahead, by how the draw happened (the last move is responsible) */
const DRAW_WHEN_AHEAD: Record<string, number> = {
  stalemate: -0.8, "threefold repetition": -0.5, "insufficient material": -0.5, "fifty-move rule": -0.2, "move limit": -0.2,
};
/** one-move puzzle: missing an available mate */
const PUZZLE_MISS = 0;
const POSITION_CAP = 0.4;

/**
 * Deterministic chess session. The fly's readout is the only thing that learns, and only from the dopamine
 * burst it measures in its own simulated PAM/PPL1 populations.
 */
export class ChessSession {
  readonly fly: ChessFly;
  game: Game;
  flyColor: Color;
  gameNo = 1;
  readonly records: GameRecord[] = [];
  dopamineReleased = 0;
  lastRpe = 0;
  private readonly rng: Rng;
  private pending: { d: Deliberation; before: Outcome; materialBefore: number } | null = null;
  private readonly recentBlunder: number[] = [];
  private readonly recentCapture: number[] = [];
  puzzles = 0;
  puzzlesSolved = 0;
  /** true while the current game is a mating drill */
  drill = false;
  private cur = { blunders: 0, flyMoves: 0, free: 0, freeTaken: 0, mates: 0, matesTaken: 0 };

  constructor(readonly graph: SimGraph, readonly opts: SessionOptions) {
    this.fly = new ChessFly(graph, opts);
    if (opts.checkpoint) this.fly.restore(opts.checkpoint);
    this.rng = new Rng(deriveSeed(opts.gameSeed ?? opts.seed, "chess-rival"));
    this.flyColor = opts.flyColor === BLACK ? BLACK : WHITE;
    // alternating colours: odd games white, even games black
    this.game = this.freshGame();
  }

  private freshGame(): Game {
    const c = this.opts.curriculum ?? "games";
    this.drill = c === "drills" || c === "puzzles" || (c === "mixed" && this.gameNo % 3 === 0);
    if (!this.drill) return new Game(START_FEN, this.opts.maxPlies ?? 240);
    const puzzle = c === "puzzles" || (c === "mixed" && this.gameNo % 2 === 0);
    return new Game(puzzle ? puzzleFen(this.rng, this.flyColor) : drillFen(this.rng, this.flyColor), DRILL_PLIES);
  }

  get flyToMove(): boolean {
    return !this.game.result.over && this.game.pos.turn === this.flyColor;
  }

  get stats(): SessionStats {
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const c = (o: string) => this.records.filter((r) => r.outcome === o).length;
    return {
      games: this.records.length,
      wins: c("win"),
      draws: c("draw"),
      losses: c("loss"),
      movesTrained: this.fly.movesTrained,
      dopamineReleased: this.dopamineReleased,
      recentBlunders: mean(this.recentBlunder),
      recentCaptures: mean(this.recentCapture),
      lastRpe: this.lastRpe,
    };
  }

  newGame(): void {
    this.gameNo++;
    if (this.opts.flyColor === "alternate" || this.opts.flyColor === undefined) this.flyColor = this.gameNo % 2 === 0 ? BLACK : WHITE;
    this.game = this.freshGame();
    this.pending = null;
    this.cur = { blunders: 0, flyMoves: 0, free: 0, freeTaken: 0, mates: 0, matesTaken: 0 };
  }

  private flyMaterial(): number {
    return this.game.material() * this.flyColor;
  }

  private scores(): Outcome {
    const b = this.game.pos.board;
    return [materialScore(b, this.flyColor), huntScore(b, this.flyColor)];
  }

  /**
   * Deliver the outcome of the fly's last move (after the reply) and learn from the measured bursts.
   * material compartment: change in material · hunt compartment: change in the enemy king's box, or — when the
   * game just ended — the result alone. Each change is capped at ±POSITION_CAP; only a checkmate reaches +1.
   */
  private settle(events: PlyEvent[], terminal: number | null, reason: string): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const now = this.scores();
    const cap = (v: number) => Math.max(-POSITION_CAP, Math.min(POSITION_CAP, v));
    const reward: Outcome = [cap(now[0] - p.before[0]), terminal ?? cap(now[1] - p.before[1])];
    const burst = this.fly.reinforce(reward);
    this.dopamineReleased += (Math.max(0, burst[0]) + Math.max(0, burst[1])) * REWARD_TICKS;
    const { rpe, expected, rpes } = this.fly.learn(p.d, burst);
    this.lastRpe = rpe;
    const dm = this.flyMaterial() - p.materialBefore;
    const why = reason || (dm > 0 ? "won material" : dm < 0 ? "lost material" : reward[1] > 0.01 ? "tightened the net" : reward[1] < -0.01 ? "king slipped out" : "quiet move");
    events.push({ kind: "dopamine", reward, burst, expected, rpe, rpes, reason: why });
  }

  private finish(events: PlyEvent[]): void {
    const res = this.game.result;
    if (!res.over) return;
    const mat = this.flyMaterial();
    const outcome = res.winner === 0 ? "draw" : res.winner === this.flyColor ? "win" : "loss";
    if (this.pending) {
      const terminal = outcome === "win" ? 1 : outcome === "loss" ? -1 : mat >= 3 ? DRAW_WHEN_AHEAD[res.reason] ?? 0 : 0;
      const reason = outcome === "win" ? "delivered checkmate" : outcome === "loss" ? "was checkmated" : mat >= 3 ? `drew while ahead (${res.reason})` : `draw (${res.reason})`;
      this.settle(events, terminal, reason);
    }
    this.records.push({
      game: this.gameNo, outcome, reason: res.reason, plies: this.game.moves.length, material: mat,
      flyMoves: this.cur.flyMoves, blunders: this.cur.blunders, freeCaptures: this.cur.free, freeCapturesTaken: this.cur.freeTaken,
      mateChances: this.cur.mates, matesTaken: this.cur.matesTaken,
      rival: this.opts.rival, drill: this.drill,
    });
    events.push({ kind: "gameover", result: res, flyColor: this.flyColor, outcome, plies: this.game.moves.length, material: mat });
  }

  /** The fly thinks and moves. */
  flyMove(events: PlyEvent[] = []): PlyEvent[] {
    if (!this.flyToMove) throw new Error("not the fly's turn");
    const g = this.game;
    const d = this.fly.deliberate(g);
    const move = d.moves[d.chosen];
    const facts = d.facts[d.chosen];
    const blunder = isBlunder(facts);
    // opportunity bookkeeping (reporting only)
    const free = d.facts.some((f) => f.gain >= 3 && f.gain - f.hanging >= 3);
    if (free) {
      this.cur.free++;
      const took = facts.gain >= 3 && facts.gain - facts.hanging >= 3;
      if (took) this.cur.freeTaken++;
      this.recentCapture.push(took ? 1 : 0);
      if (this.recentCapture.length > 200) this.recentCapture.shift();
    }
    if (d.facts.some((f) => f.mate)) {
      this.cur.mates++;
      if (facts.mate) this.cur.matesTaken++;
    }
    this.cur.flyMoves++;
    if (blunder) this.cur.blunders++;
    this.recentBlunder.push(blunder ? 1 : 0);
    if (this.recentBlunder.length > 200) this.recentBlunder.shift();

    const order = d.p.map((p, i) => i).sort((a, b) => d.p[b] - d.p[a]).slice(0, 6);
    // the played move is always listed, even when it was an exploratory pick
    if (!order.includes(d.chosen)) order[order.length - 1] = d.chosen;
    const legal = g.legal;
    const pos = g.pos;
    const candidates: Candidate[] = order.map((i) => {
      const m = d.moves[i];
      const f = d.facts[i];
      return {
        from: m.from, to: m.to, promo: m.promo, san: toSan(pos, m, legal), p: d.p[i],
        gain: f.gain, hanging: f.hanging, check: f.features[F_CHECK] > 0 || f.mate, mate: f.mate,
      };
    });
    const materialBefore = this.flyMaterial();
    const before = this.scores();
    const san = g.play(move);
    this.pending = { d, before, materialBefore };
    events.push({ kind: "fly", move, san, candidates, legalCount: d.moves.length, spread: d.spread, blunder });
    this.finish(events);
    return events;
  }

  /** The engineered opponent moves (or a human move is applied), then the fly's last move is reinforced. */
  rivalMove(human?: Pick<Move, "from" | "to" | "promo">, events: PlyEvent[] = []): PlyEvent[] {
    if (this.game.result.over || this.flyToMove) throw new Error("not the rival's turn");
    let move: Move;
    if (human) {
      const found = this.game.legal.find((m) => sameMove(m, { ...human, promo: human.promo ?? 0 }));
      if (!found) throw new Error("illegal move");
      move = found;
    } else {
      if (this.opts.rival === "human") throw new Error("waiting for the human player");
      move = chooseOpponentMove(this.opts.rival, this.game, this.rng);
    }
    this.fly.idle(4);
    const san = this.game.play(move);
    events.push({ kind: "rival", move, san });
    if (this.game.result.over) this.finish(events);
    else this.settle(events, null, "");
    return events;
  }

  /** Advance one ply for bot games. */
  ply(events: PlyEvent[] = []): PlyEvent[] {
    if (this.game.result.over) return events;
    return this.flyToMove ? this.flyMove(events) : this.rivalMove(undefined, events);
  }

  /**
   * Tactics trainer: n one-move mate puzzles, each a single decision rewarded on the spot
   * (mate +1, stalemate like a draw while ahead, any other move PUZZLE_MISS). Returns how many were solved.
   * `explore`: share of choices made at random while practising (the tactics stage uses more than games).
   */
  playPuzzles(n: number, explore?: number): number {
    let solved = 0;
    for (let i = 0; i < n; i++) {
      const g = new Game(puzzleFen(this.rng, this.flyColor), 2);
      const d = this.fly.deliberate(g, explore);
      const f = d.facts[d.chosen];
      if (f.mate) solved++;
      const burst = this.fly.reinforce([0, f.mate ? 1 : f.stalemate ? DRAW_WHEN_AHEAD.stalemate : PUZZLE_MISS]);
      const { rpe } = this.fly.learn(d, burst);
      this.lastRpe = rpe;
      this.fly.drainTrace();
    }
    this.puzzles += n;
    this.puzzlesSolved += solved;
    return solved;
  }

  /** Play whole games without rendering. */
  playGames(n: number, onGame?: (r: GameRecord) => void): GameRecord[] {
    const out: GameRecord[] = [];
    for (let i = 0; i < n; i++) {
      if (this.game.result.over || this.game.moves.length) this.newGame();
      while (!this.game.result.over) this.ply();
      const r = this.records[this.records.length - 1];
      out.push(r);
      onGame?.(r);
    }
    return out;
  }
}
