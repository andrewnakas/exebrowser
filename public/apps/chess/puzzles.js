// Chess puzzles for ExeBrowser. GPL-3.0-or-later (see NOTICE.md).
//
// Puzzles come from the Lichess puzzle database (CC0): a few thousand popular,
// well-tested ones spread across the rating range, cut down by
// scripts/build-chess.mjs into puzzles.json. Each row's FEN is the position
// *before* the opponent's last move; that move is played first, then you
// find the reply. A mate-in-one solved by a different mating move counts.
//
// Your puzzle rating is a plain Elo against each puzzle's rating, kept in
// localStorage on this device only. Only a first, unaided try moves it.
import { Chess, makeBoard, isPromotion, colorName } from "./board.js";

const el = (id) => document.getElementById(id);
const STORE = "exe_chess_puzzles";

const profile = (() => {
  try { return { rating: 1200, streak: 0, solved: 0, done: [], ...JSON.parse(localStorage.getItem(STORE) || "{}") }; }
  catch { return { rating: 1200, streak: 0, solved: 0, done: [] }; }
})();
const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(profile)); } catch { /* private mode */ } };

const game = new Chess();
const board = makeBoard(el("board"), game, { onMove: userMove });

let all = [];
let cur = null;        // { id, fen, moves[], rating, themes }
let step = 0;          // index into cur.moves of the move you must find
let clean = true;      // no wrong move, hint or solution yet
let finished = false;
let busy = false;

function renderProfile() {
  el("rating").textContent = Math.round(profile.rating);
  el("streak").textContent = profile.streak;
  el("solved").textContent = profile.solved;
}

function rate(won) {
  if (!clean) return;
  clean = false;
  const exp = 1 / (1 + 10 ** ((cur.rating - profile.rating) / 400));
  profile.rating = Math.max(400, profile.rating + 32 * ((won ? 1 : 0) - exp));
  profile.streak = won ? profile.streak + 1 : 0;
  keep();
  renderProfile();
}

function pick() {
  const done = new Set(profile.done);
  for (const width of [100, 200, 400, 4000]) {
    const pool = all.filter((p) => Math.abs(p[3] - profile.rating) <= width && !done.has(p[0]));
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  profile.done = [];
  return all[Math.floor(Math.random() * all.length)];
}

const uciOf = (m) => m.from + m.to + (m.promotion || "");
function playUci(uci) {
  const m = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  board.setLastMove(m.from, m.to);
  return m;
}

function load(row) {
  const [id, fen, moves, rating, themes] = row;
  cur = { id, fen, moves: moves.split(" "), rating, themes };
  step = 1;
  clean = true;
  finished = false;
  game.load(fen);
  // You play the side that moves after the opponent's opening move.
  const you = game.turn() === "w" ? "black" : "white";
  board.setUserColor(you);
  board.orient(you);
  board.setLastMove();
  board.cg.setAutoShapes([]);
  board.sync(false);
  el("meta").innerHTML = `Puzzle rated <b>${rating}</b>` +
    (themes ? ` · ${themes.split(" ").map((t) => `<span class="badge">${t.replace(/([A-Z]|\d+)/g, " $1").toLowerCase()}</span>`).join("")}` : "") +
    `<br>From the <a href="https://lichess.org/training/${encodeURIComponent(id)}" target="_blank" rel="noopener">Lichess puzzle database</a> (CC0).`;
  status(`Find the best move for ${you}.`, "");
  busy = true;
  setTimeout(() => {
    playUci(cur.moves[0]);
    busy = false;
    board.sync(true);
  }, 650);
}

function status(main, sub) {
  el("status").textContent = main;
  el("status").className = "";
  el("sub").textContent = sub ?? "";
}

async function userMove(from, to) {
  if (busy || finished) return board.sync(!finished);
  let promotion;
  if (isPromotion(game, from, to)) {
    promotion = await board.pickPromotion(board.userColor);
    if (!promotion) return board.sync(true);
  }
  let m;
  try { m = game.move({ from, to, promotion }); } catch { return board.sync(true); }
  board.cg.setAutoShapes([]);
  const want = cur.moves[step];
  if (uciOf(m) === want || game.isCheckmate()) {
    board.setLastMove(from, to);
    step++;
    if (step >= cur.moves.length) return solved();
    board.sync(false);
    status("Correct — keep going.", "");
    busy = true;
    setTimeout(() => {
      playUci(cur.moves[step]);
      step++;
      busy = false;
      board.sync(true);
      status(`Correct — what's next for ${board.userColor}?`, "");
    }, 450);
    return;
  }
  // Wrong: show it briefly, then take it back.
  rate(false);
  board.setLastMove(from, to);
  board.sync(false);
  busy = true;
  el("status").textContent = "Not the move — try again.";
  el("status").className = "bad";
  setTimeout(() => {
    game.undo();
    const last = game.history({ verbose: true }).at(-1);
    board.setLastMove(last?.from, last?.to);
    busy = false;
    board.sync(true);
  }, 700);
}

function solved() {
  finished = true;
  const first = clean;
  rate(true);
  profile.solved += 1;
  profile.done = [...profile.done, cur.id].slice(-1500);
  keep();
  renderProfile();
  board.sync(false);
  el("status").textContent = first ? "Solved! 🎉" : "Solved.";
  el("status").className = "ok";
  el("sub").textContent = first ? "Rating up. Press Next puzzle for another." : "Press Next puzzle for another.";
}

el("next").addEventListener("click", () => { if (!busy && all.length) load(pick()); });
el("hint").addEventListener("click", () => {
  if (busy || finished || !cur) return;
  rate(false);
  board.cg.setAutoShapes([{ orig: cur.moves[step].slice(0, 2), brush: "green" }]);
  el("sub").textContent = "The piece to move is circled.";
});
el("solution").addEventListener("click", async () => {
  if (busy || finished || !cur) return;
  rate(false);
  finished = true;
  busy = true;
  board.cg.setAutoShapes([]);
  while (step < cur.moves.length) {
    playUci(cur.moves[step++]);
    board.sync(false);
    await new Promise((r) => setTimeout(r, 650));
  }
  busy = false;
  profile.done = [...profile.done, cur.id].slice(-1500);
  keep();
  status("That was the solution.", "Press Next puzzle for another.");
});

renderProfile();
fetch("puzzles.json?v=1").then((r) => r.json()).then((j) => {
  all = j.puzzles;
  load(pick());
}).catch(() => status("Couldn't load the puzzles — check your connection and reload.", ""));
