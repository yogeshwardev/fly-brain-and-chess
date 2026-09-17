import { Rng, deriveSeed } from "@neuroprison/shared";
import { Brain, buildLesionMasks, type BrainParams, type SimGraph } from "@neuroprison/neural-engine";
import { START_FEN, Game, type Move } from "./chess";
import { F_CHECK, F_MATE, F_STALEMATE, N_FEATURES, moveFacts, type MoveFacts } from "./features";

/**
 * FLY CHESS player: one connectome-derived brain + an engineered move encoder + an engineered two-head
 * valence readout, trained ONLY by dopamine measured in the brain's own PAM/PPL1 populations.
 *
 *   for every legal move: move facts ──seeded random projection──▶ annotated sensory populations
 *                         MaleCNS-structured dynamics from the SAME brain state (imagined, then state restored)
 *                         Kenyon cells + MBONs + descending populations = readout z
 *   preference = w_material · z + thresholded(w_hunt · z)  ──softmax──▶ the fly's move (the rules engine only lists what is legal)
 *
 *   material won / lost        ──▶ current into the MATERIAL compartment (even-numbered PAM / PPL1 types)
 *   king hunt, checkmate, draw ──▶ current into the HUNT compartment (odd-numbered PAM / PPL1 types)
 *   per compartment: RPE = burst − w·z_played,   Δw = step · RPE · z_played / (1 + |z_played|²)
 *
 * The readout is a learned valence (mushroom-body style): each head predicts the dopamine its compartment will
 * release for a move. Lesion PAM + PPL1 and every burst is exactly zero: the readout never changes.
 */

export const VIEW_TICKS = 6;
const READ_TICKS = 3;
export const REWARD_TICKS = 6;
const STIM_GAIN = 2.2;
const REWARD_CURRENT = 2.5;
const PUNISH_CURRENT = 1.6;
const DA_REST = 0.2;
const STEP = 0.3;
const DECAY_MOVES = 20000;
const BETA = 50;
const EXPLOIT_BETA = 4;
const EXPOSURE_POSITIONS = 24;
/** exploration while learning: share of choices drawn uniformly from the legal moves */
const EPSILON = 0.05;
/** encoder choice: game-ending facts are presented more strongly than the rest */
const SALIENCE = new Float32Array(N_FEATURES).fill(1);
SALIENCE[F_MATE] = 3;
SALIENCE[F_STALEMATE] = 3;
SALIENCE[F_CHECK] = 1.5;

export const COMPARTMENTS = ["material", "hunt"] as const;
/**
 * Output threshold per head (modeling choice): the hunt output only influences the choice once its predicted
 * burst is clearly non-zero (checkmate, stalemate), so its small generalisation noise on ordinary moves is ignored.
 */
const HEAD_THRESHOLD = [0, 0.12];
const shrink = (v: number, t: number) => (v > t ? v - t : v < -t ? v + t : 0);
export type Outcome = [material: number, hunt: number];

export interface PlayerOptions {
  seed: number;
  /** multiplier on the normalised learning step (0 freezes learning) */
  learningRate?: number;
  /** in-silico lesion: silence every PAM and PPL1 dopaminergic population */
  lesionDopamine?: boolean;
  /** intrinsic noise σ of the neural model */
  sigma?: number;
  /** performance mode: sharper preference (still sampled, so the fly does not loop) */
  exploit?: boolean;
  /** stimulus gain onto sensory populations */
  stimGain?: number;
  /** positions of sensory exposure before play (readout normalisation only, no learning) */
  exposurePositions?: number;
  /** base policy inverse temperature */
  beta?: number;
  /** normalised valence-learning step */
  step?: number;
}

export interface Deliberation {
  moves: Move[];
  facts: MoveFacts[];
  p: number[];
  pref: number[];
  /** per-head predicted burst of every candidate */
  heads: [number[], number[]];
  chosen: number;
  /** normalised readout for each candidate, row-major (D+1 per move) */
  z: Float64Array;
  /** mean range of the readout across candidates: how differently the brain responded to them */
  spread: number;
}

export interface Checkpoint {
  schema: "flychess.checkpoint/2";
  graphLevel: string;
  seed: number;
  movesTrained: number;
  w: [number[], number[]];
  mu: number[];
  var: number[];
}

