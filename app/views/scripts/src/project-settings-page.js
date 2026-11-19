/* global project, filesTotal, loggedUser */

import 'nwl-components/dist/style.css';
import { SettingsPage, defaultFetchLabelSets, useBatchedFiles } from 'nwl-components';
import config from './nwl-components-config';
import { createApp } from 'vue';

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

// The label sets of the menu of a vectorial layer: those of /api/getLabelsets,
// then each `values` stored in a vectorial layer that is not one of them (as
// 'Set 1', from before T002 3.2), named as stored. nwl-components' layer row
// is a <select> bound to `values`: without an option for it, a stored value
// shows as an empty menu (it is still saved unchanged). If the list cannot be
// fetched, only the stored values are offered.
const fetchedLabelSets = async (fetchLabelSets) => {
  try {
    const answer = await fetchLabelSets();

    return Array.isArray(answer) ? answer : [];
  } catch (err) {
    console.error('cannot fetch the label sets', err);

    return [];
  }
};
const withStoredLabelSets = async (fetchLabelSets, p) => {
  const sets = await fetchedLabelSets(fetchLabelSets);
  const layers = (p && p.annotations && Array.isArray(p.annotations.list)) ? p.annotations.list : [];
  const stored = layers
    .filter((a) => a && a.type === 'vectorial' && typeof a.values === 'string' && a.values !== '')
    .map((a) => a.values);
  for (const values of new Set(stored)) {
    if (!sets.some((s) => s.source === values)) {
      sets.push({ name: values, source: values });
    }
  }

  return sets;
};

// The project as SettingsPage reads it: the server sends it without its files,
// which nwl-components' useBatchedFiles loads in batches from
// /project/json/:p/files (T002 3.1). filesLoaded, the number of files received,
// is sent to the server when saving: if it is not the number of files stored,
// the server keeps the stored list instead of the partial one. SettingsPage
// keeps a shallow copy of the project, which shares this object, so the count
// it sends is always the current one
const projectWithLists = withLists(project);
const { files, filesLoaded, loadFiles } = useBatchedFiles({ shortname: project.shortname, filesTotal });
projectWithLists.filesLoaded = filesLoaded;

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
app.provide('config', { ...config, fetchLabelSets: () => withStoredLabelSets(defaultFetchLabelSets, project) });
app.provide('user', loggedUser);

app.mount('#app');
