# 5b-7. React Server Components

> 한 줄 요약: RSC는 React tree를 server/client module graph로 분할해 표시 전용 code를 browser에서 제외하지만, 그 경계에 직렬화·network round trip·server capacity·authorization 계약을 만든다.

이 문서는 2026년 7월 11일에 확인한 React 19 계열의 안정된 Server Components·directive 문서를 기준으로 한다. React 공식 문서는 component model은 React 19에서 stable이지만 bundler/framework 구현 API는 19.x minor 사이에도 semver 안정성을 보장하지 않는다고 명시한다. 따라서 예제의 파일 경계는 React 모델이고 route·cache·navigation 구현은 framework version을 별도로 고정해야 한다.

## 학습 목표

- RSC와 SSR을 input, output, 실행 환경, hydration 대상으로 구분할 수 있다.
- `'use client'`가 module dependency graph의 경계를 만들고 `'use server'`가 Server Function을 표시하는 차이를 설명할 수 있다.
- state·event·browser API와 server-only data·secret 기준으로 Server/Client Component 경계를 설계할 수 있다.
- 경계를 넘는 값의 serializability와 composition 규칙을 적용할 수 있다.
- client bundle 감소와 server work·RSC payload·cache invalidation·보안 비용을 함께 검증할 수 있다.

## 배경: 왜 이것이 존재하는가

전통적 React SSR은 server에서 HTML을 만들더라도 interactive tree의 component code를 browser가 다시 받아 hydrate하는 경우가 많다. Markdown parser, syntax highlighter, data formatting library가 첫 HTML을 만들기 위해 server에서 실행된 뒤 client bundle에도 포함될 수 있다. browser에서 다시 쓸 일이 없는 code까지 network와 CPU 비용이 된다.

RSC(React Server Components)는 component tree의 일부를 server 환경에서만 실행한다. Server Component의 **source code**는 client module graph에 들어갈 필요가 없고, 실행 결과가 RSC payload에 담긴다. state·event가 필요한 leaf만 Client Component로 남긴다.

```text
ProductPage (Server: DB read, formatting)
  ├─ ProductDescription (Server: Markdown render)
  ├─ Reviews (Server: read-only list)
  └─ AddToCart (Client: state, click, browser feedback)
```

이 경계는 “server가 더 강력하니 전부 server로 옮긴다”는 발전 단계가 아니다. 사용자의 즉시 입력과 장시간 local state는 client가 자연스럽다. 목표는 page 약어 하나가 아니라 code/data/interaction owner를 component 단위로 드러내는 것이다.

## 핵심 개념

### RSC와 SSR은 서로 다른 output을 만든다

| 관점 | RSC | SSR |
|---|---|---|
| 주 입력 | server/client module graph, props, data | render할 React tree와 request snapshot |
| 주 출력 | 직렬화된 React tree 결과와 client reference를 담은 RSC payload | browser가 parse할 HTML stream |
| 실행 시점 | build 또는 request | 주로 request, static build와도 결합 가능 |
| browser 역할 | payload로 tree를 조립하고 Client Component를 실행 | HTML을 parse/paint하고 interactive tree를 hydrate |
| 줄일 수 있는 것 | Server Component source와 의존성의 client bytes | client data 이전의 HTML 표시 지연 |

초기 request에서 framework는 먼저 RSC tree를 계산하고 그 결과를 SSR에 넣어 HTML을 만들 수 있다. browser에는 HTML, RSC payload, Client Component JavaScript가 각각 필요할 수 있다.

```text
Server Component execution
  → RSC payload
      ├─ SSR → initial HTML
      └─ browser tree reconciliation/navigation

Client module references
  → client JS download
  → Client Component hydration
```

RSC를 사용한다고 HTML streaming·SSR·cache가 자동으로 생기지 않는다. build-time RSC output을 static artifact로 만들 수도 있고, navigation마다 server에 RSC payload를 요청할 수도 있다.

### Server Component에는 표시 directive가 없다

React의 공식 구분은 다음과 같다.

- directive가 없는 module은 import되는 graph와 framework context에 따라 server 또는 client에서 평가될 수 있다.
- `'use client'`는 해당 module을 client entry로 만들고 transitive dependency를 client graph에 포함한다.
- `'use server'`는 Server Component 표시가 아니라 client에서 network로 호출 가능한 Server Function을 표시한다.

