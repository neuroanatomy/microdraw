<template>
  <main class="editor">
    <OntologySelector
      :ontology="ontology"
      :open="displayOntology"
      @on-close="displayOntology = false"
      @label-click="handleOntologyLabelClick"
    />
    <Editor
      :title="title"
      :class="{reduced: !displayChat && !displayScript}"
      tools-min-height="320px"
    >
      <template #tools>
        <Tools />
      </template>
      <template #content>
        <LayersManager
          :open="displayLayers"
          @on-close="displayLayers = false"
        />

        <div
          id="microdraw"
          style="width: 100%; height: 100%"
        />
      </template>
    </Editor>
    <select
      @change="onFileSelect"
      class="fileSelector"
      :value="selectedFile"
    >
      <option
        v-for="file in files"
        :key="file.source"
        :value="file.source"
      >
        {{ file.name || file.source }}
      </option>
    </select>
  </main>
</template>

<script setup>
/* globals Microdraw projectInfo */
import {
  Editor,
  OntologySelector
} from 'nwl-components';
import * as Vue from 'vue';

import useVisualization from '../store/visualization';

import LayersManager from './LayersManager.vue';
import Tools from './Tools.vue';


const files = projectInfo.files.list;
const { baseURL } = Vue.inject('config');

defineProps({
  project: {
    type: Object,
    required: true
  },
  selectedFile: {
    type: String,
    required: true
  }
});

defineEmits(['change']);

const {
  title,
  displayChat,
  displayScript,
  displayOntology,
  displayLayers,
  currentLabel,
  ontology,
  fullscreen,
  init: initVisualization
} = useVisualization();

const handleResize = () => {
  Microdraw.resizeAnnotationOverlay();
};

const toggleFullScreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  }
};

Vue.watch(fullscreen, toggleFullScreen);

const _findSelectedRegion = () => {
  const {currentImage, region} = Microdraw;
  const {Regions: regions} = Microdraw.ImageInfo[currentImage];

  return regions.findIndex((reg) => reg.uid === region.uid);
};

const handleOntologyLabelClick = (index) => {
  Microdraw.currentLabelIndex = index;
  displayOntology.value = false;
  currentLabel.value = index;
  const regionIndex = _findSelectedRegion();
  if(regionIndex !== null && typeof regionIndex !== 'undefined') {
    const { region } = Microdraw;
    if (region !== null && typeof region !== 'undefined') {
      Microdraw.changeRegionName(region, Microdraw.ontology.labels[index].name);
    }
  }
};

const onFileSelect = (event) => {
  const file = projectInfo.files.list.find((f) => f.source === event.target.value);
  window.location = `${baseURL}/project/${projectInfo.shortname}/embed/?source=${file.source}`;
};

Vue.onMounted(async () => {
  await initVisualization();
  window.addEventListener('resize', handleResize);
});
</script>
  <style>
  .area {
    width: 100vw;
    height: 100vh;
  }
  .fileSelector {
    position: absolute;
    left: 10px;
    bottom: 35px;
    z-index: 100;
    color: black;
    background-color: white;
    border: 1px solid black;
    padding: 5px;
  }
  </style>
