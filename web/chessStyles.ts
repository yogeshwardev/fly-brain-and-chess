/** Scoped styles for the FLY CHESS page: a formal, tournament-hall look (walnut board, ivory type, gilt accents). */
export const CHESS_CSS = /* css */ `
.fc-root {
  --fc-bg: #0b0d11;
  --fc-bg-2: #0f1217;
  --fc-panel: #12161c;
  --fc-line: #252c36;
  --fc-line-2: #333b47;
  --fc-ivory: #f1ebdf;
  --fc-text: #d9d4c9;
  --fc-dim: #8d95a3;
  --fc-faint: #5b6371;
  --fc-gold: #c9a45c;
  --fc-gold-2: #e6c98a;
  --fc-good: #86c096;
  --fc-bad: #dc806d;
  --fc-violet: #9a87d0;
  --fc-light: #ecdcc0;
  --fc-dark: #a9794f;
  --fc-serif: "Cormorant Garamond", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
  --fc-pieces: "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "Arial Unicode MS", serif;
  position: fixed; inset: 0; display: grid; grid-template-rows: auto 1fr; color: var(--fc-text);
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(201,164,92,0.07), transparent 60%),
    radial-gradient(900px 600px at 50% 110%, rgba(120,90,60,0.08), transparent 60%),
    var(--fc-bg);
  font-family: var(--sans);
}
.fc-root button { font: inherit; }

/* header */
.fc-header { display: flex; align-items: center; gap: 22px; padding: 12px 22px; border-bottom: 1px solid var(--fc-line); background: linear-gradient(180deg, rgba(18,22,28,0.9), rgba(11,13,17,0.6)); }
.fc-brand { display: flex; align-items: center; gap: 16px; }
.fc-np { font-family: var(--mono); letter-spacing: 0.3em; font-size: 11px; color: var(--fc-dim); }
.fc-np:hover { color: var(--fc-ivory); }
.fc-rule { width: 1px; height: 34px; background: linear-gradient(180deg, transparent, var(--fc-gold), transparent); }
.fc-eyebrow { font-family: var(--fc-serif); font-variant: small-caps; letter-spacing: 0.22em; font-size: 12px; color: var(--fc-gold); text-transform: lowercase; }
.fc-title { margin: 0; font-family: var(--fc-serif); font-weight: 500; font-size: 30px; line-height: 1; color: var(--fc-ivory); letter-spacing: 0.02em; }
.fc-tagline { margin: 0; flex: 1; font-family: var(--fc-serif); font-style: italic; font-size: 16px; color: var(--fc-dim); }
.fc-controls { display: flex; gap: 10px; align-items: center; margin-left: auto; }

/* buttons */
.fc-btn { background: transparent; color: var(--fc-text); border: 1px solid var(--fc-line-2); border-radius: 3px; padding: 7px 14px; font-size: 12.5px; letter-spacing: 0.04em; cursor: pointer; transition: border-color 140ms, background 140ms, color 140ms; white-space: nowrap; }
.fc-btn:hover { border-color: var(--fc-gold); color: var(--fc-ivory); }
.fc-btn.on { border-color: var(--fc-gold); background: rgba(201,164,92,0.14); color: var(--fc-ivory); }
.fc-btn.gold { background: linear-gradient(180deg, #d9b772, #b88f45); color: #1b140a; border-color: #d9b772; font-weight: 600; }
.fc-btn.gold:hover { background: linear-gradient(180deg, #e6c98a, #c9a45c); }
.fc-btn.danger { border-color: rgba(220,128,109,0.45); }
.fc-btn.danger:hover, .fc-btn.danger.on { border-color: var(--fc-bad); background: rgba(220,128,109,0.12); }
.fc-seg { display: inline-flex; border: 1px solid var(--fc-line-2); border-radius: 3px; overflow: hidden; }
.fc-seg button { background: transparent; border: 0; border-left: 1px solid var(--fc-line-2); color: var(--fc-dim); padding: 6px 11px; font-size: 12px; cursor: pointer; }
.fc-seg button:first-child { border-left: 0; }
.fc-seg button:hover:not(:disabled) { color: var(--fc-ivory); background: rgba(255,255,255,0.03); }
.fc-seg button.on { color: #1b140a; background: linear-gradient(180deg, #d9b772, #bf9750); font-weight: 600; }
.fc-seg button:disabled { opacity: 0.35; cursor: not-allowed; }
.fc-seg.wide { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; width: 100%; }

/* layout */
.fc-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr) 380px; min-height: 0; }
.fc-col { overflow-y: auto; overflow-x: hidden; padding: 14px; display: flex; flex-direction: column; gap: 12px; min-height: 0; scrollbar-width: thin; scrollbar-color: var(--fc-line-2) transparent; }
.fc-left { border-right: 1px solid var(--fc-line); }
.fc-right { border-left: 1px solid var(--fc-line); }
.fc-left-dup { display: none; }
.fc-stage { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 14px 20px; overflow: auto; }
.fc-boardcol { width: min(100%, calc(100vh - 290px)); min-width: 280px; display: flex; flex-direction: column; gap: 10px; }

/* player plates */
.fc-plate { position: relative; display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid var(--fc-line); border-radius: 4px; background: linear-gradient(180deg, rgba(21,26,33,0.95), rgba(15,18,23,0.95)); transition: border-color 200ms, box-shadow 200ms; }
.fc-plate.active { border-color: rgba(201,164,92,0.7); box-shadow: 0 0 0 1px rgba(201,164,92,0.15), 0 6px 24px -12px rgba(201,164,92,0.5); }
.fc-token { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.fc-token.w { background: radial-gradient(circle at 35% 30%, #fffdf7, #d8ccb4); color: #2a2118; box-shadow: inset 0 0 0 1px #b9a887; }
.fc-token.b { background: radial-gradient(circle at 35% 30%, #3a3631, #141210); color: #e9dcc3; box-shadow: inset 0 0 0 1px #4d463d; }
.fc-plate-text { min-width: 0; }
.fc-plate-name { font-family: var(--fc-serif); font-size: 18px; color: var(--fc-ivory); line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fc-plate-sub { font-size: 11.5px; color: var(--fc-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fc-captures { margin-left: auto; display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; max-width: 45%; gap: 0 1px; line-height: 1; }
.fc-lead { margin-left: 6px; font-family: var(--mono); font-size: 12px; color: var(--fc-gold-2); }
.fc-clock-dot { position: absolute; left: -5px; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%; background: var(--fc-gold); box-shadow: 0 0 10px var(--fc-gold); animation: pulse 1.4s ease-in-out infinite; }
.fc-glyph { font-family: var(--fc-pieces); line-height: 1; }
.fc-glyph.w { color: #f6f1e6; text-shadow: 0 0 1px #2a2118, 0 0 1px #2a2118, 0 1px 1px #2a2118; }
.fc-glyph.b { color: #1c1916; text-shadow: 0 0 1px #cbbd9f, 0 0 1px #cbbd9f; }

/* board */
.fc-frame { position: relative; padding: 14px; border-radius: 6px; background: linear-gradient(145deg, #3a2a1d, #22180f 55%, #2d2016); box-shadow: 0 30px 60px -30px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(230,201,138,0.25), inset 0 0 0 5px rgba(0,0,0,0.25); }
.fc-board { position: relative; width: 100%; aspect-ratio: 1; box-shadow: 0 0 0 1px rgba(230,201,138,0.55), 0 0 0 4px #1a120b; user-select: none; }
.fc-squares { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); }
.fc-sq { position: relative; }
.fc-sq.l { background: var(--fc-light); background-image: linear-gradient(135deg, rgba(255,255,255,0.18), rgba(0,0,0,0.03)); }
.fc-sq.d { background: var(--fc-dark); background-image: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(0,0,0,0.08)); }
.fc-sq.last::after { content: ""; position: absolute; inset: 0; background: rgba(214,170,70,0.42); }
.fc-sq.sel::after { content: ""; position: absolute; inset: 0; background: rgba(120,160,110,0.55); }
.fc-sq.movable { cursor: pointer; }
.fc-sq.movable:hover::before { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 3px rgba(255,248,230,0.55); z-index: 1; }
.fc-dot { position: absolute; left: 50%; top: 50%; width: 26%; height: 26%; transform: translate(-50%, -50%); border-radius: 50%; background: rgba(40,60,40,0.42); z-index: 3; pointer-events: none; }
.fc-ring { position: absolute; inset: 4%; border-radius: 50%; box-shadow: inset 0 0 0 5px rgba(40,60,40,0.45); z-index: 3; pointer-events: none; }
.fc-sq:has(.fc-dot), .fc-sq:has(.fc-ring) { cursor: pointer; }
.fc-check { position: absolute; inset: 0; background: radial-gradient(circle, rgba(230,60,40,0.9) 0%, rgba(230,60,40,0.5) 35%, rgba(230,60,40,0) 72%); }
.fc-coord { position: absolute; font-family: var(--fc-serif); font-weight: 600; font-size: clamp(9px, 1.2vw, 13px); line-height: 1; pointer-events: none; z-index: 2; }
.fc-coord.r { left: 4%; top: 5%; }
.fc-coord.f { right: 5%; bottom: 4%; }
.fc-sq.l .fc-coord { color: var(--fc-dark); }
.fc-sq.d .fc-coord { color: var(--fc-light); }
.fc-arrows { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; }
.fc-arrow { animation: fcArrow 420ms ease both; }
@keyframes fcArrow { from { stroke-opacity: 0; } }
.fc-pieces { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
.fc-piece { position: absolute; left: 0; top: 0; width: 12.5%; height: 12.5%; transition: transform 380ms cubic-bezier(.3,.7,.2,1); filter: drop-shadow(0 3px 2px rgba(0,0,0,0.35)); }
.fc-piece svg { width: 100%; height: 100%; display: block; overflow: visible; }
.fc-piece text { font-family: var(--fc-pieces); font-size: 78px; text-anchor: middle; dominant-baseline: central; paint-order: stroke fill; stroke-linejoin: round; }
.fc-piece text.w { fill: #fbf7ee; stroke: #2b2118; stroke-width: 3.2px; }
.fc-piece text.b { fill: #1d1a17; stroke: #efe3c9; stroke-width: 1.4px; }

.fc-statusline { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 0 2px; font-family: var(--fc-serif); font-size: 17px; color: var(--fc-ivory); }
.fc-move-no { font-variant: small-caps; letter-spacing: 0.14em; color: var(--fc-gold); font-size: 14px; }
.fc-chip { font-family: var(--sans); font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(201,164,92,0.5); color: var(--fc-gold-2); }

/* overlays */
.fc-over { position: absolute; inset: 14px; display: grid; place-items: center; background: rgba(11,13,17,0.45); backdrop-filter: blur(1.5px); z-index: 10; }
.fc-over-card { text-align: center; padding: 22px 34px; min-width: 60%; background: linear-gradient(180deg, rgba(23,28,36,0.97), rgba(14,17,22,0.97)); border: 1px solid rgba(201,164,92,0.6); border-radius: 4px; box-shadow: 0 20px 50px rgba(0,0,0,0.6), inset 0 0 0 4px rgba(201,164,92,0.08); display: flex; flex-direction: column; gap: 8px; align-items: center; }
.fc-over-title { font-family: var(--fc-serif); font-size: clamp(30px, 4vw, 46px); color: var(--fc-ivory); line-height: 1; }
.fc-over-sub { font-family: var(--fc-serif); font-size: 20px; font-style: italic; color: var(--fc-text); }
.fc-over-note { font-size: 12px; color: var(--fc-dim); }
.fc-veil { position: absolute; inset: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(11,13,17,0.82); z-index: 12; text-align: center; padding: 20px; }
.fc-veil-title { font-family: var(--fc-serif); font-size: 26px; color: var(--fc-ivory); }
.fc-veil-sub { font-size: 12.5px; color: var(--fc-dim); }
.fc-meter { width: min(320px, 80%); height: 4px; background: rgba(255,255,255,0.08); position: relative; }
.fc-meter i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #b88f45, #e6c98a); }

/* cards */
.fc-card { border: 1px solid var(--fc-line); border-radius: 4px; background: linear-gradient(180deg, rgba(20,24,31,0.96), rgba(14,17,22,0.96)); flex: none; }
.fc-card-h { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 10px 14px 8px; border-bottom: 1px solid var(--fc-line); }
.fc-card-h h2 { margin: 0; font-family: var(--fc-serif); font-weight: 500; font-size: 18px; color: var(--fc-ivory); letter-spacing: 0.01em; }
.fc-card-h span { font-size: 11px; color: var(--fc-dim); text-align: right; }
.fc-card-b { padding: 12px 14px; min-width: 0; }
.fc-field { margin-bottom: 12px; }
.fc-field label { display: block; font-family: var(--fc-serif); font-variant: small-caps; letter-spacing: 0.12em; font-size: 13px; color: var(--fc-gold); margin-bottom: 5px; text-transform: lowercase; }
.fc-seg.four button { padding: 6px 4px; }
.fc-hint { font-size: 11.5px; line-height: 1.5; color: var(--fc-dim); margin-top: 6px; }
.fc-hint.good, .good { color: var(--fc-good); }
.fc-hint.bad, .bad { color: var(--fc-bad); }
.gold { color: var(--fc-gold-2); }
.violet { color: var(--fc-violet); }
.fc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.fc-actions .fc-btn { flex: 1; }
.fc-sub-h { margin: 14px 0 6px; font-family: var(--fc-serif); font-variant: small-caps; letter-spacing: 0.12em; font-size: 13px; color: var(--fc-gold); text-transform: lowercase; }

.fc-tally { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; border: 1px solid var(--fc-line); border-radius: 3px; }
.fc-tally > div { padding: 8px 0 6px; border-left: 1px solid var(--fc-line); }
.fc-tally > div:first-child { border-left: 0; }
.fc-tally b { display: block; font-family: var(--fc-serif); font-weight: 500; font-size: 30px; line-height: 1; color: var(--fc-ivory); font-variant-numeric: tabular-nums; }
.fc-tally b.good { color: var(--fc-good); }
.fc-tally b.bad { color: var(--fc-bad); }
.fc-tally span { font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fc-dim); }
.fc-results-strip { display: flex; flex-wrap: wrap; gap: 3px; margin: 10px 0; min-height: 10px; }
.fc-results-strip i { width: 10px; height: 10px; border-radius: 2px; background: #59606b; }
.fc-results-strip i.win { background: var(--fc-good); }
.fc-results-strip i.loss { background: var(--fc-bad); }
.fc-kv { display: grid; grid-template-columns: 1fr auto; gap: 5px 10px; margin: 0; font-size: 12.5px; }
.fc-kv dt { color: var(--fc-dim); }
.fc-kv dd { margin: 0; text-align: right; font-family: var(--mono); font-size: 12px; color: var(--fc-ivory); font-variant-numeric: tabular-nums; }
.fc-chart { display: block; width: 100%; height: 76px; margin-top: 12px; }
.fc-chart-empty { margin-top: 12px; height: 40px; display: grid; place-items: center; font-size: 11.5px; color: var(--fc-faint); border: 1px dashed var(--fc-line); border-radius: 3px; }

.fc-cands { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
.fc-cands li { display: grid; grid-template-columns: 58px 1fr 44px; grid-template-areas: "san bar p" "tags tags tags"; align-items: center; gap: 2px 8px; padding: 5px 8px; border-radius: 3px; border: 1px solid transparent; }
.fc-cands li.chosen { border-color: rgba(201,164,92,0.55); background: rgba(201,164,92,0.08); }
.fc-san { grid-area: san; font-family: var(--fc-serif); font-size: 17px; color: var(--fc-ivory); }
.fc-pbar { grid-area: bar; height: 5px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
.fc-pbar i { display: block; height: 100%; background: linear-gradient(90deg, #8a6d37, #e6c98a); }
.fc-p { grid-area: p; text-align: right; font-family: var(--mono); font-size: 11.5px; color: var(--fc-text); }
.fc-tags { grid-area: tags; display: flex; gap: 5px; flex-wrap: wrap; }
.fc-tags:empty { display: none; }
.fc-tags em { font-style: normal; font-size: 10.5px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--fc-line-2); color: var(--fc-dim); }
.fc-tags em.good { border-color: rgba(134,192,150,0.5); }
.fc-tags em.bad { border-color: rgba(220,128,109,0.5); }
.fc-tags em.gold { border-color: rgba(201,164,92,0.6); }
.fc-verdict { margin-top: 10px; font-family: var(--fc-serif); font-size: 16px; color: var(--fc-text); }
.fc-verdict b { color: var(--fc-gold-2); font-weight: 600; }

.fc-scope { position: relative; height: 74px; border: 1px solid var(--fc-line); border-radius: 3px; background: rgba(0,0,0,0.25); }
.fc-scope canvas { width: 100%; height: 100%; display: block; }
.fc-legend { position: absolute; left: 8px; top: 5px; display: flex; gap: 12px; font-size: 10.5px; }
.fc-legend .pam { color: #e3b55a; }
.fc-legend .ppl1 { color: var(--fc-violet); }
.fc-legend-row { display: flex; gap: 14px; font-size: 11px; margin-top: 4px; }
.fc-reward { margin-top: 10px; }
.fc-reason { font-family: var(--fc-serif); font-style: italic; font-size: 16px; color: var(--fc-ivory); margin-bottom: 6px; }
.fc-dgrid { display: grid; grid-template-columns: auto 1fr auto auto; gap: 5px 10px; align-items: center; font-size: 12px; }
.fc-dh { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--fc-faint); text-align: right; }
.fc-dh:nth-child(2) { text-align: center; }
.fc-dname { color: var(--fc-dim); }
.fc-num { font-family: var(--mono); font-size: 11.5px; text-align: right; color: var(--fc-text); }
.fc-dbar { display: block; position: relative; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; }
.fc-dbar::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: rgba(255,255,255,0.25); }
.fc-dbar i { position: absolute; top: 0; bottom: 0; border-radius: 3px; }

.fc-brain { height: 230px; position: relative; overflow: hidden; }
.fc-moves { max-height: 190px; overflow-y: auto; padding: 8px 14px 10px; font-family: var(--fc-serif); font-size: 15.5px; scrollbar-width: thin; }
.fc-mrow { display: grid; grid-template-columns: 34px 1fr 1fr; padding: 1px 0; border-bottom: 1px solid rgba(255,255,255,0.025); }
.fc-mno { color: var(--fc-faint); font-size: 13px; }
.fc-mrow .fly { color: var(--fc-gold-2); }

.fc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fc-table th, .fc-table td { padding: 5px 4px; border-bottom: 1px solid var(--fc-line); text-align: right; font-variant-numeric: tabular-nums; }
.fc-table thead th { font-family: var(--fc-serif); font-variant: small-caps; letter-spacing: 0.08em; color: var(--fc-gold); font-weight: 500; font-size: 13.5px; text-transform: lowercase; }
.fc-table tbody th { text-align: left; font-weight: 400; color: var(--fc-dim); }
.fc-table td { font-family: var(--mono); font-size: 11.5px; color: var(--fc-text); }
.fc-table td.hi { color: var(--fc-gold-2); }
.fc-table.small td, .fc-table.small th { padding: 3px 4px; }
.fc-table tr.star th, .fc-table tr.star td { color: var(--fc-gold-2); }

.fc-svg-t { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.08em; }
.fc-svg-s { font-family: var(--mono); font-size: 7.8px; }
.fc-disclaimer { font-size: 11px; line-height: 1.55; color: var(--fc-faint); margin: 0 2px 8px; }
.fc-disclaimer a { color: var(--fc-dim); text-decoration: underline; }

@media (max-width: 1380px) {
  .fc-layout { grid-template-columns: minmax(0, 1fr) 380px; }
  .fc-left { display: none; }
  .fc-left-dup { display: contents; }
}
@media (max-width: 900px) {
  .fc-root { position: static; display: block; min-height: 100vh; }
  .fc-header { flex-wrap: wrap; padding: 12px 16px; gap: 12px; }
  .fc-controls { margin-left: 0; }
  .fc-layout { display: block; }
  .fc-stage { padding: 14px 16px; }
  .fc-boardcol { width: 100%; min-width: 0; }
  .fc-frame { padding: 8px; }
  .fc-over, .fc-veil { inset: 8px; }
  .fc-right { border-left: 0; padding: 0 16px 24px; overflow: visible; }
  .fc-captures { max-width: 38%; }
}
`;