export function dopamineUnits(graph: SimGraph): { pam: number[]; ppl1: number[] } {
  const pam: number[] = [];
  const ppl1: number[] = [];
  graph.units.forEach((u, i) => {
    if (u.class !== "DAN") return;
    if (u.type.startsWith("PAM")) pam.push(i);
    else if (u.type.startsWith("PPL1")) ppl1.push(i);
  });
  return { pam, ppl1 };
}

export class ChessFly {
  readonly brain: Brain;
  readonly input: Float32Array;
  readonly pam: number[];
  readonly ppl1: number[];
  /**
   * Dopamine compartments (modeling assignment on real cell types, as in Day 2): PAM/PPL1 types with an even
   * type number teach the material head, odd type numbers teach the hunt head.
   */
  readonly compartments: { pam: number[]; ppl1: number[] }[];
  readonly readoutUnits: Int32Array;
  readonly D: number;
  readonly w: [Float64Array, Float64Array];
  readonly mu: Float64Array;
  readonly vr: Float64Array;
  movesTrained = 0;
  learningRate: number;
  readonly tonicOffset: Float32Array;
  /** per-tick PAM / PPL1 means of committed (non-imagined) brain time since the last drain */
  readonly trace: { pam: number[]; ppl1: number[] } = { pam: [], ppl1: [] };
  private readonly proj: { tgt: Int32Array; w: Float32Array }[];
  private readonly rng: Rng;
  private readonly noiseRng: Rng;
  private readonly lesioned: boolean;
  private readonly dAvg: Float64Array;
  private readonly saveU: Float32Array;
  private readonly saveR: Float32Array;
  private readonly saveM: Float32Array;
  private rewardLeft = 0;
  /** total PAM + PPL1 activity per compartment during the last reward window (0 only if silenced) */
  private readonly daActivity = [0, 0];
  private readonly rewardCur = [0, 0];
  private readonly punishCur = [0, 0];

  constructor(readonly graph: SimGraph, readonly opts: PlayerOptions) {
    this.brain = new Brain(graph);
    const groups = graph.groupNames.length;
    const params: BrainParams = {
      kappa: 1.8,
      sigma: opts.sigma ?? 0.01,
      eta: 0,
      tau: { sensory: 0.08, intermediate: 0.14, descending: 0.1 },
      groupGain: new Float32Array(groups).fill(1),
      groupBias: new Float32Array(groups).fill(0.08),
    };
    this.brain.setParams(params);
    const { pam, ppl1 } = dopamineUnits(graph);
    this.pam = pam;
    this.ppl1 = ppl1;
    const typeNo = (i: number) => Number((graph.units[i].type.match(/(\d+)/) ?? ["0", "0"])[1]);
    this.compartments = [0, 1].map((c) => ({ pam: pam.filter((i) => typeNo(i) % 2 === c), ppl1: ppl1.filter((i) => typeNo(i) % 2 === c) }));
    this.lesioned = Boolean(opts.lesionDopamine);
    this.brain.setLesion(this.lesioned ? buildLesionMasks(graph, { units: [...pam, ...ppl1] }) : null);
    this.rng = new Rng(deriveSeed(opts.seed, "chess-policy"));
    this.noiseRng = new Rng(deriveSeed(opts.seed, "chess-noise"));
    this.brain.seedNoise(this.noiseRng);
    this.input = new Float32Array(graph.n);
    this.learningRate = opts.learningRate ?? 1;
    this.saveU = new Float32Array(graph.n);
    this.saveR = new Float32Array(graph.n);
    this.saveM = new Float32Array(graph.n);

    const sens: number[] = [];
    graph.units.forEach((u, i) => { if (u.role === "sensory") sens.push(i); });
    const S = sens.length;
    const fan = Math.max(3, Math.round(S / 3));
    const pr = new Rng(deriveSeed(opts.seed, "chess-stimulus-projection"));
    this.proj = Array.from({ length: N_FEATURES }, () => {
      const pool = Array.from({ length: S }, (_, i) => i);
      const tgt = new Int32Array(fan);
      const w = new Float32Array(fan);
      for (let k = 0; k < fan; k++) {
        const j = k + pr.int(S - k);
        [pool[k], pool[j]] = [pool[j], pool[k]];
        tgt[k] = sens[pool[k]];
        w[k] = (pr.chance(0.7) ? 1 : -1) / Math.sqrt(fan);
      }
      return { tgt, w };
    });

    const ro: number[] = [];
    graph.units.forEach((u, i) => { if (u.role === "descending" || u.class === "MBON" || u.class === "Kenyon_Cell") ro.push(i); });
    this.readoutUnits = Int32Array.from(ro);
    this.D = ro.length;
    const init = new Rng(deriveSeed(opts.seed, "chess-readout-init"));
    this.w = [new Float64Array(this.D + 1), new Float64Array(this.D + 1)];
    for (const w of this.w) for (let i = 0; i < w.length; i++) w[i] = init.normal() * 0.005;
    this.mu = new Float64Array(this.D);
    this.vr = new Float64Array(this.D).fill(0.02);
    this.dAvg = new Float64Array(this.D);
    this.tonicOffset = new Float32Array(graph.n);
    this.calibrateDopamineBaseline();
    this.exposure(opts.exposurePositions ?? EXPOSURE_POSITIONS);
  }

