# 5b-6. Streaming Server-Side Rendering

> 한 줄 요약: streaming SSR은 가장 느린 data가 전체 HTML을 막는 tail latency를 Suspense 영역으로 격리하지만, response가 commit된 뒤에는 status를 되돌릴 수 없으므로 오류·timeout·proxy 전달 계약도 영역화해야 한다.

이 문서는 2026년 7월 11일에 확인한 React 19 계열의 Node `renderToPipeableStream`과 Web `renderToReadableStream` 안정 API를 기준으로 한다. RSC payload stream과 HTML stream은 다른 산출물이며 [5b-7 RSC](./07-react-server-components.md)에서 구분한다.

## 학습 목표

- buffered SSR의 tail latency와 shell-first streaming이 바꾸는 요청 타임라인을 설명할 수 있다.
- Suspense boundary가 fallback·reveal·오류 격리 단위가 되는 조건을 판단할 수 있다.
- `onShellReady`, `onAllReady`, `onShellError`, `abort`의 response 책임을 설계할 수 있다.
- shell 전후 오류, timeout, client disconnect, proxy buffering을 서로 다른 실패로 진단할 수 있다.
- `curl --no-buffer`, browser Network, server marker로 실제 chunk 도착을 검증할 수 있다.

## 배경: 왜 이것이 존재하는가

상품 본문은 80ms, 추천은 300ms, 리뷰는 2초 걸린다고 하자. buffered SSR이 모든 data와 HTML을 준비한 뒤 response를 보내면 사용자는 이미 준비된 header와 본문도 2초 동안 받지 못한다.

```text
buffered SSR
data:   body(80ms) ─ recommendations(300ms) ─ reviews(2000ms)
HTML:   [------------------------------------- complete]
wire:                                          first byte
```

streaming SSR은 빠른 shell과 Suspense fallback을 먼저 보내고, 늦은 영역이 준비되는 순서에 따라 추가 HTML을 보낸다.

```text
streaming SSR
wire:   shell+fallback ─ recommendations chunk ─ reviews chunk ─ end
paint:  header/body     ─ recommendations reveal ─ reviews reveal
```

가장 느린 작업이 사라진 것은 아니다. 그 지연이 다른 영역의 first byte와 표시를 막지 않게 되었다. server work, bytes, client script, hydration은 여전히 비용이며 경우에 따라 늘 수 있다.

## 핵심 개념

### shell과 boundary가 전달 단위를 만든다

React에서 shell은 root document와 가장 바깥 Suspense fallback까지 포함해 초기 표시를 구성하는 부분이다.

```tsx
import { Suspense } from "react";

export function ProductDocument() {
  return (
    <html lang="ko">
      <head>
        <title>상품 상세</title>
      </head>
      <body>
        <Header />
        <ProductSummary />
        <Suspense fallback={<ReviewsSkeleton />}>
          <Reviews />
        </Suspense>
      </body>
    </html>
  );
}
```

`Reviews`가 Suspense-enabled data에서 suspend하면 React는 `ReviewsSkeleton`을 shell에 넣고 나중에 실제 리뷰 HTML을 stream할 수 있다. Effect 안의 fetch는 server render 중 suspend하지 않으므로 이 동작을 만들지 않는다. 독립 React app에서 임의 data source를 Suspense에 연결하는 API는 안정된 공개 계약이 아니므로 framework의 지원 data source 또는 `use` 가능한 Promise를 사용한다.

Suspense가 요청을 자동 병렬화하지도 않는다. 부모가 data A를 `await`한 뒤 child가 data B를 시작하면 boundary가 있어도 B는 늦게 시작한다.

```text
나쁜 시작 순서: await product → render child → reviews request 시작
병렬 시작:       product promise + reviews promise 시작 → 각 boundary에서 read
```

reveal 단위와 fetch 시작 순서는 별도로 설계하고 server trace로 확인한다.

### Node stream은 response commit 시점을 application에 준다

다음은 Node HTTP response wiring의 핵심 구조다. `response` type과 timeout 정책은 사용하는 server framework에 맞춘다.

