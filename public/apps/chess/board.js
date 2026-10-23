// Shared board glue for the ExeBrowser chess pages: lichess's chessground
// draws and drags, chess.js knows the rules. GPL-3.0-or-later (see NOTICE.md).
import { Chessground } from "./vendor/chessground.min.js";
import { Chess } from "./vendor/chess.js";

export { Chess };

export const colorName = (t) => (t === "w" ? "white" : "black");

// Legal destinations in chessground's shape: Map<from, to[]>.
export function destsOf(game) {
  const m = new Map();
  for (const mv of game.moves({ verbose: true })) {
    const list = m.get(mv.from);
    if (list) { if (!list.includes(mv.to)) list.push(mv.to); } else m.set(mv.from, [mv.to]);
  }
  return m;
}

// Creates the board. `onMove(from, to)` fires after the user drops a piece on
// a legal square; it should call game.move(...) and then board.sync().
export function makeBoard(el, game, { orientation = "white", onMove } = {}) {
  let userColor = orientation;
  let lastMove;
  const cg = Chessground(el, {
    fen: game.fen(),
    orientation,
    coordinates: true,
    animation: { enabled: true, duration: 180 },
    highlight: { lastMove: true, check: true },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    movable: {
      free: false, showDests: true, color: userColor,
      events: { after: (from, to) => onMove?.(from, to) },
    },
  });

  const api = {
    cg,
    get userColor() { return userColor; },
    // Redraw from the game. `canMove` false freezes the board (engine
    // thinking, puzzle over).
    sync(canMove = true) {
      const turn = colorName(game.turn());
      cg.set({
        fen: game.fen(),
        turnColor: turn,
        lastMove,
        check: game.inCheck() ? turn : false,
        movable: { color: canMove ? userColor : undefined, dests: canMove ? destsOf(game) : new Map() },
      });
    },
    setLastMove(from, to) { lastMove = from && to ? [from, to] : undefined; },
    setUserColor(c) { userColor = c; },
    orient(c) { cg.set({ orientation: c }); },
    // Pawn reaching the last rank: ask which piece, resolve to "q"/"r"/"b"/"n".
    // A canvas-free picker over the board; Escape or a click outside cancels.
    pickPromotion(color) {
      return new Promise((resolve) => {
        const wrap = document.createElement("div");
        wrap.className = "promo cg-wrap";   // cg-wrap so the cburnett piece art applies
        wrap.setAttribute("role", "dialog");
        wrap.setAttribute("aria-label", "Promote to");
        for (const [p, name] of [["q", "queen"], ["r", "rook"], ["b", "bishop"], ["n", "knight"]]) {
          const b = document.createElement("button");
          b.className = "promo-btn";
          b.title = name;
          b.innerHTML = `<piece class="${name} ${color}"></piece>`;
          b.addEventListener("click", (e) => { e.stopPropagation(); done(p); });
          wrap.appendChild(b);
        }
        const done = (p) => { wrap.remove(); removeEventListener("keydown", key); resolve(p); };
        const key = (e) => { if (e.key === "Escape") done(null); };
        wrap.addEventListener("click", () => done(null));
        addEventListener("keydown", key);
        el.closest(".board-wrap").appendChild(wrap);
        wrap.querySelector("button").focus();
      });
    },
  };
  return api;
}

// True if from→to is a pawn move onto the last rank (needs a promotion piece).
export const isPromotion = (game, from, to) =>
  game.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
