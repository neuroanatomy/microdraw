/**
 * The lock that serialises the changes to a project (saving its settings,
 * deleting it, the admin tools that change it), so that two of them cannot
 * both read the current version and then both write it (M3, decisions D28).
 *
 * As BrainBox's controller/projectLock.js, but one lock per project instead of
 * one for all of them, and without the async-lock dependency. It only covers
 * this process.
 */
const tails = new Map();

/**
 * Run `fn` once every earlier holder of `key` has finished (FIFO)
 * @param {string} key The lock key
 * @param {function} fn The work, sync or async
 * @returns {Promise<*>} What `fn` returns; rejects if `fn` throws, which also
 *   releases the lock
 */
// eslint-disable-next-line max-statements
const acquire = async (key, fn) => {
  const previous = tails.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  tails.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  }
};

const projectKey = (shortname) => `project:${shortname}`;

/**
 * Run `fn` holding the lock of a project
 * @param {string} shortname The project shortname
 * @param {function} fn The work
 * @returns {Promise<*>} What `fn` returns
 */
const withProjectLock = (shortname, fn) => acquire(projectKey(shortname), fn);

/**
 * Whether someone holds or waits for the lock of a project (for tests)
 * @param {string} shortname The project shortname
 * @returns {boolean} True if locked
 */
const isProjectLocked = (shortname) => tails.has(projectKey(shortname));

module.exports = { acquire, withProjectLock, isProjectLocked };