  get dopamineLesioned(): boolean {
    return this.lesioned;
  }

  /** Same documented calibration as Day 2: a constant offset puts each PAM/PPL1 population near rate DA_REST at rest. */
  private calibrateDopamineBaseline(): void {
    const ids = [...this.pam, ...this.ppl1];
    if (!ids.length) return;
    const target = Math.atanh(DA_REST);
    for (let round = 0; round < 6; round++) {
      const acc = new Float64Array(ids.length);
      for (let t = 0; t < 60; t++) {
        this.encode(null);
        this.brain.step(this.input, 0, null);
        if (t >= 30) ids.forEach((i, k) => (acc[k] += this.brain.u[i] / 30));
      }
      ids.forEach((i, k) => (this.tonicOffset[i] += (target - acc[k]) * 0.9));
    }
  }

  /**
   * Sensory exposure before any game: candidate moves from seeded random positions are shown (imagined only),
   * so the readout normalisation reflects real move-evoked activity. No reward, no weight change.
   */
  private exposure(positions: number): void {
    if (positions <= 0) return;
    const rng = new Rng(deriveSeed(this.opts.seed, "chess-exposure"));
    const n = this.D;
    const sum = new Float64Array(n);
    const sq = new Float64Array(n);
    let count = 0;
    let game = new Game(START_FEN);
    for (let k = 0; k < positions; k++) {
      const plies = 2 + rng.int(20);
      for (let i = 0; i < plies && !game.result.over; i++) game.play(rng.pick(game.legal));
      if (game.result.over) { game = new Game(START_FEN); continue; }
      const legal = game.legal;
      for (let j = 0; j < Math.min(8, legal.length); j++) {
        this.imagine(moveFacts(game, rng.pick(legal)).features);
        for (let i = 0; i < n; i++) {
          sum[i] += this.dAvg[i];
          sq[i] += this.dAvg[i] * this.dAvg[i];
        }
        count++;
      }
    }
    if (!count) return;
    for (let i = 0; i < n; i++) {
      this.mu[i] = sum[i] / count;
      this.vr[i] = Math.max(1e-4, sq[i] / count - this.mu[i] * this.mu[i]);
    }
    this.brain.reset();
    this.brain.seedNoise(this.noiseRng);
  }

  private encode(features: Float32Array | null): void {
    this.input.set(this.tonicOffset);
    if (features) {
      const g = this.opts.stimGain ?? STIM_GAIN;
      for (let k = 0; k < N_FEATURES; k++) {
        const v = features[k] * SALIENCE[k];
        if (v === 0) continue;
        const { tgt, w } = this.proj[k];
        for (let j = 0; j < tgt.length; j++) this.input[tgt[j]] += w[j] * v * g;
      }
    }
    if (this.rewardLeft > 0) {
      this.compartments.forEach((c, k) => {
        for (const i of c.pam) this.input[i] += this.rewardCur[k];
        for (const i of c.ppl1) this.input[i] += this.punishCur[k];
      });
      this.rewardLeft--;
    }
  }

  private meanRate(ids: number[]): number {
    let a = 0;
    for (const i of ids) a += this.brain.r[i];
    return ids.length ? a / ids.length : 0;
  }

  /** Simulated dopamine: mean PAM rate minus mean PPL1 rate. */
  dopamine(): number {
    return this.meanRate(this.pam) - this.meanRate(this.ppl1);
  }

