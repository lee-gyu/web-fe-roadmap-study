# 부록 C — SolidJS 교육 과정 계획

> 기획일: 2026-07-11
>
> 기준 문서: `plan/appendix-c/solid-js-summary.md`
>
> 원본 확인 자료: `.raw/solid-js.md`
>
> 목적: `ROADMAP.md`에 추가할 선택 과정 **appendix-c SolidJS**의 7개 파트 범위, 학습 순서, 원본 확인 구간을 확정한다.

## 1. 기획 결론

부록 C는 SolidJS API를 나열하는 입문서가 아니라, React의 컴포넌트 재렌더 모델과 다른 **세밀한 반응성(fine-grained reactivity)**의 실행 원리를 세우고 그 원리가 컴포넌트, 비동기 UI, SSR, SolidStart까지 어떻게 이어지는지 추적하는 선택 과정으로 구성한다.

과정은 다음 순서를 따른다.

1. Solid 고유의 상태-UI 동기화 모델을 React식 추론과 분리한다.
2. signal-computation-effect-memo로 이루어진 반응형 그래프를 직접 설명하고 구현한다.
3. JSX, props, context, lifecycle, ref를 세밀한 갱신 모델 위에서 해석한다.
4. computation의 실행 시점, owner, cleanup, error boundary로 런타임 모델을 확장한다.
5. 조건·목록·portal·store·directive로 UI와 상태 추상화를 구성한다.
6. resource, Suspense, transition과 코드·이벤트 로딩을 하나의 비동기 UI 모델로 연결한다.
7. SSR, Router, SolidStart를 결합해 서버와 클라이언트의 실행 경계를 검증한다.

### 범위 원칙

- 교육 범위의 기준은 `solid-js-summary.md`의 **학습 초점, 핵심 내용, 교육 과정 연결**이다. 원본은 설명과 예제를 확인하는 자료로만 사용하며, 요약에서 제거된 세부 내용을 새 학습 항목으로 되살리지 않는다.
- Chapter 2의 개발 환경 직접 구성과 Appendix 1의 Webpack 설정은 의도적으로 제외한다. Part 1은 이 때문에 원본 범위가 비연속적이다.
- Chapter 32의 JSX 없는 Solid는 일반 애플리케이션의 필수 지식이 아니라 컴파일 단계의 가치와 대안의 비용을 비교하는 선택형 심화로 둔다.
- 원문은 Solid v1.8 기준이다. 개념과 실행 모델은 원문을 사용하되, 특히 `SuspenseList`, Solid Router, SolidStart의 API와 동작은 본문 집필 시 최신 공식 문서로 다시 확인한다.
- 선수 지식은 JavaScript·TypeScript, HTML·CSS, 브라우저 DOM과 비동기 실행 모델이다. React 경험자는 비교 관점으로 활용하되 React의 함수 컴포넌트 재실행 규칙을 Solid에 그대로 적용하지 않는다.

## 2. ROADMAP 반영 초안

**학습 목표**: Solid의 세밀한 반응성 그래프에서 무엇이 의존성을 수집하고 무엇이 다시 실행되며 어떤 표현식이 실제 DOM을 갱신하는지 설명할 수 있다. 이 모델을 근거로 signal·effect·memo, 컴포넌트·props·context, 제어 흐름·store, resource·Suspense·transition을 선택하고, SSR·Router·SolidStart의 서버-클라이언트 경계와 비용을 관찰해 설계할 수 있다.

**운영 원칙**: React와의 문법 유사성보다 실행 모델의 차이를 먼저 다룬다. 각 파트는 API 사용 예제를 넘어 의존성 그래프, computation 실행 횟수, DOM 보존, network waterfall, hydration 시점을 관찰한다. 원문 기반 예제의 버전 민감 API는 최신 공식 문서와 대조하고, 요약이 교육 범위에서 제외한 환경 설정과 부록 내용은 포함하지 않는다.

