# C-2. 세밀한 반응성 — signal, effect, memo로 그래프를 만든다

> 한 줄 요약: signal의 accessor가 현재 computation을 구독자로 등록하고 setter가 변경을 전파하며, effect와 memo는 같은 그래프에서 각각 외부 동기화와 파생 값 공유를 담당한다.

> 집필 기준: `solid-js` 1.9.14. API의 표면 사용법보다 Chapter 4-7의 reactive core와 dependency propagation 모델을 기준으로 설명한다.

## 학습 목표

- signal과 computation으로 최소 reactive core를 구현하고 dependency 수집·해제·전파를 설명할 수 있다.
- `createSignal`의 accessor, setter, 함수형 갱신, `equals`, `batch`의 의미를 판단할 수 있다.
- effect의 자동·명시적 dependency tracking과 `untrack`, cleanup을 외부 시스템 동기화에 적용할 수 있다.
- 일반 파생 함수와 `createMemo`의 평가·캐시·하위 전파 비용을 비교할 수 있다.
- 동적 dependency, effect loop, 같은 참조 변이와 같은 대표 실패 모드를 진단할 수 있다.

## 배경: 왜 이것이 존재하는가

상태와 소비자를 연결하는 가장 직접적인 형태는 Observer 패턴이다. 상태가 observer 목록을 갖고 값이 바뀔 때 알린다. 그러나 애플리케이션 규모에서 모든 subscribe와 unsubscribe를 손으로 관리하면 다음 문제가 생긴다.

- 계산이 실제로 어떤 상태를 읽는지와 수동 subscription 목록이 어긋난다.
- 조건 분기가 바뀌어 더는 필요 없는 dependency가 남는다.
- 파생 값을 여러 consumer가 중복 계산한다.
- 외부 자원의 해제가 computation 수명과 분리된다.

Solid의 reactive core는 **실행 중 읽은 값**으로 subscription을 자동 구성한다. signal은 source, computation은 observer이면서 다른 값의 source가 될 수 있다. memo는 이 두 역할을 연결한다.

```text
source signal ──notify──> memo ──notify──> DOM computation
      │
      └────────notify──> effect ──sync──> external system
```

## 핵심 개념

### 최소 reactive core를 직접 만든다

다음 TypeScript는 교육용 최소 구현이다. scheduler, owner, error handling, batching을 생략했으므로 production 대체품이 아니다. 핵심은 현재 실행 중인 observer와 양방향 dependency bookkeeping이다.

```ts
type SubscriberSet = Set<Computation>;

type Computation = {
  execute: () => void;
  sources: Set<SubscriberSet>;
};

let current: Computation | null = null;

function cleanup(computation: Computation) {
  for (const subscribers of computation.sources) {
    subscribers.delete(computation);
  }
  computation.sources.clear();
}

function createComputation(fn: () => void): Computation {
  const computation: Computation = {
    sources: new Set(),
    execute() {
      cleanup(computation);
      const previous = current;
      current = computation;

      try {
        fn();
      } finally {
        current = previous;
      }
    },
  };

  computation.execute();
  return computation;
}

function createSignal<T>(initial: T) {
  let value = initial;
  const subscribers: SubscriberSet = new Set();

  const read = () => {
    if (current) {
      subscribers.add(current);
      current.sources.add(subscribers);
    }
    return value;
  };

  const write = (next: T) => {
    if (value === next) return;
    value = next;

    // 재실행 중 Set이 바뀔 수 있으므로 snapshot을 순회한다.
    for (const computation of [...subscribers]) {
      computation.execute();
    }
  };

  return [read, write] as const;
}
```

관찰 코드는 다음과 같다.

```ts
const [price, setPrice] = createSignal(10);
const [quantity, setQuantity] = createSignal(2);

createComputation(() => {
  console.log("total", price() * quantity());
});

setPrice(12);    // total 24
setQuantity(3);  // total 36
setQuantity(3);  // 출력 없음
```

