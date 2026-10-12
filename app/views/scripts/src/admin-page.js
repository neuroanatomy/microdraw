/* global loggedUser */
// Admin page (A1, A2). Same structure as BrainBox view/brainbox/src/pages/admin-page.js.
import 'nwl-components/dist/style.css';
import { Button, Footer, Header, Table, Wrapper } from 'nwl-components';
import { createApp, ref } from 'vue';
import config from './nwl-components-config';
import { useInvalidProjects } from './admin-projects';

const PAGE_SIZE = 50;

const fetchJSON = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let body;
  try {
    body = await res.json();
  } catch (err) {
    body = { success: false, error: `${res.status} ${res.statusText}` };
  }
  if (!res.ok || body.success === false) {
    throw new Error(body.error || body.msg || `${res.status} ${res.statusText}`);
  }

  return body;
};

const postJSON = (url, data) => fetchJSON(url, { method: 'POST', body: JSON.stringify(data) });

const formatDate = (date) => (date
  ? String(date).slice(0, 16)
    .replace('T', ' ')
  : '');

const keyOf = (g) => JSON.stringify([g.fileID, g.user, g.project]);

const groupOf = (g) => ({ fileID: g.fileID, user: g.user, project: g.project });

const viewerLink = (g) => `/data?source=${encodeURIComponent(g.source)}&slice=${encodeURIComponent(g.slice)}`;

const describe = (g) => `${g.regions} region(s) by ${g.user === null ? '(none)' : g.user} on ${g.source}, slice ${g.slice}`;

const targetOf = (a) => (a ? (a.target || a.other.trim()) : '');

const AdminPage = {
  template: '#template',
  // eslint-disable-next-line max-statements
  setup() {
    const list = ref([]);
    const total = ref(0);
    const skip = ref(0);
    const loading = ref(false);
    const loaded = ref(false);
    const error = ref('');
    const result = ref(null);
    const sourceFilter = ref(new URLSearchParams(window.location.search).get('source') || '');
    const assigning = ref(null);

    // eslint-disable-next-line max-statements
    const load = async () => {
      loading.value = true;
      error.value = '';
      try {
        const params = new URLSearchParams({ skip: skip.value, limit: PAGE_SIZE });
        if (sourceFilter.value.trim()) {
          params.set('source', sourceFilter.value.trim());
        }
        const body = await fetchJSON(`/admin/json/orphans?${params}`);
        list.value = body.list;
        total.value = body.total;
        if (skip.value > 0 && body.list.length === 0 && body.total > 0) {
          skip.value = Math.max(0, body.total - PAGE_SIZE);
          await load();
        }
      } catch (err) {
        error.value = err.message;
      }
      loading.value = false;
      loaded.value = true;
    };

    const search = () => {
      skip.value = 0;
      result.value = null;
      assigning.value = null;
      load();
    };

    const page = (direction) => {
      skip.value = Math.max(0, skip.value + direction * PAGE_SIZE);
      assigning.value = null;
      load();
    };

    const remove = async (g) => {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Delete ${describe(g)}?\n\nThey are marked as backups, not erased: you can undo this.`)) {
        return;
      }
      error.value = '';
      result.value = null;
      try {
        const { removed, log } = await postJSON('/admin/json/orphans/remove', groupOf(g));
        result.value = { text: `Deleted ${removed} region(s) by ${g.user} on ${g.source}, slice ${g.slice} (kept as backups).`, undo: log };
        assigning.value = null;
        await load();
      } catch (err) {
        error.value = err.message;
      }
    };

    const undo = async (log) => {
      error.value = '';
      try {
        const { restored } = await postJSON('/admin/json/orphans/restore', { log });
        result.value = { text: `Restored ${restored} region(s).` };
        await load();
      } catch (err) {
        error.value = err.message;
      }
    };

    // eslint-disable-next-line max-statements
    const toggleAssign = async (g) => {
      if (assigning.value && keyOf(assigning.value.group) === keyOf(g)) {
        assigning.value = null;

        return;
      }
      assigning.value = { group: g, loading: true, candidates: [], target: '', other: '', addImage: false };
      try {
        const params = new URLSearchParams({ fileID: g.fileID });
        if (g.user !== null) {
          params.set('user', g.user);
        }
        const { list: candidates } = await fetchJSON(`/admin/json/orphans/projects?${params}`);
        const target = candidates.length === 1 ? candidates[0].shortname : '';
        assigning.value = { ...assigning.value, loading: false, candidates, target };
      } catch (err) {
        error.value = err.message;
        assigning.value = null;
      }
    };

    // eslint-disable-next-line max-statements
    const assign = async () => {
      const a = assigning.value;
      const target = targetOf(a);
      const g = a.group;
      const candidate = a.candidates.find((p) => p.shortname === target);
      const addImage = !candidate && a.addImage;
      const existing = candidate && candidate.existing
        ? `\n\n${target} already has ${candidate.existing} region(s) on this image: both sets are kept.`
        : '';
      const adding = addImage ? `\n\nThe image is added to ${target}'s files.` : '';
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Assign ${describe(g)} to project ${target}?${existing}${adding}`)) {
        return;
      }
      error.value = '';
      result.value = null;
      try {
        const res = await postJSON('/admin/json/orphans/assign', { ...groupOf(g), target, addImage });
        let text = `Assigned ${res.assigned} region(s) to ${target}.`;
        if (res.addedImage) {
          text += ` The image was added to ${target}'s files.`;
        }
        if (res.existing) {
          text += ` ${target} already had ${res.existing} region(s) on this image: both are kept.`;
        }
        result.value = { text };
        assigning.value = null;
        await load();
      } catch (err) {
        error.value = err.message;
      }
    };

    load();

    return {
      list,
      total,
      skip,
      loading,
      loaded,
      error,
      result,
      sourceFilter,
      assigning,
      search,
      page,
      remove,
      undo,
      toggleAssign,
      assign,
      keyOf,
      viewerLink,
      formatDate,
      targetOf,
      ...useInvalidProjects({ fetchJSON, postJSON })
    };
  },
  compilerOptions: {
    delimiters: ['[[', ']]']
  }
};

const app = createApp(AdminPage);
app.component('Wrapper', Wrapper);
app.component('Header', Header);
app.component('Footer', Footer);
app.component('Table', Table);
app.component('Button', Button);
app.provide('config', config);
app.provide('user', loggedUser);
app.provide('displaySettings', false);
app.mount('#app');
