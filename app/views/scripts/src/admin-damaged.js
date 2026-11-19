// Admin page, section "Damaged projects" (T002 3.6 A), as BrainBox's admin
// page. The list is read on demand (it reads every version of every project);
// the fixes are the routes /admin/json/projects/restore-files and fix-current.
import { formatDate as formatDateOf } from 'nwl-components';
import { ref } from 'vue';

// microdraw's dates show the time
const formatDate = (date) => formatDateOf(date, { time: true });

/**
 * State and actions of the section
 * @param {object} api { fetchJSON, postJSON }
 * @returns {object} What the template uses
 */
// eslint-disable-next-line max-statements
export const useDamagedProjects = ({ fetchJSON, postJSON }) => {
  const damaged = ref(null); // null until searched
  const loading = ref(false);
  const error = ref('');
  const result = ref(null);

  const load = async () => {
    loading.value = true;
    error.value = '';
    try {
      damaged.value = (await fetchJSON('/admin/json/projects/damaged')).list;
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

  const restoreFiles = (p, e) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Add back to ${p.shortname} the ${e.stillMissing} file(s) removed by the save of ${formatDate(e.modified)}?\n\nThey go at the end of its files, in a new version: you can restore the previous one.`)) {
      return;
    }

    return act(async () => {
      const { restored, files, log } = await postJSON('/admin/json/projects/restore-files', { project: p.shortname, version: p.version, save: e.save });

      return { text: `${p.shortname}: restored ${restored} file(s), it has ${files} now.`, shortname: p.shortname, restore: log };
    });
  };

  const fixCurrent = (p) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Keep the most recent of the ${p.currentVersions.length} current versions of ${p.shortname}, and make the others backups?`)) {
      return;
    }

    return act(async () => {
      const { backups } = await postJSON('/admin/json/projects/fix-current', { project: p.shortname, version: p.version });

      return { text: `${p.shortname}: kept the most recent version, ${backups} other(s) made backups.` };
    });
  };

  // undo a restore-files: A2's restore puts the previous version back
  const undoRestoreFiles = (r) => act(async () => {
    await postJSON('/admin/json/projects/restore', { log: r.restore });

    return { text: `Restored the previous version of ${r.shortname}.` };
  });

  return {
    damaged,
    damagedLoading: loading,
    damagedError: error,
    damagedResult: result,
    loadDamaged: load,
    restoreFiles,
    fixCurrent,
    undoRestoreFiles
  };
};
