// Client-side filtering for the poster grids on the homepage and /run/ hub.
//
// Everything it needs already lives on each <li> as data-cats and data-search,
// so there's no second copy of the catalogue to keep in sync and no network
// call. The markup ships fully populated: crawlers and no-JS visitors see every
// game, and this only ever hides rows.
(() => {
  "use strict";

  const wrap = document.querySelector("[data-grid-filter]");
  if (!wrap) return;

  // The grid is the next poster-grid after the filter UI.
  const grid = wrap.parentElement.querySelector(".poster-grid:not(#continue-grid)");
  if (!grid) return;

  const items = [...grid.querySelectorAll(".pc-item")];
  const chips = [...wrap.querySelectorAll(".chip")];
  const search = wrap.querySelector("[data-grid-search]");
  const empty = wrap.querySelector(".gf-empty");
  const reset = wrap.querySelector("[data-grid-reset]");

  let activeCat = "";
  let query = "";

  function apply() {
    let shown = 0;
    for (const li of items) {
      const cats = li.dataset.cats || "";
      const hay = li.dataset.search || "";
      const catOk = !activeCat || cats.split("|").includes(activeCat);
      const qOk = !query || hay.includes(query);
      const show = catOk && qOk;
      li.hidden = !show;
      if (show) shown++;
    }
    if (empty) empty.hidden = shown > 0;
    for (const c of chips) c.classList.toggle("is-on", (c.dataset.cat || "") === activeCat);
    // Let the page announce the result to screen readers without shouting on
    // every keystroke — the count lives in the empty-state message only.
    grid.setAttribute("aria-busy", "false");
  }

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      activeCat = chip.dataset.cat || "";
      apply();
    });
  }

  if (search) {
    let t = null;
    search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        query = search.value.trim().toLowerCase();
        apply();
      }, 120);
    });
    // Esc clears, which is what the native search affordance implies.
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        search.value = "";
        query = "";
        apply();
      }
    });
  }

  if (reset) {
    reset.addEventListener("click", () => {
      activeCat = "";
      query = "";
      if (search) search.value = "";
      apply();
    });
  }
})();