실행 흐름은 다음과 같다.

1. computation이 최초 실행되며 `current`가 자신을 가리킨다.
2. `price()`와 `quantity()`가 현재 computation을 각 subscriber set에 등록한다.
3. setter가 실제로 다른 값을 저장하면 subscriber snapshot을 실행한다.
4. 재실행 전에 이전 source의 구독을 제거한다.
5. 이번 실행에서 실제로 읽은 source만 다시 구독한다.

4번이 없으면 조건 분기가 바뀌었는데도 과거 dependency가 계속 computation을 깨운다. 자동 추적은 dependency 추가뿐 아니라 **매 실행의 dependency 재구성**을 포함한다.

### 동적 dependency는 실행 경로를 따른다

```tsx
const [useMetric, setUseMetric] = createSignal(true);
const [celsius, setCelsius] = createSignal(20);
const [fahrenheit, setFahrenheit] = createSignal(68);

createEffect(() => {
  console.log(useMetric() ? celsius() : fahrenheit());
});
```

`useMetric()`이 `true`인 실행에서는 effect가 `celsius`를 구독하고 `fahrenheit`는 읽지 않는다. `false`로 바뀌어 재실행되면 이전 dependency가 정리되고 `fahrenheit`를 구독한다. 이후 `celsius` 갱신은 effect를 깨우지 않는다.

이 동작은 dependency array를 수동으로 적는 모델과 다르다. callback에서 실제로 읽지 않은 값은 dependency가 아니며, helper 함수 안에서 읽은 signal도 같은 동기 call stack 안이라면 dependency가 된다.

### `createSignal`은 getter/setter 계약이다

```tsx
const [count, setCount] = createSignal(0);

count();                    // 현재 값 읽기 + tracking 가능
setCount(1);                // 값 설정
setCount((previous) => previous + 1); // 이전 값 기반 갱신
```

accessor 함수 형태에는 두 가지 이유가 있다.

첫째, 값을 늦게 읽는다. `count` 자체를 전달하면 consumer가 자신의 tracking scope 안에서 호출할 수 있다. 둘째, 읽기 순간을 runtime이 관찰할 수 있다. property read를 가로채는 store와 달리 signal은 함수 호출을 명시적 경계로 쓴다.

함수를 signal 값으로 저장할 때는 setter가 updater로 해석하지 않도록 한 번 더 감싼다.

```ts
type Handler = () => void;
const [handler, setHandler] = createSignal<Handler>(() => {});

const nextHandler = () => console.log("next");
setHandler(() => nextHandler);
```

### equality는 전파 정책이다

기본 signal은 같은 값인지 비교해 불필요한 notification을 막는다. 객체를 내부에서 변이한 뒤 같은 참조를 다시 설정하면 consumer가 깨지지 않는다.

```tsx
const [user, setUser] = createSignal({ name: "Ada", active: false });

const current = user();
current.active = true;
setUser(current); // 기본 비교에서는 같은 참조이므로 갱신이 전파되지 않는다.
```

새 객체를 만드는 것이 가장 명시적이다.

```tsx
setUser((previous) => ({ ...previous, active: true }));
```

도메인별 equality를 줄 수도 있다.

```tsx
type Position = { x: number; y: number };

const [position, setPosition] = createSignal<Position>(
  { x: 0, y: 0 },
  {
    equals: (previous, next) =>
      previous.x === next.x && previous.y === next.y,
  },
);
```

custom comparator도 공짜가 아니다. 비교 비용이 실제 하위 computation 비용보다 크면 최적화가 역전된다. `equals: false`는 모든 write를 trigger로 취급해야 하는 특별한 event-like 상태에 쓸 수 있지만, 값과 사건을 한 abstraction으로 섞는 신호이기도 하다.

### effect는 외부 세계와의 경계다

