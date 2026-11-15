/**
 * Connections of the embeddable viewer (T002 3.7), as BrainBox's
 * atlasmakerServer tags them (`isEmbed`, `embedScope`).
 *
 * The embed page opens its WebSocket with ?embedTicket=<token>, minted when
 * the page was rendered (embed/EmbedAccessService.js). A connection that
 * presents the parameter, whatever its value, is embed-only: an unknown or
 * expired ticket still tags it, with no scope (fail closed: presenting the
 * parameter can only narrow a connection's rights, never widen them).
 *
 * An embed-only connection may only join the rooms of its ticket's dataset
 * and project, as the user the page was rendered for (liveRooms.join), and
 * gets the saved notices; any other message is refused, and it is sent no
 * chat.
 */
const url = require('url');
const EmbedAccessService = require('../embed/EmbedAccessService');
const log = require('../../log').child({ module: 'websocket' });

// connection -> {lookup: Promise<scope|null>, refusalSent}
const embeds = new WeakMap();

/**
 * The ticket an upgrade request presents
 * @param {object} req The upgrade request
 * @returns {string|null} The ticket ('' if the parameter is empty), or null without one
 */
const ticketOf = (req) => {
  if (!req || typeof req.url !== 'string') {
    return null;
  }
  const { query } = url.parse(req.url, true);
  if (!Object.prototype.hasOwnProperty.call(query, 'embedTicket')) {
    return null;
  }
  const value = query.embedTicket;

  return typeof value === 'string' ? value : '';
};

/**
 * Tag a new connection as embed-only if its upgrade request presents a ticket
 * @param {object} ws The connection
 * @param {object} req The upgrade request
 * @param {object} db The app's native Db
 * @returns {boolean} True if the connection is embed-only
 */
const tag = (ws, req, db) => {
  const ticket = ticketOf(req);
  if (ticket === null) {
    return false;
  }
  const lookup = (db ? EmbedAccessService.findWsTicket(db, ticket) : Promise.resolve(null))
    .then((found) => (found ? { source: found.source, project: found.project, username: found.username || null } : null))
    .catch((err) => {
      log.error({ err }, 'embed ticket lookup failed');

      return null;
    });
  embeds.set(ws, { lookup, refusalSent: false });

  return true;
};

const isEmbed = (ws) => embeds.has(ws);

/**
 * The scope of an embed-only connection, once its ticket is looked up
 * @param {object} ws The connection
 * @returns {Promise<object|null>} {source, project, username}, or null without a valid ticket
 */
const scopeOf = (ws) => (embeds.has(ws) ? embeds.get(ws).lookup : Promise.resolve(null));

/**
 * Whether a refusal notice is still to be sent to an embed-only connection
 * (one per connection, as BrainBox's embedRefusalSent), and mark it sent
 * @param {object} ws The connection
 * @returns {boolean} True the first time
 */
const firstRefusal = (ws) => {
  const state = embeds.get(ws);
  if (!state || state.refusalSent) {
    return false;
  }
  state.refusalSent = true;

  return true;
};

module.exports = { ticketOf, tag, isEmbed, scopeOf, firstRefusal };
