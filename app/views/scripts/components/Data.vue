<template>
    <Header v-if="!fullscreen">
      <span class="title">MicroDraw</span>
    </Header>
    <main :class="{ fullscreen }">
      <OntologySelector
        :ontology="ontology"
        :open="displayOntology"
        @on-close="displayOntology = false"
        @label-click="handleOntologyLabelClick"
      />
      <Editor :title="title" :class="{reduced: !displayChat && !displayScript}" toolsMinHeight="300px">
        <template v-slot:tools>
          <Tools />
        </template>
        <template v-slot:content>
          <div id="microdraw" style="width: 100%; height: 100%"></div>
        </template>
      </Editor>
    </main>
  </template>
    
  <script setup>
    import useVisualization from "../store/visualization";
    import Tools from "./Tools.vue";
    import {
      Header,
      Editor,
      OntologySelector,
    } from "nwl-components";
    import * as Vue from "vue";
  
    const { baseURL } = Vue.inject('config');
      
    const {
      title,
      displayChat,
      displayScript,
      displayOntology,
      currentLabel,
      ontology,
      currentSlice,
      currentFile,
      totalSlices,
      fullscreen,
      init: initVisualization,
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
    }
  
    Vue.watch(fullscreen, toggleFullScreen);
  
    const _findSelectedRegion = () => {
      const {currentImage, region} = Microdraw;
      const {Regions: regions} = Microdraw.ImageInfo[currentImage];
      return regions.findIndex(reg => reg.uid === region.uid);
    };
  
    const handleOntologyLabelClick = (index) => {
      Microdraw.currentLabelIndex = index;
      displayOntology.value = false;
      currentLabel.value = index;
      const regionIndex = _findSelectedRegion();
      if(regionIndex != null) {
        const { region } = Microdraw;
        if (region != null) {
          Microdraw.changeRegionName(region, Microdraw.ontology.labels[index].name);
        }
      }
    }
    
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