`createEffect`는 callback이 동기적으로 읽은 reactive value를 추적한다. 최초 실행은 현재 render phase가 끝난 뒤 예약되며, 이후 dependency가 바뀌면 다시 실행된다. effect가 반환한 값은 다음 실행의 `previous` 인자로 전달할 수 있지만 cleanup 함수로 해석되지는 않는다. 자원 해제에는 `onCleanup`을 쓴다.

```tsx
import { createEffect, createSignal, onCleanup } from "solid-js";

const [topic, setTopic] = createSignal("orders");

createEffect(() => {
  const channel = connect(topic());

  onCleanup(() => {
    channel.close();
  });
});
```

`topic`이 바뀌면 이전 실행의 cleanup이 먼저 수행되고 새 channel을 만든다. owner가 dispose될 때도 마지막 cleanup이 실행된다. 이를 빼면 branch 전환이나 page 이동 때 subscription이 누적된다.

effect 안에서 signal을 쓰는 것은 가능하지만 기본 선택은 아니다.

```tsx
// 파생 값을 effect로 다시 state에 복사한다.
createEffect(() => setTotal(price() * quantity()));
```

이 구조는 source update 뒤 추가 write와 두 번째 propagation을 만든다. `total`이 순수 파생 값이면 함수 또는 memo가 맞다. effect는 analytics, Web API, subscription, imperative widget처럼 reactive graph 밖과 동기화할 때 쓴다.

### `on`과 `untrack`은 dependency를 의도적으로 좁힌다

`on`은 dependency와 실행 본문을 분리한다.

```tsx
import { createEffect, on } from "solid-js";

createEffect(
  on(
    () => userId(),
    (id, previousId) => {
      console.log("user changed", previousId, "->", id);
      console.log("current filter", filter());
    },
    { defer: true },
  ),
);
```

이 effect는 `userId`를 dependency로 삼고 callback 안의 `filter()` 읽기는 자동 dependency에 추가하지 않는다. `{ defer: true }`는 최초 실행을 건너뛰고 실제 변경부터 반응하게 한다.

`untrack`은 더 작은 영역의 읽기를 추적에서 제외한다.

```tsx
createEffect(() => {
  const id = userId();
  const snapshot = untrack(() => preferences());
  sendAnalytics({ id, snapshot });
});
```

`preferences`가 바뀌어도 effect는 재실행되지 않지만, `userId`가 바뀌어 실행될 때는 최신 preference를 snapshot으로 읽는다. `untrack`을 dependency 경고를 숨기는 도구로 쓰면 상태 동기화가 조용히 깨진다. “이 값만 바뀌었을 때 정말 재실행하면 안 되는가?”를 답할 수 있어야 한다.

### memo는 계산 cache이자 propagation boundary다

일반 파생 함수는 consumer가 읽을 때마다 계산한다.

```tsx
const total = () => expensiveTotal(items());
```

두 consumer가 `total()`을 읽으면 계산도 두 번 일어난다. `createMemo`는 dependency가 바뀔 때 계산을 공유하고, 결과가 이전과 다를 때만 하위 subscriber에게 알린다.

```tsx
const total = createMemo(
  (previous) => {
    const next = expensiveTotal(items());
    console.log({ previous, next });
    return next;
  },
  0,
);
```

memo의 accessor도 읽어야 한다. `total`은 값이 아니라 `() => number`다.

| 선택 | 적합한 조건 | 비용·경계 |
|---|---|---|
| 일반 함수 | 계산이 싸고 한 곳에서 읽는다 | consumer마다 다시 계산한다 |
| memo | 계산이 비싸거나 여러 consumer가 공유한다 | cache, dependency node, equality 비교 비용이 생긴다 |
| signal | 값 자체가 외부 입력 또는 독립 상태다 | setter와 소유권 정책이 필요하다 |
| effect | 외부 시스템과 동기화한다 | 실행 순서·cleanup·loop 위험이 있다 |

