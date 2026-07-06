# 9-6. React 로직 재사용과 상태 패턴

> 한 줄 요약: 이 문서를 읽고 나면 UI 로직을 custom hook, reducer, context, provider, external store 중 어디에 배치해야 렌더링 비용과 테스트 경계가 예측 가능한지 판단할 수 있다.

이 문서는 React 19의 함수 컴포넌트와 hook 모델을 기준으로 한다. [9-5 React 컴포넌트 합성 패턴](./05-react-composition-patterns.md)의 상태 소유권과 context 비용을 전제로 하며, class component 기반 패턴은 다루지 않는다. 서버 상태 캐시의 세부는 [5-8 서버 상태](../phase-5/08-server-state.md), RSC 경계는 [8-6 Next.js와 RSC](../phase-8/06-nextjs-and-rsc.md)에서 다룬다.

## 학습 목표

- custom hook이 로직 재사용 도구이지 상태 공유 도구가 아님을 설명하고, 상태 공유가 필요한 경우와 구분할 수 있다.
- reducer + context 패턴으로 상태 전이를 명시하되, context 리렌더 비용을 provider 분할로 줄일 수 있다.
- provider boundary를 기능 단위와 앱 전역 단위 중 어디에 둘지 상태 수명, 갱신 빈도, 테스트 격리 기준으로 판단할 수 있다.
- `useSyncExternalStore`를 통해 React 밖 상태와 React 렌더링 스냅샷을 일관되게 연결할 수 있다.
- function-as-children/render prop이 hook 이후에도 유효한 조건과 대체 가능한 조건을 설명할 수 있다.
- 서버 상태와 클라이언트 상태를 구분해 캐시 라이브러리를 직접 재구현하지 않는 기준을 세울 수 있다.

## 배경: 왜 이것이 존재하는가

React 함수 컴포넌트에서 로직 재사용의 기본 도구는 custom hook이다. 그러나 hook이 생긴 뒤에도 모든 문제를 hook으로 풀 수는 없다. hook은 **컴포넌트마다 실행되는 함수**다. 같은 hook을 두 컴포넌트에서 호출하면 로직은 재사용되지만 상태는 공유되지 않는다. 상태 공유가 필요하면 공통 부모, context, 외부 store, URL, 서버 캐시 중 하나의 소유권 모델이 필요하다.

이 구분을 놓치면 두 종류의 버그가 생긴다. 첫째, custom hook에 모듈 singleton을 숨겨 상태 공유를 만들고 테스트 격리를 잃는다. 둘째, 작은 지역 상태를 전역 provider에 넣어 불필요한 리렌더와 결합을 만든다. Phase 5에서 배운 React 상태 배치 기준은 Phase 9에서도 그대로 적용된다. "로직을 어디에 둘 것인가"는 "상태의 원본은 어디인가", "갱신은 얼마나 자주 일어나는가", "어떤 컴포넌트가 구독해야 하는가"라는 질문으로 풀어야 한다.

또한 React는 렌더링 스냅샷 모델을 갖는다. 렌더 중 읽은 상태는 그 렌더의 스냅샷이다. React 밖의 가변 store는 이 모델 밖에서 변할 수 있으므로 `useSyncExternalStore` 같은 표준 접점이 필요하다. 로직 재사용 패턴은 JavaScript 구조뿐 아니라 React 렌더링 계약을 함께 지켜야 한다.

## 핵심 개념

### Custom hook은 로직을 재사용하지만 상태를 공유하지 않는다

custom hook은 hook을 호출하는 컴포넌트 인스턴스마다 독립적으로 실행된다.

```tsx
import { useEffect, useState } from "react";

export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleOnline() {
      setOnline(true);
    }

    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
```

두 컴포넌트가 `useOnlineStatus()`를 호출하면 둘 다 같은 브라우저 이벤트를 구독하지만 state cell은 각자 가진다. 이 경우에는 문제가 작다. 브라우저의 `navigator.onLine`이 원본이고, 이벤트가 같은 값을 밀어 주기 때문이다. 그러나 장바구니나 wizard 상태처럼 컴포넌트들이 같은 값을 수정해야 하는 경우 custom hook만으로는 공유가 되지 않는다.

