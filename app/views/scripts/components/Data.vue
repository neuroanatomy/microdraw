<template>
  <Header v-if="!fullscreen">
    <span class="title">MicroDraw</span>
  </Header>
  <main
    class="editor"
    :class="{ fullscreen }"
  >
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
  </main>
</template>

<script setup>
import {
  Header,
  Editor,
  OntologySelector
} from 'nwl-components';
import * as Vue from 'vue';

import useVisualization from '../store/visualization';

import LayersManager from './LayersManager.vue';
import Tools from './Tools.vue';

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

Vue.onMounted(async () => {
  await initVisualization();
  window.addEventListener('resize', handleResize);
});
</script>
<style scoped>
.area {
height: calc(100vh - 82px);
width: 100vw;
}
.fullscreen .area {
    height: 100vh;
}

</style>
