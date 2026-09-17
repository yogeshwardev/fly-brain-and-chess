"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { BLACK, KING, PAWN, PIECE_GLYPH, PIECE_NAME, WHITE, fileOf, rankOf, sqName } from "../src/chess";
import { OPPONENTS } from "../src/opponents";
import type { Candidate, GameRecord, PlyEvent, Rival } from "../src/session";
import type { BoardState, EvalSummary, FlyMode, FromChess, SideChoice, ToChess } from "./chessProtocol";
import { CHESS_CSS } from "./chessStyles";

export interface BrainViewProps {
  level: "B" | "C" | "S";
  getRates: () => Float32Array | null;
  autoRotate?: boolean;
  interactive?: boolean;
  exposure?: number;
  zoom?: number;
}

interface Props {
  BrainView: ComponentType<BrainViewProps>;
  graphUrl?: string;
  trainedUrl?: string;
  resultsUrl?: string;
}

interface EvalRow extends EvalSummary { puzzles: number }

export interface Results {
  generatedAt: string;
  seed: number;
  movesTrained: number;
  gamesTrained: number;
  puzzlesTrained: number;
  curriculum: string[];
  selection: string;
  graph: { units: number; edges: number; neuronsRepresented: number; pam: number; ppl1: number; readout: number; compartments: { pam: number; ppl1: number }[] };
  evals: { naive: Record<string, EvalRow | number>; trained: Record<string, EvalRow | number>; lesioned: Record<string, EvalRow | number> };
  curve: { games: number; material: number; blunderRate: number; freeCaptureRate: number; puzzles: number }[];
  population: { seed: number; winRandom: number; materialGreedy: number; puzzles: number }[];
}

type Ready = Extract<FromChess, { type: "ready" }>;
type FlyEvent = Extract<PlyEvent, { kind: "fly" }>;
type DopamineEvent = Extract<PlyEvent, { kind: "dopamine" }>;

interface Sprite { id: number; sq: number; piece: number }

const SPEEDS = [1, 2, 4, 8];
const SCOPE_N = 320;
const FLY_DELAY = 1150;
const RIVAL_DELAY = 750;
const RIVALS: { key: Rival; label: string }[] = [
  { key: "random", label: "Random" },
  { key: "greedy", label: "Greedy" },
  { key: "minimax", label: "Club bot" },
  { key: "human", label: "You" },
];

let spriteId = 1;