| 파트 | 문서 | 원본 Chapter / line | 주요 내용 |
|---|---|---|---|
| C-1 | `docs/appendix-c/01-solid-mental-model.md` | Chapter 1 `5-105`, Chapter 3 `314-817` | **입문과 기본 관점**: Solid의 성격과 선수 지식, React식 추론을 내려놓아야 하는 이유, 브라우저 렌더링 파이프라인과 상태-UI 동기화 문제, 세밀한 반응성·컴파일·단방향 데이터 흐름·합성 가능한 UI의 큰 그림 |
| C-2 | `docs/appendix-c/02-fine-grained-reactivity.md` | Chapter 4-7 `818-1918` | **반응성 핵심 모델**: Observer 패턴으로 reactive core 구현, signal의 accessor·setter·비교·batch, effect의 자동/명시적 추적과 cleanup, memo의 캐시·비교·전파. 상태·부수 효과·파생 값의 책임 분리 |
| C-3 | `docs/appendix-c/03-jsx-and-components.md` | Chapter 8-13 `1919-4966` | **JSX와 컴포넌트 기초**: JSX 컴파일 관점, 한 번 실행되는 컴포넌트와 반응형 표현식, props·children·Context의 데이터 흐름, lifecycle·cleanup, ref와 외부 DOM 라이브러리 경계 |
| C-4 | `docs/appendix-c/04-reactive-runtime.md` | Chapter 14-18 `4967-6590` | **반응성 런타임 확장**: computation primitive의 실행 시점, ErrorBoundary와 `catchError`, owner 트리와 비동기 경계, 선언형/명령형 styling, 반응성·props·외부 연동 utility |
| C-5 | `docs/appendix-c/05-control-flow-and-state.md` | Chapter 19-23 `6591-8300` | **제어 흐름과 상태 추상화**: `Show`·`Switch`·`Match`, `For`·`Index`와 항목 신원, `Portal`, proxy 기반 store와 utility, custom directive의 컴파일·반응성·cleanup |
| C-6 | `docs/appendix-c/06-async-ui-and-interactions.md` | Chapter 24-32 `8301-11298` | **비동기 UI와 상호작용**: 수동 async 상태에서 resource로의 전환, Suspense·transition·SuspenseList, lazy와 코드 분할, 이벤트 부착 전략, `Dynamic`, JSX 없는 런타임 대안과 한계 |
| C-7 | `docs/appendix-c/07-ssr-router-and-solidstart.md` | Chapter 33-35 `11299-19252` | **서버 렌더링과 풀스택**: 문자열·비동기·스트리밍 SSR과 hydration, Router의 경로·탐색·데이터·form mutation, SolidStart의 파일 규약·서버 기능·캐시·인증과 서버-클라이언트 경계 |

**통합 적용 과제**: 동일한 데이터 중심 애플리케이션을 signal과 store로 구성하고, 목록 갱신·비동기 요청·오류·로딩·전환을 구현한다. reactive core의 의존성 전파와 DOM 갱신 범위를 기록한 뒤 CSR과 streaming SSR의 HTML 응답, network waterfall, hydration 시점을 비교한다. 마지막으로 Solid Router와 SolidStart를 적용해 데이터 읽기·mutation·인증·cache invalidation의 서버 경계를 설명하는 설계 노트를 작성한다.

## 3. 파트별 상세 계획과 원본 line map

라인 번호는 `.raw/solid-js.md`의 1-based line 기준이며 양 끝을 모두 포함한다. 예를 들어 Part 2 전체는 `sed -n '818,1918p' .raw/solid-js.md`로 읽을 수 있다. Part 1은 Chapter 2를 제외하기 위해 두 범위를 따로 읽는다.

### C-1. 입문과 기본 관점

**중심 질문**: Solid에서는 무엇이 다시 실행되고, 무엇이 실제 DOM을 갱신하는가?

**학습 목표**

