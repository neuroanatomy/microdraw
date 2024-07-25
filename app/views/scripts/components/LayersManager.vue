<template>
  <div
    class="wrapper"
    :style="properties"
    v-if="open"
    ref="wrapperRef"
    @mouseup="onHeaderMouseUp"
  >
    <div
      class="header"
      @mousedown="onHeaderMouseDown"
    >
      <b>Layers</b>
      <img
        id="layers-close"
        class="button"
        alt="close"
        src="/img/times-circle.svg"
        @click="emit('onClose')"
      >
    </div>
    <div class="contents">
      <div class="layersList">
        <Layer
          v-for="(layer, index) in layers"
          :index="index"
          :key="layer.url"
          :layer="layer"
          @delete="deleteLayer(index)"
          @update-layer="updateLayer"
        />
      </div>
      <div
        class="addLayerPanel"
        v-if="displayAddRow"
      >
        <b>Name</b>
        <input
          type="text"
          placeholder="Name of the layer"
          style="width:100%"
          v-model="newLayerName"
        >
        <b>Source</b>
        <input
          type="text"
          placeholder="Source of the layer"
          style="width:100%"
          :class="{ hasSourceError }"
          v-model="newLayerSource"
        >
        <button @click="addLayer">
          Add
        </button>
        <button @click="cancelAddRow">
          Cancel
        </button>
      </div>
      <button
        @click="addRow"
        class="addRow"
        v-if="!displayAddRow"
      >
        Add layer
      </button>
    </div>
  </div>
</template>
<script setup>
/* global Microdraw */
import { ref, computed, onMounted, onUnmounted } from 'vue';

import Layer from './Layer.vue';

defineProps({
  open: Boolean
});

const layers = ref([]);

const isDragging = ref(false);
const clickOffset = ref({ x: 0, y: 0 });
const areaOffset = ref({ x: 0, y: 0 });
const position = ref({ x: 0, y: 0 });
const wrapperRef = ref(null);

const displayAddRow = ref(false);
const newLayerName = ref('');
const newLayerSource = ref('');
const hasSourceError = ref(false);

const emit = defineEmits(['onClose']);
const properties = computed(() => ({
  '--left': `${position.value.x}px`,
  '--top': `${position.value.y}px`
}));

const onHeaderMouseDown = (e) => {
  isDragging.value = true;
  const {top: atop, left: aleft} = document.querySelector('.editor .area').getBoundingClientRect();
  const {top, left} = wrapperRef.value.getBoundingClientRect();
  areaOffset.value = { x: aleft, y: atop};
  clickOffset.value.x = e.clientX - left;
  clickOffset.value.y = e.clientY - top;
};

const onHeaderMouseUp = () => {
  isDragging.value = false;
};

const fetchDZI = async (url) => {
  let dzi = null;

  try {
    const response0 = await fetch(url, { method: 'HEAD' });
    if (response0.ok) {
      const response = await fetch(url);
      dzi = await response.json();
    }
  } catch (error) {
    console.log('Error:', error);
  }

  return dzi;
};

const addLayerToViewer = (url, tileIndex, imageSources, opacity) => {
  let tileSource = imageSources.tileSources[tileIndex];
  if (tileSource[0] === '/') {
    const tmp = new URL(url);
    tileSource = tmp.origin + tileSource;
  }
  const options = {
    tileSource,
    opacity,
    compositeOperation: 'source-over'
  };
  Microdraw.viewer.addTiledImage(options);
};

const updateLayer = (index, property, value) => {
  layers.value[index][property] = value;
  const viewerItem = Microdraw.viewer.world.getItemAt(index + 1);
  const layer = layers.value[index];
  viewerItem.setPosition({x: layer.x, y: layer.y });
  viewerItem.setRotation(layer.rotation);
  viewerItem.setOpacity(layer.opacity);
};

const updateLayers = () => {
  // return if there's no layers
  if (layers.value.length === 0) {
    return;
  }

  // current slice index
  const currentImage = Number(Microdraw.currentImage);

  // total number of slices
  const totalImages = Microdraw.imageOrder.length;

  // get 1st and last slice of layers[0]
  const layerIndex = 0;
  const {url, opacity, firstSlice, lastSlice, imageSources} = layers.value[layerIndex];

  // get the sliceIndex in layers[0] corresponding to sliceIndex in the viewer
  const [a0, a1, l0, l1] = [0, totalImages - 1, firstSlice, lastSlice];
  // ia = (il) => {a0=6;a1=58;l0=94;l1=12;m=(l0-l1)/(a0-a1);n=l0-a0*m;return (il-n)/m};
  const il = (ia) => {
    const m=(l0-l1)/(a0-a1); const n=l0-a0*m;

    return ia*m+n;
  };
  const tileIndex = Math.floor(il(currentImage));
  addLayerToViewer(url, tileIndex, imageSources, opacity);

};

const addLayer = async () => {
  const dzi = await fetchDZI(newLayerSource.value);
  if (!dzi) {
    hasSourceError.value = true;

    return;
  }

  layers.value.push({
    name: newLayerName.value,
    url: newLayerSource.value,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 0.5,
    imageSources: dzi,
    firstSlice: 0,
    lastSlice: dzi.tileSources.length - 1
  });

  displayAddRow.value = false;
  hasSourceError.value = false;
  newLayerName.value = '';
  newLayerSource.value = '';

  updateLayers();
};

const deleteLayer = (index) => {
  layers.value.splice(index, 1);
  const currentImageIndex = Microdraw.imageOrder.indexOf(Microdraw.currentImage);
  Microdraw.loadImage(currentImageIndex);
};


const addRow = () => {
  displayAddRow.value = true;
};

const cancelAddRow = () => {
  displayAddRow.value = false;
};

const onMouseMove = (e) => {
  if (!isDragging.value) { return; }
  position.value.x = e.clientX - areaOffset.value.x - clickOffset.value.x;
  position.value.y = e.clientY - areaOffset.value.y - clickOffset.value.y;
};

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('updateMicrodrawLayers', updateLayers);
});

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('updateMicrodrawLayers', updateLayers);
});


</script>
<style scoped>
.wrapper {
  background: rgba(0, 0, 0, 0.8);
  position: absolute;
  width: 600px;
  height: 300px;
  z-index: 999;
  top: var(--top);
  left: var(--left);
  display: flex;
  flex-direction: column;
}
.header {
  user-select: none;
  height: 36px;
  background-color: #666;
  padding: 0 5px 0 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.contents {
  display: flex;
  flex-direction: column;
  padding: 0;
  align-items: flex-start;
  flex: 1;
}
.addRow {
  margin-top: auto;
  margin-left: 10px;
  margin-bottom: 10px;
}
.addLayerPanel {
  background-color: #333;
  padding: 10px;
  margin-top: auto;
  width: 100%;
}

.hasSourceError {
  background-color: rgb(255, 204, 204);
}

button {
  color: black;
}

input[type=text] {
  color: #000;
}

.layersList {
  overflow-y: auto;
  height: 222px;
  width: 100%;
}
</style>
