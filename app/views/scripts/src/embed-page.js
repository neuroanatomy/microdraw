/* global projectInfo */

import 'nwl-components/dist/style.css';
import { createApp } from 'vue';

import Embed from '../components/Embed.vue';

import config from './nwl-components-config';

const params = new URL(document.location).searchParams;
const selectedFile = projectInfo.files.list.find((file) => file.source === params.get('source'));

if(!selectedFile) {
  location.search = `source=${projectInfo.files.list[0].source}&project=${projectInfo.shortname}`;
}

const app = createApp(Embed, { project: projectInfo, selectedFile: selectedFile.source });
app.provide('config', config);

app.mount('#app');
