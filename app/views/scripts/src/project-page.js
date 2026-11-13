/* eslint-disable max-lines */
/* global projectInfo, Microdraw */
/*
  The project page (/project/:name), M8a: the files and annotation tables, the
  resize handle and the embedded viewer. Until M8 this was an inline Vue 2 app
  loaded from the jsdelivr CDN.

  - The page shell (header, menu, login, title) is rendered by the server
    (project.mustache); Vue only renders the two tables, from templates in this
    file, so no server-rendered text is ever compiled as a Vue template.
  - `projectInfo` holds only what the visitor may see (M3c, visibleProjectParts),
    serialised with scriptJSON (H2b). Every user-set name is written as text
    ({{ }} interpolation, textContent): there is no v-html.
  - The name, file and layer cells are read only. The old page had editable
    inputs that were never saved; the project's files and layers are edited in
    its settings page. Only the text layers' values are edited here (step 4).
  - Text layers (step 3, 2026-11-09): each named text layer has a column in the
    files table. Its cells are there, empty, from the first render; after mount
    the page fetches GET /project/json/<shortname>/text-annotations and fills
    them with each file's current value, as text. A failed fetch leaves them
    empty, with a console warning. No fetch without a named text layer or a file.
  - Editing them (step 4, 2026-11-09): for a logged-in visitor (the login
    widget shows a Log Out link) whom GET /api/permissions?project=<shortname>
    allows to edit the annotations, each text cell is focusable; a click, or
    Enter/F2 on the focused cell, puts an <input> in it. Enter or leaving the
    input saves with POST /api/text-annotation, Escape cancels, an unchanged
    value sends nothing. A click on an editable cell does not open its row's
    file. While saving the cell has the `saving` class; a refused save keeps
    the typed text with the `error` class and the server's message as title.
    Everyone else keeps read-only cells. Only one cell is edited at a time.
  - Long cells are clipped on one line with an ellipsis (project-style.css), as
    the old inputs clipped them, and show their full text in a title, so the
    left pane can be made narrower than its longest text (2026-10-28).
  - Sorting (2026-11-10): both tables sort by a click on a column header, as
    the user page. Only nwl-components/sort is used (1.6.0: sortRows,
    nextSort, ariaSort, the SORT_ICON_* of SortableTh, and
    nwl-components/sort/style.css); SortHeader below has SortableTh's markup,
    so the headers look the same. Not nwl-components' main entry nor its
    dist/style.css, whose global rules would restyle this page. The files
    table sorts by Name, File and each named text layer (by the value its
    cell shows, values saved on this page included), the layers table by
    Name and Label Set. Strings compare with localeCompare, missing values
    come last both ways. Unsorted until a header is clicked: the project's
    order. A row is its file (or layer), not its position: a click opens that
    file, the open file's row stays highlighted wherever it is shown, and
    ArrowUp/ArrowDown open the previous/next row on screen, in the displayed
    order, wrapping around. While a text cell's input is open the rows keep
    their order; a save that changes the sort re-sorts when the input closes.
  - Moving to another file reloads the page with ?source=<file>&project=<name>,
    as before, both encoded with encodeURIComponent since N3; the viewer reads
    both from the URL (Microdraw.deparam decodes them).
*/
import 'nwl-components/sort/style.css';
import { SORT_ICON_ATTRS, SORT_ICON_PATHS, ariaSort, nextSort, sortRows } from 'nwl-components/sort';
import { createApp, markRaw } from 'vue';

// A project without a files or annotations list is shown as an empty one (M2b).
const listOf = (key) => ((projectInfo[key] && Array.isArray(projectInfo[key].list)) ? projectInfo[key].list : []);
const files = listOf('files');
const layers = listOf('annotations');
const { shortname } = projectInfo;
// Rows are the project's own objects, never reactive copies: a row is found by
// its file (or layer) wherever a sort puts it
files.forEach(markRaw);
layers.forEach(markRaw);
const textTypes = ['text', 'hidden text', 'multiple choices'];
// The layers table's columns (sortRows); the files table's are made in created
const LAYER_COLUMNS = { Name: { key: 'name' }, 'Label Set': { key: 'values' } };

// The source is encoded (N3): a source may hold `&`, `#`, `=` or spaces.
const fileQuery = (file) => `source=${encodeURIComponent(file.source)}&project=${encodeURIComponent(shortname)}`;
const fileURL = (file) => `/project/${shortname}?${fileQuery(file)}`;
const goToFile = (file) => { location.href = fileURL(file); };

