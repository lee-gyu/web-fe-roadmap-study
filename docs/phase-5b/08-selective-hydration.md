# 5b-8. Selective Hydration

> 한 줄 요약: selective hydration은 streamed server HTML을 Suspense 단위로 연결하고 준비 상태와 사용자 입력에 따라 순서를 조정해, 먼저 도착한 UI와 먼저 상호작용해야 할 UI가 다를 수 있게 한다.

이 문서는 2026년 7월 11일에 확인한 React 19 계열의 `hydrateRoot`·Suspense와 React 18부터 제공된 streaming/selective hydration 공식 설계를 기준으로 한다. selective hydration은 application이 component마다 호출하는 별도 API가 아니라 React renderer가 Suspense boundary·code/data readiness·scheduler priority를 함께 사용해 만드는 동작이다.

## 학습 목표

- HTML, Client Component code, hydration, input 처리의 네 timeline을 별도로 그릴 수 있다.
- Suspense boundary가 streaming reveal과 독립 hydration 단위가 되는 방식을 설명할 수 있다.
- 아직 hydrate되지 않은 UI에 입력이 들어올 때 priority·event/focus/value 보장을 공식 계약과 실험으로 확인할 수 있다.
- 큰 boundary와 많은 작은 boundary의 blocking·fallback·chunk·오류 비용을 비교할 수 있다.
- progressive hydration, streaming SSR, RSC와 selective hydration의 포함·조합 관계를 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

전통적인 hydration은 server HTML 전체와 client code가 준비된 뒤 root를 한 번에 연결하는 것처럼 체감되기 쉽다. page가 크면 느린 code/data 영역이 이미 보이는 navigation의 활성화까지 늦추고, 긴 hydration task 중 사용자의 click이 기다린다.

React의 streaming SSR과 Suspense는 server가 shell과 영역별 HTML을 나눠 보낼 수 있게 했다. selective hydration은 browser에서도 그 boundary를 독립적으로 다룬다. code가 준비된 boundary를 먼저 hydrate할 수 있고, 사용자가 아직 hydrate되지 않은 boundary와 상호작용하면 그 작업의 priority를 높일 수 있다.

핵심은 network 도착 순서를 그대로 따르지 않는다는 점이다.

```text
HTML: navigation → reviews → cart
code: navigation → cart → reviews
input:                      cart click
hydration: navigation → cart → reviews
```

하지만 모든 click이 무조건 보존되고 즉시 처리된다고 약속하면 안 된다. event type, code readiness, native default action, framework integration에 따라 다르며 focus와 input value는 단순 event replay로 설명되지 않는다. production fixture에서 public UX contract를 검증한다.

## 핵심 개념

### `hydrateRoot` 한 번과 boundary별 내부 스케줄링을 구분한다

```tsx
// client.tsx
import { hydrateRoot } from "react-dom/client";
import { App } from "./App";

hydrateRoot(document, <App />, {
  onRecoverableError(error, errorInfo) {
    reportHydrationError(error, errorInfo.componentStack);
  },
});
```

application은 보통 root에 `hydrateRoot`를 호출한다. Suspense boundary마다 별도 `hydrateBoundary()`를 호출하지 않는다. server와 client의 같은 tree에 존재하는 Suspense boundary, lazy code와 data 준비 상태, React scheduler가 내부 hydration 순서를 결정한다.

progressive hydration의 island처럼 독립 root를 여러 개 만들 수도 있지만 그것은 framework architecture가 다른 것이다. selective hydration을 구현하려고 DOM selector마다 임의로 `hydrateRoot`를 반복 호출하지 않는다.

### 네 lane을 같은 marker vocabulary로 기록한다

```text
server/HTML lane
  shell_ready → shell_first_byte → reviews_chunk → cart_chunk

code lane
  bootstrap_loaded → reviews_code_loaded → cart_code_loaded

hydration lane
  root_started → nav_hydrated → cart_hydrated → reviews_hydrated

input lane
  cart_pointerdown → cart_click → cart_handler_started → UI_committed
```

다음 사건은 동의어가 아니다.

