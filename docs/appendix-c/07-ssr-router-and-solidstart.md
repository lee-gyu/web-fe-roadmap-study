# C-7. SSR, Router, SolidStart — 요청 경계에서 동형 애플리케이션을 설계한다

> 한 줄 요약: full-stack Solid의 핵심은 같은 JSX를 양쪽에서 실행하는 데 있지 않고, HTML·data·code의 전송 시점과 URL·request·cache·secret의 소유 경계를 일치시키는 데 있다.

> 집필 기준: `solid-js` 1.9.14, `@solidjs/router` 0.16.1, 2026-07-11 현재 SolidStart 1.x 공식 문서. SolidStart 2.0 alpha가 병존하므로 새 프로젝트는 lockfile·template·deployment preset의 실제 버전을 먼저 고정하고 API를 재검증한다.

## 학습 목표

- CSR의 비용을 기준으로 sync·async·streaming SSR의 응답 timeline과 tradeoff를 비교할 수 있다.
- hydration marker, serialized data, client bundle이 기존 DOM에 연결되는 과정을 추적하고 mismatch를 진단할 수 있다.
- Solid Router에서 URL matching, nested layout, navigation, preload, query, action의 책임을 분리할 수 있다.
- SolidStart의 file route, server function, API route, middleware, session을 request scope로 설계할 수 있다.
- cache·prerender·streaming·authentication을 결합한 full-stack app의 보안·관측·철회 조건을 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

client-only SPA는 초기 HTML shell을 받은 뒤 JavaScript를 download·parse·execute하고, component가 실행된 뒤 data fetch를 시작하기 쉽다.

```text
request HTML
  → empty shell
  → JS download/parse/execute
  → route/component creation
  → data request
  → DOM content
  → interaction
```

긴 session의 내부 도구에서는 초기 비용을 상쇄하고 부드러운 client navigation을 얻을 수 있다. 그러나 public content, 느린 network/CPU, crawler, JavaScript failure 환경에서는 first content와 recoverability가 약해진다. server rendering은 server가 component tree를 먼저 실행해 HTML을 보내 이 timeline을 바꾼다.

SSR도 공짜가 아니다.

- request마다 server CPU와 data dependency를 소비한다.
- server와 client가 같은 initial output을 만들어야 한다.
- HTML이 보여도 hydration 전에는 일부 interaction이 동작하지 않는다.
- streaming이 시작된 뒤 status/redirect를 바꾸기 어려워진다.
- serialized data와 inline script에 XSS·CSP 책임이 생긴다.

따라서 “SEO가 필요하면 SSR”이라는 한 문장보다 **어느 단계가 무엇을 기다리고 어떤 byte를 보내는가**로 비교한다.

## 핵심 개념

### 세 가지 server renderer는 기다리는 범위가 다르다

| API | 응답 시작 | async Suspense | 장점 | 주요 비용 |
|---|---|---|---|---|
| `renderToString` | 동기 render 완료 뒤 | 기다리지 않음 | 단순하고 빠른 shell | pending content를 완성하지 못함 |
| `renderToStringAsync` | 모든 server Suspense 해결 뒤 | 모두 기다림 | 완성된 한 문자열 | 느린 dependency가 전체 TTFB를 막음 |
| `renderToStream` | shell 준비 뒤 flush 가능 | 해결 순서대로 후속 chunk | TTFB와 async content 병렬화 | proxy buffering, status/redirect, client runtime 복잡도 |

#### 동기 문자열

```tsx
import { renderToString } from "solid-js/web";

const html = renderToString(() => <App />, {
  renderId: "app",
  nonce: cspNonce,
});
```

`renderToString`은 현재 output과 hydration markup을 반환하지만 async Suspense가 settle되기를 기다리지 않는다. static shell 또는 별도로 준비된 동기 data에 적합하다.

#### async 문자열

```tsx
import { renderToStringAsync } from "solid-js/web";

const html = await renderToStringAsync(() => <App />, {
  timeoutMs: 5_000,
  renderId: "app",
  nonce: cspNonce,
});
```

