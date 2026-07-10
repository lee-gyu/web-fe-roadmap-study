# C-5. 제어 흐름과 상태 추상화 — 신원과 갱신 단위를 선택한다

> 한 줄 요약: Solid의 제어 흐름 component와 store·directive는 단순 문법 sugar가 아니라 branch, list item, nested property, DOM behavior의 신원과 owner 수명을 결정한다.

> 집필 기준: `solid-js` 1.9.14. `<Portal>`의 client-only 동작과 store utility의 현재 공식 계약을 반영했다.

## 학습 목표

- JavaScript 조건식과 `<Show>`·`<Switch>`의 branch 생성·보존·폐기 차이를 설명할 수 있다.
- `<For>`와 `<Index>`를 item identity와 update pattern에 따라 선택할 수 있다.
- `<Portal>`의 component tree, DOM tree, event·Context·SSR 경계를 구분할 수 있다.
- store의 proxy tracking과 path update를 signal 기반 상태와 비교할 수 있다.
- custom directive에 DOM behavior, reactive accessor, cleanup, TypeScript contract를 캡슐화할 수 있다.

## 배경: 왜 이것이 존재하는가

컴포넌트 함수가 상태 변화마다 다시 실행되지 않는 Solid에서는 다음 코드가 기대와 다르게 동작할 수 있다.

```tsx
const [loggedIn, setLoggedIn] = createSignal(false);
const content = loggedIn() ? <Dashboard /> : <Login />;

return <main>{content}</main>;
```

`content`를 component 최초 실행 때 계산했으므로 branch가 고정된다. JSX의 동적 expression 안에 조건을 두면 compiler/runtime가 reactive branch를 만들 수 있지만, branch 생성·폐기와 value narrowing을 일관되게 다루려면 Solid의 control-flow component가 더 명확하다.

목록과 중첩 상태도 같은 문제를 가진다. “배열이 바뀌었다”만 알면 매번 모든 item을 다시 만들 수 있지만, Solid의 목표는 어떤 item과 property가 실제로 바뀌었는지 좁히는 것이다. 이를 위해 `<For>`, `<Index>`, store proxy가 서로 다른 identity 전략을 제공한다.

## 핵심 개념

### `<Show>`는 branch owner를 관리한다

```tsx
import { Show, createSignal } from "solid-js";

const [user, setUser] = createSignal<User | undefined>();

<Show when={user()} fallback={<LoginPrompt />}>
  {(currentUser) => <Profile name={currentUser().name} />}
</Show>;
```

`when`이 falsy면 fallback branch를, truthy면 child branch를 만든다. branch가 전환되면 이전 branch의 owner와 cleanup을 dispose한다. 단순히 CSS로 숨기는 것과 다르다. hidden DOM을 유지해야 하는 widget인지, resource를 실제로 폐기해야 하는 branch인지에 따라 선택한다.

기본 non-keyed callback child는 truthy value를 accessor로 받는다. truthiness가 유지되는 동안 branch를 보존하고 accessor가 최신 값을 제공한다. `keyed`를 켜면 `when`의 값 identity가 바뀔 때 child를 새로 만든다.

```tsx
<Show when={user()} keyed>
  {(currentUser) => <ProfileEditor initialUser={currentUser} />}
</Show>
```

`keyed`는 “더 빠른 옵션”이 아니다. 사용자 객체가 바뀔 때 editor의 local state와 DOM을 폐기하고 새로 시작해야 한다는 identity 정책이다.

| 질문 | non-keyed | keyed |
|---|---|---|
| truthy 값이 다른 객체로 바뀜 | branch 보존, accessor 갱신 | branch 폐기 후 재생성 |
| local state 보존 | 보존 | 초기화 |
| 적합한 사례 | 같은 view가 다른 data를 표시 | data identity가 view lifecycle을 정의 |

### `<Switch>`와 `<Match>`는 상호 배타 branch를 드러낸다

```tsx
import { Match, Switch } from "solid-js";

<Switch fallback={<NotFound />}>
  <Match when={status() === "loading"}><Spinner /></Match>
  <Match when={status() === "error"}><ErrorPanel /></Match>
  <Match when={status() === "ready"}><Result /></Match>
</Switch>;
```

