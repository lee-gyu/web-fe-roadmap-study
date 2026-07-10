# C-4. 반응성 런타임 — 실행 시점, owner, 오류 경계를 설계한다

> 한 줄 요약: Solid의 computation은 모두 같은 dependency graph를 사용하지만 실행 시점과 반환 계약이 다르고, owner tree는 Context·cleanup·오류 전파의 수명을 별도로 관리한다.

> 집필 기준: `solid-js` 1.9.14. 저수준 primitive는 library author와 진단 목적을 중심으로 다루며 일반 application의 기본값으로 권장하지 않는다.

## 학습 목표

- computation primitive를 실행 시점·값 반환·주 용도로 비교해 선택할 수 있다.
- `ErrorBoundary`와 `catchError`의 포착 범위 및 복구 단위를 설계할 수 있다.
- dependency graph와 owner tree를 구분하고 `getOwner`·`runWithOwner`·`createRoot`의 책임을 설명할 수 있다.
- `await` 이후 tracking·owner 문맥이 사라지는 이유와 안전한 대안을 제시할 수 있다.
- 선언형 styling, props utility, external observable interop의 경계 조건을 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

[C-2](./02-fine-grained-reactivity.md)의 reactive core는 “무엇이 무엇을 읽었는가”만 표현했다. 실제 UI runtime에는 세 가지 추가 문제가 있다.

첫째, 모든 computation을 같은 시점에 실행할 수 없다. DOM을 만들기 전에 필요한 계산, DOM insertion과 함께 수행할 계산, render가 끝난 뒤 외부 시스템과 동기화할 effect가 구분되어야 한다.

둘째, dependency가 사라졌다고 resource가 자동으로 정리되는 것은 아니다. 조건 branch가 닫히거나 component가 unmount될 때 nested effect, Context, event listener를 함께 dispose할 수명 구조가 필요하다.

셋째, computation 하나의 실패가 application 전체를 무너뜨리지 않도록 복구 가능한 UI 경계를 만들어야 한다.

Solid runtime은 dependency graph와 owner tree, scheduler, error handler를 결합해 이 문제를 푼다.

## 핵심 개념

### computation을 “effect 종류”로 뭉뚱그리지 않는다

| primitive | 최초 실행 | 반환 값 | 주 용도 | 기본 사용 빈도 |
|---|---|---|---|---|
| `createComputed` | 즉시 | 없음 | 다른 reactive 값을 쓰는 저수준 computation | 낮음 |
| `createRenderEffect` | 즉시 | previous 전달 | DOM render 과정과 동기화하는 저수준 effect | library 내부 |
| `createEffect` | 현재 render phase 뒤 | previous 전달 | 외부 시스템과의 side effect | 높음 |
| `createMemo` | reactive 계산으로 평가 | read-only accessor | 파생 값 cache와 propagation boundary | 높음 |
| `createDeferred` | source의 현재 값으로 시작 | 지연 accessor | 비긴급 propagation을 scheduler로 미룸 | 선택적 |
| `createReaction` | tracking 함수 호출 시 dependency 수집 | tracking 함수 | 추적과 다음 변경 반응을 분리 | 낮음 |

정확한 scheduler 세부 순서에 application correctness를 의존하지 않는다. 공개 계약이 제공하는 상대적 시점과 owner 수명만 사용한다.

### `createComputed`는 쓰기 가능한 저수준 computation이다

```tsx
import { createComputed, createSignal } from "solid-js";

const [source, setSource] = createSignal(1);
const [normalized, setNormalized] = createSignal(0);

createComputed(() => {
  setNormalized(Math.max(0, source()));
});
```

`createComputed`는 즉시 실행되며 dependency 변화에 반응한다. signal write를 허용하기 때문에 graph 안에서 추가 update를 만들 수 있다. 일반 파생 값이라면 `createMemo`가 더 명확하다. library가 reactive source를 다른 primitive로 bridge하거나 실행 순서를 정확히 이해하고 있을 때만 검토한다.

### `createRenderEffect`와 `createEffect`는 DOM 기준 시점이 다르다

`createRenderEffect`는 생성 시 즉시 실행된다. renderer가 DOM property를 설정하는 것처럼 render 과정과 같은 시점이 필요한 저수준 작업에 쓰인다. `createEffect`의 최초 실행은 현재 rendering이 끝난 뒤 예약되므로 이미 만들어진 DOM과 외부 API를 동기화하기에 적합하다.