모든 server Suspense가 해결된 뒤 완성된 string을 얻고 resource data를 hydration용으로 serialize한다. CDN에 한 object로 저장하거나 crawler에 완성 HTML을 제공하기 쉽지만 가장 느린 dependency가 first byte를 지연시킨다. timeout 뒤 어떤 fallback/error response를 보낼지 설계한다.

#### stream

```tsx
import { renderToStream } from "solid-js/web";

const stream = renderToStream(() => <App />, {
  nonce: cspNonce,
  onCompleteShell() {
    console.log("shell ready");
  },
  onCompleteAll() {
    console.log("all suspense resolved");
  },
});

stream.pipe(nodeWritable);
// Web Streams target에서는 stream.pipeTo(writable)을 사용한다.
```

shell에는 Suspense fallback이 들어갈 수 있고, resource가 해결되면 후속 HTML·serialized data가 stream된다. server가 빨리 write해도 reverse proxy, compression middleware, CDN이 buffer하면 browser는 chunk를 늦게 받는다. production에서 실제 response chunk timing을 확인해야 한다.

### rendering strategy는 page 전체가 아니라 경계별 조합이다

한 response 안에서도 다음을 조합할 수 있다.

```text
동기 shell:       header, navigation, page skeleton
streaming region: personalized recommendations
client-only:      browser API를 쓰는 chart editor
static asset:     versioned JS/CSS/image
```

모든 data를 async string으로 기다리거나 모든 widget을 client-only로 미루는 극단보다, 사용자에게 먼저 의미 있는 영역과 interaction 우선순위를 boundary로 표현한다.

### hydration은 DOM을 다시 만드는 것이 아니라 연결한다

```tsx
import { hydrate } from "solid-js/web";

const dispose = hydrate(
  () => <App />,
  document.getElementById("app")!,
  { renderId: "app" },
);
```

server renderer는 hydration marker와 필요 data를 HTML에 넣는다. client는 같은 component tree를 실행해 marker로 기존 node를 찾고 event·reactive computation을 연결한다. `hydrate`는 root disposer를 반환한다.

```text
server                         client
component execution           component execution
  → HTML + markers + data  →  marker lookup
                                 → existing DOM reuse
                                 → event/reactivity attach
```

HTML이 보이는 시점(FCP/LCP)과 interaction 가능한 시점은 다르다. 큰 client bundle이나 main-thread long task가 있으면 SSR로 content를 빨리 보여도 INP가 나쁠 수 있다.

### hydration mismatch는 비결정적 initial output에서 생긴다

대표 원인은 다음과 같다.

- render 중 `Date.now()`, `Math.random()` 사용
- locale/timezone 차이
- server에 없는 `window`, `localStorage`, viewport 분기
- request와 client cache가 서로 다른 initial data를 사용
- invalid HTML로 browser parser가 DOM을 교정
- server와 client에서 서로 다른 route/base path를 계산

초기값을 server에서 결정해 serialize하거나 mount 뒤 client state로 전환한다.

```tsx
function Clock(props: { initialIso: string }) {
  const [now, setNow] = createSignal(new Date(props.initialIso));

  onMount(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    onCleanup(() => window.clearInterval(timer));
  });

  return <time datetime={now().toISOString()}>{format(now())}</time>;
}
```

server와 client의 첫 render는 같은 `initialIso`를 쓰고, hydration 뒤 clock을 갱신한다.

### server/client 분기는 capability 경계다

`isServer`와 `DEV` 같은 compile/runtime flag로 환경별 code를 분기할 수 있다. 그러나 분기가 많아지면 같은 component가 실제로 동형(isomorphic)이 아니게 되고 hydration mismatch와 bundle leak 위험이 커진다.

```tsx
import { isServer } from "solid-js/web";

const storage = isServer ? undefined : window.localStorage;
```

secret, database connection, filesystem access는 단순 `if (isServer)`보다 server-only module/server function boundary에 둔다. bundler가 client graph에서 제거하는지 production output으로 확인한다.

### application shell과 client logic을 분리한다

manual SSR을 구성할 때 최소 흐름은 다음과 같다.