// The login widget (project.mustache) shows a Log Out link to a logged-in user,
// as unsaved-stash.js reads it. The write route refuses logged-out visitors,
// even where 'anyone' may edit.
const loggedIn = () => Boolean(document.querySelector('#MyLogin a[href="/logout"]'));

// Values are one line, at most MAX_TEXT_LENGTH characters (the server checks too)
const MAX_TEXT_LENGTH = 10000;
const oneLine = (text) => String(text).replace(/\r\n|\r|\n/g, ' ');

// Key of a (source, layer) cell in the Maps below
const cellKey = (src, layer) => JSON.stringify([src, layer]);

// Typing in an input must not move to another file (step 4)
const isTextEntry = (el) => Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));

// The file in the URL; without one, the first file is opened.
const source = new URLSearchParams(location.search).get('source');
const redirecting = files.length > 0 && source === null;
if (redirecting) {
  location.search = fileQuery(files[0]);
}
const fileIndex = Math.max(0, files.findIndex((f) => f.source === source));
// The open file, as an object: rows are known by their file, not their position
const openFileRow = (files.length > 0 && !redirecting) ? files[fileIndex] : null;

// Keys of the values come from user data (sources, layer names): read own
// properties only, so a source named `constructor` finds nothing (null).
const own = (obj, key) => ((obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key)) ? obj[key] : null);

// { <source>: { <layer>: {value, user, modified} } }, or null when the fetch fails
const fetchTextValues = async () => {
  try {
    const res = await fetch(`/project/json/${encodeURIComponent(shortname)}/text-annotations`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json === null || typeof json !== 'object') {
      throw new Error('not an object');
    }

    return json;
  } catch (err) {
    console.warn('Could not load the values of the text layers:', err.message);

    return null;
  }
};