```tsx
import type { IncomingMessage, ServerResponse } from "node:http";
import { renderToPipeableStream } from "react-dom/server";
import { ProductDocument } from "./ProductDocument";

export function handleProductRequest(
  _request: IncomingMessage,
  response: ServerResponse,
) {
  let didError = false;

  const { pipe, abort } = renderToPipeableStream(<ProductDocument />, {
    bootstrapModules: ["/assets/client.js"],
    onShellReady() {
      response.statusCode = didError ? 500 : 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      pipe(response);
    },
    onShellError(error) {
      response.statusCode = 500;
      response.end("<!doctype html><h1>페이지를 표시할 수 없다.</h1>");
      logServerError(error, { phase: "shell" });
    },
    onError(error) {
      didError = true;
      logServerError(error, { phase: "render" });
    },
  });

  const timeout = setTimeout(() => abort(), 10_000);
  response.on("close", () => {
    clearTimeout(timeout);
    abort();
  });
}
```

실제 애플리케이션에서는 사용하는 server framework의 request/response adapter와 timeout 정책에 맞춘다. 중요한 계약은 다음이다.

- `onShellReady`: shell이 준비되어 status/header를 정하고 `pipe`할 수 있다.
- `onShellError`: 아직 bytes를 보내지 않았으므로 별도 error document와 status가 가능하다.
- `onError`: recoverable boundary 오류까지 여러 번 호출될 수 있어 logging과 `didError` 판정이 필요하다.
- `abort`: 무한 대기 대신 남은 boundary를 client rendering fallback으로 넘기거나 stream을 끝내는 정책의 일부다.

`onAllReady`에서 `pipe`하면 모든 content가 준비된 뒤 전송하므로 crawler/static consumer에는 유용하지만 사람 대상 progressive streaming 이점은 사라진다.

Web Streams 환경에서는 `renderToReadableStream`을 사용한다. Node도 Web API를 호환하지만 React 공식 문서는 성능상 전용 Node API를 권장한다.

### 첫 byte 뒤에는 HTTP status와 header를 되돌릴 수 없다

오류를 시점별로 나눈다.

```text
shell 전 fatal error
  → 아직 response 미전송
  → 500/redirect/not-found + error document 가능

shell 전 recoverable boundary error
  → shell status를 500으로 정할지 route 정책 필요

shell flush 후 boundary error
  → 이미 200과 header가 전송됨
  → Error Boundary/fallback + inline recovery instruction + log

client bootstrap 실패
  → HTML은 보이지만 reveal/hydration/interaction 일부 실패 가능
```

HTTP 200은 stream의 모든 영역이 성공했다는 뜻이 아니다. shell 후 오류는 route-level status보다 boundary UI, error ID, server log, client telemetry로 표현한다. 반대로 auth/redirect/not-found가 route 전체 의미를 바꾸면 shell을 보내기 전에 판정하는 편이 안전하다.

### timeout은 “무엇을 언제 포기하는가”다

하나의 global timeout만 두면 느린 리뷰 때문에 전체 connection을 끊을 수 있다. 정책을 계층화한다.

- request 전체 deadline: connection/resource 상한
- data source timeout: 느린 dependency를 명시적 error로 전환
- boundary fallback: 나머지 page를 유지하며 retry 경로 제공
- abort 후 client rendering: 필요한 code/data cost와 보안 조건 확인

abort는 실행된 DB query나 downstream fetch를 자동 취소하지 않을 수 있다. `AbortSignal`을 data layer까지 전달하고 client disconnect 뒤 불필요한 work가 남는지 trace로 확인한다.

### browser와 중간 계층이 chunk의 실제 도착을 바꾼다

server가 `write`한 단위와 사용자가 보는 단위는 같지 않다.

```text
React chunk
  → Node buffering/backpressure
  → compression buffer
  → reverse proxy/CDN coalescing
  → network packet
  → browser incremental parser
  → CSS/layout/paint
```

작은 chunk는 compression/proxy가 모아 보낼 수 있다. CDN이 전체 response를 buffer하면 local origin에서는 stream되지만 production에서는 한 번에 도착한다. browser도 아직 닫히지 않은 markup이나 blocking stylesheet 때문에 즉시 paint하지 않을 수 있다.

