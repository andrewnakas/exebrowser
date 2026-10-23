// Chess against Stockfish, for ExeBrowser. GPL-3.0-or-later (see NOTICE.md).
//
// The engine is Stockfish 19's single-threaded "lite" WebAssembly build,
// running in a Web Worker and spoken to over UCI. Levels map to Stockfish's
// own Skill Level plus a search-depth cap, so level 1 really is beatable.
import { Chess, makeBoard, isPromotion, colorName } from "./board.js";

const el = (id) => document.getElementById(id);

const LEVELS = {
  1: { skill: 0, depth: 1 }, 2: { skill: 2, depth: 2 }, 3: { skill: 5, depth: 4 },
  4: { skill: 8, depth: 6 }, 5: { skill: 11, depth: 8 }, 6: { skill: 14, depth: 10 },
  7: { skill: 17, depth: 13 }, 8: { skill: 20, movetime: 1500 },
};

// ---- Engine -----------------------------------------------------------------

class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.waiting = null;
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : "";
        if (line === "uciok") this.send("isready");
        else if (line === "readyok") resolve();
        else if (line.startsWith("bestmove") && this.waiting) {
          const w = this.waiting;
          this.waiting = null;
          w(line.split(" ")[1]);
        }
      };
    });
    this.send("uci");
  }
  send(cmd) { this.worker.postMessage(cmd); }
  async best(fen, level) {
    await this.ready;
    const L = LEVELS[level] || LEVELS[3];
    this.send(`setoption name Skill Level value ${L.skill}`);
    this.send(`position fen ${fen}`);
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.send(L.movetime ? `go movetime ${L.movetime}` : `go depth ${L.depth}`);
    });
  }
  stop() {
    if (!this.waiting) return;
    const w = this.waiting;
    this.waiting = null;
    this.send("stop");
    w(null);
  }
}

const engine = new Engine("vendor/stockfish-19-lite-single.js");

// ---- Game -------------------------------------------------------------------

const game = new Chess();
let gen = 0;            // bumps on new game / undo so a late engine reply is dropped
let over = false;
let resigned = false;

const board = makeBoard(el("board"), game, { onMove: userMove });

async function userMove(from, to) {
  if (over || colorName(game.turn()) !== board.userColor) return board.sync();
  let promotion;
  if (isPromotion(game, from, to)) {
    promotion = await board.pickPromotion(board.userColor);
    if (!promotion) return board.sync();
  }
  try { game.move({ from, to, promotion }); } catch { return board.sync(); }
  board.setLastMove(from, to);
  afterMove();
}

function afterMove() {
  board.sync(!over);
  renderMoves();
  if (checkOver()) return;
  save?.mark();
  if (colorName(game.turn()) !== board.userColor) engineMove();
  else setStatus("Your move.", game.inCheck() ? "You're in check." : "");
}

async function engineMove() {
  const my = ++gen;
  board.sync(false);
  setStatus("Computer is thinking…", "");
  const uci = await engine.best(game.fen(), Number(el("level").value));
  if (my !== gen || !uci || uci === "(none)") return;
  game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  board.setLastMove(uci.slice(0, 2), uci.slice(2, 4));
  afterMove();
}

function checkOver() {
  let msg = null;
  if (game.isCheckmate()) {
    msg = colorName(game.turn()) === board.userColor ? "Checkmate — the computer wins." : "Checkmate — you win!";
  } else if (game.isStalemate()) msg = "Stalemate — a draw.";
  else if (game.isInsufficientMaterial()) msg = "Draw — neither side can mate.";
  else if (game.isThreefoldRepetition()) msg = "Draw by threefold repetition.";
  else if (game.isDrawByFiftyMoves()) msg = "Draw by the fifty-move rule.";
  if (!msg) return false;
  over = true;
  board.sync(false);
  save?.clear();
  setStatus(msg, "Press New game to play again.");
  return true;
}

function setStatus(main, sub) {
  el("status").textContent = main;
  el("sub").textContent = sub ?? "";
  el("undo").disabled = over || game.history().length < (board.userColor === "white" ? 1 : 2);
  el("resign").disabled = over;
}

function renderMoves() {
  const list = el("moves");
  list.textContent = "";
  const h = game.history();
  for (let i = 0; i < h.length; i += 2) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="n">${i / 2 + 1}.</span><span></span><span></span>`;
    li.children[1].textContent = h[i];
    li.children[2].textContent = h[i + 1] || "";
    list.appendChild(li);
  }
  list.scrollTop = list.scrollHeight;
}

function newGame() {
  gen++;
  engine.stop();
  game.reset();
  over = false;
  resigned = false;
  let side = el("side").value;
  if (side === "random") side = Math.random() < 0.5 ? "white" : "black";
  board.setUserColor(side);
  board.orient(side);
  board.setLastMove();
  save?.clear();
  renderMoves();
  board.sync();
  if (side === "black") engineMove();
  else setStatus("Your move — you play White.", "Drag a piece, or tap it and then a square.");
}

el("new").addEventListener("click", newGame);
el("flip").addEventListener("click", () => board.cg.toggleOrientation());
el("resign").addEventListener("click", () => {
  if (over) return;
  gen++;
  engine.stop();
  over = true;
  resigned = true;
  board.sync(false);
  save?.clear();
  setStatus("You resigned.", "Press New game to play again.");
});
el("undo").addEventListener("click", () => {
  if (over) return;
  gen++;
  engine.stop();
  // Take back to the last position where it was your move.
  game.undo();
  if (colorName(game.turn()) !== board.userColor) game.undo();
  const last = game.history({ verbose: true }).at(-1);
  board.setLastMove(last?.from, last?.to);
  renderMoves();
  board.sync();
  save?.mark();
  if (colorName(game.turn()) !== board.userColor) engineMove();
  else setStatus("Move taken back. Your move.", "");
});

// ---- Resume -----------------------------------------------------------------

const save = window.GameSave?.attach({
  key: "chess",
  slug: "chess",
  name: "Chess",
  version: 1,
  serialize: () => (over || resigned ? null : { pgn: game.pgn(), c: board.userColor, lv: el("level").value }),
  restore: (s) => {
    if (!s || typeof s.pgn !== "string") return false;
    try { game.loadPgn(s.pgn); } catch { return false; }
    board.setUserColor(s.c === "black" ? "black" : "white");
    board.orient(board.userColor);
    el("side").value = board.userColor;
    if (s.lv) el("level").value = s.lv;
    const last = game.history({ verbose: true }).at(-1);
    board.setLastMove(last?.from, last?.to);
    return true;
  },
});

engine.ready.then(() => {
  if (el("status").textContent.startsWith("Loading")) setStatus("Your move — you play White.", "Drag a piece, or tap it and then a square.");
});

if (save?.restored) {
  renderMoves();
  afterMove();
  if (!over && colorName(game.turn()) === board.userColor) setStatus("Welcome back — your game is where you left it.", "Your move.");
} else {
  newGame();
}
