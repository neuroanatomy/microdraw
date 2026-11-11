const fs = require('fs');
const os = require('os');
const path = require('path');

// data sanitisation
const createDOMPurify = require('dompurify');
const {JSDOM} = require('jsdom');
const {window} = (new JSDOM('', {
  features: {
    FetchExternalResources: false, // disables resource loading over HTTP / filesystem
    ProcessExternalResources: false // do not execute JS within script blocks
  }
}));
const DOMPurify = createDOMPurify(window);

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

    _fitsBroadcastExclusionCriteria: ({data}) => liveRooms.isServerType(data.type),

    _fitsBroadcastInclusionCriteria: ({data}) => {
      let include = false;
      if (data.type === "chat") {
        include = true;
      }

      return include;
    },

    _handleBroadcastWebSocketMessage: function ({data, ws}) {
      // joins and notices are not for the other clients
      if (me._fitsBroadcastExclusionCriteria({data})) {
        return;
      }

      // scan through connected users
      websocketserver.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          // check exclusion criteria
          // if(me._fitsBroadcastExclusionCriteria({sourceUS, targetUS})) {
          //   return;
          // }

          // check inclusion criteria
          // if(!me._fitsBroadcastInclusionCriteria({sourceUS, targetUS, data})) {
          //   return;
          // }

          // sanitise data
          const cleanData = DOMPurify.sanitize(JSON.stringify(data));

          // do broadcast
          try {
            client.send(cleanData);
          } catch (err) {
            log.error({ err }, 'cannot broadcast message');
          }
        }
      });
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
