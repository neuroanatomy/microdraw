/*
  MUI: the user interface widgets of the Microdraw toolbar.

  A jQuery-free port of muijs v0.1.3 (https://github.com/r03ert0/muijs,
  vendored until 2026-10-13 as app/public/lib/muijs/mui.js), made for M4b
  (microdraw docs/decisions.md D34). Same API and same behaviour for the five
  widgets microdraw uses: slider, chose, chose3state, toggle and push. The
  sixth, crop, is not used by microdraw and was not ported.

  What jQuery did and this file keeps:
  - each widget's state lives in a private store per element, as jQuery's
    .data(); a key never set there is read from the element's data-*
    attribute, converted as jQuery converts it ("false" -> false, "12" -> 12);
  - a handler that returns false prevents the default action and stops the
    event (jQuery's rule), and runs with `this` set to the element;
  - a missing element (null) is ignored, as an empty jQuery selection.
  Tests: test/e2e/microdraw.toolbar-widgets.spec.js, written on muijs 0.1.3
  with jQuery 1.11 and passing unchanged on this port.
*/
/* eslint max-statements: ["error", 20] -- the IIFE and slider hold the widgets, as in muijs (M4b, 2026-10-13) */
/* eslint callback-return: "off" -- callbacks notify, their result is not used, as in muijs (M4b, 2026-10-13) */

window.MUI = (function () {
  const store = new WeakMap();

  // jQuery 1.11's conversion of a data-* attribute value
  const fromAttribute = (value) => {
    if (value === 'true') { return true; }
    if (value === 'false') { return false; }
    if (value === 'null') { return null; }
    if (String(Number(value)) === value) { return Number(value); }
    if ((/^(?:\{[\w\W]*\}|\[[\w\W]*\])$/).test(value)) {
      try { return JSON.parse(value); } catch (e) { return value; }
    }

    return value;
  };

  const getData = (el, key) => {
    const data = store.get(el) || {};
    if (key in data) { return data[key]; }
    const attr = el.getAttribute(`data-${key.replace(/[A-Z]/g, '-$&').toLowerCase()}`);
    if (attr === null) { return undefined; } // eslint-disable-line no-undefined
    data[key] = fromAttribute(attr);
    store.set(el, data);

    return data[key];
  };

  const setData = (el, obj) => {
    store.set(el, Object.assign(store.get(el) || {}, obj));
  };

  // addEventListener with jQuery's handler rules: `this` is the element, and
  // returning false means preventDefault() and stopPropagation()
  const on = (el, types, handler) => {
    types.split(' ').forEach((type) => {
      el.addEventListener(type, function (ev) {
        if (handler.call(el, ev) === false) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      });
    });
  };

  return {

    /**
     * @function slider
     * @param {object} elem DOM element with a .mui-track and a .mui-thumb
     * @param {function} callback Called with (value from 0 to 100, event) while dragging (unless data-onstop) and on release
     * @returns {void}
     */
    slider: function (elem, callback) {
      if (!elem) { return; }
      setData(elem, {
        drag: false,
        val: 0,
        max: 100
      });

      const value = (el, clientX) => {
        const R = el.querySelector(".mui-track").getBoundingClientRect();
        let x = (clientX - R.left) / R.width;
        if (x < 0) { x = 0; }
        if (x > 1) { x = 1; }
        x *= getData(el, "max");

        return x;
      };

      const movex = (el, clientX, ev) => {
        const continuous = !getData(el, "onstop");
        const drag = getData(el, "drag");
        if (drag) {
          const x = value(el, clientX);
          if (x !== getData(el, "val")) {
            const max = getData(el, "max");
            setData(el, { val: x });
            el.querySelector(".mui-thumb").style.left = (x * 100 / max) + "%";
            if (continuous) {
              callback(x, ev);
            }
          }
        }
      };

      const endx = (el, clientX, ev) => {
        const drag = getData(el, "drag");
        if (drag) {
          setData(elem, { drag: false });
          const x = value(el, clientX);
          callback(x, ev);
        }
      };

      on(document, "mousemove", (ev) => { movex(elem, ev.clientX, ev); });
      on(document, "touchmove", (ev) => { movex(elem, ev.changedTouches[0].pageX, ev); });
      on(document, "mouseup", (ev) => { endx(elem, ev.clientX, ev); });
      on(document, "touchend", (ev) => { endx(elem, ev.changedTouches[0].pageX, ev); });
      on(elem, "mousedown touchstart", () => { setData(elem, { drag: true }); });
    },

    /**
     * @function chose
     * @param {object} elem DOM element containing .mui buttons, one of them pressed
     * @param {function} callback Called with the title of the clicked button
     * @returns {void}
     */
    chose: function (elem, callback) {
      if (!elem) { return; }
      const ch = elem.querySelectorAll(".mui");
      ch.forEach((d) => {
        on(d, "click", function () {
          if (this.classList.contains("mui-pressed")) {
            return callback(this.getAttribute("title"));
          }
          ch.forEach((c) => { c.classList.remove("mui-pressed"); });
          this.classList.add("mui-pressed");
          if (callback) {
            return callback(this.getAttribute("title"));
          }
        });
      });
    },

    /**
     * @function chose3state
     * @param {object} elem DOM element containing .mui buttons, at most one of them pressed
     * @param {function} callback Called with the title of the pressed button, or "none"
     * @returns {void}
     */
    chose3state: function (elem, callback) {
      if (!elem) { return; }
      const ch = elem.querySelectorAll(".mui");
      ch.forEach((d) => {
        on(d, "click", () => {
          if (d.classList.contains("mui-pressed")) {
            d.classList.remove("mui-pressed");

            return callback("none");
          }
          ch.forEach((d1) => { d1.classList.remove("mui-pressed"); });
          d.classList.add("mui-pressed");
          if (callback) {
            return callback(d.getAttribute("title"));
          }
        });
      });
    },

    /**
     * @function toggle
     * @param {object} elem DOM element
     * @param {function} callback Called with true when pressed, false when released
     * @returns {void}
     */
    toggle: function (elem, callback) {
      if (!elem) { return; }
      on(elem, "click", function () {
        this.classList.toggle("mui-pressed");
        if (callback) {
          callback(this.classList.contains("mui-pressed"));
        }
      });
    },

    /**
     * @function push
     * @param {object} elem DOM element
     * @param {function} callback Called on click
     * @returns {void}
     */
    push: function (elem, callback) {
      if (!elem) { return; }
      on(elem, "click", () => {
        if (callback) {
          callback();
        }
      });
    }
  };
}());