```text
HTTP request
  → request-scoped data/router context
  → server renderer(App)
  → document shell에 HTML·HydrationScript·assets 삽입
  → response/stream

browser
  → 같은 route/data seed로 hydrate(App)
  → client navigation과 event 처리
```

HTML document, meta, CSP nonce, status/header, asset manifest는 shell 책임이다. button handler와 reactive UI는 client entry 책임이다. 두 entry가 같은 shared App tree를 사용하더라도 server-only dependency가 client entry로 새지 않게 import graph를 분리한다.

직접 Express와 renderer를 조합하면 HTTP adapter, abort, stream error, asset injection, route matching, serialization을 모두 소유한다. 이 제어가 필요할 때만 manual SSR을 택하고, 일반 full-stack application은 SolidStart가 제공하는 request pipeline을 검토한다.

### Router는 URL을 application state 경계로 만든다

```tsx
import { Route, Router } from "@solidjs/router";

export function App() {
  return (
    <Router root={AppShell}>
      <Route path="/" component={HomePage} />
      <Route path="/users" component={UsersLayout}>
        <Route path="/:id" component={UserPage} />
      </Route>
      <Route path="*404" component={NotFoundPage} />
    </Router>
  );
}
```

URL은 단순 string이 아니다.

```text
scheme://authority/path?search#fragment
```

- path는 route와 resource identity를 표현한다.
- search parameter는 shareable filter/sort/page state에 적합하다.
- fragment는 document 안의 위치나 client-only anchor state를 나타낸다.
- history state는 URL에 노출하지 않을 transient navigation state다.

화면에 중요한 상태를 local signal에만 두면 refresh·deep link·back/forward에서 잃는다. 반대로 입력 중인 password나 거대한 draft를 query string에 넣으면 보안·URL 길이·history 오염 문제가 생긴다.

### route 신원과 layout 수명을 설계한다

dynamic parameter, optional parameter, wildcard, nested route는 URL pattern 이상의 lifecycle 결정이다. parent layout은 child route가 바뀌어도 유지될 수 있으므로 navigation, Context, resource cache를 어디에 둘지 결정한다.

```text
/projects/:projectId/tasks/:taskId
└─ ProjectsLayout owner
   └─ ProjectLayout owner
      └─ TaskPage owner
```

projectId가 바뀔 때 ProjectLayout을 재사용할지, local draft와 subscription을 reset할지 route key와 data dependency로 검증한다. layout을 시각적 wrapper로만 보지 않는다.

### navigation은 anchor semantics를 보존한다

```tsx
import { A, useNavigate } from "@solidjs/router";

<A href="/orders" activeClass="active">Orders</A>
```

`<A>`는 client navigation과 active state를 제공하면서 anchor semantics를 유지한다. open in new tab, copy link, keyboard와 crawler가 필요한 navigation에 button+`useNavigate`를 쓰지 않는다.

programmatic navigation은 form completion, timer, access control처럼 imperative transition이 필요한 경우에 쓴다.

```tsx
const navigate = useNavigate();
navigate(`/orders/${id}`, { replace: true });
```

server data flow에서는 `redirect`가 HTTP/navigation response를 표현한다. client hook과 server redirect의 실행 위치를 혼동하지 않는다.

### preload는 code와 data의 시작 시점을 앞당긴다

Solid Router는 link hover/focus 같은 user intent와 route render 시점에 preload할 수 있다.

```tsx
import { createAsync, query, Route, useParams } from "@solidjs/router";

const getUser = query(async (id: string) => {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as User;
}, "user");

const preloadUser = (args: { params: { id: string } }) => {
  void getUser(args.params.id);
};

function UserPage() {
  const params = useParams<{ id: string }>();
  const user = createAsync(() => getUser(params.id));
  return <h1>{user()?.name}</h1>;
}

<Route path="/users/:id" preload={preloadUser} component={UserPage} />;
```

`query`는 이름과 argument로 key를 만들고 concurrent/nearby request를 deduplicate하며 active consumer에 결과를 재사용한다. `createAsync`는 query result를 reactive/Suspense-compatible accessor로 소비한다. 큰 nested data에는 `createAsyncStore`를 검토할 수 있다.

