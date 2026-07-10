# 5b-1. Client-side Rendering

> 한 줄 요약: CSR은 서버 렌더링이 없는 단순한 전략이 아니라, 최초 UI 계산과 데이터 결합 비용을 브라우저로 옮기고 긴 세션의 빠른 전환으로 그 선행 비용을 회수하는 전략이다.

이 문서는 2026년 7월 11일에 확인한 React 19 계열의 `createRoot`와 현재 HTML module loading 문서를 기준으로 한다. 프레임워크별 라우터·서버 상태 API보다 계산 위치와 요청 순서를 설명한다.

## 학습 목표

- CSR의 cold entry와 이미 실행 중인 SPA navigation 타임라인을 구분해 설명할 수 있다.
- HTML·JavaScript·data가 언제 도착하고 어느 런타임에서 UI로 결합되는지 추적할 수 있다.
- 초기 JavaScript, client data waterfall, main-thread work가 표시와 첫 상호작용을 늦추는 경로를 진단할 수 있다.
- 공개 콘텐츠와 인증 앱의 요구사항을 비교해 CSR이 비용을 회수하는 조건을 판단할 수 있다.
- 코드 분할·preload·app shell이 줄이는 비용과 새로 만드는 비용을 함께 검증할 수 있다.

## 배경: 왜 이것이 존재하는가

서버가 완성된 문서를 매 이동마다 내려 주는 방식은 문서 탐색에는 강하지만, 편집기·대시보드처럼 작은 입력마다 화면 일부가 바뀌는 애플리케이션에는 전환 비용이 크다. CSR(Client-side Rendering)은 정적 배포 가능한 HTML shell과 애플리케이션 코드를 먼저 받은 뒤, 브라우저가 라우팅·데이터 결합·렌더링을 계속 소유하게 한다.

예를 들어 로그인 뒤 몇 시간 사용하는 재고 관리 화면은 검색 노출보다 다음 조건이 중요하다.

- 필터와 표 선택 상태를 전환마다 보존한다.
- 기존 API와 정적 hosting을 재사용한다.
- 첫 진입 한 번보다 이후 수백 번의 지역 상호작용이 더 많다.

이 조건에서는 초기 bundle 비용을 긴 세션에 걸쳐 상쇄할 수 있다. 반대로 검색에서 들어와 글 하나만 읽고 나가는 사용자는 초기 비용을 회수하기 전에 이탈한다. CSR의 실패는 “React가 느려서”가 아니라 제품의 세션 길이와 유입 경로에 비용 배치가 맞지 않을 때 생긴다.

## 핵심 개념

### cold entry에서는 HTML보다 JavaScript가 UI의 전제다

가장 작은 CSR 문서는 대체로 root와 module entry만 가진다.

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inventory</title>
  </head>
  <body>
    <div id="root"><p>애플리케이션을 불러오는 중이다.</p></div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>
```

```tsx
// main.tsx — bundler 설정과 CSS import는 생략한 최소 entry다.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");

