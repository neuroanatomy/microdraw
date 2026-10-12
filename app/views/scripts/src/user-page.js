/* globals userInfo, loggedUser */
import 'nwl-components/dist/style.css';
import { Tab, Table, Tabs, UserPage } from 'nwl-components';
import { createApp, ref } from 'vue';
import config from './nwl-components-config';

const PageContents = {
  template: '#template',
  setup() {
    const projects = ref([]);

    return {
      projects,
      userInfo
    };
  },
  mounted() {
    const fetchProjects = async () => {
      const res = await (await fetch(`/user/json/${userInfo.username}/projects?start=${this.projects.length}&length=100`)).json();
      if (res.successful & (res.list.length > 0)) {
        this.projects.push(...res.list);
      }
    };

    // The Datasets and Atlas tabs (and their fetches) come back with stage 3.
    fetchProjects();
  },
  compilerOptions: {
    delimiters: ['[[', ']]']
  }
};
const app = createApp(PageContents);
app.component('UserPage', UserPage);
app.component('Tabs', Tabs);
app.component('Tab', Tab);
app.component('Table', Table);
app.provide('config', config);
app.provide('user', loggedUser);

app.mount('#app');
