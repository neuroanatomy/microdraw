/* global loggedUser */

import 'nwl-components/dist/style.css';
import { createApp, ref } from 'vue';
import { NewProjectPage } from 'nwl-components';
import config from './nwl-components-config';

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

const NewPage = {
  template: `
      <NewProjectPage
        :onKeyDown="checkInput"
        :existing-project="existingProject"
        :validInput="validInput"
      >
        A project contains a list of histological files, a set of vectorials or
        text annotations, and a list of collaborators with their access rights.
        The short name of a project can only contain letters, numbers and hyphens, but
        you can choose a longer display name later.
      </NewProjectPage>
    `,
  setup() {
    const existingProject = ref(false);
    const validInput = ref(true);

    // the name in the input: an answer about an earlier one is dropped
    let typedName = '';

    const checkIfProjectIsExisting = debounce(async (projectName) => {
      // only a 404 means the name is free: a project the user may not see
      // answers 401 or 403, and its name is taken all the same
      const res = await fetch(`/project/json/${encodeURIComponent(projectName)}`);
      if (projectName !== typedName) { return; }
      existingProject.value = (res.status !== 404);
    });

    return {
      existingProject,
      validInput,
      checkInput(event) {
        typedName = event.target.value;
        if(event.target.value.length > 0) {
          validInput.value = (/^[a-zA-Z0-9-]*$/).test(event.target.value);
          // an invalid name is refused before it is looked up: no existence check
          if (validInput.value) {
            checkIfProjectIsExisting(event.target.value);
          } else {
            existingProject.value = false;
          }
        }
      }
    };
  }
};

const app = createApp(NewPage);
app.component('NewProjectPage', NewProjectPage);
app.provide('config', config);
app.provide('user', loggedUser);

app.mount('#app');
