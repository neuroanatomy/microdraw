/**
 * MicroDraw embed loader (T002 3.7), the same API as BrainBox's public/embed.js.
 *
 * Drop one line into a page and get a viewer:
 *
 *   <script src="https://microdraw.pasteur.fr/embed.js"
 *           data-source="https://example.org/data.json"
 *           data-project="myproject"></script>
 *
 * The script inserts an <iframe> pointing at /data/embed where it sits, and
 * keeps that iframe at the height the viewer asks for. It is what a host page
 * can write by hand; this only removes the copy-pasting.
 *
 * Dependency-free and unbundled: it is served from a fixed, cacheable URL, and
 * whoever decides whether to trust it can read it.
 *
 * Options, all optional except data-source:
 *   data-source          source URL of the dataset          (required)
 *   data-project         project whose regions are shown
 *   data-slice           initial slice number
 *   data-max-height      cap, in px, on the height the viewer may ask for
 *   data-microdraw-link  "0" hides the MicroDraw link
 *   data-width           CSS width of the box     (default 100%)
 *   data-max-width       CSS max-width of the box (default 560px)
 *   data-height          CSS height to start from (default 420px)
 *   data-target          CSS selector of the element to render into; by
 *                        default the viewer appears where the script tag is
 */
/* eslint max-statements: ["error", 15] */
(function () {
  'use strict';

  const RESIZE_MESSAGE = 'microdraw:embed-resize';
  const MAX_SANE_HEIGHT = 4000;

  // data-* attribute (camelCased by dataset) -> /data/embed query parameter
  const QUERY_ATTRIBUTES = {
    source: 'source',
    project: 'project',
    slice: 'slice',
    maxHeight: 'maxHeight',
    microdrawLink: 'microdrawLink'
  };

  // the frames of this page, shared by every copy of the script it loads
  const registry = window.__microdrawEmbeds || (window.__microdrawEmbeds = { frames: [], listening: false });

  /**
   * The <script> element being executed. document.currentScript covers the
   * normal case; the fallback covers async/deferred loading, where it is null.
   * @returns {Element|null} The script element that pulled us in
   */
  const findScript = function () {
    if (document.currentScript) { return document.currentScript; }
    const candidates = document.querySelectorAll('script[src*="embed.js"]:not([data-microdraw-embedded])');

    return candidates.length ? candidates[candidates.length - 1] : null;
  };

  /**
   * @param {Element} script The script element
   * @returns {string} Origin MicroDraw is served from
   */
  const microdrawOrigin = function (script) {
    const link = document.createElement('a');
    link.href = script.src;

    return link.protocol + '//' + link.host;
  };

  /**
   * @param {Element} script The script element carrying the data-* options
   * @returns {string} Query string for /data/embed
   */
  const queryString = function (script) {
    const parts = [];
    Object.keys(QUERY_ATTRIBUTES).forEach(function (key) {
      const value = script.dataset[key];
      if (value) {
        parts.push(QUERY_ATTRIBUTES[key] + '=' + encodeURIComponent(value));
      }
    });

    return parts.join('&');
  };

  /**
   * Resize the iframe a message came from. The sender is identified by its
   * window, so one embed cannot resize another and an unrelated page cannot
   * resize any of them.
   * @param {MessageEvent} event The postMessage event
   * @returns {void}
   */
  const onMessage = function (event) {
    if (!event.data || event.data.type !== RESIZE_MESSAGE) { return; }
    const { height } = event.data;
    if (typeof height !== 'number' || !isFinite(height) || height <= 0 || height > MAX_SANE_HEIGHT) { return; }

    const target = registry.frames.find(function (frame) {
      return event.source === frame.contentWindow;
    });
    if (target) { target.style.height = height + 'px'; }
  };

  /**
   * @param {Element} script The script element
   * @returns {Element} The iframe to show the viewer in
   */
  const buildFrame = function (script) {
    const frame = document.createElement('iframe');
    frame.className = 'microdraw-embed';
    frame.title = 'MicroDraw viewer';
    frame.setAttribute('allow', 'fullscreen');
    frame.setAttribute('allowfullscreen', '');
    frame.style.display = 'block';
    frame.style.border = '0';
    frame.style.background = '#222';
    frame.style.width = script.dataset.width || '100%';
    frame.style.maxWidth = script.dataset.maxWidth || '560px';
    // a starting guess only: the viewer reports the height it needs as soon
    // as it knows the shape of the image
    frame.style.height = script.dataset.height || '420px';

    return frame;
  };

  /**
   * @param {Element} script The script element
   * @param {Element} frame The iframe to place
   * @returns {void}
   */
  const place = function (script, frame) {
    const target = script.dataset.target ? document.querySelector(script.dataset.target) : null;
    if (target) {
      target.appendChild(frame);
    } else if (script.parentNode) {
      script.parentNode.insertBefore(frame, script);
    }
  };

  const init = function () {
    const script = findScript();
    if (!script || script.hasAttribute('data-microdraw-embedded')) { return; }
    script.setAttribute('data-microdraw-embedded', '');

    if (!script.dataset.source) {
      console.error('MicroDraw embed: data-source is required');

      return;
    }

    const frame = buildFrame(script);
    frame.src = microdrawOrigin(script) + '/data/embed?' + queryString(script);
    place(script, frame);
    registry.frames.push(frame);

    // one listener for the whole page, however many embeds it has
    if (!registry.listening) {
      registry.listening = true;
      window.addEventListener('message', onMessage);
    }
  };

  init();
}());