- Solid의 적용 범위와 선수 지식을 파악하고 Playground 또는 공식 템플릿으로 실행 환경을 확인한다.
- React와 Solid가 JSX를 공유하더라도 컴파일 결과, 상태 보존, 렌더링 모델이 다르다는 전제를 세운다.
- 브라우저의 DOM·CSSOM·layout·paint 흐름 위에서 상태를 UI와 동기화하는 문제를 설명한다.
- 세밀한 반응성, 선언형 UI, 단방향 데이터 흐름, 컴포넌트 합성, streaming SSR과 대체 렌더링을 이후 파트의 지도로 연결한다.

| Chapter | 원본 line | 읽기 초점 |
|---|---:|---|
| 1. Introduction | `5-105` | Solid의 성격과 책의 범위, JavaScript·HTML·CSS·Node.js 선수 지식, Playground·공식 템플릿, React 개발자를 위한 실행 모델 경고 |
| 3. On SolidJS | `314-817` | 브라우저 렌더링 배경, 상태에서 UI를 파생하는 관점, 세밀한 반응성·컴파일·단방향 흐름·합성 가능한 UI의 개관 |

**범위 메모**: `106-313`의 Chapter 2는 읽기 범위와 교육 항목 모두에서 제외한다. 두 챕터를 하나의 연속 범위(`5-817`)로 읽지 않는다.

**완료 기준**: 같은 카운터 예제를 React의 컴포넌트 재실행 관점과 Solid의 반응형 표현식 갱신 관점으로 각각 설명하고, Solid에서 관찰해야 할 실행 단위를 표시한다.

### C-2. 반응성 핵심 모델

**중심 질문**: signal의 읽기와 쓰기가 어떻게 의존성 그래프를 만들고 필요한 computation에만 갱신을 전파하는가?

**학습 목표**

- Observer 패턴에서 signal의 구독자 집합과 현재 computation을 도출하고 작은 reactive core를 구현한다.
- `createSignal`의 accessor, setter, 함수형 갱신, `equals`, 객체 참조 비교와 `batch`의 의미를 설명한다.
- `createEffect`의 자동 추적, 중첩 effect, `on`, `untrack`, 이전 값과 cleanup을 외부 시스템 동기화에 적용한다.
- 일반 파생 함수와 `createMemo`를 비교하고 signal·effect·memo의 책임과 전파 조건을 구분한다.

| Chapter | 원본 line | 읽기 초점 |
|---|---:|---|
| 4. How Solid's Reactive System Works | `818-1267` | signals·computations·memos로 reactive core 구성, 구독 수집과 갱신 전파 |
| 5. Tracking State With Signals | `1268-1515` | accessor·setter, 비교 로직, 함수형 갱신, 값 파생, 구조 분해, batch |
| 6. Running Side-Effects with Effects | `1516-1744` | 자동·명시적 dependency tracking, 중첩 effect, 추적 제외, 외부 의존성과 cleanup |
| 7. Caching Values with Memos | `1745-1918` | computation과 read-only signal의 결합, 캐시·이전 값·비교 옵션, 하위 전파 |

**완료 기준**: 최소 reactive core를 작성하고 signal 갱신 하나가 어떤 computation을 어떤 순서로 다시 실행하는지 trace한다. 같은 계산을 effect, 일반 파생 함수, memo로 각각 표현해 책임과 실행 횟수의 차이를 설명한다.

### C-3. JSX와 컴포넌트 기초

**중심 질문**: 컴포넌트 함수가 매 갱신마다 재실행되지 않는다면 JSX, props, context와 DOM 연결은 어떻게 반응성을 유지하는가?

**학습 목표**