- `reviews_chunk`: HTML bytes가 browser에 도착했다.
- `reviews_code_loaded`: Client Component module이 평가 가능하다.
- `reviews_hydrated`: React가 server DOM과 client tree를 연결했다.
- `reviews_click_handled`: 실제 event handler가 실행됐다.

Network waterfall만으로 hydration 완료를 추정할 수 없고, DOM이 보인다고 handler가 준비된 것도 아니다. custom mark와 실제 UI state를 함께 사용한다.

### Suspense가 server와 client 양쪽의 독립 단위를 만든다

```tsx
import { lazy, Suspense } from "react";

const Reviews = lazy(() => import("./Reviews"));
const Cart = lazy(() => import("./Cart"));

export function ProductPage() {
  return (
    <main>
      <ProductSummary />
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews />
      </Suspense>
      <Suspense fallback={<CartSkeleton />}>
        <Cart />
      </Suspense>
    </main>
  );
}
```

server에서 Reviews data가 늦으면 fallback이 shell에 들어가고 실제 HTML은 뒤에 stream될 수 있다. client에서 Reviews code가 늦어도 Cart code가 준비되면 Cart boundary를 독립적으로 hydrate할 수 있다. 사용자가 Cart를 누르면 React는 그 boundary의 hydration을 더 긴급하게 처리할 수 있다.

`lazy`만 썼다고 data가 병렬로 시작되지는 않는다. server data와 client code delay를 각각 제어해야 어느 축이 boundary를 막는지 알 수 있다.

### visible-but-inactive 상태를 제품 상태로 다룬다

한 화면에 다음 상태가 동시에 존재할 수 있다.

```text
navigation: HTML complete, code ready, hydrated
reviews:    fallback visible, data pending
cart:       HTML complete, code loading, not hydrated
```

사용자는 React 내부 상태를 모르므로 UI가 오해를 만들지 않아야 한다.

- `<a href>`는 client router가 없어도 실제 navigation을 수행한다.
- `<form action>`은 가능한 경우 native submit 경로를 가진다.
- 아직 동작하지 않는 custom button을 enabled처럼 두고 click을 유실하지 않는다.
- fallback과 content의 geometry·heading 순서를 안정적으로 둔다.
- hydration이 사용자 입력값과 focus를 덮어쓰지 않는지 확인한다.

React가 supported event를 queue/replay하거나 interaction boundary의 hydration priority를 높일 수 있어도, browser의 모든 side effect를 되돌려 재생할 수 있는 것은 아니다. file picker, media playback, focus 이동, scroll, third-party native listener는 별도 검증이 필요하다.

### priority는 공개 UX이고 Fiber lane은 구현 세부다

application이 의존할 수 있는 것은 “사용자 interaction이 있는 영역이 덜 중요한 pending 영역보다 먼저 활성화될 수 있다”는 high-level behavior다. 내부 Fiber lane 번호, exact scheduling slice, event plugin 구현을 app contract로 사용하지 않는다.

관찰 결과가 React minor, browser, framework에 따라 바뀔 수 있으므로 다음을 문서화한다.

- React/framework production version과 feature flag
- 어떤 event를 언제 발생시켰는가
- boundary code/data가 그 시점에 준비됐는가
- handler가 한 번 실행됐는가, native default가 먼저 실행됐는가
- focus와 controlled/uncontrolled value가 유지됐는가

### boundary 크기는 blocking과 overhead를 교환한다

| 설계 | 얻는 것 | 비용 |
|---|---|---|
| 큰 boundary 하나 | fallback·chunk·상태가 단순 | 작은 핵심 control도 느린 영역과 함께 기다림 |
| 여러 의미 있는 boundary | reveal·hydration·오류 priority 분리 | fallback 변화, instruction, code chunk, coordination 증가 |
| 지나치게 작은 boundary | 세밀한 순서 가능 | network/server overhead, visual churn, 측정·추론 복잡도 |

경계는 component line 수가 아니라 사용자 task·data dependency·code chunk·error recovery가 함께 독립적인 곳에 둔다. 같은 form의 label과 submit button을 다른 boundary로 나누면 semantic/interaction 원자성이 깨질 수 있다.

