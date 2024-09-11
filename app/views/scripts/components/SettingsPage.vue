<template>
  <SettingsPage :project="project" />
</template>
<script setup>
import { SettingsPage } from 'nwl-components';
// import { ref } from 'vue';

// const files = ref([]);
defineProps({
  project: {
    type: Object,
    required: true
  }
});
</script>