```tsx
function useCounter() {
  const [count, setCount] = useState(0);

  return {
    count,
    increment: () => setCount((value) => value + 1),
  };
}

function A() {
  const counter = useCounter();
  return <button onClick={counter.increment}>A: {counter.count}</button>;
}

function B() {
  const counter = useCounter();
  return <button onClick={counter.increment}>B: {counter.count}</button>;
}
```

`A`와 `B`의 count는 공유되지 않는다. 로직만 공유된다. 이 차이는 custom hook 설계의 핵심이다.

custom hook이 적합한 조건은 다음과 같다.

- 컴포넌트마다 독립 상태를 가져도 된다.
- 브라우저 API, 타이머, subscription 같은 effect를 캡슐화한다.
- 동일한 계산과 이벤트 핸들러 구성 규칙을 반복하지 않게 한다.
- 반환값으로 상태와 명령을 명시한다.

상태 공유가 필요하면 hook 내부에서 전역 변수를 숨기기보다 provider나 external store를 명시한다.

### Reducer + context는 전이를 공유하고 dispatch를 안정화한다

상태 전이가 여러 이벤트에 의해 바뀌고, 같은 하위 트리가 상태와 dispatch를 공유해야 하면 reducer + context가 적합하다.

```tsx
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

type CartItem = { id: string; quantity: number };
type CartState = { items: CartItem[] };

type CartAction =
  | { type: "add"; id: string }
  | { type: "remove"; id: string }
  | { type: "clear" };

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "add": {
      const existing = state.items.find((item) => item.id === action.id);

      if (existing) {
        return {
          items: state.items.map((item) =>
            item.id === action.id
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          ),
        };
      }

      return { items: [...state.items, { id: action.id, quantity: 1 }] };
    }

    case "remove":
      return { items: state.items.filter((item) => item.id !== action.id) };

    case "clear":
      return { items: [] };
  }
}

const CartStateContext = createContext<CartState | null>(null);
const CartDispatchContext = createContext<Dispatch<CartAction> | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [] });

  return (
    <CartDispatchContext.Provider value={dispatch}>
      <CartStateContext.Provider value={state}>{children}</CartStateContext.Provider>
    </CartDispatchContext.Provider>
  );
}

export function useCartState() {
  const state = useContext(CartStateContext);

  if (!state) {
    throw new Error("useCartState는 CartProvider 안에서만 사용할 수 있다.");
  }

  return state;
}

export function useCartDispatch() {
  const dispatch = useContext(CartDispatchContext);

  if (!dispatch) {
    throw new Error("useCartDispatch는 CartProvider 안에서만 사용할 수 있다.");
  }

  return dispatch;
}
```

state context와 dispatch context를 분리한 이유는 dispatch의 참조가 안정적이기 때문이다. 상태만 읽는 컴포넌트는 state 변경 때 리렌더된다. dispatch만 쓰는 버튼은 state context를 읽지 않으면 state 변경에 리렌더될 필요가 없다.

```tsx
function AddToCartButton({ id }: { id: string }) {
  const dispatch = useCartDispatch();
  console.count(`AddToCartButton render: ${id}`);

  return (
    <button type="button" onClick={() => dispatch({ type: "add", id })}>
      담기
    </button>
  );
}
```

이 패턴의 경계 조건은 부분 구독이다. `CartBadge`가 `items.length`만 읽고, `CartList`가 전체 items를 읽는다고 해도 둘 다 같은 `CartStateContext` consumer다. items 안의 quantity가 바뀌면 둘 다 리렌더된다. 규모가 커지고 갱신이 잦다면 context를 더 쪼개거나 selector 기반 external store를 검토한다.

### Provider boundary는 상태 수명과 테스트 격리를 결정한다

Provider를 앱 최상단에 두는 것은 편하지만 상태 수명을 앱 전체로 늘린다.

```tsx
function App() {
  return (
    <CartProvider>
      <Routes />
    </CartProvider>
  );
}
```

장바구니처럼 여러 route에서 공유되는 클라이언트 상태는 앱 전역 provider가 맞을 수 있다. 반대로 wizard form, modal 내부 상태, 특정 dashboard filter는 route 또는 기능 단위 provider가 낫다.

