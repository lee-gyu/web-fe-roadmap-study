# 5a-7. React Stack Patterns

> 한 줄 요약: React stack은 인기 패키지 목록이 아니라 제품 요구사항을 runtime부터 UI·관측까지 책임에 배치한 운영 모델이며, 선택은 증거·중복 소유권·재검토 trigger·철회 경로를 포함한 ADR로 완성된다.

이 문서는 React 19.x를 기준으로 하며 React 공식 “Creating a React App”의 framework 권고와 from-scratch 경계를 2026-07-10에 확인했다. 당시 공식 문서는 web framework 후보로 Next.js App Router와 React Router v7을 제시하고, framework가 맞지 않는 제약에서는 Vite 같은 build tool로 직접 구성하는 경로도 문서화한다. 이 목록과 지원 상태는 도입 시점에 다시 검증해야 한다.

## 학습 목표

- 제품의 rendering·data·offline·hosting·team 제약을 stack decision driver로 변환할 수 있다.
- framework와 custom stack이 통합 책임과 결합 비용을 어디에 배치하는지 비교할 수 있다.
- runtime부터 관측까지 책임 지도를 만들고 빈 책임·중복 원본·직접 소유할 glue code를 찾을 수 있다.
- URL·server·client·form draft의 상태 원본을 하나씩 지정할 수 있다.
- 후보를 같은 quality attribute와 관측 증거로 비교하고 ADR에 결정·결과·재검토·철회 경로를 기록할 수 있다.

## 배경: 왜 이것이 존재하는가

“2026년 React stack 추천” 같은 질문은 흔히 router, query cache, form, CSS, test 도구 이름으로 답한다. 하지만 제품이 공개 article인지 창고 내부 terminal인지 모르면 어떤 목록도 근거가 없다.

- 검색 엔진과 link preview가 중요한 공개 콘텐츠는 route별 metadata와 초기 HTML이 중요하다.
- 인증된 내부 관리자 앱은 정적 hosting, 기존 REST API, 빠른 상호작용과 운영 분리가 더 중요할 수 있다.
- offline field app은 local persistence, conflict resolution, background sync가 중심이다.
- 팀이 server runtime을 운영할 권한이 없다면 SSR capability가 있어도 배포할 수 없다.

Stack은 이 요구를 실행·배포·업그레이드하는 책임의 묶음이다. Framework를 고르면 router 하나가 아니라 rendering, data loading, mutation, code splitting, deployment convention이 함께 온다. Custom stack을 고르면 자유를 얻는 대신 그 접착 계약과 upgrade 조합을 팀이 소유한다.

React 공식 문서의 framework 권고는 중요한 기본값이지만 “항상 server를 운영하라”는 뜻은 아니다. 공식 후보들은 CSR/SPA/SSG도 지원하고 필요할 때 route별 server 기능을 추가할 수 있다. 반대로 from-scratch는 작은 도구 선택이 아니라 요구가 자라면서 ad-hoc framework 통합을 직접 소유할 가능성을 뜻한다.

## 핵심 개념

### 도구 이름보다 decision driver를 먼저 쓴다

후보를 보기 전에 시나리오를 관측 가능한 문장으로 바꾼다.

| 축 | 약한 요구 | 검증 가능한 driver 예시 |
|---|---|---|
| 콘텐츠 발견 | “SEO가 중요하다” | article URL은 JS 실행 없이 title·description·본문을 포함한 HTML을 반환한다 |
| 상호작용 | “빠른 앱” | 필터 입력의 p75 interaction latency가 목표 안에 있고 route 이동이 full reload 없이 동작한다 |
| data mutation | “CRUD가 많다” | mutation 뒤 어떤 loader/cache가 무효화되는지 원본이 하나다 |
| offline | “오프라인 지원” | 30분 단절 중 draft 저장, 재접속 시 conflict UI가 재현된다 |
| runtime | “cloud 배포” | 허용된 Node/edge/static runtime과 region, cold start, streaming 지원을 명시한다 |
| 성능 | “bundle이 작다” | 대표 route의 JS budget, LCP/INP 목표와 측정 환경을 정한다 |
| 운영 | “안정적” | error rate, tracing, rollback 시간, 배포 ownership을 정한다 |
| 팀 | “익숙한 기술” | on-call 팀, server 권한, migration 가능 인원과 upgrade window를 기록한다 |

