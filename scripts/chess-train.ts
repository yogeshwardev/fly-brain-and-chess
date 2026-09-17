/**
 * Headless FLY CHESS experiment (same code as the browser). Regenerates every number the page and README show.
 *
 *   npx tsx ../DAY-3/scripts/chess-train.ts            # everything: flies run as parallel processes, then publish
 *   npx tsx ../DAY-3/scripts/chess-train.ts fly 3      # one fly (seed 3) → DAY-3/data/runs/fly-3.json
 *   npx tsx ../DAY-3/scripts/chess-train.ts fly 3 lesion
 *   npx tsx ../DAY-3/scripts/chess-train.ts publish    # merge runs → public/data/chess/{trained-s,results}.json
 *
 * Per fly (all learning from dopamine measured in its own PAM/PPL1 populations):
 *   1. NAIVE evaluation (learning frozen, performance mode)
 *   2. CURRICULUM: TACTICS mate-in-one drills, then GAMES against the greedy capturer with a few drills after
 *      each game (so checkmate is not forgotten)
 *   3. TRAINED evaluation: 20 games vs the random mover, 20 vs the greedy capturer, 100 mate-in-one drills,
 *      fresh opponent seeds, learning frozen
 * The published fly is the population member with the best evaluation score (recorded in results.json).
 * LESION CONTROL: every fly also runs the same curriculum with every PAM and PPL1 population silenced; the page
 * shows the published fly's own control.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSimGraph } from "@neuroprison/neural-engine";
import type { SimGraphDoc } from "@neuroprison/shared";
import { ChessSession, type Checkpoint, type GameRecord, type SessionOptions } from "../src/index";
import type { EvalSummary } from "../web/chessProtocol";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "..", "neuroprison", "apps", "web", "public", "data");
const RUNS = join(HERE, "..", "data", "runs");
const SEEDS = (process.env.SEEDS ?? "3,7,23").split(",").map(Number);
const TACTICS = 300;
const GAMES = 100;
const DRILLS_PER_GAME = 2;
/** exploration share during the tactics stage (games use the player's default 5%) */
const TACTICS_EXPLORE = 0.5;
const CURVE_EVERY = 10;
const EVAL_GAMES = 20;
const EVAL_PUZZLES = 100;
export const CURRICULUM = [`${TACTICS} mate-in-one drills (${TACTICS_EXPLORE * 100}% exploration)`, `${GAMES} games vs Greedy capturer (+${DRILLS_PER_GAME} drills after each)`];

const doc = JSON.parse(readFileSync(join(WEB, "graphs", "level-s.json"), "utf8")) as SimGraphDoc;
const graph = loadSimGraph(doc);

function summarise(rs: GameRecord[]): EvalSummary {
  const sum = (f: (r: GameRecord) => number) => rs.reduce((a, r) => a + f(r), 0);
  return {
    games: rs.length,
    wins: rs.filter((r) => r.outcome === "win").length,
    draws: rs.filter((r) => r.outcome === "draw").length,
    losses: rs.filter((r) => r.outcome === "loss").length,
    material: sum((r) => r.material) / Math.max(1, rs.length),
    blunderRate: sum((r) => r.blunders) / Math.max(1, sum((r) => r.flyMoves)),
    freeCaptureRate: sum((r) => r.freeCapturesTaken) / Math.max(1, sum((r) => r.freeCaptures)),
    mateRate: sum((r) => r.matesTaken) / Math.max(1, sum((r) => r.mateChances)),
  };
}

function evaluate(seed: number, checkpoint: Checkpoint | null, lesionDopamine = false) {
  const base: Omit<SessionOptions, "rival"> = { seed, checkpoint, lesionDopamine, learningRate: 0, exploit: true, flyColor: "alternate" };
  const vsRandom = summarise(new ChessSession(graph, { ...base, rival: "random", gameSeed: 9001 }).playGames(EVAL_GAMES));
  const vsGreedy = summarise(new ChessSession(graph, { ...base, rival: "greedy", gameSeed: 9002 }).playGames(EVAL_GAMES));
  const puzzles = new ChessSession(graph, { ...base, rival: "random", gameSeed: 9003 }).playPuzzles(EVAL_PUZZLES) / EVAL_PUZZLES;
  return { vsRandom, vsGreedy, puzzles };
}

type Eval = ReturnType<typeof evaluate>;
const score = (e: Eval) => e.vsRandom.wins / e.vsRandom.games + e.vsGreedy.material / 20 + e.puzzles - e.vsGreedy.blunderRate * 2;

