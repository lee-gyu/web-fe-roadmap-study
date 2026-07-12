import DefaultTheme from 'vitepress/theme';
import ReadableDocs from './ReadableDocs.vue';

import '@fontsource/nanum-gothic-coding/400.css';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ReadableDocs', ReadableDocs);
  },
};
