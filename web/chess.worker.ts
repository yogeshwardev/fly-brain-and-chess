/// <reference lib="webworker" />
/** FLY CHESS worker: owns the simulation. The main thread only renders what it receives. */
import { loadSimGraph, type SimGraph } from "@neuroprison/neural-engine";
import type { SimGraphDoc } from "@neuroprison/shared";
import { BLACK, WHITE, inCheck, kingSquare, toFen } from "../src/chess";
import { ChessSession, type PlyEvent } from "../src/session";
import type { BoardState, FlyMode, FromChess, ToChess, TrainedDoc } from "./chessProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromChess, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);
let graph: SimGraph | null = null;
let trained: TrainedDoc | null = null;
let session: ChessSession | null = null;
let mode: FlyMode = "naive";
let lesion = false;

function snapshot(s: ChessSession): BoardState {
  const g = s.game;
  const res = g.result;
  const human = s.opts.rival === "human" && !res.over && g.pos.turn !== s.flyColor;
  const last = g.moves[g.moves.length - 1]?.move;
  return {
    board: Array.from(g.pos.board),
    turn: g.pos.turn,
    flyColor: s.flyColor,
    rival: s.opts.rival,
    gameNo: s.gameNo,
    drill: s.drill,
    lastMove: last ? { from: last.from, to: last.to } : null,
    checkSquare: inCheck(g.pos) ? kingSquare(g.pos.board, g.pos.turn) : -1,
    san: g.moves.map((m) => m.san),
    result: res.over ? { over: true, winner: res.winner, reason: res.reason } : { over: false },
    legal: human ? g.legal.map((m) => ({ from: m.from, to: m.to, promo: m.promo })) : [],
    material: g.material() * s.flyColor,
    fen: toFen(g.pos),
    stats: { ...s.stats, puzzles: s.puzzles, puzzlesSolved: s.puzzlesSolved },
    records: s.records.slice(-120),
  };
}

function sendPly(events: PlyEvent[]): void {
  const s = session!;
  const rates = s.fly.brain.r.slice();
  post({ type: "ply", events, state: snapshot(s), trace: s.fly.drainTrace(), rates }, [rates.buffer]);
}

ctx.onmessage = async (ev: MessageEvent<ToChess>) => {
  const m = ev.data;
  try {
    if (m.type === "init") {
      post({ type: "status", text: "loading the MaleCNS graph (Level S)…" });
      const doc = (await fetch(m.graphUrl).then((r) => {
        if (!r.ok) throw new Error(`graph not built (${m.graphUrl}: HTTP ${r.status})`);
        return r.json();
      })) as SimGraphDoc;
      graph = loadSimGraph(doc);
      trained = await fetch(m.trainedUrl).then((r) => (r.ok ? (r.json() as Promise<TrainedDoc>) : null)).catch(() => null);
      post({ type: "status", text: "calibrating dopamine populations…" });
      const probe = new ChessSession(graph, { seed: 1, rival: "random", exposurePositions: 0 });
      post({
        type: "ready", units: graph.n, edges: graph.nnz, neurons: doc.counts.neuronsRepresented,
        pam: probe.fly.pam.length, ppl1: probe.fly.ppl1.length, readout: probe.fly.D,
        sensory: graph.units.filter((u) => u.role === "sensory").length,
        trained: Boolean(trained), trainedEval: trained?.evaluation ?? null, trainedMoves: trained?.movesTrained ?? 0,
      });
    } else if (m.type === "reset") {
      if (!graph) throw new Error("worker not ready");
      const useTrained = m.mode === "trained" && trained;
      mode = useTrained ? "trained" : "naive";
      lesion = m.lesion;
      post({ type: "status", text: "wiring a fly to the board…" });
      session = new ChessSession(graph, {
        // a trained fly keeps its identity (stimulus wiring + readout); its opponent's choices are fresh
        seed: useTrained ? trained!.checkpoint.seed : m.seed,
        gameSeed: m.seed,
        rival: m.rival,
        flyColor: m.side === "alternate" ? "alternate" : m.side === "black" ? BLACK : WHITE,
        lesionDopamine: m.lesion,
        checkpoint: useTrained ? trained!.checkpoint : null,
        exploit: Boolean(useTrained),
      });
      post({ type: "state", state: snapshot(session), mode, lesion });
    } else if (m.type === "step") {
      if (!session) return;
      const s = session;
      if (s.game.result.over) {
        s.newGame();
        post({ type: "state", state: snapshot(s), mode, lesion });
        return;
      }
      if (s.flyToMove) sendPly(s.flyMove());
      else if (s.opts.rival !== "human") sendPly(s.rivalMove());
    } else if (m.type === "human") {
      if (!session) return;
      sendPly(session.rivalMove({ from: m.from, to: m.to, promo: m.promo }));
    } else if (m.type === "newGame") {
      if (!session) return;
      session.newGame();
      post({ type: "state", state: snapshot(session), mode, lesion });
    } else if (m.type === "turbo") {
      if (!session) return;
      const s = session;
      // training games are always against a bot; a human match resumes afterwards
      const saved = s.opts.rival;
      if (saved === "human") (s.opts as { rival: string }).rival = "greedy";
      for (let i = 0; i < m.games; i++) {
        s.playGames(1);
        s.playPuzzles(2);
        post({ type: "turbo", done: i + 1, total: m.games, state: null });
      }
      (s.opts as { rival: string }).rival = saved;
      s.fly.drainTrace();
      s.newGame();
      post({ type: "turbo", done: m.games, total: m.games, state: snapshot(s) });
    } else if (m.type === "puzzles") {
      if (!session) return;
      const s = session;
      let solved = 0;
      for (let i = 0; i < m.n; i += 10) {
        solved += s.playPuzzles(Math.min(10, m.n - i), 0.5);
        post({ type: "turbo", done: Math.min(m.n, i + 10), total: m.n, state: null });
      }
      post({ type: "turbo", done: m.n, total: m.n, state: snapshot(s), puzzles: { solved, n: m.n } });
    }
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
