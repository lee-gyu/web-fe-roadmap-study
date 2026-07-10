# Phase 5b — React Rendering Patterns 학습 과정 기획

> ROADMAP.md의 Phase 5b(2주, 문서 8개)를 실제 집필 가능한 수준으로 구체화한 기획 문서다.
> 렌더링 위치와 시점, 전달 산출물, 캐시 신선도, 하이드레이션, 서버/클라이언트 경계의 공통 모델과 문서 간 의존 관계, 비교 실험, 실습 과제, 정확성 검증 기준을 정의한다.

---

## 1. 기획 전제

### 독자 상황 분석

독자는 Phase 5에서 React 요소, 렌더/커밋, 재조정, 상태 스냅샷, Effect, Suspense, 코드 분할, 서버 상태를 학습했고 Phase 5a에서 컴포넌트 합성과 서버/클라이언트 책임의 필요성을 경험했다. Phase 5b는 프레임워크 설정법을 나열하는 과정이 아니라, **HTML과 React 작업을 빌드·요청 서버·캐시·브라우저 중 어디에 언제 배치할지 판단하는 과정**이다.

- **이미 아는 것**: HTML 파싱과 스크립트 로딩, HTTP 요청·응답과 캐시의 신선도/재검증, `fetch`와 스트림, React 렌더링·상태·Effect, `createRoot`, 라우팅·코드 분할, Suspense의 기본 역할, DevTools Network/Performance 패널의 기초 사용법.
- **모르는 것(이 Phase의 가치)**: CSR·SSR·SSG·ISR이 같은 문제의 계산 위치와 캐시 시점을 어떻게 달리하는지, 서버 HTML이 보이는 시점과 React UI가 상호작용 가능한 시점이 왜 다른지, progressive/streaming/selective hydration과 RSC가 어느 축을 바꾸며 서로 어떻게 조합되는지, 페이지 전체가 아니라 영역별 요구사항으로 전략을 선택하는 방법이다.
- **흔한 함정**: ① CSR→SSR→RSC를 기술의 발전 순서로 보고 뒤의 것이 항상 낫다고 결론낸다. ② 서버에서 실행된 React를 모두 RSC라고 부른다. ③ SSR이면 클라이언트 JavaScript와 하이드레이션 비용이 사라진다고 생각한다. ④ SSG와 `renderToStaticMarkup`을 같은 개념으로 뭉갠다. ⑤ ISR의 invalidation과 regeneration, route cache와 data cache, CDN cache를 하나의 캐시로 취급한다. ⑥ 스트리밍 HTML 도착과 상호작용 가능 시점을 같은 사건으로 본다. ⑦ `Suspense` 경계를 많이 만들수록 무조건 빨라진다고 가정한다. ⑧ `'use server'`를 Server Component를 표시하는 지시어로 오해한다. ⑨ 개발 서버의 캐시·스트리밍 결과를 production 동작으로 일반화한다. ⑩ 최신 프레임워크의 버전별 기본값을 영구적인 React 원리로 설명한다.

### 커리큘럼 내 위치와 경계

| 인접 과정 | Phase 5b가 이어받는 것 | Phase 5b가 다루고 넘기는 것 |
|---|---|---|
| Phase 1 — HTML & CSS | HTML 파싱, parser-blocking, `defer`/`async`, 렌더링 초기 단계 | HTML 셸과 스트리밍 청크가 언제 파싱되는지에 적용한다. HTML 파서와 CSS 렌더링 규칙 자체는 반복하지 않는다. |
| Phase 2 — HTTP | 표현, 캐시 신선도·재검증, CDN/shared cache, TLS 비용 | 렌더 결과의 cacheability와 ISR 상태 전이에 적용한다. HTTP 캐시 규약과 CDN 운영 심화는 Phase 2·8로 연결한다. |
| Phase 3 — JavaScript 런타임 | 이벤트 루프, `fetch`, `ReadableStream`, `AbortController`, 모듈 그래프 | JavaScript 다운로드·실행, 스트림 소비, 취소 타임라인에 적용한다. Web Streams API 자체의 사용법은 반복하지 않는다. |
| Phase 5 — React 렌더링 모델 | React 요소, 렌더/커밋, 상태 보존, Effect, Profiler, Suspense·lazy | 서버 렌더·하이드레이션·경계별 활성화 모델로 확장한다. 상태와 Effect 기초, 클라이언트 리렌더 최적화는 반복하지 않는다. |
| Phase 5a — React Patterns | 컴포넌트 합성, headless UI, 비동기 경계, stack ADR | 같은 페이지를 영역별 렌더링 책임으로 분해하고 선택 ADR로 연결한다. HOC·Hook·compound 패턴은 반복하지 않는다. |
| Phase 6 — 도구의 내부 동작 | Phase 5 프로젝트의 TypeScript·Vite 환경 | 실습에 필요한 production build와 청크 결과를 관찰하되 bundler·tree shaking·CI 원리는 Phase 6으로 넘긴다. |
| Phase 8 — 브라우저·네트워크·보안 심화 | Phase 5b의 전략 비교표, 요청 타임라인, 실습 증거 | Phase 5b는 일반 모델과 통제된 fixture를 소유한다. Phase 8은 Core Web Vitals의 정밀 계측, 네트워크·메인 스레드 병목 분석, Next.js 실제 통합·배포 관측을 심화한다. |
| Phase 10 — 실전 프로젝트 | Phase 5b에서 작성한 영역별 렌더링 전략 ADR | 실제 제품의 요구사항·운영 데이터로 결정을 재검토하고 프로젝트 ADR에 통합한다. 프로젝트 관리와 포트폴리오 서술은 Phase 10으로 넘긴다. |

### 렌더링 패턴을 읽는 공통 프레임

8개 문서는 같은 축으로 렌더링 패턴을 분석한다. 약어의 정의보다 요청과 사용자 경험의 시간선을 먼저 그리고, 각 패턴이 어느 구간의 작업·비용·실패를 이동시키는지 비교한다.

1. **사용자·데이터 요구사항**: 공개/인증 여부, 개인화, 상호작용 밀도, 허용 가능한 stale window, 검색·링크 미리보기, offline/장시간 세션 요구를 정의한다.
2. **계산 위치와 시점**: React와 데이터 접근이 build, request server, edge/cache, browser 중 어디서 언제 실행되는지 표시한다.
3. **전달 산출물**: 최초 응답에 HTML, JavaScript, CSS, JSON, RSC payload 중 무엇이 들어가고 이후 무엇이 추가로 도착하는지 구분한다.
4. **요청·캐시 상태 전이**: cache miss/hit, fresh/stale, revalidation, on-demand generation, failure fallback이 어떤 요청에서 관찰되는지 추적한다.
5. **표시와 활성화**: first byte, 의미 있는 HTML 표시, JavaScript 평가, hydration 시작/완료, 첫 상호작용 처리 시점을 별개 사건으로 기록한다.
6. **비용과 실패 모드**: 서버 CPU·메모리·cold start, build 시간, CDN 일관성, JavaScript bytes·main-thread work, hydration mismatch, stale content, 오류·취소가 어디에 나타나는지 분석한다.
7. **조합과 대안**: 페이지 전체를 하나의 약어로 부르지 않고 route·layout·component 영역별로 정적/동적/클라이언트/스트리밍 경계를 조합한다.
8. **검증 증거**: HTML 원문, build output, response header, Network waterfall, Performance trace, Server-Timing·사용자 정의 marker, bundle 결과, 캐시 버전, 오류 로그, ADR 중 무엇으로 판단을 입증할지 정한다.

### 공통 요청 타임라인

각 문서는 다음 사건 중 해당하는 것을 같은 이름으로 사용한다. 존재하지 않는 단계를 억지로 채우지 않고, 캐시 적중 여부와 cold/warm 조건에 따라 가지를 나눈다.

