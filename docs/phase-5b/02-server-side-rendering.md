# 5b-2. Server-side Rendering

> 한 줄 요약: SSR은 요청 시점의 입력으로 의미 있는 HTML을 먼저 만들지만, 그 결과를 클라이언트가 동일하게 재현해 연결하는 비용과 계약까지 포함한다.

이 문서는 2026년 7월 11일에 확인한 React 19 계열의 `react-dom/server`와 `hydrateRoot` 안정 API를 기준으로 한다. shell과 chunk의 상세 오류 처리는 [5b-6 Streaming SSR](./06-streaming-server-side-rendering.md)로 넘긴다.

## 학습 목표

- request input부터 server render, HTML 표시, hydration, 첫 처리된 입력까지의 사건을 구분할 수 있다.
- SSR이 초기 콘텐츠와 개인화를 얻는 대신 TTFB·server capacity·client 재실행 비용을 만드는 이유를 설명할 수 있다.
- server HTML과 client 첫 render의 동일성 계약을 세우고 hydration mismatch 원인을 진단할 수 있다.
- request memoization, rendered response cache, CDN cache를 구분해 개인화 누출을 막을 수 있다.
- SSR·SSG·RSC의 input, output, 실행 시점을 비교해 적절한 조합을 선택할 수 있다.

## 배경: 왜 이것이 존재하는가

공개 상품 상세가 CSR로만 구성되면 browser가 JavaScript를 실행하고 data까지 받은 뒤에야 상품명을 그린다. 서버는 이미 상품 data와 사용자 cookie를 받을 수 있는데도 browser가 다시 조립할 때까지 기다린다. SSR(Server-side Rendering)은 이 계산을 요청 서버로 당겨 첫 document response에 의미 있는 HTML을 넣는다.

SSR이 필요한 대표 상황은 다음과 같다.

- URL마다 검색·link preview에 필요한 본문과 metadata가 있다.
- cookie·header·session에 따라 요청별 첫 화면이 달라진다.
- 느린 client device에서 핵심 콘텐츠를 JavaScript 평가보다 먼저 보여 주고 싶다.

그러나 요청 서버가 data를 기다리고 React를 실행해야 하므로 비용은 사라지지 않는다. 브라우저에서 하던 일부 일을 TTFB와 server capacity로 옮긴 것이다. 상호작용까지 필요하면 브라우저는 같은 component tree의 code를 받아 `hydrateRoot`로 기존 HTML에 연결해야 한다.

## 핵심 개념

### SSR 파이프라인에는 표시와 활성화가 따로 있다

```text
request(URL, cookie, header)
  → session/권한 확인
  → request data 읽기
  → React server render
  → first byte / HTML response
  → HTML parse and paint
  → client JavaScript download / parse / execute
  → hydrateRoot가 같은 tree를 계산·연결
  → hydration completed
  → first handled interaction
```

HTML이 paint된 시점과 React event handler가 준비된 시점 사이를 hydration gap이라 부를 수 있다. 이 구간에서도 `<a href>` 이동이나 서버로 제출되는 `<form>`은 HTML 기본 동작으로 작동할 수 있다. 반면 client state만 바꾸는 button은 code와 hydration이 끝나야 의도한 동작을 한다.

### 서버 결과는 클라이언트의 초기 snapshot이다

framework가 일반적으로 plumbing을 소유하지만 최소 경계는 다음 두 조각으로 볼 수 있다.

```tsx
// server.tsx — response wiring과 안전한 snapshot 직렬화는 생략한 구조 예제다.
import { renderToPipeableStream } from "react-dom/server";
import { App } from "./App";

export function renderProduct(response: NodeJS.WritableStream, product: Product) {
  const snapshot = { product, renderedAt: product.updatedAt };

  const { pipe } = renderToPipeableStream(<App snapshot={snapshot} />, {
    bootstrapModules: ["/assets/client.js"],
    onAllReady() {
      pipe(response);
    },
    onError(error) {
      console.error(error);
    },
  });
}
```

```tsx
// client.tsx — framework가 안전하게 복원한 동일 snapshot을 사용한다.
import { hydrateRoot } from "react-dom/client";
import { App } from "./App";

declare global {
  interface Window {
    __INITIAL_SNAPSHOT__: Snapshot;
  }
}

hydrateRoot(document, <App snapshot={window.__INITIAL_SNAPSHOT__} />, {
  onRecoverableError(error, errorInfo) {
    reportHydrationError(error, errorInfo.componentStack);
  },
});
```