- JSX의 요소·표현식·속성·boolean·주석·공백 규칙을 컴파일 대상 표현식으로 이해한다.
- 컴포넌트의 반환 계약, props, children, TypeScript 타입과 조건부 표현을 구성한다.
- props의 읽기 전용·지연 평가 성격을 보존하고 구조 분해·spread·forwarding의 실행 순서와 위험을 설명한다.
- props 전달과 Context의 범위 기반 공유를 비교하고 provider가 owner 계층과 연결되는 방식을 이해한다.
- `onMount`·`onCleanup`과 ref의 실행 시점을 결합해 외부 자원의 할당·해제를 설계한다.

| Chapter | 원본 line | 읽기 초점 |
|---|---:|---|
| 8. Rules of JSX | `1919-2318` | JSX 문법, 표현식과 속성, 컴파일 관점과 합성 가능성 |
| 9. Composing User Interfaces | `2319-3590` | 컴포넌트 실행, props·children·타입, 반응형 props와 구조 분해의 영향 |
| 10. Working With Props | `3591-3910` | 부모-자식 데이터·행동 전달, 상태 끌어올리기, spread·forwarding·검증 |
| 11. Sharing Data Through the Context API | `3911-4352` | Context 생성·제공·소비, 중첩 provider, owner 기반 탐색과 custom hook |
| 12. Component Lifecycle | `4353-4526` | mount와 cleanup, 외부 이벤트·timer·구독의 수명 |
| 13. Accessing DOM Nodes With `ref` | `4527-4966` | callback/변수 ref, 실행 시점, forwarding, 외부 라이브러리와 cleanup |

**완료 기준**: props, Context, ref를 각각 사용하는 작은 합성 UI를 만들고 컴포넌트 함수·반응형 표현식·effect·ref callback의 실행 횟수와 순서를 기록한다. 외부 DOM 라이브러리를 연결한 경우 폐기 시 cleanup도 검증한다.

### C-4. 반응성 런타임 확장

**중심 질문**: computation의 실행 시점과 소유권을 어떻게 선택하고, 실패와 비동기 경계에서 수명을 어떻게 보존하거나 종료하는가?

**학습 목표**

- `createComputed`, `createRenderEffect`, `createEffect`, `createMemo`, `createDeferred`, `createReaction`의 목적과 실행 시점을 비교한다.
- `ErrorBoundary`의 fallback·reset과 저수준 `catchError`를 복구 단위에 맞게 배치한다.
- owner 트리와 자식 computation의 정리, `getOwner`·`runWithOwner`·`createRoot`, `await` 이후의 문맥 손실을 설명한다.
- 반응형 style·`classList`와 ref 기반 명령형 스타일링의 경계를 선택한다.
- `batch`·`untrack`·`on`, `mergeProps`·`splitProps`, 목록·Observable·transition utility를 역할별 참조 지도로 정리한다.

| Chapter | 원본 line | 읽기 초점 |
|---|---:|---|
| 14. Working with Computations | `4967-5303` | computation primitive의 목적·실행 시점·스케줄링 비교 |
| 15. Handling Errors | `5304-5492` | ErrorBoundary·reset·catchError, 동기 오류와 비동기 rejection의 전파 차이 |
| 16. Working with Owners | `5493-5817` | owner 트리, 자식 수명, 현재 owner 접근, 비동기 문맥 경계 |
| 17. Styling Elements | `5818-6180` | style·class·CSS Modules·classList와 명령형 DOM styling 비교 |
| 18. Reactive Utilities | `6181-6590` | 반응성 제어, props 변환, 목록·Observable 연동, transition utility 개관 |

**완료 기준**: computation별 최초 실행과 재실행 순서를 계측하고, owner 폐기 전후의 cleanup을 확인한다. 동기 렌더링 오류와 Promise rejection을 각각 재현해 어느 boundary가 처리하는지 기록한다.

### C-5. 제어 흐름과 상태 추상화

**중심 질문**: 조건·목록·DOM 위치·중첩 상태가 바뀔 때 어떤 신원과 반응성 단위를 보존해야 하는가?

**학습 목표**