첫 번째 truthy `Match`가 선택된다. 조건 순서가 policy이므로 서로 겹치는 predicate를 배치할 때 주의한다. 가능한 상태가 유한하고 상호 배타라면 TypeScript discriminated union과 함께 exhaustive function을 쓰는 것이 누락 검출에 더 유리할 수도 있다.

`Switch`는 상태 machine을 만들어 주지 않는다. 불가능한 state 조합, transition validation, side effect orchestration은 별도 model의 책임이다.

### `<For>`는 item reference를 신원으로 본다

```tsx
import { For } from "solid-js";

<ul>
  <For each={todos()} fallback={<li>No todos</li>}>
    {(todo, index) => (
      <li>
        <span>{index() + 1}</span>
        <span>{todo.title}</span>
      </li>
    )}
  </For>
</ul>
```

`<For>`는 item reference를 기준으로 mapping 결과를 재사용한다. item은 plain value이고 index는 위치가 바뀔 수 있으므로 accessor다. 배열 앞에 item을 삽입하면 기존 item DOM을 재사용하고 각 index accessor를 갱신한다.

```text
before [A, B, C]  → DOM [nodeA, nodeB, nodeC]
after  [X, A, B, C] → DOM [nodeX, nodeA, nodeB, nodeC]
```

API response를 받을 때 모든 item을 새 object로 재생성하면 논리적 id가 같아도 reference identity는 달라진다. `<For>`가 DOM을 재사용할 수 있도록 `reconcile` 같은 store utility를 검토하거나 normalized state에서 기존 object identity를 보존한다.

### `<Index>`는 위치를 신원으로 본다

```tsx
import { Index } from "solid-js";

<Index each={temperatures()}>
  {(temperature, index) => (
    <label>
      Sensor {index}
      <input value={temperature()} />
    </label>
  )}
</Index>
```

`<Index>`는 배열 위치별 mapping을 고정한다. item 값은 해당 위치가 바뀔 수 있으므로 accessor이고 index는 고정 number다. 항목의 논리적 신원보다 slot이 중요하고 길이·순서가 거의 고정된 dashboard, tuple-like input에 적합하다.

| update pattern | `<For>` | `<Index>` |
|---|---|---|
| 삽입·삭제·재정렬 | item DOM 재사용에 유리 | 뒤 slot의 값이 연쇄 변경됨 |
| 같은 위치의 값 교체 | 새 item mapping 가능 | 해당 slot accessor만 갱신 |
| child local state identity | item reference를 따름 | index slot을 따름 |
| callback 인자 | `(item, indexAccessor)` | `(itemAccessor, index)` |

이 선택은 benchmark 한 번보다 domain identity에 기반해야 한다. drag-and-drop todo는 `<For>`, 고정된 RGB channel 세 칸은 `<Index>`가 자연스럽다.

### `mapArray`와 `indexArray`는 component 없는 같은 전략이다

`<For>`와 `<Index>`는 각각 `mapArray`, `indexArray` utility를 기반으로 한다. JSX control-flow가 아닌 custom abstraction이나 renderer에서 mapping accessor가 필요할 때 직접 쓸 수 있다.

```tsx
const rows = mapArray(items, (item, index) => ({
  item,
  position: index,
}));
```

일반 UI에는 component가 fallback과 owner lifecycle을 더 읽기 쉽게 표현한다. 저수준 utility를 직접 쓰면 반환 accessor와 disposal scope를 누가 소유하는지 확인한다.

### `createSelector`는 선택 상태의 fan-out을 좁힌다

```tsx
import { createSelector, For } from "solid-js";

const [selectedId, setSelectedId] = createSignal<string>();
const isSelected = createSelector(selectedId);

<For each={rows()}>
  {(row) => (
    <button
      classList={{ selected: isSelected(row.id) }}
      onClick={() => setSelectedId(row.id)}
    >
      {row.name}
    </button>
  )}
</For>
```

각 row가 `selectedId() === row.id`를 직접 계산하면 selected id가 바뀔 때 모든 row computation이 깨울 수 있다. selector는 key별 subscription을 만들어 과거 선택과 새 선택에 관련된 consumer만 갱신하는 데 유리하다. 목록이 작다면 복잡성을 추가할 가치가 없을 수 있으므로 update fan-out을 측정한다.

### `<Portal>`은 DOM 위치만 옮긴다

```tsx
import { Portal } from "solid-js/web";

<Portal mount={document.body}>
  <div role="dialog" aria-modal="true">
    <h2>Delete order?</h2>
  </div>
</Portal>
```

