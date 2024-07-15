/* global projectInfo loggedUser */

import 'nwl-components/dist/style.css';
import { createApp } from 'vue';

import ProjectPage from '../components/ProjectPage.vue';

import config from './nwl-components-config';

const params = new URL(document.location).searchParams;
const selectedFile = projectInfo.files.list.find((file) => file.source === params.get('source'));

if(!selectedFile) {
  location.search = `source=${projectInfo.files.list[0].source}&project=${projectInfo.shortname}`;
}

const app = createApp(ProjectPage, { project: projectInfo});
app.provide('config', config);
app.provide('user', loggedUser);
app.provide('displaySettings', true);

app.mount('#app');