```tsx
function CheckoutRoute() {
  return (
    <CheckoutDraftProvider>
      <CheckoutForm />
    </CheckoutDraftProvider>
  );
}
```

기능 단위 provider의 장점은 수명이 좁다는 것이다. route를 벗어나면 상태가 사라지고 테스트도 provider 하나로 격리된다. 앱 전역 provider는 어디서나 접근 가능하지만, 삭제와 재사용이 어려워지고 초기 렌더에 provider stack이 쌓인다.

Provider boundary 판단 기준은 다음과 같다.

- 여러 route가 같은 상태를 읽고 쓰는가?
- 새로고침 후에도 유지해야 하면 URL 또는 storage가 더 적합하지 않은가?
- 상태 갱신이 얼마나 자주 일어나는가?
- provider 안의 consumer 수가 얼마나 되는가?
- 테스트에서 기능을 독립적으로 렌더할 수 있는가?

Provider는 편의가 아니라 상태 수명 선언이다.

### External store adapter는 React 밖 상태와 스냅샷 계약을 맺는다

React 밖에 상태가 있어야 하는 경우가 있다. 여러 프레임워크가 공유하는 store, 브라우저 API subscription, 복잡한 클라이언트 도메인 store, undo history 엔진이 그렇다. 이때 React는 `useSyncExternalStore`로 외부 store를 구독한다.

```tsx
import { useSyncExternalStore } from "react";

type Listener = () => void;

function createCounterStore() {
  let value = 0;
  const listeners = new Set<Listener>();

  return {
    getSnapshot() {
      return value;
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    increment() {
      value += 1;
      listeners.forEach((listener) => listener());
    },
  };
}

const counterStore = createCounterStore();

export function useCounterValue() {
  return useSyncExternalStore(
    counterStore.subscribe,
    counterStore.getSnapshot,
    counterStore.getSnapshot,
  );
}

export function Counter() {
  const value = useCounterValue();

  return (
    <button type="button" onClick={() => counterStore.increment()}>
      {value}
    </button>
  );
}
```

`useSyncExternalStore`의 계약은 세 가지다.

- `getSnapshot`은 현재 스냅샷을 반환한다.
- `subscribe`는 변경 알림을 등록하고 구독 해제 함수를 반환한다.
- React는 렌더와 커밋 사이 스냅샷이 바뀌었는지 확인해 tearing을 막는다.

경계 조건은 스냅샷의 참조 안정성이다. `getSnapshot()`이 매번 새 객체를 만들면 React는 값이 계속 바뀐다고 보고 리렌더를 반복할 수 있다.

```tsx
// ❌ 호출마다 새 객체라 스냅샷이 안정적이지 않다.
getSnapshot() {
  return { value };
}
```

객체 스냅샷이 필요하면 store 내부에서 변경 시점에만 새 객체를 만들고, 변경이 없으면 같은 참조를 반환한다. Zustand, Redux 같은 라이브러리가 selector와 equality 비교를 제공하는 이유가 여기에 있다.

### Function-as-children과 render prop은 여전히 쓸 곳이 있다

hook 이전에는 render prop이 로직 재사용의 대표 패턴이었다.

```tsx
type MousePosition = { x: number; y: number };

function MouseTracker({
  children,
}: {
  children(position: MousePosition): React.ReactNode;
}) {
  const [position, setPosition] = useState<MousePosition>({ x: 0, y: 0 });

  return (
    <div
      onMouseMove={(event) => {
        setPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {children(position)}
    </div>
  );
}
```

대부분의 로직 재사용은 custom hook으로 더 간단하다.

```tsx
function useMousePosition() {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  return {
    position,
    bind: {
      onMouseMove(event: React.MouseEvent) {
        setPosition({ x: event.clientX, y: event.clientY });
      },
    },
  };
}
```

그러나 render prop이 여전히 유효한 조건이 있다.

- hook을 직접 호출할 수 없는 경계에 값을 넘겨야 한다.
- 컴포넌트가 렌더링 위치를 소유하고, 호출자가 그 안의 내용을 함수로 결정해야 한다.
- library API가 "상태를 인자로 받아 JSX를 반환하는 함수"를 명시적으로 요구한다.