“SEO 필요”를 Boolean으로 쓰면 모든 framework가 지원한다고 답할 수 있다. 어떤 URL, 어떤 crawler/user, 어떤 HTML과 latency인지 scenario로 써야 차이가 드러난다.

### Framework vs custom stack은 통합 책임의 위치다

| 관점 | Framework | Custom stack |
|---|---|---|
| routing/rendering/data | convention과 compiler/runtime integration으로 연결 | 필요한 library를 선택하고 경계를 직접 연결 |
| 초기 일관성 | 공식 template과 upgrade path가 같은 구조를 만든다 | 팀 표준을 별도로 만들고 강제해야 한다 |
| 기능 추가 | framework capability 안에서는 glue가 적다 | 필요한 capability만 추가해 작은 시작 가능 |
| 결합 | route·loader·mutation·deployment model에 결합 | 각 library API와 팀의 adapter/glue에 결합 |
| upgrade | 큰 통합 upgrade 한 축 | 여러 package compatibility matrix와 개별 migration |
| runtime | 지원 adapter와 convention의 제약 | hosting에 맞출 수 있지만 SSR/RSC 등을 직접 통합 |
| 철회 | framework route/data contract를 옮기는 비용 | glue가 퍼졌다면 library 하나 제거도 어려울 수 있음 |

Framework는 “많이 포함돼서 무겁다”, custom은 “가벼워서 유연하다”로 단정할 수 없다. framework가 route code splitting과 server data를 잘 통합해 client JavaScript와 waterfall을 줄일 수 있고, custom SPA가 제품 제약에 정확히 맞아 더 단순할 수도 있다. 결과는 bundle report, request waterfall, deploy topology로 확인한다.

Custom stack을 선택할 정당한 조건도 있다.

- 기존 host shell에 widget으로 들어가 framework document/runtime을 소유할 수 없다.
- 정적 hosting만 허용되고 인증된 client app이 기존 API를 사용한다.
- 특수 runtime이나 embedded webview 제약을 공식 adapter가 지원하지 않는다.
- 제품 수명이 짧고 routing·SSR·server function 요구가 명시적으로 없다.
- 팀이 통합 책임과 향후 migration 비용을 받아들이고 owner를 지정했다.

“익숙해서”만으로는 충분하지 않다. 어떤 framework capability가 불필요하고 어떤 glue를 직접 소유할지 적어야 한다.

### 책임 지도는 빈 칸과 중복을 드러낸다

Stack 문서는 다음 지도를 한 표에 놓는다.

| 계층/책임 | 선택 질문 | Owner 예시 | 필요한 증거 |
|---|---|---|---|
| Runtime/hosting | static, Node, edge 중 어디서 실행·배포하는가 | hosting platform + team | 배포/rollback, region, log 접근 |
| Framework/rendering | CSR/SSG/SSR/RSC를 route별 누가 결정하는가 | framework 또는 팀 glue | HTML, hydration, waterfall 측정 |
| Build/compile | JSX/TS, code split, asset, HMR을 누가 처리하는가 | framework bundler 또는 Vite | build output, chunk graph |
| Routing | URL match, loader, navigation, error boundary owner는 누구인가 | framework/router | 새로고침·뒤로가기·404 테스트 |
| Server data/cache | fetch, dedupe, freshness, invalidation 원본은 어디인가 | route loader 또는 query cache | request count, stale/refresh 시나리오 |
| Client state | local/global/URL 중 어디에 두는가 | React/Context/store | consumer 범위, persistence 요구 |
| Form/validation | draft, pending, server error, schema를 누가 소유하는가 | native form/framework/form library | keyboard, 실패·재제출 테스트 |
| UI/accessibility | primitives, tokens, focus, overlay를 누가 보장하는가 | design system/headless layer | a11y 동작 테스트 |
| Test/observability | unit/component/e2e, logs, traces, Web Vitals owner는 누구인가 | test tools + platform | CI gate, dashboard, alert |

