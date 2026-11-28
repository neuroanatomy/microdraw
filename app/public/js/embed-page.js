/**
 * The embeddable, read-only viewer (T002 3.7), served by GET /data/embed
 * (views/dataEmbed.mustache), as BrainBox's view/brainbox/src/pages/embed-page.js.
 *
 * One dataset: the image (OpenSeadragon), the project's regions (paper.js),
 * drawn read-only, slice navigation, zoom and pan, label visibility, full
 * screen and a link to open the dataset in MicroDraw. No drawing, editing,
 * saving, upload, scripting or chat: this page has no code that writes, and
 * the server refuses writes from it anyway (embed-access.js, over HTTP;
 * embedConnections.js, over the WebSocket).
 *
 * It is a separate, small viewer rather than microdraw.js in a mode:
 * microdraw.js is the editor, and builds its toolbar, tools, chat and script
 * console from the full page. What it shares with microdraw.js (the region
 * colours, the paint order, the overlay transform) is noted below.
 *
 * Sizing: the page posts {type: 'microdraw:embed-resize', height, width,
 * aspect, slice} to its parent on first render, on each slice change, and
 * when the toolbar's height or the width changes (embed-sizing.js for the
 * image's aspect; desiredEmbedHeight and positiveIntParam from nwl-components'
 * embed build, the global nwlComponentsEmbed).
 */