```tsx
import { createEffect, createRenderEffect } from "solid-js";

createRenderEffect(() => {
  console.log("render-sensitive", value());
});

createEffect(() => {
  console.log("post-render side effect", value());
});
```

두 callback의 상대 순서를 business rule로 사용하면 안 된다. 값 A가 계산된 뒤 값 B를 보장해야 한다면 memo와 명시적 data dependency로 표현한다. effect 순서를 암묵적 orchestration으로 쓰면 refactoring과 batching에서 깨진다.

### previous 값은 cleanup이 아니다

`createEffect`와 `createRenderEffect` callback의 return은 다음 실행의 인자로 전달된다.

```tsx
createEffect((previous: number | undefined) => {
  const current = count();
  console.log({ previous, current });
  return current;
});
```

React effect와 달리 반환 함수가 cleanup으로 해석되지 않는다. 다음 코드는 의도대로 해제되지 않는다.

```tsx
// 잘못된 가정
createEffect(() => {
  const unsubscribe = subscribe(topic());
  return unsubscribe;
});
```

`onCleanup`으로 현재 owner/computation에 명시적으로 등록한다.

```tsx
createEffect(() => {
  const unsubscribe = subscribe(topic());
  onCleanup(unsubscribe);
});
```

### `createDeferred`는 debounce가 아니다

```tsx
import { createDeferred, createSignal } from "solid-js";

const [query, setQuery] = createSignal("");
const deferredQuery = createDeferred(query, { timeoutMs: 200 });
```

`deferredQuery()`는 처음에는 source의 현재 값을 반영하고 이후 update propagation을 scheduler 뒤로 미룰 수 있다. source write 자체를 합치거나 network 요청 횟수를 보장하는 debounce가 아니다. 모든 중간 query에 network request를 만들지 않으려면 timer/abort/cache 정책을 별도로 설계해야 한다.

서버에서는 공식 API 계약상 source accessor를 그대로 반환한다. 서버에서 “200ms 뒤의 값” 같은 client scheduling 의미를 기대하면 안 된다.

### `createReaction`은 dependency 수집과 반응을 분리한다

```tsx
import { createReaction } from "solid-js";

const track = createReaction(() => {
  console.log("tracked value changed");
});

track(() => selectedId());
```

tracking 함수는 callback 안에서 읽은 dependency를 수집한다. effect 함수는 tracking 시점에 즉시 실행되는 것이 아니라 그 dependency의 다음 변경에 반응한다. 반응 뒤 다시 추적하려면 명시적으로 tracking 함수를 호출해야 하는 one-shot 성격을 이해해야 한다.

일반 application에서 “특정 값이 바뀌면 실행”은 `createEffect(on(...))`이 더 읽기 쉽다. `createReaction`은 tracking 시점과 effect 시점을 분리해야 하는 library interop에 적합하다.

### dependency graph와 owner tree는 서로 다른 질문에 답한다

```text
dependency graph: 누가 누구의 값을 읽었는가?
price ──> totalMemo ──> textUpdate

owner tree: 누가 누구의 수명과 Context를 소유하는가?
AppOwner
└─ RouteOwner
   ├─ Context value
   └─ EffectOwner
      └─ cleanup
```

dependency edge는 값 전파를 결정한다. owner edge는 disposal, Context lookup, error handler를 결정한다. 한 computation은 owner의 child이면서 여러 signal의 subscriber일 수 있다.

parent owner가 refresh 또는 dispose되면 child computation과 cleanup도 정리된다. 이 구조 덕분에 `<Show>` branch가 사라질 때 branch 안의 listener와 effect가 함께 사라진다.

### `createRoot`는 수동 수명 경계를 만든다

component 밖에서 오래 사는 reactive graph를 만들 때 `createRoot`를 사용할 수 있다.

```tsx
import {
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
} from "solid-js";

const dispose = createRoot((dispose) => {
  const [connected, setConnected] = createSignal(false);

  createEffect(() => console.log("connected", connected()));
  const uninstall = installConnection(setConnected);
  onCleanup(uninstall);

  return dispose;
});

// 더는 필요 없을 때
dispose();
```

root를 만들었으면 disposer를 누가 언제 호출하는지 API contract에 포함한다. global singleton root는 application 종료까지 살아도 되는 state에만 사용한다. request별 state를 module root에 만들면 SSR 사용자 사이에 값이 섞일 수 있다.