제품에 필요 없는 계층은 “없음”이라고 쓴다. 빈 칸을 도구로 채우는 것이 목표가 아니다. 예를 들어 local-only prototype에 global store가 없다는 것은 누락이 아니라 결정이다. 반대로 production mutation에 error observability owner가 비어 있다면 실제 운영 위험이다.

### 상태마다 원본을 하나 지정한다

[5-6 상태 아키텍처](../phase-5/06-state-architecture.md)의 판정 순서를 stack 전체로 확장한다.

| 상태 | 원본 후보 | 예시 |
|---|---|---|
| 공유·복원 가능한 navigation | URL | filter, pagination, selected workspace |
| 서버가 권위자인 resource | server + 지정 cache | product, permission, order status |
| 한 component 수명의 interaction | React local state | popover open, hover, input visibility |
| feature subtree 공유 | lifted state/Context/store 하나 | cart draft, multi-step wizard |
| 제출 전 편집 | form/DOM draft | dirty field, validation message |
| offline durable state | local database + sync protocol | field inspection draft |

도구 수보다 중복 원본이 더 위험하다.

```text
route loader data ─┐
query cache data ──┼─▶ 같은 /products를 서로 다른 freshness로 표시
global store copy ─┘
```

같은 서버 resource를 route loader, query cache, global store에 복사하면 mutation 뒤 세 곳을 동기화해야 한다. 도구를 제거하거나 역할을 분리한다.

- route loader는 auth/route blocking과 초기 data만, query cache는 이후 freshness를 맡는다면 hydration·key·invalidation 계약을 명시한다.
- framework loader가 revalidation까지 충분히 소유하면 별도 query cache를 쓰지 않는다.
- global store에는 resource 복사본이 아니라 client-only selection ID만 둔다.

### 책임 중복은 capability matrix로 찾는다

| 중복 | 물어볼 질문 | 단일 원본 후보 |
|---|---|---|
| route loader + query cache | dedupe, stale, retry, invalidation을 누가 결정하는가? | 한쪽을 주 owner로 정하고 adapter 계약만 둔다 |
| framework action + form library | pending/error/reset/optimistic state를 누가 그리는가? | native/framework form 또는 복잡한 client form 중 요구에 맞는 하나 |
| Context + external store | 같은 client state를 두 곳에 복사하는가? | store를 Context로 주입하거나 Context state만 유지 |
| CSS framework + component library | token과 responsive rule이 충돌하는가? | design token owner 하나 |
| framework test runner + 별도 runner | 같은 suite를 두 transform 환경에서 돌리는가? | test 종류별 owner를 분리하고 중복 suite 제거 |

Capability가 겹친다는 이유만으로 둘 중 하나를 무조건 삭제하지 않는다. 초기 SSR data를 client cache로 넘기는 것처럼 단계가 다를 수 있다. 중요한 것은 handoff 후 원본, invalidation, 오류 owner가 명시되는가다.

### 두 제품은 같은 stack을 다르게 평가한다

#### 시나리오 A — 공개 기술 콘텐츠 서비스

- article은 crawler와 low-end mobile에서 JS 없이 읽혀야 한다.
- author preview와 draft는 server auth가 필요하다.
- route별 metadata, SSG와 일부 SSR, image/asset 전략이 중요하다.
- content 배포 뒤 10분 이내 반영, CDN rollback이 필요하다.

#### 시나리오 B — 사내 관리자 SPA

- 모든 사용자는 SSO 뒤에 있고 검색 노출이 없다.
- 기존 REST API와 static hosting이 이미 운영된다.
- table/filter interaction이 많고 server rendering 운영 권한이 없다.
- 팀은 client bundle·API latency·권한 오류를 관측해야 한다.

같은 후보를 같은 driver로 비교한다.

