import {initMotion} from './app/motion'
import { createApp } from 'vue'

import App from './App.vue'
import './style.css'
import './app/shell.css'
import { initTheme } from './app/theme'
import { installSessionGuard } from './app/api'

initTheme()
initMotion()
installSessionGuard()
createApp(App).mount('#app')