preload cache는 영구 database나 무제한 application cache가 아니다. user별 authorization, argument serialization, stale time, invalidation 범위를 확인한다. hover가 많은 dense UI에서 과도한 data/code fetch가 생기는지도 Network panel로 측정한다.

### action은 mutation lifecycle을 URL/form과 연결한다

```tsx
import { action, useSubmission } from "@solidjs/router";

const renameUser = action(async (formData: FormData) => {
  "use server";

  const id = String(formData.get("id"));
  const name = String(formData.get("name"));
  await db.user.update({ id, name });
  return { id, name };
}, "rename-user");

function RenameForm(props: { user: User }) {
  const submission = useSubmission(renameUser);

  return (
    <form action={renameUser} method="post">
      <input type="hidden" name="id" value={props.user.id} />
      <input name="name" value={props.user.name} />
      <button disabled={submission.pending}>Save</button>
    </form>
  );
}
```

action은 mutation pending/result/error를 router가 추적하고 성공 뒤 관련 query revalidation과 결합할 수 있게 한다. HTML form과 연결하면 JavaScript가 아직 준비되지 않은 상황의 progressive enhancement 경로도 가질 수 있다.

server는 client가 보낸 hidden id와 field를 신뢰하면 안 된다. session에서 actor를 확인하고 authorization·validation·CSRF policy를 server boundary에서 수행한다. `useSubmission`은 UX state이지 authorization evidence가 아니다.

### SolidStart는 route와 request runtime을 결합한다

SolidStart는 Solid와 Router 위에 file-based UI/API route, server function transform, SSR mode, deployment preset을 제공한다.

```text
src/
├─ app.tsx                 root Router/layout
├─ routes/
│  ├─ index.tsx            /
│  ├─ users/
│  │  └─ [id].tsx          /users/:id
│  └─ api/
│     └─ users.ts          HTTP method exports
├─ lib/
│  ├─ users.server.ts      server-only data access
│  └─ auth.server.ts       session/auth policy
└─ middleware.ts           request-scoped cross-cutting concerns
```

정확한 file naming과 configuration은 생성한 template 버전의 공식 문서를 따른다. route folder 모양을 외우기보다 다음 책임을 구분한다.

- UI route: HTML/JSX, layout, route data consumer
- API route: 다른 client·webhook·public HTTP contract
- server function: UI가 호출하는 typed server operation
- middleware: request/response 공통 policy와 request-local context

### `"use server"`는 compile-time trust boundary다

```tsx
export async function findPrivateOrders() {
  "use server";

  const user = await requireUser();
  return db.order.findMany({ userId: user.id });
}
```

compiler는 server function reference를 client build에서는 network 호출 가능한 reference로 바꾸고 server build에서는 실제 구현과 manifest에 연결한다. 함수 body가 client bundle에 그대로 실행되지 않는다는 경계지만 다음을 자동으로 보장하지는 않는다.

- argument validation과 authorization
- idempotency와 transaction
- rate limit과 audit logging
- return value의 safe serialization
- error message에서 secret 제거

“server에서 실행된다”와 “안전하다”는 다른 주장이다.

### API route와 server function을 구분한다

API route는 HTTP method별 handler와 `Request`/`Response` contract를 직접 노출한다.

```ts
import type { APIEvent } from "@solidjs/start/server";

export async function GET({ params, request }: APIEvent) {
  const user = await authenticate(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  return Response.json(await loadOrder(params.id, user.id));
}
```

다른 web/mobile client, webhook, OAuth callback, file response가 필요하면 API route가 적합하다. 현재 SolidStart UI 하나만 소비하고 type-safe query/action 통합이 중요하면 server function이 단순하다. domain logic은 둘 중 어느 transport에서도 호출할 수 있는 server module에 둔다.

### request scope와 process scope를 혼동하지 않는다

serverless/edge 환경에서는 request마다 isolate/process가 새로 생길 수도 있고 warm instance가 재사용될 수도 있다. module memory가 항상 비어 있거나 항상 공유된다고 가정할 수 없다.

