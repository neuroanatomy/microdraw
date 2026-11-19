/* globals userInfo, loggedUser */
import 'nwl-components/dist/style.css';
import { SortableTh, Tab, Table, Tabs, UserPage, localDate, shownName, useSortable } from 'nwl-components';
import { createApp, onMounted, ref } from 'vue';
import config from './nwl-components-config';

// The viewer's address for a source, in a project or none
const viewerURL = (source, project) => `/data?source=${encodeURIComponent(source)}${project ? `&project=${encodeURIComponent(project)}` : ''}`;

// A dataset opens in its project when exactly one is listed, else in none
const datasetURL = (dataset) => viewerURL(dataset.url, dataset.projects.length === 1 ? dataset.projects[0] : null);

// Rows per request: the routes answer at most that many
const PAGE = 100;

/**
 * Fetch every row of a user page route, PAGE at a time, until a page is
 * empty or short, pushing them into `rows` as they arrive
 * @param {string} route The route, e.g. /user/json/u/files
 * @param {string} key The answer's success key (`success` or `successful`)
 * @param {object} rows A ref to an array
 * @param {Function} map What each row becomes
 * @returns {Promise<void>} Resolves once all are there
 */
const fetchAll = async (route, key, rows, map = (row) => row) => {
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- one page after the other
    const res = await (await fetch(`${route}?start=${rows.value.length}&length=${PAGE}`)).json();
    if (!res[key] || !Array.isArray(res.list)) {
      return;
    }
    rows.value.push(...res.list.map(map));
    if (res.list.length < PAGE) {
      return;
    }
  }
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

    const datasets = ref([]);
    const datasetsLoaded = ref(false);
    const datasetSort = useSortable(datasets, {
      Name: { key: 'name' },
      Projects: { key: (dataset) => dataset.projects.join(', ') },
      Included: { key: 'included', type: 'date' }
    });

    const annotations = ref([]);
    const annotationsLoaded = ref(false);
    const annotationSort = useSortable(annotations, {
      Dataset: { key: 'name' },
      Project: { key: 'project' },
      Slices: { key: 'slices', type: 'number' },
      'Last modified': { key: 'modified', type: 'date' }
    });

    // The Datasets and Annotations tabs load at mount, page by page, as the
    // projects (Tabs shows one tab at a time and says nothing when another is
    // chosen). Their empty state shows once every page is there.
    onMounted(() => {
      const user = encodeURIComponent(userInfo.username);
      fetchAll(`/user/json/${user}/files`, 'success', datasets)
        .catch((err) => console.warn(`cannot load the user's datasets`, err))
        .finally(() => { datasetsLoaded.value = true; });
      fetchAll(`/user/json/${user}/atlas`, 'successful', annotations)
        .catch((err) => console.warn(`cannot load the user's annotations`, err))
        .finally(() => { annotationsLoaded.value = true; });
    });

    return {
      projects,
      sort,
      sortedRows: sort.sortedRows,
      datasets,
      datasetsLoaded,
      datasetSort,
      sortedDatasets: datasetSort.sortedRows,
      annotations,
      annotationsLoaded,
      annotationSort,
      sortedAnnotations: annotationSort.sortedRows,
      datasetURL,
      viewerURL,
      localDate,
      userInfo
    };
  },
  mounted() {
    // All the projects, PAGE at a time, until a page is empty or short.
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
