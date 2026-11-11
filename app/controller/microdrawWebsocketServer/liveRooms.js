/**
 * Live-update notices (simultaneous editing step 3a).
 *
 * A WebSocket connection joins the room of one image slice of a project,
 * {type: 'join', project, source, slice}, if its session user (or 'anyone'
 * when logged out) may view the project's annotations, as GET /api?project
 * checks. The answer is {type: 'joined', project, source, slice} or
 * {type: 'join-refused', project, source, slice, reason}. One room per
 * connection: a new join leaves the previous room, and so does closing.
 *
 * After a save of the slice is stored, the room gets {type: 'saved', project,
 * source, slice}: no regions and no username. The viewer refetches the slice
 * through the access-checked HTTP route. `slice` is always a string, as in the
 * fileID `${source}&slice=${slice}`.
 */

const WebSocket = require('ws');
const { AccessControlService } = require('neuroweblab');
const { findCurrentProject } = require('../project/currentProject');
const { usernameFromCookie } = require('./sessionUser');
const log = require('../../log').child({ module: 'websocket' });

// Types only the server handles or sends: never relayed to other clients.
const SERVER_TYPES = new Set(['join', 'joined', 'join-refused', 'saved']);
// longer join fields make the message invalid, and it is ignored
const MAX_FIELD_LENGTH = 2048;

const isField = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH;

// {project, source, slice} of a join, slice as a string, or null if invalid.
const joinTarget = ({ project, source, slice }) => {
  let sliceString = null;
  if (typeof slice === 'number' && Number.isFinite(slice)) {
    sliceString = String(slice);
  } else if (isField(slice)) {
    sliceString = slice;
  }
  if (!isField(project) || !isField(source) || sliceString === null) {
    return null;
  }

  return { project, source, slice: sliceString };
};

const roomKey = ({ project, source, slice }) => JSON.stringify([project, source, String(slice)]);

// room key -> Set of connections
const rooms = new Map();
// connection -> {cookie, room, joins}
const connections = new WeakMap();

const sendJSON = (ws, data) => {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    ws.send(JSON.stringify(data));
  } catch (err) {
    log.error({ err }, 'cannot send message');
  }
};

const leaveRoom = (ws) => {
  const state = connections.get(ws);
  if (!state || !state.room) {
    return;
  }
  const room = rooms.get(state.room);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      rooms.delete(state.room);
    }
  }
  state.room = null;
};

const enterRoom = (ws, key) => {
  if (!rooms.has(key)) {
    rooms.set(key, new Set());
  }
  rooms.get(key).add(ws);
  connections.get(ws).room = key;
};

/**
 * A new connection: keep the session cookie of its upgrade request.
 * @param {object} ws The connection
 * @param {object} req The upgrade request
 * @returns {void}
 */
const connect = (ws, req) => {
  const cookie = req && req.headers && typeof req.headers.cookie === 'string' ? req.headers.cookie : null;
  connections.set(ws, { cookie, room: null, joins: 0 });
};

/**
 * A closed connection leaves its room.
 * @param {object} ws The connection
 * @returns {void}
 */
const disconnect = (ws) => {
  leaveRoom(ws);
  connections.delete(ws);
};

/**
 * A join: leave the current room at once, then enter the new one if the
 * session user may view the project's annotations. The user is read again at
 * each join, so a logout or an expired session counts. Of overlapping joins,
 * only the last one is answered and entered. An invalid join is ignored.
 * @param {object} params Parameters
 * @param {object} params.data The message
 * @param {object} params.ws The connection
 * @param {function} params.sessionParser The app's session middleware
 * @param {object} params.db The app's native Db
 * @returns {Promise<void>}
 */
// eslint-disable-next-line max-statements
const join = async ({ data, ws, sessionParser, db }) => {
  const state = connections.get(ws);
  const target = joinTarget(data);
  if (!state || !target) {
    log.warn('join ignored, invalid');

    return;
  }
  leaveRoom(ws);
  state.joins += 1;
  const ticket = state.joins;
  const current = () => ticket === state.joins && ws.readyState === WebSocket.OPEN;
  const refuse = (reason) => sendJSON(ws, { type: 'join-refused', ...target, reason });
  if (!db) {
    refuse('unavailable');

    return;
  }
  let project, username;
  try {
    username = await usernameFromCookie(sessionParser, state.cookie);
    project = await findCurrentProject(db, target.project);
  } catch (err) {
    log.error({ err }, 'join check failed');
    if (current()) {
      refuse('error');
    }

    return;
  }
  if (!current()) {
    return;
  }
  if (!project) {
    refuse('not-found');
  } else if (AccessControlService.canViewAnnotations(project, username || 'anyone')) {
    enterRoom(ws, roomKey(target));
    sendJSON(ws, { type: 'joined', ...target });
  } else {
    refuse('forbidden');
  }
};

/**
 * Tell the viewers of an image slice that it was saved. Called after the
 * database write succeeded; never throws.
 * @param {object} params The saved slice
 * @param {string} params.project The project's shortname
 * @param {string} params.source The image source
 * @param {number|string} params.slice The slice
 * @param {object} [params.except] A connection not to notify (the saver's)
 * @returns {number} How many connections were notified
 */
const notifySaved = ({ project, source, slice, except }) => {
  let count = 0;
  try {
    const room = rooms.get(roomKey({ project, source, slice }));
    if (!room) {
      return 0;
    }
    const notice = { type: 'saved', project, source, slice: String(slice) };
    room.forEach((client) => {
      if (client !== except && client.readyState === WebSocket.OPEN) {
        sendJSON(client, notice);
        count += 1;
      }
    });
  } catch (err) {
    log.error({ err }, 'cannot send the saved notice');
  }

  return count;
};

// How many connections are in the room of a slice (for the tests).
const roomSize = (target) => {
  const room = rooms.get(roomKey(target));

  return room ? room.size : 0;
};

const isServerType = (type) => SERVER_TYPES.has(type);

module.exports = { connect, disconnect, join, notifySaved, roomSize, isServerType };
