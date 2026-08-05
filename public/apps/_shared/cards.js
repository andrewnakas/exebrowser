// Shared card-game kit for the ExeBrowser native games (FreeCell, Spider).
//
// Solitaire came first and grew its own copy of all this; rather than refactor
// a game that works — and whose drag behaviour took real tuning to get right —
// this module carries the same behaviour forward for the games built after it.
// If Solitaire is ever touched again, it should move onto this.
//
// What lives here: the deck and card faces, the Windows-style chrome classes,
// and the drag mechanics that make a card feel like it does in the real thing —
// the card lifts off the pile, the drop target is chosen by which pile the CARD
// overlaps most (not where the cursor happens to be), and an illegal drop
// glides home instead of teleporting.
(() => {
  "use strict";

  const SUITS = ["S", "H", "D", "C"];
  const SUIT_CHAR = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const RED = { H: true, D: true };
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const COURT = { J: true, Q: true, K: true };

  const isRed = (c) => !!RED[c.s];
  const rankValue = (c) => RANKS.indexOf(c.r) + 1;   // 1-based: A = 1

  // Rejection-sampled so the modulo doesn't bias low indices. Costs nothing at
  // 52 cards and keeps shuffles honest.
  function randBelow(n) {
    if (window.crypto && window.crypto.getRandomValues) {
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      let v;
      do { window.crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  }

  function shuffle(arr, rnd) {
    const r = rnd || randBelow;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = r(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // `decks` lets Spider ask for two. `suits` lets it ask for a 1- or 2-suit
  // game, where the same few suits repeat.
  function buildDeck({ decks = 1, suits = SUITS } = {}) {
    const d = [];
    for (let n = 0; n < decks; n++)
      for (const s of suits)
        for (const r of RANKS) d.push({ s, r, up: false });
    return d;
  }

  // A card face: rank+suit in both corners with the second rotated, and a
  // centre pip — or a letter in a framed panel for court cards.
  function cardEl(card, faceUpOverride) {
    const up = faceUpOverride !== undefined ? faceUpOverride : card.up;
    const d = document.createElement("div");
    d.className = "card" + (up ? (isRed(card) ? " red" : "") : " down")
      + (up && COURT[card.r] ? " court" : "");
    for (const pos of ["tl", "br"]) {
      const cn = document.createElement("span");
      cn.className = `corner ${pos}`;
      const r = document.createElement("span");
      r.textContent = card.r;
      const s = document.createElement("span");
      s.className = "cs";
      s.textContent = SUIT_CHAR[card.s];
      cn.append(r, s);
      d.appendChild(cn);
    }
    const mid = document.createElement("span");
    mid.className = "center";
    mid.textContent = COURT[card.r] ? card.r : SUIT_CHAR[card.s];
    d.appendChild(mid);
    return d;
  }

  // ── drag ─────────────────────────────────────────────────────────────────
  //
  // The host game supplies four things:
  //   peek(ref, count)        -> the cards a grab would pick up
  //   legalDrop(cards, ref)   -> may these land on that pile?
  //   applyMove(src, dst, n)  -> perform it (and re-render)
  //   onTap(ref, card)        -> a click rather than a drag
  //
  // Piles advertise themselves with data-pile; draggable cards with data-src
  // and data-count. Both are plain strings the host parses.
  function installDrag(opts) {
    const { root, parseRef, parsePile, peek, legalDrop, applyMove, onTap, render } = opts;
    let drag = null, hinted = null, animating = false;

    const coords = (e) => [e.clientX, e.clientY];

    function liftedNodes(cardNode) {
      const parent = cardNode.parentNode;
      if (!parent) return [];
      const kids = [...parent.children];
      return kids.slice(kids.indexOf(cardNode));
    }

    function onDown(e) {
      if (animating) return;
      const cardNode = e.target.closest(".card");
      if (!cardNode || !cardNode.dataset.src) return;
      const src = parseRef(cardNode.dataset.src);
      const count = +cardNode.dataset.count || 1;
      if (!src) return;
      const cards = peek(src, count);
      if (!cards || !cards.length) return;
      const rect = cardNode.getBoundingClientRect();
      drag = {
        src, count, cards,
        startX: e.clientX, startY: e.clientY,
        dx: e.clientX - rect.left, dy: e.clientY - rect.top,
        originX: rect.left, originY: rect.top,
        moved: false, ghost: null,
        lifted: liftedNodes(cardNode),
      };
      e.preventDefault();
    }

    function begin() {
      drag.moved = true;
      const wrap = document.createElement("div");
      wrap.className = "card dragging";
      wrap.style.cssText += ";position:fixed;background:transparent;border:0;box-shadow:none;height:auto;";
      drag.cards.forEach((c, i) => {
        const d = cardEl(c, true);
        d.style.position = "absolute";
        d.style.top = `calc(var(--fan) * ${i})`;
        wrap.appendChild(d);
      });
      drag.ghost = wrap;
      document.body.appendChild(wrap);
      for (const n of drag.lifted) n.style.visibility = "hidden";
      move(drag.startX, drag.startY);
    }

    function move(x, y) {
      drag.ghost.style.left = `${x - drag.dx}px`;
      drag.ghost.style.top = `${y - drag.dy}px`;
    }

    function onMove(e) {
      if (!drag) return;
      const [x, y] = coords(e);
      if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) < 3) return;
      if (!drag.moved) begin();
      move(x, y);
      highlight(bestTarget());
    }

    // Windows picks the pile the dragged CARD overlaps most, not the one under
    // the pointer — which is why dropping there feels forgiving.
    function bestTarget() {
      if (!drag || !drag.ghost) return null;
      const head = drag.ghost.firstChild;
      if (!head) return null;
      const r = head.getBoundingClientRect();
      let best = null, bestArea = 0;
      for (const node of root.querySelectorAll("[data-pile]")) {
        const ref = parsePile(node.dataset.pile);
        if (!ref) continue;
        const box = targetBox(node);
        const ov = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left))
                 * Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
        if (ov > bestArea) { bestArea = ov; best = { ref, node }; }
      }
      // Require a real overlap so a card released in open space snaps back
      // rather than jumping to whatever it barely grazed.
      return bestArea >= (r.width * r.height) * 0.25 ? best : null;
    }

    // Measure a stacked column by its top card, or the whole column would win
    // on area every time.
    function targetBox(node) {
      const cards = node.querySelectorAll(".card");
      const last = cards[cards.length - 1];
      return last ? last.getBoundingClientRect() : node.getBoundingClientRect();
    }

    function highlight(t) {
      if (hinted) { hinted.classList.remove("hint"); hinted = null; }
      if (!t || !t.ref || !drag) return;
      if (!legalDrop(drag.cards, t.ref)) return;
      t.node.classList.add("hint");
      hinted = t.node;
    }

    function restore(d) { for (const n of d.lifted || []) n.style.visibility = ""; }

    function snapBack(d) {
      const g = d.ghost;
      if (!g) { restore(d); render(); return; }
      animating = true;
      g.style.transition = "left .18s ease-out, top .18s ease-out";
      g.style.left = `${d.originX}px`;
      g.style.top = `${d.originY}px`;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        g.remove(); restore(d); animating = false; render();
      };
      g.addEventListener("transitionend", finish, { once: true });
      setTimeout(finish, 260);
    }

    function onUp(e) {
      if (!drag) return;
      const d = drag;
      if (hinted) { hinted.classList.remove("hint"); hinted = null; }
      if (!d.moved) {
        drag = null;
        if (d.ghost) d.ghost.remove();
        restore(d);
        onTap(d.src, d.cards, d.count);
        return;
      }
      const t = bestTarget();
      drag = null;
      if (t && t.ref && legalDrop(d.cards, t.ref)) {
        d.ghost.remove(); restore(d);
        applyMove(d.src, t.ref, d.count);
      } else {
        snapBack(d);
      }
    }

    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (hinted) { hinted.classList.remove("hint"); hinted = null; }
      if (d.ghost) d.ghost.remove();
      restore(d); render();
    });

    return { isAnimating: () => animating };
  }

  // Fit a board of `cols` card-widths (plus gaps of 0.14 each) to the viewport.
  // Derived from the viewport rather than a measured element: before first
  // layout a width:100% container reports its own content width, which would
  // feed itself and never shrink.
  function fitBoard(cols, maxW = 780, maxCard = 71, minCard = 30) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const pad = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
    const avail = Math.min(vw - pad * 2, maxW);
    const cw = Math.max(minCard, Math.min(maxCard, Math.floor(avail / (cols + (cols - 1) * 0.14))));
    document.documentElement.style.setProperty("--cw", `${cw}px`);
    return cw;
  }

  window.Cards = {
    SUITS, SUIT_CHAR, RANKS, COURT,
    isRed, rankValue, randBelow, shuffle, buildDeck, cardEl,
    installDrag, fitBoard,
  };
})();