memo callback은 순수하게 유지한다. memo 안에서 signal을 쓰면 파생 계산과 graph 변경이 섞여 실행 순서 추론이 어려워진다.

### `batch`는 여러 write의 중간 상태 노출을 막는다

```tsx
import { batch } from "solid-js";

batch(() => {
  setFirstName("Grace");
  setLastName("Hopper");
});
```

batch 안의 write는 모인 뒤 downstream computation에 반영된다. 두 setter 사이의 불완전한 이름을 consumer가 관찰하지 않고, 같은 computation이 중복 실행되는 것도 줄인다.

batch는 transaction이 아니다. 예외가 발생했을 때 이전 signal 값으로 rollback하지 않으며, database의 atomic commit처럼 다른 process에 격리를 제공하지 않는다. 여러 상태가 항상 함께 유효해야 한다면 하나의 구조로 모델링할지 먼저 검토한다.

## 실무 관점

### reactive graph를 오염시키는 안티패턴

**파생 값을 state에 복사한다.** source와 복사본이 어긋날 수 있고 write가 늘어난다. 함수나 memo를 사용한다.

**effect를 command handler처럼 쓴다.** 사용자가 버튼을 눌렀다는 사건은 handler에서 처리한다. effect는 상태가 어떤 값이 되었다는 사실과 외부 시스템을 동기화할 때 사용한다.

**깊은 객체를 signal 하나에 두고 내부만 변이한다.** equality에 막히거나 전체 객체 consumer를 모두 깨운다. immutable update 또는 [store](./05-control-flow-and-state.md)를 검토한다.

**모든 곳에 custom comparator를 둔다.** 비교 비용, 잘못된 equality, stale UI 위험이 늘어난다. 먼저 computation 실행 비용과 빈도를 측정한다.

**async callback의 `await` 뒤 읽기도 추적될 것으로 가정한다.** tracking은 동기 실행 stack을 따른다. `await` 뒤의 읽기는 원래 effect의 dependency가 되지 않는다. source를 `await` 전에 읽거나 resource와 owner 모델을 사용한다.

### 관찰 실습

다음 항목을 각각 counter로 기록한다.

```tsx
const [a, setA] = createSignal(1);
const [b, setB] = createSignal(2);

const sum = createMemo(() => {
  console.count("memo");
  return a() + b();
});

createEffect(() => {
  console.count("effect");
  console.log(sum());
});
```

1. `setA(1)`처럼 같은 값을 쓴다.
2. `setA(2); setB(3);`를 연속 호출한다.
3. 같은 두 write를 `batch` 안에서 호출한다.
4. memo 대신 일반 함수로 바꾸고 두 consumer에서 읽는다.
5. custom `equals`가 실제 실행 횟수와 총 시간을 줄이는지 측정한다.

로그 횟수만으로 성능 결론을 내리지 않는다. comparator와 logging 비용까지 포함한 production profile을 함께 본다.

## 더 깊이: graph의 두 방향

교육용 core가 `subscribers`와 `sources`를 모두 저장한 이유가 중요하다.

- source → subscriber 방향은 write가 누구를 깨울지 찾는다.
- computation → source 방향은 재실행 전 과거 subscription을 제거한다.

한 방향만 있으면 dynamic dependency cleanup을 효율적으로 수행할 수 없다. production runtime은 여기에 owner tree, scheduler, stale state, error propagation을 더한다. reactive dependency graph와 owner tree는 관련 있지만 같은 graph가 아니다. dependency는 “누가 누구의 값을 읽었는가”, owner는 “누가 누구를 dispose하는가”를 표현한다.

## 정리

