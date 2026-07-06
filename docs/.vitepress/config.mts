import { defineConfig } from 'vitepress';
import { buildNav, buildSidebar } from './navigation';

export default defineConfig({
  lang: 'ko-KR',
  base: '/web-fe-roadmap-study/',
  title: 'Web F/E Learning',
  description: '웹 개발자를 위한 기술 교육 문서',
  cleanUrls: true,
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
    returnToTopLabel: '맨 위로',
    sidebarMenuLabel: '문서 메뉴',
    darkModeSwitchLabel: '테마',
    lightModeSwitchTitle: '라이트 모드로 전환',
    darkModeSwitchTitle: '다크 모드로 전환',
  },
});
