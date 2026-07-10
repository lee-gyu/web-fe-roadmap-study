# C-6. 비동기 UI와 상호작용 — 데이터·코드·이벤트의 도착 순서를 조정한다

> 한 줄 요약: async UI는 Promise 하나를 표시하는 문제가 아니라 request identity, pending·error·stale 상태, reveal order, code loading과 사용자 입력의 우선순위를 일관된 경계로 조정하는 문제다.

> 집필 기준: `solid-js` 1.9.14. `<SuspenseList>`는 현재 공식 문서에서도 experimental이다. JSX 없는 runtime 대안은 compiler를 사용할 수 없는 환경의 선택형 심화로만 다룬다.

## 학습 목표

- async request를 명시적 상태 machine으로 모델링하고 race·cancellation·stale response를 처리할 수 있다.
- `createResource`의 source·fetcher·상태·action을 reactive graph와 연결해 설명할 수 있다.
- Suspense, ErrorBoundary, transition, SuspenseList의 책임을 분리해 boundary를 설계할 수 있다.
- dynamic import와 `lazy`가 만드는 code waterfall을 측정하고 split/preload 경계를 조정할 수 있다.
- delegated/native event와 `Dynamic`, JSX 없는 runtime 경로의 비용과 제약을 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

동기 state는 setter가 반환될 때 새 값을 읽을 수 있다. network와 dynamic import는 시작과 완료 사이에 시간이 있고 다음 결과가 가능하다.

```text
idle → pending → success
             └→ error

pending(A) → pending(B) → B success → A late success
```

마지막 줄이 핵심이다. 사용자는 A 요청이 끝나기 전에 B를 선택할 수 있고, A가 늦게 도착해 최신 화면을 덮을 수 있다. loading boolean과 data 두 변수만으로는 어느 요청의 loading인지, 기존 data를 유지할지, retry가 무엇을 재실행하는지 표현하기 어렵다.

Solid의 resource와 Suspense는 async 상태를 reactive graph와 rendering boundary에 통합한다. 그러나 timeout, cancellation, cache freshness, authorization과 mutation consistency를 모두 자동으로 해결하는 data platform은 아니다. abstraction의 책임 범위를 정확히 나눈다.

## 핵심 개념

### 먼저 수동 상태 machine으로 문제를 드러낸다

```tsx
import { createSignal, onCleanup } from "solid-js";

// 아래 코드는 component 또는 createRoot가 만든 owner 안에서 실행하는 예제다.

type AsyncState<T> =
  | { status: "idle" }
  | { status: "pending"; requestId: number; previous?: T }
  | { status: "success"; data: T }
  | { status: "error"; error: Error; previous?: T };

const [state, setState] = createSignal<AsyncState<User>>({ status: "idle" });
let sequence = 0;
let controller: AbortController | undefined;

async function loadUser(id: string) {
  controller?.abort();
  controller = new AbortController();
  const requestId = ++sequence;
  const current = state();
  const previous = current.status === "success" ? current.data : undefined;

  setState({ status: "pending", requestId, previous });

  try {
    const response = await fetch(`/api/users/${id}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as User;
    if (requestId !== sequence) return;
    setState({ status: "success", data });
  } catch (error) {
    if (requestId !== sequence) return;
    if (error instanceof DOMException && error.name === "AbortError") return;
    setState({
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      previous,
    });
  }
}

onCleanup(() => controller?.abort());
```

이 예제는 async UI가 최소한 다음 정책을 요구한다는 사실을 보여 준다.

- HTTP error와 network rejection을 구분해 정상 처리한다.
- request identity로 늦은 결과를 무시한다.
- `AbortController`로 더는 필요 없는 network work를 취소한다.
- pending/error 때 이전 data를 유지할지 명시한다.
- owner가 dispose될 때 request를 중단한다.

`createResource`는 이 boilerplate의 상당 부분을 줄이지만 product별 stale·retry·cache policy는 여전히 설계해야 한다.

### fetch-on-mount는 waterfall을 만들기 쉽다

```text
HTML → client JS download → component mount → fetch data → render content
```

component가 mount된 뒤에야 fetch를 시작하면 code와 data가 직렬화된다. route match, user intent, server render 단계에서 fetcher를 먼저 시작하면 code와 data를 병렬화할 수 있다.

```text
route intent ─┬→ code import
              └→ data query
                   ↓
              component consumes both
```

Solid Router의 preload와 query는 [C-7](./07-ssr-router-and-solidstart.md)에서 다룬다. 여기서는 fetching을 component rendering에서 분리할 수 있다는 원칙을 세운다.

### `createResource`는 source와 async state를 연결한다

```tsx
import { createResource, createSignal } from "solid-js";

