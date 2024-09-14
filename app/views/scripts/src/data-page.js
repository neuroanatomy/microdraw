/* global loggedUser */

import 'nwl-components/dist/style.css';
import { createApp } from 'vue';

import Data from '../components/Data.vue';

import config from './nwl-components-config';


const app = createApp(Data);
app.provide('config', config);
app.provide('user', loggedUser);

app.mount('#app');