### `getOwner`와 `runWithOwner`는 ownership을 복원한다

```tsx
import { getOwner, runWithOwner } from "solid-js";

function Component() {
  const owner = getOwner();

  queueMicrotask(() => {
    if (!owner) return;

    runWithOwner(owner, () => {
      // 여기서 생성한 cleanup/context consumer는 owner subtree에 연결된다.
    });
  });

  return null;
}
```

`getOwner`는 현재 owner를 반환할 뿐 새 owner를 만들지 않는다. `runWithOwner`는 callback을 해당 owner 문맥에서 실행해 Context lookup과 cleanup ownership을 복원한다.

중요한 제한은 `runWithOwner`가 과거의 dependency listener까지 복원하지 않는다는 점이다. ownership과 tracking은 별개다. async callback 안에서 signal을 읽었다고 원래 effect의 dependency가 되는 것은 아니다.

### `await`는 동기 문맥을 끊는다

```tsx
createEffect(async () => {
  const id = userId();       // effect dependency
  const user = await fetchUser(id);
  console.log(theme());      // 원래 effect dependency가 아니다.
});
```

`await` 전에는 current listener와 owner가 동기 call stack에 있다. continuation은 이후 microtask에서 실행되므로 그 문맥이 자동 복원되지 않는다.

안전한 선택은 문제에 따라 다르다.

- dependency가 필요한 값은 `await` 전에 읽어 snapshot으로 전달한다.
- async data lifecycle은 `createResource`로 모델링한다.
- Context와 cleanup ownership만 필요하면 owner를 capture하고 `runWithOwner`를 제한적으로 사용한다.
- 이미 dispose된 owner에 뒤늦게 작업을 붙일 위험을 고려하고 cancellation/abort를 함께 설계한다.

owner를 저장해 모든 async callback에 무차별 복원하면 이미 사라진 UI scope에 resource를 만들거나 장기 callback이 owner 전체를 메모리에 붙잡을 수 있다.

### ErrorBoundary는 복구 단위다

```tsx
import { ErrorBoundary } from "solid-js";

<ErrorBoundary
  fallback={(error, reset) => (
    <section role="alert">
      <p>{String(error)}</p>
      <button type="button" onClick={reset}>Retry</button>
    </section>
  )}
>
  <OrderPanel />
</ErrorBoundary>;
```

`ErrorBoundary`는 child JSX rendering과 subtree reactive update에서 발생한 오류를 잡고 fallback을 표시한다. `reset`은 현재 error state를 지우고 child를 다시 만든다. 실패 원인이 그대로라면 즉시 다시 실패하므로 retry 전에 data/cache/input을 복구해야 한다.

포착하지 않는 대표 경로도 중요하다.

- event handler 안에서 직접 throw한 오류
- `setTimeout`, message callback처럼 Solid update flow 밖의 callback 오류
- boundary fallback 자체의 오류(상위 boundary가 필요하다)

network promise rejection도 어디서 reactive flow로 다시 surface되는지에 따라 달라진다. 모든 `window.onerror`를 한 boundary가 처리한다고 가정하지 않는다.

### `catchError`는 UI 없는 저수준 경계다

`catchError`는 owner subtree에서 발생한 오류를 handler로 전달하는 primitive다. custom renderer, library abstraction, logging boundary처럼 JSX fallback보다 낮은 수준의 제어가 필요할 때 사용한다. application page에는 `ErrorBoundary`가 복구 UI와 scope를 함께 보여 주므로 더 적합하다.

오류를 catch하고 로그만 남긴 뒤 정상 값처럼 계속 진행하면 corrupted state를 숨길 수 있다. handler는 실패를 대체 값으로 복구할지, 상위로 다시 throw할지, subtree를 dispose할지를 명확히 해야 한다.

### style과 class도 reactive DOM consumer다

```tsx
<button
  class="button"
  classList={{
    "button--active": active(),
    "button--danger": props.tone === "danger",
  }}
  style={{
    "--progress": `${progress()}%`,
    opacity: disabled() ? 0.5 : 1,
  }}
>
  Save
</button>
```

`classList` object의 각 조건과 style의 reactive value는 DOM update 지점이 된다. static base class와 conditional class를 분리하면 CSS selector와 tooling이 읽기 쉽다. CSS Modules는 class name scope를 build time에 바꿀 뿐 runtime reactivity 모델은 같다.

