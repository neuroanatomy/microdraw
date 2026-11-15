/* global Microdraw */
/* eslint max-lines: ["error", 350] */

/*
  The Regions list of the labels panel (#labelset-panel, T002 3.5): the
  regions of the current slice, top-most first (the reverse of the paint
  order, Microdraw.ImageInfo[slice].Regions), as in Inkscape's "Layers and
  Objects" panel. A row selects its region; it is moved with its drag handle
  (mouse or touch: pointer events), its move up and move down buttons, or
  Alt+Up and Alt+Down; it is deleted with its delete button or the Delete
  key. Moves go through Microdraw.moveRegion and deletions through
  Microdraw.cmdDeleteSelected: one undo step each, and the slice is saved as
  after any other edit.

  Microdraw.regionsChanged() calls schedule(): the list is rebuilt at most
  once per frame, in one pass, and only while the panel is open (opening it
  rebuilds it). Names and texts come from users: they are set as textContent.
*/
window.RegionsList = (function () {
  const TEXT_LENGTH = 40; // characters of a text annotation shown in its row
  const DRAG_THRESHOLD = 4; // px before a press on the handle becomes a drag
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
      regions.map((reg) => [reg.uid, reg.name, L.isText(reg) ? reg.path.content : "", reg === Microdraw.region])
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

    row: (reg, index, count) => {
      const tr = document.createElement("tr");
      const selected = reg === Microdraw.region;
      Object.assign(tr.dataset, {uid: reg.uid, index});
      tr.tabIndex = selected ? 0 : -1;
      tr.classList.toggle("selected", selected);
      tr.setAttribute("aria-selected", String(selected));
      const handle = L.cell("region-handle", "⠇");
      handle.title = "Drag to move";
      tr.append(handle, L.cell("region-color", L.swatch(reg)), L.nameCell(reg), L.cell(
        "region-actions",
        L.button("up", "Move up", "foreward", index === count - 1),
        L.button("down", "Move down", "backward", index === 0),
        L.button("delete", "Delete", "delete", false)
      ));

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
        fragment.appendChild(L.row(regions[i], i, regions.length));
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
      const action = {
        "region-up": () => L.moveBy(reg, 1),
        "region-down": () => L.moveBy(reg, -1),
        "region-delete": () => L.remove(reg)
      }[b ? b.className : ""];
      if (action) {
        action();
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

    // a row is dragged by its handle, with pointer events (mouse and touch)
    dragStart: (e) => {
      const handle = e.target.closest(".region-handle");
      const tr = handle && e.button === 0 && handle.closest("tr[data-uid]");
      const reg = tr && L.regionOf(tr);
      if (!reg) {
        return;
      }
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const drag = {
        handle,
        tr,
        reg,
        startY: e.clientY,
        moved: false,
        target: null,
        onMove: (ev) => L.dragMove(drag, ev),
        onUp: () => L.dragEnd(drag)
      };
      L.dragListen(drag, "addEventListener");
    },

    dragListen: (drag, method) => {
      drag.handle[method]("pointermove", drag.onMove);
      drag.handle[method]("pointerup", drag.onUp);
      drag.handle[method]("pointercancel", drag.onUp);
    },

    clearDrop: (tbody) => {
      tbody.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
    },

    dragMove: (drag, ev) => {
      if (!drag.moved && Math.abs(ev.clientY - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      drag.moved = true;
      drag.tr.classList.add("dragging");
      L.clearDrop(drag.tr.parentNode);
      drag.target = L.dropTarget(drag.tr.parentNode, ev.clientY);
      if (drag.target) {
        drag.target.tr.classList.add(drag.target.before ? "drop-before" : "drop-after");
      }
    },

    dragEnd: (drag) => {
      const {tr, reg, target} = drag;
      L.dragListen(drag, "removeEventListener");
      tr.classList.remove("dragging");
      if (tr.parentNode) {
        L.clearDrop(tr.parentNode);
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