```ts
// 사용자별 mutable data를 두면 안 되는 process/module scope
const currentUserCache = new Map<string, User>();
```

request별 identity, transaction, locale, feature flag는 request event/middleware locals와 session에서 가져온다. 영속 data는 database·KV·object storage에 두고 cache는 consistency·eviction·tenant key를 명시한다.

middleware는 authentication, correlation id, CSP/header, logging 같은 cross-cutting concern을 request lifecycle에 연결한다. `event.locals`는 같은 request의 server context 사이에서 값을 공유하는 데 사용한다. global singleton 대신 request-local scope를 유지한다.

### session은 signed/encrypted cookie와 server-only secret을 요구한다

SolidStart의 current session helper는 underlying Vinxi HTTP utility를 사용한다. session helper는 server function/API route처럼 server context에서만 실행한다.

```ts
import { useSession } from "vinxi/http";

type SessionData = { userId?: string };

export async function useAuthSession() {
  "use server";

  return useSession<SessionData>({
    name: "session",
    password: process.env.SESSION_SECRET!,
  });
}
```

공식 문서는 session password를 최소 32자 이상 강한 secret으로 두고 private environment variable에서 읽도록 안내한다. cookie payload에 민감한 원문을 과도하게 넣지 않고 Secure, HttpOnly, SameSite, rotation, logout invalidation과 배포 environment를 검토한다.

route 보호는 UI를 숨기는 것이 아니라 server query/action에서 다시 authorization해야 한다. stream이 시작된 뒤 redirect/status를 바꿀 수 없으므로 인증 query를 먼저 해결하거나 current API의 `deferStream` 같은 option을 target version에서 검증한다.

### cache와 preload는 authoritative storage가 아니다

cache 설계에는 최소 다섯 질문이 필요하다.

1. key에 tenant/user/locale과 모든 input이 포함되는가?
2. fresh/stale 기간과 mutation 뒤 invalidation은 무엇인가?
3. server process, CDN, browser 중 어느 계층의 cache인가?
4. failure 때 stale data를 반환해도 안전한가?
5. deploy와 schema change 때 이전 entry를 어떻게 무효화하는가?

Router query의 deduplication, request 내부 `cache`, HTTP `Cache-Control`, CDN cache, database cache는 다른 lifetime과 consistency model을 가진다. 이름이 cache라고 같은 것으로 취급하지 않는다.

### prerender는 build time snapshot이다

SolidStart는 route를 build time에 HTML로 생성하는 prerender/SSG를 지원한다. content-rich public page에서 runtime server 비용과 TTFB를 줄일 수 있다.

```ts
import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  server: {
    prerender: {
      routes: ["/", "/about"],
    },
  },
});
```

user-specific data, request cookie/header, 자주 바뀌는 inventory를 build snapshot에 넣으면 안 된다. static shell과 client/server dynamic region을 조합하거나 revalidation/deploy workflow를 설계한다.

### status와 header는 stream 전 결정한다

SolidStart는 `HttpStatusCode`, `HttpHeader`, `Response` helper로 server response를 제어한다. 404 content를 그렸다고 HTTP status가 자동으로 404가 되는지 확인해야 한다. cache header도 page content freshness와 tenant scope에 맞게 설정한다.

stream 첫 byte가 전송되면 status와 일부 header를 바꿀 수 없다. 인증 redirect, not found, critical error는 shell flush 전에 결정하거나 stream 안에서 표현 가능한 UI error로 바꾼다.

## 실무 관점

### 렌더링 전략 선택표

| 조건 | 우선 후보 | 반드시 검증할 비용 |
|---|---|---|
| 인증 내부 도구, 긴 session | CSR | 초기 bundle, client data waterfall |
| public content, request별 data | SSR | server latency·capacity, hydration cost |
| static content, 낮은 freshness | prerender/SSG | build time, invalidation |
| shell은 빠르고 일부 data가 느림 | streaming SSR | proxy buffering, fallback stability, late error |
| browser-only heavy widget | client-only island/region | empty server HTML, layout shift, accessibility |

한 page에 여러 전략이 공존할 수 있다. 결정은 framework global toggle보다 route와 boundary의 data·interaction requirement에서 출발한다.

