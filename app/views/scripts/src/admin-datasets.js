// Admin page, sections "Datasets" (T002 3.6 B, as BrainBox's "one MRI") and
// "Message to everyone connected" (T002 3.6 C). The routes are
// /admin/json/dataset* and /admin/json/broadcast.
import { ref } from 'vue';

const who = (user) => (user === null ? 'every user' : user);

/**
 * State and actions of the section "Datasets"
 * @param {object} api { fetchJSON, postJSON }
 * @returns {object} What the template uses
 */
// eslint-disable-next-line max-statements
export const useDataset = ({ fetchJSON, postJSON }) => {
  const datasetSource = ref(new URLSearchParams(window.location.search).get('dataset') || '');
  const dataset = ref(null);
  const loading = ref(false);
  const error = ref('');
  const result = ref(null);
  const owner = ref('');
  const name = ref('');

  // eslint-disable-next-line max-statements
  const load = async () => {
    const source = datasetSource.value.trim();
    if (source === '') {
      return;
    }
    loading.value = true;
    error.value = '';
    try {
      dataset.value = await fetchJSON(`/admin/json/dataset?${new URLSearchParams({ source })}`);
      owner.value = dataset.value.document ? dataset.value.document.owner || '' : '';
      name.value = dataset.value.document ? dataset.value.document.name || '' : '';
    } catch (err) {
      error.value = err.message;
      dataset.value = null;
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

  const search = () => {
    result.value = null;

    return load();
  };

  const update = () => act(async () => {
    const { source, document } = dataset.value;
    const body = { source };
    if (!document || owner.value.trim() !== document.owner) {
      body.owner = owner.value.trim();
    }
    if (!document || name.value.trim() !== document.name) {
      body.name = name.value.trim();
    }
    const res = await postJSON('/admin/json/dataset/update', body);

    return { text: `${res.created ? 'Created' : 'Changed'} the document: owner ${res.document.owner}, name ${res.document.name}.` };
  });

  // a row of the annotations per project and user; a project's rows together
  // with user null: all of them
  const removeAnnotations = (row, all = false) => {
    const user = all ? null : row.user;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove the annotations of ${who(user)} in ${row.project} on ${dataset.value.source}?\n\nThey are marked as backups, not erased: you can undo this.`)) {
      return;
    }

    return act(async () => {
      const body = { source: dataset.value.source, project: row.project };
      if (user !== null) {
        body.user = user;
      }
      const { removed, log } = await postJSON('/admin/json/dataset/remove-annotations', body);

      return { text: `Removed ${removed} region(s) of ${who(user)} in ${row.project} (kept as backups).`, undo: log };
    });
  };

  const undoRemove = (r) => act(async () => {
    const { restored } = await postJSON('/admin/json/dataset/restore-annotations', { log: r.undo });

    return { text: `Restored ${restored} region(s).` };
  });

  if (datasetSource.value) {
    load();
  }

  return {
    datasetSource,
    dataset,
    datasetLoading: loading,
    datasetError: error,
    datasetResult: result,
    datasetOwner: owner,
    datasetName: name,
    searchDataset: search,
    updateDataset: update,
    removeDatasetAnnotations: removeAnnotations,
    undoRemoveDatasetAnnotations: undoRemove
  };
};

export const MAX_MESSAGE_LENGTH = 500;

/**
 * State and actions of the section "Message to everyone connected"
 * @param {object} api { postJSON }
 * @returns {object} What the template uses
 */
export const useBroadcast = ({ postJSON }) => {
  const message = ref('');
  const sending = ref(false);
  const error = ref('');
  const result = ref('');

  const send = async () => {
    sending.value = true;
    error.value = '';
    result.value = '';
    try {
      const { viewers } = await postJSON('/admin/json/broadcast', { message: message.value });
      result.value = `Sent to ${viewers} connected viewer${viewers === 1 ? '' : 's'}.`;
      message.value = '';
    } catch (err) {
      error.value = err.message;
    }
    sending.value = false;
  };

  return {
    broadcastText: message,
    broadcastSending: sending,
    broadcastError: error,
    broadcastResult: result,
    sendBroadcast: send,
    MAX_MESSAGE_LENGTH
  };
};