- `Show`, `Switch`, `Match`의 분기 평가, fallback, keyed 렌더링과 render props를 비교한다.
- `For`·`mapArray`와 `Index`·`indexArray`가 각각 항목 참조와 인덱스 중 무엇을 보존하는지 설명한다.
- `Portal`로 논리적 컴포넌트 트리와 실제 DOM 트리를 분리하고 modal·tooltip의 mount 지점을 설계한다.
- `createStore`의 proxy 기반 읽기 추적과 `setStore`의 부분 갱신을 이해하고 `produce`·`reconcile`·`unwrap`·`createMutable`의 용도를 구분한다.
- `use:` directive로 반복 DOM 행동을 반응성·cleanup·TypeScript 타입과 함께 캡슐화한다.

| Chapter | 원본 line | 읽기 초점 |
|---|---:|---|
| 19. A Better Conditional Rendering | `6591-6939` | Show·Switch·Match, fallback, keyed 분기와 render props |
| 20. Working with Lists | `6940-7525` | For/mapArray와 Index/indexArray의 신원·DOM 재사용 전략, selector |
| 21. Rendering Components Outside Component Hierarchy | `7526-7601` | Portal mount, event wrapper, Shadow DOM·SVG 옵션 |
| 22. Managing Complex States with Stores | `7602-8108` | proxy 추적, path update, 반응성 제한, store utility와 mutable 모델 |
| 23. Abstracting Behavior With Custom Directives | `8109-8300` | directive 컴파일 결과, 값 accessor, 내부 반응성과 cleanup, JSX 타입 확장 |

**완료 기준**: 같은 목록에 삽입·삭제·재정렬·제자리 갱신을 적용해 `For`와 `Index`의 DOM 재사용 차이를 기록한다. store 기반 편집 상태, Portal modal, cleanup을 가진 DOM directive를 결합하고 각각의 소유·갱신 경계를 설명한다.

### C-6. 비동기 UI와 상호작용

**중심 질문**: 데이터·코드·사용자 입력이 서로 다른 시점에 도착할 때 기존 UI의 일관성과 상호작용 가능성을 어떻게 유지하는가?

**학습 목표**

- Promise 요청을 pending·success·error 상태로 직접 모델링하고 fetch와 rendering의 결합이 만드는 waterfall을 찾는다.
- `createResource`의 source·fetcher·상태·`mutate`·`refetch`를 이용해 비동기 상태를 반응형 그래프에 통합한다.
- Suspense boundary, transition, SuspenseList의 역할을 로딩 표시·기존 UI 보존·공개 순서로 구분한다.
- dynamic import와 `lazy`의 chunk 로딩을 Suspense에 연결하고 분할 크기의 비용을 network waterfall로 확인한다.
- 위임되는 `on` prefix와 직접 listener인 `on:` namespace, ref·directive 등록을 브라우저 네이티브 이벤트 의미와 함께 비교한다.
- `Dynamic`의 런타임 타입 선택과 tagged template/Hyperscript 대안의 반응성·props·ref·SSR 제약을 설명한다.

| Chapter | 원본 line | 읽기 초점 |
|---|---:|---|
| 24. Working with Asynchronous Data | `8301-8676` | Promise 상태, loading·error·retry, HTTP/parsing 실패, fetch-render 분리 |
| 25. Using Resource API for Data Fetching | `8677-9325` | resource source·fetcher·상태·action, 오류 처리, pagination |
| 26. Managing Loading States with Suspense | `9326-9557` | 실제로 읽힌 pending resource, fallback, 중첩 boundary |
| 27. Achieving Better Consistency with Transitions | `9558-9831` | 이전 UI 보존, transition pending과 중복 동작 제어 |
| 28. Coordinating Loading States | `9832-9909` | SuspenseList revealOrder·tail, 실험적 상태와 SSR 제한 |
| 29. Code Splitting and Lazy Loading | `9910-10060` | dynamic import·lazy·Suspense, export 제약, route 단위 분할과 과분할 비용 |
| 30. Handling Events | `10061-10629` | 위임/직접 listener, custom property, ref·directive, handler data와 네이티브 event |
| 31. Dynamically Rendering Components | `10630-10958` | 조건부 내용과 동적 타입의 차이, Dynamic과 props 전달 |
| 32. Solid Without JSX | `10959-11298` | tagged template·Hyperscript, 반응형 표현식·props·ref 제약과 SSR 미지원 |

