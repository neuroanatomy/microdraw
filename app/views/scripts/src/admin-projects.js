// Admin page, section "Projects that don't validate" (A2, decisions D29).
// The list and the fixes are the routes /admin/json/projects/*.
import { reactive, ref } from 'vue';

const PROBLEMS_SHOWN = 5;

const kindLabel = {
  blocking: 'cannot be saved',
  warning: 'warning',
  shortname: 'shortname',
  'missing user': 'missing user'
};

// Problems about the whole project first, then the rows (project `x` has
// over a hundred row warnings, which would hide the others)
const kindRank = { blocking: 0, shortname: 1, 'missing user': 2 };
const rank = (q) => {
  if (q.kind in kindRank) {
    return kindRank[q.kind];
  }

  return typeof q.list === 'string' ? 4 : 3;
};
const sortProblems = (problems) => problems.map((q, i) => ({ q, i }))
  .sort((a, b) => (rank(a.q) - rank(b.q)) || (a.i - b.i))
  .map(({ q }) => q);

const settingsLink = (p) => `/project/${encodeURIComponent(p.shortname)}/settings`;

const blankCount = (p) => p.blankRows.files + p.blankRows.collaborators + p.blankRows.annotations;

const describeBlank = (p) => ['files', 'collaborators', 'annotations']
  .filter((type) => p.blankRows[type] > 0)
  .map((type) => `${p.blankRows[type]} ${type}`)
  .join(', ');

const valuesText = (values) => (typeof values === 'string' ? values : JSON.stringify(values));

/**
 * State and actions of the section
 * @param {object} api { fetchJSON, postJSON }
 * @returns {object} What the template uses
 */
// eslint-disable-next-line max-statements
export const useInvalidProjects = ({ fetchJSON, postJSON }) => {
  const projects = ref([]);
  const summary = ref(null);
  const loading = ref(false);
  const error = ref('');
  const result = ref(null);
  // the names typed in the "Name unnamed layers" forms, by project and index
  const layerNames = reactive({});

  const load = async () => {
    loading.value = true;
    error.value = '';
    try {
      const body = await fetchJSON('/admin/json/projects/invalid');
      projects.value = body.list.map((p) => ({ ...p, problems: sortProblems(p.problems) }));
      summary.value = { total: body.total, refused: body.refused, invalid: body.list.length };
      for (const p of body.list) {
        layerNames[p.shortname] = Object.fromEntries(p.unnamedLayers.map((l) => [l.index, l.proposed]));
      }
    } catch (err) {
      error.value = err.message;
    }
    loading.value = false;
  };

  const act = async (fn) => {
    error.value = '';
    result.value = null;
    try {
      result.value = await fn();
    } catch (err) {
      error.value = err.message;
    }
    await load();
  };

  const removeBlankRows = (p) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove ${describeBlank(p)} blank row(s) from ${p.shortname}?\n\nThe previous version is kept: you can restore it.`)) {
      return;
    }

    return act(async () => {
      const { removed, log } = await postJSON('/admin/json/projects/remove-blank-rows', { project: p.shortname, version: p.version });
      const parts = Object.entries(removed).filter(([, n]) => n > 0)
        .map(([type, n]) => `${n} ${type}`);

      return { text: `Removed ${parts.join(', ')} blank row(s) from ${p.shortname}.`, shortname: p.shortname, restore: log };
    });
  };

  const nameLayers = (p) => act(async () => {
    const names = layerNames[p.shortname];
    const { named, log } = await postJSON('/admin/json/projects/name-layers', { project: p.shortname, version: p.version, names });

    return { text: `Named ${named} layer(s) of ${p.shortname}.`, shortname: p.shortname, restore: log };
  });

  const restore = (r) => act(async () => {
    await postJSON('/admin/json/projects/restore', { log: r.restore });

    return { text: `Restored the previous version of ${r.shortname}.` };
  });

  load();

  return {
    projects,
    projectsSummary: summary,
    projectsLoading: loading,
    projectsError: error,
    projectsResult: result,
    layerNames,
    loadProjects: load,
    removeBlankRows,
    nameLayers,
    restoreProject: restore,
    kindLabel,
    settingsLink,
    blankCount,
    valuesText,
    PROBLEMS_SHOWN
  };
};