Portal child는 다른 DOM node 아래에 삽입되지만 Solid component hierarchy는 유지한다. 따라서 Context와 error boundary는 원래 owner chain을 따르고, event도 component hierarchy에 맞게 전파할 수 있도록 wrapper가 사용된다.

기본 mount는 `document.body`이고 일반 target에서는 container element로 감싼다. SVG target에는 `isSVG`, isolated style scope가 필요하면 `useShadow`를 검토한다.

중요한 current contract는 Portal이 server rendering에서 output을 만들지 않고 hydration에서도 건너뛴다는 점이다. modal trigger와 accessible fallback을 server HTML에 반드시 보여야 한다면 client-only Portal에만 의존하지 않는다.

Portal은 접근성 component가 아니다. modal에는 다음을 별도로 구현한다.

- initial focus와 focus trap
- 닫힐 때 trigger로 focus 복귀
- Escape와 backdrop 정책
- `role="dialog"`, accessible name, `aria-modal`
- background inert/scroll lock와 중첩 modal 정책

### store는 nested property read를 proxy로 추적한다

```tsx
import { createStore } from "solid-js/store";

const [state, setState] = createStore({
  user: {
    id: "u-1",
    profile: { name: "Ada", city: "London" },
  },
  todos: [
    { id: "t-1", title: "Trace graph", done: false },
  ],
});
```

store read object는 Proxy다. tracking scope에서 `state.user.profile.name`을 읽으면 그 property path의 reactive node를 구독한다. `state.user` 전체를 읽었다고 모든 descendant 변경을 자동으로 구독하는 식으로 단순화하면 안 된다. 실제로 어떤 property를 tracking scope 안에서 access했는지가 중요하다.

nested proxy는 필요할 때 만들어지며, reactive scope 밖에서 미리 값을 복사하면 signal과 같은 조기 읽기 문제가 생긴다.

```tsx
const name = state.user.profile.name; // snapshot
const nameAccessor = () => state.user.profile.name; // reactive read를 늦춤
```

### `setStore` path는 update 범위를 표현한다

```tsx
setState("user", "profile", "name", "Grace");

setState(
  "todos",
  (todo) => todo.id === "t-1",
  "done",
  true,
);

setState("todos", state.todos.length, {
  id: "t-2",
  title: "Measure DOM",
  done: false,
});
```

마지막 인자는 새 값 또는 updater이며 앞의 인자는 target path를 선택한다. key array, index range, predicate를 이용해 여러 target을 갱신할 수 있다. path syntax는 immutable copy boilerplate를 줄이고 정확한 property notification을 만들지만, 복잡한 path가 domain command를 대체하게 두면 update policy가 UI 전역으로 흩어진다.

```tsx
function completeTodo(id: string) {
  setState("todos", (todo) => todo.id === id, "done", true);
}
```

update function에 이름을 주어 invariant와 authorization을 한곳에 둔다.

### store utility는 외부 데이터와 identity 정책을 다룬다

**`produce`**는 Immer와 비슷한 mutation 문법으로 immutable-style store update를 작성한다.

```tsx
import { produce } from "solid-js/store";

setState(
  "todos",
  produce((todos) => {
    const target = todos.find((todo) => todo.id === "t-1");
    if (target) target.done = true;
  }),
);
```

**`reconcile`**은 server snapshot을 현재 store와 비교해 가능한 기존 identity를 보존하며 update한다. key option과 merge 정책이 domain identity와 맞는지 확인한다.

```tsx
setState("todos", reconcile(serverTodos, { key: "id" }));
```

**`unwrap`**은 proxy가 아닌 underlying plain data가 필요한 serialization·외부 library boundary에 사용한다. 반환 값을 다시 reactive source로 오해하지 않는다.

```tsx
const payload = structuredClone(unwrap(state));
```

**`createMutable`**은 setter 없이 직접 property를 변경하는 mutable proxy를 제공한다.

```tsx
import { createMutable } from "solid-js/store";

const state = createMutable({ count: 0 });
state.count += 1;
```

간단해 보이지만 write boundary와 command 검색 가능성을 잃는다. shared state, deeply nested form처럼 mutation model이 자연스러운 경우에만 쓰고, library/public state에서는 누가 무엇을 바꿀 수 있는지 contract를 강화한다.

### signal과 store는 규모가 아니라 update shape로 선택한다

