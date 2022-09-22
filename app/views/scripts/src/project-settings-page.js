/* global project, loggedUser */

import 'nwl-components/dist/style.css';
import SettingsPage from '../components/SettingsPage.vue';
import config from './nwl-components-config';
import { createApp } from 'vue';

const app = createApp(SettingsPage, { project });
app.component('SettingsPage', SettingsPage);
app.provide('config', config);
app.provide('user', loggedUser);

app.mount('#app');