| Driver | Framework with integrated rendering/data | Vite 기반 custom SPA |
|---|---|---|
| A: 초기 HTML/metadata | 통합 capability가 직접 맞는다 | 별도 prerender/SSR glue가 필요하다 |
| A: content route 확장 | route convention과 cache 정책 활용 | 팀이 route/data/build 규칙을 소유한다 |
| A: runtime 결합 | adapter·server/cache convention 비용 | static output이면 단순하지만 dynamic preview가 별도다 |
| B: static hosting/기존 API | SPA/static mode가 가능하나 미사용 convention이 생길 수 있다 | 현재 topology와 직접 맞는다 |
| B: client interaction | 둘 다 가능, data/cache owner를 비교해야 한다 | 필요한 router/query/form만 고를 수 있다 |
| B: 운영 권한 | server capability를 쓰지 않으면 이득이 줄 수 있다 | client/API observability glue를 팀이 소유한다 |

이 표만으로 제품 A는 무조건 Next.js, B는 무조건 Vite라고 결론 내리지는 않는다. 실제 후보의 official support, deploy target, prototype의 HTML/request waterfall, 팀 migration 비용을 증거로 채운다. Framework 후보에는 공식 지원되는 full-stack framework를, custom 후보에는 build tool + 명시적 책임 owner를 최소 하나씩 넣는다.

### 도구 선택은 capability와 quality attribute로 검증한다

다음 표현을 피한다.

- “커뮤니티가 크다.” → 필요한 문제의 공식 support 기간, security response, migration guide가 있는가?
- “빠르다.” → 어느 route·device·interaction에서 어떤 metric이 개선되는가?
- “DX가 좋다.” → cold start, HMR, type error, local production parity 중 무엇인가?
- “유연하다.” → 어떤 capability를 교체할 수 있고 adapter가 실제로 존재하는가?

Proof-of-concept는 happy path demo가 아니라 차이를 드러내는 얇은 slice다.

1. 대표 route 하나의 initial HTML과 request waterfall.
2. loader 실패, mutation 뒤 revalidation, back navigation.
3. production build의 route chunk와 client JavaScript.
4. preview deploy, log/trace 연결, rollback.
5. 선택한 runtime 밖으로 이전하는 최소 migration spike.

Benchmark 숫자는 hardware·network·dataset·build mode를 함께 기록한다. 한 번의 local dev 측정으로 stack 전체 우열을 주장하지 않는다.

## 실무 관점

### ADR은 결정뿐 아니라 새 비용을 기록한다

다음 template을 사용한다.

```markdown
# ADR-001: <결정 제목>

- 상태: proposed | accepted | superseded
- 결정일: YYYY-MM-DD
- 검토자: <역할/팀>

## Context
제품 시나리오, 현재 topology, 바꿀 수 없는 제약을 쓴다.

## Decision drivers
우선순위와 검증 가능한 quality attribute를 쓴다.

## Candidates
Framework 후보와 custom 후보를 같은 축으로 비교한다.

## Decision
선택과 각 책임의 owner, 상태 원본을 쓴다.

## Consequences
얻는 것, 새 결합·운영·학습·upgrade 비용을 모두 쓴다.

## Validation
metric, 사용자 시나리오, build/deploy/observability 증거를 쓴다.

## Revisit triggers
어떤 요구·수치·지원 상태가 바뀌면 다시 검토하는지 쓴다.

## Exit path
adapter, 데이터/route 이전 순서, 제거 가능한 경계를 쓴다.
```

사내 관리자 예시의 핵심만 채우면 다음과 같다.

```markdown
## Decision
정적 hosting + Vite build + React Router의 client routing을 사용한다.
서버 resource는 query cache 하나가 원본이고 URL이 table filter의 원본이다.
form draft는 각 form에 지역화하며 global store로 복사하지 않는다.

## Consequences
+ 기존 CDN/REST 운영 모델을 유지하고 client deploy를 독립한다.
+ route별 SSR runtime을 운영하지 않는다.
- auth bootstrap, route error, cache hydration glue를 팀이 소유한다.
- 공개 route나 초기 HTML 요구가 생기면 rendering 전략 migration이 필요하다.

## Validation
- 대표 route production JS budget과 p75 INP를 CI/실사용에서 추적한다.
- 권한 만료, mutation invalidation, back navigation e2e를 통과한다.
- preview deploy에서 source map, API trace correlation, rollback을 확인한다.

## Revisit triggers
- 인증 전 공개 콘텐츠 route가 추가된다.
- 초기 data waterfall이 성능 목표를 2회 연속 넘는다.
- static host 정책이 바뀌거나 React framework-level 기능이 제품 요구가 된다.

## Exit path
domain API와 view는 router/query adapter 밖에 유지한다. route 단위로 framework
loader로 옮기고 같은 URL·동작 계약 테스트를 재사용한다.
```