예제는 `onAllReady`까지 기다리는 buffered baseline이다. production에서는 framework의 XSS-safe serializer와 asset manifest를 사용해야 하며, 사용자 문자열을 `<script>`에 단순 `JSON.stringify`해 넣어서는 안 된다. `onShellReady`에서 먼저 pipe하는 streaming은 [5b-6](./06-streaming-server-side-rendering.md)에서 다룬다.

server와 client가 같은 `snapshot`으로 `App`을 처음 렌더해야 기존 DOM을 안정적으로 재사용할 수 있다. hydration은 서버 HTML이 대충 비슷하면 React가 검증·수정하는 범용 diff 단계가 아니다. React는 결과가 같다고 기대하며 mismatch를 bug로 취급해야 한다.

### hydration mismatch는 입력의 시간차에서 생긴다

대표 원인은 다음과 같다.

| 원인 | server와 client가 달라지는 방식 | 안전한 방향 |
|---|---|---|
| `Date.now()`·`new Date()` | 실행 시각이 다르다 | server snapshot을 직렬화해 재사용한다 |
| `Math.random()`·임의 ID | 호출마다 값이 다르다 | 안정된 data ID나 동일 seed를 사용한다 |
| locale/timezone | server 기본 locale과 사용자 환경이 다르다 | 표시 locale을 입력으로 고정한다 |
| `typeof window` 분기 | tree 구조 자체가 달라진다 | 동일 shell 뒤 Effect로 향상한다 |
| hydration 전 재요청 | server render 뒤 data가 변경된다 | 초기 snapshot을 먼저 hydrate하고 이후 갱신한다 |
| 잘못 중첩된 HTML | browser parser가 DOM을 교정한다 | 유효한 semantic HTML로 고친다 |

```tsx
// 나쁜 예: 실행 환경마다 첫 text가 달라질 수 있다.
function Clock() {
  return <time>{new Date().toLocaleString()}</time>;
}

// 같은 snapshot을 입력으로 사용한다.
function Clock({ isoTime }: { isoTime: string }) {
  return <time dateTime={isoTime}>{isoTime}</time>;
}
```

`suppressHydrationWarning`은 시간처럼 불가피하게 다른 단일 요소의 escape hatch이며 한 단계 깊이에만 적용된다. 구조 불일치나 여러 data 원본을 감추는 일반 해법이 아니다.

### SSR의 전달물과 비용은 두 런타임에 걸친다

| 단계 | server 비용 | browser 비용 | 대표 증거 |
|---|---|---|---|
| data access | DB/API latency, connection | 없음 | trace, `Server-Timing` |
| server render | CPU, memory, cold start | 없음 | server profile, TTFB |
| HTML delivery | bytes, cache policy | parse·style·paint | response/body, Performance |
| client code | build artifact 제공 | download·parse·evaluate | bundle report, long task |
| hydration | 없음 | component 재실행·listener 연결 | React Profiler, custom mark |

SSR은 server에서 component를 실행했으므로 client render가 사라진다는 뜻이 아니다. interactive tree는 client에서도 초기 계산이 필요하다. 서버 HTML을 빨리 보여도 큰 bundle과 긴 hydration task가 남으면 사용자는 보이는 button을 눌렀지만 반응을 기다린다.

### 요청별 렌더링과 캐시는 서로 다른 축이다

SSR 결과를 캐시할 수 있는지는 response가 누구에게 같은지에 달려 있다.

```text
request memoization
  └─ 한 render/request 안의 중복 data read를 합친다.

data cache
  └─ 요청을 넘어 원본 data 결과를 key와 freshness로 재사용한다.

rendered response cache
  └─ HTML/payload 결과를 route와 variant key로 재사용한다.

CDN/shared cache
  └─ 여러 사용자·지역에 HTTP response를 공유한다.
```

`/account`가 session cookie에 따라 달라지는데 URL만 cache key로 사용하면 다른 사용자의 HTML이 노출될 수 있다. `Vary: Cookie`는 cookie cardinality 때문에 shared cache 효율을 무너뜨리고 모든 cookie 조합을 안전하게 만든다는 뜻도 아니다. 인증·가격·권한 data는 기본적으로 private/dynamic 경계로 두고, 공통 shell과 분리할 수 있는지 검토한다.

