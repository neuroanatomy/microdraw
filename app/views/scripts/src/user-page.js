/* globals userInfo, loggedUser */
import 'nwl-components/dist/style.css';
import { SortableTh, Tab, Table, Tabs, UserPage, useSortable } from 'nwl-components';
import { createApp, ref } from 'vue';
import config from './nwl-components-config';

const PageContents = {
  template: '#template',
  setup() {
    const projects = ref([]);
    // unsorted until a header is clicked: the server's order
    const sort = useSortable(projects, {
      Name: { key: 'name' },
      Files: { key: 'numFiles', type: 'number' },
      Collaborators: { key: 'numCollaborators', type: 'number' },
      Owner: { key: 'owner' },
      'Last modified': { key: 'modified', type: 'date' }
    });

    return {
      projects,
      sort,
      sortedRows: sort.sortedRows,
      userInfo
    };
  },
  mounted() {
    // All the projects, PAGE at a time, until a page is empty or short.
    const PAGE = 100;
    const fetchProjects = async () => {
      const start = this.projects.length;
      const res = await (await fetch(`/user/json/${userInfo.username}/projects?start=${start}&length=${PAGE}`)).json();
      if (res.successful && res.list.length > 0) {
        this.projects.push(...res.list);
      }
      if (res.successful && res.list.length === PAGE) {
        await fetchProjects();
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
app.component('SortableTh', SortableTh);
app.provide('config', config);
app.provide('user', loggedUser);

app.mount('#app');