/** Keep piece identities across a move so pieces glide instead of blinking. */
function syncSprites(prev: Sprite[], board: number[], move: { from: number; to: number } | null): Sprite[] {
  const sprites = prev.map((s) => ({ ...s }));
  if (move) {
    const mover = sprites.find((s) => s.sq === move.from);
    const victim = sprites.find((s) => s.sq === move.to);
    if (victim && victim !== mover) victim.sq = -1;
    if (mover) {
      mover.sq = move.to;
      if (Math.abs(mover.piece) === KING && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
        const kingSide = fileOf(move.to) > fileOf(move.from);
        const rookFrom = move.to + (kingSide ? 1 : -2);
        const rook = sprites.find((s) => s.sq === rookFrom);
        if (rook) rook.sq = move.to + (kingSide ? -1 : 1);
      }
    }
  }
  const bySq = new Map<number, Sprite>();
  for (const s of sprites) if (s.sq >= 0) bySq.set(s.sq, s);
  const out: Sprite[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const v = board[sq];
    if (!v) continue;
    const s = bySq.get(sq);
    if (s && Math.sign(s.piece) === Math.sign(v)) out.push({ ...s, piece: v });
    else out.push({ id: spriteId++, sq, piece: v });
  }
  return out;
}

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const signed = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}`;
const colorName = (c: number) => (c === WHITE ? "White" : "Black");

export default function ChessLab({ BrainView, graphUrl = "/data/graphs/level-s.json", trainedUrl = "/data/chess/trained-s.json", resultsUrl = "/data/chess/results.json" }: Props) {
  const worker = useRef<Worker | null>(null);
  const rates = useRef<Float32Array | null>(null);
  const scope = useRef({ pam: new Float32Array(SCOPE_N), ppl1: new Float32Array(SCOPE_N), head: 0, queue: [] as [number, number][] });
  const scopeCanvas = useRef<HTMLCanvasElement | null>(null);
  const inflight = useRef(false);
  const busy = useRef(true);
  const lastPlyAt = useRef(0);
  const overAt = useRef(0);
  const seedRef = useRef(11);

  const [status, setStatus] = useState("starting…");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [state, setState] = useState<BoardState | null>(null);
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const [mode, setMode] = useState<FlyMode>("trained");
  const [rival, setRival] = useState<Rival>("greedy");
  const [side, setSide] = useState<SideChoice>("alternate");
  const [lesion, setLesion] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [thought, setThought] = useState<FlyEvent | null>(null);
  const [reward, setReward] = useState<DopamineEvent | null>(null);
  const [turbo, setTurbo] = useState<{ done: number; total: number; label: string } | null>(null);
  const [drillResult, setDrillResult] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = (m: ToChess) => worker.current?.postMessage(m);

  const reset = useCallback((m: FlyMode, r: Rival, s: SideChoice, les: boolean) => {
    busy.current = true;
    inflight.current = false;
    seedRef.current = (seedRef.current * 7919 + 17) % 100000;
    setThought(null);
    setReward(null);
    setSelected(null);
    send({ type: "reset", mode: m, rival: r, side: s, lesion: les, seed: seedRef.current });
  }, []);

  useEffect(() => {
    const w = new Worker(new URL("./chess.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (ev: MessageEvent<FromChess>) => {
      const m = ev.data;
      if (m.type === "status") setStatus(m.text);
      else if (m.type === "error") { setError(m.message); inflight.current = false; }
      else if (m.type === "ready") {
        setReady(m);
        setStatus("ready");
        const startMode: FlyMode = m.trained ? "trained" : "naive";
        setMode(startMode);
        reset(startMode, "greedy", "alternate", false);
      } else if (m.type === "state") {
        busy.current = false;
        inflight.current = false;
        lastPlyAt.current = performance.now();
        setMode(m.mode);
        setLesion(m.lesion);
        setState(m.state);
        setSprites((prev) => syncSprites(m.state.lastMove ? prev : [], m.state.board, null));
        setThought(null);
        setReward(null);
        setSelected(null);
      } else if (m.type === "ply") {
        inflight.current = false;
        lastPlyAt.current = performance.now();
        rates.current = m.rates;
        const sc = scope.current;
        for (let i = 0; i < m.trace.pam.length; i++) sc.queue.push([m.trace.pam[i], m.trace.ppl1[i]]);
        for (const e of m.events) {
          if (e.kind === "fly") setThought(e);
          else if (e.kind === "dopamine") setReward(e);
        }
        if (m.state.result.over) overAt.current = performance.now();
        setState(m.state);
        setSprites((prev) => syncSprites(prev, m.state.board, m.state.lastMove));
        setSelected(null);
      } else if (m.type === "turbo") {
        if (m.state) {
          busy.current = false;
          inflight.current = false;
          setTurbo(null);
          setState(m.state);
          setSprites(syncSprites([], m.state.board, null));
          setThought(null);
          setReward(null);
          lastPlyAt.current = performance.now();
          if (m.puzzles) setDrillResult(`Mate-in-one drill: ${m.puzzles.solved} of ${m.puzzles.n} solved`);
        } else setTurbo((t) => (t ? { ...t, done: m.done, total: m.total } : t));
      }
    };
    w.onerror = (e) => setError(e.message || "worker failed to start");
    w.postMessage({ type: "init", graphUrl, trainedUrl } satisfies ToChess);
    fetch(resultsUrl).then((r) => (r.ok ? r.json() : null)).then(setResults).catch(() => null);
    return () => w.terminate();
  }, [graphUrl, trainedUrl, resultsUrl, reset]);

  // game clock: asks the worker for the next ply at a readable pace
  useEffect(() => {
    let raf = 0;
    let lastDraw = 0;
    let lastT = performance.now();
    const loop = (now: number) => {
      const st = stateRef.current;
      const sp = speedRef.current;
      if (st && !busy.current && !inflight.current && !pausedRef.current) {
        if (st.result.over) {
          if (st.rival !== "human" && now - overAt.current > 3200 / sp) {
            inflight.current = true;
            worker.current?.postMessage({ type: "step" } satisfies ToChess);
          }
        } else {
          const flyTurn = st.turn === st.flyColor;
          if ((flyTurn || st.rival !== "human") && now - lastPlyAt.current > (flyTurn ? FLY_DELAY : RIVAL_DELAY) / sp) {
            inflight.current = true;
            worker.current?.postMessage({ type: "step" } satisfies ToChess);
          }
        }
      }
      // dopamine scope: replay the committed brain ticks at 20 ticks / simulated second
      const sc = scope.current;
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      let n = Math.max(0, Math.round(dt * 20 * sp + (sc.queue.length > 60 ? sc.queue.length - 60 : 0)));
      if (!pausedRef.current || sc.queue.length > 60) {
        while (n-- > 0 && sc.queue.length) {
          const [a, b] = sc.queue.shift()!;
          sc.pam[sc.head] = a;
          sc.ppl1[sc.head] = b;
          sc.head = (sc.head + 1) % SCOPE_N;
        }
      }
      if (now - lastDraw > 50) {
        lastDraw = now;
        drawScope();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const drawScope = () => {
    const c = scopeCanvas.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const w = (c.width = Math.max(1, c.clientWidth * devicePixelRatio));
    const h = (c.height = Math.max(1, c.clientHeight * devicePixelRatio));
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(201,164,92,0.10)";
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, (h * i) / 4);
      g.lineTo(w, (h * i) / 4);
      g.stroke();
    }
    const sc = scope.current;
    const plot = (arr: Float32Array, color: string, fill: string) => {
      g.beginPath();
      for (let i = 0; i < SCOPE_N; i++) {
        const v = arr[(sc.head + i) % SCOPE_N];
        const x = (i / (SCOPE_N - 1)) * w;
        const y = h - Math.min(1, v) * h * 0.9 - 2;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.lineWidth = 1.6 * devicePixelRatio;
      g.strokeStyle = color;
      g.stroke();
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.fillStyle = fill;
      g.fill();
    };
    plot(sc.ppl1, "#9a87d0", "rgba(154,135,208,0.08)");
    plot(sc.pam, "#e3b55a", "rgba(227,181,90,0.12)");
  };

  const runTurbo = (games: number) => {
    if (busy.current || !state) return;
    busy.current = true;
    setDrillResult(null);
    setTurbo({ done: 0, total: games, label: `Training ${games} games` });
    send({ type: "turbo", games });
  };
  const runDrill = (n: number) => {
    if (busy.current || !state) return;
    busy.current = true;
    setDrillResult(null);
    setTurbo({ done: 0, total: n, label: `Mate-in-one drill · ${n} puzzles` });
    send({ type: "puzzles", n });
  };

  const change = (next: { mode?: FlyMode; rival?: Rival; side?: SideChoice; lesion?: boolean }) => {
    const m = next.mode ?? mode;
    const r = next.rival ?? rival;
    let s = next.side ?? side;
    if (r === "human" && s === "alternate") s = "black";
    setMode(m);
    setRival(r);
    setSide(s);
    setLesion(next.lesion ?? lesion);
    reset(m, r, s, next.lesion ?? lesion);
  };

  const humanColor = state ? (-state.flyColor as 1 | -1) : BLACK;
  const orientation: 1 | -1 = state ? (state.rival === "human" ? humanColor : state.flyColor) : WHITE;
  const humanTurn = Boolean(state && state.legal.length);

  const onSquare = (sq: number) => {
    if (!state || !humanTurn || inflight.current) return;
    const v = state.board[sq];
    if (selected !== null) {
      const mv = state.legal.find((m) => m.from === selected && m.to === sq);
      if (mv) {
        const promo = state.legal.some((m) => m.from === selected && m.to === sq && m.promo === 5) ? 5 : mv.promo;
        inflight.current = true;
        // show the move at once; the worker's reply confirms it
        setSprites((prev) => syncSprites(prev, applyLocal(state.board, selected, sq, promo), { from: selected, to: sq }));
        send({ type: "human", from: selected, to: sq, promo });
        setSelected(null);
        return;
      }
    }
    if (v && Math.sign(v) === humanColor && state.legal.some((m) => m.from === sq)) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  };

  const arrows = useMemo(() => {
    if (!thought) return [];
    const all = thought.candidates.map((c, i) => ({ ...c, chosen: c.from === thought.move.from && c.to === thought.move.to && c.promo === thought.move.promo, rank: i }));
    return all.filter((c) => c.rank < 3 || c.chosen);
  }, [thought]);

  const records = state?.records ?? [];
  const stats = state?.stats;
  const moveNo = state ? Math.floor(state.san.length / 2) + 1 : 1;
  const flyName = `The fly${mode === "trained" ? " · trained" : " · naive"}${lesion ? " · lesioned" : ""}`;
  const rivalName = rival === "human" ? "You" : OPPONENTS[rival].name;
  const captured = state ? capturedPieces(state.board) : { white: [], black: [] };
  const flyCaptures = state ? (state.flyColor === WHITE ? captured.black : captured.white) : [];
  const rivalCaptures = state ? (state.flyColor === WHITE ? captured.white : captured.black) : [];

  let turnLine = status;
  if (state) {
    if (state.result.over) turnLine = resultLine(state);
    else if (state.turn === state.flyColor) turnLine = "The fly is weighing its moves…";
    else if (state.rival === "human") turnLine = selected !== null ? `Your move · ${PIECE_NAME[Math.abs(state.board[selected])]} on ${sqName(selected)} selected` : "Your move · select a piece";
    else turnLine = `${rivalName} to move`;
  }

  const topIsFly = orientation !== state?.flyColor;
  const plateFly = <PlayerPlate key="fly" name={flyName} sub={state ? `${colorName(state.flyColor)} · MaleCNS connectome` : "MaleCNS connectome"} color={state?.flyColor ?? WHITE} active={Boolean(state && !state.result.over && state.turn === state.flyColor)} captures={flyCaptures} lead={state ? state.material : 0} fly />;
  const plateRival = <PlayerPlate key="rival" name={rivalName} sub={state ? `${colorName(-state.flyColor)} · ${rival === "human" ? "human player" : OPPONENTS[rival].blurb}` : ""} color={(state ? -state.flyColor : BLACK) as 1 | -1} active={Boolean(state && !state.result.over && state.turn !== state.flyColor)} captures={rivalCaptures} lead={state ? -state.material : 0} />;

  const leftPanels = (
    <>
      <MatchPanel
        ready={ready} mode={mode} rival={rival} side={side} lesion={lesion}
        onMode={(m) => change({ mode: m })} onRival={(r) => change({ rival: r })} onSide={(s) => change({ side: s })} onLesion={() => change({ lesion: !lesion })}
        onNew={() => { if (!busy.current) { inflight.current = false; send({ type: "newGame" }); } }}
        onTurbo={runTurbo} onDrill={runDrill} drillResult={drillResult}
      />
      <Scoreboard records={records} stats={stats} mode={mode} />
    </>
  );

  return (
    <div className="fc-root">
      <style>{CHESS_CSS}</style>
      <header className="fc-header">
        <div className="fc-brand">
          <Link href="/" className="fc-np">NEUROPRISON</Link>
          <span className="fc-rule" />
          <div>
            <div className="fc-eyebrow">Day III</div>
            <h1 className="fc-title">Fly Chess</h1>
          </div>
        </div>
        <p className="fc-tagline hide-sm">A connectome-derived fruit fly learns chess from simulated dopamine.</p>
        <div className="fc-controls">
          <button className={`fc-btn ${paused ? "on" : ""}`} onClick={() => setPaused((p) => !p)} data-testid="pause">{paused ? "Resume" : "Pause"}</button>
          <div className="fc-seg" role="group" aria-label="speed">
            {SPEEDS.map((s) => <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
        </div>
      </header>

      <div className="fc-layout">
        <aside className="fc-col fc-left">{leftPanels}</aside>

        <main className="fc-stage">
          <div className="fc-boardcol">
            {topIsFly ? plateFly : plateRival}
            <div className="fc-frame">
              <Board
                board={state?.board ?? START_BOARD}
                sprites={sprites}
                orientation={orientation}
                lastMove={state?.lastMove ?? null}
                checkSquare={state?.checkSquare ?? -1}
                arrows={arrows}
                selected={selected}
                targets={selected !== null && state ? state.legal.filter((m) => m.from === selected).map((m) => m.to) : []}
                movable={humanTurn && state ? new Set(state.legal.map((m) => m.from)) : null}
                onSquare={onSquare}
              />
              {state?.result.over && <GameOverCard state={state} human={state.rival === "human"} onNew={() => { inflight.current = false; send({ type: "newGame" }); }} />}
              {turbo && (
                <div className="fc-veil">
                  <div className="fc-veil-title">{turbo.label}</div>
                  <div className="fc-veil-sub">{turbo.done} / {turbo.total} · same simulation, no rendering</div>
                  <div className="fc-meter"><i style={{ width: pct(turbo.done / Math.max(1, turbo.total)) }} /></div>
                </div>
              )}
              {(error || !ready) && (
                <div className="fc-veil">
                  <div className={`fc-veil-sub ${error ? "bad" : "pulse"}`}>{error ?? status}</div>
                  {error && <div className="fc-veil-sub">build the graph first: python ../DAY-2/scripts/build_saber_graph.py</div>}
                </div>
              )}
            </div>
            {topIsFly ? plateRival : plateFly}
            <div className="fc-statusline">
              <span className="fc-move-no">Move {moveNo}</span>
              <span data-testid="turn-line">{turnLine}</span>
              {state?.drill && <span className="fc-chip">mating drill</span>}
            </div>
          </div>
        </main>

        <aside className="fc-col fc-right">
          <div className="fc-left-dup">{leftPanels}</div>
          <Deliberation thought={thought} />
          <DopaminePanel canvas={scopeCanvas} reward={reward} lesion={lesion} released={stats?.dopamineReleased ?? 0} />
          <section className="fc-card">
            <CardHead title="Brain activity" note="Level S · live rates" />
            <div className="fc-brain">
              <BrainView level="S" getRates={() => rates.current} autoRotate interactive={false} exposure={0.7} zoom={2.4} />
            </div>
          </section>
          <MoveRecord san={state?.san ?? []} flyColor={state?.flyColor ?? WHITE} />
          {results && <RecordedResults r={results} />}
          <HowItLearns ready={ready} />
          <p className="fc-disclaimer">
            Connectome-derived computational simulation. Structure: MaleCNS v1.0 (real PAM/PPL1 dopaminergic, MBON, Kenyon-cell and
            sensory→descending populations). The chess rules, move facts, stimulus encoding, valence readout, reward currents and
            sparring bots are engineered. No claim that a real fly understands chess.{" "}
            <Link href="/science">Real vs. modeled →</Link>
          </p>
        </aside>
      </div>
    </div>
  );
}

const START_BOARD = (() => {
  const b = new Array(64).fill(0);
  const back = [4, 2, 3, 5, 6, 3, 2, 4];
  for (let f = 0; f < 8; f++) {
    b[f] = back[f];
    b[8 + f] = PAWN;
    b[48 + f] = -PAWN;
    b[56 + f] = -back[f];
  }
  return b;
})();

function applyLocal(board: number[], from: number, to: number, promo: number): number[] {
  const b = board.slice();
  const v = b[from];
  const t = Math.abs(v);
  if (t === PAWN && fileOf(from) !== fileOf(to) && !b[to]) b[to - 8 * Math.sign(v)] = 0;
  if (t === KING && Math.abs(fileOf(to) - fileOf(from)) === 2) {
    const kingSide = fileOf(to) > fileOf(from);
    b[to + (kingSide ? -1 : 1)] = b[to + (kingSide ? 1 : -2)];
    b[to + (kingSide ? 1 : -2)] = 0;
  }
  b[from] = 0;
  b[to] = promo ? Math.sign(v) * promo : v;
  return b;
}

function capturedPieces(board: number[]): { white: number[]; black: number[] } {
  const full = [0, 8, 2, 2, 2, 1, 1];
  const have = { white: new Array(7).fill(0), black: new Array(7).fill(0) };
  for (const v of board) if (v) (v > 0 ? have.white : have.black)[Math.abs(v)]++;
  const lost = (h: number[]) => {
    const out: number[] = [];
    // promotions can push a count above its starting number; pawns absorb the difference
    let extra = 0;
    for (let t = 2; t <= 5; t++) extra += Math.max(0, h[t] - full[t]);
    for (let t = 5; t >= 1; t--) {
      const miss = t === PAWN ? Math.max(0, full[t] - h[t] - extra) : Math.max(0, full[t] - h[t]);
      for (let i = 0; i < miss; i++) out.push(t);
    }
    return out;
  };
  return { white: lost(have.white), black: lost(have.black) };
}

function resultLine(s: BoardState): string {
  if (!s.result.over) return "";
  const r = s.result;
  if (r.winner === 0) return `Drawn · ${r.reason}`;
  const flyWon = r.winner === s.flyColor;
  const who = flyWon ? "The fly" : s.rival === "human" ? "You" : OPPONENTS[s.rival as keyof typeof OPPONENTS].name;
  return `${who} won by ${r.reason}`;
}

function CardHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="fc-card-h">
      <h2>{title}</h2>
      {note && <span>{note}</span>}
    </div>
  );
}

function Glyph({ piece, size = "1em" }: { piece: number; size?: string }) {
  return <span className={`fc-glyph ${piece > 0 ? "w" : "b"}`} style={{ fontSize: size }}>{PIECE_GLYPH[Math.abs(piece)]}</span>;
}

function PlayerPlate({ name, sub, color, active, captures, lead, fly }: { name: string; sub: string; color: 1 | -1; active: boolean; captures: number[]; lead: number; fly?: boolean }) {
  return (
    <div className={`fc-plate ${active ? "active" : ""}`}>
      <div className={`fc-token ${color > 0 ? "w" : "b"}`}>{fly ? <FlyMark /> : <Glyph piece={color * KING} size="20px" />}</div>
      <div className="fc-plate-text">
        <div className="fc-plate-name">{name}</div>
        <div className="fc-plate-sub">{sub}</div>
      </div>
      <div className="fc-captures" title="pieces captured">
        {captures.map((t, i) => <Glyph key={i} piece={-color * t} size="15px" />)}
        {lead > 0 && <span className="fc-lead">+{lead}</span>}
      </div>
      {active && <span className="fc-clock-dot" aria-label="to move" />}
    </div>
  );
}

function FlyMark() {
  return (
    <svg viewBox="0 0 40 40" width="22" height="22" aria-hidden>
      <ellipse cx="20" cy="23" rx="5.2" ry="9" fill="currentColor" />
      <circle cx="20" cy="12" r="3.6" fill="currentColor" />
      <path d="M19 17 C 8 10, 3 18, 9 24 C 13 27, 17 23, 19 20 Z" fill="currentColor" opacity="0.45" />
      <path d="M21 17 C 32 10, 37 18, 31 24 C 27 27, 23 23, 21 20 Z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

interface Arrow extends Candidate { chosen: boolean; rank: number }

function Board({ board, sprites, orientation, lastMove, checkSquare, arrows, selected, targets, movable, onSquare }: {
  board: number[]; sprites: Sprite[]; orientation: 1 | -1; lastMove: { from: number; to: number } | null; checkSquare: number;
  arrows: Arrow[]; selected: number | null; targets: number[]; movable: Set<number> | null; onSquare: (sq: number) => void;
}) {
  const pos = (sq: number) => {
    const col = orientation === WHITE ? fileOf(sq) : 7 - fileOf(sq);
    const row = orientation === WHITE ? 7 - rankOf(sq) : rankOf(sq);
    return { col, row };
  };
  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = orientation === WHITE ? (7 - row) * 8 + col : row * 8 + (7 - col);
      const light = (fileOf(sq) + rankOf(sq)) % 2 === 1;
      const cls = ["fc-sq", light ? "l" : "d"];
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cls.push("last");
      if (selected === sq) cls.push("sel");
      if (movable?.has(sq)) cls.push("movable");
      const target = targets.includes(sq);
      squares.push(
        <div key={sq} className={cls.join(" ")} onClick={() => onSquare(sq)} data-sq={sqName(sq)}>
          {checkSquare === sq && <span className="fc-check" />}
          {target && <span className={board[sq] ? "fc-ring" : "fc-dot"} />}
          {col === 0 && <span className="fc-coord r">{rankOf(sq) + 1}</span>}
          {row === 7 && <span className="fc-coord f">{"abcdefgh"[fileOf(sq)]}</span>}
        </div>,
      );
    }
  }
  const center = (sq: number) => {
    const { col, row } = pos(sq);
    return [col * 100 + 50, row * 100 + 50];
  };
  return (
    <div className="fc-board" data-testid="board">
      <div className="fc-squares">{squares}</div>
      <svg className="fc-arrows" viewBox="0 0 800 800" aria-hidden>
        <defs>
          <marker id="fc-ah-gold" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d7ad55" /></marker>
          <marker id="fc-ah-ivory" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3f6a8c" /></marker>
        </defs>
        {arrows.slice().reverse().map((a) => {
          const [x1, y1] = center(a.from);
          const [x2, y2] = center(a.to);
          const len = Math.hypot(x2 - x1, y2 - y1);
          const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
          const op = a.chosen ? 0.9 : Math.max(0.38, Math.min(0.75, 0.3 + a.p * 1.5));
          return (
            <line key={`${a.from}-${a.to}-${a.promo}`} x1={x1 + ux * 8} y1={y1 + uy * 8} x2={x2 - ux * 26} y2={y2 - uy * 26}
              stroke={a.chosen ? "#d7ad55" : "#3f6a8c"} strokeOpacity={op} strokeWidth={a.chosen ? 17 : 10} strokeLinecap="round"
              markerEnd={`url(#${a.chosen ? "fc-ah-gold" : "fc-ah-ivory"})`} className="fc-arrow" />
          );
        })}
      </svg>
      <div className="fc-pieces">
        {sprites.map((s) => {
          const { col, row } = pos(s.sq);
          return (
            <div key={s.id} className="fc-piece" style={{ transform: `translate(${col * 100}%, ${row * 100}%)` }}>
              <svg viewBox="0 0 100 100">
                <text x="50" y="54" className={s.piece > 0 ? "w" : "b"}>{PIECE_GLYPH[Math.abs(s.piece)]}</text>
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GameOverCard({ state, human, onNew }: { state: BoardState; human: boolean; onNew: () => void }) {
  if (!state.result.over) return null;
  const r = state.result;
  const flyWon = r.winner === state.flyColor;
  const title = r.reason === "checkmate" ? "Checkmate" : r.winner === 0 ? "Draw" : "Game over";
  const who = r.winner === 0 ? `by ${r.reason}` : flyWon ? "The fly wins" : human ? "You win" : `${OPPONENTS[state.rival as keyof typeof OPPONENTS].name} wins`;
  return (
    <div className="fc-over fade-in" data-testid="game-over">
      <div className="fc-over-card">
        <div className="fc-eyebrow">{state.drill ? "Mating drill" : `Game ${state.gameNo}`} · {Math.ceil(state.san.length / 2)} moves</div>
        <div className="fc-over-title">{title}</div>
        <div className={`fc-over-sub ${r.winner === 0 ? "" : flyWon ? "good" : "bad"}`}>{who}</div>
        <div className="fc-over-note">material at the end {signed(state.material, 0)} for the fly</div>
        {human ? <button className="fc-btn gold" onClick={onNew}>New game</button> : <div className="fc-over-note">next game starts shortly…</div>}
      </div>
    </div>
  );
}

function MatchPanel(p: {
  ready: Ready | null; mode: FlyMode; rival: Rival; side: SideChoice; lesion: boolean;
  onMode: (m: FlyMode) => void; onRival: (r: Rival) => void; onSide: (s: SideChoice) => void; onLesion: () => void;
  onNew: () => void; onTurbo: (n: number) => void; onDrill: (n: number) => void; drillResult: string | null;
}) {
  const human = p.rival === "human";
  return (
    <section className="fc-card" data-testid="match">
      <CardHead title="The match" note="MaleCNS v1.0" />
      <div className="fc-card-b">
        <div className="fc-field">
          <label>Fly</label>
          <div className="fc-seg wide">
            <button className={p.mode === "naive" ? "on" : ""} onClick={() => p.onMode("naive")} data-testid="mode-naive">Naive</button>
            <button className={p.mode === "trained" ? "on" : ""} disabled={!p.ready?.trained} onClick={() => p.onMode("trained")} data-testid="mode-trained">Trained</button>
          </div>
        </div>
        <div className="fc-field">
          <label>Opponent</label>
          <div className="fc-seg wide four">
            {RIVALS.map((r) => <button key={r.key} className={p.rival === r.key ? "on" : ""} onClick={() => p.onRival(r.key)} data-testid={`rival-${r.key}`}>{r.label}</button>)}
          </div>
          <div className="fc-hint">{human ? "Click a piece, then its destination. Pawns promote to a queen." : OPPONENTS[p.rival as keyof typeof OPPONENTS].blurb}</div>
        </div>
        <div className="fc-field">
          <label>{human ? "You play" : "Fly plays"}</label>
          <div className="fc-seg wide">
            {human ? (
              <>
                <button className={p.side === "black" ? "on" : ""} onClick={() => p.onSide("black")}>White</button>
                <button className={p.side === "white" ? "on" : ""} onClick={() => p.onSide("white")}>Black</button>
              </>
            ) : (
              <>
                <button className={p.side === "white" ? "on" : ""} onClick={() => p.onSide("white")}>White</button>
                <button className={p.side === "black" ? "on" : ""} onClick={() => p.onSide("black")}>Black</button>
                <button className={p.side === "alternate" ? "on" : ""} onClick={() => p.onSide("alternate")}>Alternate</button>
              </>
            )}
          </div>
        </div>
        <div className="fc-actions">
          <button className="fc-btn" onClick={p.onNew} data-testid="new-game">New game</button>
          <button className={`fc-btn danger ${p.lesion ? "on" : ""}`} onClick={p.onLesion} data-testid="lesion">{p.lesion ? "Restore dopamine" : "Lesion dopamine"}</button>
        </div>
        <div className="fc-sub-h">Train this fly now</div>
        <div className="fc-actions">
          <button className="fc-btn" onClick={() => p.onTurbo(10)} data-testid="turbo">10 games</button>
          <button className="fc-btn" onClick={() => p.onDrill(50)} data-testid="drill">Mate drill · 50</button>
        </div>
        {p.drillResult && <div className="fc-hint good">{p.drillResult}</div>}
        {p.lesion && <div className="fc-hint bad">Every PAM and PPL1 population is silenced: no dopamine burst, so nothing is learned.</div>}
      </div>
    </section>
  );
}

function Scoreboard({ records, stats, mode }: { records: GameRecord[]; stats?: BoardState["stats"]; mode: FlyMode }) {
  const recent = records.slice(-40);
  const full = records.filter((r) => !r.drill);
  const mat = full.slice(-20);
  const avgMat = mat.length ? mat.reduce((a, r) => a + r.material, 0) / mat.length : 0;
  return (
    <section className="fc-card" data-testid="scoreboard">
      <CardHead title="Scoreboard" note={mode === "trained" ? "learning continues" : "learning live"} />
      <div className="fc-card-b">
        <div className="fc-tally">
          <div><b className="good">{stats?.wins ?? 0}</b><span>Won</span></div>
          <div><b>{stats?.draws ?? 0}</b><span>Drawn</span></div>
          <div><b className="bad">{stats?.losses ?? 0}</b><span>Lost</span></div>
        </div>
        <div className="fc-results-strip" aria-label="recent results">
          {recent.length ? recent.map((r, i) => <i key={i} className={r.outcome} title={`game ${r.game}: ${r.outcome} (${r.reason})${r.drill ? " · drill" : ""}`} />) : <span className="fc-hint">no finished games yet</span>}
        </div>
        <dl className="fc-kv">
          <dt>Moves learned from</dt><dd>{(stats?.movesTrained ?? 0).toLocaleString("en-US")}</dd>
          <dt>Blunders · last 200 moves</dt><dd>{pct(stats?.recentBlunders ?? 0, 1)}</dd>
          <dt>Free captures taken</dt><dd>{pct(stats?.recentCaptures ?? 0)}</dd>
          <dt>Mate-in-one drills solved</dt><dd>{stats?.puzzles ? `${stats.puzzlesSolved} / ${stats.puzzles}` : "—"}</dd>
          <dt>Avg. material · last 20 games</dt><dd>{mat.length ? signed(avgMat) : "—"}</dd>
        </dl>
        <MaterialChart records={full.slice(-60)} />
      </div>
    </section>
  );
}

function MaterialChart({ records }: { records: GameRecord[] }) {
  if (records.length < 2) return <div className="fc-chart-empty">material balance per game appears here</div>;
  const W = 300, H = 70;
  const max = Math.max(10, ...records.map((r) => Math.abs(r.material)));
  const x = (i: number) => (i / (records.length - 1)) * W;
  const y = (v: number) => H / 2 - (v / max) * (H / 2 - 4);
  return (
    <svg className="fc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="final material per game">
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(201,164,92,0.25)" strokeDasharray="3 4" />
      {records.map((r, i) => <rect key={i} x={x(i) - 1.5} width={3} y={Math.min(y(r.material), H / 2)} height={Math.abs(y(r.material) - H / 2)} fill={r.material >= 0 ? "#7fb58a" : "#d0715f"} opacity={0.75} />)}
    </svg>
  );
}

function Deliberation({ thought }: { thought: FlyEvent | null }) {
  return (
    <section className="fc-card" data-testid="deliberation">
      <CardHead title="The fly's deliberation" note={thought ? `${thought.legalCount} legal moves imagined` : undefined} />
      <div className="fc-card-b">
        {thought ? (
          <>
            <ol className="fc-cands">
              {thought.candidates.map((c) => {
                const chosen = c.from === thought.move.from && c.to === thought.move.to && c.promo === thought.move.promo;
                return (
                  <li key={`${c.from}-${c.to}-${c.promo}`} className={chosen ? "chosen" : ""}>
                    <span className="fc-san">{c.san}</span>
                    <span className="fc-pbar"><i style={{ width: pct(Math.max(0.01, c.p)) }} /></span>
                    <span className="fc-p">{pct(c.p, c.p < 0.1 ? 1 : 0)}</span>
                    <span className="fc-tags">
                      {c.mate && <em className="gold">mate</em>}
                      {!c.mate && c.check && <em>check</em>}
                      {c.gain > 0 && <em className="good">+{c.gain}</em>}
                      {c.hanging > 0 && <em className="bad">risks {c.hanging}</em>}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="fc-verdict">
              Played <b>{thought.san}</b>
              {thought.blunder ? <span className="bad"> · a blunder (leaves material hanging)</span> : null}
            </div>
            <div className="fc-hint">Each legal move is shown to the brain as a stimulus from the same state; the Kenyon-cell / MBON / descending readout predicts how much dopamine it will earn.</div>
          </>
        ) : <div className="fc-hint">The fly's top candidates appear here, with the probability it gave each.</div>}
      </div>
    </section>
  );
}

function DopaminePanel({ canvas, reward, lesion, released }: { canvas: React.RefObject<HTMLCanvasElement | null>; reward: DopamineEvent | null; lesion: boolean; released: number }) {
  const bar = (v: number) => (
    <span className="fc-dbar">
      <i style={{ left: v >= 0 ? "50%" : `${50 + Math.max(-1, v) * 50}%`, width: `${Math.min(1, Math.abs(v)) * 50}%`, background: v >= 0 ? "#e3b55a" : "#9a87d0" }} />
    </span>
  );
  return (
    <section className="fc-card" data-testid="dopamine">
      <CardHead title="Dopamine" note={lesion ? "PAM + PPL1 silenced" : `released ${released.toFixed(1)} a.u.`} />
      <div className="fc-card-b">
        <div className="fc-scope">
          <canvas ref={canvas} />
          <div className="fc-legend"><span className="pam">PAM · reward</span><span className="ppl1">PPL1 · punishment</span></div>
        </div>
        {reward ? (
          <div className="fc-reward">
            <div className="fc-reason">{reward.reason}</div>
            <div className="fc-dgrid">
              <span />
              <span className="fc-dh">delivered</span>
              <span className="fc-dh">burst</span>
              <span className="fc-dh">surprise</span>
              {(["Material", "King hunt"] as const).map((name, c) => (
                <FragmentRow key={name} name={name} d={reward.reward[c]} b={reward.burst[c]} r={reward.rpes[c]} bar={bar} />
              ))}
            </div>
          </div>
        ) : <div className="fc-hint">After each reply the outcome is injected as current into the fly's own dopamine neurons.</div>}
      </div>
    </section>
  );
}

function FragmentRow({ name, d, b, r, bar }: { name: string; d: number; b: number; r: number; bar: (v: number) => React.ReactNode }) {
  return (
    <>
      <span className="fc-dname">{name}</span>
      <span>{bar(d)}</span>
      <span className="fc-num">{signed(b, 2)}</span>
      <span className={`fc-num ${r > 0.05 ? "good" : r < -0.05 ? "bad" : ""}`}>{signed(r, 2)}</span>
    </>
  );
}

function MoveRecord({ san, flyColor }: { san: string[]; flyColor: 1 | -1 }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [san.length]);
  const rows = [];
  for (let i = 0; i < san.length; i += 2) {
    rows.push(
      <div key={i} className="fc-mrow">
        <span className="fc-mno">{i / 2 + 1}.</span>
        <span className={flyColor === WHITE ? "fly" : ""}>{san[i]}</span>
        <span className={flyColor === BLACK ? "fly" : ""}>{san[i + 1] ?? ""}</span>
      </div>,
    );
  }
  return (
    <section className="fc-card">
      <CardHead title="Score sheet" note="fly's moves in gold" />
      <div className="fc-moves" ref={ref}>{rows.length ? rows : <div className="fc-hint">no moves yet</div>}</div>
    </section>
  );
}

function RecordedResults({ r }: { r: Results }) {
  const row = (k: string) => [r.evals.naive[k], r.evals.trained[k], r.evals.lesioned[k]] as (EvalRow | number)[];
  const e = (v: EvalRow | number) => v as EvalRow;
  const cells: { label: string; get: (v: EvalRow | number) => string; key: string; better: "high" | "low" }[] = [
    { label: "Wins vs Random mover", key: "vsRandom", get: (v) => `${e(v).wins}/${e(v).games}`, better: "high" },
    { label: "Material vs Random", key: "vsRandom", get: (v) => signed(e(v).material), better: "high" },
    { label: "Material vs Greedy", key: "vsGreedy", get: (v) => signed(e(v).material), better: "high" },
    { label: "Blunder rate vs Greedy", key: "vsGreedy", get: (v) => pct(e(v).blunderRate, 1), better: "low" },
    { label: "Free captures taken", key: "vsGreedy", get: (v) => pct(e(v).freeCaptureRate), better: "high" },
    { label: "Mate in one solved", key: "puzzles", get: (v) => pct(v as number), better: "high" },
  ];
  const last = r.curve[r.curve.length - 1];
  return (
    <section className="fc-card" data-testid="recorded">
      <CardHead title="Recorded experiment" note={`seed ${r.seed}`} />
      <div className="fc-card-b">
        <table className="fc-table">
          <thead><tr><th /><th>Naive</th><th>Trained</th><th>Lesioned*</th></tr></thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.label}>
                <th>{c.label}</th>
                {row(c.key).map((v, i) => <td key={i} className={i === 1 ? "hi" : ""}>{v === undefined ? "—" : c.get(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="fc-hint">Learning frozen, performance mode, fresh opponent seeds. *Lesioned: the same curriculum from scratch with every PAM and PPL1 population silenced.</div>
        <div className="fc-sub-h">Training curve · {r.gamesTrained} games + {r.puzzlesTrained} drills</div>
        <CurveChart curve={r.curve} />
        <div className="fc-legend-row"><span className="gold">material vs Greedy</span><span className="violet">mate-in-one solved</span></div>
        {last && <div className="fc-hint">{r.curriculum.join(" → ")} · {r.movesTrained.toLocaleString("en-US")} dopamine-reinforced decisions</div>}
        {r.population.length > 1 && (
          <>
            <div className="fc-sub-h">Population · {r.population.length} flies</div>
            <table className="fc-table small">
              <thead><tr><th>fly</th><th>wins vs Random</th><th>material vs Greedy</th><th>mate in one</th></tr></thead>
              <tbody>
                {r.population.map((f) => (
                  <tr key={f.seed} className={f.seed === r.seed ? "star" : ""}>
                    <th>{f.seed}{f.seed === r.seed ? " ★" : ""}</th>
                    <td>{pct(f.winRandom)}</td><td>{signed(f.materialGreedy)}</td><td>{pct(f.puzzles)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="fc-hint">★ published fly: {r.selection}</div>
          </>
        )}
      </div>
    </section>
  );
}

function CurveChart({ curve }: { curve: Results["curve"] }) {
  if (curve.length < 2) return null;
  const W = 320, H = 90;
  const x = (i: number) => (i / (curve.length - 1)) * W;
  const mMax = Math.max(10, ...curve.map((c) => Math.abs(c.material)));
  const ym = (v: number) => H / 2 - (v / mMax) * (H / 2 - 4);
  const yp = (v: number) => H - 3 - v * (H - 6);
  return (
    <svg className="fc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(201,164,92,0.2)" strokeDasharray="3 4" />
      <path d={curve.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yp(c.puzzles).toFixed(1)}`).join(" ")} fill="none" stroke="#9a87d0" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
      <path d={curve.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${ym(c.material).toFixed(1)}`).join(" ")} fill="none" stroke="#e3b55a" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function HowItLearns({ ready }: { ready: Ready | null }) {
  const box = (x: number, y: number, w: number, title: string, sub: string, tone: string) => (
    <g>
      <rect x={x} y={y} width={w} height={42} rx={4} fill="#151a21" stroke={tone} strokeOpacity={0.75} />
      <text x={x + w / 2} y={y + 18} textAnchor="middle" fill={tone} className="fc-svg-t">{title}</text>
      <text x={x + w / 2} y={y + 32} textAnchor="middle" fill="#8d95a3" className="fc-svg-s">{sub}</text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, color = "#6d7684", dash = false) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.3} markerEnd="url(#fc-hl)" strokeDasharray={dash ? "3 3" : undefined} />
  );
  return (
    <section className="fc-card">
      <CardHead title="How the fly learns" />
      <div className="fc-card-b">
        <svg viewBox="0 0 340 262" width="100%" role="img" aria-label="learning loop">
          <defs><marker id="fc-hl" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#6d7684" /></marker></defs>
          {box(8, 8, 102, "LEGAL MOVES", "rules engine", "#efe8da")}
          {box(119, 8, 102, "MOVE FACTS", "21 per move", "#efe8da")}
          {box(230, 8, 102, "SENSORY", `${ready?.sensory ?? 34} populations`, "#8fb8c9")}
          {box(230, 80, 102, "BRAIN", "MaleCNS wiring", "#b3a3dc")}
          {box(119, 80, 102, "READOUT", `KC · MBON · DN (${ready?.readout ?? 151})`, "#e0b36a")}
          {box(8, 80, 102, "MOVE", "highest valence", "#efe8da")}
          {box(8, 160, 102, "REPLY", "bot or you", "#efe8da")}
          {box(119, 160, 102, "PAM · PPL1", "2 compartments", "#e3b55a")}
          {box(230, 160, 102, "PLASTICITY", "valence update", "#7fb58a")}
          {arrow(110, 29, 117, 29)}
          {arrow(221, 29, 228, 29)}
          {arrow(281, 50, 281, 78)}
          {arrow(230, 101, 223, 101)}
          {arrow(119, 101, 112, 101)}
          {arrow(59, 122, 59, 158)}
          {arrow(110, 181, 117, 181, "#e3b55a")}
          {arrow(221, 181, 228, 181, "#7fb58a")}
          {arrow(281, 160, 200, 123, "#7fb58a", true)}
          <text x={170} y={226} textAnchor="middle" fill="#8d95a3" className="fc-svg-s">RPE = dopamine burst − predicted · Δw = step · RPE · z(move played)</text>
          <text x={170} y={242} textAnchor="middle" fill="#5b6371" className="fc-svg-s">even PAM/PPL1 types: material · odd types: king hunt, mate, draws</text>
          <text x={170} y={256} textAnchor="middle" fill="#5b6371" className="fc-svg-s">lesion both → no burst → no learning</text>
        </svg>
      </div>
    </section>
  );
}