### code와 data 도착 순서를 뒤집어 실험한다

다음 helper는 production 실험에서 lazy import를 manual gate 뒤에 두는 개념 예제다. 실제 fixture는 module top-level의 stable Promise를 사용하고 test controller만 resolve한다.

```ts
import { lazy, type ComponentType } from "react";

export function lazyAfter<T extends { default: ComponentType<unknown> }>(
  gate: Promise<void>,
  load: () => Promise<T>,
) {
  return lazy(async () => {
    await gate;
    return load();
  });
}
```

실험 조합은 최소 다음 네 가지다.

| case | Reviews | Cart | 사용자 입력 |
|---|---|---|---|
| A | HTML/code 빠름 | HTML/code 느림 | 없음 |
| B | HTML 빠름, code 느림 | HTML 늦음, code 빠름 | Cart click |
| C | data 늦음 | code 늦음 | Cart click |
| D | 둘 다 준비 | main thread busy | Cart click |

case B에서 network HTML 순서와 hydration 순서가 달라질 수 있다. case D는 bytes가 준비되어도 main-thread scheduling이 interaction latency에 영향을 준다는 점을 보여 준다.

### selective와 progressive hydration의 포함 관계

```text
progressive hydration (넓은 전략 계열)
  ├─ immediate root를 단계적으로 준비
  ├─ visibility/idle/interaction islands (framework trigger)
  └─ React selective hydration
       └─ hydrateRoot + Suspense + scheduler + readiness/priority
```

[5b-5](./05-progressive-hydration.md)의 trigger-based island는 application/framework가 **언제 activation을 시작할지** 정한다. selective hydration은 React가 이미 시작된 root 안에서 **어느 Suspense 영역을 먼저 연결할지** 조정한다. 둘을 조합하는 framework도 있지만 같은 용어는 아니다.

### streaming SSR과 selective hydration은 독립 축이다

streaming은 server 결과를 언제 wire에 보내는가의 문제이고, selective hydration은 browser에서 어느 영역을 언제 활성화하는가의 문제다.

- streaming 없이 완성 HTML을 받아도 code split boundary를 선택적으로 hydrate할 수 있다.
- HTML을 stream해도 client code가 하나의 큰 bundle이면 activation이 오래 막힐 수 있다.
- proxy가 stream을 buffer해도 browser에 도착한 뒤 hydration scheduling은 존재할 수 있다.

두 기능을 같은 “빠른 SSR” 옵션으로 묶지 않고 server marker와 browser marker를 따로 둔다.

### RSC는 hydration 대상을 줄이지만 Client Component에는 남는다

Server Component source는 browser에서 실행되지 않으므로 hydration 대상이 아니다. 그러나 그 tree 안에 합성된 Client Component는 code와 hydration이 필요하다.

```text
ProductPage (Server)             → no client component code
  ProductDescription (Server)    → no hydration
  ReviewsFilter (Client)         → JS + hydration
  AddToCart (Client)             → JS + hydration
```

RSC를 도입했다는 이유로 “hydration이 없다”고 말하지 않는다. build output에서 client module과 browser marker를 확인하고 어떤 leaf가 남았는지 기록한다.

## 실무 관점

### event replay를 universal guarantee로 만들지 않는다

React의 event system이 hydration 중 일부 event를 우선 처리·재생할 수 있지만 다음 상황은 별도 fallback이 필요하다.

- code chunk가 장시간 실패하거나 CSP가 막는다.
- native default action이 이미 navigation/submit을 시작한다.
- event가 React root 밖 third-party listener에서 처리된다.
- 사용자가 input 값을 바꿨는데 client initial state가 이를 덮는다.
- focus를 잃으면 keyboard 사용자가 현재 위치를 찾지 못한다.

핵심 구매·인증 task는 native HTML 경로 또는 명시적 준비 상태를 제공한다. replay는 resilience의 유일한 계층이 아니다.

### Phase 5b를 영역별 책임 지도로 종합한다

