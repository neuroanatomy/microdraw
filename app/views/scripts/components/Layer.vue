<template>
  <ul class="layer">
    <li><span>{{ layer.name }}</span></li>
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
      <button
        @click="showDetails = !showDetails"
        class="toggle-button"
      >
        <span v-if="showDetails">&#8896;</span>
        <span v-else>&#8897;</span>
      </button>
    </li>

    <template v-if="showDetails">
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
      <span style="overflow-wrap:anywhere">{{ layer.url }}</span>
    </template>
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
import { ref, computed } from 'vue';

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

const showDetails = ref(false);
</script>

<style scoped>
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
.toggle-button {
  cursor: pointer;
  width: 30px;
  margin-left: 10px;
  align-items: center;
}
.toggle-button span {
  color: #000;
  transform: scaleX(2);
  display: inline-block;
}
</style>