const [userId, setUserId] = createSignal("u-1");

const fetchUser = async (id: string) => {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as User;
};

const [user, { mutate, refetch }] = createResource(userId, fetchUser);
```

source accessor가 `undefined`, `null`, `false`를 반환하면 fetcher를 시작하지 않는다. 유효한 source가 바뀌면 새 fetch를 시작한다. source가 없는 overload에서는 fetcher가 `true`를 첫 인자로 받는 형태와 fetcher-only shorthand를 사용할 수 있다.

resource accessor에는 data 읽기와 함께 상태 정보가 있다.

```tsx
user();          // T | undefined, reactive read
user.loading;    // boolean
user.error;      // latest error
user.state;      // unresolved | pending | ready | refreshing | errored
user.latest;     // Suspense를 trigger하지 않고 latest resolved value 확인
```

정확한 property와 state union은 기준 버전의 type을 확인한다. `loading` 하나보다 `pending`과 `refreshing`을 구분하면 최초 skeleton과 기존 data 위의 background indicator를 다르게 설계할 수 있다.

fetcher는 이전 value와 refetch info를 받을 수 있다.

```tsx
const [user, actions] = createResource(
  userId,
  async (id, info) => {
    console.log("previous", info.value);
    console.log("refetch reason", info.refetching);
    return fetchUser(id);
  },
);
```

`refetch(reason)`의 reason을 fetcher가 관찰할 수 있지만 API contract를 임의 event bus처럼 키우지 않는다.

### `mutate`와 `refetch`의 의미를 분리한다

```tsx
mutate((previous) =>
  previous ? { ...previous, displayName: "Grace" } : previous,
);

await refetch("profile-saved");
```

`mutate`는 local resource value를 즉시 바꾼다. server에 write하지 않으며 rollback도 자동으로 제공하지 않는다. optimistic update에 사용한다면 다음을 함께 설계한다.

- server mutation 실패 시 rollback snapshot
- concurrent mutation 순서와 last-write policy
- 다른 cache key와 화면의 invalidation
- server canonical response와 local patch의 merge

`refetch`는 현재 source로 fetcher를 다시 실행한다. mutation 성공 후 canonical data를 재검증하는 데 쓸 수 있지만 전체 application cache invalidation system은 아니다.

### Suspense는 pending resource의 표시 경계다

```tsx
import { ErrorBoundary, Suspense } from "solid-js";

<ErrorBoundary fallback={(error) => <ErrorPanel error={error} />}>
  <Suspense fallback={<ProfileSkeleton />}>
    <Profile user={user()} />
  </Suspense>
</ErrorBoundary>
```

Suspense 아래에서 실제로 읽힌 pending resource가 boundary를 활성화한다. 만들어졌지만 읽히지 않은 resource는 해당 boundary를 suspend하지 않는다. nearest nested boundary가 자신의 async dependency를 담당한다.

Solid의 Suspense는 child owner를 만들 수 있는 non-blocking boundary다. fallback이 보이는 동안 subtree 작업이 존재할 수 있으며, suspended subtree의 `onMount`와 `createEffect`는 boundary가 resolve된 뒤 실행된다.

Suspense와 ErrorBoundary의 책임은 다르다.

| boundary | 처리하는 상태 | UI 질문 |
|---|---|---|
| Suspense | 아직 준비되지 않음 | 무엇을 대신 보여 줄까 |
| ErrorBoundary | reactive rendering/update 실패 | 어디까지 격리하고 어떻게 복구할까 |
| transition | 기존 UI를 잠시 유지 | 급격한 fallback 전환을 피할 가치가 있는가 |

한 page 전체를 Suspense 하나로 감싸면 작은 widget 지연에도 전체 shell이 fallback으로 바뀐다. 너무 작은 boundary는 spinner가 난립하고 reveal order가 불안정해진다. 사용자가 독립적으로 이해할 수 있는 content unit을 기준으로 둔다.

### transition은 이전 일관된 UI를 유지한다

```tsx
import { createResource, createSignal, Suspense, useTransition } from "solid-js";

const [page, setPage] = createSignal(1);
const [posts] = createResource(page, fetchPosts);
const [pending, start] = useTransition();

async function nextPage() {
  await start(() => setPage((current) => current + 1));
}

