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
          :files="store.files"
          :selected="selectedFileIndex"
          @value-change="valueChange"
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
  import useVisualization from "../store/visualization";
  import { HocuspocusProvider } from "@hocuspocus/provider";
  import { syncedStore, getYjsDoc, enableVueBindings } from "@syncedstore/core";
  import Tools from "./Tools.vue";
  import {
    Editor,
    OntologySelector,
    ProjectPage,
    TextAnnotations,
    VolumeAnnotations
  } from "nwl-components";
  import * as Vue from "vue";
  
  // make SyncedStore use Vuejs internally
  enableVueBindings(Vue);

  const store = syncedStore({ files: [], fragment: "xml" });
  const doc = getYjsDoc(store);

  const crdtProvider = new HocuspocusProvider({
    url: "ws://0.0.0.0:8081", // FIXME
    name: projectInfo.shortname,
    document: doc
  });

  const { baseURL } = Vue.inject('config');
    
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
  const selectedFileIndex = projectInfo.files.list.findIndex(file => file.source === props.selectedFile);

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
    forEach(textAnnotations, (annotation) => {
      if (annotation.display)
        keys.set(annotation.name, `${annotation.name}`);
    });
    return keys;
  };
  
  const extractVolumeKeys = () => {
    const keys = new Map();
    keys.set("Name", "name");
    keys.set("Labels set", "values");
  
    return keys;
  };
  
  const valueChange = (content, index, selector) => {
    const sel =
      typeof selector === "string" ? [index, selector] : [index, ...selector];
      set(store.files, sel, content);
  };

  const selectFile = async (file) => {
    // No-op. We'd rather let user click on a link.
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
            selectedTr.previousElementSibling.querySelector('a[href]').click();
          }
          break;
        case "ArrowDown":
          if (!selectedTr) {
            return;
          }
          if (selectedTr.nextElementSibling) {
            selectedTr.nextElementSibling.querySelector('a[href]').click();
          }
          break;
        default:
          break;
      }
    });
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
    crdtProvider.on('synced', () => {
      if (store.files.length === 0) {
        store.files.push(...projectInfo.files.list);
        forEach(textAnnotations, (annotation) => {
          forEach(annotation.values, (value, source) => {
            const file = store.files.find(file => file.source === source);
            if (file) file[annotation.name] = value;
          });
        });
      }
    });
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