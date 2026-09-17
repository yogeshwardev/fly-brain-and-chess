import type { Checkpoint } from "../src/player";
import type { GameRecord, PlyEvent, Rival, SessionStats } from "../src/session";

export type FlyMode = "naive" | "trained";
export type SideChoice = "white" | "black" | "alternate";

export type ToChess =
  | { type: "init"; graphUrl: string; trainedUrl: string }
  | { type: "reset"; mode: FlyMode; lesion: boolean; rival: Rival; side: SideChoice; seed: number }
  | { type: "step" }
  | { type: "human"; from: number; to: number; promo: number }
  | { type: "newGame" }
  | { type: "turbo"; games: number }
  | { type: "puzzles"; n: number };

export interface TrainedDoc {
  label: string;
  graph: { level: string; units: number; edges: number; dataset: string; dopamineUnits: number };
  seed: number;
  movesTrained: number;
  evaluation: { vsRandom: EvalSummary; vsGreedy: EvalSummary; puzzles: number };
  checkpoint: Checkpoint;
}

export interface EvalSummary {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** mean final material balance from the fly's side */
  material: number;
  blunderRate: number;
  freeCaptureRate: number;
  mateRate: number;
}

export interface BoardState {
  board: number[];
  turn: 1 | -1;
  flyColor: 1 | -1;
  rival: Rival;
  gameNo: number;
  drill: boolean;
  lastMove: { from: number; to: number } | null;
  checkSquare: number;
  san: string[];
  result: { over: false } | { over: true; winner: 1 | -1 | 0; reason: string };
  /** legal moves while it is the human's turn */
  legal: { from: number; to: number; promo: number }[];
  material: number;
  fen: string;
  stats: SessionStats & { puzzles: number; puzzlesSolved: number };
  records: GameRecord[];
}

export type FromChess =
  | { type: "status"; text: string }
  | {
      type: "ready";
      units: number; edges: number; neurons: number; pam: number; ppl1: number; readout: number; sensory: number;
      trained: boolean; trainedEval: TrainedDoc["evaluation"] | null; trainedMoves: number;
    }
  | { type: "state"; state: BoardState; mode: FlyMode; lesion: boolean }
  | { type: "ply"; events: PlyEvent[]; state: BoardState; trace: { pam: number[]; ppl1: number[] }; rates: Float32Array }
  | { type: "turbo"; done: number; total: number; state: BoardState | null; puzzles?: { solved: number; n: number } }
  | { type: "error"; message: string };
