/* global Microdraw */
/* eslint max-lines: ["error", 400] */

/*
  The Regions list of the labels panel (#labelset-panel, T002 3.5): the
  regions of the current slice, top-most first (the reverse of the paint
  order, Microdraw.ImageInfo[slice].Regions), as in Inkscape's "Layers and
  Objects" panel. A row selects its region; it is moved by dragging the row
  (mouse or pen at once, touch after a long press so that a swipe still
  scrolls the list; pointer events), or with Alt+Up and Alt+Down; it is
  deleted with its delete button or the Delete key. Its eye button hides or
  shows the region on this page only: not saved, not an edit
  (Microdraw.setRegionHidden; maintainer, 2026-11-15). Moves go through Microdraw.moveRegion and deletions through
  Microdraw.cmdDeleteSelected: one undo step each, and the slice is saved as
  after any other edit.

  Microdraw.regionsChanged() calls schedule(): the list is rebuilt at most
  once per frame, in one pass, and only while the panel is open (opening it
  rebuilds it). Names and texts come from users: they are set as textContent.
*/
window.RegionsList = (function () {
  const TEXT_LENGTH = 40; // characters of a text annotation shown in its row
  const DRAG_THRESHOLD = 4; // px before a press on a row becomes a drag
  const LONG_PRESS = 350; // ms a finger rests on a row before it can drag it
  const KEYS = {ArrowUp: 1, ArrowDown: -1};

  const L = {
    frame: null,
    rendered: null, // what the rows show, to skip a rebuild that changes nothing

    panel: () => Microdraw.dom && Microdraw.dom.querySelector("#labelset-panel"),
    isOpen: () => Boolean(L.panel()) && L.panel().style.display === "block",
    regions: () => {
      const section = Microdraw.ImageInfo[Microdraw.currentImage];

      return section ? section.Regions : [];
    },
    isText: (reg) => reg.name === "textAnnotation",

    // the text of a text annotation, on one line and shortened
    shortText: (content) => {
      const text = String(content || "").replace(/\s+/g, " ")
        .trim();

      return text.length > TEXT_LENGTH ? `${text.slice(0, TEXT_LENGTH - 1)}…` : text;
    },

    swatchColor: (reg) => {
      if (L.isText(reg)) {
        return reg.path.fillColor ? reg.path.fillColor.toCSS(true) : "transparent";
      }
      const {red, green, blue} = Microdraw.regionColor(reg.name);

      return `rgb(${red},${green},${blue})`;
    },

    signature: (regions) => JSON.stringify([
      Microdraw.currentImage,
      regions.map((reg) => [reg.uid, reg.name, L.isText(reg) ? reg.path.content : "", reg === Microdraw.region, Microdraw.hiddenRegions.has(reg.uid)])
    ]),

    cell: (className, ...children) => {
      const td = document.createElement("td");
      td.className = className;
      td.append(...children);

      return td;
    },

    button: (cls, label, icon, disabled) => {
      const b = document.createElement("button");
      Object.assign(b, {type: "button", className: `region-${cls}`, title: label, disabled});
      b.setAttribute("aria-label", label);
      const img = document.createElement("img");
      Object.assign(img, {src: `/lib/nwl-components/icons/${icon}.svg`, alt: ""});
      b.appendChild(img);

      return b;
    },

    // hides or shows the region on this page only: a disc in a circle, as the
    // labels' visibility above it (filled: shown; empty: hidden; 2026-11-15)
    eye: (hidden) => {
      const b = document.createElement("button");
      Object.assign(b, {type: "button", className: "region-eye", title: hidden ? "Show" : "Hide"});
      b.setAttribute("aria-label", hidden ? "Show" : "Hide");
      b.setAttribute("aria-pressed", String(hidden));
      const disc = document.createElement("span");
      disc.className = hidden ? "label-display off" : "label-display";
      b.appendChild(disc);

      return b;
    },

    swatch: (reg) => {
      const span = document.createElement("span");
      span.className = "region-swatch";
      span.style.backgroundColor = L.swatchColor(reg);

      return span;
    },

    nameCell: (reg) => {
      if (!L.isText(reg)) {
        return L.cell("region-name", reg.name);
      }
      const marker = document.createElement("span");
      Object.assign(marker, {className: "region-text-marker", textContent: "T", title: "Text annotation"});
      const text = document.createElement("span");
      Object.assign(text, {className: "region-text", textContent: L.shortText(reg.path.content)});
      const td = L.cell("region-name", marker, text);
      td.setAttribute("aria-label", `Text: ${text.textContent}`);

      return td;
    },

    row: (reg, index) => {
      const tr = document.createElement("tr");
      const selected = reg === Microdraw.region;
      Object.assign(tr.dataset, {uid: reg.uid, index});
      tr.tabIndex = selected ? 0 : -1;
      tr.classList.toggle("selected", selected);
      tr.setAttribute("aria-selected", String(selected));
      tr.title = "Drag to move";
      tr.classList.toggle("region-hidden", Microdraw.hiddenRegions.has(reg.uid));
      tr.append(
        L.cell("region-visibility", L.eye(Microdraw.hiddenRegions.has(reg.uid))),
        L.cell("region-swatch-cell", L.swatch(reg)),
        L.nameCell(reg),
        L.cell("region-actions", L.button("delete", "Delete", "delete", false))
      );

      return tr;
    },

    /**
     * Rebuild the rows in one pass, if the panel is open and they changed.
     * @param {boolean} force Rebuild even if nothing changed (the panel opens)
     * @returns {void}
     */
    render: (force) => {
      L.frame = null;
      if (!L.isOpen()) {
        L.rendered = null;

        return;
      }
      const regions = L.regions();
      const sig = L.signature(regions);
      if (force || sig !== L.rendered) {
        L.rendered = sig;
        L.fill(L.panel().querySelector("#regions-list"), regions);
      }
    },

    fill: (list, regions) => {
      const fragment = document.createDocumentFragment();
      for (let i = regions.length - 1; i >= 0; i -= 1) {
        fragment.appendChild(L.row(regions[i], i));
      }
      // the list keeps its scroll position
      const {scrollTop} = list;
      list.querySelector("#regions-table tbody").replaceChildren(fragment);
      list.scrollTop = scrollTop;
      list.querySelector("#regions-empty").hidden = regions.length > 0;
    },

    schedule: () => {
      if (L.frame === null && L.isOpen()) {
        L.frame = window.requestAnimationFrame(() => L.render(false));
      }
    },

    // the region of a row (the row may be older than the regions: check its uid)
    regionOf: (tr) => {
      const regions = L.regions();
      const reg = regions[Number(tr.dataset.index)];

      return reg && String(reg.uid) === tr.dataset.uid ? reg : regions.find((r) => String(r.uid) === tr.dataset.uid);
    },

    select: (reg) => {
      if (reg !== Microdraw.region) {
        Microdraw.selectRegion(reg);
      }
    },

    // the keyboard focus goes to the row of a region
    focusRow: (reg) => {
      L.render(false);
      const tr = L.panel().querySelector(`#regions-table tr[data-uid="${CSS.escape(String(reg.uid))}"]`);
      if (tr) {
        tr.tabIndex = 0;
        tr.focus();
      }
    },

    // by `delta` places in the list: +1 is up, towards the top-most
    moveBy: (reg, delta) => {
      L.select(reg);
      Microdraw.moveRegion(reg, L.regions().indexOf(reg) + delta);
      L.focusRow(reg);
    },

    remove: (reg) => {
      L.select(reg);
      Microdraw.cmdDeleteSelected();
    },

    onClick: (e) => {
      const tr = e.target.closest("tr[data-uid]");
      const reg = tr && L.regionOf(tr);
      if (!reg) {
        return;
      }
      const b = e.target.closest("button");
      if (b && b.className === "region-delete") {
        L.remove(reg);
      } else if (b && b.className === "region-eye") {
        Microdraw.setRegionHidden(reg, !Microdraw.hiddenRegions.has(reg.uid));
      } else {
        L.selectRow(tr);
      }
    },

    // Alt+Up, Alt+Down: move; Up, Down: select the row above or below; Delete
    keyAction: (e, tr, reg) => {
      if (!(e.key in KEYS)) {
        return (e.key === "Delete" || e.key === "Backspace") && (() => L.remove(reg));
      }
      if (e.altKey) {
        return () => L.moveBy(reg, KEYS[e.key]);
      }
      const next = KEYS[e.key] > 0 ? tr.previousElementSibling : tr.nextElementSibling;

      return () => L.selectRow(next);
    },

    selectRow: (tr) => {
      const reg = tr && L.regionOf(tr);
      if (reg) {
        L.select(reg);
        L.focusRow(reg);
      }
    },

    onKeyDown: (e) => {
      const tr = e.target.closest("tr[data-uid]");
      const reg = e.target === tr && L.regionOf(tr);
      const action = reg && L.keyAction(e, tr, reg);
      if (action) {
        e.preventDefault();
        // the viewer's own shortcuts (Delete) are not run as well
        e.stopPropagation();
        action();
      }
    },

    // the row under the pointer, and whether the drop goes above or below it
    dropTarget: (tbody, y) => {
      const rows = [...tbody.children];
      const tr = rows.find((r) => y < r.getBoundingClientRect().bottom) || rows[rows.length - 1];
      if (!tr) {
        return null;
      }
      const {top, bottom} = tr.getBoundingClientRect();

      return {tr, before: y < (top + bottom) / 2};
    },

    // the new index of `reg` dropped above or below a row (top-most first)
    dropIndex: (reg, {tr, before}) => {
      const from = L.regions().indexOf(reg);
      const to = Number(tr.dataset.index) + (before ? 1 : 0);

      return to > from ? to - 1 : to;
    },

    // a row is dragged anywhere but on its button, with pointer events: a mouse
    // or a pen at once, a finger after a long press (before it, a swipe scrolls)
    dragStart: (e) => {
      const tr = e.button === 0 && !e.target.closest("button") && e.target.closest("tr[data-uid]");
      const reg = tr && L.regionOf(tr);
      if (!reg) {
        return;
      }
      const touch = e.pointerType === "touch";
      if (!touch) {
        // no text selection while dragging
        e.preventDefault();
      }
      const drag = L.newDrag(e, tr, reg, touch);
      tr.setPointerCapture(e.pointerId);
      L.dragListen(drag, "addEventListener");
    },

    newDrag: (e, tr, reg, touch) => {
      const drag = {tr, reg, pointerId: e.pointerId, startY: e.clientY, armed: !touch, moved: false, target: null, timer: null};
      drag.onMove = (ev) => L.dragMove(drag, ev);
      drag.onUp = (ev) => L.dragEnd(drag, ev);
      // once armed, a finger moving drags the row instead of scrolling the list
      drag.onTouchMove = (ev) => {
        if (drag.armed && ev.cancelable) { ev.preventDefault(); }
      };
      if (touch) {
        drag.timer = setTimeout(() => {
          drag.armed = true;
          tr.classList.add("dragging");
        }, LONG_PRESS);
      }

      return drag;
    },

    dragListen: (drag, method) => {
      drag.tr[method]("pointermove", drag.onMove);
      drag.tr[method]("pointerup", drag.onUp);
      drag.tr[method]("pointercancel", drag.onUp);
      drag.tr[method]("touchmove", drag.onTouchMove, {passive: false});
    },

    clearDrop: (tbody) => {
      tbody.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
    },

    dragMove: (drag, ev) => {
      if (!drag.moved && Math.abs(ev.clientY - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      if (!drag.armed) {
        // a finger that moves before the long press: a scroll, not a drag
        return L.dragCancel(drag);
      }
      drag.moved = true;
      drag.tr.classList.add("dragging");
      L.clearDrop(drag.tr.parentNode);
      drag.target = L.dropTarget(drag.tr.parentNode, ev.clientY);
      if (drag.target) {
        drag.target.tr.classList.add(drag.target.before ? "drop-before" : "drop-after");
      }
    },

    dragCancel: (drag) => {
      const {tr} = drag;
      clearTimeout(drag.timer);
      L.dragListen(drag, "removeEventListener");
      if (tr.hasPointerCapture(drag.pointerId)) {
        tr.releasePointerCapture(drag.pointerId);
      }
      tr.classList.remove("dragging");
      if (tr.parentNode) {
        L.clearDrop(tr.parentNode);
      }
    },

    dragEnd: (drag, ev) => {
      const {tr, reg, target} = drag;
      L.dragCancel(drag);
      if (ev.type === "pointercancel" && !drag.moved) {
        return;
      }
      L.select(reg);
      if (drag.moved && target && target.tr !== tr) {
        Microdraw.moveRegion(reg, L.dropIndex(reg, target));
      }
      L.focusRow(reg);
    },

    /**
     * The panel opens: listen to the list (once) and show it.
     * @returns {void}
     */
    attach: () => {
      const list = L.panel().querySelector("#regions-list");
      if (!list.dataset.ready) {
        list.dataset.ready = "true";
        list.addEventListener("click", L.onClick);
        list.addEventListener("keydown", L.onKeyDown);
        list.addEventListener("pointerdown", L.dragStart);
      }
      L.render(true);
    }
  };

  return {attach: L.attach, render: L.render, schedule: L.schedule};
}());