| 상태 형태 | 권장 출발점 | 이유 |
|---|---|---|
| 독립 scalar, toggle, selected id | signal | 명시적 accessor/setter가 단순하다 |
| 여러 scalar의 순수 파생 | memo | source를 복사하지 않는다 |
| nested object/array의 일부 field 갱신 | store | property/path 단위 tracking과 update |
| server cache | resource/router query | loading·error·revalidation 의미가 필요하다 |
| event stream | event/observable adapter | “현재 값”과 “사건”의 의미가 다르다 |

store가 자동으로 global state를 의미하지 않는다. component local store도 가능하다. 반대로 signal도 module singleton으로 만들면 global이다. scope와 data shape를 따로 판단한다.

### custom directive는 DOM behavior를 부착한다

반복되는 low-level DOM integration을 component wrapper 없이 element에 붙일 수 있다.

```tsx
import { createEffect, onCleanup, type Accessor } from "solid-js";

function clickOutside(
  element: HTMLElement,
  handler: Accessor<() => void>,
) {
  const onPointerDown = (event: PointerEvent) => {
    if (!element.contains(event.target as Node)) {
      handler()();
    }
  };

  document.addEventListener("pointerdown", onPointerDown);
  onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
}
```

```tsx
<div use:clickOutside={() => close()}>Menu</div>
```

compiler는 `use:` syntax를 directive 함수 호출로 바꾸고 element와 value accessor를 전달한다. directive가 reactive option을 읽어 behavior를 바꿔야 하면 내부에 effect를 만든다. listener, observer, external instance는 반드시 `onCleanup`으로 directive owner에 연결한다.

