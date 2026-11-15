/**
 * WebSocket tickets of the embeddable viewer (T002 3.7), as BrainBox's
 * services/EmbedAccessService.js: same collection, lifetime and functions.
 * BrainBox scopes a ticket to an MRI ({dirname, mriSource}); microdraw scopes
 * it to a dataset in a project ({source, project}).
 */
const crypto = require('crypto');

// Minted fresh on every /data/embed render, never reused across page loads
const WS_TICKET_COLLECTION = 'embedWsTicket';
const WS_TICKET_DURATION = 6 * 3600 * 1000; // 6 h

/**
 * Mint a short-lived ticket that the embed page's WebSocket presents to prove
 * that it comes from an embed render, scoped to one dataset in one project.
 * @param {Object} db Native MongoDB Db
 * @param {Object} scope What the ticket is for
 * @param {string} scope.source The dataset's source URL
 * @param {string|null} scope.project The project's shortname (null: the image alone)
 * @param {string|null} [scope.username] The user the page was rendered for
 *        (null if anonymous): who the connection joins rooms as
 * @returns {Promise<string>} The ticket's token
 */
const mintWsTicket = async function (db, { source, project, username = null }) {
  const now = new Date();
  const ticket = {
    token: crypto.randomBytes(24).toString('hex'),
    source,
    project: project || null,
    username,
    createdAt: now,
    expiryDate: new Date(now.getTime() + WS_TICKET_DURATION)
  };
  await db.collection(WS_TICKET_COLLECTION).insertOne(ticket);

  return ticket.token;
};

/**
 * Look up a ticket. A missing, expired or invalid token gives null: callers
 * treat that as "no scope", never as "full access".
 * @param {Object} db Native MongoDB Db
 * @param {string} token The token the client presented
 * @returns {Promise<Object|null>} The ticket, or null
 */
const findWsTicket = async function (db, token) {
  if (typeof token !== 'string' || token.length === 0) { return null; }

  const ticket = await db.collection(WS_TICKET_COLLECTION).findOne({ token });
  if (!ticket || !(ticket.expiryDate instanceof Date) || ticket.expiryDate.getTime() < Date.now()) { return null; }

  return ticket;
};

module.exports = { mintWsTicket, findWsTicket, WS_TICKET_COLLECTION, WS_TICKET_DURATION };
