/* global project, loggedUser */

import 'nwl-components/dist/style.css';
import { SettingsPage } from 'nwl-components';
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

// The files are inline in the project (microdraw has no batched
// /project/json/:p/files route yet), so SettingsPage's `files` prop, which
// BrainBox uses to load them in batches, stays unset: SettingsPage then shows
// project.files.list.
const PageContents = {
  template: `
    <SettingsPage :project="project" />
  `,
  setup() {
    return {
      project: withLists(project)
    };
  }
};

const app = createApp(PageContents);
app.component('SettingsPage', SettingsPage);
app.provide('config', config);
app.provide('user', loggedUser);

app.mount('#app');
