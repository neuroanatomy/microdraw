/* global Microdraw */

/**
 * Shared state for the project page components
 */

import { reactive, toRefs } from 'vue';

const state = reactive({
  title: 'Loading...',
  notification: '',
  receivedMessages: [],
  displayChat: true,
  displayScript: false,
  displayOntology: false,
  ontology: null,
  currentLabel: 0,
  currentFile: null,
  currentTool: 'navigate',
  currentSlice: 0,
  totalSlices: 0,
  fullscreen: false
});

const loadScript = (path, testScriptPresent) => new Promise((resolve, reject) => {
  if(testScriptPresent && testScriptPresent()) {
    resolve();
  }
  const s = document.createElement("script");
  s.src = path;
  s.onload=resolve;
  s.onerror=reject;
  document.body.appendChild(s);
});

const attachMicrodraw = async () => {
  const res = await fetch("/microdraw");
  const txt = await res.text();
  const parser = new DOMParser();
  const elem = parser.parseFromString(txt, 'text/html').documentElement;
  const shadow = document.querySelector("#microdraw").attachShadow({mode: 'open'});
  shadow.appendChild(elem);
  await loadScript("/js/microdraw.js");
  await Microdraw.init(shadow);
  state.ontology = Microdraw.ontology;
};

export default function useVisualization() {
  const handleNewChatMessages = (event) => {
    state.receivedMessages.push(event.detail.message);
  };

  const handleNewNotification = (event) => {
    state.notification = event.detail.notification;
  };

  const setupEventListeners = () => {
    window.addEventListener('brainImageConfigured', (e) => {
      state.title = `Slice ${e.detail.currentSlice}`;
      state.currentSlice = e.detail.currentSlice;
      state.totalSlices = e.detail.totalSlices;
    });

    window.addEventListener('newMessage', handleNewChatMessages);
    window.addEventListener('newNotification', handleNewNotification);
  };

  return {
    ...toRefs(state),
    async init() {
      setupEventListeners();
      await attachMicrodraw();
    }

  };
}

