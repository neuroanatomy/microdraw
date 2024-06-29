/* global loggedUser */

import 'nwl-components/dist/style.css';
import Data from '../components/Data.vue';
import config from './nwl-components-config';
import { createApp } from 'vue';


const app = createApp(Data);
app.provide('config', config);
app.provide('user', loggedUser);

app.mount('#app');
