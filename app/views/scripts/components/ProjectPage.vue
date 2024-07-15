<template>
  <ProjectPage
    @resize="handleResize"
    @layout-change="handleLayoutChange"
    :project="{...project, title: project.name}"
    :fullscreen="fullscreen"
  >
    <template #left>
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
    <template #right>
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
    </template>
  </ProjectPage>
</template>

<script setup>
/* globals Microdraw projectInfo */
import { HocuspocusProvider } from '@hocuspocus/provider';
import { enableVueBindings, getYjsDoc, syncedStore } from '@syncedstore/core';
import { forEach, set } from 'lodash';
import {
  Editor,
  OntologySelector,
  ProjectPage,
  TextAnnotations,
  VolumeAnnotations
} from 'nwl-components';
import * as Vue from 'vue';

import config from '../../../../cfg.json';
import useVisualization from '../store/visualization';

import LayersManager from './LayersManager.vue';
import Tools from './Tools.vue';

// make SyncedStore use Vuejs internally
enableVueBindings(Vue);

const store = syncedStore({ files: [], fragment: 'xml' });
const doc = getYjsDoc(store);

const crdtProvider = new HocuspocusProvider({
  url: config.crdt_backend_url,
  name: projectInfo.shortname,
  document: doc
});

const { baseURL } = Vue.inject('config');

defineProps({
  project: {
    type: Object,
    required: true
  }
});

const linkPrefix = `${baseURL}/data?source=`;
const sourceFile = new URL(document.location).searchParams.get('source');
const selectedFileIndex = Vue.ref(projectInfo.files.list.findIndex((file) => file.source === sourceFile));

const textAnnotations = projectInfo.annotations.list.filter((anno) => anno.type !== 'vectorial');
const volumeAnnotations = projectInfo.annotations.list.filter((anno) => anno.type === 'vectorial');

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

const extractTextKeys = (_files) => {
  if (!_files) {
    return;
  }
  const keys = new Map();
  keys.set('Name', 'name');
  keys.set('File', 'source');
  forEach(textAnnotations, (annotation) => {
    if (annotation.display) { keys.set(annotation.name, `${annotation.name}`); }
  });

  return keys;
};

const extractVolumeKeys = () => {
  const keys = new Map();
  keys.set('Name', 'name');
  keys.set('Labels set', 'values');

  return keys;
};

const valueChange = (content, index, selector) => {
  const sel =
      typeof selector === 'string' ? [index, selector] : [index, ...selector];
  set(store.files, sel, content);
};

const selectFile = async ( file ) => {
  const selectedFile = {...file};
  console.log(selectedFile);
  const openedFile = projectInfo.files.list[selectedFileIndex.value];
  if (selectedFile.source === openedFile.source) {
    return;
  }
  const url = new URL(window.location);
  url.searchParams.set('source', selectedFile.source);
  window.history.pushState({}, '', url);
  selectedFileIndex.value = projectInfo.files.list.findIndex((f) => f.source === selectedFile.source);

  await Microdraw.reloadImage();
};

const setupKeyDownListeners = () => {
  document.addEventListener('keydown', (event) => {
    const selectedTr = document.querySelector('tr.selected');
    switch (event.key) {
    case 'ArrowUp':
      if (!selectedTr) {
        return;
      }
      if (selectedTr.previousElementSibling) {
        selectedTr.previousElementSibling.click();
      }
      break;
    case 'ArrowDown':
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

const handleLayoutChange = () => {
  Microdraw.resizeAnnotationOverlay();
};

const handleResize = () => {
  Microdraw.resizeAnnotationOverlay();
};

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
  if(regionIndex !== null) {
    const { region } = Microdraw;
    if (region !== null) {
      Microdraw.changeRegionName(region, Microdraw.ontology.labels[index].name);
    }
  }
};

Vue.onMounted(async () => {
  setupKeyDownListeners();
  crdtProvider.on('synced', () => {
    if (store.files.length === 0) {
      store.files.push(...projectInfo.files.list);
      forEach(textAnnotations, (annotation) => {
        forEach(annotation.values, (value, source) => {
          const file = store.files.find((f) => f.source === source);
          if (file) { file[annotation.name] = value; }
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