비용은 render prop 함수가 매 렌더 새로 만들어지기 쉽고, 컴포넌트 트리가 깊어질 수 있다는 점이다. hook으로 표현 가능한 단순 로직은 hook이 기본값이다. 렌더링 위치와 제어 흐름을 컴포넌트가 소유해야 할 때 render prop을 선택한다.

### 서버 상태는 클라이언트 상태 패턴으로 재구현하지 않는다

서버가 원본인 데이터는 클라이언트 상태가 아니라 캐시다. `useReducer`와 context로 서버 데이터를 저장하기 시작하면 refetch, stale time, deduplication, pagination, optimistic update, invalidation을 직접 구현해야 한다.

```tsx
// ❌ 서버 상태 캐시를 손으로 재구현하기 시작한다.
type ProductsState = {
  items: Product[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
};
```

작은 데모는 가능하지만 실서비스에서는 금방 캐시 라이브러리 문제가 된다. TanStack Query 같은 도구는 pattern이 아니라 서버 상태라는 별도 문제 영역의 구현이다. 직접 재구현할지 판단하려면 다음 질문을 통과해야 한다.

- 여러 컴포넌트가 같은 쿼리를 중복 요청하지 않아야 하는가?
- stale data와 refetch 정책이 필요한가?
- mutation 뒤 관련 쿼리를 무효화해야 하는가?
- pagination/infinite query가 필요한가?
- offline, retry, focus refetch가 요구되는가?

둘 이상이 "예"라면 서버 캐시 라이브러리를 쓰는 편이 낫다. Phase 9의 목표는 그 라이브러리를 직접 만드는 것이 아니라, 서버 상태와 클라이언트 상태의 소유권을 혼동하지 않는 것이다.

## 실무 관점

### 로직·상태 패턴 선택표

| 문제 | 기본 선택 | 장점 | 비용 | 무너지는 조건 |
|---|---|---|---|---|
| 컴포넌트별 독립 로직 재사용 | custom hook | 작은 API, 테스트 쉬움 | 상태 공유는 안 됨 | 여러 컴포넌트가 같은 상태를 수정 |
| 상태 전이가 복잡한 지역/기능 상태 | reducer | 전이 명시, 테스트 쉬움 | boilerplate | 단순 boolean/input |
| 하위 트리 공유 상태 | reducer + context | 명시적 dispatch, provider로 수명 선언 | context 리렌더 | 고빈도 갱신 + 부분 구독 |
| 넓은 공유와 부분 구독 | external store | selector, 조상 리렌더 없음 | 트리 밖 수명 관리 | 작은 기능 상태 |
| 렌더 위치까지 추상화 | render prop | 호출자가 JSX 결정 | 중첩, 함수 참조 비용 | hook으로 충분한 로직 |
| 서버 원본 데이터 | 서버 캐시 라이브러리 | stale/refetch/invalidation 모델 | 도구 학습 비용 | 일회성 단일 요청 |

기본값은 아래에 두는 것이다. 컴포넌트 하나면 `useState`와 custom hook, 한 기능 트리면 reducer + provider, 앱 전체 고빈도 공유면 external store, 서버 원본이면 서버 캐시다.

### custom hook의 테스트 경계

custom hook은 외부 효과를 내부에 숨기기 쉽다. 테스트 가능한 hook은 외부 경계를 인자로 받거나 adapter를 사용한다.

```tsx
type Subscribe<T> = (listener: (value: T) => void) => () => void;

function useSubscription<T>(subscribe: Subscribe<T>, initialValue: T) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => subscribe(setValue), [subscribe]);

  return value;
}
```

이 hook은 브라우저 API를 직접 import하지 않는다. 테스트에서는 fake subscribe를 넘길 수 있고, 제품에서는 `matchMedia`, `BroadcastChannel`, WebSocket adapter를 넘길 수 있다. hook도 [9-2](./02-creational-and-composition-patterns.md)의 DI 원칙을 따른다.

### provider 중첩은 문제가 아니라 경계 신호다

앱 루트에 provider가 많다는 사실 자체가 나쁜 것은 아니다. 문제는 수명이 다른 상태가 모두 앱 전역에 묶이는 것이다. `ThemeProvider`, `AuthProvider`, `QueryClientProvider`는 앱 전역이 자연스러울 수 있다. `CheckoutDraftProvider`, `TableSelectionProvider`, `DialogStateProvider`는 기능 경계 안쪽이 더 낫다.