### 보안 체크리스트

- database, session secret, private token을 server-only module에 둔다.
- server function/action/API route마다 input validation과 authorization을 수행한다.
- HTML/data serialization은 framework serializer를 사용하고 raw script insertion을 피한다.
- inline hydration script가 있으면 CSP nonce와 policy를 함께 설계한다.
- redirect target과 user-generated URL을 allowlist/normalize한다.
- cache key에 tenant identity를 넣고 public/private cache header를 구분한다.
- error response와 logs에서 stack, query, secret, PII를 정리한다.

### 관찰 timeline

다음 marker를 server log, Server-Timing, browser Performance에 남긴다.

```text
t0 request accepted
t1 route/auth resolved
t2 shell ready
t3 first byte observed by browser
t4 first meaningful content
t5 all server suspense resolved
t6 client bundle evaluated
t7 hydration complete
t8 first interaction handled
```

`t2`가 빠른데 `t3`가 늦으면 proxy buffering/network를 의심한다. `t4`가 빠르고 `t8`이 늦으면 client bundle과 main thread/hydration을 본다. `t1`이 느리면 route/auth/data waterfall을 조사한다.

### 통합 적용 과제: 데이터 중심 애플리케이션

quote 또는 order 관리 앱을 다음 경계로 구현한다.

```text
public routes       list/detail, streaming 또는 prerender 비교
protected routes    session 기반 read authorization
actions             create/update/delete + validation + redirect
query               key·dedup·revalidation 기록
client-only layer   toast와 destructive confirmation
middleware          request id, auth context, security headers
storage             persistent database 또는 명시적 test adapter
```

완료 증거는 동작 화면만이 아니다.

- CSR, async string, stream의 HTML과 request waterfall 캡처
- TTFB/FCP/LCP/hydration/first interaction timeline
- server/client bundle에서 secret import가 분리된 증거
- mutation 뒤 cache invalidation과 stale window test
- 인증 없는 direct request가 server에서 거부되는 test
- stream 중 data/error/redirect failure mode 기록

## 더 깊이: 동형은 동일 실행이 아니라 동일 계약이다

server와 client가 같은 source file을 import한다고 모든 code가 양쪽에서 같은 방식으로 실행되어야 하는 것은 아니다. server는 request, secret, database, response stream을 소유하고 client는 DOM, event, browser storage를 소유한다. 동형 설계의 핵심은 양쪽이 같은 route와 UI contract를 공유하면서 환경별 capability를 명시적 boundary로 나누는 것이다.

좋은 boundary는 실행 위치를 code review에서 볼 수 있고, bundler가 잘못된 import를 차단하며, test가 client에서 secret module이 reachable하지 않음을 검증한다.

## 정리

- sync string, async string, stream은 async dependency를 기다리는 범위와 response 시작 시점이 다르다.
- hydration은 server DOM을 marker로 재사용해 reactivity와 event를 연결하며 initial output이 결정적이어야 한다.
- Router는 URL·layout 수명·preload·query·action을 연결하지만 cache·authorization policy까지 자동 결정하지 않는다.
- SolidStart의 server function, API route, middleware, session은 request scope와 trust boundary를 명시하는 도구다.
- full-stack 완료는 화면 동작뿐 아니라 streaming timeline, cache consistency, secret 분리, authorization과 failure recovery 증거로 검증한다.

## 확인 문제

1. `renderToStream`을 적용했지만 browser가 모든 data가 끝난 뒤 한 번에 HTML을 받는다. 어디를 조사해야 하는가?

   <details>
   <summary>정답과 해설</summary>

   application의 shell flush 시점뿐 아니라 compression middleware, reverse proxy, CDN, hosting adapter가 response를 buffer하는지 확인한다. server write timestamp와 browser가 chunk를 관찰한 timestamp를 비교한다. Suspense boundary가 shell을 실제로 분리하는지, data fetch가 render 전에 직렬로 완료되는지도 본다.

   </details>

