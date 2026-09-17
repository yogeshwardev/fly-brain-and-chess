# DAY 3 · FLY CHESS

A connectome-derived fruit fly plays chess and **learns it from simulated dopamine**.

The fly's brain is built on the real **MaleCNS v1.0** wiring map (the same Level S graph as Day 2). On each turn a rules
engine lists the legal moves. The fly *imagines* every one: each move is shown to its sensory populations as a
stimulus, starting from the same brain state, and a readout from its Kenyon cells, MBONs and descending neurons
predicts how much dopamine that move will earn. The fly plays the move it values most. After the opponent replies,
the outcome is injected as current into the fly's real **PAM** (reward) or **PPL1** (punishment) populations. The
measured dopamine burst, minus what the fly predicted, is the only teaching signal.

Open it: `http://localhost:3000/chess` (it runs inside the NEUROPRISON web app).

You can watch the fly play a bot (Random mover, Greedy capturer, Club bot), or **play against it yourself**.

## Recorded results (`scripts/chess-train.ts`, one run regenerates all of these)

Learning frozen, performance mode, fresh opponent seeds. 20 games per opponent (colours alternate), 100 mate-in-one drills.

| Fly (seed) | | Wins vs Random mover | Material vs Greedy capturer | Blunders vs Greedy | Mate in one |
|---|---|---|---|---|---|
| **3 (published)** | naive | 3/20 | −14.8 | — | 4% |
| | **trained** | **18/20** | **+11.7** | 3.3% | **88%** |
| | dopamine lesioned, same curriculum | 1/20 | −15.2 | 5.0% | 4% |
| 7 | naive → trained | 0 → 16/20 | −10.9 → +5.3 | 5.0% | 0% → 96% |
| | lesioned | 0/20 | −13.8 | 6.1% | 0% |
| 23 | naive → trained | 11 → 10/20 | −24.6 → −1.5 | 4.2% | 49% → 100% |

"Material" is the fly's final material lead, averaged over the games. Games that are not won are mostly draws by
stalemate, repetition or the 240-ply limit: the fly is far from a real chess player. Seed 23's naive readout happened to
favour mates already (49%), so its random start looked good against the Random mover; training did not improve its win
count there, but it did improve material and mating. The published fly is the one with the best evaluation score
(rule in `results.json`), chosen from 3 flies.


## What is real vs. modeled

| Real MaleCNS v1.0 data | Modeled (ours) |
|---|---|
| 467 type×side populations (58,295 neurons), 8,421 population edges, synapse counts | leaky-integrator dynamics (NEUROPRISON neural-engine, unchanged) |
| 30 PAM + 16 PPL1 dopaminergic populations (annotation class `DAN`), MBONs, Kenyon cells | reward / punishment delivered as input current into those populations |
| sensory → intermediate → descending populations | chess rules, legal-move generation and the 21 "move facts" (captures, risk, check, mate, king box…) |
| predicted-neurotransmitter signs | move facts → sensory stimulus: seeded random projection (flies have no chess sense) |
| | two-head valence readout from 151 Kenyon-cell / MBON / descending populations; even/odd PAM-PPL1 type split into two compartments |
| | reward sizes (material, enemy-king box, game result), mate-in-one drills, and the sparring bots |

No claim is made that a real fly plays chess, understands it, or that this reproduces fly learning. It is an
experimental computational model on top of real wiring. The rules engine never chooses for the fly: it only lists
legal moves and describes them.

## How a move is chosen and learned

```
for every legal move m:   restore brain state → present facts(m) for 6 ticks (no noise) → z_m = normalised readout
valence(m)  = w_material · z_m + shrink(w_hunt · z_m, 0.12)     (hunt output has a firing threshold)
move        = softmax(β · valence)                    (5% uniform exploration while learning; 50% in the tactics stage)

after the reply:
  material compartment (even PAM/PPL1 types) ← change in material              (capped ±0.4)
  hunt compartment     (odd  PAM/PPL1 types) ← change in the enemy king's box   (once ≥ 5 points ahead)
                                               or the game result: mate +1, loss −1, draw while ahead −0.2…−0.8
burst_c = mean(PAM_c − PPL1_c) over 6 ticks, relative to just before
RPE_c   = burst_c − w_c · z_played
Δw_c    = step · RPE_c · z_played / (1 + |z_played|²)     only if compartment c released any dopamine
```

Mate-in-one drills are single decisions rewarded on the spot (mate +1, stalemate −0.8, any other move 0). They
exist because checkmate is too rare in whole games to be learned from.

**Curriculum** (`scripts/chess-train.ts`): 300 mate-in-one drills with 50% exploration, then 100 games against the
Greedy capturer with 2 drills after each game (so mating is not forgotten).

If every PAM and PPL1 population is lesioned, no dopamine is released, so the readout never changes.
`test/chess.test.ts` checks this.

### What made it work (each step measured with `scripts/probe.ts` during development)
1. **Valence learning instead of policy gradient.** A policy-gradient rule gets one noisy number per decision and
   barely learned (best-value move picked 13–18% of the time after 3,000 decisions with immediate reward).
   Predicting each played move's dopamine (mushroom-body style) reached about 45–55% on the same test.
2. **Noise-free imagination.** Candidates differ only by their stimulus, so the weights don't learn neural noise.
3. **Two dopamine compartments** (as in Day 2). With one readout, learning checkmate and learning material undid each
   other: checks usually go wrong in real games, so a fly that learned material never tried a mate.
4. **Mate is its own stimulus, not "a check that ends the game"**, and **terminal results replace the king-box
   reward** (a bug had made stalemate cost nothing).
5. **A threshold on the hunt output.** Right after the drills, the hunt head varied 8× more across ordinary moves than
   the material head (0.174 vs 0.022), and that noise chose the moves. Ignoring hunt valences below 0.12 keeps mates
   (≈ +0.7) and stalemates (≈ −0.5) and removes the noise.
6. **More exploration while practising mates**, so a fly whose first guesses avoid mate still finds one.

## Layout

```
src/chess.ts               rules: legal moves, SAN, FEN, mate/stalemate/repetition/50-move/insufficient material (perft-verified)
src/features.ts            the 21 move facts; king box; reward scores
src/opponents.ts           Random mover, Greedy capturer, Club bot (2-ply alpha-beta)
src/player.ts              brain + stimulus encoder + imagination + two-head valence readout + dopamine learning
src/session.ts             deterministic game loop, rewards, mating drills, mate-in-one drills
scripts/chess-train.ts     population + lesion controls in parallel processes → public/data/chess/{trained-s,results}.json
scripts/probe.ts           tuning tool (curriculum orders)
scripts/perft.ts           move-generator check against reference perft counts
web/ChessLab.tsx           the page: board, plates, deliberation, dopamine scope, brain view, score sheet, results
web/chessStyles.ts         scoped styles
web/chess.worker.ts        simulation runs in a Web Worker
```

## Commands (from `F:\LINKDIN\neuroprison`)

```bash
npx tsx ../DAY-3/scripts/chess-train.ts      # 3 flies (SEEDS=3,7,23) + their lesion controls in parallel, then publish
npx tsx ../DAY-3/scripts/perft.ts
pnpm dev                                     # then open http://localhost:3000/chess
```

Tests (from `F:\LINKDIN\DAY-3`): `../neuroprison/node_modules/.bin/vitest run`