반대로 모든 SSR response를 `no-store`로 두면 공개 상품 설명까지 매 요청 다시 계산한다. 페이지를 공통 cacheable 영역과 요청별 personalized 영역으로 나누는 조합이 필요하다.

### SSR·SSG·RSC는 서로 대체 이름이 아니다

| 개념 | 주 입력 | 주 출력 | 실행 시점 | client code와 관계 |
|---|---|---|---|---|
| SSR | request + React tree | HTML stream | 요청 시점 | interactive tree는 보통 hydration 필요 |
| SSG/static rendering | build data + routes | 배포할 HTML/payload | 요청 전 | 정적 HTML도 hydration될 수 있음 |
| RSC | server/client module graph + data | RSC payload | build 또는 request | Server Component code는 client graph에서 제외 가능 |

RSC 결과를 initial HTML로 만들기 위해 SSR을 함께 사용할 수 있고, build 때 RSC를 실행해 static artifact를 만들 수도 있다. “서버에서 React를 실행했다”는 공통점만으로 같은 패턴이라 부르면 캐시·output·hydration 비용을 판단할 수 없다.

## 실무 관점

### SSR의 이점이 실제로 성립하는 조건

- 핵심 HTML을 JavaScript 전에 표시하거나 외부 소비자가 읽어야 한다.
- request input에 따른 개인화가 첫 화면에 정말 필요하다.
- server가 data source와 가까워 client waterfall을 줄일 수 있다.
- p95 data/render latency와 server capacity를 운영할 수 있다.
- client code/hydration budget도 함께 줄이거나 감당할 수 있다.

첫 응답 data가 느리고 server가 먼데 모든 route를 매번 SSR하면 TTFB만 늘 수 있다. 변경이 드문 공통 페이지라면 [5b-3 Static Rendering](./03-static-rendering.md)이 더 단순하다. 대부분 정적이고 일부만 요청별이면 cache/streaming boundary를 조합한다.

### progressive enhancement는 hydration 실패의 복원 경로다

서버 HTML의 link는 실제 `href`를 가지고, 핵심 mutation form은 가능한 경우 server endpoint/action을 갖게 한다. client router와 optimistic UI는 그 위에 경험을 향상한다. canvas editor처럼 본질적으로 JavaScript가 필요한 기능까지 억지로 no-JS로 복제할 필요는 없다. 구매·검색·로그인처럼 핵심 경로가 보이지만 아무 일도 하지 않는 상태는 피한다.

### 오류는 shell 전후와 client 연결 단계로 나눈다

- data/권한 오류가 HTML 전이면 적절한 status와 error document를 보낼 수 있다.
- 일부 bytes를 flush한 뒤 오류가 나면 status를 되돌릴 수 없어 영역 fallback과 server log가 필요하다.
- HTML은 성공했지만 bootstrap script가 실패하면 읽기는 가능해도 client interaction은 활성화되지 않는다.
- hydration mismatch를 recover했더라도 사용자 input·focus를 잃을 수 있으므로 `onRecoverableError`를 관측한다.

두 번째 상황의 API와 timeout/abort는 [5b-6](./06-streaming-server-side-rendering.md)에서 확장한다.

### 관찰 실험

CSR과 동일한 상품 route에 고정 800ms data delay를 둔다.

1. production SSR을 cold/warm server 조건에서 각각 세 번 요청한다.
2. `curl` 또는 View Source로 상품명이 document HTML에 있는지 확인한다.
3. JavaScript를 비활성화해 본문, link, form의 실제 동작을 기록한다.
4. bootstrap module을 2초 지연하고 paint와 첫 button 처리 시점을 분리한다.
5. server는 UTC, client는 다른 locale로 렌더해 recoverable error를 관찰한다.
6. locale과 `renderedAt`을 snapshot으로 고정한 뒤 error가 사라지는지 확인한다.
7. `Server-Timing: data;dur=..., render;dur=...`과 browser timing을 같은 표에 둔다.