```text
build/data snapshot
  → request
  → route/data cache lookup
  → server render or cached response
  → first byte / shell
  → remaining HTML or RSC chunks
  → HTML parse and paint
  → JavaScript download / parse / execute
  → hydration scheduled / completed
  → first handled interaction
  → data mutation / invalidation / revalidation
```

다음 용어는 문서 전체에서 구분한다.

| 용어 | 이 Phase에서의 뜻 | 혼동하지 않을 것 |
|---|---|---|
| render | React 입력을 host output으로 계산하는 과정 | 화면에 픽셀이 그려지는 browser rendering 전체 |
| server rendering / SSR | React tree를 서버에서 HTML로 만드는 계층 | RSC, request-time data access, caching 자체 |
| prerender / static rendering | 요청 전에 HTML·관련 payload를 생성하는 전략 | 상호작용 없는 정적 markup만 생성한다는 뜻 |
| hydration | 기존 서버 HTML을 React client tree와 연결해 상호작용 가능하게 만드는 과정 | 새 DOM을 처음부터 mount하는 `createRoot` |
| streaming | 결과가 모두 준비되기 전에 준비된 단위부터 전송하는 전달 방식 | selective hydration, RSC 자체 |
| RSC | 서버 환경에서 실행되어 직렬화된 React tree 결과를 만드는 component 모델 | HTML을 만드는 SSR의 다른 이름 |
| invalidation | 캐시 결과를 더 이상 fresh로 간주하지 않게 만드는 사건 | 새 결과 생성과 전역 CDN 반영이 즉시 끝났다는 뜻 |

### Phase 5b 전체 목표(ROADMAP 기준)

Phase 5의 React 렌더링 모델과 Phase 5a의 컴포넌트 합성을 바탕으로, 렌더링 위치와 시점·데이터 신선도·캐시 가능성·클라이언트 JavaScript·하이드레이션·서버 비용을 공통 축으로 비교한다. 페이지와 컴포넌트의 요구사항에 따라 CSR·SSR·SSG·ISR을 선택하고, 스트리밍·점진적/선택적 하이드레이션·RSC를 조합한 뒤 성능과 운영상 트레이드오프를 근거로 설명할 수 있다.

최종 산출물은 다음 네 묶음이다.

- 동일 요구사항의 CSR·SSR·SSG·ISR 요청/캐시 타임라인과 공통 비교표
- 제어 가능한 느린 데이터·오류를 사용한 buffered/streaming SSR 및 hydration 경계 실험 기록
- Server/Client Component 경계와 selective hydration을 적용한 bundle·payload·상호작용 증거
- 페이지 영역별 선택, 무효화 조건, 관측 지표, 재검토·철회 조건을 기록한 렌더링 전략 ADR

### 2주 배분

| 주차 | 문서 | 학습·실습 초점 |
|---|---|---|
| 1주차 | 5b-1~5b-4 CSR, SSR, Static Rendering, ISR | 같은 페이지가 build·request server·cache·browser 중 어디에서 계산되는지 비교하고, cold/warm cache와 콘텐츠 변경에 따른 요청 타임라인을 기록한다. |
| 2주차 | 5b-5~5b-8 Progressive Hydration, Streaming SSR, RSC, Selective Hydration | HTML 도착과 상호작용 가능 시점을 분리해 관찰하고, Suspense 및 Server/Client Component 경계를 조정한 뒤 스트리밍·bundle·hydration 증거를 ADR로 종합한다. |

---

## 2. 문서별 상세 기획

