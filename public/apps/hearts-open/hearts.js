// Open Hearts — a from-scratch implementation of the classic trick-taking game.
//
// Written for ExeBrowser because Microsoft Hearts is proprietary and can't be
// hosted, and the DOS shareware Hearts renders with corrupted scanlines under
// our DOSBox build. This runs natively in the browser: no emulator, no
// download, instant start, and it works the same on a phone as on a desktop.
//
// Rules implemented: standard 4-player Hearts. Pass 3 cards left/right/across
// then hold on a 4-hand cycle; 2♣ leads the first trick; hearts must be broken
// before they can be led; no points on the first trick; hearts score 1 each and
// the queen of spades 13; shooting the moon (all 26) gives everyone else 26.
(() => {
  "use strict";

  const SUITS = ["C", "D", "S", "H"];          // clubs, diamonds, spades, hearts
  const SUIT_CHAR = { C: "♣", D: "♦", S: "♠", H: "♥" };
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const PASS_CYCLE = ["left", "right", "across", "hold"];
  const SEAT_NAMES = ["You", "West", "North", "East"];

  const el = (id) => document.getElementById(id);
  const rankValue = (r) => RANKS.indexOf(r);
  const cardId = (c) => c.s + c.r;
  const isPoint = (c) => c.s === "H" || (c.s === "S" && c.r === "Q");
  const points = (c) => (c.s === "H" ? 1 : c.s === "S" && c.r === "Q" ? 13 : 0);

  const state = {
    hands: [[], [], [], []],
    scores: [0, 0, 0, 0],
    trick: [],            // [{seat, card}]
    leader: 0,
    turn: 0,
    heartsBroken: false,
    handNo: 0,
    passDir: "left",
    selected: new Set(),
    phase: "passing",     // passing | playing | handover | gameover
    trickCount: 0,
    target: 100,
    roundPoints: [0, 0, 0, 0],   // points taken in the current hand only
  };

  // ─── resume ────────────────────────────────────────────────────────────
  //
  // Hearts is only safe to store when nothing is in flight. A bot turn and a
  // finished trick are both pending setTimeout calls that live nowhere but in
  // the running page: storing a state mid-bot-turn would resume a hand where
  // three seats are waiting on a timer that no longer exists, and the game
  // would sit there forever. So we save only at the two points where the game
  // is genuinely parked on the human — choosing a pass, or holding the turn —
  // plus the between-hands screen, and serialize null everywhere else. Losing
  // one trick to a mid-animation close beats resuming into a dead hand.
  //
  // `selected` is a Set, which JSON drops, so it travels as an array.

  const resumable = () =>
    state.phase === "passing" ||
    state.phase === "handover" ||
    (state.phase === "playing" && state.turn === 0 && state.trick.length < 4);

  const save = window.GameSave?.attach({
    key: "hearts",
    version: 1,
    serialize: () => {
      if (!resumable()) return null;
      return {
        h: state.hands, sc: state.scores, tr: state.trick, ld: state.leader,
        tn: state.turn, hb: state.heartsBroken, hn: state.handNo, pd: state.passDir,
        sel: [...state.selected], ph: state.phase, tc: state.trickCount,
        tg: state.target, rp: state.roundPoints, lh: state.lastHand || null,
      };
    },
    restore: (s) => {
      if (!s || !Array.isArray(s.h) || s.h.length !== 4) return false;
      // Only the phases the serializer vets are safe to come back into; a save
      // from an older build could hold anything.
      if (s.ph !== "passing" && s.ph !== "handover" &&
          !(s.ph === "playing" && s.tn === 0)) return false;
      state.hands = s.h;
      state.scores = s.sc;
      state.trick = s.tr || [];
      state.leader = s.ld;
      state.turn = s.tn;
      state.heartsBroken = !!s.hb;
      state.handNo = s.hn;
      state.passDir = s.pd;
      state.selected = new Set(s.sel || []);
      state.phase = s.ph;
      state.trickCount = s.tc;
      state.target = s.tg || 100;
      state.roundPoints = s.rp || [0, 0, 0, 0];
      state.lastHand = s.lh;
      return true;
    },
  });

  function newDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ s, r });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function sortHand(h) {
    h.sort((a, b) => SUITS.indexOf(a.s) - SUITS.indexOf(b.s) || rankValue(a.r) - rankValue(b.r));
  }

  function deal() {
    const deck = newDeck();
    state.hands = [[], [], [], []];
    deck.forEach((c, i) => state.hands[i % 4].push(c));
    state.hands.forEach(sortHand);
    state.trick = [];
    state.heartsBroken = false;
    state.trickCount = 0;
    state.roundPoints = [0, 0, 0, 0];
    state.selected.clear();
    state.passDir = PASS_CYCLE[state.handNo % 4];
    state.phase = state.passDir === "hold" ? "playing" : "passing";
    if (state.phase === "playing") startPlay();
    render();
  }

  // ─── passing ───────────────────────────────────────────────────────────
  const passTarget = (seat) =>
    state.passDir === "left" ? (seat + 1) % 4
      : state.passDir === "right" ? (seat + 3) % 4
      : (seat + 2) % 4;

  // A simple but sane pass: shed the queen of spades and high spades if we're
  // short in the suit, then the highest cards we hold.
  function botPass(seat) {
    const h = state.hands[seat].slice();
    const chosen = [];
    const spades = h.filter((c) => c.s === "S");
    const risky = spades.filter((c) => ["Q", "K", "A"].includes(c.r));
    if (spades.length <= 3) for (const c of risky) if (chosen.length < 3) chosen.push(c);
    const rest = h.filter((c) => !chosen.includes(c))
      .sort((a, b) => rankValue(b.r) - rankValue(a.r) || (b.s === "H" ? 1 : 0) - (a.s === "H" ? 1 : 0));
    for (const c of rest) if (chosen.length < 3) chosen.push(c);
    return chosen;
  }

  function doPass() {
    if (state.selected.size !== 3) return;
    const outgoing = [0, 1, 2, 3].map((seat) =>
      seat === 0
        ? state.hands[0].filter((c) => state.selected.has(cardId(c)))
        : botPass(seat)
    );
    for (let seat = 0; seat < 4; seat++) {
      state.hands[seat] = state.hands[seat].filter((c) => !outgoing[seat].includes(c));
    }
    for (let seat = 0; seat < 4; seat++) {
      state.hands[passTarget(seat)].push(...outgoing[seat]);
    }
    state.hands.forEach(sortHand);
    state.selected.clear();
    state.phase = "playing";
    startPlay();
    render();
    maybeBotTurn();
  }

  function startPlay() {
    // Whoever holds the 2 of clubs leads.
    state.leader = state.hands.findIndex((h) => h.some((c) => c.s === "C" && c.r === "2"));
    state.turn = state.leader;
    state.trick = [];
  }

  // ─── legality ──────────────────────────────────────────────────────────
  function legalMoves(seat) {
    const hand = state.hands[seat];
    const first = state.trick.length === 0;
    const leadSuit = state.trick[0]?.card.s;

    if (first && state.trickCount === 0) {
      // Only the holder of the 2 of clubs is constrained; guard against an
      // empty result so a mis-set leader can never leave a player with no
      // legal move (which would blow up the reduce() calls in botChoose).
      const two = hand.filter((c) => c.s === "C" && c.r === "2");
      if (two.length) return two;
    }
    if (first) {
      // Hearts can't be led until broken, unless that's all we have.
      const nonHearts = hand.filter((c) => c.s !== "H");
      return state.heartsBroken || nonHearts.length === 0 ? hand : nonHearts;
    }
    const follow = hand.filter((c) => c.s === leadSuit);
    if (follow.length) return follow;
    // First trick takes no points, so we can't dump the queen or a heart there.
    if (state.trickCount === 0) {
      const safe = hand.filter((c) => !isPoint(c));
      if (safe.length) return safe;
    }
    return hand;
  }

  // Any path that returns nothing would strand a player mid-trick, so treat an
  // empty legal set as "anything in hand" rather than crashing.
  const safeLegal = (seat) => {
    const l = legalMoves(seat);
    return l.length ? l : state.hands[seat];
  };

  // ─── bot play ──────────────────────────────────────────────────────────
  function botChoose(seat) {
    const legal = safeLegal(seat);
    if (!legal.length) return null;
    const leadSuit = state.trick[0]?.card.s;
    const following = state.trick.length > 0;

    if (!following) {
      // Lead low, and avoid leading spades while the queen is still out.
      const safe = legal.filter((c) => !(c.s === "S" && rankValue(c.r) >= rankValue("Q")));
      const pool = safe.length ? safe : legal;
      return pool.reduce((lo, c) => (rankValue(c.r) < rankValue(lo.r) ? c : lo));
    }

    const inSuit = legal.filter((c) => c.s === leadSuit);
    if (inSuit.length) {
      const played = state.trick.filter((t) => t.card.s === leadSuit).map((t) => rankValue(t.card.r));
      const highestPlayed = played.length ? Math.max(...played) : -1;
      const isLast = state.trick.length === 3;
      const trickPoints = state.trick.reduce((n, t) => n + points(t.card), 0);
      // Duck under the current winner when we can; if the trick is cheap and
      // we're last to play, taking it with a high card is fine.
      const under = inSuit.filter((c) => rankValue(c.r) < highestPlayed);
      if (under.length && !(isLast && trickPoints === 0)) {
        return under.reduce((hi, c) => (rankValue(c.r) > rankValue(hi.r) ? c : hi));
      }
      return inSuit.reduce((lo, c) => (rankValue(c.r) < rankValue(lo.r) ? c : lo));
    }

    // Void in the led suit — dump the most dangerous card we hold.
    const queen = legal.find((c) => c.s === "S" && c.r === "Q");
    if (queen) return queen;
    const hearts = legal.filter((c) => c.s === "H");
    if (hearts.length) return hearts.reduce((hi, c) => (rankValue(c.r) > rankValue(hi.r) ? c : hi));
    return legal.reduce((hi, c) => (rankValue(c.r) > rankValue(hi.r) ? c : hi));
  }

  // ─── trick flow ────────────────────────────────────────────────────────
  function playCard(seat, card) {
    state.hands[seat] = state.hands[seat].filter((c) => cardId(c) !== cardId(card));
    state.trick.push({ seat, card });
    if (card.s === "H") state.heartsBroken = true;
    state.turn = (seat + 1) % 4;
    render();

    if (state.trick.length === 4) {
      setTimeout(finishTrick, 900);
    } else {
      maybeBotTurn();
    }
  }

  function finishTrick() {
    const leadSuit = state.trick[0].card.s;
    // The lead card always matches its own suit, so this can't be empty in a
    // well-formed trick — but fall back to the lead rather than throwing if a
    // future change ever breaks that assumption mid-game.
    const inSuit = state.trick.filter((t) => t.card.s === leadSuit);
    const winner = (inSuit.length ? inSuit : [state.trick[0]])
      .reduce((hi, t) => (rankValue(t.card.r) > rankValue(hi.card.r) ? t : hi)).seat;
    const won = state.trick.reduce((n, t) => n + points(t.card), 0);
    state.roundPoints[winner] += won;
    state.trick = [];
    state.trickCount++;
    state.leader = winner;
    state.turn = winner;

    if (state.hands[0].length === 0) return endHand();
    render();
    maybeBotTurn();
  }

  function endHand() {
    // Shooting the moon: take all 26 in one hand and every *other* player
    // takes 26 instead, which is the whole reason the risk is worth taking.
    const shooter = [0, 1, 2, 3].find((s) => state.roundPoints[s] === 26);
    if (shooter !== undefined) {
      for (let s = 0; s < 4; s++) if (s !== shooter) state.scores[s] += 26;
      state.lastHand = `${SEAT_NAMES[shooter]} shot the moon — everyone else takes 26.`;
    } else {
      for (let s = 0; s < 4; s++) state.scores[s] += state.roundPoints[s];
      state.lastHand = null;
    }
    state.roundPoints = [0, 0, 0, 0];
    state.handNo++;
    state.phase = Math.max(...state.scores) >= state.target ? "gameover" : "handover";
    render();
  }

  let botTimer = null;
  function maybeBotTurn() {
    clearTimeout(botTimer);
    if (state.phase !== "playing" || state.turn === 0) return;
    botTimer = setTimeout(() => {
      botTimer = null;
      const seat = state.turn;
      // Re-check everything at fire time: the state may have moved on since
      // this timer was scheduled, and a seat with no cards must never be asked
      // to play one.
      if (state.phase !== "playing" || seat === 0) return;
      if (!state.hands[seat] || state.hands[seat].length === 0) return;
      if (state.trick.length >= 4) return;
      const pick = botChoose(seat);
      if (pick) playCard(seat, pick);
    }, 650);
  }

  // ─── rendering ─────────────────────────────────────────────────────────
  function cardEl(c, opts = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "card" + (c.s === "H" || c.s === "D" ? " red" : "");
    if (opts.selected) b.classList.add("sel");
    if (opts.disabled) { b.disabled = true; b.classList.add("dim"); }
    b.innerHTML = `<span class="c-r">${c.r}</span><span class="c-s">${SUIT_CHAR[c.s]}</span>`;
    b.setAttribute("aria-label", `${c.r} of ${{ C: "clubs", D: "diamonds", S: "spades", H: "hearts" }[c.s]}`);
    if (opts.onClick) b.addEventListener("click", opts.onClick);
    return b;
  }

  function render() {
    // Opponent card counts.
    for (let seat = 1; seat < 4; seat++) {
      const n = el("seat" + seat);
      if (n) n.querySelector(".seat-count").textContent = `${state.hands[seat].length} cards`;
    }
    // Scores.
    const sb = el("scores");
    if (sb) {
      sb.innerHTML = SEAT_NAMES.map((nm, i) =>
        `<span class="sc${i === 0 ? " me" : ""}">${nm} <b>${state.scores[i]}</b></span>`).join("");
    }
    // Trick in the middle.
    const tr = el("trick");
    if (tr) {
      tr.innerHTML = "";
      for (const t of state.trick) {
        const wrap = document.createElement("div");
        wrap.className = "played p" + t.seat;
        wrap.appendChild(cardEl(t.card, { disabled: true }));
        const who = document.createElement("span");
        who.className = "played-who";
        who.textContent = SEAT_NAMES[t.seat];
        wrap.appendChild(who);
        tr.appendChild(wrap);
      }
    }
    // Your hand.
    const hd = el("hand");
    if (hd) {
      hd.innerHTML = "";
      const legal = state.phase === "playing" && state.turn === 0 ? safeLegal(0).map(cardId) : null;
      for (const c of state.hands[0]) {
        const id = cardId(c);
        const playable = state.phase === "passing"
          ? true
          : legal ? legal.includes(id) : false;
        hd.appendChild(cardEl(c, {
          selected: state.selected.has(id),
          disabled: !playable,
          onClick: () => onCardClick(c),
        }));
      }
    }
    renderStatus();
    // Every state change ends in a render, so this is the one hook needed.
    // Leaving a resumable position drops the stored save rather than keeping
    // it: the moment a bot is on the clock, that save describes a position a
    // trick behind the live one, and coming back to it would silently rewind
    // the hand. Better no resume than the wrong one.
    if (resumable()) save?.mark();
    else save?.clear();
  }

  function renderStatus() {
    const s = el("status");
    const act = el("action");
    if (!s || !act) return;
    act.innerHTML = "";

    if (state.phase === "passing") {
      const dir = { left: "to your left", right: "to your right", across: "across the table" }[state.passDir];
      s.textContent = `Choose 3 cards to pass ${dir} — ${state.selected.size}/3 selected.`;
      const b = document.createElement("button");
      b.className = "button primary";
      b.textContent = "Pass 3 cards";
      b.disabled = state.selected.size !== 3;
      b.addEventListener("click", doPass);
      act.appendChild(b);
      return;
    }
    if (state.phase === "playing") {
      if (state.turn === 0) {
        s.textContent = state.trickCount === 0 && state.trick.length === 0
          ? "Your lead — the 2♣ starts every hand."
          : "Your turn — play a card.";
      } else {
        s.textContent = `${SEAT_NAMES[state.turn]} is thinking…`;
      }
      return;
    }
    if (state.phase === "handover") {
      s.textContent = (state.lastHand ? state.lastHand + " " : "") +
        `Hand ${state.handNo} complete. Lowest score wins at ${state.target}.`;
      const b = document.createElement("button");
      b.className = "button primary";
      b.textContent = "Next hand";
      b.addEventListener("click", deal);
      act.appendChild(b);
      return;
    }
    if (state.phase === "gameover") {
      const best = Math.min(...state.scores);
      const winner = SEAT_NAMES[state.scores.indexOf(best)];
      s.textContent = `Game over — ${winner} wins with ${best}.`;
      const b = document.createElement("button");
      b.className = "button primary";
      b.textContent = "New game";
      b.addEventListener("click", newGame);
      act.appendChild(b);
    }
  }

  function onCardClick(c) {
    const id = cardId(c);
    if (state.phase === "passing") {
      if (state.selected.has(id)) state.selected.delete(id);
      else if (state.selected.size < 3) state.selected.add(id);
      render();
      return;
    }
    if (state.phase !== "playing" || state.turn !== 0) return;
    if (state.trick.length >= 4) return;   // trick is resolving
    if (!safeLegal(0).some((l) => cardId(l) === id)) return;
    playCard(0, c);
  }

  function newGame() {
    state.scores = [0, 0, 0, 0];
    state.roundPoints = [0, 0, 0, 0];
    state.lastHand = null;
    state.handNo = 0;
    save?.clear();
    deal();
  }

  window.OpenHearts = { newGame };
  if (save?.restored) {
    // Mid-hand from a previous visit. Every resumable phase waits on a click,
    // so rendering is the whole job — there is no timer to restart.
    render();
    const s = el("status");
    if (s) s.textContent = "Resumed your game — " + s.textContent;
  } else {
    newGame();
  }
})();