```tsx
// ProductPage.tsx — Server Component context에서 실행된다.
import { readFile } from "node:fs/promises";
import { AddToCart } from "./AddToCart";

export async function ProductPage({ id }: { id: string }) {
  const product = await productRepository.findById(id);
  const description = await readFile(product.descriptionPath, "utf8");

  return (
    <article>
      <h1>{product.name}</h1>
      <ProductDescription markdown={description} />
      <AddToCart productId={product.id} />
    </article>
  );
}
```

```tsx
// AddToCart.tsx
"use client";

import { useState } from "react";

export function AddToCart({ productId }: { productId: string }) {
  const [quantity, setQuantity] = useState(1);

  return (
    <div>
      <button type="button" onClick={() => setQuantity((value) => value + 1)}>
        수량 {quantity}
      </button>
      <button type="button" onClick={() => submitCart(productId, quantity)}>
        장바구니에 담기
      </button>
    </div>
  );
}
```

`ProductPage`와 Markdown 의존성은 server에서만 실행될 수 있다. `AddToCart`는 `useState`와 event handler가 필요해 client module이다. `productId`만 경계를 넘기므로 client에 DB row 전체나 secret을 보낼 필요가 없다.

### `'use client'`는 파일 한 개가 아니라 import graph를 옮긴다

```text
DashboardShell ('use client')
  ├─ StaticHeader
  ├─ markdown parser
  └─ HeavyChart

모두 client graph 후보가 된다.
```

상위 layout에 편의를 위해 `'use client'`를 붙이면 그 module이 import하는 순수 표시 code와 무거운 의존성까지 browser로 이동한다. 경계를 interaction leaf로 내린다.

```text
DashboardPage (Server)
  ├─ StaticHeader (Server)
  ├─ ReportBody (Server)
  └─ ChartControls ('use client')
```

단, component source보다 serialized output이 훨씬 큰 경우에는 무조건 server가 작다는 결론도 위험하다. 긴 SVG path나 큰 반복 tree는 RSC payload/HTML bytes를 늘릴 수 있다. client module bytes, RSC response, HTML을 resource별로 측정한다.

### 실행 가능성과 금지는 환경으로 설명한다

| 요구 | Server Component | Client Component |
|---|---|---|
| async DB/file/server API read | 가능 | 직접 server resource 접근 불가 |
| secret 사용 | server 안에서 가능 | bundle/props에 보내면 노출 |
| stateful Hook | 불가 | 가능 |
| event handler | 불가 | 가능 |
| `window`, DOM, storage | 불가 | 가능 |
| 표시 전용 React tree | 가능 | 가능하지만 client cost 발생 |
| Server Function 호출 | reference를 전달 가능 | network call로 호출 가능 |

Server Component는 request 뒤 memory에 남는 interactive instance가 아니므로 local state와 Effect가 없다. Client Component도 initial HTML을 위해 server에서 prerender될 수 있다는 점에 주의한다. “Client”는 source가 browser graph에 있고 hydration 대상이라는 뜻이지 server가 절대 호출하지 않는다는 뜻이 아니다.

### 경계는 JSON보다 넓지만 임의 객체를 통과시키지 않는다

React의 serializable set은 plain JSON보다 넓다. primitive, plain object, Array, Map, Set, Date, typed array, globally registered Symbol, Promise, React element, Server Function reference 등 공식 지원 값이 있다. 반면 다음은 경계를 넘기지 못한다.

- 일반 function과 event handler
- class 및 임의 class instance
- DOM node, database connection, request/response object
- null prototype object나 지원되지 않는 symbol

```tsx
// 나쁜 경계: ORM entity의 method/prototype/내부 필드까지 의미가 불분명하다.
<ProductEditor product={productEntity} />

// 필요한 공개 DTO만 만든다.
<ProductEditor
  product={{
    id: productEntity.id,
    name: productEntity.name,
    price: productEntity.price,
  }}
/>
```

serializable하다는 사실은 공개해도 안전하다는 뜻이 아니다. access token, internal cost, hidden moderation field는 문자열이므로 직렬화 가능하지만 client에 보내면 노출된다. boundary DTO는 type과 authorization view를 함께 설계한다.

### Client가 Server 결과를 slot으로 받게 합성한다

Client Component가 Server Component module을 직접 import하면 해당 dependency를 client에서 실행하려 하거나 build error를 만든다. 대신 Server parent가 두 결과를 합성해 Server result를 `children`/slot으로 전달한다.