이 ADR의 핵심은 Vite 추천이 아니라 **현재 driver가 바뀌면 결론도 바뀌도록 만든 것**이다.

### Framework 결합과 library 결합을 같은 눈으로 본다

Framework lock-in만 경계하고 custom glue를 중립이라고 생각하면 안 된다. 앱 전체에 query client type, router hook, SDK message type이 퍼지면 library 교체도 대규모 migration이다. [5a-4](./04-container-presentational-pattern.md)와 [5a-6](./06-ai-ui-patterns.md)의 adapter/view 경계가 stack 철회 비용을 줄인다.

- route component가 URL/loader contract를 소유하고 domain 함수는 framework를 import하지 않는다.
- server data를 UI props/view model로 변환한다.
- AI SDK type을 transport adapter 밖으로 노출하지 않는다.
- design token과 accessible primitive public API를 특정 page에서 재정의하지 않는다.

모든 것을 추상화할 필요는 없다. 철회 가능성이 낮고 framework capability를 깊게 활용해야 가치가 생기는 영역은 직접 사용한다. ADR에 그 결합을 의식적으로 받아들였다고 기록한다.

### Version과 생태계 상태는 날짜 있는 증거다

“React Router는 v7이다”, “후보 X는 beta다” 같은 사실은 바뀐다. 도입과 정기 review 때 다음을 갱신한다.

- React 공식 framework 권고와 framework 공식 support matrix.
- target runtime adapter와 deployment provider 지원.
- package의 stable/beta/maintenance 상태와 security/migration 문서.
- 실제 lockfile version, breaking change 범위, 지원할 Node/browser.
- bundle/benchmark를 실행한 commit과 날짜.

Patterns.dev나 연도 제목의 article은 지형을 잡는 출발점일 뿐 현재 지원 상태의 근거가 아니다.

### 관찰 실험

**실험 1 — 책임 지도 audit**

Phase 5 SPA의 import와 runtime 흐름을 위 책임 표에 배치한다. 각 행에 owner가 정확히 하나인지, handoff가 있는지, 비어 있어도 되는지 표시한다. 같은 server resource가 loader/cache/store에 중복되면 mutation timeline을 그려 stale 지점을 찾는다.

**실험 2 — 같은 stack, 다른 제품**

공개 콘텐츠와 내부 관리자 시나리오를 같은 matrix로 평가한다. 점수만 합산하지 말고 mandatory constraint를 먼저 적용한다. 예를 들어 server runtime 운영이 금지되면 server-only rendering 후보는 capability가 좋아도 탈락하거나 static mode로 재평가한다.

**실험 3 — 철회 spike**

선택한 router 또는 data cache에 묶인 대표 feature 하나를 adapter 경계 밖의 fake로 바꿔 본다. 예상보다 domain/view 수정이 크면 ADR의 exit path와 결합 비용을 수정한다.

### 선택 체크리스트

- 도구를 보기 전에 제품·runtime·team constraint를 관측 가능한 driver로 썼는가?
- Framework와 custom 후보를 최소 하나씩 같은 축으로 비교했는가?
- responsibility map에 owner, handoff, 의도적으로 빈 책임이 드러나는가?
- URL·server·client·form/offline state의 원본이 하나씩 지정됐는가?
- loader/query cache, action/form, Context/store 같은 기능 중복을 audit했는가?
- 성능·DX·운영 주장을 production build·배포·관측 증거로 검증했는가?
- ADR에 선택하지 않은 후보와 새 비용을 함께 기록했는가?
- 재검토 trigger와 route/data별 점진적 exit path가 있는가?
- 공식 지원 상태와 version을 결정 날짜에 다시 확인했는가?