기본 네 전략과 전달·활성화 기법은 서로 다른 축이다.

| 선택 | 바꾸는 축 | 독립적으로 결정할 것 |
|---|---|---|
| CSR·SSR·SSG·ISR | HTML/data 계산 시점과 cache state | personalization, freshness, build/server 비용 |
| streaming SSR | server HTML 전달 시점 | shell, reveal, status·오류·proxy |
| RSC | component code 실행 환경과 payload | serializable props, client graph, server capacity |
| progressive hydration | activation 시작 trigger | visibility/idle/intent, first-use, 접근성 |
| selective hydration | 시작된 React root 안의 hydration 순서 | Suspense 크기, code/data readiness, 입력 priority |

상품 상세 page의 최종 책임 지도는 다음처럼 쓸 수 있다. 이것은 정답이 아니라 요구사항을 검증 가능한 owner로 바꾼 예시다.

| 영역 | rendering owner | data/cache owner | activation owner | 실패·신선도 계약 |
|---|---|---|---|---|
| 제목·설명 | build RSC + static HTML | content revision, tag invalidation | Server Component라 JS 없음 | 게시 후 10분 stale 허용 |
| 가격·재고 | request server | 권위 API, shared cache 금지 | 읽기만 하면 hydration 없음 | 구매 직전 다시 검증 |
| 리뷰 | streaming server boundary | 짧은 data cache | filter leaf를 selective hydrate | 오류가 본문을 막지 않음 |
| 로그인 인사 | private request/client slice | session owner | immediate | 공통 cache에 사용자 data 금지 |
| 장바구니 | Client Component | server mutation + client draft | 높은 priority로 hydrate | native/retry 경로, read-your-own-writes |

ADR에는 선택 이름보다 변경 조건을 남긴다.

```markdown
# ADR: 상품 상세 렌더링·활성화 전략

## Context and drivers
- 공개 본문은 JS 없이 읽혀야 한다.
- 가격은 구매 시점에 최신이어야 한다.
- 리뷰 장애가 본문을 막아서는 안 된다.

## Decision
- 영역별 rendering/data/cache/activation owner를 표로 기록한다.
- React core 기능과 framework/platform 기능을 구분한다.

## Evidence
- HTML/RSC/JS bytes, cache version, server marker, hydration/입력 marker를 기록한다.

## Revisit triggers
- build p95, server capacity, stale incident, client JS, first-use latency가 budget을 넘으면 재검토한다.

## Exit path
- client leaf 확대/축소, dynamic boundary 분리, cache bypass와 rollback 순서를 기록한다.
```

선택을 철회할 수 있어야 실험이 가능하다. 예를 들어 리뷰 streaming을 제거해도 route 전체 data API와 semantic HTML이 유지되도록 boundary를 두고, client-only chart를 server-rendered table로 되돌릴 fallback을 남긴다.

### 관찰 실험

두 Suspense boundary에 data gate와 lazy code gate를 독립적으로 둔다.

1. server에 `shell_ready`, `reviews_html`, `cart_html` timestamp를 남긴다.
2. browser에 code module evaluation marker와 각 component Effect marker를 둔다. Effect는 hydration 완료의 근사 관찰점이며 exact internal phase라고 부르지 않는다.
3. Cart code gate를 닫은 상태에서 server HTML을 먼저 보낸다.
4. 사용자가 Cart button을 click/focus/input한 뒤 code gate를 연다.
5. handler 실행 횟수, focus, input value, native default를 기록한다.
6. Reviews와 Cart의 delay를 뒤집어 hydration 순서가 도착 순서와 다른지 확인한다.
7. 큰 boundary 하나와 두 boundary를 비교해 shell 내용, chunk/request, fallback churn, first handled interaction, 오류 격리를 기록한다.
8. production build에서 같은 조건을 최소 세 번 실행한다.

React 내부 mark를 추측해 쓰기보다 application marker와 Performance trace를 사용한다. 짧은 lab click delay를 INP라고 부르지 않고 click-to-handler/long task 보조 지표로 기록한다. field metric 심화는 [8-3 웹 성능](../phase-8/03-web-performance.md)으로 넘긴다.