return (
  <>
    <button disabled={pending()} onClick={nextPage}>Next</button>
    <Suspense fallback={<p>Initial loading...</p>}>
      <PostList posts={posts()} stale={pending()} />
    </Suspense>
  </>
);
```

transition 안의 source update가 새 async dependency를 만들면 새 content가 준비될 때까지 이전 committed UI를 유지할 수 있다. pending accessor는 진행 indicator와 중복 navigation 제어에 쓴다.

모든 loading에 transition을 쓰지 않는다. 사용자가 account를 바꿨는데 이전 사용자의 민감 data를 계속 보여 주면 일관성보다 보안·오해 위험이 크다. pagination, tab detail처럼 이전 content가 명확한 stale state로 유용할 때 적합하다.

`startTransition`은 pending accessor가 필요 없는 동일한 시작 함수이며 client에서 microtask를 통해 비동기 실행된다. server에서는 callback을 동기 실행한다. 이 차이에 business correctness를 의존하지 않는다.

### SuspenseList는 reveal order만 조정한다

```tsx
import { Suspense, SuspenseList } from "solid-js";

<SuspenseList revealOrder="forwards" tail="collapsed">
  <Suspense fallback={<HeaderSkeleton />}><Header /></Suspense>
  <Suspense fallback={<BodySkeleton />}><Body /></Suspense>
</SuspenseList>
```

- `forwards`: 앞 boundary부터 공개한다.
- `backwards`: 뒤 boundary부터 공개한다.
- `together`: 모두 준비된 뒤 함께 공개한다.
- `tail="collapsed" | "hidden"`: ordered reveal에서 뒤 fallback 노출을 조절한다.

SuspenseList 자체가 data를 fetch하거나 suspend하지 않는다. child boundary의 reveal만 조정한다. 현재 공식 문서는 이 component를 experimental로 표시한다. 원본 v1.8도 SSR 지원 제한을 경고한다. production 도입 전 target version, server renderer, nested boundary와 streaming 조합을 실제로 검증하고 fallback으로 독립 Suspense를 유지한다.

### `lazy`는 component code를 async dependency로 만든다

```tsx
import { lazy, Suspense } from "solid-js";

const SettingsPanel = lazy(() => import("./SettingsPanel"));

<Suspense fallback={<p>Loading settings code...</p>}>
  <SettingsPanel />
</Suspense>
```

dynamic import는 bundler가 별도 chunk를 만들 수 있는 경계다. `lazy`는 module의 default export component를 resolve하고 Suspense에 loading을 노출한다. named export만 있다면 import Promise에서 명시적으로 default 모양을 반환할 수 있지만 module API를 default component로 정리하는 편이 단순하다.

route/component preload가 제공되더라도 무조건 호출하지 않는다. preload는 latency를 줄이는 대신 사용하지 않을 code와 data를 전송할 수 있다.

code split 검증은 다음 waterfall을 본다.

```text
bad:  click → route chunk → component render → nested chunk → data fetch
good: intent ─┬→ route/nested chunks
              └→ data query
```

작은 component마다 chunk를 나누면 request·compression·module evaluation overhead가 늘고 cache invalidation 단위가 지나치게 잘게 쪼개진다. route, 권한, 낮은 사용 빈도, 무거운 dependency를 경계 후보로 삼는다.

### event delegation과 native listener를 구분한다

```tsx
function Button() {
  const handleClick = (event: MouseEvent) => {
    console.log(event.currentTarget);
  };

  return <button onClick={handleClick}>Save</button>;
}
```

Solid는 `onClick` 같은 지원 event를 delegation할 수 있다. 각 element에 listener를 모두 붙이는 대신 공통 handler가 event path에서 등록된 callback을 찾는다. 많은 반복 item에서 listener 수를 줄일 수 있지만, delegation root·propagation·non-bubbling event의 의미를 이해해야 한다.

`on:` namespace는 native listener를 element에 직접 붙인다.

```tsx
<div on:scroll={handleScroll} />
```

| 방식 | 연결 | 적합한 조건 |
|---|---|---|
| `onClick`/`onInput` | Solid가 지원하는 event의 delegation 가능 | 일반 UI event |
| `on:scroll` 등 | native `addEventListener`에 가까운 직접 연결 | delegation 대상이 아니거나 정확한 element listener 필요 |
| ref/directive | imperative registration과 cleanup 직접 소유 | option, third-party event, reusable DOM behavior |

React synthetic event를 기준으로 추론하지 않는다. Solid handler가 받는 것은 browser native event이며 `input`과 `change`, bubbling, composed path는 웹 플랫폼 의미를 따른다.

handler에 data를 closure 없이 전달하는 tuple form도 있다.

```tsx
function select(id: string, event: MouseEvent) {
  console.log(id, event.currentTarget);
}