따라서 “server log상 100ms에 pipe했다”를 사용자 shell 표시 증거로 쓰지 않는다. origin 직접 요청과 proxy 경유 요청을 `curl --no-buffer`·Network timing으로 비교한다. hosting이 chunked streaming을 지원하는지도 공식 문서로 확인한다.

### streaming HTML은 hydration과 다른 lane이다

```text
HTML lane:      shell ─ boundary A HTML ─ boundary B HTML
JS lane:        bootstrap ─ A code ─ B code
hydration lane: shell hydrate ─ B prioritized ─ A hydrate
input lane:     nav click ─ review click ─ handled/replayed
```

HTML A가 먼저 왔다고 A가 먼저 interactive하다는 뜻이 아니다. code B가 먼저 준비되거나 사용자가 B를 누르면 hydration 순서가 달라질 수 있다. 이 교차가 [5b-8 Selective Hydration](./08-selective-hydration.md)의 주제다.

RSC framework에서는 HTML stream과 별도로 RSC payload가 같은 navigation에서 전달될 수 있다. DevTools에서 `document`, RSC response, JS chunk를 resource type·content-type으로 구분한다.

### CSP와 inline recovery script를 함께 설계한다

React는 늦게 준비된 content를 fallback 자리에 넣기 위한 inline script를 stream에 포함할 수 있다. 엄격한 Content Security Policy(CSP)를 사용하면 server rendering API의 `nonce` option과 response header가 일치해야 한다. static nonce 재사용은 보안 경계를 무너뜨린다.

nonce, bootstrap URL, asset integrity는 framework/platform integration의 책임이다. CSP를 끄는 것을 streaming 성공 조건으로 두지 않는다. 상세한 XSS/CSP 모델은 [8-4 웹 보안](../phase-8/04-web-security.md)에서 다룬다.

## 실무 관점

### boundary는 사용자 단위와 실패 단위로 둔다

좋은 후보는 다음 성격을 가진다.

- shell의 의미를 막지 않는 독립 data dependency다.
- 고유한 loading/error UI를 설명할 수 있다.
- 늦게 reveal되어도 layout과 reading order가 안정적이다.
- 별도 code/data/hydration priority가 실제 사용자 가치와 맞는다.

heading 한 줄마다 boundary를 만들면 fallback churn, inline instruction, server bookkeeping, request/chunk가 늘어난다. page 전체 하나만 두면 가장 느린 영역이 다시 많은 UI를 막는다. 큰 boundary와 여러 작은 boundary를 같은 fixture에서 측정한다.

### crawler와 비브라우저 소비자는 complete HTML이 필요할 수 있다

사람 browser에는 shell-first가 유리할 수 있지만 crawler, email generator, static snapshot test는 모든 content가 준비된 결과를 원할 수 있다. user-agent만으로 무조건 분기하기보다 소비자 계약을 명시하고 `onAllReady` 또는 static API를 사용한다. streaming 중 실행되는 inline replacement script를 소비하지 못하는 client도 고려한다.

### 관찰 실험

shell 50ms, recommendation 400ms, reviews manual gate를 둔 fixture를 만든다.

1. buffered variant는 `onAllReady`, streaming variant는 `onShellReady`에서 pipe한다.
2. `curl --no-buffer -D -`로 origin의 header·shell·boundary text 도착 시각을 기록한다.
3. browser Network/Performance에서 first byte, fallback paint, boundary insert를 marker와 연결한다.
4. shell 전 throw, reviews boundary throw, 1초 timeout, client connection close를 각각 재현한다.
5. status, response body, server error/abort log, 다른 영역의 interaction 가능 여부를 표로 남긴다.
6. reverse proxy가 있다면 origin 직접 결과와 비교한다. 없다면 proxy buffering은 검증하지 못했다고 명시한다.
7. 큰 단일 boundary와 두 개 boundary의 chunk 수, fallback 변화, reveal, 오류 격리를 비교한다.

성능 수치는 production build, compression, network/CPU, cache 조건, 반복 범위를 함께 기록한다. local chunk 간격을 모든 CDN에 일반화하지 않는다.

