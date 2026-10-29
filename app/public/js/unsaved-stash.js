/* eslint-disable max-lines */
/*
  H3a: annotations that could not be saved on the server are kept in this
  browser's localStorage (the "stash"), so that a user who drew on an image
  opened without a project, while logged out, or whose save was refused, does
  not lose the work. Only the user's own work is kept: regions created or
  modified on this page, not those loaded from the server as they were. When
  the image is later opened in a project the user can edit and that lists the
  image, the viewer offers to import them. Format and lifetime:
  docs/decisions.md D25.

  One entry per image source and slice:
    key   `microdraw:unsaved:<source>&slice=<slice>` (the server's fileID)
    value {version: 1, savedAt: ISO date, source, slice,
           annotation: {Regions: [{path, name, uid}], RegionsToRemove: [uid]}}
  `annotation` has the shape of the object the save tool sends to POST /api (as
  a string), restricted to the user's own regions.

  No jQuery here (M4).
*/
// eslint-disable-next-line max-statements
window.UnsavedStash = (function () {
  const PREFIX = 'microdraw:unsaved:';
  const VERSION = 1;
  const permissionRequests = {};
  // keys the user answered "Not now" for, in this page
  const postponed = new Set();

  const key = (source, slice) => `${PREFIX}${source}&slice=${slice}`;

  /**
   * The stash for an image source and slice.
   * @param {string} source Image source
   * @param {string} slice Slice name (a key of Microdraw.ImageInfo)
   * @returns {object|null} The stash, or null if there is none, or localStorage is unavailable
   */
  const read = (source, slice) => {
    try {
      const raw = window.localStorage.getItem(key(source, slice));
      if (!raw) {
        return null;
      }
      const stash = JSON.parse(raw);
      if (!stash || !stash.annotation || !Array.isArray(stash.annotation.Regions)) {
        return null;
      }

      return stash;
    } catch (err) {
      return null;
    }
  };

  // The regions of `value`, plus those of an earlier stash that `value` neither
  // has (same uid) nor removes.
  const merge = (previous, value) => {
    const regions = value.Regions.slice();
    const removed = new Set(value.RegionsToRemove || []);
    if (previous) {
      const uids = new Set(regions.map((r) => r.uid));
      regions.push(...previous.annotation.Regions.filter((r) => !uids.has(r.uid) && !removed.has(r.uid)));
    }

    return { Regions: regions, RegionsToRemove: [...removed] };
  };

  /**
   * Keep `value` for an image source and slice. Regions kept earlier stay,
   * unless `value` has a region with the same uid or removes it.
   * @param {string} source Image source
   * @param {string} slice Slice name
   * @param {object} value {Regions, RegionsToRemove}, as the save tool sends it
   * @returns {boolean} True if kept; false if localStorage is unavailable or full
   */
  const write = (source, slice, value) => {
    try {
      const stash = {
        version: VERSION,
        savedAt: new Date().toISOString(),
        source,
        slice,
        annotation: merge(read(source, slice), value)
      };
      window.localStorage.setItem(key(source, slice), JSON.stringify(stash));

      return true;
    } catch (err) {
      console.warn('Unable to keep the annotations in this browser', err);

      return false;
    }
  };

  const remove = (source, slice) => {
    try {
      window.localStorage.removeItem(key(source, slice));
    } catch (err) {
      // nothing to remove if localStorage is unavailable
    }
  };

  // A region's name and geometry, without what selecting or hiding it changes.
  const fingerprint = (region) => {
    if (!Array.isArray(region.path)) {
      return JSON.stringify([region.name, region.path]);
    }
    const [type, props] = region.path;
    const geometry = Object.assign({}, props);
    ['selected', 'fullySelected', 'opacity', 'visible'].forEach((prop) => { delete geometry[prop]; });

    return JSON.stringify([region.name, type, geometry]);
  };

  /**
   * Remember the regions of a slice as they are on the server: after they are
   * loaded and drawn, and after a successful save. Regions that differ from
   * this, or are not in it, are the user's own work.
   * @param {object} M Microdraw
   * @param {string} slice Slice name
   * @returns {void}
   */
  const snapshot = (M, slice) => {
    const section = M.ImageInfo[slice];
    section.ServerRegions = {};
    for (const region of M.sectionValueForHashing(section).Regions) {
      section.ServerRegions[region.uid] = fingerprint(region);
    }
  };

  /**
   * Keep the user's own regions of a changed slice (see write).
   * @param {object} M Microdraw
   * @param {string} slice Slice name
   * @param {object} value {Regions, RegionsToRemove}, as the save tool sends it
   * @returns {boolean} True if kept, or if there was nothing of the user's own to keep
   */
  const keep = (M, slice, value) => {
    const server = M.ImageInfo[slice].ServerRegions || {};
    const own = value.Regions.filter((r) => server[r.uid] !== fingerprint(r));
    if (own.length === 0 && !read(M.source, slice)) {
      return true;
    }

    return write(M.source, slice, { Regions: own, RegionsToRemove: value.RegionsToRemove || [] });
  };

  // Whether the user is logged in, as the page's menu shows it.
  const loggedIn = () => Boolean(document.querySelector('#MyLogin a[href="/logout"]'));

  // The page's own login link (the menu's), or GitHub's.
  const loginHref = () => {
    const link = [...document.querySelectorAll('#MyLogin a')]
      .map((a) => a.getAttribute('href'))
      .find((href) => href && !(/^\/(logout|user\/)/).test(href));

    return link || '/auth/github';
  };

  // What the current user may do with `project`, and whether it lists `source`
  // (asked once per page).
  const projectPermissions = (project, source) => {
    const id = `${project}\n${source}`;
    if (!permissionRequests[id]) {
      const query = `project=${encodeURIComponent(project)}&source=${encodeURIComponent(source)}`;
      permissionRequests[id] = fetch(`/api/permissions?${query}`, { credentials: 'same-origin' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => ({
          edit: Boolean(json && json.annotations && json.annotations.edit),
          listed: Boolean(json && json.image && json.image.listed)
        }))
        .catch(() => ({ edit: false, listed: false }));
    }

    return permissionRequests[id];
  };

  const node = (tag, text, attrs) => {
    const el = document.createElement(tag);
    if (text) {
      el.textContent = text;
    }
    Object.assign(el, attrs || {});

    return el;
  };

  /**
   * Show a dialog that stays until one of its buttons is clicked.
   * @param {HTMLElement} el The dialog element (#saveDialog or #importDialog)
   * @param {Array} content Strings and nodes to show
   * @param {Array} buttons {action, label, onClick}; onClick may return false to keep the dialog open
   * @returns {void}
   */
  const showDialog = (el, content, buttons) => {
    const bar = node('div', null, { className: 'dialogButtons' });
    for (const { action, label, onClick } of buttons) {
      const button = node('button', label, { type: 'button' });
      button.dataset.action = action;
      button.addEventListener('click', () => {
        if (!onClick || onClick() !== false) {
          el.style.display = 'none';
        }
      });
      bar.appendChild(button);
    }
    el.replaceChildren(...content, bar);
    el.style.background = '#333';
    el.style.opacity = 1;
    el.style.display = 'block';
  };

  /**
   * The save tool's answer to a save without a project.
   * @param {HTMLElement} el The #saveDialog element
   * @param {boolean} kept Whether the annotations were kept in localStorage
   * @returns {void}
   */
  const showNoProjectDialog = (el, kept) => {
    const link = node('a', 'Create a project', { href: '/project/new', target: '_blank', rel: 'noopener' });
    const content = [
      'Saving annotations requires a project. ',
      link,
      ' and add this image to it.',
      node('br'),
      kept ?
        'Your annotations are kept in this browser: open this image in your project to import them.' :
        'This browser could not keep a copy of your annotations: they will be lost when you leave this page.'
    ];
    showDialog(el, content, [{ action: 'close', label: 'Close' }]);
  };

  // The stashed regions that are not on the slice already (same uid): a save
  // interrupted by leaving the page may have reached the server anyway.
  const newRegions = (M, slice, stash) => {
    const existing = new Set(M.ImageInfo[slice].Regions.map((r) => r.uid));

    return stash.annotation.Regions.filter((r) => r && r.path && !existing.has(r.uid));
  };

  /**
   * The save tool's answer to a save while logged out (nothing is sent), or
   * one the server refused with 401.
   * @param {HTMLElement} el The #saveDialog element
   * @param {boolean} kept Whether the annotations were kept in localStorage
   * @returns {void}
   */
  const showLoginDialog = (el, kept) => {
    const content = [
      node('a', 'Log in', { href: loginHref() }),
      ' to save your annotations. ',
      kept ?
        'They are kept in this browser.' :
        'This browser could not keep a copy of them: they will be lost when you leave this page.'
    ];
    showDialog(el, content, [{ action: 'close', label: 'Close' }]);
  };

  const importRegions = (M, slice, stash) => {
    const data = newRegions(M, slice, stash).map((r) => ({ annotation: r }));
    const regions = M._convertDBAnnotationsToRegions(data);
    for (const region of regions) {
      M.newRegion(region, slice);
    }
    if (slice === M.currentImage) {
      M._drawRegionsInPaper(regions);
    }
    remove(stash.source, slice);

    return regions.length;
  };

  const showImportDialog = (M, slice, stash) => {
    const el = M.dom.querySelector('#importDialog');
    const date = new Date(stash.savedAt).toLocaleString();
    const n = newRegions(M, slice, stash).length;
    const ask = () => showDialog(el, [`You have unsaved annotations for this image from ${date}. Import them into this project?`], [
      {
        action: 'import',
        label: 'Import',
        onClick: () => {
          const imported = importRegions(M, slice, stash);
          showDialog(el, [`Imported ${imported} region${imported === 1 ? '' : 's'}. Save to keep them in this project.`], [{ action: 'close', label: 'OK' }]);

          return false;
        }
      },
      { action: 'later', label: 'Not now', onClick: () => { postponed.add(key(stash.source, slice)); } },
      {
        action: 'discard',
        label: 'Discard…',
        onClick: () => {
          showDialog(el, [`Discard the ${n} unsaved region${n === 1 ? '' : 's'} kept in this browser for this image? This cannot be undone.`], [
            { action: 'discard', label: 'Discard', onClick: () => remove(stash.source, slice) },
            {
              action: 'cancel',
              label: 'Cancel',
              onClick: () => {
                ask();

                return false;
              }
            }
          ]);

          return false;
        }
      }
    ]);
    ask();
  };

  // Why the import is not offered, or '' if it is.
  // eslint-disable-next-line complexity, max-statements
  const whyNotOffer = async (M, slice, stash) => {
    if (!M.project) { return 'no project'; }
    if (!stash || stash.annotation.Regions.length === 0) { return 'no stash'; }
    if (postponed.has(key(M.source, slice))) { return 'postponed'; }
    const permissions = await projectPermissions(M.project, M.source);
    if (!permissions.edit) { return 'cannot edit'; }
    if (slice !== M.currentImage) { return 'slice changed'; }
    if (newRegions(M, slice, stash).length === 0) {
      // everything kept is already in the project: nothing to offer
      remove(M.source, slice);

      return 'nothing new';
    }
    if (!permissions.listed) { return 'image not in project'; }

    return '';
  };

  /**
   * After a slice's annotations are loaded: if the image is open in a project
   * the user can edit and a stash exists for it, offer to import the stash.
   * The result is kept in `lastCheck` (read by the e2e tests).
   * @param {object} M Microdraw
   * @param {string} slice Slice name
   * @returns {Promise<object>} {key, offered, reason}
   */
  const offerImport = async (M, slice) => {
    const stash = read(M.source, slice);
    const reason = await whyNotOffer(M, slice, stash);
    const check = { key: key(M.source, slice), offered: reason === '', reason };
    if (check.offered) {
      showImportDialog(M, slice, stash);
    } else if (reason === 'image not in project') {
      // closed, it is not shown again in this page: a slice is fetched again
      // each time it is opened (2026-10-29), as "Not now"
      showDialog(M.dom.querySelector('#importDialog'), ['Add this image to the project to import your unsaved annotations.'], [{ action: 'close', label: 'Close', onClick: () => { postponed.add(check.key); } }]);
    }
    window.UnsavedStash.lastCheck = check;

    return check;
  };

  return {
    PREFIX,
    key,
    read,
    write,
    remove,
    snapshot,
    keep,
    loggedIn,
    showNoProjectDialog,
    showLoginDialog,
    offerImport,
    lastCheck: null
  };
}());
