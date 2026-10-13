# Example pages

**Status:** experiment: customising microdraw for particular use cases.
**Owner:** (a lab colleague — to fill in)

These pages are not part of the microdraw app: no other page links to them, and they are
not maintained with it. Each one stacks several microdraw viewers (`/data?source=…&displayTools=false`)
in full-window iframes, one per layer, with a small control panel on top. A transparent
`#invisible` div catches the mouse and wheel events and passes them to the
OpenSeadragon canvas of every layer, so the layers pan and zoom together.

They were served from the site root until 2026-10-13 (M8b). The old URLs
(`/composer.html`, `/composer-0.html`, `/overlays.html`) redirect here (302), query string included.

| Page | What it shows |
|---|---|
| [`composer.html`](composer.html) | The current composer. Its layers come from a JSON file given as `?config=<url>`: `{"anatomyLayers": [{name, url, opacity}], "annotationLayers": [...]}` (`url` is a microdraw source, e.g. a `.json` with `tileSources`). The panel ("Composer", draggable by its title bar, resizable) lists the anatomy and annotation layers, each with an opacity box and slider; annotation layers are blended with `mix-blend-mode: screen`. Try it with [`composer.html?config=/examples/composer-example.json`](composer.html?config=/examples/composer-example.json), which stacks the test cat image twice. Without `?config` it shows an empty panel (and logs an error). |
| [`composer-0.html`](composer-0.html) | The first version of the composer: two hard-coded layers from BigBrain's macaque data (cell body stain and spectral labels, `bigbrain-ftp.loris.ca`), with editable name and URL fields, opacity, and `+`/`-` buttons to add or remove rows (rows added later get no viewer). |
| [`overlays.html`](overlays.html) | The first experiment, without Vue: the same two BigBrain macaque layers, with an opacity slider per layer (the first slider's `oninput` is not wired). |

## Libraries

`composer.html` and `composer-0.html` use **Vue 2.7.16** (`/lib/vue-2.7.16/vue.js`, development
build) and **Vue.Draggable 2.24.3** (`/lib/vuedraggable-2.24.3/vuedraggable.umd.min.js`), vendored
and checksummed in `app/public/lib/vendor.json` like microdraw's other third-party files. Before
M8b they loaded `cdn.jsdelivr.net/npm/vue/dist/vue.js` without a version, which happened to serve
Vue 2.7.16. The rest of microdraw uses Vue 3, built with webpack; these pages are Vue 2 code and
stay on Vue 2. Vue.Draggable is registered but its `<draggable>` markup is commented out, and it
would also need Sortable.js, which was never loaded.

## Needs the network

`composer-0.html` and `overlays.html` show images from `bigbrain-ftp.loris.ca`: they only work
where that host is reachable. Their viewers were at
`http://localhost:3000/data?…` before M8b; they now use `/data?…`, so they also work on other
hosts and ports.

## Tests

`test/e2e/examples.spec.js` is a smoke test: each page loads without errors in its own frame
and shows its control panel. It does not test the layers' images or the event passing. It runs
offline: requests to other hosts are aborted, and the viewers' requests for BigBrain data through
the server (`/getJson`) get a canned answer, so the tests never fetch `bigbrain-ftp.loris.ca`.
