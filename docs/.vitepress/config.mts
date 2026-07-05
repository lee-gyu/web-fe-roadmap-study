import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'ko-KR',
  base: '/web-fe-roadmap-study/',
  title: '웹 프론트엔드 심화 학습 로드맵',
  description: '경력 개발자를 위한 웹 프론트엔드 심화 교육 문서',
  cleanUrls: true,
  srcExclude: ['README.md'],
  themeConfig: {
    nav: [
      { text: '홈', link: '/' },
      { text: 'Phase 0', link: '/phase-0/01-how-the-web-works' },
      { text: 'Phase 1', link: '/phase-1/01-html-basics' },
      { text: '로드맵', link: '/#전체-커리큘럼' },
    ],
    sidebar: [
      {
        text: 'Phase 0. 웹 플랫폼의 이해',
        collapsed: false,
        items: [
          { text: '0-1. 주소창에서 픽셀까지', link: '/phase-0/01-how-the-web-works' },
          { text: '0-2. 프론트엔드 툴체인의 지형', link: '/phase-0/02-frontend-toolchain' },
          { text: '0-3. 웹 표준과 브라우저 지형', link: '/phase-0/03-web-standards-and-browsers' },
        ],
      },
      {
        text: 'Phase 1. HTML & CSS',
        collapsed: false,
        items: [
          { text: '1-1. HTML 기초', link: '/phase-1/01-html-basics' },
          { text: '1-2. 시맨틱 HTML', link: '/phase-1/02-semantic-html' },
          { text: '1-3. CSS 기초', link: '/phase-1/03-css-basics' },
          { text: '1-4. CSS 레이아웃', link: '/phase-1/04-css-layout' },
          { text: '1-5. 반응형 디자인', link: '/phase-1/05-responsive-design' },
          { text: '1-6. CSS 심화', link: '/phase-1/06-css-advanced' },
          { text: '1-7. 웹 접근성', link: '/phase-1/07-accessibility' },
        ],
      },
    ],
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
