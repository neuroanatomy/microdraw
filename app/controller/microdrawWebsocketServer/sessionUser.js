/**
 * Who opened a WebSocket connection, from the session cookie the browser sent
 * with the upgrade request (as BrainBox's atlasmakerServer does). Never the
 * username a client puts in its messages.
 */

/**
 * The username of the session a cookie belongs to.
 * @param {function} sessionParser NeuroWebLab's session middleware (express-session)
 * @param {string} cookie The Cookie header sent when the socket was opened
 * @returns {Promise<string|null>} The username, or null for a logged-out visitor
 */
const usernameFromCookie = (sessionParser, cookie) => new Promise((resolve) => {
  if (typeof sessionParser !== 'function' || typeof cookie !== 'string' || cookie.length === 0) {
    resolve(null);

    return;
  }
  // a fresh request each time, so that a logout or an expired session counts
  const req = { headers: { cookie }, url: '/', originalUrl: '/' };
  try {
    sessionParser(req, {}, (err) => {
      const user = !err && req.session && req.session.passport && req.session.passport.user;
      // the same reduction as NeuroWebLab's sessionUser.js
      const username = user && typeof user === 'object' && user.username;
      resolve(typeof username === 'string' && username.length > 0 ? username : null);
    });
  } catch (err) {
    resolve(null);
  }
});

module.exports = { usernameFromCookie };