2. SSR page에서 server와 client가 각각 `Math.random()`으로 element id를 만들었다. 어떤 실패가 생기며 어떻게 고치는가?

   <details>
   <summary>정답과 해설</summary>

   initial DOM과 client JSX가 달라 hydration marker lookup과 attribute 연결이 어긋날 수 있다. request에서 한 값을 생성해 HTML/data에 serialize하고 client 첫 실행도 같은 값을 사용한다. hydration 뒤에만 필요한 값이라면 `onMount`에서 만든다. 접근성 id라면 framework의 deterministic id primitive도 target version에서 검토한다.

   </details>

3. action form의 hidden `userId`를 이용해 update authorization을 검사했다. 왜 안전하지 않은가?

   <details>
   <summary>정답과 해설</summary>

   hidden input은 client가 자유롭게 바꿀 수 있는 요청 data다. server action에서 session으로 actor identity를 얻고 target resource에 대한 권한을 다시 검사해야 한다. form field는 요청한 대상일 뿐 인증 증거가 아니다. validation, CSRF와 audit도 server boundary에서 수행한다.

   </details>

4. Router query, HTTP cache, database cache를 모두 “cache”라고 부르며 mutation 뒤 전부 refetch하면 된다고 했다. 어떤 구분이 필요한가?

   <details>
   <summary>정답과 해설</summary>

   각 cache의 위치, key, lifetime, tenant scope, freshness, invalidation authority를 구분해야 한다. Router query revalidation은 CDN object나 database query cache를 자동 무효화하지 않는다. mutation이 어느 authoritative data를 바꾸고 어떤 projection/cache key가 영향받는지 계층별로 기록한다.

   </details>

## 참고 자료

- [Solid 공식 API — `renderToString`](https://docs.solidjs.com/reference/rendering/render-to-string) / [`renderToStringAsync`](https://docs.solidjs.com/reference/rendering/render-to-string-async) / [`renderToStream`](https://docs.solidjs.com/reference/rendering/render-to-stream) — 세 server renderer의 async·streaming 계약을 비교한다.
- [Solid 공식 API — `hydrate`](https://docs.solidjs.com/reference/rendering/hydrate) — hydration marker, `renderId`, owner와 disposer의 현재 계약을 확인한다.
- [Solid Router 공식 문서 — Component routing](https://docs.solidjs.com/solid-router/getting-started/component) / [Navigation](https://docs.solidjs.com/solid-router/concepts/navigation) / [Layouts](https://docs.solidjs.com/solid-router/concepts/layouts) — route matching, layout, link와 navigation model을 확인한다.
- [Solid Router 공식 문서 — Queries](https://docs.solidjs.com/solid-router/data-fetching/queries) / [Preload data](https://docs.solidjs.com/solid-router/data-fetching/how-to/preload-data) — query key·deduplication과 preload timing을 확인한다.
- [Solid Router 공식 문서 — Actions](https://docs.solidjs.com/solid-router/concepts/actions) / [`useSubmission`](https://docs.solidjs.com/solid-router/reference/data-apis/use-submission) — mutation, form, pending, revalidation 계약을 확인한다.
- [SolidStart 공식 문서 — Overview](https://docs.solidjs.com/solid-start) / [Routing](https://docs.solidjs.com/solid-start/building-your-application/routing) — rendering mode와 file-based UI/API route를 확인한다.
- [SolidStart 공식 문서 — Data fetching](https://docs.solidjs.com/solid-start/guides/data-fetching) / [`"use server"`](https://docs.solidjs.com/solid-start/reference/server/use-server) — query/action과 server function transform을 확인한다.
- [SolidStart 공식 문서 — API routes](https://docs.solidjs.com/solid-start/building-your-application/api-routes) / [Middleware](https://docs.solidjs.com/solid-start/advanced/middleware) / [Sessions](https://docs.solidjs.com/solid-start/advanced/session) — request·response·session scope를 확인한다.
- [SolidStart 공식 문서 — Route prerendering](https://docs.solidjs.com/solid-start/building-your-application/route-prerendering) / [Auth](https://docs.solidjs.com/solid-start/advanced/auth) — SSG와 protected route의 version-sensitive 동작을 확인한다.
