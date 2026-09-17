/** Tuning tool: one fly trains against the greedy bot, then plays frozen vs random and greedy. npx tsx ../DAY-3/scripts/probe.ts [games] [seed] */
import { readFileSync } from "node:fs";
import { loadSimGraph } from "@neuroprison/neural-engine";
import { ChessSession, type GameRecord } from "../src/index";
const graph = loadSimGraph(JSON.parse(readFileSync(new URL("../../neuroprison/apps/web/public/data/graphs/level-s.json", import.meta.url), "utf8")));
const GAMES = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 3);
const sum = (rs: GameRecord[]) => {
  const w = rs.filter((r) => r.outcome === "win").length, d = rs.filter((r) => r.outcome === "draw").length;
  const mv = rs.reduce((a, r) => a + r.flyMoves, 0), bl = rs.reduce((a, r) => a + r.blunders, 0);
  const fc = rs.reduce((a, r) => a + r.freeCaptures, 0), ft = rs.reduce((a, r) => a + r.freeCapturesTaken, 0);
  const mat = rs.reduce((a, r) => a + r.material, 0) / rs.length;
  const mc = rs.reduce((a, r) => a + r.mateChances, 0), mt = rs.reduce((a, r) => a + r.matesTaken, 0);
  return `W${w} D${d} L${rs.length - w - d} · blunders ${(100 * bl / mv).toFixed(1)}% · free captures ${(100 * ft / Math.max(1, fc)).toFixed(0)}% · material ${mat.toFixed(1)} · mate-in-1 ${mt}/${mc} · ${rs.map((r) => r.reason[0]).join("")}`;
};
const t0 = performance.now();
const test = (label: string, s: ChessSession | null, rival: "random" | "greedy", curriculum: "games" | "drills" | "puzzles" = "games") => {
  const t = new ChessSession(graph, { seed, rival, curriculum, flyColor: "alternate", gameSeed: 900, checkpoint: s?.fly.checkpoint() ?? null, learningRate: 0, exploit: true });
  console.log(`  ${label} ${curriculum} vs ${rival}: ${sum(t.playGames(20))}`);
};
test("naive", null, "random");
test("naive", null, "random", "drills");
const s = new ChessSession(graph, { seed, rival: "greedy", flyColor: "alternate" });
const puzzleRate = (n: number) => `${s.playPuzzles(n)}/${n}`;
const clock = () => `${((performance.now() - t0) / 1000).toFixed(0)} s · moves ${s.fly.movesTrained}`;
const gamesBlock = (label: string, pz: number) => {
  const rs: GameRecord[] = [];
  for (let k = 0; k < 10; k++) { rs.push(...s.playGames(1)); if (pz) s.playPuzzles(pz); }
  console.log(`${label}: ${sum(rs)} · ${clock()}`);
};
for (const step of (process.env.ORDER ?? "G,G,G,G,G,T,T,M,M,M").split(",")) {
  if (step === "G") gamesBlock("games", 0);
  else if (step === "M") gamesBlock(`mixed (puzzles ${puzzleRate(20)})`, Number(process.env.PZ ?? 5));
  else console.log(`tactics: mate-in-1 solved ${puzzleRate(100)} · ${clock()}`);
}
const last = s;
test("trained", last, "random");
test("trained", last, "greedy");