**완료 기준**: 제어 가능한 지연·실패를 가진 페이지네이션 UI를 수동 상태와 resource 방식으로 각각 구현한다. Suspense·transition·lazy 적용 전후의 fallback 전환, 기존 UI 유지, 요청·chunk waterfall을 기록하고 이벤트 부착 방식별 listener 위치와 cleanup을 확인한다.

### C-7. 서버 렌더링과 풀스택

**중심 질문**: 서버가 만든 HTML, 비동기 데이터, client bundle과 사용자 이벤트가 어떤 순서로 만나 상호작용 가능한 애플리케이션이 되는가?

**학습 목표**

- SPA의 초기 표시·SEO·복잡성·보안 trade-off를 바탕으로 동기·비동기·streaming SSR을 비교한다.
- hydration script와 식별자, server/development 분기, application shell과 client logic의 경계를 추적한다.
- Solid Router를 경로와 탐색, 데이터 로딩, mutation과 form의 세 단위로 나눠 URL 상태·layout·preload·submission을 설계한다.
- SolidStart의 파일 기반 route·layout, asset·style, endpoint·server function·server action, cache·preload·prerender와 middleware·server event를 연결한다.
- 데이터 조회·수정, session 인증·인가, error, toast·확인 dialog를 통합하고 서버리스 요청 격리, 영속 저장소, cache invalidation, 비밀 정보의 서버 경계를 검증한다.

| Chapter | 원본 line | 읽기 초점 |
|---|---:|---|
| 33. Server Side Rendering | `11299-12565` | SPA trade-off, renderToString/Async/Stream, hydration, server 분기, Express SSR와 Router 결합 |
| 34. Solid Router | `12566-16961` | route·layout·navigation, parameter·preload·location, 전환 제어, query·action·form mutation |
| 35. Isomorphic Apps with SolidStart | `16962-19252` | 파일 기반 full-stack 규약, 서버-클라이언트 데이터 교환, cache·endpoint·middleware, 인증과 통합 앱 |

**완료 기준**: 같은 화면을 `renderToString`, `renderToStringAsync`, `renderToStream`으로 렌더링해 첫 HTML, resource 해결, chunk 도착, hydration과 첫 상호작용 시점을 비교한다. SolidStart 통합 앱에서는 read·mutation·redirect·session·cache의 실행 위치를 표시하고 서버 전용 비밀이 client bundle에 포함되지 않음을 확인한다.

## 4. 원본 범위 검증표

| 파트 | 첫 line | 마지막 line | 포함 Chapter | 비고 |
|---|---:|---:|---|---|
| C-1 | `5`, `314` | `105`, `817` | 1, 3 | 비연속 범위. Chapter 2 `106-313` 제외 |
| C-2 | `818` | `1918` | 4-7 | 연속 |
| C-3 | `1919` | `4966` | 8-13 | 연속 |
| C-4 | `4967` | `6590` | 14-18 | 연속 |
| C-5 | `6591` | `8300` | 19-23 | 연속 |
| C-6 | `8301` | `11298` | 24-32 | 연속 |
| C-7 | `11299` | `19252` | 33-35 | 연속. Appendix 1은 `19253`부터이므로 제외 |

검증 결과 선택된 범위는 Chapter 1, 3-35만 포함한다. Chapter 2와 Appendix 1은 계획, 주요 내용, 적용 과제와 원본 읽기 범위에서 제외했다.
