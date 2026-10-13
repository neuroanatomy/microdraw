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
  - The cells are read only. The old page had editable inputs that were never
    saved; the project's files and layers are edited in its settings page.
  - Moving to another file reloads the page with ?source=<file>&project=<name>,
    as before; the viewer reads both from the URL.
*/
import { createApp } from 'vue';

// A project without a files or annotations list is shown as an empty one (M2b).
const listOf = (key) => ((projectInfo[key] && Array.isArray(projectInfo[key].list)) ? projectInfo[key].list : []);
const files = listOf('files');
const layers = listOf('annotations');
const { shortname } = projectInfo;
const textTypes = ['text', 'hidden text', 'multiple choices'];

const fileURL = (index) => `/project/${shortname}?source=${files[index].source}&project=${shortname}`;
const goToFile = (index) => { location.href = fileURL(index); };

// The file in the URL; without one, the first file is opened.
const source = new URLSearchParams(location.search).get('source');
const redirecting = files.length > 0 && source === null;
if (redirecting) {
  location.search = `source=${files[0].source}&project=${shortname}`;
}
const fileIndex = Math.max(0, files.findIndex((f) => f.source === source));

const ProjectTables = {
  template: `
    <div id="projectFiles" class="block" style="flex:1 1 auto">
      <table style="width:100%;text-align:left">
        <thead>
          <tr>
            <th>Name</th>
            <th>File</th>
            <th v-for="(a, i) in textAnnotations" :key="i">{{ a.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(f, i) in files" :key="i" :class="{selected: i === selectedFile}" @click="openFile(i)">
            <td :class="{empty: isEmpty(f.name)}">{{ f.name }}</td>
            <td :class="{empty: isEmpty(f.source)}">{{ f.source }}</td>
          </tr>
        </tbody>
      </table>
      <p id="noFiles" class="emptyState" v-if="files.length === 0">This project has no files yet. Add them in the <a :href="settingsURL">project settings</a>.</p>
    </div>
    <div id="annotations" class="block" style="flex:1 1 200px">
      <table id="vecAnnotations" style="width:100%;text-align:left">
        <thead>
          <tr>
            <th>Name</th>
            <th>Label Set</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(a, i) in layers" :key="i" :class="{selected: i === selectedLayer}" @click="selectedLayer = i">
            <td :class="{empty: isEmpty(a.name)}">{{ a.name }}</td>
            <td :class="{empty: isEmpty(a.values)}">{{ a.values }}</td>
          </tr>
        </tbody>
      </table>
      <p id="noAnnotations" class="emptyState" v-if="layers.length === 0">This project has no annotation layers.</p>
    </div>
  `,
  data() {
    return {
      files,
      layers,
      textAnnotations: layers.filter((a) => textTypes.includes(a.type)),
      selectedFile: (files.length > 0 && !redirecting) ? fileIndex : -1,
      selectedLayer: 0,
      settingsURL: `/project/${shortname}/settings`
    };
  },
  methods: {
    isEmpty: (value) => value === null || typeof value === 'undefined' || value === '',
    openFile(index) {
      if (index !== this.selectedFile) {
        goToFile(index);
      }
    }
  },
  mounted() {
    // the up and down arrows open the previous and next file, wrapping around
    window.addEventListener('keydown', (e) => {
      const { length } = this.files;
      if (this.selectedFile < 0 || length === 0) {
        return;
      }
      let index;
      if (e.keyCode === 38) { // up
        index = (this.selectedFile + length - 1) % length;
      } else if (e.keyCode === 40) { // down
        index = (this.selectedFile + 1) % length;
      } else {
        return;
      }
      if (index !== this.selectedFile) {
        goToFile(index);
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