TypeScript에는 directive contract를 선언한다.

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      clickOutside: () => void;
    }
  }
}
```

import된 directive가 JSX에서만 참조되면 일부 toolchain의 tree shaking이 사용 여부를 잘못 판단할 수 있다. 현재 compiler/toolchain과 production bundle에서 실제 포함 여부를 확인한다. 사용하지 않는 fake access를 무조건 복제하기보다 최신 compiler behavior를 먼저 검증한다.

## 실무 관점

### identity test를 먼저 작성한다

목록 component를 고르기 전에 다음 질문을 test로 만든다.

- item이 재정렬될 때 input focus와 local edit state가 어느 item을 따라가야 하는가?
- 같은 id의 새 server object를 받으면 DOM을 보존해야 하는가?
- index가 바뀌면 animation과 ARIA relationship은 어떻게 되는가?
- 제거된 item의 cleanup이 실행되는가?

DOM node reference, focus, cleanup counter를 관찰하면 단순 snapshot test보다 identity bug를 잘 잡는다.

### store를 API response 모양 그대로 두지 않는다

backend payload가 UI update pattern과 맞지 않을 수 있다. deep nested response를 그대로 store에 넣으면 여러 screen이 server schema에 결합된다. entity identity, update frequency, ownership을 기준으로 normalize하거나 feature store로 변환한다. `reconcile`은 schema 설계를 대신하지 않는다.

### directive와 component의 선택

- 시각적 구조·ARIA·상태를 함께 제공하면 component가 낫다.
- 기존 element에 focus, observer, gesture 같은 행동만 부착하면 directive가 낫다.
- DOM 없이 재사용 가능한 logic이면 일반 함수/custom primitive가 낫다.

click-outside directive 하나로 modal 전체를 구현하면 focus와 accessible semantics가 흩어진다. directive의 boundary를 행동 하나로 유지한다.

## 더 깊이: branch disposal과 DOM identity

control-flow component는 단순히 값에 따라 JSX를 반환하지 않는다. branch별 owner를 만들고 DOM marker 사이의 node range를 관리하며, 조건이 바뀔 때 해당 range와 owned computation을 정리한다. list mapping도 item identity와 owner를 함께 보존한다.

따라서 DOM node 재사용 여부와 reactive owner 재사용 여부를 함께 관찰해야 한다. node는 남았는데 owner가 바뀌거나, owner는 남았는데 external widget이 node identity를 잘못 기억하면 lifecycle bug가 생긴다.

## 정리

- `<Show>`와 `<Switch>`는 branch owner의 생성·보존·폐기를 관리하며 keyed는 identity 정책이다.
- `<For>`는 item reference, `<Index>`는 position을 신원으로 삼으므로 domain update pattern에 따라 선택한다.
- Portal은 DOM 위치만 바꾸고 component owner를 유지하지만 server output과 hydration에는 나타나지 않는다.
- store는 proxy property read와 path update로 nested state를 세밀하게 추적한다. store 자체가 global state를 뜻하지 않는다.
- directive는 DOM behavior를 캡슐화하되 reactive accessor, cleanup, accessibility 책임을 명시해야 한다.

## 확인 문제

1. 사용자를 바꿔도 편집 form의 local draft를 유지해야 한다. `<Show when={user()} keyed>`가 적합한가?

   <details>
   <summary>정답과 해설</summary>

   일반적으로 부적합하다. keyed는 `when` value identity가 바뀔 때 child branch를 폐기하고 재생성하므로 local draft가 초기화된다. 같은 editor instance가 다른 user accessor를 따라가야 한다면 non-keyed를 쓰고 draft 보존·전환 정책을 명시한다. 반대로 사용자마다 draft를 완전히 격리해야 한다면 keyed가 의도에 맞을 수 있다.

   </details>

2. drag-and-drop 목록에서 `<Index>`를 썼더니 row 내부 input 값이 다른 item에 붙었다. 원인을 identity 관점에서 설명하라.

   <details>
   <summary>정답과 해설</summary>

   `<Index>`는 position을 신원으로 보존한다. 재정렬하면 같은 DOM/owner slot에 다른 item accessor 값이 들어간다. local DOM state가 item을 따라야 하는 목록에는 item reference를 신원으로 삼는 `<For>`가 적합하다. server snapshot이 매번 새 object라면 identity 보존 전략도 함께 필요하다.

   </details>

3. store를 사용했는데 `const city = state.user.profile.city`가 갱신되지 않았다. store가 깊은 반응성을 지원한다는 설명과 모순되는가?

   <details>
   <summary>정답과 해설</summary>

   모순되지 않는다. proxy는 property read가 tracking scope에서 일어날 때 dependency를 등록한다. component setup에서 plain local 변수로 조기 복사하면 이후 reactive read가 없다. `() => state.user.profile.city`로 늦게 읽거나 JSX/memo 안에서 직접 access한다.

   </details>

4. Portal로 modal을 만들었으니 접근성과 SSR 문제가 해결됐다는 주장에 빠진 조건을 나열하라.

   <details>
   <summary>정답과 해설</summary>

   Portal은 stacking/overflow를 피하도록 DOM 위치를 옮길 뿐이다. focus 이동·trap·복귀, Escape, inert background, accessible name, `aria-modal`, scroll lock을 별도로 구현해야 한다. current contract상 server output과 hydration에서는 Portal content가 생략되므로 초기 HTML과 progressive enhancement 요구도 별도 설계해야 한다.

   </details>

## 참고 자료

- [Solid 공식 문서 — Conditional rendering](https://docs.solidjs.com/concepts/control-flow/conditional-rendering) — `Show`, `Switch`, keyed rendering의 동작을 확인한다.
- [Solid 공식 문서 — List rendering](https://docs.solidjs.com/concepts/control-flow/list-rendering) — `For`와 `Index`의 item/index accessor 차이를 확인한다.
- [Solid 공식 API — `createSelector`](https://docs.solidjs.com/reference/secondary-primitives/create-selector) — key별 subscription을 이용한 선택 상태 최적화를 확인한다.
- [Solid 공식 API — `Portal`](https://docs.solidjs.com/reference/components/portal) — mount wrapper, event, SVG·Shadow DOM과 SSR/hydration 동작을 확인한다.
- [Solid 공식 문서 — Stores](https://docs.solidjs.com/concepts/stores) — proxy property tracking과 path syntax의 기본 계약을 확인한다.
- [Solid 공식 API — `produce`](https://docs.solidjs.com/reference/store-utilities/produce) / [`reconcile`](https://docs.solidjs.com/reference/store-utilities/reconcile) / [`unwrap`](https://docs.solidjs.com/reference/store-utilities/unwrap) / [`createMutable`](https://docs.solidjs.com/reference/store-utilities/create-mutable) — 외부 snapshot·mutation·plain value 변환 utility의 현재 범위를 확인한다.
- [Solid 공식 API — `use:*`](https://docs.solidjs.com/reference/jsx-attributes/use) — custom directive의 element·accessor·TypeScript 계약을 확인한다.
