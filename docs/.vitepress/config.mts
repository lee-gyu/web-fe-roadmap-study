import { defineConfig } from 'vitepress';
import { buildNav, buildSidebar } from './navigation';

export default defineConfig({
  lang: 'ko-KR',
  base: '/web-fe-roadmap-study/',
  title: 'Web F/E Learning',
  description: '웹 개발자를 위한 기술 교육 문서',
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
      label: '문서 목차',
    },
    search: {
      provider: 'local',
    },
    docFooter: {
      prev: '이전 문서',
      next: '다음 문서',
    },
    lastUpdated: {
      text: '마지막 업데이트',
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
    returnToTopLabel: '맨 위로',
    sidebarMenuLabel: '문서 메뉴',
    darkModeSwitchLabel: '테마',
    lightModeSwitchTitle: '라이트 모드로 전환',
    darkModeSwitchTitle: '다크 모드로 전환',
  },
});