/* global params embedWsTicket paper OpenSeadragon EmbedSizing nwlComponentsEmbed PageHelpers */
/* eslint max-statements: ["error", 50], max-lines: ["error", 650] */
(function () {
  'use strict';

  const RESIZE_MESSAGE = 'microdraw:embed-resize';
  // sent on each request to this server: the server refuses writes carrying it
  const EMBED_HEADER = 'X-Microdraw-Embed';
  const DEFAULT_LABEL_SET = '/labels/10regions.json';
  // resolution of the annotation canvas, as microdraw.js's magicV
  const MAGIC_V = 1000;
  const ZOOM_STEP = 1.5;

  const el = (id) => document.getElementById(id);
  const root = el('embed');

  // What is shown, read by the tests (test/e2e/embed.spec.js)
  const state = {
    source: params.source,
    project: params.project || null,
    imageOrder: [],
    tileSources: {},
    index: -1,
    current: null,
    // the slice whose regions are drawn, and the fetches of regions still out
    drawnSlice: null,
    fetching: 0,
    regions: [],
    hiddenLabels: new Set(),
    ontology: { labels: [] },
    fillAlpha: 0.5,
    viewer: null,
    ws: null,
    joined: null
  };
  window.MicrodrawEmbed = state;

  /**
   * @param {string} name 'loading', 'ready' or 'error'
   * @param {string} [message] What the status line says
   * @returns {void}
   */
  const setViewerState = (name, message = '') => {
    root.dataset.state = name;
    el('embedStatus').textContent = message;
  };

  const isSameOrigin = (u) => new URL(u, window.location.href).origin === window.location.origin;

  /** @returns {object} fetch's options for a request to this server */
  const sameOriginInit = () => ({
    headers: { Accept: 'application/json', [EMBED_HEADER]: typeof embedWsTicket === 'string' ? embedWsTicket : '' },
    credentials: 'same-origin'
  });

  /**
   * GET a URL and parse its JSON. Requests to this server carry the embed
   * header; others (a dataset hosted elsewhere) do not, so that they need no
   * CORS preflight. PageHelpers: /js/page-helpers.js (dataEmbed.mustache).
   * @param {string} u The URL
   * @returns {Promise<any>} The answer; rejects with err.status on an error status
   */
  const getJSON = async (u) => {
    const init = isSameOrigin(u) ? sameOriginInit() : { headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    const answer = await PageHelpers.fetchJSON(u, init);

    return answer;
  };

  /**
   * The dataset's description: directly when it is on this server or allows
   * it (CORS), otherwise through this server's /getJson, as microdraw.js
   * @param {string} source The source URL
   * @returns {Promise<object>} The description ({tileSources, names, ...})
   */
  const loadSourceJson = async (source) => {
    // a CZI file is read by the CZI service: never fetched here, nor by /getJson
    if (PageHelpers.isCziURL(source)) {
      return PageHelpers.fetchDataset(source);
    }
    if (isSameOrigin(source)) {
      return PageHelpers.fetchDataset(source, sameOriginInit());
    }
    try {
      return await PageHelpers.fetchDataset(source);
    } catch (err) {
      // cross-origin without CORS: through the server
    }

    return getJSON(`/getJson?source=${encodeURIComponent(source)}`);
  };

  /*
    Labels and colours, as microdraw.js (projectLabelSetURL, regionColor,
    regionHashColor)
  */

  const labelSetURL = async (project) => {
    if (!project) {
      return DEFAULT_LABEL_SET;
    }
    const layers = await getJSON(`/project/json/${encodeURIComponent(project)}?var=annotations/list`);
    const layer = Array.isArray(layers) ? layers.find((a) => a && a.type === 'vectorial') : null;
    if (!layer) {
      return DEFAULT_LABEL_SET;
    }
    const sets = await getJSON('/api/getLabelsets');
    const found = Array.isArray(sets) && sets.find((s) => s.source === layer.values || s.name === layer.values);

    return found ? `/labels/${encodeURIComponent(found.source)}` : DEFAULT_LABEL_SET;
  };

  const loadLabelSet = async () => {
    let u = DEFAULT_LABEL_SET;
    try {
      u = await labelSetURL(state.project);
    } catch (err) {
      console.info('cannot find the label set of the project, using 10 regions:', err.message);
    }
    try {
      state.ontology = await getJSON(u);
    } catch (err) {
      state.ontology = await getJSON(DEFAULT_LABEL_SET).catch(() => ({ labels: [] }));
    }
  };

  const hash = (str) => str.split('').reduce((a, b) => {
    const h = ((a << 5) - a) + b.charCodeAt(0);

    return h & h;
  }, 0);

  const hashColor = (name) => {
    let h = hash(name);
    h = Math.sin(h += 1) * 10000;
    h = 0xffffff * (h - Math.floor(h));

    return [h & 0xff, (h & 0xff00) >> 8, (h & 0xff0000) >> 16];
  };

  const regionColor = (name) => {
    const labels = Array.isArray(state.ontology.labels) ? state.ontology.labels : [];
    const label = labels.find((l) => l && l.name === name && Array.isArray(l.color));

    return label ? label.color : hashColor(String(name));
  };

  /*
    Regions
  */

  // GET /api's documents in paint order, as microdraw.js's sortByOrder
  const sortByOrder = (data) => {
    const ordered = (doc) => typeof doc.order === 'number' && Number.isFinite(doc.order);
    const id = (doc) => String(doc._id || '');
    const byId = (a, b) => (id(a) < id(b) ? -1 : Number(id(a) > id(b)));

    return [
      ...data.filter((doc) => !ordered(doc)).sort((a, b) => byId(b, a)),
      ...data.filter(ordered).sort((a, b) => (a.order - b.order) || byId(a, b))
    ];
  };

  const isRegionShown = (name) => name === 'textAnnotation' || !state.hiddenLabels.has(name);

  /**
   * A paper.js item from its exported JSON, as microdraw.js's _pathFromJSON
   * @param {Array} json ['Path' | 'CompoundPath' | 'PointText', {...}]
   * @returns {object} The item, in the active layer
   */
  const importItem = (json) => {
    const types = { Path: paper.Path, CompoundPath: paper.CompoundPath, PointText: paper.PointText };
    const item = new (types[json[0]] || paper.Path)();
    item.importJSON(json);

    return item;
  };

  /**
   * Draw one region, coloured by its label
   * @param {object} doc A GET /api document
   * @returns {void}
   */
  const drawRegion = (doc) => {
    const json = doc && doc.annotation && doc.annotation.path;
    if (!Array.isArray(json)) {
      return;
    }
    try {
      const item = importItem(json);
      const { name } = doc.annotation;
      if (name === 'textAnnotation') {
        if (item.fillColor) { item.fillColor.alpha = 1; }
      } else {
        const [r, g, b] = regionColor(name);
        item.fillColor = new paper.Color(r / 255, g / 255, b / 255, state.fillAlpha);
      }
      item.selected = false;
      item.opacity = isRegionShown(name) ? 1 : 0;
      item.data.regionName = name;
      state.regions.push({ name, uid: doc.annotation.uid, item });
    } catch (err) {
      console.warn('a region could not be drawn', err);
    }
  };

  /**
   * Draw a slice's regions, read only: nothing can be selected or moved
   * @param {Array} data GET /api's documents
   * @returns {void}
   */
  const drawRegions = (data) => {
    paper.project.activeLayer.removeChildren();
    state.regions = [];
    sortByOrder(Array.isArray(data) ? data : []).forEach(drawRegion);
    state.drawnSlice = state.current;
    paper.view.draw();
    // eslint-disable-next-line no-use-before-define
    updateLabelsList();
  };

  /**
   * Fetch the regions of the slice on screen and draw them. An answer for a
   * slice no longer shown is dropped.
   * @returns {Promise<void>} Once drawn
   */
  const loadRegions = async () => {
    const slice = state.current;
    if (!state.project) {
      drawRegions([]);

      return;
    }
    const token = {};
    state.loadToken = token;
    state.fetching += 1;
    let data = [];
    try {
      const query = new URLSearchParams({ source: state.source, slice, project: state.project });
      data = await getJSON(`/api?${query.toString()}`);
    } catch (err) {
      // 403: the annotations are not visible, nothing to draw
      if (err.status !== 403) {
        console.warn('cannot load the regions', err.message);
      }
    } finally {
      state.fetching -= 1;
    }
    if (state.loadToken === token && slice === state.current) {
      drawRegions(data);
    }
  };

  /*
    Label visibility: a label hidden here hides its regions on every slice,
    in this page only
  */

  const updateLabelsList = () => {
    const list = el('labelsList');
    list.textContent = '';
    const names = [...new Set(state.regions.map((r) => r.name).filter((n) => n !== 'textAnnotation'))];
    if (names.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No regions on this slice';
      list.appendChild(empty);
    }
    for (const name of names) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !state.hiddenLabels.has(name);
      box.addEventListener('change', () => {
        if (box.checked) {
          state.hiddenLabels.delete(name);
        } else {
          state.hiddenLabels.add(name);
        }
        state.regions.forEach((r) => { r.item.opacity = isRegionShown(r.name) ? 1 : 0; });
        paper.view.draw();
      });
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      const [r, g, b] = regionColor(name);
      swatch.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      label.append(box, swatch, document.createTextNode(String(name)));
      li.appendChild(label);
      list.appendChild(li);
    }
  };

  /*
    Overlay, as microdraw.js's transform and resizeAnnotationOverlay
  */

  const transform = () => {
    const { viewer } = state;
    if (!viewer || !viewer.source) {
      return;
    }
    const z = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
    const bounds = viewer.viewport.getBounds(true);
    paper.view.setCenter(MAGIC_V * (bounds.x + (bounds.width / 2)), MAGIC_V * (bounds.y + (bounds.height / 2)));
    paper.view.zoom = (viewer.source.width * z) / MAGIC_V;
    paper.view.draw();
  };

  const resizeOverlay = () => {
    const container = el('paperjs-container');
    paper.view.viewSize = new paper.Size(container.offsetWidth, container.offsetHeight);
    transform();
  };

  /*
    Sizing contract (embed-sizing.js, nwl-components/embed)
  */

  const imageSize = () => {
    const item = state.viewer && state.viewer.world.getItemAt(0);
    if (item) {
      const size = item.getContentSize();

      return { width: size.x, height: size.y };
    }

    return { width: NaN, height: NaN };
  };

  const reportSizeToParent = () => {
    if (window.parent === window) {
      return;
    }
    const width = document.documentElement.clientWidth;
    const aspect = EmbedSizing.imageAspect(imageSize());
    const height = nwlComponentsEmbed.desiredEmbedHeight({
      width,
      aspect,
      toolbarHeight: el('tools').offsetHeight,
      maxHeight: nwlComponentsEmbed.positiveIntParam(params.maxHeight) || Infinity
    });
    if (!isFinite(height)) {
      return;
    }
    window.parent.postMessage({ type: RESIZE_MESSAGE, height, width, aspect, slice: state.index }, '*');
  };

  /*
    The link to the dataset in MicroDraw, at the slice shown
  */

  const isDisabled = (value) => value === '0' || value === 'false' || value === 'no';

  const updateMicrodrawLink = () => {
    const link = el('microdrawLink');
    if (!link) {
      return;
    }
    const query = new URLSearchParams({ source: state.source });
    if (state.project) { query.set('project', state.project); }
    if (state.index >= 0) { query.set('slice', String(state.index)); }
    link.href = `${window.location.origin}/data?${query.toString()}`;
  };

  /*
    Live updates: the WebSocket presents the page's ticket, which is scoped
    to this dataset in this project, and joins the room of the slice shown.
    After another user saves it, the regions are fetched again. It sends
    nothing else.
  */

  const RECONNECT_MIN = 1000;
  const RECONNECT_MAX = 30000;
  let reconnectDelay = RECONNECT_MIN;

  const sendJoin = () => {
    const { ws } = state;
    if (!state.project || !state.current || !ws || ws.readyState !== window.WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type: 'join', project: state.project, source: state.source, slice: state.current }));
  };

  const onSocketMessage = (msg) => {
    let data;
    try {
      data = JSON.parse(msg.data);
    } catch (err) {
      return;
    }
    if (!data || typeof data !== 'object') {
      return;
    }
    if (data.type === 'joined') {
      state.joined = data.slice;
    } else if (data.type === 'saved' && data.project === state.project && data.source === state.source &&
        data.slice === state.current) {
      loadRegions();
    } else if (data.type === 'join-refused') {
      console.info('No live updates for this slice:', String(data.reason));
    } else if (data.type === 'writeRefused') {
      // the server's answer to a write from an embed; this page only joins,
      // so there is nothing to undo or show
    }
  };

  const connectSocket = () => {
    if (!state.project || typeof window.WebSocket !== 'function') {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ticket = typeof embedWsTicket === 'string' ? embedWsTicket : '';
    const ws = new window.WebSocket(`${protocol}://${window.location.hostname}:${window.MICRODRAW_WS_PORT || 8080}/?embedTicket=${encodeURIComponent(ticket)}`);
    state.ws = ws;
    let openedAt = null;
    ws.onopen = () => {
      openedAt = Date.now();
      sendJoin();
    };
    ws.onmessage = onSocketMessage;
    ws.onclose = () => {
      state.joined = null;
      if (openedAt !== null && Date.now() - openedAt >= 10000) {
        reconnectDelay = RECONNECT_MIN;
      }
      setTimeout(connectSocket, reconnectDelay);
      reconnectDelay = Math.min(2 * reconnectDelay, RECONNECT_MAX);
    };
  };

  /*
    Slices
  */

  const showSlice = (index) => {
    if (index < 0 || index >= state.imageOrder.length || index === state.index) {
      return;
    }
    state.index = index;
    state.current = state.imageOrder[index];
    state.drawnSlice = null;
    paper.project.activeLayer.removeChildren();
    state.regions = [];
    el('slice-number').textContent = `Slice ${state.current}`;
    el('previous').disabled = index === 0;
    el('next').disabled = index === state.imageOrder.length - 1;
    updateMicrodrawLink();
    state.viewer.open(state.tileSources[state.current].source);
  };

  const onImageOpened = () => {
    const info = state.tileSources[state.current];
    const item = state.viewer.world.getItemAt(0);
    if (item && info) {
      if (info.x || info.y) { item.setPosition({ x: info.x || 0, y: info.y || 0 }, true); }
      if (info.rotation) { item.setRotation(info.rotation, true); }
    }
    resizeOverlay();
    if (root.dataset.state !== 'ready') {
      setViewerState('ready');
      ['zoomIn', 'zoomOut', 'home', 'labels'].forEach((id) => { el(id).disabled = false; });
    }
    reportSizeToParent();
    sendJoin();
    loadRegions();
  };

  /*
    Toolbar
  */

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      root.requestFullscreen().catch((err) => console.info('full screen refused:', err.message));
    }
  };

  const initToolbar = () => {
    el('previous').addEventListener('click', () => showSlice(state.index - 1));
    el('next').addEventListener('click', () => showSlice(state.index + 1));
    el('zoomIn').addEventListener('click', () => state.viewer.viewport.zoomBy(ZOOM_STEP).applyConstraints());
    el('zoomOut').addEventListener('click', () => state.viewer.viewport.zoomBy(1 / ZOOM_STEP).applyConstraints());
    el('home').addEventListener('click', () => state.viewer.viewport.goHome());
    el('labels').addEventListener('click', () => {
      const panel = el('labelsPanel');
      panel.hidden = !panel.hidden;
      el('labels').setAttribute('aria-pressed', String(!panel.hidden));
    });
    // the Fullscreen API, inside the iframe: needs allow="fullscreen"
    if (document.fullscreenEnabled) {
      el('fullscreen').addEventListener('click', toggleFullscreen);
      document.addEventListener('fullscreenchange', () => {
        el('fullscreen').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
      });
    } else {
      el('fullscreen').remove();
    }
    const link = el('microdrawLink');
    if (isDisabled(params.microdrawLink)) {
      link.remove();
    } else {
      updateMicrodrawLink();
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { showSlice(state.index - 1); }
      if (e.key === 'ArrowRight') { showSlice(state.index + 1); }
    });
  };

  /*
    Start
  */

  const initViewer = () => {
    const canvas = document.createElement('canvas');
    canvas.className = 'overlay';
    el('paperjs-container').appendChild(canvas);
    paper.setup(canvas);

    state.viewer = new OpenSeadragon({
      element: el('openseadragon'),
      prefixUrl: '/lib/openseadragon/images/',
      tileSources: [],
      showNavigationControl: false,
      showNavigator: false,
      maxZoomPixelRatio: 10,
      preserveViewport: true,
      imageSmoothingEnabled: false,
      gestureSettingsMouse: { clickToZoom: false }
    });
    state.viewer.addHandler('open', onImageOpened);
    state.viewer.addHandler('open-failed', () => setViewerState('error', 'This image could not be loaded.'));
    state.viewer.addHandler('animation', transform);
    state.viewer.addHandler('resize', resizeOverlay);

    // the toolbar's height and the width (the host's) make the height asked for
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => { reportSizeToParent(); });
      observer.observe(document.documentElement);
      observer.observe(el('tools'));
    }
  };

  // eslint-disable-next-line max-statements
  const start = async () => {
    initToolbar();
    initViewer();
    const [json] = await Promise.all([loadSourceJson(state.source), loadLabelSet()]);
    const sources = json.tileCodeY || json.tileSources;
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error('the dataset has no images');
    }
    if (json.configuration && typeof json.configuration.defaultFillAlpha === 'number') {
      state.fillAlpha = json.configuration.defaultFillAlpha;
    }
    // OME-Zarr images, as microdraw.js: their reader only loaded when needed
    const prepared = await PageHelpers.prepareTileSources(sources, PageHelpers.loadScript, window.location.href);
    prepared.forEach((source, i) => {
      const name = (json.names && json.names[i]) ? String(json.names[i]) : String(i);
      state.imageOrder.push(name);
      state.tileSources[name] = { source };
      // a getTileUrl given as a string is evaluated, as microdraw.js does
      if (source && typeof source.getTileUrl === 'string') {
        // eslint-disable-next-line no-eval
        source.getTileUrl = eval(`(${source.getTileUrl})`);
      }
    });
    const requested = parseInt(params.slice, 10);
    const first = (isFinite(requested) && requested >= 0 && requested < sources.length) ? requested : Math.floor(sources.length / 2);
    connectSocket();
    showSlice(first);
  };

  start().catch((err) => {
    console.error('cannot load the embedded dataset:', err);
    setViewerState('error', 'This dataset could not be loaded.');
  });
}());
