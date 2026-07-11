import { defineConfig } from 'vitepress';
import { buildNav, buildSidebar } from './navigation';

export default defineConfig({
  lang: 'ko-KR',
  base: '/web-fe-roadmap-study/',
  title: 'Web Dev Learn',
  description: 'Learning for Web Developers',
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    image: {
      lazyLoading: true,
    },
  },
  head: [
    [
      'link',
      {
        rel: 'stylesheet',
        as: 'style',
        crossorigin: '',
        href: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css',
      },
    ],
  ],
  sitemap: {
    hostname: 'https://lee-gyu.github.io/web-fe-roadmap-study/',
  },
  srcExclude: ['README.md'],
  themeConfig: {
    nav: buildNav(),
    sidebar: buildSidebar(),
    outline: {
      level: [2, 3],
      label: 'Table of Contents',
    },
    search: {
      provider: 'local',
    },
    docFooter: {
      prev: 'Prev',
      next: 'Next',
    },
    lastUpdated: {
      text: 'Last Updated',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    },
    editLink: {
      pattern: 'https://github.com/lee-gyu/web-fe-roadmap-study/edit/main/docs/:path',
      text: 'Edit on GitHub',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/lee-gyu/web-fe-roadmap-study' },
    ],
    returnToTopLabel: 'To Top',
    sidebarMenuLabel: 'Doc Menu',
    darkModeSwitchLabel: 'Theme',
    lightModeSwitchTitle: 'To Light Mode',
    darkModeSwitchTitle: 'To Dark Mode',
  },
});