- signal accessor는 현재 computation을 구독자로 등록하고 setter는 equality를 통과한 변경만 전파한다.
- computation은 재실행 전 과거 dependency를 제거하고 이번 실행에서 실제로 읽은 source를 다시 구독한다.
- effect는 외부 시스템 동기화와 cleanup, memo는 파생 계산 공유와 하위 전파 제어를 담당한다.
- `on`과 `untrack`은 dependency를 명시적으로 좁히지만 잘못 쓰면 조용한 stale state를 만든다.
- `batch`는 중간 propagation을 묶을 뿐 rollback 가능한 transaction은 아니다.

## 확인 문제

1. 조건이 바뀐 뒤 더는 읽지 않는 signal의 갱신에도 effect가 계속 실행된다. reactive core의 어느 단계가 빠졌을 가능성이 큰가?

   <details>
   <summary>정답과 해설</summary>

   computation 재실행 전 과거 source의 subscriber set에서 자신을 제거하는 cleanup 단계가 빠졌을 가능성이 크다. 자동 dependency 추적은 새 구독을 추가하는 것만으로 완성되지 않는다. 동적 분기에서는 매 실행마다 dependency 집합을 재구성해야 한다.

   </details>

2. `createEffect(() => setFullName(first() + last()))`가 동작하더라도 memo보다 부적합한 이유를 설명하라.

   <details>
   <summary>정답과 해설</summary>

   `fullName`은 외부 효과가 아니라 순수 파생 값이다. effect 방식은 source 변경 후 별도 signal write와 추가 propagation을 만들고 source와 복사본의 일관성 책임도 만든다. 함수 또는 memo는 파생 관계 자체를 graph로 표현한다. 여러 consumer가 공유하거나 equality boundary가 필요하면 memo가 적합하다.

   </details>

3. `batch` 안의 두 번째 setter가 예외를 던졌다. 첫 번째 setter도 자동으로 원복되는가? 이 사실이 상태 모델링에 주는 함의는 무엇인가?

   <details>
   <summary>정답과 해설</summary>

   원복되지 않는다. batch는 downstream notification을 묶는 propagation 도구이지 원자적 transaction이나 rollback 장치가 아니다. 두 값이 항상 하나의 invariant를 만족해야 한다면 하나의 signal/store 구조와 검증된 update 함수를 사용하거나 명시적인 보상 로직을 설계해야 한다.

   </details>

4. effect 안에서 `await` 이후 읽은 signal이 dependency가 되지 않는 이유를 실행 stack 관점에서 설명하라.

   <details>
   <summary>정답과 해설</summary>

   자동 추적은 callback이 동기적으로 실행되는 동안 설정된 현재 listener를 사용한다. `await`는 callback을 중단하고 continuation을 이후 microtask에서 실행한다. 그때는 원래 listener stack이 복원되지 않으므로 accessor가 그 effect를 subscriber로 등록할 수 없다. 필요한 source는 `await` 전에 읽거나 async primitive로 모델링한다.

   </details>

## 참고 자료

- [Solid 공식 문서 — Signals](https://docs.solidjs.com/concepts/signals) — accessor·setter와 tracking scope의 기본 계약을 확인한다.
- [Solid 공식 문서 — Effects](https://docs.solidjs.com/concepts/effects) — 자동 dependency, 중첩 effect와 lifecycle의 공식 설명을 확인한다.
- [Solid 공식 문서 — Memos](https://docs.solidjs.com/concepts/derived-values/memos) — 파생 계산 cache와 equality propagation을 확인한다.
- [Solid 공식 API — `createSignal`](https://docs.solidjs.com/reference/basic-reactivity/create-signal) — setter overload와 `equals` option의 현재 type을 확인한다.
- [Solid 공식 API — `batch`](https://docs.solidjs.com/reference/reactive-utilities/batch) — batched propagation의 보장 범위를 확인한다.
- [Solid 공식 API — `on`](https://docs.solidjs.com/reference/reactive-utilities/on-util) / [`untrack`](https://docs.solidjs.com/reference/reactive-utilities/untrack) — 명시적 dependency와 tracking 제외의 현재 계약을 확인한다.