```tsx
// Expandable.tsx
"use client";

import { useState, type ReactNode } from "react";

export function Expandable({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        설명 {open ? "접기" : "보기"}
      </button>
      {open ? children : null}
    </section>
  );
}
```

```tsx
// ProductPage.tsx — Server Component가 composition을 소유한다.
export async function ProductPage({ id }: { id: string }) {
  return (
    <Expandable>
      <ProductDescription id={id} />
    </Expandable>
  );
}
```

`Expandable`은 전달받은 React element를 새로 server에서 호출하는 것이 아니라 payload 속 slot으로 배치한다. 표시 owner는 server, open state owner는 client로 유지된다.

### data co-location은 client waterfall을 server waterfall로 바꿀 수 있다

Server Component가 data source 가까이서 직접 읽으면 client bundle과 API round trip을 줄일 수 있다. 하지만 component nesting대로 순차 `await`하면 server waterfall이 생긴다.

```text
Page awaits product
  → Reviews receives product.id
    → awaits reviews
      → Author awaits author
```

가능한 data를 parent에서 병렬 시작하거나 framework preload/memoization을 사용한다. 같은 request의 중복 read를 합치는 것과 요청을 넘어 cache하는 것은 구분한다. RSC 자체는 freshness 정책이 아니다.

RSC navigation도 network 왕복이다. client state 전환마다 server tree를 다시 요청하면 latency와 server capacity가 늘 수 있다. local-only interaction은 Client Component에 남기고, server authority가 필요한 전환만 새 payload를 요청한다.

### Server Function은 component 문법을 가진 endpoint다

```ts
// actions.ts
"use server";

export async function addToCart(rawProductId: unknown, rawQuantity: unknown) {
  const session = await requireSession();
  const productId = parseProductId(rawProductId);
  const quantity = parseQuantity(rawQuantity);

  await authorizeCartMutation(session.userId, productId);
  return cartRepository.add(session.userId, productId, quantity);
}
```

client에서 이 function을 호출하면 arguments가 직렬화되어 network request로 전달된다. 사용자가 DevTools나 직접 request로 값을 바꿀 수 있으므로 다음을 수행한다.

- authentication을 server에서 다시 확인한다.
- 대상 resource 기준 authorization을 수행한다.
- input shape·range·encoding을 검증한다.
- 중복 제출, idempotency, rate limit을 고려한다.
- return/error에 secret과 내부 stack을 넣지 않는다.
- mutation 뒤 cache invalidation 범위를 명시한다.

`'use server'`를 붙였다고 내부 함수가 안전한 RPC가 되는 것이 아니다. React 공식 문서도 Server Function arguments를 untrusted input으로 취급하라고 명시한다. Server Function은 mutation에 적합하며 일반 data fetching 용도로 권장되지 않는다.

### RSC payload는 app 내부 protocol이지 공개 API가 아니다

payload에는 Server Component의 렌더 결과, Client Component 위치와 module reference, props 등이 들어간다. wire format 구현에 의존해 직접 parse하거나 영속 저장하는 것을 app contract로 만들지 않는다. framework/React version에 결합되기 때문이다.

mobile·외부 partner·다른 service가 필요한 data는 별도 API contract를 유지한다. RSC payload는 React UI navigation protocol이며 domain API를 보편적으로 대체하지 않는다.

## 실무 관점

### 경계는 capability보다 data exposure에서 먼저 검토한다

Server Component가 secret을 사용해 결과를 계산할 수는 있지만 그 secret을 JSX text나 Client prop에 넣으면 payload/HTML로 노출된다. source map·bundle뿐 아니라 HTML과 RSC response에서 marker secret이 없는지 확인한다. server-only module guard를 framework가 제공하면 DB/secret module에 적용한다.

### cache와 rendering을 한 결정으로 묶지 않는다

Server Component가 request마다 실행될 수도, build에서 한 번 실행될 수도, function/data result를 cache할 수도 있다. 사용자 권한 data를 component가 server에서 읽는다는 이유로 shared cache해도 된다고 결론내리지 않는다. key, freshness, invalidation, tenant/user variant를 [5b-4 ISR](./04-incremental-static-generation.md)의 상태 머신으로 기록한다.

### 관찰 실험

같은 상품 page를 두 variant로 만든다.

- client-heavy: Markdown parser와 product fetch를 Client Component graph에 둔다.
- server-first: description/list는 Server Component, cart/like leaf만 Client Component로 둔다.

production build에서 다음을 전후 비교한다.