TTFB가 CSR보다 커져도 상품명이 먼저 보일 수 있다. 반대로 button 처리가 늦다면 SSR 실패라고 단정하기 전에 client bundle과 hydration task를 함께 본다.

### 선택 체크리스트

- 요청마다 달라져야 하는 입력은 URL, cookie, header, session 중 무엇인가?
- 핵심 HTML이 필요한 소비자는 사용자, crawler, link preview 중 누구인가?
- data latency와 server render가 TTFB budget 안에 들어오는가?
- server와 client 첫 render가 같은 snapshot·locale·asset map을 쓰는가?
- 사용자 data가 shared response/data cache에 들어가지 않는가?
- HTML 표시와 hydration 완료, 첫 처리된 입력을 각각 측정했는가?
- JavaScript 실패 때 핵심 link/form이 의미 있는 fallback을 갖는가?
- static generation, streaming, RSC로 비용을 더 좁은 영역에 둘 수 있는가?

## 정리

- SSR은 요청 입력과 data로 server에서 HTML을 만들고, 의미 있는 document를 JavaScript보다 먼저 전달할 수 있다.
- interactive React tree는 여전히 client code와 hydration을 요구하므로 표시와 활성화를 별도 사건으로 측정한다.
- hydration은 server/client의 동일한 첫 결과를 전제로 하며 시간·난수·locale·환경 분기·data 변경이 mismatch를 만든다.
- request memoization, data cache, rendered response cache, CDN cache는 key·freshness·공유 범위가 다르다.
- SSR은 SSG나 RSC의 다른 이름이 아니며 한 route 안에서 서로 조합할 수 있다.

## 확인 문제

**Q1.** SSR로 상품명이 빨리 보이지만 장바구니 button의 첫 click이 늦다. server data를 더 빠르게 만드는 것만으로 해결되지 않을 수 있는 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

상품명 paint 이후에도 client JavaScript 다운로드·평가와 hydration이 남아 있을 수 있다. server data 개선은 TTFB와 HTML 도착을 줄이지만 hydration gap을 직접 없애지 않는다. bootstrap/route bytes, script long task, hydration marker, 첫 click 처리 시점을 함께 측정하고 client boundary를 줄이거나 우선순위를 조정한다.
</details>

**Q2.** `/account` SSR response를 CDN에 URL 기준으로 캐시했더니 간헐적으로 다른 이름이 보였다. 어느 계약이 잘못되었는가?

<details>
<summary>정답과 해설</summary>

응답이 session별인데 shared cache key에는 그 변형이 반영되지 않았다. 인증 HTML을 private/dynamic으로 만들거나 공통 shell과 사용자 영역을 분리해야 한다. cookie 전체를 `Vary`에 넣는 것은 cache 폭발과 플랫폼 지원 문제를 만들 수 있으므로 data 소유권과 topology를 먼저 다시 설계한다.
</details>

**Q3.** server와 client 모두 같은 component source를 쓰는데도 hydration mismatch가 났다. “같은 코드”가 충분한 조건이 아닌 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

렌더 결과는 코드뿐 아니라 시각, locale, 난수, 환경 API, data version 같은 입력에 의존한다. server와 client 실행 시점이 다르면 같은 코드도 다른 tree/text를 만든다. 초기 snapshot과 표시 환경을 직렬화해 재사용하고, browser-only 향상은 동일 shell이 연결된 뒤 Effect로 수행한다.
</details>

## 참고 자료

- [React — Server React DOM APIs](https://react.dev/reference/react-dom/server) — Node/Web streaming API와 제한된 legacy string API의 현재 지형을 확인한다. (2026-07-11 확인)
- [React — `hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot) — 기존 server HTML을 연결하는 동일성 계약, recoverable error, mismatch troubleshooting을 확인한다. (2026-07-11 확인)
- [React — `renderToPipeableStream`](https://react.dev/reference/react-dom/server/renderToPipeableStream) — Node stream의 `onShellReady`, `onAllReady`, 오류·abort 계약을 확인한다. (2026-07-11 확인)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111) — shared cache의 key, freshness, validation과 stale response 조건을 확인한다. (2026-07-11 확인)
- [Patterns.dev — Server-side Rendering](https://www.patterns.dev/react/server-side-rendering/) — SSR 문제 지형과 비용 비교를 위한 2차 자료다. (2026-07-11 확인)
