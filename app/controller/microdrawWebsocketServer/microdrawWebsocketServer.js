const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

// Get whitelist and blacklist
const useWhitelist = false;
const useBlacklist = true;
const whitelist = JSON.parse(fs.readFileSync(path.join(__dirname, "whitelist.json")));
const blacklist = JSON.parse(fs.readFileSync(path.join(__dirname, "blacklist.json")));

// var http = require('http');
const WebSocket = require('ws');
const log = require('../../log').child({ module: 'websocket' });
const WebSocketServer = WebSocket.Server;
const liveRooms = require('./liveRooms');
const embedConnections = require('./embedConnections');
// the chat relay: known fields only, at most 1000 characters, in order per sender
const { chatMessage, relayInOrder } = require('neuroweblab');
var websocketserver;

/**
 * The address a connection's peer is listed under in the whitelist and the
 * blacklist: its whole address, with an IPv4-mapped IPv6 address (the server
 * listens on IPv4 and IPv6) written as IPv4. Not split at ':' (F6 of the
 * access audit of 2026-10-19), which turned ::1 and any '...:1' into '1'; as
 * BrainBox's admin check (d12ee4f).
 * @param {object} req The upgrade request
 * @returns {string|null} The address, or null if there is none
 */
const peerAddress = (req) => {
  const socket = req && (req.socket || req.connection);
  const address = socket && socket.remoteAddress;
  if (typeof address !== 'string' || net.isIP(address) === 0) {
    return null;
  }
  const mapped = (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i).exec(address);

  return mapped ? mapped[1] : address.toLowerCase();
};

/**
 * The chat to relay (neuroweblab's chatMessage), with the sender's nickname
 * seed `randomUuid` kept only if it is a number, as before 1.25.0 (the
 * shared helper keeps strings too).
 * @param {object} data The received message
 * @param {string|null} username The sender's session user
 * @returns {object|null} The message to relay
 */
const relayedChat = (data, username) => {
  const chat = chatMessage(data, { username });
  if (chat !== null && typeof data.randomUuid === 'number') {
    chat.randomUuid = data.randomUuid;
  }

  return chat;
};

