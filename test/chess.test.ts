import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSimGraph } from "@neuroprison/neural-engine";
import { Rng } from "@neuroprison/shared";
import {
  BLACK, ChessSession, Game, START_FEN, WHITE, chooseOpponentMove, dopamineUnits, drillFen, fromFen, kingBox,
  legalMoves, moveFacts, parseSq, perft, puzzleFen, toFen, toSan,
} from "../src/index";

const graph = loadSimGraph(JSON.parse(readFileSync(new URL("../../neuroprison/apps/web/public/data/graphs/level-s.json", import.meta.url), "utf8")));
const move = (g: Game, uci: string) => {
  const m = g.legal.find((x) => x.from === parseSq(uci.slice(0, 2)) && x.to === parseSq(uci.slice(2, 4)) && (uci[4] ? "  nbrq".indexOf(uci[4]) === x.promo : !x.promo));
  if (!m) throw new Error(`no move ${uci}`);
  return g.play(m);
};

describe("chess rules", () => {
  it("perft matches reference counts (start position and Kiwipete)", () => {
    expect(perft(fromFen(START_FEN), 3)).toBe(8902);
    expect(perft(fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"), 2)).toBe(2039);
    expect(perft(fromFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), 3)).toBe(2812);
  });

  it("FEN round-trips", () => {
    const fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    expect(toFen(fromFen(fen))).toBe(fen);
  });

  it("detects fool's mate with SAN", () => {
    const g = new Game();
    for (const m of ["f2f3", "e7e5", "g2g4"]) move(g, m);
    expect(move(g, "d8h4")).toBe("Qh4#");
    expect(g.result).toEqual({ over: true, winner: BLACK, reason: "checkmate" });
  });

  it("stalemate, castling and en passant notation", () => {
    const s = new Game("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(s.result).toEqual({ over: true, winner: 0, reason: "stalemate" });
    const c = new Game("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(move(c, "e1g1")).toBe("O-O");
    expect(move(c, "e8c8")).toBe("O-O-O");
    const e = new Game("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    expect(move(e, "e5d6")).toBe("exd6");
    expect(e.pos.board[parseSq("d5")]).toBe(0);
  });

  it("threefold repetition ends the game", () => {
    const g = new Game();
    for (let i = 0; i < 2; i++) for (const m of ["g1f3", "g8f6", "f3g1", "f6g8"]) move(g, m);
    expect(g.result).toMatchObject({ over: true, winner: 0, reason: "threefold repetition" });
  });

  it("SAN disambiguates", () => {
    const p = fromFen("4k3/8/8/8/8/8/8/R4RK1 w - - 0 1");
    const m = legalMoves(p).find((x) => x.from === parseSq("a1") && x.to === parseSq("d1"))!;
    expect(toSan(p, m)).toBe("Rad1");
  });
});

describe("move facts and opponents", () => {
  it("reports captures, hanging pieces and mate", () => {
    const g = new Game("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
    const mate = g.legal.find((m) => m.to === parseSq("a8"))!;
    expect(moveFacts(g, mate).mate).toBe(true);
    const h = new Game("4k3/8/8/4p3/8/8/8/3QK3 w - - 0 1");
    const hang = h.legal.find((m) => m.to === parseSq("d4"))!;
    expect(moveFacts(h, hang).hanging).toBe(9);
    const c = new Game("4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1");
    const take = c.legal.find((m) => m.from === parseSq("d1") && m.to === parseSq("d2"))!;
    expect(moveFacts(c, take).gain).toBe(1);
  });

  it("king box shrinks as the net tightens", () => {
    // everything except the three squares the white king guards and the cut-off a1
    expect(kingBox(fromFen("7k/8/8/8/8/8/8/K7 w - - 0 1").board, WHITE)).toBe(60);
    expect(kingBox(fromFen("7k/8/6Q1/8/8/8/8/K7 w - - 0 1").board, WHITE)).toBeLessThan(5);
  });

  it("drill and puzzle positions are legal and puzzles contain a mate in one", () => {
    const rng = new Rng(4);
    for (let i = 0; i < 10; i++) {
      const d = new Game(drillFen(rng, i % 2 ? WHITE : BLACK));
      expect(d.result.over).toBe(false);
      const p = new Game(puzzleFen(rng, WHITE));
      expect(p.legal.some((m) => moveFacts(p, m).mate)).toBe(true);
    }
  });

  it("greedy bot takes the queen; club bot finds mate in one", () => {
    const rng = new Rng(1);
    const g = new Game("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1");
    expect(chooseOpponentMove("greedy", g, rng).to).toBe(parseSq("d5"));
    const m = new Game("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
    expect(chooseOpponentMove("minimax", m, rng).to).toBe(parseSq("a8"));
  });
});

describe("connectome chess player", () => {
  it("uses REAL dopaminergic populations and two non-empty compartments", () => {
    const { pam, ppl1 } = dopamineUnits(graph);
    expect(pam.every((i) => graph.units[i].class === "DAN" && graph.units[i].type.startsWith("PAM"))).toBe(true);
    const s = new ChessSession(graph, { seed: 7, rival: "random", exposurePositions: 4 });
    const [a, b] = s.fly.compartments;
    expect(a.pam.length && b.pam.length && a.ppl1.length && b.ppl1.length).toBeGreaterThan(0);
    expect(a.pam.length + b.pam.length).toBe(pam.length);
    expect(ppl1.length).toBeGreaterThan(5);
  });

  it("is deterministic for the same seeds", () => {
    const run = () => {
      const s = new ChessSession(graph, { seed: 11, rival: "greedy", exposurePositions: 4 });
      for (let i = 0; i < 30 && !s.game.result.over; i++) s.ply();
      return [s.game.moves.map((m) => m.san).join(" "), s.fly.pamMean()];
    };
    expect(run()).toEqual(run());
  });

  it("learns to deliver mate in one from dopamine alone", () => {
    const s = new ChessSession(graph, { seed: 5, rival: "random", exposurePositions: 8 });
    s.playPuzzles(150);
    expect(s.playPuzzles(40)).toBeGreaterThanOrEqual(28);
  });

  it("lesioning PAM + PPL1 flattens every burst and prevents learning", () => {
    const s = new ChessSession(graph, { seed: 5, rival: "random", lesionDopamine: true, exposurePositions: 8 });
    const before = s.fly.checkpoint().w;
    s.playPuzzles(60);
    expect(s.fly.checkpoint().w).toEqual(before);
    expect(s.playPuzzles(40)).toBeLessThan(12);
  });

  it("checkpoint round-trips and refuses a different fly", () => {
    const a = new ChessSession(graph, { seed: 7, rival: "random", exposurePositions: 4 });
    a.playPuzzles(10);
    const cp = a.fly.checkpoint();
    const b = new ChessSession(graph, { seed: 7, rival: "random", checkpoint: cp, exposurePositions: 4 });
    expect(Array.from(b.fly.w[1])).toEqual(cp.w[1]);
    expect(() => new ChessSession(graph, { seed: 8, rival: "random", checkpoint: cp, exposurePositions: 4 })).toThrow(/seed/);
  });

  const trainedPath = new URL("../../neuroprison/apps/web/public/data/chess/trained-s.json", import.meta.url);
  it.runIf(existsSync(trainedPath))("published Trained fly beats the random mover and solves mate in one", () => {
    const t = JSON.parse(readFileSync(trainedPath, "utf8"));
    const s = new ChessSession(graph, { seed: t.checkpoint.seed, rival: "random", flyColor: "alternate", gameSeed: 4242, checkpoint: t.checkpoint, learningRate: 0, exploit: true });
    expect(s.playPuzzles(40)).toBeGreaterThanOrEqual(32);
    const games = s.playGames(6);
    expect(games.filter((g) => g.outcome === "loss").length).toBe(0);
    expect(games.reduce((a, g) => a + g.material, 0) / games.length).toBeGreaterThan(5);
  });
});