  /** Dopamine in one compartment (0 material, 1 hunt). */
  compartmentDopamine(c: number): number {
    return this.meanRate(this.compartments[c].pam) - this.meanRate(this.compartments[c].ppl1);
  }

  pamMean(): number {
    return this.meanRate(this.pam);
  }

  ppl1Mean(): number {
    return this.meanRate(this.ppl1);
  }

  private step(features: Float32Array | null, record: boolean, noise = true): void {
    this.encode(features);
    if (this.brain.step(this.input, 0, noise ? this.noiseRng : null) !== "ok") this.brain.reset();
    if (record) {
      this.trace.pam.push(this.pamMean());
      this.trace.ppl1.push(this.ppl1Mean());
    }
  }

  /** Present one move's stimulus; the readout average lands in dAvg. State is NOT restored here. */
  private present(features: Float32Array, record: boolean, noise = true): void {
    this.dAvg.fill(0);
    const ro = this.readoutUnits;
    for (let k = 0; k < VIEW_TICKS; k++) {
      this.step(features, record, noise);
      if (k >= VIEW_TICKS - READ_TICKS) for (let i = 0; i < this.D; i++) this.dAvg[i] = this.dAvg[i] * 0.6 + this.brain.r[ro[i]] * 0.4;
    }
  }

  /**
   * Imagine a move from the current brain state, then restore that state exactly. Imagined responses are
   * computed without intrinsic noise (modeling choice) so candidates differ only by their stimulus.
   */
  private imagine(features: Float32Array): void {
    const b = this.brain;
    this.saveU.set(b.u);
    this.saveR.set(b.r);
    this.saveM.set(b.rMean);
    const left = this.rewardLeft;
    this.present(features, false, false);
    b.u.set(this.saveU);
    b.r.set(this.saveR);
    b.rMean.set(this.saveM);
    this.rewardLeft = left;
  }

  private normalise(out: Float64Array, off: number): void {
    const D = this.D;
    for (let i = 0; i < D; i++) out[off + i] = Math.max(-4, Math.min(4, (this.dAvg[i] - this.mu[i]) / Math.sqrt(this.vr[i] + 1e-3)));
    out[off + D] = 1;
  }

