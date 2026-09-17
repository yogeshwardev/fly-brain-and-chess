import { fromFen, perft, START_FEN } from "../src/chess";
const t = performance.now();
console.log(perft(fromFen(START_FEN), 4), "expect 197281");
console.log(perft(fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"), 3), "expect 97862");
console.log(perft(fromFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), 4), "expect 43238");
console.log(perft(fromFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"), 3), "expect 9467");
console.log(perft(fromFen("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8"), 3), "expect 62379");
console.log(((performance.now() - t) / 1000).toFixed(2), "s");
