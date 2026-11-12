const fs = require('fs');
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
var websocketserver;

// longer chat messages are dropped
const MAX_CHAT_LENGTH = 1000;
// connection -> the promise of its last relayed chat message
const chatQueues = new WeakMap();

const microdrawWebsocketServer = (function () {
  const me = {
    dataDirectory: '',
    // the app's session middleware and native Db (set by app.js)
    sessionParser: null,
    db: null,

    // Joins and live-update notices: liveRooms.js
    notifySaved: (target) => liveRooms.notifySaved(target),
    _roomSize: (target) => liveRooms.roomSize(target),

    _handleUserWebSocketMessage: ({data, ws}) => {
      switch(data.type) {
      case 'join':
        liveRooms.join({ data, ws, sessionParser: me.sessionParser, db: me.db })
          .catch((err) => log.error({ err }, 'join failed'));
        break;
      default:
        break;
      }
    },

    /**
     * The chat message relayed for a received one, built from known fields
     * only, or null if the received one is not a valid chat. The sender's
     * name is the session user of its connection, never the one it sent.
     * @param {object} data The received message
     * @param {string|null} username The sender's session user
     * @returns {object|null} The message to relay
     */
    _chatMessage: (data, username) => {
      if (data.type !== 'chat' || typeof data.msg !== 'string' || data.msg.length > MAX_CHAT_LENGTH) {
        return null;
      }
      const chat = { type: 'chat', msg: data.msg, username: username || 'Anonymous' };
      if (typeof data.randomUuid === 'number') {
        chat.randomUuid = data.randomUuid;
      }

      return chat;
    },

    _broadcast: (text, ws) => {
      websocketserver.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
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
      if (me._chatMessage(data, null) === null) {
        return;
      }
      const previous = chatQueues.get(ws) || Promise.resolve();
      const next = previous
        .then(() => liveRooms.sessionUsername(ws, me.sessionParser))
        .then((username) => {
          me._broadcast(JSON.stringify(me._chatMessage(data, username)), ws);
        })
        .catch((err) => log.error({ err }, 'cannot relay chat message'));
      chatQueues.set(ws, next);
    },

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

      // handle single user messages
      me._handleUserWebSocketMessage({data, ws});

      // handle message broadcast
      me._handleBroadcastWebSocketMessage({data, ws});
    },

    _handleWebSocketConnection: (ws, req) => {
      liveRooms.connect(ws, req);
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

      me.server.on("upgrade", (req, socket) => {
        let ip = req.ip
          || req.connection.remoteAddress
          || req.socket.remoteAddress
          || req.connection.socket.remoteAddress;
        ip = ip.split(":").pop();
        log.debug({ ip }, 'upgrading connection');

        if(useWhitelist && !whitelist[ip]) {
          log.warn({ ip }, 'connection refused: not in whitelist');
          setTimeout(function() {
            socket.destroy();
          }, 5000);
        }

        if (useBlacklist && blacklist[ip]) {
          log.warn({ ip }, 'connection refused: blacklisted');
          setTimeout(function() {
            socket.destroy();
          }, 5000);
        }
      });

      // Init WS connection
      try {
        websocketserver = new WebSocketServer({
          server: me.server
          // verifyClient: me.verifyClient
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
