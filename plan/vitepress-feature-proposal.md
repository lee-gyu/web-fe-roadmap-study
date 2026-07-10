# VitePress 기능 개선 제안: 학습자 탐색성과 문서 신뢰도 강화

## GitHub Issue 제목

VitePress 기본 기능을 활용해 학습 로드맵 사이트의 탐색성과 문서 신뢰도를 강화하기

## 배경

현재 사이트는 VitePress 기본 테마를 기반으로 다음 기능을 이미 사용한다.

- `themeConfig.nav`, `themeConfig.sidebar`를 `docs/.vitepress/navigation.ts`에서 자동 생성한다.
- 로컬 검색(`search.provider: 'local'`)을 사용한다.
- 문서 목차(`outline`), 이전/다음 문서(`docFooter`), 한국어 UI 라벨을 설정했다.
- `sitemap.hostname`과 `cleanUrls`를 설정했다.

VitePress 공식 문서의 기본 테마 설정, Markdown 확장, 검색, Last Updated, Edit Link, Home Page 기능을 기준으로 보면, 학습자용 커리큘럼 문서에 추가하면 효과가 큰 기능이 몇 가지 남아 있다.

## 제안 범위

### 1. 문서별 마지막 수정 시각 표시

- VitePress의 `lastUpdated` 사이트 옵션과 `themeConfig.lastUpdated`를 활성화한다.
- 문서 하단에 “마지막 업데이트”를 표시해 학습자가 콘텐츠의 최신성을 판단할 수 있게 한다.
- 공식 문서에 따르면 이 값은 각 Markdown 파일의 최신 Git 커밋 시각을 사용하므로, 문서 변경 이력과 잘 맞는다.

참고: <https://vitepress.dev/reference/site-config#lastupdated>, <https://vitepress.dev/reference/default-theme-last-updated>

### 2. GitHub 편집 링크 추가

- `themeConfig.editLink`를 설정해 각 문서에서 GitHub 편집 화면으로 이동할 수 있게 한다.
- 오탈자, 코드 예제 오류, 설명 보완을 발견한 학습자가 바로 기여할 수 있다.
- 기본 후보 패턴: `https://github.com/lee-gyu/web-fe-roadmap-study/edit/<branch>/docs/:path`
- 실제 적용 전에는 기본 브랜치와 원격 저장소 URL을 확인해야 한다.

참고: <https://vitepress.dev/reference/default-theme-config#editlink>

### 3. GitHub 저장소 Social Link 추가

- `themeConfig.socialLinks`에 GitHub 저장소 링크를 추가한다.
- 사이트 방문자가 원본 저장소, 이슈, PR로 이동하기 쉬워진다.

참고: <https://vitepress.dev/reference/default-theme-config#sociallinks>

### 4. 홈 화면을 VitePress Home Page 레이아웃으로 강화

- `docs/index.md`에 `layout: home`, `hero`, `features`를 적용한다.
- 추천 feature 카드 예시:
  - 단계별 심화 로드맵
  - 실습과 검증 중심 학습
  - React/TypeScript/브라우저/AI 에이전트까지 연결
- 현재 사이드바 중심 탐색을 보완하고, 첫 방문자가 학습 순서를 빠르게 이해하게 한다.

참고: <https://vitepress.dev/reference/default-theme-home-page>

### 5. Markdown 이미지 Lazy Loading 활성화

- `markdown.image.lazyLoading: true`를 설정한다.
- 향후 다이어그램, 캡처 이미지, 실습 스크린샷이 늘어날 때 초기 로딩 비용을 줄인다.
- 현재 이미지가 적더라도 선제적으로 켜둘 수 있는 저위험 개선이다.

참고: <https://vitepress.dev/guide/markdown#image-lazy-loading>

### 6. 수식 지원은 필요 시 후순위로 검토

- VitePress는 `markdown.math: true`로 수식 렌더링을 지원하지만 별도 의존성(`markdown-it-mathjax3`)이 필요하다.
- 현재 커리큘럼 성격상 HTTP, 성능, 렌더링 모델 설명에는 다이어그램과 표가 더 직접적이므로 즉시 도입보다는 수식이 실제로 필요한 문서가 생길 때 적용한다.

참고: <https://vitepress.dev/guide/markdown#math-equations>

## 우선순위 제안

1. `lastUpdated`, `editLink`, `socialLinks` 추가
   - 설정 변경만으로 효과가 크고 유지보수 비용이 낮다.
2. 홈 화면 개편
   - 학습자 온보딩 효과가 크지만 문구와 정보 구조 설계가 필요하다.
3. 이미지 Lazy Loading 활성화
   - 이미지가 많아지는 시점에 함께 적용해도 된다.
4. 수식 지원
   - 실제 수식 기반 콘텐츠 요구가 생길 때 도입한다.

## 수용 기준

- [ ] `pnpm docs:build`가 성공한다.
- [ ] 문서 페이지 하단에 한국어 “마지막 업데이트”가 표시된다.
- [ ] 문서 페이지의 편집 링크가 GitHub의 해당 Markdown 파일 편집 화면으로 이동한다.
- [ ] 상단 내비게이션에 GitHub 저장소로 이동하는 링크가 표시된다.
- [ ] 홈 화면에서 전체 로드맵의 목적과 시작점을 한눈에 확인할 수 있다.

## 구현 시 확인할 점

- 원격 저장소 URL과 기본 브랜치가 로컬 Git 설정에 없을 수 있으므로, `editLink.pattern` 적용 전 실제 GitHub 저장소와 브랜치를 확인한다.
- `lastUpdated`는 Git 커밋 시각 기반이므로 문서 파일이 Git에 커밋되어 있어야 의미 있는 값이 표시된다.
- 홈 화면 개편은 `docs/index.md`의 기존 안내 문구를 대체하거나 흡수하는 방식으로 진행한다.
