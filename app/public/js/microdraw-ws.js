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
var ws = new window.WebSocket(wshostname);

/**
  * @param {object} data Data received
  * @returns {void}
  */
const receiveChatMessage = (data) => {
  const {dom} = Microdraw;
  let theUsername;
  if (data.username !== "Anonymous") {
    theUsername = data.username;
  } else {
    if (typeof data.randomUuid === 'number') {
      theUsername = _decodeRandomUuidToNickname(data.randomUuid);
    } else {
      theUsername = data.uid;
    }
  }
  const msg = "<b>" + theUsername + ":</b> " + data.msg + "<br />";
  dom.querySelector("#logChat .text").innerHTML += msg;
  dom.querySelector("#logChat .text").scrollTop = dom.querySelector("#logChat .text").scrollHeight;
};

const randomUuid = Math.floor(Math.random() * 65535);

const adjectives = [
  "affectionate",
  "agreeable",
  "amiable",
  "bright",
  "charming",
  "creative",
  "determined",
  "diligent",
  "diplomatic",
  "dynamic",
  "energetic",
  "friendly",
  "hardworking",
  "helpful",
  "imaginative",
  "kind",
  "likable",
  "loyal",
  "patient",
  "polite",
  "sincere",
];

const nouns = [
  "Alpaca",
  "Badger",
  "Bee",
  "Camel",
  "Cat",
  "Caterpillar",
  "Chipmunk",
  "Crab",
  "Cricket",
  "Deer",
  "Donkey",
  "Dove",
  "Dragonfly",
  "Duck",
  "Eagle",
  "Elephant",
  "Emu",
  "Flamingo",
  "Fox",
  "Frog",
  "Goose",
  "Gopher",
  "Gorilla",
  "Hamster",
  "Hare",
  "Hippo",
  "Hummingbird",
  "Kangaroo",
  "Ladybug",
  "Leopard",
  "Lion",
  "Mongoose",
  "Mouse",
  "Octopus",
  "Otter",
  "Owl",
  "Panda",
  "Parrot",
  "Peacock",
  "Pelican",
  "Penguin",
  "Pig",
  "Pigeon",
  "Porcupine",
  "Rabbit",
  "Walrus",
  "Whale",
].map(v => v.toLowerCase());

const _decodeRandomUuidToNickname = n => {
  if (typeof n !== 'number') {
    throw new Error('argument to _decodeRandomUuidToNickname must be a number.');
  }
  if (Number.isNaN(n)) {
    throw new Error('argument to _decodeRandomUuidToNickname cannot be NaN');
  }
  // cast any non NaN number to uint32 integer... I think...
  const index = new Uint32Array(new Float32Array([n]).buffer)[0];
  const adjective = adjectives[index % adjectives.length];
  const noun = nouns[index % nouns.length];
  return `${adjective} ${noun}`;
};

const _getUserName = () => {
  let username = document.querySelector("#MyLogin a").innerText;

  if (typeof username === "undefined" || username === "Log in with GitHub") {
    username = "Anonymous";
  }

  return username;
};

const _makeMessageObject = () => {
  const {dom} = Microdraw;

  const msg = dom.querySelector('input#msg').value;

  return {
    type: "chat",
    msg,
    randomUuid,
    username: _getUserName()
  };
};

const _displayOwnMessage = (msg) => {
  const {dom} = Microdraw;
  const _username = _getUserName()
  const username = _username === 'Anonymous'
    ? _decodeRandomUuidToNickname(randomUuid)
    : _username;
  msg = `<b>${username}</b> <i>(me)</i>: ${msg}<br />`;
  dom.querySelector("#logChat .text").innerHTML += msg;
  dom.querySelector("#logChat .text").scrollTop = dom.querySelector("#logChat .text").scrollHeight;
  dom.querySelector('input#msg').value = "";
};

/**
  * @returns {void}
  */
const sendChatMessage = () => {
  const obj = _makeMessageObject();

  try {
    ws.send(JSON.stringify(obj));
    _displayOwnMessage(obj.msg);
  } catch (ex) {
    console.log("ERROR: Unable to sendChatMessage", ex);
  }
};

const receiveFunctions = {
  "chat": receiveChatMessage
};

/**
* @param {object} msg The message received
* @returns {void}
*/
const receiveSocketMessage = (msg) => {
  var data = JSON.parse(msg.data);
  receiveFunctions[data.type](data);
};

ws.onopen = () => {
  console.log("open");

  const {dom} = Microdraw;
  dom.querySelector("#msg").onkeypress = (e) => {
    if (e.keyCode === 13) {
      sendChatMessage();
    }
  };

  dom.querySelector("#notifications").innerHTML = "Chat";

  const obj = {
    type: "chat",
    msg: "entered",
    randomUuid,
    username: _getUserName()
  };
  ws.send(JSON.stringify(obj));
};

ws.onmessage = receiveSocketMessage;

ws.onerror = () => {
  console.log("error");
};
