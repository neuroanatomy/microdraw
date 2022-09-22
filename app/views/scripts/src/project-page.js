/* global projectInfo loggedUser */

import 'nwl-components/dist/style.css';
import ProjectPage from '../components/ProjectPage.vue';
import config from './nwl-components-config';
import { createApp } from 'vue';

var search = location.search.substring(1);
var result;
if(search !== "") {
  result = JSON.parse('{"' + search.replace(/[&]/g, '","').replace(/[=]/g, '":"') + '"}',
    function(key, value) { return key === "" ? value : decodeURIComponent(value); });

  for(let f=0; f<projectInfo.files.list.length; f++) {
    if(projectInfo.files.list[f].source === result.source) {
      break;
    }
  }
}

if(typeof result === 'undefined') {
  location.search = `source=${projectInfo.files.list[0].source}&project=${projectInfo.shortname}`;
}

const app = createApp(ProjectPage, { project: projectInfo, selectedFile: result.source });
app.provide('config', config);
app.provide('user', loggedUser);
app.provide('displaySettings', true);

app.mount('#app');
