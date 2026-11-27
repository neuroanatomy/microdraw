/**
 * Websocket
 */

/* global Microdraw */

let wshostname;
if(Microdraw.secure) {
  wshostname = "wss://" + Microdraw.wshostname;
} else {
  wshostname = "ws://" + Microdraw.wshostname;
}
let ws = null;

const randomUuid = Math.floor(Math.random() * 65535);

const _decodeRandomUuidToNickname = (n) => {
  if (typeof n !== 'number') {
    throw new Error('argument to _decodeRandomUuidToNickname must be a number.');
  }
  if (Number.isNaN(n)) {
    throw new Error('argument to _decodeRandomUuidToNickname cannot be NaN');
  }
  const { HippyHippo } = window.HippyHippo;

  return HippyHippo.getNickName(n);
};

// The chat log (#logChat .text), as nwl-components/chat's chatLog: the name in bold, then
// `(me)` in italics for an own line, then the text, all as text, never parsed as HTML.
let chatLog = null;
const _chatLog = () => {
  if (!chatLog) {
    chatLog = window.nwlComponentsChat.chatLog(Microdraw.dom.querySelector("#logChat .text"));
  }

  return chatLog;
};

/**
  * @param {object} data Data received
  * @returns {void}
  */
const receiveChatMessage = (data) => {
  let theUsername = "Anonymous";
  if (typeof data.username === "string" && data.username !== "Anonymous") {
    theUsername = data.username;
  } else if (typeof data.randomUuid === 'number') {
    theUsername = _decodeRandomUuidToNickname(data.randomUuid);
  }
  _chatLog().append({ name: theUsername, own: false, text: String(data.msg) });
};

const _getUserName = () => {
  let username = document.querySelector("#MyLogin a").innerText;

  if (typeof username === "undefined" || username === "Log in with GitHub") {
    username = "Anonymous";
  }

  return username;
};

const _makeMessageObject = (msg) => ({
  type: "chat",
  msg,
  randomUuid,
  username: _getUserName()
});

const _displayOwnMessage = (msg) => {
  const _username = _getUserName();
  const username = _username === 'Anonymous'
    ? _decodeRandomUuidToNickname(randomUuid)
    : _username;
  _chatLog().append({ name: username, own: true, text: msg });
};

/**
  * @param {string} msg The text typed in #msg (trimmed and not empty: chatInput)
  * @returns {void}
  */
const sendChatMessage = (msg) => {
  const obj = _makeMessageObject(msg);

  try {
    ws.send(JSON.stringify(obj));
    _displayOwnMessage(obj.msg);
  } catch (ex) {
    console.log("ERROR: Unable to sendChatMessage", ex);
  }
};

/*
  Live updates (simultaneous editing step 3b). The viewer joins the room of
  the slice it shows, {type: 'join', project, source, slice}, and again after
  a reconnect. A join-refused is final for that slice: no retry. A saved
  notice goes to Microdraw.liveSaved, which fetches the slice again through
  the access-checked HTTP route: no field of a notice goes into the page.
*/
let liveTarget = null;
const refusedJoins = new Set();
const joinKey = ({ project, source, slice }) => JSON.stringify([project, source, String(slice)]);

const sendJoin = () => {
  if (!liveTarget || refusedJoins.has(joinKey(liveTarget)) || !ws || ws.readyState !== window.WebSocket.OPEN) {
    return;
  }
  try {
    ws.send(JSON.stringify({ type: 'join', ...liveTarget }));
  } catch (ex) {
    console.log("Unable to join the slice's live updates", ex);
  }
};

const isString = (value) => typeof value === 'string';

const receiveSaved = (data) => {
  if (!isString(data.project) || !isString(data.source) || !isString(data.slice)) {
    return;
  }
  Microdraw.liveSaved({ project: data.project, source: data.source, slice: data.slice });
};

const receiveJoinRefused = (data) => {
  const key = joinKey(data);
  if (liveTarget && key === joinKey(liveTarget)) {
    refusedJoins.add(key);
    console.info("No live updates for this slice:", String(data.reason));
  }
};

// A message from an admin to every viewer (T002 3.6): shown as text, never
// as HTML, until dismissed; a new message replaces the one shown
const receiveNotice = (data) => {
  const el = Microdraw.dom && Microdraw.dom.querySelector("#adminNotice");
  if (!isString(data.msg) || !el) {
    return;
  }
  el.querySelector(".text").textContent = data.msg;
  el.querySelector("button.close").onclick = () => el.classList.remove("shown");
  el.classList.add("shown");
};

const receiveFunctions = {
  "chat": receiveChatMessage,
  "notice": receiveNotice,
  "saved": receiveSaved,
  "join-refused": receiveJoinRefused
};

/**
* @param {object} msg The message received
* @returns {void}
*/
const receiveSocketMessage = (msg) => {
  let data;
  try {
    data = JSON.parse(msg.data);
  } catch (ex) {
    return;
  }
  // others ('joined') need nothing
  if (data && Object.prototype.hasOwnProperty.call(receiveFunctions, data.type)) {
    receiveFunctions[data.type](data);
  }
};

// The first connection announces the user in the chat; reconnections don't.
let entered = false;
const onOpen = () => {
  console.log("open");

  const {dom} = Microdraw;
  dom.querySelector("#notifications").innerHTML = "Chat";

  if (!entered) {
    entered = true;
    // Enter in #msg sends its text (nwl-components/chat), set once: reconnections reuse it
    window.nwlComponentsChat.chatInput(dom.querySelector("#msg"), sendChatMessage);
    const obj = {
      type: "chat",
      msg: "entered",
      randomUuid,
      username: _getUserName()
    };
    ws.send(JSON.stringify(obj));
  }

  sendJoin();
};

// Reconnect after a close, waiting 1 s, 2 s, 4 s ... up to 30 s. The wait
// starts again from 1 s only after a connection that stayed open 10 s, so a
// server that accepts and drops connections at once is not retried quickly.
const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 30000;
const STABLE_CONNECTION = 10000;
let reconnectDelay = RECONNECT_MIN;

const connect = () => {
  let openedAt = null;
  ws = new window.WebSocket(wshostname);
  ws.onopen = () => {
    openedAt = Date.now();
    onOpen();
  };
  ws.onmessage = receiveSocketMessage;
  ws.onerror = () => {
    console.log("error");
  };
  ws.onclose = () => {
    if (openedAt !== null && Date.now() - openedAt >= STABLE_CONNECTION) {
      reconnectDelay = RECONNECT_MIN;
    }
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(2 * reconnectDelay, RECONNECT_MAX);
  };
};

window.MicrodrawWS = {

  /**
   * Follow the saves of the slice on screen.
   * @param {object} target {project, source, slice}, as the save sends them
   * @returns {void}
   */
  joinSlice: (target) => {
    liveTarget = { project: target.project, source: target.source, slice: String(target.slice) };
    sendJoin();
  }
};

connect();