각 문서는 [Patterns.dev React Rendering Patterns](https://www.patterns.dev/react/)의 해당 글을 문제 지형의 출발점으로 삼되, React·Web API·framework의 API 이름과 지원 상태는 집필 시점의 공식 문서로 다시 검증한다. Patterns.dev의 오래된 코드, 특정 framework 버전, 정량 수치, 캐시 기본값은 검증 없이 복사하지 않는다.

### 5b-1. Client-side Rendering — `docs/phase-5b/01-client-side-rendering.md`

- **기준 자료**: [Patterns.dev — Client-side Rendering](https://www.patterns.dev/react/client-side-rendering/)
- **핵심 질문**: 브라우저가 최초 UI·라우팅·데이터 연결을 모두 소유하는 모델은 어떤 제품에서 초기 비용을 상쇄하고, 어떤 사용자·기기·유입 경로에서 실패하는가?
- **다룰 범위**:
  - 거의 빈 HTML shell, module entry, `createRoot`, 첫 client render, Effect/서버 상태 라이브러리의 데이터 요청으로 이어지는 cold-load 타임라인.
  - 최초 로드와 이후 SPA navigation을 분리해 평가한다. 긴 세션에서는 초기 bundle 비용을 상쇄할 수 있지만 cold entry마다 같은 이점이 성립하지 않는 이유.
  - 인증 대시보드·내부 도구·편집기·embedded widget·offline app shell처럼 CSR이 합리적인 조건과 공개 콘텐츠·짧은 세션·저사양 기기에서 무너지는 조건.
  - HTML에 핵심 콘텐츠가 없는 경우의 검색·링크 preview·no-JavaScript 경험과, crawler가 JavaScript를 실행한다는 사실만으로 해결되지 않는 비용.
  - JavaScript transfer size와 parse/evaluate/execute, client data waterfall, skeleton 공간 예약이 FCP/LCP/INP/CLS에 미치는 경로. 지표 값은 Phase 8 방식으로 계측하되 원인 타임라인을 먼저 세운다.
  - route-level code splitting, module preload, data preload, service worker/app shell, 중요하지 않은 widget 지연이 비용을 이동시키는 방식과 새 waterfall·stale asset·offline invalidation 비용.
  - CSR 내부의 browser cache, client query cache, application state를 서버 HTML 캐시와 구분한다.
- **관찰 실험**:
  - JavaScript를 비활성화하거나 entry chunk를 지연해 document HTML, 첫 콘텐츠, 데이터 요청 시작 시점을 기록한다.
  - production build를 network/CPU throttling으로 열어 entry·route chunk의 transfer와 evaluate 구간, 첫 데이터 fetch initiator를 표시한다.
  - direct cold navigation과 이미 로드된 앱의 client navigation을 같은 화면에서 비교해 초기/반복 비용을 분리한다.
- **다루지 않을 범위**: React Router 전체 API, service worker 캐시 구현, TanStack Query/SWR 사용법, SEO 일반론, bundler 청크 알고리즘. 각각 Phase 5·6·8 또는 관련 공식 문서로 위임한다.
- **경력자 연결**: CSR은 thick client와 같다. 서버 왕복을 줄이고 지역 상호작용을 풍부하게 만들지만 배포 artifact와 계산 비용을 사용자의 네트워크·CPU로 옮긴다.
- **의존**: 1-1 HTML 파싱·스크립트 로딩, 3-5 이벤트 루프, 3-8 fetch, 5-1 React mental model, 5-7 라우팅·코드 분할, 5-8 서버 상태.

### 5b-2. Server-side Rendering — `docs/phase-5b/02-server-side-rendering.md`

- **기준 자료**: [Patterns.dev — Server-side Rendering](https://www.patterns.dev/react/server-side-rendering/)
- **핵심 질문**: 요청 시점에 React를 HTML로 만드는 비용은 언제 개인화·초기 콘텐츠·검색 가능성의 가치로 회수되며, HTML 표시와 상호작용 사이의 간극은 어떻게 드러나는가?
- **다룰 범위**:
  - request input(cookie, header, URL, session) → data access → server render → HTML response → `hydrateRoot`의 기본 파이프라인.
  - 의미 있는 HTML을 최초 응답에 넣는 이점과 server compute·data latency·cold start가 TTFB 및 capacity 비용으로 이동하는 구조.
  - server HTML과 client 첫 render가 같은 결과를 재현해야 하는 계약, hydration mismatch의 대표 원인(시간·난수·locale·browser-only 분기·변경된 데이터)과 안전한 진단.
  - 페이지가 보이지만 아직 활성화되지 않은 구간, JavaScript download/execute와 전체 client tree 재실행 비용, progressive enhancement 가능한 HTML control의 가치.
  - SSR 결과의 캐시 가능성은 별도 문제라는 점. 요청별 개인화가 shared cache key와 충돌하는 조건, request memoization·response cache·CDN cache를 구분한다.
  - React server API의 Node stream/Web stream 지형은 소개하되 shell·chunk·오류 처리의 상세는 5b-6으로 위임한다.
  - SSR과 SSG는 HTML 생성 시점이 다르고, SSR과 RSC는 output과 component 실행 경계가 다르다는 비교를 명시한다.
- **관찰 실험**:
  - JavaScript를 비활성화한 상태에서도 핵심 콘텐츠와 링크·폼 중 무엇이 동작하는지 CSR과 비교한다.
  - server data delay를 고정하고 TTFB와 HTML 도착 시점을 기록해 client fetch delay와 비용 위치를 비교한다.
  - 의도적으로 시간/locale 값 또는 DOM 구조를 다르게 만들어 recoverable hydration error를 관찰하고 동일 입력으로 수정한다.
- **다루지 않을 범위**: streaming boundary 설계(5b-6), React scheduler의 selective hydration(5b-8), RSC payload와 Server Component composition(5b-7), framework별 dynamic rendering 판정(Phase 8).
- **경력자 연결**: SSR은 request-scoped template rendering과 비슷하지만 같은 component tree를 client에서 다시 연결한다. 서버 결과가 client 실행의 초기 snapshot이 된다는 점에서 단순 HTML template보다 재현 계약이 강하다.
- **의존**: 2-2 HTTP 캐싱, 2-3 cookie·상태, 5-1 React 요소, 5-2 렌더·재조정, 5-4 Effect, 5-8 서버 상태. 5b-5·6·8의 baseline이다.

### 5b-3. Static Rendering — `docs/phase-5b/03-static-rendering.md`

- **기준 자료**: [Patterns.dev — Static Rendering](https://www.patterns.dev/react/static-rendering/)
- **핵심 질문**: 요청 전에 HTML과 관련 payload를 생성해 배포하는 모델은 어떤 데이터와 경로에서 가장 단순하고 강인하며, build 규모·개인화·신선도 요구가 커질 때 어디서 무너지는가?
- **다룰 범위**:
  - build/data snapshot → route enumeration → prerender → immutable deployment artifact → CDN/browser delivery의 타임라인.
  - static rendering/SSG와 상호작용 없는 `renderToStaticMarkup`의 차이. 정적으로 생성된 HTML도 Client Component JavaScript를 포함하고 hydration될 수 있다.
  - 동일 HTML을 많은 사용자에게 재사용할 때의 낮은 request compute·빠른 cache hit·origin 장애 복원력과, 배포 시점 데이터 snapshot이라는 의미.
  - 문서·마케팅·블로그·법률 페이지처럼 publish cadence가 request cadence보다 느린 콘텐츠의 적합성.
  - 동적 route 수 증가, CMS/DB 의존 build, 전체 rebuild, deploy rollback, stale content, build failure가 release lead time에 미치는 비용.
  - 공통 static 본문과 로그인 인사·추천·재고 같은 client-fetched slice를 조합할 때 생기는 layout shift·추가 waterfall·권한 누출 경계.
  - static/dynamic 판정을 framework가 자동화할 수 있지만 request-time API와 cache 설정의 정확한 영향은 버전별 공식 문서로 확인해야 함을 명시한다.
- **관찰 실험**:
  - production build 산출물에서 route별 HTML/RSC/asset을 확인하고 요청 시 application render가 실행되지 않는 경로를 로그로 입증한다.
  - 원본 데이터 버전을 바꾼 뒤 rebuild 전후 응답을 비교해 snapshot과 배포의 결합을 확인한다.
  - static 본문에 client-only 개인화 영역을 추가하고 HTML 원문·첫 표시·추가 fetch·layout 변화를 기록한다.
- **다루지 않을 범위**: ISR revalidation(5b-4), Partial Prerendering/Cache Components API, CMS webhook 구현, CDN vendor 설정, framework 설정 카탈로그.
- **경력자 연결**: SSG는 materialized artifact를 release에 포함하는 방식이다. 요청마다 계산하지 않는 대신 데이터 변경과 artifact 재생성·배포를 일관성 프로토콜로 소유한다.
- **의존**: 0-2 프론트엔드 툴체인 지형, 2-2 HTTP 캐싱, 5b-1 client dynamic slice. 정적 배포·CDN 운영 원리는 후속 6-5에서 심화하고, 이 문서는 5b-4의 fresh baseline이 된다.

### 5b-4. Incremental Static Generation — `docs/phase-5b/04-incremental-static-generation.md`

- **기준 자료**: [Patterns.dev — Incremental Static Generation](https://www.patterns.dev/react/incremental-static-rendering/)
- **핵심 질문**: 정적 결과를 배포 이후 생성·갱신할 때 빠른 cache hit와 데이터 신선도 사이의 계약을 어떻게 명시하고, invalidation 실패와 분산 cache 불일치를 어떻게 관찰할 것인가?
- **다룰 범위**:
  - ROADMAP의 제목은 원문을 따라 Incremental Static Generation으로 유지하되, 업계의 ISR 약어가 주로 Incremental Static **Regeneration**을 뜻한다는 용어 차이를 본문에서 설명한다.
  - 두 기능의 분리: build에 없던 route의 first-request/on-demand generation과 이미 생성된 결과의 time/event-based revalidation.
  - cache entry 상태를 `missing → generating → fresh → stale → revalidating → fresh/error`로 그려 어떤 요청이 기다리고 어떤 요청이 stale 결과를 받는지 framework 계약에 따라 확인한다.
  - time-based freshness와 mutation/CMS event 기반 invalidation, path와 data ownership tag의 차이. URL 구조와 데이터 의존 그래프가 일치하지 않을 수 있는 이유.
  - invalidation은 새 결과 생성·전역 전파의 완료가 아니다. origin data cache, rendered route cache, CDN POP, browser/client router cache가 각각 언제 갱신되는지 구분한다.
  - regeneration 실패 시 stale 결과 유지 여부, 동시 miss·stampede, long-tail route의 첫 요청 지연, rollback·purge, 가격·권한처럼 stale 허용이 어려운 데이터의 부적합성.
  - Next.js를 예제로 쓸 경우 current Cache Components 모델과 previous caching model을 섞지 않고, version·feature flag·hosting/cache topology를 기록한 뒤 해당 공식 문서의 API만 사용한다.
- **관찰 실험**:
  - monotonic content version과 제어 가능한 clock을 사용해 cold miss, fresh hit, stale hit, background/foreground regeneration 결과를 요청 순서별로 기록한다.
  - time-based와 event/tag-based 갱신을 각각 재현하고 관련 route·관련 없는 route의 version 변화를 비교한다.
  - regeneration data source를 실패시켜 stale-if-error 또는 error response 동작을 관찰하고, 문서가 보장하는 범위와 platform 구현을 구분한다.
- **다루지 않을 범위**: 분산 cache 제품 구축, CDN purge API 전수 비교, database consistency 프로토콜, framework의 모든 cache directive. Phase 2·8 및 공식 배포 문서로 위임한다.
- **경력자 연결**: ISR 결과는 read model/materialized view에 가깝다. write 성공과 read projection 갱신 사이에 지연이 있으며, invalidation key와 관측 가능성이 correctness의 일부가 된다.
- **의존**: 2-2 HTTP fresh/stale·conditional request, 5b-3 static snapshot. CDN 배포·무효화 운영은 후속 6-5에서 심화하고, 이 문서는 이후 ADR의 freshness·failure 축을 소유한다.

### 5b-5. Progressive Hydration — `docs/phase-5b/05-progressive-hydration.md`

- **기준 자료**: [Patterns.dev — Progressive Hydration](https://www.patterns.dev/react/progressive-hydration/)
- **핵심 질문**: 서버 HTML 전체를 한 번에 활성화하지 않고 필요한 영역부터 활성화하면 critical path의 JavaScript·main-thread 비용을 얼마나 줄일 수 있고, 지연된 첫 상호작용과 접근성 비용은 어디에 생기는가?
- **다룰 범위**:
  - progressive hydration을 hydration을 여러 단위와 trigger로 나누는 **기법의 계열**로 정의하고 React의 selective hydration, islands, visibility/idle/interaction 기반 activation과의 관계를 지도화한다.
  - 서버 HTML completeness, JavaScript chunk boundary, hydration scheduling은 서로 다른 축이다. HTML이 있다는 사실만으로 해당 영역의 코드가 준비되거나 interactive하다고 간주하지 않는다.
  - above-the-fold navigation/form, below-the-fold review, chat/widget 등 영역별 interaction urgency와 code/data dependency를 분류한다.
  - visibility(`IntersectionObserver`), idle, hover/focus/pointer intent, explicit click trigger가 초기 비용과 first-use latency를 어떻게 교환하는지 비교한다.
  - 실제 서버 HTML을 유지한 채 hydrate를 미루는 접근과, widget을 아예 client-only로 mount하는 접근을 구분한다. 후자는 콘텐츠·접근성·layout 안정성 계약이 달라진다.
  - progressive enhancement가 가능한 link/form, focus 이동, keyboard activation, live region, fallback size를 hydration 전략의 공개 UX 계약으로 다룬다.
  - React core가 직접 제공하는 보장과 framework/island library가 추가하는 trigger를 구분하며, 임의의 custom hydrator를 기본 해법으로 권장하지 않는다.
- **관찰 실험**:
  - 동일 SSR HTML에 즉시/visibility/interaction activation을 적용한 무거운 비핵심 widget을 두고 initial JavaScript·main-thread work·첫 사용 latency를 비교한다.
  - JavaScript 비활성화와 느린 chunk 조건에서 링크·폼·focus order·fallback 공간이 유지되는지 확인한다.
  - 화면에 보이는 control이 아직 활성화되지 않은 사례를 재현해 click/focus가 유실·지연·재생되는지 framework/React 보장에 따라 기록한다.
- **다루지 않을 범위**: React scheduler의 priority와 event replay 상세(5b-8), streaming server API(5b-6), Astro/Qwik 등 개별 framework 튜토리얼, Core Web Vitals 정밀 분석(Phase 8).
- **경력자 연결**: progressive hydration은 priority-based lazy initialization과 유사하다. 시작 비용을 분할하지만 처음 사용될 때의 page fault 같은 지연과 상태 전이 복잡도를 새로 만든다.
- **의존**: 5b-2 SSR/hydration baseline, 5-7 code splitting·Suspense, 3-7 DOM event·focus, 8-3 INP는 후속 계측. 5b-8이 React 내장 사례를 심화한다.

### 5b-6. Streaming Server-Side Rendering — `docs/phase-5b/06-streaming-server-side-rendering.md`

- **기준 자료**: [Patterns.dev — Streaming Server-Side Rendering](https://www.patterns.dev/react/streaming-ssr/)
- **핵심 질문**: 느린 하위 데이터가 전체 응답을 막지 않도록 HTML을 준비된 단위부터 전송할 때, shell·Suspense boundary·HTTP response의 오류와 완료 계약을 어떻게 설계할 것인가?
- **다룰 범위**:
  - buffered SSR의 tail latency: 가장 느린 data dependency가 전체 HTML 전송을 막는 구조와 shell-first streaming이 바꾸는 first-byte/reveal 타임라인.
  - `Suspense` boundary가 fallback과 실제 콘텐츠의 reveal 단위를 정의하는 방식. boundary는 자동 병렬 fetch가 아니며 데이터 요청 시작 순서와 waterfall은 별도로 설계해야 한다.
  - current React의 Node `renderToPipeableStream`과 Web Stream `renderToReadableStream`, `onShellReady`/`onAllReady`, bootstrap script/module, `abort`의 책임.
  - shell 이전 오류와 shell flush 이후 오류의 차이. bytes가 전송된 뒤 HTTP status/header를 바꿀 수 없는 제약, region별 Error Boundary와 timeout fallback.
  - browser incremental parse, proxy/CDN compression·buffering, backpressure, client disconnect가 실제 chunk 도착을 바꿀 수 있음을 작은 단위 로컬 결과에서 일반화하지 않는다.
  - crawler/email/static generation처럼 complete HTML을 기다려야 하는 소비자와 사람에게 shell을 빨리 보내는 경로의 차이.
  - HTML stream 도착, RSC payload stream, client JavaScript download, selective hydration을 별도 레인으로 그리고 상호작용 가능 시점은 5b-8과 연결한다.
- **관찰 실험**:
  - 빠른 shell, 중간 영역, 느린 영역에 고정 지연을 두고 buffered/streaming 응답을 `curl --no-buffer`와 browser Network timing으로 비교한다.
  - shell 전 오류, shell 후 하위 오류, timeout/abort, client disconnect를 재현해 status·로그·fallback·완료 여부를 기록한다.
  - buffering이 있는 reverse proxy와 직접 origin을 비교하거나, 환경상 불가능하면 어떤 계층이 검증되지 않았는지 명시한다.
- **다루지 않을 범위**: Web Streams 기본 API(3-8), HTTP/2·HTTP/3 프로토콜 상세(2-4), RSC wire format(5b-7), framework route convention(Phase 8).
- **경력자 연결**: streaming SSR은 fan-out 요청의 tail latency를 전체 응답이 아니라 부분 결과로 격리하는 방식이다. 다만 response commit 이후에는 transaction rollback처럼 전체 상태를 되돌릴 수 없으므로 영역별 오류 표현이 필요하다.
- **의존**: 5b-2 SSR, 3-8 ReadableStream·취소, 5-7 Suspense, 2-4 HTTP 전송. 5b-8의 independent hydration boundary를 위한 server-side 기반이다.

### 5b-7. React Server Components — `docs/phase-5b/07-react-server-components.md`

- **기준 자료**: [Patterns.dev — React Server Components](https://www.patterns.dev/react/react-server-components/)
- **핵심 질문**: React component tree를 server/client 실행 환경으로 분할하면 어떤 코드·데이터·비밀·상호작용을 경계 안에 둘 수 있고, 직렬화·네트워크·캐시·보안 비용은 어디에 생기는가?
- **다룰 범위**:
  - RSC는 SSR의 대체 이름이 아니다. Server Component는 build 또는 request 환경에서 실행되어 RSC payload를 만들고, SSR은 initial HTML을 만드는 별도 계층이며 둘은 함께 또는 따로 사용될 수 있다.
  - Server Component를 표시하는 `'use server'` directive는 없다. `'use client'`는 client module graph의 진입 경계를, `'use server'`는 client에서 호출 가능한 Server Function을 표시한다.
  - Server Component에서 가능한 async data access·server-only dependency·secret 사용과, 불가능한 stateful Hook·event handler·browser API를 실행 환경으로 설명한다.
  - Server→Client component composition, Client가 Server 결과를 slot/children으로 받는 구조, client module이 server module을 직접 import할 때 경계가 무너지는 조건.
  - boundary를 넘는 props/return value의 serializability, Server Function reference, class/function/browser object 실패와 오류를 가능한 한 build/type/runtime에서 조기에 드러내는 방법.
  - data access co-location이 client waterfall과 bundle bytes를 줄일 수 있지만 server data waterfall, repeated work, RSC payload, navigation round trip, server capacity·cache invalidation을 새 비용으로 만든다.
  - Server Function 인자는 신뢰할 수 없는 network input이다. 인증·인가·validation·rate limit·secret exposure를 일반 server endpoint와 같은 경계로 다룬다.
  - RSC component 모델은 React에서 안정화되었더라도 bundler/framework 구현 API와 cache/navigation semantics는 별도 version risk가 있음을 명시한다.
- **관찰 실험**:
  - 같은 페이지에서 표시 전용 영역과 상호작용 leaf를 Server/Client Component로 분리하고 client bundle module/bytes와 RSC response를 전후 비교한다.
  - 무거운 markdown/formatting dependency를 client와 server에 각각 두어 전달 JavaScript와 server work가 어떻게 달라지는지 관찰한다.
  - 함수/class instance/browser object를 경계 props로 넘기는 실패, client input을 검증하지 않는 Server Function 반례를 안전한 local fixture에서 재현한다.
- **다루지 않을 범위**: Next.js route 파일·cache directive 카탈로그(Phase 8), RSC wire protocol 구현, 인증 시스템 전체, ORM 선택, Server Function을 일반 data fetching API로 사용하는 패턴.
- **경력자 연결**: RSC boundary는 process/network 경계와 비슷하다. 호출 문법이 component composition처럼 보여도 serializable contract, remote execution, authorization, latency가 사라지지 않는다.
- **의존**: 5-1 React 요소, 5a-3 composition, 5b-2 SSR 구분, 5b-6 streaming. 5b-8에서는 Client Component 영역만 hydration 대상이라는 점으로 연결한다.

### 5b-8. Selective Hydration — `docs/phase-5b/08-selective-hydration.md`

- **기준 자료**: [Patterns.dev — Selective Hydration](https://www.patterns.dev/react/react-selective-hydration/)
- **핵심 질문**: streaming SSR과 Suspense로 나뉜 서버 HTML을 React가 독립 단위로 연결하고 사용자 입력을 우선할 때, boundary 크기·코드 도착·fallback·상호작용의 우선순위를 어떻게 검증할 것인가?
- **다룰 범위**:
  - selective hydration은 application이 각 component에 직접 호출하는 별도 API라기보다 `hydrateRoot`, Suspense, code/data availability, React scheduler가 함께 만드는 내장 동작임을 설명한다.
  - server HTML chunk가 도착하는 순서, client component code가 도착하는 순서, hydration이 실행되는 순서가 다를 수 있음을 세 개의 timeline으로 분리한다.
  - Suspense boundary가 독립 hydration 단위를 만드는 방식과 사용자가 아직 hydrate되지 않은 boundary와 상호작용할 때의 priority 조정·event replay 보장 범위를 공식 자료와 실행 실험으로 확인한다.
  - 이미 hydrate된 navigation과 아직 loading/hydrating 중인 reviews가 공존할 수 있는 상태, visible control과 실제 interactive state의 일치 요구.
  - 너무 큰 boundary는 작은 영역을 함께 기다리게 하고, 너무 작은 boundary는 fallback churn·추가 chunk·네트워크/서버 overhead·복잡한 reveal order를 만든다.
  - RSC가 hydration을 제거하는 범위는 Server Component 코드이며, 그 안에 합성된 Client Component는 여전히 JavaScript와 hydration이 필요하다는 점.
  - progressive hydration은 더 넓은 전략 계열이고 selective hydration은 React가 제공하는 scheduling mechanism이라는 포함 관계를 최종 비교표로 정리한다.
  - Patterns.dev의 legacy server API 예제는 역사적 맥락으로만 언급하고 current React 공식 server API와 `hydrateRoot`를 사용한다.
- **관찰 실험**:
  - 두 개 이상의 Suspense/lazy boundary에 서로 다른 code/data delay를 주고 HTML 도착, code load, hydration marker, 사용자 click 처리 순서를 기록한다.
  - hydrate가 늦은 boundary의 button을 먼저 누르고 입력이 우선 처리·재생되는지, focus/value가 보존되는지 current React production build에서 검증한다.
  - 하나의 큰 boundary와 여러 작은 boundary를 비교해 shell 내용, chunk 수, fallback 변화, first interaction latency, 오류 격리 차이를 기록한다.
- **다루지 않을 범위**: React scheduler 내부 Fiber lane 구현, event system 소스 전체, custom hydrator, framework별 islands directive, Core Web Vitals 통계 분석(Phase 8).
- **경력자 연결**: selective hydration은 cooperative scheduler의 priority inversion 완화와 닮았다. 도착 순서를 그대로 따르지 않고 사용자 입력이 있는 작업을 앞당기지만, 실행 단위가 잘 나뉘어 있어야 우선순위가 효과를 낸다.
- **의존**: 5b-5 progressive hydration 분류, 5b-6 streaming SSR, 5b-7 RSC/Client Component 경계, 5-7 Suspense. 이 Phase의 전달·활성화 모델을 종합한다.

---

## 3. 문서 간 의존 관계

```mermaid
flowchart TD
    D1["5b-1 CSR"] --> C["공통 비교 축<br/>계산 위치·전달물·활성화"]
    D2["5b-2 SSR"] --> C
    D3["5b-3 Static Rendering"] --> C
    D3 --> D4["5b-4 ISR"]

    D2 --> D5["5b-5 Progressive Hydration"]
    D2 --> D6["5b-6 Streaming SSR"]
    D5 --> D8["5b-8 Selective Hydration"]
    D6 --> D8
    D6 --> D7["5b-7 RSC"]
    D7 --> D8

    P2["Phase 2<br/>HTTP 캐시"] -.fresh/stale·CDN.-> D3
    P2 -.재검증.-> D4
    P5["Phase 5<br/>React 렌더링·Suspense"] -.전제.-> D1
    P5 -.전제.-> D2
    P5 -.전제.-> D5

    C -.비교 증거.-> A["렌더링 전략 ADR"]
    D4 --> A
    D8 --> A
    A -.계측·Next.js 통합.-> P8["Phase 8<br/>브라우저·네트워크·보안"]
```

- 집필 순서는 ROADMAP 번호(5b-1 → 5b-8)를 따른다. 5b-1~4가 HTML을 **어디서 언제 생성하고 캐시하는가**를 비교하고, 5b-5~6이 HTML과 JavaScript를 **언제 나누어 전달·활성화하는가**로 확장한다.
- 5b-7은 HTML 생성 전략과 직교하는 component execution boundary를 세운다. RSC는 SSR·SSG와 조합될 수 있으므로 5b-2의 하위 전략으로 그리지 않는다.
- 5b-8은 5b-5의 넓은 progressive hydration 계열 중 React가 Suspense와 scheduler로 제공하는 built-in mechanism을 다룬다. 5b-6의 streaming과 결합하지만 동일 개념은 아니다.
- 5b-1~4는 대안 비교이고 항상 순차 migration 단계를 의미하지 않는다. 하나의 application에서 route별로, 한 route에서는 component 영역별로 조합할 수 있다.
- Phase 8의 기존 렌더링·Next.js 문서는 Phase 5b의 정의를 반복하기보다 실제 Network/Performance trace와 Core Web Vitals, App Router cache·배포 topology에서 선택이 어떻게 드러나는지 심화한다.

---

## 4. 실습 과제 설계

ROADMAP의 실습을 **공통 fixture 확정 → 네 가지 기본 전략 비교 → 전달·활성화 경계 실험 → RSC 분할 → 영역별 ADR** 순서로 진행한다. framework는 실험 도구일 뿐 학습 목표가 아니며, 한 framework가 모든 전략을 지원하면 setup 비용을 줄이기 위해 사용할 수 있다. 이 경우 version, feature flag, runtime, hosting/cache topology를 고정하고 기록한다. Next.js를 선택하더라도 App Router 기능 전수 학습과 실제 프로젝트 통합은 Phase 8의 범위다.

### 공통 비교 fixture

상품 상세 또는 콘텐츠 상세 페이지 하나를 사용한다. 모든 구현은 같은 semantic HTML, 데이터 shape, 오류 상태, 사용자 동작 계약을 유지한다.

| 영역 | 데이터/상호작용 성격 | 실험에 필요한 이유 |
|---|---|---|
| 제목·본문/상품 설명 | 공개, 변경 빈도 낮음, 검색·link preview 중요 | static/SSR/RSC의 초기 HTML과 bundle 차이 비교 |
| 가격·재고/게시 상태 | 변경 빈도 높음, stale 허용 범위 명시 필요 | SSR/ISR의 freshness와 invalidation 비교 |
| 리뷰·댓글 | 느린 data source, 오류 가능 | buffered/streaming SSR과 Suspense reveal 비교 |
| 개인화 추천/로그인 인사 | 사용자별, shared cache 부적합 | client slice와 request-time rendering 경계 비교 |
| 장바구니/좋아요/검색 입력 | 즉시 상호작용, browser state 필요 | hydration·Client Component·selective priority 비교 |

제어 가능한 data source는 다음 기능을 제공한다.

- monotonic content version과 update timestamp
- 영역별 고정 latency(예: fast/medium/slow)와 manual gate
- 특정 요청 번호·영역의 deterministic failure
- request log와 render log, cache key·hit/miss/stale 상태
- time-based revalidation을 재현할 fake clock 또는 짧고 명시적인 test window

### 과제 A — CSR·SSR·SSG·ISR 공통 비교(1주차, 5b-1~4 병행)

- 같은 route와 사용자 동작을 CSR, request-time SSR, build-time static, incremental/on-demand static variant로 구성한다.
- 네 variant가 같은 데이터를 언제 읽고 어떤 HTML·JavaScript·data request를 전달하는지 공통 타임라인에 표시한다.
- cold request, warm cache, 콘텐츠 변경 직후, revalidation 성공, revalidation 실패를 구분한다. 적용되지 않는 시나리오는 N/A 이유를 쓴다.
- document HTML, response/cache header, request log, build output, client bundle/route chunk, data version을 보존한다.
- 최소 비교 축은 다음과 같다.

| 비교 축 | CSR | SSR | SSG | ISR | 해석 |
|---|---|---|---|---|---|
| HTML/데이터 생성 시점 | | | | | build/request/browser 중 어디인가 |
| cold/warm TTFB | | | | | cache와 server work는 무엇인가 |
| 핵심 콘텐츠가 HTML에 존재하는 시점 | | | | | JavaScript 전에도 읽을 수 있는가 |
| client JavaScript와 data waterfall | | | | | 어떤 코드·요청이 critical path인가 |
| hydration/mount 대상 | | | | | 전체/일부/없음 중 무엇인가 |
| 개인화와 shared cache | | | | | cache key가 사용자 데이터를 섞지 않는가 |
| 데이터 신선도·무효화 | | | | | stale window와 갱신 trigger는 무엇인가 |
| build/server/CDN 운영 비용 | | | | | 비용이 어느 계층으로 이동했는가 |
| 실패 시 사용자에게 보이는 결과 | | | | | blank/error/stale/fallback 중 무엇인가 |
| 적합·부적합 조건 | | | | | 어떤 요구사항에서 결론이 바뀌는가 |

### 과제 B — Buffered SSR, streaming SSR, progressive/selective hydration 비교(2주차, 5b-5·6·8 병행)

- 리뷰·댓글 영역을 manual gate로 지연시켜 buffered SSR에서는 전체 응답을 막고, streaming variant에서는 shell과 다른 영역이 먼저 도착하게 한다.
- server shell start, first byte, boundary chunk, browser insert, client code load, hydration start/end, click handled marker를 서로 다른 이름으로 기록한다.
- shell 전 오류, shell 후 영역 오류, timeout/abort를 재현하고 HTTP status·server log·fallback·다른 영역의 상호작용을 확인한다.
- 비핵심 widget 하나를 immediate/visibility/interaction activation으로 비교하되, server HTML을 유지한 경우와 client-only mount를 분리한다.
- 두 Suspense boundary의 code/data delay를 서로 바꾸고 사용자가 늦은 boundary를 먼저 클릭해 hydration 우선순위·event/focus/value 보존을 관찰한다.
- 큰 단일 boundary와 여러 작은 boundary의 chunk/fallback/오류 격리/상호작용 차이를 비교한다. 더 작은 경계가 항상 승리한다는 결론을 금지한다.

### 과제 C — RSC와 Server/Client Component 경계(2주차, 5b-7 병행)

- 제목·본문·리뷰 목록처럼 표시 중심인 영역을 Server Component로, 장바구니·좋아요처럼 state/event/browser API가 필요한 leaf를 Client Component로 구성한다.
- client-heavy baseline과 server-first variant의 client module/JavaScript bytes, RSC response, server render/data log를 비교한다.
- markdown renderer·formatter 같은 무거운 표시 의존성을 client/server에 각각 두어 client bytes 감소와 server compute 증가를 함께 기록한다.
- Client Component가 Server Component 결과를 children/slot으로 받는 합성과 잘못된 direct import를 비교한다.
- 직렬화 불가능 props와 검증·인가가 없는 Server Function 실패를 local test로 재현하고 안전한 경계로 수정한다.

### 과제 D — 영역별 렌더링 전략 ADR(2주차 종합)

- 페이지 전체에 하나의 약어를 붙이지 않고 공통 fixture의 다섯 영역마다 rendering, data, cache, activation owner를 정한다.
- ADR decision driver는 discoverability, personalization, freshness, interaction urgency, device/network, server capacity, build cardinality, hosting/cache topology, failure tolerance를 포함한다.
- 선택한 조합뿐 아니라 제외한 대안이 더 나아지는 조건, 관측할 production signal, 재검토 trigger, migration/rollback 경로를 기록한다.
- React core 보장과 framework/platform 기능을 표에서 분리한다. 예: Suspense/hydrateRoot와 tag invalidation/CDN purge를 같은 제품 기능으로 쓰지 않는다.

### 측정 프로토콜

- production build를 사용하고 development-only double render·cache bypass·source map 비용을 결과에 섞지 않는다.
- 각 결과에 commit, React/framework/runtime 버전, feature flag, route, browser, viewport, network/CPU 조건, cache cold/warm, data delay/version을 기록한다.
- 동일 조건을 최소 3회 실행하고 대표값과 변동 범위를 남긴다. 작은 차이를 유의미한 개선으로 단정하지 않는다.
- TTFB·FCP·LCP·INP는 정의에 맞는 도구로 수집한다. INP를 얻지 못한 짧은 lab session에서는 click-to-handler marker·long task를 보조 증거로 쓰되 이를 INP라고 부르지 않는다.
- Server-Timing 또는 사용자 정의 performance mark를 사용하면 browser metric과 server/data/cache 사건의 상관관계를 추적할 수 있게 이름을 고정한다.
- bundle bytes는 raw/minified/compressed 중 무엇인지, HTML/RSC/JSON/JS 중 어떤 resource인지 함께 기록한다.
- 실패 실험은 local 또는 소유한 test environment에서만 수행하고 public service·shared production cache를 오염시키지 않는다.

### 권장 산출물 구조

```text
phase-5b-lab/
  shared/
    domain/
    controlled-data/
    instrumentation/
  variants/
    csr/
    ssr/
    static/
    isr/
    streaming/
    rsc/
  tests/
    rendering-contract/
    cache-timeline/
    streaming-errors/
    server-client-boundary/
  evidence/
    html/
    headers/
    traces/
    waterfalls/
    build-output/
    logs/
  reports/
    rendering-matrix.md
    cache-state-machine.md
    hydration-timeline.md
    rsc-boundary.md
  adr/
    001-rendering-strategy.md
```

### 완성 기준(Definition of Done)

- [ ] CSR·SSR·SSG·ISR variant가 동일 semantic HTML·데이터 shape·사용자 동작 계약을 만족하거나, 전략상 의도된 차이를 명시했다.
- [ ] 네 기본 전략의 build/request/cache/browser 계산 위치와 HTML·JS·data 전달 순서를 공통 타임라인과 10개 비교 축으로 설명했다.
- [ ] cold/warm cache, 콘텐츠 변경, revalidation 성공·실패의 cache state와 content version 증거를 기록했다.
- [ ] buffered/streaming SSR에서 shell·느린 boundary·오류·abort의 도착 순서와 status/fallback 차이를 재현했다.
- [ ] HTML 도착, client code 도착, hydration, 첫 처리된 상호작용을 별도 marker로 관찰했다.
- [ ] progressive/selective hydration의 포함 관계와 immediate/visibility/interaction activation의 초기 비용·첫 사용 지연을 비교했다.
- [ ] Server/Client Component 경계가 client bundle·RSC payload·server work에 미친 영향을 전후 증거로 설명했다.
- [ ] serialization 실패와 Server Function의 untrusted input·인가 경계를 안전한 local fixture에서 검증했다.
- [ ] 모든 성능 결과에 production build, 버전, cache/data/network/CPU 조건과 반복 측정 범위를 기록했다.
- [ ] ADR이 페이지 영역별 선택, 대안, freshness·failure 계약, 관측 지표, 재검토·철회 조건을 포함한다.

---

## 5. 공통 집필 기준(Phase 5b 특화)

`docs/phase-5b/`의 실제 문서는 [.agents/content-writing.md](../.agents/content-writing.md)를 따르며, 다음 기준을 추가로 적용한다.

- **요청 타임라인 우선**: 약어 정의나 framework 설정 전에 build/request/cache/browser/hydration 사건을 순서대로 보여 준다. 각 패턴에서 사라지거나 추가되는 단계를 같은 그림으로 비교한다.
- **비용 이동으로 설명**: “빠르다”가 아니라 server TTFB, build lead time, cache staleness, JavaScript bytes, main-thread work, first-use latency 중 무엇이 줄고 어디로 이동했는지 쓴다.
- **패턴을 성숙도 순서로 두지 않음**: CSR·SSR·SSG·ISR·RSC를 초급→고급이나 legacy→modern 순으로 배열하지 않는다. 제품 요구사항과 영역에 따라 CSR 또는 완전 static이 최종 선택일 수 있다.
- **React core·framework·platform 분리**: `createRoot`·`hydrateRoot`·Suspense·server stream API·RSC component model과, framework의 route/cache/revalidation convention, hosting provider의 CDN·purge를 다른 계층으로 표기한다.
- **SSR·RSC·static 용어 엄격히 구분**: server에서 실행된다는 공통점만으로 같은 개념이라 하지 않는다. input, output, 실행 시점, client에 전달되는 code를 표로 비교한다.
- **캐시를 상태 머신으로 설명**: “캐시된다”로 끝내지 않고 key, owner, fresh/stale 조건, invalidation trigger, regeneration, failure behavior, propagation 범위를 적는다.
- **표시와 상호작용을 분리**: HTML이 화면에 있다는 사실과 JavaScript가 준비되고 hydration되어 입력이 처리된다는 사실을 별도 marker와 UI 상태로 설명한다.
- **progressive와 selective 관계 명시**: progressive hydration은 넓은 전략 계열, selective hydration은 React의 Suspense/scheduler 기반 mechanism으로 사용한다. framework별 islands/resumability는 비교 대상으로만 최소 언급한다.
- **production evidence 사용**: dev server 결과로 bundle, cache, streaming, hydration 비용을 단정하지 않는다. 예제와 주장은 production build 및 고정된 cache/data 조건에서 검증한다.
- **정량 수치의 조건 공개**: bundle budget, device parse time, edge TTFB 같은 숫자는 보편 상수로 복사하지 않는다. 측정 장비·버전·네트워크·sample과 출처를 함께 쓰거나 경향만 서술한다.
- **hydration mismatch를 숨기지 않음**: `suppressHydrationWarning`을 일반 해결책으로 제시하지 않는다. server/client 입력 불일치의 원인을 먼저 제거하고 불가피한 1-level escape hatch의 범위를 공식 문서로 확인한다.
- **streaming 오류를 영역화**: shell flush 이후 status code를 되돌릴 수 없는 제약, Error Boundary, timeout/abort, proxy buffering과 CSP inline script 고려를 성공 경로와 함께 다룬다.
- **RSC를 보안 경계로 취급**: server-only code와 secret이 client graph/payload에 들어가지 않는지 확인하고 Server Function의 입력·인가·오류를 일반 endpoint와 같은 수준으로 검증한다.
- **Phase 8로 측정 심화 위임**: Phase 5b의 기본 metric과 trace는 전략 차이를 입증하기 위한 통제 실험이다. field data, p75 Core Web Vitals, 브라우저/네트워크 병목 최적화와 실제 Next.js 배포 관측은 Phase 8에 상대 링크로 넘긴다.

### 문서별 공통 구성

각 문서는 콘텐츠 집필 지침의 기본 구조 안에서 다음 항목을 반드시 포함한다.

1. 사용자 시나리오와 실패 사례
2. 공통 요청 타임라인에서 바뀌는 단계
3. 전달 산출물(HTML·JS·data·RSC payload)과 실행 위치
4. 최소 React 예제와 필요 시 framework adapter
5. cache·data·hydration 상태 전이
6. 장점이 실제로 성립하는 조건
7. 실패 모드와 관찰 실험
8. 다른 rendering pattern과의 조합·전환 경로
9. 선택 체크리스트와 판단형 확인 문제
10. 기준 버전·확인 날짜를 포함한 1차 자료 중심 참고 문헌

---

## 6. 자료와 정확성 검증 전략

### 자료 계층

1. **React 공식 reference·learn·release 자료**: client/server/static API, hydration, Suspense, RSC, directives, 지원·제거 상태.
2. **Web 표준과 프로토콜 1차 자료**: WHATWG HTML, Fetch/Streams, HTTP semantics/caching RFC. MDN은 표준 탐색과 browser compatibility 보조 자료로 사용한다.
3. **선택한 framework 공식 문서**: rendering, cache, revalidation, route, deployment behavior. 반드시 version과 feature flag가 맞는 문서 세트를 사용한다.
4. **hosting/runtime 공식 문서**: Node/Web Stream, CDN cache key·purge·buffering, multi-instance invalidation처럼 framework 밖 동작을 확인한다.
5. **Patterns.dev**: 문제 설정, 패턴 이름, 비교 지형을 위한 2차 자료. 코드와 정량 주장의 현재성은 별도로 검증한다.
6. **production build·소스/타입·실행 실험**: 문서만으로 모호한 hydration 순서, cache state, stream 오류, boundary serialization을 확인한다.

### 문서별 출발 자료

| 문서 | Patterns.dev | 우선 확인할 1차 자료 |
|---|---|---|
| 5b-1 CSR | [Client-side Rendering](https://www.patterns.dev/react/client-side-rendering/) | [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot), HTML module/script loading, 선택 bundler의 build·preload 문서 |
| 5b-2 SSR | [Server-side Rendering](https://www.patterns.dev/react/server-side-rendering/) | [React Server APIs](https://react.dev/reference/react-dom/server), [`hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot), hydration mismatch 공식 troubleshooting |
| 5b-3 Static | [Static Rendering](https://www.patterns.dev/react/static-rendering/) | [React Static APIs](https://react.dev/reference/react-dom/static), 선택 framework의 prerender/build output·dynamic opt-out 문서, HTTP/CDN cache 자료 |
| 5b-4 ISR | [Incremental Static Generation](https://www.patterns.dev/react/incremental-static-rendering/) | [HTTP `Cache-Control`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)에서 fresh/stale/SWR 확인, 선택 framework의 current revalidation·self-host/CDN 문서 |
| 5b-5 Progressive Hydration | [Progressive Hydration](https://www.patterns.dev/react/progressive-hydration/) | React `hydrateRoot`·Suspense·lazy 공식 문서, IntersectionObserver·HTML form progressive enhancement 자료, 선택 framework의 activation/island 문서 |
| 5b-6 Streaming SSR | [Streaming SSR](https://www.patterns.dev/react/streaming-ssr/) | [`renderToPipeableStream`](https://react.dev/reference/react-dom/server/renderToPipeableStream), [`renderToReadableStream`](https://react.dev/reference/react-dom/server/renderToReadableStream), Web Streams·HTTP response·CSP 공식 자료 |
| 5b-7 RSC | [React Server Components](https://www.patterns.dev/react/react-server-components/) | [React Server Components](https://react.dev/reference/rsc/server-components), [`'use client'`](https://react.dev/reference/rsc/use-client), [`'use server'`](https://react.dev/reference/rsc/use-server), Server Functions 보안 자료 |
| 5b-8 Selective Hydration | [Selective Hydration](https://www.patterns.dev/react/react-selective-hydration/) | React `hydrateRoot`·Suspense·Activity/reference와 React 18 SSR architecture 공식 자료, current server API 제거·대체 목록 |

### framework 자료 선택 규칙

- 문서 상단 또는 package manifest에 실제 사용 version과 확인 날짜를 기록한다.
- current 모델과 previous/legacy 모델 문서를 한 예제 안에서 섞지 않는다. Next.js라면 Cache Components 활성 여부에 따라 caching/revalidation 문서가 달라질 수 있으므로 실험 설정을 먼저 고정한다.
- experimental/canary API는 안정 API처럼 서술하지 않고 status, flag, fallback, 제거 가능성을 표시한다.
- managed hosting의 cache coordination·purge를 self-hosted runtime의 보장으로 일반화하지 않는다. multi-instance와 external CDN이 있으면 topology를 함께 그린다.
- framework가 만든 HTML·RSC·data/client-router cache를 HTTP browser cache 하나로 설명하지 않는다.

### 집필 시 검증 체크

- React·framework·runtime·TypeScript version과 production command를 기록하고 code example의 typecheck·test·build를 실행한다.
- Patterns.dev의 `ReactDOM.render`, `ReactDOM.hydrate`, `renderToNodeStream`, `pipeToNodeWritable`류 legacy/오류 가능 API는 current official replacement를 확인한 뒤 역사 설명과 실행 예제를 분리한다.
- `createRoot`와 `hydrateRoot`, SSR과 RSC, `'use server'`와 Server Component의 차이를 모든 문서에서 같은 용어로 유지한다.
- SSR 예제는 no-JavaScript HTML, hydration mismatch, recoverable error, request data isolation을 검증한다.
- static/ISR 예제는 build artifact, content version, cache header/log, invalidation 이후 실제 regeneration·propagation을 구분한다.
- streaming 예제는 shell 전/후 오류, abort, timeout, crawler/all-ready, proxy buffering 중 적용 가능한 시나리오를 production build에서 확인한다.
- RSC 예제는 client bundle graph, RSC response, serializable boundary, server-only secret, Server Function authorization을 확인한다.
- selective hydration 주장은 code/data delay와 사용자 입력을 제어한 실행 실험 또는 React 공식 자료로 뒷받침한다. 내부 scheduler 구현을 공개 계약처럼 단정하지 않는다.
- 성능 결과는 조건·반복·변동 범위를 남기며, 통제 fixture의 결과를 모든 제품·기기·hosting 환경으로 일반화하지 않는다.
- 로컬 Markdown link, external source 상태, navigation label/order, VitePress production build를 통합 검토에서 확인한다.

---

## 7. 집필 순서와 진행 체크리스트

### 권장 집필 순서

1. **공통 fixture와 계측 vocabulary 확정**: semantic HTML·데이터 shape·고정 latency/failure·content version·timeline marker를 먼저 만든다.
2. **5b-1~5b-2 집필**: client mount와 server HTML+hydration을 같은 cold-load timeline으로 대비해 핵심 용어를 고정한다.
3. **5b-3~5b-4 집필**: build snapshot과 revalidation state machine을 추가하고 HTTP/framework/CDN cache 계층을 분리한다.
4. **기본 전략 비교 실습 작성**: 네 variant의 동작 계약·10개 비교 축·cold/warm/change/failure evidence template를 확정한다.
5. **5b-5~5b-6 집필**: progressive activation의 넓은 분류와 server HTML streaming을 분리해 작성하고 공통 slow/error fixture를 재사용한다.
6. **5b-7 집필**: SSR과 다른 RSC execution/serialization boundary를 설명하고 client-heavy/server-first 비교를 검증한다.
7. **5b-8 집필**: progressive hydration·streaming SSR·RSC/Client Component의 교차점을 selective hydration timeline으로 종합한다.
8. **실습 문서 작성**: `exercises/phase-5b/README.md`에 과제 A~D, 측정 프로토콜, evidence 구조, DoD를 옮긴다.
9. **통합 검토**: 인접 Phase 중복, version/source, cache·hydration 용어, 오류·보안·접근성, 상대 링크, navigation, ROADMAP 문서 수와 상태를 점검한다.

### 진행 체크리스트

- [x] `ROADMAP.md`의 Phase 5b 목표·8개 문서·실습 범위를 PLAN에 구체화
- [ ] 공통 비교 fixture·데이터 지연/실패 controller·계측 marker 확정
- [ ] 5b-1 `01-client-side-rendering.md`
- [ ] 5b-2 `02-server-side-rendering.md`
- [ ] 5b-3 `03-static-rendering.md`
- [ ] 5b-4 `04-incremental-static-generation.md`
- [ ] 5b-5 `05-progressive-hydration.md`
- [ ] 5b-6 `06-streaming-server-side-rendering.md`
- [ ] 5b-7 `07-react-server-components.md`
- [ ] 5b-8 `08-selective-hydration.md`
- [ ] `exercises/phase-5b/README.md` 과제 안내 문서
- [ ] Phase 8의 렌더링 전략·Next.js 문서와 중복 설명·위임 링크 검토
- [ ] 문서 간 상대 링크·자료 확인 날짜·framework version/feature flag 검증
- [ ] `docs/.vitepress/navigation.ts`의 Phase 5b 발견 패턴·레이블·정렬과 nav/sidebar 포함 검증
- [ ] TypeScript/JavaScript code fence typecheck·test와 VitePress production build
- [ ] cache·streaming·hydration·RSC 실험의 production evidence 기준 충족
- [ ] `ROADMAP.md` 5절 진행 현황을 실제 문서 수와 완료 상태에 맞춰 갱신