### 선택 체크리스트

- shell에 반드시 포함되어야 하는 navigation·heading·status는 무엇인가?
- 느린 data request를 parent await 전에 병렬로 시작했는가?
- 각 Suspense boundary가 독립 loading/error 의미를 갖는가?
- shell 전 auth/redirect/not-found를 결정할 수 있는가?
- shell 후 오류를 status 대신 어떤 UI·log·error ID로 표현하는가?
- request/data/boundary timeout과 abort signal 전파를 정의했는가?
- proxy/CDN/compression이 chunk를 buffer하지 않는지 실제 경로에서 확인했는가?
- CSP nonce와 streamed inline instruction이 호환되는가?
- HTML 도착과 JavaScript/hydration/입력 처리를 별도로 측정했는가?

## 정리

- buffered SSR은 가장 느린 dependency가 전체 first byte를 막고, streaming SSR은 shell과 boundary 결과를 준비된 순서로 전달한다.
- Suspense boundary는 reveal·loading·오류 단위이지 data request를 자동 병렬화하는 장치가 아니다.
- `onShellReady`는 response commit 시점이며 그 뒤에는 status/header를 바꿀 수 없어 오류를 영역 UI와 log로 표현한다.
- 실제 chunk 도착은 backpressure, compression, proxy/CDN buffering, browser parsing의 영향을 받는다.
- HTML stream, client code, hydration, RSC payload는 별도 lane으로 관찰해야 한다.

## 확인 문제

**Q1.** Suspense boundary를 추가했지만 first byte가 여전히 느린 리뷰 API 뒤에 온다. 가능한 원인은 무엇인가?

<details>
<summary>정답과 해설</summary>

서버가 `onAllReady`까지 기다리거나, shell 바깥 부모가 리뷰 data를 먼저 `await`하거나, data source가 Suspense와 연결되지 않았거나, proxy가 response를 buffer할 수 있다. request 시작 log, React callback, origin `curl --no-buffer`, proxy 경유 결과를 순서대로 비교한다.
</details>

**Q2.** shell을 200으로 보낸 뒤 리뷰 렌더가 실패했다. response status를 500으로 바꾸려는 처리가 왜 동작하지 않는가?

<details>
<summary>정답과 해설</summary>

첫 bytes와 header가 전송되면 HTTP response가 commit되어 status를 되돌릴 수 없다. 리뷰 Error Boundary/fallback에 오류를 표시하고 error ID를 server log와 연결한다. route 전체 의미를 바꾸는 오류는 가능한 한 shell 전에 판정한다.
</details>

**Q3.** origin에서는 100ms마다 chunk가 보이지만 production browser에서는 한 번에 나타난다. React boundary를 더 쪼개기 전에 무엇을 확인해야 하는가?

<details>
<summary>정답과 해설</summary>

compression buffer, reverse proxy/CDN response buffering, hosting streaming 지원, browser parser·CSS 조건을 확인한다. origin과 실제 public path의 `curl --no-buffer`와 Network timing을 비교해야 한다. 전달 계층이 모아 보내면 React boundary 수를 늘려도 사용자는 이득을 보지 못한다.
</details>

## 참고 자료

- [React — `renderToPipeableStream`](https://react.dev/reference/react-dom/server/renderToPipeableStream) — Node stream의 shell/all-ready, 오류, status, crawler, abort 계약을 확인한다. (2026-07-11 확인)
- [React — `renderToReadableStream`](https://react.dev/reference/react-dom/server/renderToReadableStream) — Web Streams 환경의 streaming SSR API를 확인한다. (2026-07-11 확인)
- [React — `<Suspense>`](https://react.dev/reference/react/Suspense) — fallback과 server streaming/selective hydration 통합 범위를 확인한다. (2026-07-11 확인)
- [WHATWG Streams Standard](https://streams.spec.whatwg.org/) — backpressure와 readable/writable stream의 표준 모델을 확인한다. (2026-07-11 확인)
- [Patterns.dev — Streaming SSR](https://www.patterns.dev/react/streaming-ssr/) — buffered/streaming 문제 지형을 위한 2차 자료다. (2026-07-11 확인)
