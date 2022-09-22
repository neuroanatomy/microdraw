<template>
    <ProjectPage
      @resize="handleResize"
      @layout-change="handleLayoutChange"
      :project="{...project, title: project.name}"
      :fullscreen="fullscreen"
    >
      <template v-slot:left>
        <TextAnnotations
          :extract-keys="extractTextKeys"
          :link-prefix="linkPrefix"
          :files="files"
          :selected="selectedFileIndex"
          @select-file="selectFile"
      />
      <VolumeAnnotations
        :extract-keys="extractVolumeKeys"
        :annotations="volumeAnnotations"
        @select-annotation="() => {}"
      />
      </template>
      <template v-slot:right>
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
      </template>
    </ProjectPage>
  </template>
  
  <script setup>
  import { forEach, get, set } from "lodash";
  import { initSyncedStore, waitForSync } from "../store/synced";
  import useVisualization from "../store/visualization";
  import { enableVueBindings } from "@syncedstore/core";
  import Tools from "./Tools.vue";
  import {
    Editor,
    OntologySelector,
    ProjectPage,
    TextAnnotations,
    VolumeAnnotations
  } from "nwl-components";
  import * as Vue from "vue";
  
  const { store, webrtcProvider, doc } = initSyncedStore(projectInfo.shortname);
  const { baseURL } = Vue.inject('config');
  
  // make SyncedStore use Vuejs internally
  enableVueBindings(Vue);
  
  const props = defineProps({
    project: {
      type: Object,
      required: true,
    },
    selectedFile: {
      type: String,
      required: true,
    },
  });
  
  const linkPrefix = `${baseURL}/project/${projectInfo.shortname}?source=`
  const files = Vue.ref(projectInfo.files.list);
  const selectedFileIndex = projectInfo.files.list.findIndex(file => file.source === props.selectedFile);
  doc.getArray("files").observe(() => {
    files.value.splice(0, files.value.length);
    files.value.push(...store.files);
  });

  const textAnnotations = projectInfo.annotations.list.filter(anno => anno.type !== 'vectorial');
  const volumeAnnotations = projectInfo.annotations.list.filter(anno => anno.type === 'vectorial');
  
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
  
  const extractTextKeys = (_files) => {
    if (!_files) {
      return;
    }
    const keys = new Map();
    keys.set("Name", "name");
    keys.set("File", "source");
    return keys;
  };
  
  const extractVolumeKeys = () => {
    const keys = new Map();
    keys.set("Name", "name");
    keys.set("Labels set", "values");
  
    return keys;
  };
  
  const syncMicrodraw = () => {
    console.log('sync microdraw')
  }
  
  const valueChange = (content, index, selector) => {
    const sel =
      typeof selector === "string" ? [index, selector] : [index, ...selector];
    set(store.files, sel, content);
    syncMicrodraw();
  };

  const selectFile = async (file) => {
    window.location = `${linkPrefix}${file.source}`
  }
  
  const setupKeyDownListeners = () => {
    document.addEventListener("keydown", (event) => {
      const selectedTr = document.querySelector("tr.selected");
      switch (event.key) {
        case "ArrowUp":
          if (!selectedTr) {
            return;
          }
          if (selectedTr.previousElementSibling) {
            selectedTr.previousElementSibling.click();
          }
          break;
        case "ArrowDown":
          if (!selectedTr) {
            return;
          }
          if (selectedTr.nextElementSibling) {
            selectedTr.nextElementSibling.click();
          }
          break;
        default:
          break;
      }
    });
  };
  
  const delay = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };
  
  const handleLayoutChange = () => {
    Microdraw.resizeAnnotationOverlay();
  };
  
  const handleResize = () => {
    Microdraw.resizeAnnotationOverlay();
  };

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
    setupKeyDownListeners();
    await waitForSync(webrtcProvider);
    await initVisualization();
    window.addEventListener('resize', handleResize);
  });
  </script>
  <style>
  table {
    width: 100%;
  }
  table + table {
    margin-top: 20px;
  }
  </style>