  /** Consider every legal move and pick one. `explore` overrides the exploration share while learning. */
  deliberate(game: Game, explore?: number): Deliberation {
    const moves = game.legal;
    const facts = moves.map((m) => moveFacts(game, m));
    const D1 = this.D + 1;
    const z = new Float64Array(moves.length * D1);
    const heads: [number[], number[]] = [[], []];
    const pref: number[] = [];
    // identical stimuli from the identical brain state evoke the same response: imagine each distinct one once
    const seen = new Map<string, number>();
    for (let k = 0; k < moves.length; k++) {
      const key = Array.from(facts[k].features, (v) => Math.round(v * 100)).join(",");
      const prev = seen.get(key);
      if (prev !== undefined) z.copyWithin(k * D1, prev * D1, (prev + 1) * D1);
      else {
        seen.set(key, k);
        this.imagine(facts[k].features);
        this.normalise(z, k * D1);
      }
      let total = 0;
      for (let h = 0; h < 2; h++) {
        const w = this.w[h];
        let s = 0;
        for (let i = 0; i < D1; i++) s += w[i] * z[k * D1 + i];
        heads[h].push(s);
        total += shrink(s, HEAD_THRESHOLD[h]);
      }
      pref.push(total);
    }
    const beta = (this.opts.beta ?? BETA) * (this.opts.exploit ? EXPLOIT_BETA : 1);
    const max = Math.max(...pref);
    const ex = pref.map((v) => Math.exp((v - max) * beta));
    const sum = ex.reduce((a, b) => a + b, 0);
    const eps = this.opts.exploit || this.learningRate === 0 ? 0 : explore ?? EPSILON;
    const p = ex.map((v) => (1 - eps) * (v / sum) + eps / ex.length);
    let u = this.rng.next();
    let chosen = p.length - 1;
    for (let k = 0; k < p.length; k++) {
      u -= p[k];
      if (u <= 0) { chosen = k; break; }
    }
    let spread = 0;
    if (moves.length > 1) {
      for (let i = 0; i < this.D; i++) {
        let mn = Infinity, mx = -Infinity;
        for (let k = 0; k < moves.length; k++) { const v = z[k * D1 + i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        spread += mx - mn;
      }
      spread /= this.D;
    }
    // commit: the brain actually looks at the move it plays
    this.present(facts[chosen].features, true);
    return { moves, facts, p, pref, heads, chosen, z, spread };
  }

  /** Idle brain time (e.g. while the opponent thinks). */
  idle(ticks: number): void {
    for (let k = 0; k < ticks; k++) this.step(null, true);
  }

  /**
   * Deliver an outcome per compartment (each in [−1, 1]) for REWARD_TICKS as input current (> 0 → its PAM types,
   * < 0 → its PPL1 types) and measure each compartment's dopamine burst relative to the level just before.
   */
  reinforce(o: Outcome): Outcome {
    for (let c = 0; c < 2; c++) {
      this.rewardCur[c] = o[c] > 0 ? REWARD_CURRENT * o[c] : 0;
      this.punishCur[c] = o[c] < 0 ? -PUNISH_CURRENT * o[c] : 0;
    }
    this.rewardLeft = REWARD_TICKS;
    const start = [this.compartmentDopamine(0), this.compartmentDopamine(1)];
    const burst: Outcome = [0, 0];
    this.daActivity.fill(0);
    for (let k = 0; k < REWARD_TICKS; k++) {
      this.step(null, true);
      for (let c = 0; c < 2; c++) {
        burst[c] += (this.compartmentDopamine(c) - start[c]) / REWARD_TICKS;
        const { pam, ppl1 } = this.compartments[c];
        this.daActivity[c] += this.meanRate(pam) + this.meanRate(ppl1);
      }
    }
    this.rewardLeft = 0;
    return burst;
  }

  /**
   * Valence learning from the measured bursts, one head per compartment:
   *   RPE_h = burst_h − w_h · z_played,   Δw_h = step · RPE_h · z_played / (1 + |z_played|²)
   * Plasticity needs dopamine: a head whose compartment released nothing at all (silenced) does not change.
   */
  learn(d: Deliberation, bursts: Outcome): { rpe: number; expected: number; rpes: Outcome } {
    const D1 = this.D + 1;
    const zc = d.z.subarray(d.chosen * D1, (d.chosen + 1) * D1);
    let zz = 1;
    for (let i = 0; i < D1; i++) zz += zc[i] * zc[i];
    const lr = ((this.opts.step ?? STEP) * this.learningRate) / zz / (1 + this.movesTrained / DECAY_MOVES);
    const rpes: Outcome = [0, 0];
    for (let h = 0; h < 2; h++) {
      rpes[h] = bursts[h] - d.heads[h][d.chosen];
      const w = this.w[h];
      if (rpes[h] !== 0 && lr > 0 && this.daActivity[h] > 0) for (let i = 0; i < D1; i++) w[i] += lr * rpes[h] * zc[i];
    }
    this.movesTrained++;
    return { rpe: rpes[0] + rpes[1], expected: d.pref[d.chosen], rpes };
  }

  drainTrace(): { pam: number[]; ppl1: number[] } {
    const out = { pam: this.trace.pam.slice(), ppl1: this.trace.ppl1.slice() };
    this.trace.pam.length = 0;
    this.trace.ppl1.length = 0;
    return out;
  }

  checkpoint(): Checkpoint {
    const r = (v: number, k = 1e5) => Math.round(v * k) / k;
    return {
      schema: "flychess.checkpoint/2",
      graphLevel: this.graph.level,
      seed: this.opts.seed,
      movesTrained: this.movesTrained,
      w: [Array.from(this.w[0], (v) => r(v)), Array.from(this.w[1], (v) => r(v))],
      mu: Array.from(this.mu, (v) => r(v)),
      var: Array.from(this.vr, (v) => r(v, 1e6)),
    };
  }

  restore(c: Checkpoint): void {
    if (c.w[0].length !== this.w[0].length) throw new Error("checkpoint does not match this graph");
    if (c.seed !== this.opts.seed) throw new Error(`checkpoint belongs to fly seed ${c.seed}; this fly has seed ${this.opts.seed}`);
    this.w[0].set(c.w[0]);
    this.w[1].set(c.w[1]);
    this.mu.set(c.mu);
    this.vr.set(c.var);
    this.movesTrained = c.movesTrained;
  }
}