Provider를 줄이기 위해 모든 상태를 하나의 `AppProvider`에 넣으면 context value가 비대해지고 변경 축이 섞인다. provider 중첩은 "상태 경계가 많다"는 신호이고, 그 경계가 실제 수명과 일치하는지 검토하면 된다.

### Profiler로 검증하는 질문

React 상태 패턴은 감으로 평가하지 않는다. Profiler나 로그로 다음을 확인한다.

- 어떤 사용자 행동이 commit을 만들었는가?
- 어떤 provider 아래 consumer가 리렌더되었는가?
- dispatch만 쓰는 컴포넌트가 state 변경에 리렌더되는가?
- context value 분리 전후 commit duration이 줄었는가?
- external store selector가 기대한 컴포넌트만 깨우는가?

성능 문제를 발견하기 전에는 구조를 단순하게 유지한다. 반대로 실제 리렌더 비용이 관측되면 "memo를 추가한다"보다 상태 소유권과 구독 단위를 먼저 본다.

## 더 깊이

### hook 호출 순서는 상태 저장소의 주소다

React hook은 이름으로 상태를 찾지 않는다. 컴포넌트 Fiber 안의 hook list에서 호출 순서로 상태 cell을 찾는다. 그래서 hook은 조건문 안에서 호출할 수 없다. custom hook도 내부에서 여러 hook을 호출할 뿐, 같은 규칙을 따른다.

이 모델은 custom hook이 "로직을 복사해서 실행하는 함수"에 가깝다는 사실을 보여 준다. 같은 custom hook을 두 컴포넌트가 호출하면 각 Fiber에 별도 hook list가 생긴다. 상태 공유가 자동으로 일어나지 않는 이유다.

### dispatch 안정성과 stale closure

`useReducer`의 dispatch 함수는 렌더 사이에 참조가 안정적이다. 그래서 dispatch context 분리가 효과를 낸다. 반면 event handler가 state를 클로저로 캡처하면 stale closure 문제가 생길 수 있다.

```tsx
function DelayedIncrement() {
  const [count, setCount] = useState(0);

  function incrementLater() {
    setTimeout(() => {
      setCount((value) => value + 1);
    }, 1000);
  }

  return <button onClick={incrementLater}>{count}</button>;
}
```

함수형 갱신을 쓰면 timeout이 생성된 렌더의 `count`가 아니라 React가 제공하는 최신 상태 기준으로 갱신한다. reducer도 같은 이유로 action을 "무슨 일이 일어났는가"로 남기고 전이는 reducer에서 계산하는 편이 안전하다.

### external store와 tearing

React concurrent rendering에서는 렌더가 중단되고 재개될 수 있다. 외부 store를 단순히 `store.get()`으로 읽으면 한 렌더의 앞부분과 뒷부분이 서로 다른 store 값을 볼 수 있다. 이것이 tearing이다. `useSyncExternalStore`는 렌더 때 읽은 스냅샷과 커밋 직전 스냅샷이 같은지 확인하고, 다르면 동기 재렌더로 일관성을 맞춘다.

이 보장은 공짜가 아니다. 외부 store 갱신은 React 스케줄러와 별개로 발생할 수 있고, 동기 재렌더가 필요할 수 있다. 따라서 모든 상태를 external store로 보내는 것은 답이 아니다. React 트리 안에 두어도 되는 상태는 React state로 두고, 트리 밖 상태가 실제로 필요한 경우에만 external store adapter를 사용한다.

## 정리

- custom hook은 로직 재사용 도구다. 같은 hook을 여러 컴포넌트에서 호출해도 상태는 공유되지 않는다.
- 상태 전이가 복잡하고 하위 트리가 공유해야 하면 reducer + context가 자연스럽다. state context와 dispatch context를 분리하면 dispatch-only consumer의 리렌더를 줄일 수 있다.
- provider boundary는 상태 수명 선언이다. 앱 전역 provider는 편하지만 기능 상태까지 전역화하면 삭제와 테스트가 어려워진다.
- external store는 React 밖 상태가 실제로 필요할 때 `useSyncExternalStore`로 연결한다. 스냅샷 참조 안정성과 구독 해제가 핵심 계약이다.
- render prop은 hook으로 대체되는 경우가 많지만, 컴포넌트가 렌더 위치를 소유하고 호출자가 내용을 함수로 결정해야 할 때 여전히 유효하다.
- 서버 상태는 클라이언트 상태 패턴으로 재구현하지 않는다. 서버가 원본이면 캐시, 재검증, 무효화 문제가 따라온다.