if (!container) {
  throw new Error("#root가 필요하다.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`createRoot`의 첫 `render`는 root 내부의 기존 HTML을 보존해 연결하지 않는다. React가 서버나 빌드에서 만든 HTML이 이미 있다면 [5b-2 SSR](./02-server-side-rendering.md)의 `hydrateRoot`가 필요하다. 위 loading 문구는 React가 관리할 실제 UI가 아니라 JavaScript 실패 때 남는 제한적인 fallback이다.

cold entry의 사건을 분리하면 다음과 같다.

```text
request
  → HTML shell 수신·파싱
  → main module 발견·다운로드
  → transitive module 다운로드·파싱·평가
  → createRoot와 첫 client render·commit
  → Effect 또는 client data layer가 data request 시작
  → data 응답
  → content render·commit
  → 첫 상호작용 처리
```

데이터 요청을 mount 후 Effect에서 시작하면 HTML → JavaScript → render → Effect → data라는 종속 사슬이 생긴다. 서버 응답 시간이 짧아도 요청 시작 자체가 늦으므로 콘텐츠 표시가 늦다. route loader나 module과 data의 병렬 preload는 이 사슬을 줄일 수 있지만, 어떤 URL을 언제 미리 읽을지라는 새 정책을 만든다.

### 전달물과 실행 위치를 분리한다

| 산출물 | 보통 생성되는 곳 | 처음 하는 일 | 관찰 증거 |
|---|---|---|---|
| HTML shell | build/static host | root와 resource URL 제공 | View Source, document response |
| JavaScript module graph | build → browser | UI·router·data code 평가 | build manifest, Network, Performance |
| API JSON | request server | 서버 상태 전달 | fetch initiator, response timing |
| 화면 DOM | browser | React render/commit 결과 | Elements, React Profiler |
| client query cache | browser memory/storage | 세션 중 data 재사용 | cache Devtools, request count |

HTML shell을 CDN에 오래 캐시하는 것과 API 응답이나 client query를 캐시하는 것은 다른 계약이다. query cache의 `staleTime`은 다른 사용자의 HTML을 공유하는 CDN 정책이 아니고, 전역 상태에 복사한 data는 서버 결과 캐시가 아니다.

### cold navigation과 warm navigation은 다른 제품 경험이다

이미 실행 중인 SPA에서 링크를 누르면 entry와 공통 layout code가 메모리에 있고 일부 data도 cache에 있을 수 있다.

```text
warm client navigation
  → click
  → route match
  → 필요하면 route chunk와 data를 병렬 요청
  → client render·commit
  → history 갱신
```

따라서 warm navigation은 full document navigation보다 빠를 수 있다. 하지만 다음 조건에서는 다시 cold cost에 가깝다.

- 검색·메신저 링크로 deep URL에 직접 진입한다.
- 배포 뒤 hashed asset이 바뀌어 browser cache가 비어 있다.
- mobile OS가 tab을 종료해 memory cache와 application state가 사라졌다.
- 권한 변경 때문에 query cache를 비우고 data를 다시 읽어야 한다.

“SPA라서 빠르다”는 말은 진입 유형, cache 상태, route chunk 상태를 기록하지 않으면 검증할 수 없다.

### JavaScript 비용은 transfer size로 끝나지 않는다

압축된 100KB라는 숫자는 다운로드 비용만 일부 설명한다. 브라우저는 module을 parse·compile·evaluate하고 React가 component tree를 계산한 뒤 DOM을 commit한다. 동일 bytes도 저사양 CPU, 많은 module, 초기화 side effect에 따라 main-thread 점유가 달라진다.

비용 경로를 metric보다 먼저 연결한다.

```text
큰 entry graph
  ├─ 다운로드 지연 → 콘텐츠 발견 지연 → FCP/LCP 후보 지연
  ├─ parse/evaluate long task → 입력 처리 지연
  └─ mount 뒤 data fetch → 추가 waterfall → 실제 콘텐츠 지연

크기가 정해지지 않은 skeleton
  └─ data 도착 뒤 geometry 변경 → layout shift
```

FCP·LCP·INP·CLS의 정밀 계측은 [8-3 웹 성능](../phase-8/03-web-performance.md)에서 다룬다. 이 문서에서는 Network initiator와 Performance의 script task, React Profiler commit을 같은 시간축에 놓는 데 집중한다.

### code splitting과 preload는 비용을 삭제하지 않고 이동시킨다

route-level dynamic import는 첫 entry에서 사용하지 않는 code를 뺀다.

```tsx
import { lazy, Suspense } from "react";

const ReportsRoute = lazy(() => import("./routes/ReportsRoute"));

export function ReportsPage() {
  return (
    <Suspense fallback={<p>보고서 화면을 불러오는 중이다.</p>}>
      <ReportsRoute />
    </Suspense>
  );
}
```

그 대가로 사용자가 route에 들어갈 때 code request가 발생한다. code가 로드된 뒤 data를 요청하면 새 waterfall이 된다. hover·focus나 router intent에 맞춰 code/data를 미리 읽으면 first-use latency를 줄일 수 있지만 다음 비용이 생긴다.

- 사용하지 않을 bytes와 data를 경쟁 자원보다 먼저 받는다.
- 인증/권한별 cache key를 잘못 잡으면 data가 섞인다.
- 많은 `<link rel="modulepreload">`는 image·font 같은 더 중요한 자원을 밀어낼 수 있다.
- service worker app shell은 offline 복원력을 높이지만 구버전 asset과 새 HTML의 호환성·update 정책을 소유해야 한다.

최적화 전후에는 entry/route chunk, data request 시작 시점, 첫 route interaction을 함께 비교한다.

### HTML이 비었다는 문제는 crawler 하나로 축소되지 않는다

일부 crawler가 JavaScript를 실행하더라도 다음 비용은 남는다.

- JavaScript 실행을 기다리지 않는 link preview·bot은 핵심 내용을 보지 못한다.
- crawler의 별도 rendering queue 때문에 색인 반영이 늦을 수 있다.
- 사용자도 JavaScript 실패·차단·저사양 CPU에서 같은 빈 shell을 겪는다.
- title·description만 server에서 주입해도 본문 접근성과 초기 표시 문제는 해결되지 않는다.

검색되지 않는 인증 화면에는 이 문제가 중요하지 않을 수 있다. 공개 문서·상품·채용 공고처럼 URL 자체가 배포 단위인 콘텐츠에는 [정적 렌더링](./03-static-rendering.md)이나 SSR이 더 직접적인 해법이다.

## 실무 관점

### CSR이 합리적인 조건과 무너지는 조건

| CSR이 비용을 회수하기 쉬운 조건 | 다른 전략을 검토할 신호 |
|---|---|
| 인증 뒤 장시간 세션 | 공개 deep link가 주 유입 경로다 |
| 편집기·canvas·내부 도구처럼 상호작용 밀도가 높다 | 읽기만 하는 짧은 세션이 많다 |
| 정적 hosting과 기존 API가 강한 제약이다 | 핵심 본문이 JS 없이 필요하다 |
| route/data cache로 반복 전환을 재사용한다 | 저사양 기기에서 entry evaluation이 긴 작업이다 |
| offline app shell이 실제 요구다 | 내용 변경과 shell/asset 버전 불일치가 치명적이다 |

페이지 전체를 CSR로 고정할 필요는 없다. 정적으로 생성한 본문에 client-only 편집기나 chart를 붙이거나, SSR shell 안에서 특정 dashboard route만 client-heavy하게 운영할 수 있다.

### loading UI는 waterfall을 숨기는 장식이 아니다

skeleton은 예상 콘텐츠의 크기를 예약하고 현재 상태를 전달해야 한다. 하지만 skeleton을 넣었다고 data request가 빨리 시작되지는 않는다. 다음 순서로 원인을 줄인다.

1. data가 정말 client에서만 결정되는지 확인한다.
2. route match 시점에 code와 data를 병렬로 시작한다.
3. cache freshness와 navigation 취소를 정의한다.
4. 그 뒤 남은 지연에 안정된 크기의 loading UI를 둔다.

### 관찰 실험

production build에서 같은 상품 상세 route를 사용한다.

1. DevTools에서 cache를 비우고 Network/Performance recording을 시작한다.
2. document HTML에서 상품명·가격이 존재하는지 확인한다.
3. entry chunk를 2초 지연하고 첫 의미 있는 콘텐츠와 data fetch initiator를 기록한다.
4. JavaScript를 비활성화해 남는 읽기·링크·form 계약을 확인한다.
5. 앱을 복구한 뒤 목록 → 상세로 client navigation하고 entry, route chunk, data request를 다시 기록한다.
6. CPU throttling 조건과 build commit을 고정해 cold/warm 결과를 최소 세 번 비교한다.

예상 관찰은 cold entry에서 JavaScript 평가 뒤 data request가 시작되고, warm navigation에서는 이미 받은 shell/공통 code와 query cache가 일부 단계를 생략한다는 것이다. 실제 결과가 다르면 router preload나 browser cache가 개입했는지 증거로 설명한다.

### 선택 체크리스트

- 주요 유입이 cold deep link인가, 이미 열린 앱의 warm navigation인가?
- JavaScript 전에도 필요한 핵심 HTML·link·form이 있는가?
- entry와 대표 route의 compressed bytes뿐 아니라 parse/evaluate task를 측정했는가?
- data request가 Effect 뒤에 직렬화되어 있지 않은가?
- browser HTTP cache, service worker, query cache, application state의 owner와 invalidation이 구분되는가?
- preload가 실제 다음 동작 확률에 비해 네트워크를 과소비하지 않는가?
- static/SSR shell과 client widget을 조합하면 더 단순해지는 영역이 있는가?
- JavaScript 실패·offline·구버전 asset에서 사용자가 보는 상태를 정의했는가?

## 정리

- CSR은 최초 HTML·data 결합·React 계산을 브라우저에 두며, cold entry는 JavaScript와 종종 client data waterfall을 전제로 한다.
- warm SPA navigation은 이미 로드된 code와 cache를 재사용할 수 있지만 direct navigation의 비용을 대신 설명하지 않는다.
- bundle 비용은 transfer뿐 아니라 parse·evaluate·render·data request 시작 지연을 포함한다.
- code splitting, preload, service worker는 비용을 다른 시점으로 옮기므로 route latency, 자원 경쟁, invalidation을 함께 측정한다.
- 인증된 장시간 상호작용 앱에서는 CSR이 최종 선택일 수 있고, 공개·짧은 읽기 경험에는 static/SSR 조합이 더 강할 수 있다.

## 확인 문제

**Q1.** production에서 목록 → 상세 이동은 빠른데 메신저의 상세 링크로 진입하면 상품명이 늦게 보인다. 같은 route인데 왜 결과가 다른가?

<details>
<summary>정답과 해설</summary>

목록에서 이동할 때는 entry와 공통 module이 이미 평가되었고 router가 route code/data를 미리 읽었거나 query cache를 재사용했을 수 있다. direct navigation은 HTML shell부터 시작해 module graph와 data를 다시 연결한다. 두 결과를 합치지 말고 cache cold/warm, route chunk, fetch initiator를 분리해 기록해야 한다.
</details>

**Q2.** entry bundle을 여러 route chunk로 나눴더니 초기 bytes는 줄었지만 첫 보고서 이동은 더 느려졌다. 실패가 아니라면 어떤 비용 이동이 일어난 것인가?

<details>
<summary>정답과 해설</summary>

초기 전송·평가 비용을 보고서의 first-use 시점으로 옮겼다. 보고서 code 뒤에 data fetch가 시작되면 waterfall도 추가된다. 보고서 진입 확률과 자원 경쟁을 고려해 intent 기반 code/data preload를 검토하고, initial task와 first-route interaction을 함께 비교한다.
</details>

**Q3.** 검색 노출이 필요 없는 사내 편집기에 SSR을 추가해야 CSR보다 현대적인가?

<details>
<summary>정답과 해설</summary>

그렇지 않다. 정적 hosting, 긴 세션, 높은 상호작용 밀도, 기존 API라는 조건에서는 CSR이 더 단순할 수 있다. SSR은 요청 server, snapshot 재현, hydration과 capacity 비용을 추가한다. 초기 진입·저사양 기기 문제가 실제 증거로 나타날 때 static shell 확대, code/data preload, SSR을 같은 요구 축으로 비교한다.
</details>

## 참고 자료

- [React — `createRoot`](https://react.dev/reference/react-dom/client/createRoot) — 빈 DOM root의 client render와 server HTML에는 `hydrateRoot`를 사용해야 하는 경계를 확인한다. (2026-07-11 확인)
- [MDN — JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — module graph 로딩과 `modulepreload` 연결을 확인한다. (2026-07-11 확인)
- [MDN — `rel="modulepreload"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload) — module을 미리 fetch·parse하는 의미와 과도한 preload의 자원 경쟁을 확인한다. (2026-07-11 확인)
- [React — `lazy`](https://react.dev/reference/react/lazy) — component code를 첫 render까지 미루고 Suspense와 연결하는 공식 API를 확인한다. (2026-07-11 확인)
- [Patterns.dev — Client-side Rendering](https://www.patterns.dev/react/client-side-rendering/) — CSR 문제 지형과 초기/후속 navigation 비교를 위한 2차 자료다. (2026-07-11 확인)

