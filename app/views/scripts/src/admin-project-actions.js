// Admin page, "Projects" tool (A3, decisions D31): search a project by
// shortname or name, delete it (its annotations become backups) or give it
// to another user, and restore either. The actions are also offered on each
// project of "Projects that don't validate" (A2), through the same component.
// Routes: /admin/json/projects/{search,delete,restore-deleted,transfer,restore}.
import { inject, ref } from 'vue';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const countsText = (c) => [
  plural(c.files, 'file'),
  plural(c.collaborators, 'collaborator'),
  plural(c.layers, 'annotation layer'),
  plural(c.annotations, 'annotation')
].join(', ');

const describe = (p) => (p.name ? `${p.shortname} (${p.name})` : p.shortname);

/**
 * State and actions of the tool, shared by the search results and the list
 * of projects that don't validate (`where` tells where to show the result)
 * @param {object} api { fetchJSON, postJSON, reloadInvalid }
 * @returns {object} What the template and the ProjectActions component use
 */
// eslint-disable-next-line max-statements
export const useProjectActions = ({ fetchJSON, postJSON, reloadInvalid }) => {
  const query = ref('');
  const searched = ref('');
  const found = ref([]);
  const more = ref(false);
  const searching = ref(false);
  const error = ref('');
  const result = ref(null);

  const load = async () => {
    if (!searched.value) {
      return;
    }
    searching.value = true;
    try {
      const body = await fetchJSON(`/admin/json/projects/search?${new URLSearchParams({ q: searched.value })}`);
      found.value = body.list;
      more.value = body.more;
    } catch (err) {
      error.value = err.message;
    }
    searching.value = false;
  };

  const search = () => {
    error.value = '';
    result.value = null;
    searched.value = query.value.trim();
    if (!searched.value) {
      found.value = [];

      return;
    }

    return load();
  };

  // run an action; show its result (or error) in the section `where`, and
  // reload both lists
  const act = async (where, fn) => {
    error.value = '';
    result.value = null;
    try {
      result.value = { where, ...(await fn()) };
    } catch (err) {
      result.value = { where, error: err.message };
    }
    await Promise.all([load(), reloadInvalid()]);
  };

  const deleteProject = (p, where) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete project ${describe(p)}?\n\nIts annotations become backups: nothing is erased. The project is kept in the log, and you can restore it with its annotations.`)) {
      return;
    }

    return act(where, async () => {
      const { annotations, log } = await postJSON('/admin/json/projects/delete', { project: p.shortname, version: p.version });

      return { text: `Deleted ${p.shortname}; its ${plural(annotations, 'annotation')} are now backups.`, restoreDeleted: log };
    });
  };

  const transfer = (p, owner, where) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Give project ${describe(p)} to ${owner}?\n\n${owner} becomes its owner, with every right; ${p.owner} loses the owner's rights. You can restore the previous owner.`)) {
      return;
    }

    return act(where, async () => {
      const { log } = await postJSON('/admin/json/projects/transfer', { project: p.shortname, version: p.version, owner });

      return { text: `${p.shortname} now belongs to ${owner} (was ${p.owner}).`, restore: log };
    });
  };

  const restore = (r) => act(r.where, async () => {
    if (r.restoreDeleted) {
      const { shortname, annotations } = await postJSON('/admin/json/projects/restore-deleted', { log: r.restoreDeleted });

      return { text: `Restored ${shortname} and its ${plural(annotations, 'annotation')}.` };
    }
    await postJSON('/admin/json/projects/restore', { log: r.restore });

    return { text: 'Restored the previous owner.' };
  });

  const findUsers = (q) => fetchJSON(`/search/json/users?${new URLSearchParams({ q })}`);

  return {
    projectQuery: query,
    foundProjects: found,
    foundMore: more,
    projectSearching: searching,
    projectSearched: searched,
    actionError: error,
    actionResult: result,
    searchProjects: search,
    restoreAction: restore,
    countsText,
    // for the ProjectActions component
    deleteProject,
    transfer,
    findUsers
  };
};

// The two buttons of a project, and the form to choose the new owner
export const ProjectActions = {
  template: '#project-actions-template',
  props: {
    project: { type: Object, required: true },
    where: { type: String, required: true }
  },
  setup(props) {
    const actions = inject('projectActions');
    const open = ref(false);
    const q = ref('');
    const users = ref([]);
    const chosen = ref('');
    let asked = 0;

    const findUsers = async () => {
      asked += 1;
      const mine = asked;
      const text = q.value.trim();
      const list = text ? await actions.findUsers(text).catch(() => []) : [];
      if (mine === asked) {
        users.value = list.filter((u) => u.username !== props.project.owner);
      }
    };

    const toggle = () => {
      open.value = !open.value;
      q.value = '';
      users.value = [];
      chosen.value = '';
    };

    const transfer = async () => {
      await actions.transfer(props.project, chosen.value, props.where);
      open.value = false;
    };

    return {
      open,
      q,
      users,
      chosen,
      toggle,
      findUsers,
      transfer,
      remove: () => actions.deleteProject(props.project, props.where)
    };
  },
  compilerOptions: {
    delimiters: ['[[', ']]']
  }
};
