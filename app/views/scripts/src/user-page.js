/* globals userInfo, loggedUser */
import 'nwl-components/dist/style.css';
import { SortableTh, Tab, Table, Tabs, UserPage, useSortable } from 'nwl-components';
import { createApp, ref } from 'vue';
import config from './nwl-components-config';

const pad = (n) => String(n).padStart(2, '0');

// An ISO date as a local YYYY-MM-DD (dateTime: YYYY-MM-DD HH:MM:SS), '' when
// missing or not a date
const localDate = (iso, dateTime = false) => {
  const d = new Date(iso);
  if (!iso || isNaN(d)) {
    return '';
  }
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return dateTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : date;
};

// What the Name column shows, and sorts by: the project's display name, or its
// short name when the display name is missing or empty
const shownName = (project) => {
  const name = typeof project.name === 'string' ? project.name.trim() : '';

  return name === '' ? project.shortname : project.name;
};

const PageContents = {
  template: '#template',
  setup() {
    const projects = ref([]);
    // unsorted until a header is clicked: the server's order
    const sort = useSortable(projects, {
      Name: { key: 'shownName' },
      Files: { key: 'numFiles', type: 'number' },
      Collaborators: { key: 'numCollaborators', type: 'number' },
      Owner: { key: 'owner' },
      'Last modified': { key: 'modified', type: 'date' }
    });

    return {
      projects,
      sort,
      sortedRows: sort.sortedRows,
      localDate,
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
        this.projects.push(...res.list.map((project) => ({ ...project, shownName: shownName(project) })));
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