### 선택 체크리스트

- HTML, code, hydration, input marker를 별도 이름으로 기록했는가?
- Suspense boundary가 data·code·task·error 면에서 독립적인가?
- 사용자가 먼저 조작할 영역의 code가 너무 큰 shared chunk에 묶이지 않았는가?
- 아직 inactive인 control의 native fallback 또는 준비 상태가 있는가?
- click뿐 아니라 focus, keyboard, input value, default action을 검증했는가?
- event replay 범위를 framework/version의 공식 보장 이상으로 약속하지 않았는가?
- 큰/작은 boundary의 chunk·fallback·first-use·오류 비용을 함께 비교했는가?
- streaming, selective hydration, progressive trigger, RSC를 서로 다른 축으로 기록했는가?
- Client Component leaf가 실제로 줄었는지 bundle과 marker로 확인했는가?

## 정리

- selective hydration은 `hydrateRoot`·Suspense·code/data readiness·scheduler priority가 만드는 React 내장 동작이며 subtree별 공개 호출 API가 아니다.
- HTML, client code, hydration, input 처리는 서로 다른 순서로 진행될 수 있다.
- Suspense boundary는 독립 reveal/hydration 단위를 만들지만 과도하게 쪼개면 chunk·fallback·coordination 비용이 늘어난다.
- 사용자 입력은 hydration priority를 바꿀 수 있지만 모든 event·focus·value·native action을 보존한다고 일반화하지 않는다.
- progressive hydration은 상위 전략, streaming은 server 전달, RSC는 component 실행 경계이며 Client Component에는 hydration이 남는다.

## 확인 문제

**Q1.** 리뷰 HTML이 장바구니보다 먼저 도착했는데 장바구니가 먼저 interactive해졌다. 모순이 아닌 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

HTML 도착, client code 준비, hydration priority는 별도 lane이다. 장바구니 code가 먼저 준비되었거나 사용자의 click으로 priority가 높아져 reviews보다 먼저 hydrate될 수 있다. chunk timestamp, module evaluation, hydration/handler marker를 분리해 설명한다.
</details>

**Q2.** boundary를 button마다 나누자 첫 click은 빨라졌지만 fallback이 자주 깜박이고 request가 늘었다. 어떤 trade-off가 드러난 것인가?

<details>
<summary>정답과 해설</summary>

세밀한 hydration/reveal priority를 얻는 대신 code chunk, streamed instruction, fallback 상태, server/network coordination 비용이 증가했다. 사용자 task·data·error가 독립적인 의미 단위로 boundary를 합치고 first-use latency와 visual/network cost를 다시 비교한다.
</details>

**Q3.** RSC 기반 page이므로 hydration 측정이 필요 없다는 주장에 어떻게 답해야 하는가?

<details>
<summary>정답과 해설</summary>

Server Component source는 hydrate하지 않지만 tree 안의 Client Component는 JavaScript와 hydration이 필요하다. build의 client module graph, RSC payload, browser hydration/interaction marker를 확인해 실제 대상을 식별해야 한다.
</details>

## 참고 자료

- [React — `<Suspense>`](https://react.dev/reference/react/Suspense) — streaming server rendering과 selective hydration의 Suspense 통합을 확인한다. (2026-07-11 확인)
- [React — `hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot) — root hydration, 동일성, recoverable error 계약을 확인한다. (2026-07-11 확인)
- [React — React v18.0](https://react.dev/blog/2022/03/29/react-v18) — streaming SSR과 selective hydration이 도입된 공식 배경을 확인한다. (2026-07-11 확인)
- [React 18 Working Group — New Suspense SSR Architecture](https://github.com/reactwg/react-18/discussions/37) — streaming HTML, code loading, interaction priority가 결합되는 설계 설명을 확인한다. (2026-07-11 확인)
- [Patterns.dev — Selective Hydration](https://www.patterns.dev/react/react-selective-hydration/) — selective hydration 문제 지형을 위한 2차 자료다. legacy API 예제는 현재 API로 대체해 읽는다. (2026-07-11 확인)