<button onClick={[select, row.id]}>Select</button>
```

최적화로 사용하기 전에 readability와 current type contract를 확인한다. closure allocation이 실제 병목인지 profile하지 않고 모든 handler를 tuple로 바꿀 필요는 없다.

### event handler는 추적 scope가 아니다

handler에서 accessor를 읽는 것은 click 시점의 최신 값을 얻기 위한 snapshot이며 handler 자체를 subscriber로 만들지 않는다.

```tsx
<button onClick={() => save(draft())}>Save current draft</button>
```

이는 바람직하다. 사용자 event가 발생할 때 최신 값을 읽어 command를 실행한다. handler 안의 exception은 [ErrorBoundary](./04-reactive-runtime.md)가 자동 포착하지 않으므로 expected failure를 result/error state로 처리한다.

### `<Dynamic>`은 렌더링 type을 값으로 선택한다

```tsx
import { Dynamic } from "solid-js/web";

const registry = {
  text: TextField,
  number: NumberField,
  date: DateField,
} satisfies Record<FieldSchema["type"], Component<FieldProps>>;

<Dynamic component={registry[field.type]} field={field} />;
```

조건부 rendering이 같은 component type의 content를 바꾸는 것이라면 Dynamic은 element/component type 자체를 reactive value로 선택한다. schema-driven form, CMS block, plugin renderer에 적합하다.

registry key가 untrusted input이면 allowlist validation이 필요하다. 임의 module path를 dynamic import하거나 arbitrary tag/props를 통과시키면 bundle exposure, XSS, capability escalation 문제가 생길 수 있다.

### JSX 없는 Solid는 compiler tradeoff를 드러낸다

Solid core reactivity는 JSX에 종속되지 않는다. compiler를 쓸 수 없는 환경에는 두 runtime 경로가 있다.

```ts
import html from "solid-js/html";

const view = html`<button>Count: ${count}</button>`;
```

```ts
import { h } from "solid-js/h";