## 정리

- React stack은 dependency 목록이 아니라 runtime부터 관측까지 책임과 상태 원본을 배치한 운영 모델이다.
- Framework는 통합 capability와 convention을 제공하고 그 runtime·upgrade model에 결합한다. Custom stack은 필요한 계층만 고르지만 통합·호환·glue를 팀이 소유한다.
- 제품 시나리오를 SEO 같은 label이 아니라 초기 HTML, interaction latency, hosting 권한 같은 검증 가능한 driver로 바꾼다.
- responsibility map은 빈 책임과 중복 원본을 찾고, state owner 표는 URL·server·client·form draft의 동기화 버그를 줄인다.
- 후보는 같은 quality attribute와 prototype 증거로 비교하며 인기·연도·다운로드 수를 영구 사실로 쓰지 않는다.
- ADR은 결정, 얻는 것, 새 비용, 검증 metric, 재검토 trigger, exit path까지 포함해야 한다.

## 확인 문제

**Q1.** “SEO가 필요하므로 full-stack framework”라는 결론이 불충분한 이유와 decision driver를 개선한 예를 제시하라.

<details>
<summary>정답과 해설</summary>

SEO는 여러 요구를 뭉친 label이라 후보를 구분하지 못한다. “공개 article URL은 JS 실행 없이 title·description·본문 HTML을 반환하고 publish 뒤 10분 내 CDN에 반영된다”처럼 대상 route, 소비자, output, 시간 조건을 쓴다. 그 뒤 SSG/SSR/static export 후보를 같은 HTML·배포 증거로 비교한다.
</details>

**Q2.** route loader와 query cache가 모두 `/products`를 읽는다. 두 도구를 함께 쓰는 것 자체가 잘못인가?

<details>
<summary>정답과 해설</summary>

반드시 잘못은 아니다. loader가 auth와 초기 request를 맡고 cache가 client freshness를 맡는 명시적 handoff가 있을 수 있다. 다만 query key, hydration, stale policy, mutation invalidation의 주 owner가 하나여야 한다. 같은 resource를 독립적으로 fetch/cache해 서로 다른 freshness를 보이면 중복 원본이므로 한쪽을 제거하거나 역할을 분리한다.
</details>

**Q3.** Custom stack은 lock-in이 없다는 주장에 반례를 들고 exit path를 제시하라.

<details>
<summary>정답과 해설</summary>

모든 component가 router Hook, query result, SDK type을 직접 import하면 여러 library contract와 팀 glue에 광범위하게 결합된다. route/data/transport adapter가 domain을 view model과 command callback으로 변환하고 같은 사용자 동작 테스트를 경계 밖에 둔다. 이전 시 route 또는 feature 단위로 adapter를 바꾸며 domain/view를 보존한다.
</details>

## 참고 자료

- [React — Creating a React App](https://react.dev/learn/creating-a-react-app) — 현재 공식 framework 기본값, CSR/SPA/SSG와 route별 server 기능의 범위를 확인한다.
- [React — Build a React App from Scratch](https://react.dev/learn/build-a-react-app-from-scratch) — Vite 등 build tool로 직접 구성할 때 routing·data·rendering 통합 책임이 팀에 남는 경계를 확인한다.
- [React Router — Framework installation](https://reactrouter.com/start/framework/installation) — React Router framework mode의 현재 공식 시작점과 runtime adapter를 확인한다.
- [Vite — Getting Started](https://vite.dev/guide/) — custom client stack의 build tool capability와 현재 요구 runtime을 확인한다.
- [Thoughtworks — Lightweight Architecture Decision Records](https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records) — context·decision·consequence를 짧게 보존하는 ADR 관행을 확인한다.
- [Patterns.dev — React Stack Patterns](https://www.patterns.dev/react/react-2026/) — stack 지형과 문제 설정을 위한 2차 자료다. 현재 지원 상태의 근거로 단독 사용하지 않는다.
