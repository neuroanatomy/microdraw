/**
 * The lock that serialises the changes to a project (saving its settings,
 * deleting it, the admin tools that change it), so that two of them cannot
 * both read the current version and then both write it (M3, decisions D28).
 *
 * It now lives in NeuroWebLab (1.18.0, `project/lock.js`, written from this
 * file): the same key (`project:<shortname>`), the same FIFO order and the
 * same release on throw. This file keeps its three names for its callers
 * (project.controller.js, the admin tools) and the tests; the callers only
 * use `withProjectLock`, which they could take from NWL directly.
 *
 * The lock's state is one Map in NWL's module, so there must be a single copy
 * of `neuroweblab` (`npm ls neuroweblab` shows one). It only covers this
 * process.
 */
const { withLock, isLocked, projectKey, withProjectLock } = require('neuroweblab');

/**
 * Whether someone holds or waits for the lock of a project (for tests)
 * @param {string} shortname The project shortname
 * @returns {boolean} True if locked
 */
const isProjectLocked = (shortname) => isLocked(projectKey(shortname));

module.exports = { acquire: withLock, withProjectLock, isProjectLocked };