## 확인 문제

**Q1.** `useCart()`라는 custom hook을 두 컴포넌트에서 호출했는데, 한쪽에서 상품을 담아도 다른 쪽의 count가 바뀌지 않는다. 원인을 hook 모델로 설명하고, 공유가 필요하다면 어떤 구조로 바꿔야 하는가?

<details>
<summary>정답과 해설</summary>

custom hook은 호출한 컴포넌트 인스턴스마다 독립 hook state를 만든다. 같은 함수를 호출해도 state cell은 각 Fiber에 따로 있다. 그래서 로직은 재사용되지만 상태는 공유되지 않는다. 장바구니가 여러 컴포넌트에서 공유되어야 한다면 공통 부모로 상태를 끌어올리거나, `CartProvider`를 두고 reducer + context로 state/dispatch를 제공하거나, 갱신이 잦고 부분 구독이 필요하면 external store를 사용한다. hook 이름이 `useCart`라고 해서 전역 cart가 되는 것은 아니다.
</details>

**Q2.** 앱 루트의 `AppProvider`가 `{ user, theme, cart, tableFilters, checkoutDraft }`를 하나의 context value로 제공한다. 장바구니 수량이 바뀔 때 테마 토글과 checkout form도 리렌더된다. 어떤 재설계를 제안할 수 있는가?

<details>
<summary>정답과 해설</summary>

갱신 빈도와 수명이 다른 상태가 하나의 context value에 섞여 있다. context 구독 단위는 value 전체이므로 cart 변경이 다른 consumer를 깨운다. `ThemeProvider`, `AuthProvider`, `CartProvider`, `CheckoutDraftProvider`, `TableFilterProvider`처럼 상태 성격과 수명별로 provider를 나눈다. checkout draft와 table filter는 해당 route 또는 기능 경계 안쪽으로 내린다. cart는 여러 route에서 공유되면 앱 전역이 될 수 있지만, state context와 dispatch context를 분리한다. 그래도 cart 내부 부분 구독 비용이 크면 external store selector를 검토한다.
</details>

**Q3.** 서버에서 받아온 상품 목록을 context reducer에 저장하고, mutation 뒤 직접 목록을 수정하고 있다. 페이지 focus 시 refetch, stale time, pagination, optimistic update 요구가 추가되었다. 왜 이 구조가 위험한가?

<details>
<summary>정답과 해설</summary>

상품 목록의 원본은 서버다. context reducer에 저장하면 서버 상태 캐시를 손으로 구현하는 셈이다. 요구가 늘어나면서 stale/refetch, 중복 요청 제거, pagination, mutation 뒤 invalidation, optimistic update를 모두 직접 풀어야 한다. 이는 클라이언트 상태 패턴의 문제가 아니라 서버 캐시 문제다. TanStack Query 같은 서버 상태 라이브러리를 사용하고, context에는 클라이언트가 원본인 UI 상태만 둔다. 서버 데이터를 전역 store에 복사하면 원본이 둘이 되어 동기화 버그가 생긴다.
</details>

## 참고 자료

- [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — custom hook이 로직 재사용 도구로 작동하는 공식 모델을 설명한다.
- [React — Scaling Up with Reducer and Context](https://react.dev/learn/scaling-up-with-reducer-and-context) — reducer와 context를 결합해 하위 트리에 상태 전이를 제공하는 패턴을 다룬다.
- [React — useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — 외부 store와 React 렌더링 스냅샷을 연결하는 표준 hook의 계약을 설명한다.
- [React — Render and Commit](https://react.dev/learn/render-and-commit) — 렌더 스냅샷과 커밋 모델을 이해하는 기반 자료다.
- [TanStack Query — Overview](https://tanstack.com/query/latest/docs/framework/react/overview) — 서버 상태를 캐시, 재검증, 무효화 관점에서 다루는 라이브러리의 공식 개요다.
