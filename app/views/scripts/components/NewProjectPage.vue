<template>
  <NewProjectPage
    :on-key-down="checkInput"
    :existing-project="existingProject"
    :valid-input="validInput"
  >
    A project contains a list of histological files, a set of vectorials or
    text annotations, and a list of collaborators with their access rights.
    The short name of a project can only contain letters and numbers, but
    you can choose a longer display name later.
  </NewProjectPage>
</template>
<script setup>
import { NewProjectPage } from 'nwl-components';
import { ref } from 'vue';

const existingProject = ref(false);
const validInput = ref(true);

const debounce = (callback, delay = 250) => {
  let timeoutId;

  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      callback(...args);
    }, delay);
  };
};

const checkIfProjectIsExisting = debounce(async (projectName) => {
  const res = await fetch(`/project/json/${projectName}`);
  existingProject.value = (res.status === 200);
});

const checkInput = (event) => {
  if(event.target.value.length > 0) {
    checkIfProjectIsExisting(event.target.value);
    validInput.value = (/^[a-zA-Z0-9]*$/).test(event.target.value);
  }
};
</script>