// Whether the visitor may edit the project's annotations: false when the
// answer is not a clear yes
const fetchCanEdit = async () => {
  try {
    const res = await fetch(`/api/permissions?project=${encodeURIComponent(shortname)}`, { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();

    return Boolean(json && json.annotations && json.annotations.edit === true);
  } catch (err) {
    console.warn('Could not load the permissions, text layers are read only:', err.message);

    return false;
  }
};

const parseJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
};

// Save a value: {value, user, modified}, or throws an Error with the server's message
const postTextValue = async (body) => {
  const res = await fetch('/api/text-annotation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  const text = await res.text();
  const json = parseJSON(text);
  if (!res.ok) {
    throw new Error((json && typeof json.error === 'string') ? json.error : (text || `HTTP ${res.status}`));
  }
  if (json === null || typeof json.value !== 'string') {
    throw new Error('Unexpected answer from the server');
  }

  return json;
};

// Numbers the saves, so that only the latest save of a cell sets its state
let saveCount = 0;
const nextAttempt = () => {
  saveCount += 1;

  return saveCount;
};

// A sortable header, with SortableTh's markup: `sort` is a table's
// {column, ascending}; a click (or Enter/Space on its button) emits `sort`
const SortHeader = {
  props: {
    sort: { type: Object, required: true },
    column: { type: String, required: true }
  },
  emits: ['sort'],
  data: () => ({ iconAttrs: SORT_ICON_ATTRS }),
  computed: {
    direction() {
      if (this.sort.column !== this.column) {
        return 'none';
      }

      return ariaSort(this.sort.ascending ? 'ascending' : 'descending');
    },
    paths() {
      return SORT_ICON_PATHS[this.direction];
    }
  },
  template: `
    <th class="nwl-sortable" :aria-sort="direction">
      <button type="button" class="nwl-sort-button" @click="$emit('sort', column)">
        <span class="nwl-sort-label"><slot>{{ column }}</slot></span>
        <svg v-bind="iconAttrs" :data-state="direction"><path v-for="d in paths" :key="d" :d="d"></path></svg>
      </button>
    </th>
  `
};

const ProjectTables = {
  components: { SortHeader },
  template: `
    <div id="projectFiles" class="block" style="flex:1 1 auto">
      <table style="width:100%;text-align:left">
        <thead>
          <tr>
            <SortHeader :sort="fileSort" column="Name" @sort="sortFiles" />
            <SortHeader :sort="fileSort" column="File" @sort="sortFiles" />
            <SortHeader v-for="(a, i) in textAnnotations" :key="i" :sort="fileSort" :column="textColumn(i)" :title="a.name" @sort="sortFiles">{{ a.name }}</SortHeader>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in shownFiles" :key="rowKey.get(f)" :class="{selected: f === selectedFile}" :aria-selected="String(f === selectedFile)" @click="openFile(f)">
            <td :class="{empty: isEmpty(f.name)}" :title="f.name">{{ f.name }}</td>
            <td :class="{empty: isEmpty(f.source)}" :title="f.source">{{ f.source }}</td>
            <td v-for="(a, j) in textAnnotations" :key="'t' + j"
              :class="textCellClass(f, a)" :title="textTitle(f, a)"
              :tabindex="canEdit ? 0 : null" :aria-label="canEdit ? editLabel(f, a) : null"
              @click="textCellClick($event, f, a)" @keydown="textCellKeydown($event, f, a)"><input v-if="isEditing(f, a)"
                type="text" :maxlength="maxLength" :value="draft" :aria-label="editLabel(f, a)"
                @input="draft = $event.target.value" @paste="pasteOneLine"
                @keydown="inputKeydown" @blur="commitEdit"
              /><template v-else>{{ textShown(f, a) }}</template></td>
          </tr>
        </tbody>
      </table>
      <p id="noFiles" class="emptyState" v-if="files.length === 0">This project has no files yet. Add them in the <a :href="settingsURL">project settings</a>.</p>
    </div>
    <div id="annotations" class="block" style="flex:1 1 200px">
      <table id="vecAnnotations" style="width:100%;text-align:left">
        <thead>
          <tr>
            <SortHeader :sort="layerSort" column="Name" @sort="sortLayers" />
            <SortHeader :sort="layerSort" column="Label Set" @sort="sortLayers" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in sortedLayers" :key="rowKey.get(a)" :class="{selected: a === selectedLayer}" :aria-selected="String(a === selectedLayer)" @click="selectedLayer = a">
            <td :class="{empty: isEmpty(a.name)}" :title="a.name">{{ a.name }}</td>
            <td :class="{empty: isEmpty(a.values)}" :title="a.values">{{ a.values }}</td>
          </tr>
        </tbody>
      </table>
      <p id="noAnnotations" class="emptyState" v-if="layers.length === 0">This project has no annotation layers.</p>
    </div>
  `,
  data() {
    return {
      files: markRaw(files),
      layers: markRaw(layers),
      // v-for keys: each row's position in the project
      rowKey: markRaw(new Map([...files.map((f, i) => [f, i]), ...layers.map((a, i) => [a, i])])),
      // the two tables' sort ({column, ascending}; unsorted until a header is
      // clicked: the project's order), the files table's columns (created)
      // and, while a text cell is edited, its order when the edit started
      fileSort: { column: null, ascending: true },
      layerSort: { column: null, ascending: true },
      fileColumns: null,
      frozenFiles: null,
      // an unnamed text layer gets no column (2026-11-09): 18 projects on
      // production have one, probably left by the new-project form
      textAnnotations: layers.filter((a) => textTypes.includes(a.type) && String(a.name || '').trim() !== ''),
      // the text layers' values, filled after mount
      textValues: {},
      // step 4: whether the visitor may edit them, the cell being edited
      // ({source, layer, cell}) and its input's text, the values saved from
      // this page (cellKey => {value, user, modified}) and the cells being
      // saved or refused (cellKey => {status: 'saving'|'error', text, error})
      canEdit: false,
      maxLength: MAX_TEXT_LENGTH,
      editing: null,
      draft: '',
      saved: new Map(),
      pending: new Map(),
      selectedFile: openFileRow,
      selectedLayer: layers.length > 0 ? layers[0] : null,
      settingsURL: `/project/${shortname}/settings`
    };
  },
  computed: {
    // the files in the order shown
    shownFiles() {
      return this.frozenFiles || this.sortedFiles;
    },
    sortedFiles() {
      return sortRows(this.files, this.fileColumns[this.fileSort.column], this.fileSort.ascending);
    },
    sortedLayers() {
      return sortRows(this.layers, LAYER_COLUMNS[this.layerSort.column], this.layerSort.ascending);
    }
  },
  created() {
    const fileColumns = { Name: { key: 'name' }, File: { key: 'source' } };
    this.textAnnotations.forEach((a, i) => {
      fileColumns[this.textColumn(i)] = { key: (f) => this.textShown(f, a) };
    });
    this.fileColumns = markRaw(fileColumns);
  },
  methods: {
    sortFiles(column) {
      this.fileSort = nextSort(this.fileSort, column);
    },
    sortLayers(column) {
      this.layerSort = nextSort(this.layerSort, column);
    },
    // a text layer's column in fileSort: by position, as two layers may share a name
    textColumn: (i) => `text ${i}`,
    isEmpty: (value) => value === null || typeof value === 'undefined' || value === '',
    // a file's current value for a text layer, as a string, or null
    textValue(file, layer) {
      const value = own(own(own(this.textValues, file.source), layer.name), 'value');

      return (typeof value === 'string') ? value : null;
    },
    // the stored value: the one saved from this page, else the fetched one
    storedValue(file, layer) {
      const saved = this.saved.get(cellKey(file.source, layer.name));

      return saved ? saved.value : this.textValue(file, layer);
    },
    // what the cell shows: the text being saved or refused, else the stored value
    textShown(file, layer) {
      const pending = this.pending.get(cellKey(file.source, layer.name));

      return pending ? pending.text : this.storedValue(file, layer);
    },
    textTitle(file, layer) {
      const pending = this.pending.get(cellKey(file.source, layer.name));
      if (pending && pending.status === 'error') {
        return `Not saved: ${pending.error}`;
      }
      const shown = this.textShown(file, layer);

      return this.isEmpty(shown) ? null : shown;
    },
    textCellClass(file, layer) {
      const pending = this.pending.get(cellKey(file.source, layer.name));
      const editing = this.isEditing(file, layer);

      return {
        empty: !editing && this.isEmpty(this.textShown(file, layer)),
        editable: this.canEdit,
        editing,
        saving: Boolean(pending && pending.status === 'saving'),
        error: Boolean(pending && pending.status === 'error')
      };
    },
    editLabel: (file, layer) => `Edit ${layer.name} for ${file.name || file.source}`,
    isEditing(file, layer) {
      return this.editing !== null && this.editing.source === file.source && this.editing.layer === layer.name;
    },
    // A click on an editable cell edits it and does not open the row's file;
    // a read-only cell lets the click reach the row
    textCellClick(e, file, layer) {
      if (!this.canEdit) {
        return;
      }
      e.stopPropagation();
      this.startEdit(e.currentTarget, file, layer);
    },
    textCellKeydown(e, file, layer) {
      if (!this.canEdit || e.target !== e.currentTarget) {
        return;
      }
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        this.startEdit(e.currentTarget, file, layer);
      }
    },
    async startEdit(cell, file, layer) {
      if (this.isEditing(file, layer)) {
        return;
      }
      // one cell at a time: the open one is saved first
      this.commitEdit();
      this.openEdit(cell, file, layer);
      this.draft = this.textShown(file, layer) || '';
      await this.$nextTick();
      const input = cell.querySelector('input');
      if (input) {
        input.focus();
        input.select();
      }
    },
    // Open the input; the rows keep their order while it is open
    openEdit(cell, file, layer) {
      this.frozenFiles = this.sortedFiles.slice();
      this.editing = { source: file.source, layer: layer.name, cell };
    },
    // A pasted newline becomes a space; maxlength still holds
    pasteOneLine(e) {
      const text = e.clipboardData && e.clipboardData.getData('text');
      if (typeof text !== 'string') {
        return;
      }
      e.preventDefault();
      const input = e.target;
      const { selectionStart: start, selectionEnd: end } = input;
      const room = Math.max(0, this.maxLength - (input.value.length - (end - start)));
      input.setRangeText(oneLine(text).slice(0, room), start, end, 'end');
      this.draft = input.value;
    },
    inputKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitEdit({ refocus: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelEdit();
      }
    },
    // Close the input; with refocus, give the focus back to its cell
    closeEdit(refocus) {
      const { cell } = this.editing;
      this.editing = null;
      this.frozenFiles = null;
      if (refocus && cell.isConnected) {
        cell.focus();
      }
    },
    cancelEdit() {
      if (this.editing !== null) {
        this.closeEdit(true);
      }
    },
    // Save the open cell, if its value changed. Called on Enter and on blur
    // (and the blur that follows Enter or Escape finds nothing open).
    commitEdit({ refocus = false } = {}) {
      if (this.editing === null) {
        return;
      }
      const { source: src, layer } = this.editing;
      const value = oneLine(this.draft).slice(0, this.maxLength);
      this.closeEdit(refocus);
      if (value === (this.storedValue({ source: src }, { name: layer }) || '')) {
        // unchanged: nothing sent, a refused text is dropped
        this.pending.delete(cellKey(src, layer));

        return;
      }
      this.saveValue(src, layer, value);
    },
    async saveValue(src, layer, value) {
      const key = cellKey(src, layer);
      // the Map hands back a reactive proxy: the attempt is known by its number
      const attempt = nextAttempt();
      this.pending.set(key, { status: 'saving', text: value, attempt });
      let error = null;
      try {
        this.saved.set(key, await postTextValue({ project: shortname, source: src, layer, value }));
      } catch (err) {
        error = err.message;
      }
      this.settleSave(key, attempt, value, error);
    },
    // The cell's state after a save: plain when saved, the typed text with the
    // error when refused. A later save of the same cell owns its state.
    settleSave(key, attempt, value, error) {
      if ((this.pending.get(key) || {}).attempt !== attempt) {
        return;
      }
      if (error === null) {
        this.pending.delete(key);
      } else {
        this.pending.set(key, { status: 'error', text: value, error });
      }
    },

    async loadCanEdit() {
      this.canEdit = await fetchCanEdit();
    },
    async loadTextValues() {
      const values = await fetchTextValues();
      if (values !== null) {
        this.textValues = values;
      }
    },
    // The row `step` (-1 or 1) rows from the open file's, on screen, wrapping
    // around; null without a step or an open file
    nextFile(step) {
      const rows = this.shownFiles;
      const position = rows.indexOf(this.selectedFile);
      if (position < 0 || typeof step === 'undefined') {
        return null;
      }

      return rows[(position + step + rows.length) % rows.length];
    },
    openFile(file) {
      if (file !== this.selectedFile) {
        goToFile(file);
      }
    }
  },
  mounted() {
    if (this.textAnnotations.length > 0 && this.files.length > 0 && !redirecting) {
      this.loadTextValues();
      if (loggedIn()) {
        this.loadCanEdit();
      }
    }
    // the up and down arrows open the previous and next row on screen (the
    // displayed order, sorted or not), wrapping around
    window.addEventListener('keydown', (e) => {
      // not while typing in an input (a text layer's value, step 4)
      if (isTextEntry(e.target)) {
        return;
      }
      const next = this.nextFile({ 38: -1, 40: 1 }[e.keyCode]); // up, down
      if (next !== null && next !== this.selectedFile) {
        goToFile(next);
      }
    });
  }
};

createApp(ProjectTables).mount('#projectTables');

// Menu
document.querySelector('#addProject').onclick = () => { location = '/project/new'; };
document.querySelector('#settings').onclick = () => {
  const { pathname } = location;
  location = (pathname.slice(-1) === '/') ? `${pathname}settings` : `${pathname}/settings`;
};

// The handle between the tables and the viewer changes the tables' width. The
// first move after the press only records where the drag starts.
const left = document.querySelector('#left');
const resizeButton = document.querySelector('#resizeButton');
let resize = { flag: -1, x0: 0 };
const pageX = (e) => ((e.type === 'touchmove') ? e.changedTouches[0].pageX : e.pageX);
const resizeStart = () => { resize = { flag: 0, x0: 0 }; };
const resizeMove = (e) => {
  if (resize.flag === 0) {
    resize = { flag: 1, x0: pageX(e) };
  } else if (resize.flag === 1) {
    const x = pageX(e);
    left.style.flexBasis = `${left.clientWidth - (resize.x0 - x)}px`;
    resize = { flag: 1, x0: x };
    if (window.Microdraw && typeof Microdraw.resizeAnnotationOverlay === 'function') {
      Microdraw.resizeAnnotationOverlay();
    }
  }
};
const resizeEnd = () => { resize = { flag: -1, x0: 0 }; };
resizeButton.addEventListener('mousedown', resizeStart);
resizeButton.addEventListener('touchstart', resizeStart);
document.body.addEventListener('mousemove', resizeMove);
document.body.addEventListener('touchmove', resizeMove);
document.body.addEventListener('mouseup', resizeEnd);
document.body.addEventListener('touchend', resizeEnd);

// The viewer, in a shadow root, as on /data. Only when there is a file to show.
const loadScript = (path) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = path;
  s.onload = resolve;
  s.onerror = reject;
  document.body.appendChild(s);
});
const attachViewer = async () => {
  const res = await fetch('/microdraw');
  const txt = await res.text();
  const elem = new DOMParser().parseFromString(txt, 'text/html').documentElement;
  const shadow = document.querySelector('#microdraw').attachShadow({ mode: 'open' });
  shadow.appendChild(elem);
  await loadScript('/js/microdraw.js');
  Microdraw.init(shadow);
};
if (files.length > 0 && !redirecting) {
  attachViewer();
}
