<template>
  <ul class="layer">
    <li><span style="width:300px;overflow-wrap:anywhere">{{ layer.url }}</span></li>
    <li><b class="layer-item">Name:</b> <span style="width:70px" />{{ layer.name }}</li>
    <li>
      <b class="layer-item"> Opacity (%):</b>
      <input
        type="number"
        class="layer-value"
        :value="layer.opacity * 100"
        @change="emit('updateLayer', index, 'opacity', $event.target.valueAsNumber / 100)"
      >
      <input
        type="range"
        :value="layer.opacity * 100"
        min="0"
        max="100"
        @input="emit('updateLayer', index, 'opacity', $event.target.valueAsNumber / 100)"
        style="width:100px"
      >
    </li>
    <li>
      <b class="layer-item">Position (%)</b>
      <input
        type="number"
        class="layer-value"
        :value="layer.x"
        @change="emit('updateLayer', index, 'x', $event.target.valueAsNumber)"
      >
      <input
        type="number"
        class="layer-value"
        :value="layer.y"
        @change="emit('updateLayer', index, 'y', $event.target.valueAsNumber)"
      >
    </li>
    <li>
      <b class="layer-item">Rotation (deg):</b> <input
        type="number"
        class="layer-value"
        :value="layer.rotation"
        @change="emit('updateLayer', index, 'rotation', $event.target.valueAsNumber)"
      >
    </li>
    <li>
      <b class="layer-item"> First slice:</b> <input
        type="number"
        class="layer-value"
        :value="layer.firstSlice"
        min="0"
        :max="maxSlice"
        @change="emit('updateLayer', index, 'firstSlice', $event.target.valueAsNumber)"
      > (0 - {{ maxSlice }})
    </li>
    <li>
      <b class="layer-item"> Last slice:</b> <input
        type="number"
        class="layer-value"
        :value="layer.lastSlice"
        min="0"
        :max="maxSlice"
        @change="emit('updateLayer', index, 'lastSlice', $event.target.valueAsNumber)"
      > (0 - {{ maxSlice }})
    </li>
    <li>
      <button
        class="delete"
        @click="emit('delete')"
      >
        Delete layer
      </button>
    </li>
  </ul>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  layer: {
    type: Object,
    required: true
  },
  index: {
    type: Number,
    required: true
  }
});

const emit = defineEmits(['delete', 'updateLayer']);
const maxSlice = computed(() => props.layer.imageSources.tileSources.length - 1);

</script>

<style scope>
ul {
  list-style: none;
  padding: 10px;
  margin: 10px;
  border: 1px solid #fff;
}
ul li {
  display: flex;
}
.layer-item {
  display: inline-block;
  width: 120px;
  margin-left: 10px;
}
.layer-value {
    width: 50px;
    text-align: right;
    color: #000;
}
.delete {
  color: #000;
  margin-left: auto;
}
</style>