imperative style은 animation engine, canvas, 외부 library처럼 DOM을 별도 시스템이 소유할 때 사용한다.

```tsx
let element!: HTMLDivElement;

onMount(() => {
  const animation = element.animate(keyframes, options);
  onCleanup(() => animation.cancel());
});

return <div ref={element} />;
```

같은 property를 JSX reactive style과 외부 animation이 동시에 쓰면 source of truth가 충돌한다. 소유권을 한쪽에 둔다.

### utility를 역할별로 분류한다

| 문제 | utility | 연결 문서 |
|---|---|---|
| 여러 write의 propagation 묶기 | `batch` | [C-2](./02-fine-grained-reactivity.md) |
| dependency 명시·제외 | `on`, `untrack` | [C-2](./02-fine-grained-reactivity.md) |
| 수동 owner root | `createRoot` | 이 문서 |
| reactive props 보존 | `mergeProps`, `splitProps` | [C-3](./03-jsx-and-components.md) |
| list mapping 전략 | `mapArray`, `indexArray` | [C-5](./05-control-flow-and-state.md) |
| Observable interop | `observable`, `from` | 이 문서 |
| async UI transition | `startTransition`, `useTransition` | [C-6](./06-async-ui-and-interactions.md) |

utility 이름을 암기하기보다 어느 graph 경계를 바꾸는지 분류한다.

### Observable interop은 수명과 backpressure를 해결하지 않는다

`observable`은 Solid accessor를 Observable-compatible producer로 노출하고, `from`은 subscribable/producer를 signal-like accessor로 바꾼다. 외부 stream과 reactive graph를 연결하는 adapter다.

adapter가 다음 정책까지 자동으로 결정하지는 않는다.

- producer의 error와 completion을 UI에서 어떻게 표현할지
- 빠른 producer와 느린 consumer 사이의 backpressure
- 재구독 시 replay할 값
- owner dispose 시 unsubscribe
- server render에서 stream을 어떻게 다룰지

interop 도입 전에 외부 library의 subscription contract와 cleanup을 확인한다.

## 실무 관점

### primitive 선택 순서

1. 순수 파생 값이면 일반 함수로 시작한다.
2. 계산 공유·cache·하위 equality boundary가 필요하면 memo를 쓴다.
3. 외부 시스템과 동기화하면 effect와 cleanup을 쓴다.
4. mount된 DOM이 필요하면 `onMount` 또는 ref를 쓴다.
5. render timing 자체를 제어해야 하는 library code에서만 render/computed primitive를 검토한다.

저수준 primitive를 많이 쓴다는 사실이 고급 설계의 증거는 아니다. timing과 owner를 application code가 직접 소유할수록 refactoring 비용과 테스트 surface가 커진다.

### 오류 경계 배치 기준

- 전체 app 하나보다 사용자가 독립적으로 복구할 수 있는 panel/route 단위에 둔다.
- fallback은 오류를 숨기지 말고 retry, navigation, support context를 제공한다.
- 인증 실패, 404, validation error처럼 예상 가능한 domain 결과를 모두 exception으로 만들지 않는다.
- monitoring에는 boundary 위치, route, operation id를 남기되 secret과 개인 데이터는 제외한다.

### owner leak 진단

owner를 capture한 callback, 장기 timer, global event bus가 component closure를 붙잡는지 확인한다. mount/unmount를 반복한 뒤 effect와 listener 수가 기준선으로 돌아오는지 측정한다. cleanup 호출 여부만이 아니라 closure가 GC 가능한지 Memory panel의 retain path를 본다.

## 더 깊이: 오류와 cleanup은 owner를 따라 이동한다

owner는 Context map, cleanup 목록, error handler chain을 가진 scope로 볼 수 있다. child computation이 throw하면 가장 가까운 error handler를 찾고, scope가 dispose되면 등록된 cleanup과 owned child를 정리한다. 실제 내부 object shape는 구현 세부이므로 직접 접근하지 않는다.

이 모델은 DOM tree와 다를 수 있다. Portal의 child는 다른 DOM 위치에 있어도 원래 owner chain의 Context와 error boundary를 따른다. 반대로 imperative DOM insertion만으로는 owner가 생기지 않는다.

## 정리