const view = h("button", {}, "Count: ", count);
```

정확한 import와 표현식 wrapping 규칙은 기준 버전 공식 API를 확인한다. 표준 JSX와 비교한 비용은 다음과 같다.

- runtime parser/helper와 더 큰 output
- 정적 template 최적화 감소
- reactive expression을 함수로 보존해야 하는 추가 규칙
- props/ref 처리와 tooling 생태계 차이
- 원본 범위에서 명시된 SSR 미지원

일반 application에서 build step을 없애기 위한 기본값이 아니다. embedded script, 제한된 sandbox, library 실험처럼 compiler를 사용할 수 없는 constraint가 실제로 있을 때 선택한다.

## 실무 관점

### loading UI를 상태별로 나눈다

| 상태 | 기본 UI | 피해야 할 표현 |
|---|---|---|
| 최초 pending | skeleton 또는 구조를 설명하는 fallback | 빈 화면, layout shift 큰 spinner |
| refreshing | 기존 data + 작은 진행 표시 | 전체 page fallback으로 회귀 |
| error + previous | stale 표시 + retry | 오래된 값을 최신처럼 표시 |
| error without data | 복구 행동과 오류 범위 | 무한 자동 retry |
| transition pending | 기존 UI + stale/disabled hint | 입력이 먹히지 않는 것처럼 보이는 침묵 |

### async race의 네 층을 분리한다

1. transport cancellation: `AbortController`로 network work를 줄인다.
2. result ordering: 최신 request identity만 commit한다.
3. cache identity: source/query key가 같은 결과를 공유한다.
4. UI reveal: Suspense/transition이 무엇을 언제 보여 줄지 정한다.

한 층의 해결을 다른 층으로 과장하지 않는다. transition은 request를 취소하지 않고, abort는 cache invalidation을 하지 않는다.

### 관찰 절차

1. DevTools Network에서 request start/end와 initiator를 기록한다.
2. 빠르게 source를 바꿔 stale response가 UI에 commit되는지 확인한다.
3. CPU/network throttling에서 fallback과 previous UI의 전환을 녹화한다.
4. Coverage/Network에서 lazy chunk의 실제 크기와 사용률을 본다.
5. Performance에서 click부터 handler, signal write, DOM update, paint까지 trace한다.
6. SSR을 쓴다면 first byte, shell, async chunk, hydration, first interaction을 별도 timestamp로 남긴다.

## 더 깊이: async abstraction은 시간 축을 graph에 추가한다

signal graph는 현재 값의 dependency를 표현한다. resource는 여기에 unresolved/pending/ready 같은 시간 상태와 request identity를 붙인다. Suspense는 여러 resource의 준비 상태를 UI subtree와 연결하고 transition은 committed graph와 pending graph 사이의 공개 시점을 조정한다.

따라서 async UI를 “Promise를 signal에 넣기”로 축소하면 중요한 정보가 사라진다. Promise 자체는 현재 data, 이전 data, refetch reason, cancellation, owner disposal, error recovery를 표현하지 않는다.

## 정리

- async UI는 request identity, cancellation, stale data, error와 reveal policy를 함께 설계해야 한다.
- `createResource`는 source 변화와 async state를 reactive graph에 통합하고 `mutate`·`refetch`를 제공하지만 application cache 전체를 대신하지 않는다.
- Suspense는 pending 표시, ErrorBoundary는 실패 격리, transition은 이전 UI 보존, SuspenseList는 reveal order를 담당한다.
- `lazy`와 route preload는 code/data waterfall을 줄일 수 있지만 과분할·과도한 preload 비용을 측정해야 한다.
- event, Dynamic, JSX 없는 경로도 browser semantics, allowlist, compiler/SSR 경계를 명시해야 한다.

## 확인 문제

1. source를 A에서 B로 바꿨는데 A의 늦은 response가 B 화면을 덮었다. transition을 추가하면 해결되는가?

   <details>
   <summary>정답과 해설</summary>

   아니다. transition은 UI 공개 시점을 조정할 뿐 request ordering을 보장하지 않는다. transport를 abort하고, request identity 또는 resource/query abstraction이 최신 결과만 commit하게 해야 한다. cache key도 A와 B를 구분해야 한다.

   </details>

2. 최초 loading과 refetching에 같은 full-page skeleton을 사용했더니 pagination UX가 불안정하다. 어떤 상태 분리가 필요한가?

   <details>
   <summary>정답과 해설</summary>

   data가 없는 최초 pending과 이전 data가 있는 refreshing/transition pending을 구분한다. 최초에는 skeleton이 적합하지만 pagination에는 기존 목록을 유지하고 stale/progress 표시와 중복 action 제어를 제공하는 편이 일관적이다. 민감 data 전환처럼 이전 내용을 유지하면 안 되는 예외도 명시한다.

   </details>

3. 모든 component를 `lazy`로 바꾸면 초기 bundle이 최소가 되므로 항상 유리하다는 주장을 반박하라.

   <details>
   <summary>정답과 해설</summary>

   작은 chunk가 많아지면 request scheduling, header/compression, module parse/evaluation, nested waterfall, cache invalidation overhead가 늘어난다. 실제 사용자 경로에서 initial transferred bytes뿐 아니라 click-to-content, request 수, unused preload와 long task를 함께 측정해야 한다. route·권한·낮은 빈도·무거운 dependency가 의미 있는 split 경계다.

   </details>

4. Portal 내부 button의 event가 native DOM parent가 아니라 원래 component hierarchy의 handler와 상호작용한다. 왜 가능한가?

   <details>
   <summary>정답과 해설</summary>

   Solid Portal은 DOM insertion 위치만 바꾸고 owner/component hierarchy를 보존하며, 일반 target에서는 wrapper를 이용해 event propagation을 component hierarchy에 맞게 연결한다. browser의 native propagation path와 framework가 등록한 delegated handler 경로를 구분해 관찰해야 한다.

   </details>

## 참고 자료

- [Solid 공식 API — `createResource`](https://docs.solidjs.com/reference/basic-reactivity/create-resource) — source, fetcher info, resource state와 `mutate`·`refetch`의 현재 계약을 확인한다.
- [Solid 공식 API — `Suspense`](https://docs.solidjs.com/reference/components/suspense) / [`SuspenseList`](https://docs.solidjs.com/reference/components/suspense-list) — pending dependency, nested boundary, experimental reveal coordination을 확인한다.
- [Solid 공식 API — `startTransition`](https://docs.solidjs.com/reference/reactive-utilities/start-transition) / [`useTransition`](https://docs.solidjs.com/reference/reactive-utilities/use-transition) — client/server 실행과 pending accessor 계약을 확인한다.
- [Solid 공식 API — `lazy`](https://docs.solidjs.com/reference/component-apis/lazy) — dynamic import, default export와 preload의 현재 동작을 확인한다.
- [Solid 공식 문서 — Event handlers](https://docs.solidjs.com/concepts/components/event-handlers) — delegated event, native event와 handler binding을 확인한다.
- [Solid 공식 문서 — Dynamic](https://docs.solidjs.com/concepts/control-flow/dynamic) — runtime component/element type 선택을 확인한다.
- [Solid 공식 repository — html package](https://github.com/solidjs/solid/tree/main/packages/solid/html) / [h package](https://github.com/solidjs/solid/tree/main/packages/solid/h) — JSX 없는 runtime 경로의 현재 구현과 README를 확인한다.