function runFly(seed: number, lesionDopamine: boolean) {
  const t0 = performance.now();
  const log = (s: string) => console.log(`[fly ${seed}${lesionDopamine ? " lesioned" : ""} ${((performance.now() - t0) / 1000).toFixed(0)}s] ${s}`);
  const naive = lesionDopamine ? null : evaluate(seed, null);
  if (naive) log(`naive: vs random W${naive.vsRandom.wins} · vs greedy material ${naive.vsGreedy.material.toFixed(1)} · mate-in-1 ${(naive.puzzles * 100).toFixed(0)}%`);
  const s = new ChessSession(graph, { seed, rival: "greedy", flyColor: "alternate", lesionDopamine });
  const tactics = s.playPuzzles(TACTICS, TACTICS_EXPLORE);
  log(`tactics: ${tactics}/${TACTICS} solved while learning`);
  const curve: { games: number; material: number; blunderRate: number; freeCaptureRate: number; puzzles: number }[] = [];
  let block: GameRecord[] = [];
  let solved = 0;
  for (let g = 1; g <= GAMES; g++) {
    block.push(...s.playGames(1));
    solved += s.playPuzzles(DRILLS_PER_GAME);
    if (g % CURVE_EVERY === 0) {
      const b = summarise(block);
      curve.push({ games: g, material: b.material, blunderRate: b.blunderRate, freeCaptureRate: b.freeCaptureRate, puzzles: solved / (CURVE_EVERY * DRILLS_PER_GAME) });
      log(`games ${g}: W${b.wins} D${b.draws} L${b.losses} · material ${b.material.toFixed(1)} · blunders ${(b.blunderRate * 100).toFixed(1)}% · drills ${solved}/${CURVE_EVERY * DRILLS_PER_GAME}`);
      block = [];
      solved = 0;
    }
  }
  const checkpoint = s.fly.checkpoint();
  const trained = evaluate(seed, checkpoint, lesionDopamine);
  log(`trained: vs random W${trained.vsRandom.wins}/${EVAL_GAMES} · vs greedy material ${trained.vsGreedy.material.toFixed(1)} blunders ${(trained.vsGreedy.blunderRate * 100).toFixed(1)}% · mate-in-1 ${(trained.puzzles * 100).toFixed(0)}%`);
  mkdirSync(RUNS, { recursive: true });
  const out = { seed, lesionDopamine, naive, trained, curve, checkpoint, movesTrained: s.fly.movesTrained, stats: s.stats, puzzles: s.puzzles };
  writeFileSync(join(RUNS, `fly-${seed}${lesionDopamine ? "-lesion" : ""}.json`), JSON.stringify(out));
  return out;
}

type Run = ReturnType<typeof runFly>;
const readRun = (name: string) => JSON.parse(readFileSync(join(RUNS, `${name}.json`), "utf8")) as Run;

function publish() {
  const pop = SEEDS.map((s) => readRun(`fly-${s}`));
  const best = pop.reduce((a, b) => (score(b.trained) > score(a.trained) ? b : a));
  const lesion = readRun(`fly-${best.seed}-lesion`);
  const lesionSeed = best.seed;
  const probe = new ChessSession(graph, { seed: best.seed, rival: "random", exposurePositions: 0 });
  const p = probe.fly;
  const flat = (e: Eval) => ({ vsRandom: e.vsRandom, vsGreedy: e.vsGreedy, puzzles: e.puzzles });
  mkdirSync(join(WEB, "chess"), { recursive: true });
  writeFileSync(join(WEB, "chess", "trained-s.json"), JSON.stringify({
    label: "Checkpoint from a real headless FLY CHESS run (same simulation code as the browser)",
    graph: { level: doc.level, units: graph.n, edges: graph.nnz, dataset: doc.dataset, dopamineUnits: p.pam.length + p.ppl1.length },
    seed: best.seed,
    movesTrained: best.movesTrained,
    evaluation: flat(best.trained),
    checkpoint: best.checkpoint,
  }));
  writeFileSync(join(WEB, "chess", "results.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    seed: best.seed,
    movesTrained: best.movesTrained,
    gamesTrained: GAMES,
    puzzlesTrained: best.puzzles,
    curriculum: CURRICULUM,
    selection: `highest evaluation score among ${pop.length} trained flies (wins vs Random + material vs Greedy / 20 + mate-in-one rate − 2 × blunder rate)`,
    graph: {
      units: graph.n, edges: graph.nnz, neuronsRepresented: doc.counts.neuronsRepresented, pam: p.pam.length, ppl1: p.ppl1.length, readout: p.D,
      compartments: p.compartments.map((c) => ({ pam: c.pam.length, ppl1: c.ppl1.length })),
    },
    evals: { naive: flat(best.naive!), trained: flat(best.trained), lesioned: flat(lesion.trained) },
    lesionSeed,
    curve: best.curve,
    lesionCurve: lesion.curve,
    population: pop.map((r) => ({
      seed: r.seed, winRandom: r.trained.vsRandom.wins / r.trained.vsRandom.games, materialGreedy: r.trained.vsGreedy.material,
      puzzles: r.trained.puzzles, blunderRate: r.trained.vsGreedy.blunderRate, naivePuzzles: r.naive!.puzzles,
      naiveWinRandom: r.naive!.vsRandom.wins / r.naive!.vsRandom.games, naiveMaterialGreedy: r.naive!.vsGreedy.material,
    })),
  }, null, 1));
  console.log(`published fly seed ${best.seed} → ${join(WEB, "chess")}`);
}

const [cmd, arg, flag] = process.argv.slice(2);
if (cmd === "fly") runFly(Number(arg), flag === "lesion");
else if (cmd === "publish") publish();
else {
  // default: every fly and its lesion control in parallel processes, then publish
  const jobs = SEEDS.flatMap((s) => [["fly", String(s)], ["fly", String(s), "lesion"]]);
  const self = fileURLToPath(import.meta.url);
  await Promise.all(jobs.map((args) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, self, ...args], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited with ${code}`))));
  })));
  publish();
}