const microdrawWebsocketServer = (function () {
  const me = {
    dataDirectory: '',
    // the app's session middleware and native Db (set by app.js)
    sessionParser: null,
    db: null,
    // who may connect, by peerAddress (read from here, so that the tests can change them)
    useWhitelist,
    useBlacklist,
    whitelist,
    blacklist,
    peerAddress,

    /**
     * Whether a peer may not connect
     * @param {string|null} ip Its peerAddress
     * @returns {string|null} Why it is refused, or null
     */
    _refusedPeer: (ip) => {
      const listed = (list) => ip !== null && Object.prototype.hasOwnProperty.call(list, ip) && Boolean(list[ip]);
      if (me.useWhitelist && !listed(me.whitelist)) {
        return 'not in whitelist';
      }
      if (me.useBlacklist && listed(me.blacklist)) {
        return 'blacklisted';
      }

      return null;
    },

    // Joins and live-update notices: liveRooms.js
    notifySaved: (target) => liveRooms.notifySaved(target),
    _roomSize: (target) => liveRooms.roomSize(target),
    // connections with an image open, in any project (admin, T002 3.6)
    viewersOfSource: (source) => liveRooms.viewersOfSource(source),

    // open connections (admin, T002 3.6)
    connectedViewers: () => {
      let count = 0;
      if (websocketserver) {
        websocketserver.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            count += 1;
          }
        });
      }

      return count;
    },

    /**
     * Send an admin's message to every open connection, as {type: 'notice',
     * msg} (admin, T002 3.6). The viewer shows it as text. Never throws.
     * @param {string} msg The message
     * @returns {number} How many connections it was sent to
     */
    broadcastNotice: (msg) => {
      let count = 0;
      if (!websocketserver) {
        return count;
      }
      const text = JSON.stringify({ type: 'notice', msg });
      websocketserver.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(text);
            count += 1;
          } catch (err) {
            log.error({ err }, 'cannot send the notice');
          }
        }
      });

      return count;
    },

    _handleUserWebSocketMessage: ({data, ws}) => {
      switch(data.type) {
      case 'join':
        liveRooms.join({
          data,
          ws,
          sessionParser: me.sessionParser,
          db: me.db,
          embedScope: embedConnections.isEmbed(ws) ? embedConnections.scopeOf(ws) : null
        })
          .catch((err) => log.error({ err }, 'join failed'));
        break;
      default:
        break;
      }
    },

    /**
     * An embed-only connection (T002 3.7, embedConnections.js) may only join
     * the rooms of its ticket: any other message (a chat, or anything a
     * future version would write with) is refused, whatever it claims. The
     * first refusal is answered {type: 'writeRefused', write, reason}: the
     * name and the write/reason fields of BrainBox's refusal (which also
     * names the atlas). The embed page only joins, and ignores it.
     * @param {object} params Parameters
     * @param {object} params.data The message
     * @param {object} params.ws The connection
     * @returns {boolean} True if the message was refused
     */
    _refuseEmbedMessage: ({data, ws}) => {
      if (!embedConnections.isEmbed(ws) || data.type === 'join') {
        return false;
      }
      const write = typeof data.type === 'string' ? data.type.slice(0, 64) : null;
      log.warn({ write }, 'message from an embedded viewer refused');
      if (embedConnections.firstRefusal(ws) && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'writeRefused', write, reason: 'an embedded viewer cannot edit' }));
        } catch (err) {
          log.error({ err }, 'cannot send the refusal');
        }
      }

      return true;
    },

    // the chat goes to every connection but the sender's and the embeds'
    _broadcast: (text, ws) => {
      websocketserver.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN && !embedConnections.isEmbed(client)) {
          try {
            client.send(text);
          } catch (err) {
            log.error({ err }, 'cannot broadcast message');
          }
        }
      });
    },

    // Only chat messages go to the other clients (the chat is global). The
    // sender's name is looked up for each message; the lookups of one
    // connection are chained, so its messages are relayed in order.
    _handleBroadcastWebSocketMessage: function ({data, ws}) {
      if (chatMessage(data) === null) {
        return;
      }
      relayInOrder(ws, async () => {
        const username = await liveRooms.sessionUsername(ws, me.sessionParser);
        me._broadcast(JSON.stringify(relayedChat(data, username)), ws);
      }, { onError: (err) => log.error({ err }, 'cannot relay chat message') });
    },

    // eslint-disable-next-line max-statements
    _handleWebSocketMessage: ({msg, ws}) => {
      let data;
      try {
        data = JSON.parse(msg);
      } catch (err) {
        data = null;
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        log.warn('message ignored, not a JSON object');

        return;
      }

      // an embedded viewer is read-only (T002 3.7)
      if (me._refuseEmbedMessage({data, ws})) {
        return;
      }

      // handle single user messages
      me._handleUserWebSocketMessage({data, ws});

      // handle message broadcast
      me._handleBroadcastWebSocketMessage({data, ws});
    },

    /**
     * ws's verifyClient: a peer the lists refuse is answered 403 and never
     * accepted, so none of its messages is handled (it used to be accepted,
     * and closed 5 s later)
     * @param {object} info { req, origin, secure }
     * @param {Function} done Called with (accepted, status, reason)
     * @returns {void}
     */
    _verifyClient: (info, done) => {
      const ip = peerAddress(info.req);
      const reason = me._refusedPeer(ip);
      if (reason === null) {
        log.debug({ ip }, 'upgrading connection');
        done(true);

        return;
      }
      log.warn({ ip }, 'connection refused: ' + reason);
      done(false, 403, 'Forbidden');
    },

    _handleWebSocketConnection: (ws, req) => {
      liveRooms.connect(ws, req);
      // embed-only if it presents a ticket (T002 3.7)
      embedConnections.tag(ws, req, me.db);
      ws.on('message', function (msg) {
        try {
          me._handleWebSocketMessage({msg, ws});
        } catch (err) {
          log.error({ err }, 'message handler failed');
        }
      });
      ws.on('error', (err) => {
        log.error({ err }, 'connection error');
      });
      ws.on('close', () => {
        liveRooms.disconnect(ws);
        log.debug('user disconnected');
      });
    },

    initSocketConnection: () => {
      log.info({ freeMemory: os.freemem() }, 'websocket server starting');

      // Init WS connection
      try {
        websocketserver = new WebSocketServer({
          server: me.server,
          verifyClient: me._verifyClient
        });
        websocketserver.on("connection", me._handleWebSocketConnection);
        websocketserver.on("error", (err) => {
          log.error({ err }, 'server error');
        });
      } catch (ex) {
        log.error({ err: ex }, 'cannot create the websocket server');
      }
    }
  };

  return me;
}());

module.exports = microdrawWebsocketServer;
