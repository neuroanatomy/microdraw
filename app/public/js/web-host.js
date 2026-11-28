/* global PageHelpers */

/*
  The viewer's host on the web.

  The viewer (microdraw.js) asks its host for what depends on where it runs:
  Microdraw.init(dom, host). Without a host it loads this file and makes this
  one. Another host (the desktop application's) is passed to init, and this
  file is then not loaded. So that both keep working, the viewer asks the host
  what it needs and never which host it is.

  A host is an object with these methods. More of what the viewer does with
  the server is to move here, one area at a time.

    labelSet()  A promise of the label set to start with: {name, labels:
                [{name, value, color: [red, green, blue], url}]}. If it
                rejects, the viewer has no label set.

  On the web it is the label set of the project's first vectorial layer
  (T002 3.2), and 10 regions without a project or when a request fails.
*/
window.MicrodrawWebHost = (function () {

  /** The label set used when the project has none: 10 regions. */
  const DEFAULT_LABEL_SET = '/labels/10regions.json';

  /* The URL of the label set of the project's first vectorial layer (T002
     3.2): its `values` is the file name (`source`) or the name of one of the
     label sets of /api/getLabelsets. Without a vectorial layer, or with a
     `values` that is not a known label set, the default label set. A failed
     request throws. */
  const projectLabelSetURL = async (project) => {
    // only the layers, which the visitor may see, not the project's files
    const layers = await PageHelpers.fetchJSON(`/project/json/${encodeURIComponent(project)}?var=annotations/list`);
    const layer = Array.isArray(layers) ? layers.find((a) => a && a.type === 'vectorial') : null;
    if (!layer) {
      return DEFAULT_LABEL_SET;
    }
    const sets = await PageHelpers.fetchJSON('/api/getLabelsets');
    const found = Array.isArray(sets) && sets.find((s) => s.source === layer.values || s.name === layer.values);
    if (!found) {
      console.warn(`Project ${project}: the vectorial layer's label set "${layer.values}" is not known, using 10 regions`);

      return DEFAULT_LABEL_SET;
    }

    return `/labels/${encodeURIComponent(found.source)}`;
  };

  // the label set at a URL, or 10 regions if it cannot be loaded
  const labelSetAt = async (url) => {
    try {
      return await PageHelpers.fetchJSON(url);
    } catch (err) {
      if (url === DEFAULT_LABEL_SET) {
        throw err;
      }
      console.log(`cannot load the label set ${url}, using 10 regions:`, err.message);

      return PageHelpers.fetchJSON(DEFAULT_LABEL_SET);
    }
  };

  const labelSetOf = async (project) => {
    let url = DEFAULT_LABEL_SET;
    if (project) {
      try {
        url = await projectLabelSetURL(project);
      } catch (err) {
        console.log(`cannot find the label set of project ${project}, using 10 regions:`, err.message);
      }
    }

    return labelSetAt(url);
  };

  /**
   * @param {object} context {project}: the project's shortname, if the viewer
   * was opened in one
   * @returns {object} The host
   */
  const create = ({ project }) => ({
    labelSet: () => labelSetOf(project)
  });

  return { create };
}());
