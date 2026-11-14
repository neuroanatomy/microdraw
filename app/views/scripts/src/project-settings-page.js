/* global project, filesTotal, loggedUser */

import 'nwl-components/dist/style.css';
import { createApp, ref } from 'vue';
import { SettingsPage } from 'nwl-components';
import config from './nwl-components-config';

// nwl-components 1.3.x reads files.list, collaborators.list and annotations.list
// without checking them (ProjectService.transformProjectFiles crashes when
// files.list is missing), so always hand it the three lists and a name.
const withLists = (p) => {
  const listOf = (key) => ({ ...(p[key] || {}), list: Array.isArray(p[key] && p[key].list) ? p[key].list : [] });

  return {
    ...p,
    name: typeof p.name === 'string' ? p.name : '',
    files: listOf('files'),
    collaborators: listOf('collaborators'),
    annotations: listOf('annotations')
  };
};

// The files are loaded in batches from /project/json/:p/files, as BrainBox's
// settings page does (T002 3.1; copied from BrainBox's
// view/brainbox/src/pages/project-settings-page.js, same names and constants)
const BATCH_LENGTH = 100;
const RETRY_DELAYS = [500, 1000]; // ms before trying a failed batch again

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Fetch a batch of the project's files (only their source and name),
 * trying again after each of the RETRY_DELAYS if the request fails.
 * @param {number} start Index of the first file
 * @param {number} attempt Number of attempts already made
 * @returns {Promise<Array>} The files
 */
// eslint-disable-next-line max-statements -- as BrainBox's, for the stage 4 merge
const fetchBatch = async (start, attempt = 0) => {
  try {
    const res = await fetch(`/project/json/${encodeURIComponent(project.shortname)}/files?start=${start}&length=${BATCH_LENGTH}&names=true`);
    if (!res.ok) {
      throw new Error(`the server answered with status ${res.status}`);
    }
    const list = await res.json();
    if (!Array.isArray(list)) {
      throw new Error('the server did not send a list of files');
    }

    return list;
  } catch (err) {
    if (attempt >= RETRY_DELAYS.length) {
      throw err;
    }
    await delay(RETRY_DELAYS[attempt]);

    return fetchBatch(start, attempt + 1);
  }
};

// The files received so far. SettingsPage watches this array, and shows each
// file as soon as it is added to it
const files = ref([]);

// The project as SettingsPage reads it: the server sends it without its files
const projectWithLists = withLists(project);

// The number of files received, sent to the server when saving: if it is not
// the number of files stored, the server keeps the stored list instead of the
// partial one. SettingsPage keeps a shallow copy of the project, which shares
// this object, so the count it sends is always the current one
const filesLoaded = { count: 0 };
projectWithLists.filesLoaded = filesLoaded;

let loading = false;

/**
 * The section of the page with the files, which also holds the "Files" heading: the
 * parent of the files table's wrapper (nwl-components' Table wraps its table in a
 * div.nwl-resize-wrap since 3.1.0), or of the table itself
 * @returns {HTMLElement|null} The section
 */
const filesSection = () => {
  const table = document.getElementById('files');
  if (!table) { return null; }

  return (table.closest('.nwl-resize-wrap') || table).parentElement;
};

/**
 * Write the loading progress, or an error with a Retry button, in the status
 * shown after the "Files" heading
 * @param {HTMLElement} span The status
 * @param {Object} status {received, total} while loading, {error} if a batch failed
 * @param {Function} retry Called by the Retry button
 * @returns {void}
 */
const writeFilesStatus = (span, status, retry) => {
  if (status.error) {
    span.textContent = ` (could not load all the files: ${status.error}) `;
    const button = document.createElement('button');
    button.textContent = 'Retry';
    button.addEventListener('click', retry);
    span.appendChild(button);
  } else {
    span.textContent = ` (loading… ${status.received} / ${status.total})`;
  }
};

/**
 * Show the loading status after the "Files" heading, and keep the files from
 * being edited until they are all loaded
 * @param {Object} status {received, total} while loading, {error} if a batch failed, null when done
 * @param {Function} retry Called by the Retry button
 * @returns {void}
 */
// eslint-disable-next-line max-statements -- as BrainBox's, for the stage 4 merge
const showFilesStatus = (status, retry) => {
  const section = filesSection();
  const heading = section && section.querySelector('h2');
  if (!heading) { return; }
  const span = heading.querySelector('.filesStatus');
  if (!status) {
    if (span) { span.remove(); }
    section.classList.remove('filesLoading');

    return;
  }
  section.classList.add('filesLoading');
  writeFilesStatus(span || heading.appendChild(Object.assign(document.createElement('span'), { className: 'filesStatus' })), status, retry);
};

/**
 * Fetch the batches of files from the last one received, until a batch is not
 * full, adding each to the list shown as soon as it arrives
 * @returns {Promise<void>} Resolves once all the files have been received
 */
const fetchRemainingFiles = async () => {
  let list;
  do {
    showFilesStatus({ received: files.value.length, total: Math.max(filesTotal, files.value.length) });
    // eslint-disable-next-line no-await-in-loop
    list = await fetchBatch(files.value.length);
    files.value.push(...list);
    filesLoaded.count = files.value.length;
  } while (list.length === BATCH_LENGTH);
};

/**
 * Load the project's files, from the last one received
 * @returns {Promise<void>} Resolves once the files are loaded, or failed to load
 */
const loadFiles = async () => {
  if (loading) { return; }
  loading = true;
  try {
    // a new project, or one without files, has nothing to fetch
    if (filesTotal > 0) {
      await fetchRemainingFiles();
    }
    showFilesStatus(null);
  } catch (err) {
    showFilesStatus({ error: err.message }, loadFiles);
  } finally {
    loading = false;
  }
};

const PageContents = {
  template: `
    <SettingsPage :project="project" :files="files" />
  `,
  setup() {
    return {
      project: projectWithLists,
      files
    };
  },
  mounted() {
    loadFiles();
  }
};

const app = createApp(PageContents);
app.component('SettingsPage', SettingsPage);
app.provide('config', config);
app.provide('user', loggedUser);

app.mount('#app');