1. client module 목록과 raw/minified/compressed JS bytes
2. initial HTML, RSC response, JSON/API response bytes
3. server data/render time과 navigation round trip
4. script parse/evaluate와 hydration marker
5. secret canary가 client bundle·HTML·RSC payload에 없는지
6. class instance/function prop을 넘겼을 때 build/runtime error
7. unauthorized Server Function request가 거절되는지

Markdown dependency가 client bytes에서 빠져도 server CPU·RSC/HTML bytes가 늘 수 있다. 한 resource 감소만으로 성공을 선언하지 않는다.

### 선택 체크리스트

- state·event·browser API가 필요한 가장 작은 leaf는 어디인가?
- `'use client'` file의 transitive dependency를 bundle report로 확인했는가?
- Server→Client props가 공식 serializable type이며 공개 가능한 DTO인가?
- Client wrapper가 Server result를 직접 import하지 않고 slot으로 받는가?
- data request를 병렬로 시작하고 request dedupe와 persistent cache를 구분했는가?
- RSC navigation round trip과 server capacity budget이 있는가?
- Server Function이 input validation·authentication·authorization을 다시 수행하는가?
- secret canary가 HTML·RSC payload·client source에 없는지 검사했는가?
- React component model과 framework bundler/cache version risk를 분리했는가?

## 정리

- RSC는 Server Component 실행 결과와 Client Component reference를 payload로 전달하는 component execution model이고 SSR은 HTML 생성 계층이다.
- Server Component를 표시하는 `'use server'` directive는 없으며, `'use client'`는 client module graph를, `'use server'`는 Server Function을 표시한다.
- Server Component source와 의존성은 client bundle에서 제외할 수 있지만 RSC payload, server work, navigation round trip, cache invalidation 비용이 생긴다.
- server/client 경계는 serializable하고 공개 가능한 DTO·slot composition으로 설계한다.
- Server Function은 network endpoint와 같은 untrusted input·authorization 경계다.

## 확인 문제

**Q1.** root layout에 `'use client'`를 붙인 뒤 Markdown parser와 정적 header code가 client bundle에 들어갔다. 왜 그런가?

<details>
<summary>정답과 해설</summary>

`'use client'`는 파일 하나가 아니라 그 module의 transitive dependency graph를 client code로 표시한다. state/event가 필요한 leaf만 client entry로 내리고 header·Markdown render는 Server Component graph에 남긴 뒤 bundle module/bytes를 다시 비교한다.
</details>

**Q2.** Server Component가 ORM `Product` instance를 Client Component에 prop으로 넘길 수 없었다. plain DTO로 바꾸는 것 외에 보안상 무엇을 확인해야 하는가?

<details>
<summary>정답과 해설</summary>

DTO field가 serializable한 것뿐 아니라 현재 사용자가 볼 수 있는 값인지 확인한다. internal cost, supplier note, access token 같은 문자열은 직렬화 가능하지만 노출하면 안 된다. authorization view를 만든 뒤 HTML·RSC payload에서 민감 field가 없는지 검증한다.
</details>

**Q3.** client fetch waterfall이 사라졌지만 server render가 느려졌다. RSC가 실패했다고 단정하기 전에 어떤 새 경로를 살펴야 하는가?

<details>
<summary>정답과 해설</summary>

중첩 Server Component의 순차 `await`, 중복 data read, RSC payload 크기, server capacity/cold start를 본다. 가능한 요청은 병렬 시작하고 request memoization과 persistent cache를 구분한다. client JS 감소와 server/render/navigation latency를 함께 비교해 요구사항에 맞는지 판단한다.
</details>

## 참고 자료

- [React — Server Components](https://react.dev/reference/rsc/server-components) — build/request 실행, async component, Client Component composition과 React 19 안정성 범위를 확인한다. (2026-07-11 확인)
- [React — `'use client'`](https://react.dev/reference/rsc/use-client) — client module graph와 serializable props의 현재 지원 집합을 확인한다. (2026-07-11 확인)
- [React — `'use server'`](https://react.dev/reference/rsc/use-server) — Server Function, network 호출, serializable arguments와 untrusted input 보안 지침을 확인한다. (2026-07-11 확인)
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — RSC를 제공하는 framework adapter의 payload·prerender·hydration 흐름을 확인한다. (2026-07-11 확인)
- [Patterns.dev — React Server Components](https://www.patterns.dev/react/react-server-components/) — RSC 경계의 문제 지형을 위한 2차 자료다. (2026-07-11 확인)