- computation primitive는 dependency model을 공유하지만 최초 실행 시점, 값 반환, 권장 용도가 다르다.
- dependency graph는 값 전파를, owner tree는 Context·cleanup·오류 전파와 disposal을 결정한다.
- `runWithOwner`는 ownership을 복원하지만 과거 tracking listener를 복원하지 않는다.
- `ErrorBoundary`는 rendering/update flow의 오류를 복구 UI로 바꾸며 event·임의 async callback 오류까지 자동 포착하지 않는다.
- styling과 Observable interop도 reactive graph 밖의 DOM·stream 소유권과 cleanup 정책을 명시해야 한다.

## 확인 문제

1. 두 effect의 선언 순서를 이용해 effect B가 항상 effect A의 write 뒤 실행되도록 만들었다. 왜 취약하며 어떻게 바꿔야 하는가?

   <details>
   <summary>정답과 해설</summary>

   effect 실행 순서는 business data dependency를 표현하는 계약이 아니다. batching, nested owner, scheduler 변화에서 가정이 깨질 수 있다. B가 A의 순수 계산 결과에 의존한다면 memo로 값을 만들고 B가 그 accessor를 읽게 한다. 외부 작업 순서라면 하나의 명시적 command/async flow 안에서 순서를 표현한다.

   </details>

2. `runWithOwner(owner, () => theme())`를 호출하면 원래 effect가 `theme`을 구독하게 되는가?

   <details>
   <summary>정답과 해설</summary>

   아니다. `runWithOwner`는 Context lookup과 cleanup ownership에 필요한 owner를 복원하지만 과거 computation의 tracking listener를 복원하지 않는다. dependency가 필요하면 원래 synchronous tracking scope에서 accessor를 읽어야 한다.

   </details>

3. ErrorBoundary 안의 button handler가 throw했지만 fallback이 나타나지 않았다. 이것이 정상인 이유와 처리 대안을 설명하라.

   <details>
   <summary>정답과 해설</summary>

   event handler는 Solid의 rendering/reactive update flow 밖에서 브라우저가 호출하므로 boundary 포착 범위가 아니다. 예상 가능한 실패는 handler에서 try/catch해 explicit error state나 action result로 바꾼다. 예상하지 못한 오류는 global reporting으로 기록하고 안전한 route reset 또는 사용자 복구 흐름을 제공한다.

   </details>

4. `createDeferred(query)`를 적용했으니 search API가 debounce된다고 주장했다. 무엇을 측정해 반박하거나 확인해야 하는가?

   <details>
   <summary>정답과 해설</summary>

   source write 횟수, deferred accessor update 횟수, 실제 fetch 시작 횟수를 각각 기록한다. `createDeferred`는 propagation을 뒤로 미루지만 모든 source write를 하나로 합치는 debounce 계약이 아니다. 요청 수를 제한하려면 timer, cancellation, cache key와 stale response 정책이 필요하다.

   </details>

## 참고 자료

- [Solid 공식 API — `createEffect`](https://docs.solidjs.com/reference/basic-reactivity/create-effect) / [`createRenderEffect`](https://docs.solidjs.com/reference/secondary-primitives/create-render-effect) / [`createComputed`](https://docs.solidjs.com/reference/secondary-primitives/create-computed) — computation별 실행 계약을 비교한다.
- [Solid 공식 API — `createDeferred`](https://docs.solidjs.com/reference/secondary-primitives/create-deferred) / [`createReaction`](https://docs.solidjs.com/reference/secondary-primitives/create-reaction) — scheduler와 명시적 tracking의 현재 계약을 확인한다.
- [Solid 공식 API — `getOwner`](https://docs.solidjs.com/reference/reactive-utilities/get-owner) / [`runWithOwner`](https://docs.solidjs.com/reference/reactive-utilities/run-with-owner) / [`createRoot`](https://docs.solidjs.com/reference/reactive-utilities/create-root) — owner 수명과 복원 범위를 확인한다.
- [Solid 공식 API — `ErrorBoundary`](https://docs.solidjs.com/reference/components/error-boundary) / [`catchError`](https://docs.solidjs.com/reference/reactive-utilities/catch-error) — 포착 범위와 reset 계약을 확인한다.
- [Solid 공식 문서 — Class and style](https://docs.solidjs.com/concepts/components/class-style) — class, `classList`, style의 선언형 사용을 확인한다.
- [Solid 공식 API — `from`](https://docs.solidjs.com/reference/reactive-utilities/from) / [`observable`](https://docs.solidjs.com/reference/reactive-utilities/observable) — external reactive source interop의 type과 cleanup을 확인한다.
