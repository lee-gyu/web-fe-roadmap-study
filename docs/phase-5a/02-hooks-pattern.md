# 5a-2. Hook Pattern

> 한 줄 요약: custom hook은 호출별 상태 인스턴스를 유지한 채 상태 있는 로직을 재사용하는 protocol adapter이며, 좋은 Hook은 Effect를 숨기는 데서 그치지 않고 원본·반응형 입력·cleanup·오류·테스트 경계를 공개한다.

이 문서는 React 19.x와 TypeScript strict를 기준으로 하며, `use`, `useActionState`, `useFormStatus`, `useOptimistic`의 지원 상태와 signature는 2026-07-10에 React 19.2 공식 문서에서 확인했다.

## 학습 목표

- custom hook이 로직을 공유하지만 호출 간 state cell은 공유하지 않는 이유를 Hook 슬롯 모델로 설명할 수 있다.
- 상태 원본, 반응형 입력, cleanup, 취소와 오류를 드러내는 Hook API를 설계할 수 있다.
- tuple·object 반환, 선언형 입력·명령형 action, 외부 포트 주입의 트레이드오프를 판단할 수 있다.
- 외부 구독을 `useSyncExternalStore`로 연결해야 하는 조건을 판별할 수 있다.
- React 19의 `use`와 Action 관련 Hook이 해결하는 비동기 경계를 일반 custom hook과 구분할 수 있다.

## 배경: 왜 이것이 존재하는가

두 컴포넌트가 온라인 상태를 표시하려면 state, 브라우저 event 구독, cleanup을 반복해야 한다. UI는 서로 달라도 React와 외부 시스템을 동기화하는 절차는 같다. 이 반복을 일반 함수로 옮기면 일반 함수 안에서는 Hook을 호출할 수 없고, 컴포넌트로 옮기면 wrapper와 렌더 위임 API가 필요하다.

custom hook은 이 틈을 메운다. 컴포넌트 렌더의 일부로 실행되기 때문에 `useState`, `useEffect`, `useContext`를 조합할 수 있고, JSX를 소유하지 않으므로 호출자가 UI를 그대로 결정한다.

하지만 “Effect 코드를 다른 파일로 옮겼다”만으로 좋은 추상화가 되지는 않는다. 연결 대상이 바뀌었을 때 재동기화되는가, cleanup이 보장되는가, 오류를 누가 표시하는가, 브라우저 밖 렌더에서 어떤 snapshot을 쓰는가가 Hook 계약에 없으면 복잡성을 숨긴 것이 아니라 찾기 어렵게 만든 것이다.

## 핵심 개념

### Hook 호출은 컴포넌트 인스턴스의 슬롯에 연결된다

[5-3 상태와 배칭](../phase-5/03-state-and-batching.md)에서 본 것처럼 React는 한 컴포넌트의 Hook을 호출 순서로 대응시킨다.

```tsx
function useCounter(initialValue = 0) {
  const [count, setCount] = useState(initialValue);

  return {
    count,
    increment: () => setCount((value) => value + 1),
  };
}

function LeftCounter() {
  const counter = useCounter(); // LeftCounter 인스턴스의 state cell
  return <button onClick={counter.increment}>왼쪽 {counter.count}</button>;
}

function RightCounter() {
  const counter = useCounter(); // RightCounter 인스턴스의 별도 state cell
  return <button onClick={counter.increment}>오른쪽 {counter.count}</button>;
}
```

두 호출은 같은 구현을 실행하지만 값은 공유하지 않는다. custom hook은 별도 state 저장소가 아니라 호출한 컴포넌트의 Hook 호출을 묶는 함수다. 실제 공유가 필요하면 공통 부모 state, Context, URL, 외부 store, 서버 cache 중 하나가 원본이어야 한다([5-6 상태 아키텍처](../phase-5/06-state-architecture.md)).

이 대응을 보존하려면 Hook은 컴포넌트 또는 다른 Hook의 top level에서 같은 순서로 호출해야 한다. 조건문·반복문·event handler·`try/catch` 안에서 일반 Hook을 호출할 수 없는 이유다.

```tsx
function Profile({ enabled }: { enabled: boolean }) {
  // 잘못된 예: enabled가 바뀌면 뒤 Hook의 슬롯 번호가 달라진다.
  if (enabled) {
    const profile = useProfile();
    return <ProfileView profile={profile} />;
  }

  return null;
}
```

Hook을 항상 호출하고 내부 동작을 입력으로 제어하거나, 조건부 subtree를 별도 컴포넌트로 분리한다.

```tsx
function Profile({ enabled }: { enabled: boolean }) {
  return enabled ? <EnabledProfile /> : null;
}

function EnabledProfile() {
  const profile = useProfile();
  return <ProfileView profile={profile} />;
}
```

### 의도 이름은 lifecycle 이름보다 강한 계약이다

`useMount`, `useEffectOnce`, `useUpdateEffect`는 실행 시점을 말하지만 무엇과 동기화하는지 말하지 않는다. `useChatRoom`, `useDocumentTitle`, `useOnlineStatus`는 호출자의 의도를 드러내고 구현을 바꿀 여지를 남긴다.

```tsx
type Connection = {
  connect(): void;
  disconnect(): void;
};

type ChatConnector = {
  create(roomId: string): Connection;
};

function useChatRoom(roomId: string, connector: ChatConnector) {
  useEffect(() => {
    const connection = connector.create(roomId);
    connection.connect();
    return () => connection.disconnect();
  }, [connector, roomId]);
}
```

이 API에는 중요한 계약이 보인다.

- `roomId`가 바뀌면 이전 연결을 정리하고 새로 연결한다.
- 외부 시스템은 `ChatConnector` 포트로 주입하므로 테스트에서 fake로 바꿀 수 있다.
- `connector`의 참조가 매 렌더 바뀌면 재연결한다. 호출자는 모듈 singleton 또는 안정된 provider 값을 전달해야 한다.
- 연결 오류·재연결 상태를 UI가 알아야 한다면 `void` 반환으로는 부족하다. 판별 유니언 상태를 반환하도록 확장해야 한다.

즉 dependency array를 감춘 것이 API 설계가 아니다. **어떤 입력 변화가 외부 시스템 재동기화를 일으키는지**가 공개 의미다.

### Effect가 필요 없는 파생 상태를 먼저 제거한다

```tsx
// 잘못된 예: items나 query 변경 → 낡은 화면 한 번 → Effect → 추가 렌더
function useFilteredItems(items: Item[], query: string) {
  const [filtered, setFiltered] = useState(items);

  useEffect(() => {
    setFiltered(items.filter((item) => item.name.includes(query)));
  }, [items, query]);

  return filtered;
}
```

이는 외부 시스템 동기화가 아니라 렌더 입력의 계산이다. 일반 함수 또는 렌더 중 계산으로 충분하다.

```tsx
function filterItems(items: Item[], query: string) {
  return items.filter((item) => item.name.includes(query));
}

function ItemList({ items, query }: { items: Item[]; query: string }) {
  const filtered = filterItems(items, query);
  return <List items={filtered} />;
}
```

계산이 실제로 무겁다는 Profiler 증거가 생긴 뒤에만 memoization을 검토한다. “재사용하고 싶다”가 “Hook이어야 한다”는 뜻도 아니다. 다른 Hook을 호출하지 않는 계산 함수에 `use` 접두사를 붙이면 조건부 호출이 불필요하게 금지된다.

### 반환 API: 위치 의미와 이름 의미를 구분한다

두 값의 역할이 표준적이고 순서가 안정적이면 tuple이 간결하다.

```tsx
function useDisclosure(initialOpen = false) {
  const [open, setOpen] = useState(initialOpen);
  return [open, setOpen] as const;
}
```

상태·오류·여러 action처럼 필드가 늘거나 일부만 소비하면 object가 낫다.

```tsx
type AsyncState<T> =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

type SearchController<T> = {
  state: AsyncState<T>;
  submit(query: string): Promise<void>;
  cancel(): void;
};
```

`[data, loading, error, refetch, cancel]`은 위치를 외워야 하고 중간 필드 추가가 breaking change다. object는 이름이 문서 역할을 하지만 매 렌더 새 객체가 생길 수 있다. 이 객체를 Context value나 memoized child prop으로 넘겨 실제 문제가 관찰될 때만 참조 안정화를 고려한다.

선언형 입력과 명령형 action도 분리한다.

- `useChatRoom(roomId)`의 `roomId`는 현재 연결되어야 할 대상을 선언한다.
- `send(message)`는 사용자 event가 발생했을 때 실행하는 명령이다.
- `reconnectOnError` 같은 정책은 option으로 선언할 수 있다.
- `connectNow()`로 lifecycle 전체를 호출자에게 맡기면 Hook이 React 동기화 adapter라는 이점을 잃는다.

### 외부 구독은 `useSyncExternalStore` 계약을 검토한다

브라우저나 별도 store가 이미 원본이라면 `useEffect + useState`로 복사본을 만들기보다 `useSyncExternalStore`가 맞는 경우가 있다.

```tsx
import { useSyncExternalStore } from "react";

function subscribeOnlineStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);

  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

function getServerOnlineSnapshot() {
  return true;
}

export function useOnlineStatus() {
  return useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    getServerOnlineSnapshot,
  );
}
```

`subscribe`는 listener를 등록하고 cleanup을 반환한다. `getSnapshot`은 store가 바뀌지 않았다면 `Object.is` 기준으로 같은 값을 반환해야 한다. SSR을 사용하면 `getServerSnapshot`이 hydration의 초기 계약이 된다. 서버에서 무조건 `true`라고 가정한 UI가 중요한 의미를 가진다면 “unknown” 상태를 별도 모델링하는 편이 정직하다.

모든 Effect를 이 Hook으로 바꾸라는 뜻은 아니다. 외부에 **구독 가능한 원본과 읽을 snapshot**이 있을 때 적합하다. 네트워크 요청처럼 명령·취소·오류 전이가 있는 작업은 별도 async state machine이나 framework/server-state 계층이 필요하다.

### 오류와 취소는 반환 타입에서 사라지면 안 된다

```tsx
type RequestState<T> =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error }
  | { status: "cancelled" };
```

`{ data, loading }`만 반환하면 오류와 취소가 둘 다 `loading === false`로 뭉개진다. 호출자는 재시도 버튼, 취소 메시지, 마지막 성공 데이터 유지 여부를 결정할 수 없다. 비동기 Hook의 반환 타입은 UI가 구분해야 하는 상태 전이를 보존해야 한다. 스트리밍처럼 더 복잡한 전이는 [5a-6 AI UI Patterns](./06-ai-ui-patterns.md)에서 확장한다.

### React 19의 `use`와 Action 계열은 서로 다른 경계를 표현한다

이 API들은 “비동기 Hook 모음”이 아니라 소유권이 다르다.

| API | 표현하는 경계 | 핵심 제약 |
|---|---|---|
| `use(resource)` | Context 또는 cached Promise의 값을 렌더가 읽고 Suspense/Error Boundary에 위임 | 이름과 달리 일반 Hook이 아니어서 조건문·반복문에서 호출 가능하다. Promise는 렌더마다 새로 만들지 않는다 |
| `useActionState(action, initial)` | Action의 결과 state와 pending | 반환은 `[state, dispatchAction, isPending]`; 수동 dispatch는 Transition 안에서 실행한다 |
| `useFormStatus()` | 가장 가까운 **부모 form**의 마지막 제출 상태 | form을 렌더하는 같은 컴포넌트가 아니라 그 하위 컴포넌트에서 호출한다 |
| `useOptimistic(value, reducer?)` | Action이 진행되는 동안 보일 낙관적 view | 서버 원본을 대체하지 않으며 실패 시 확정 값으로 수렴하는 정책이 필요하다 |

```tsx
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "저장 중…" : "저장"}
    </button>
  );
}

function ProfileForm({ save }: { save(formData: FormData): Promise<void> }) {
  return (
    <form action={save}>
      <input name="displayName" />
      <SubmitButton />
    </form>
  );
}
```

`use`는 Promise를 fetch cache로 만들어 주지 않는다. `useActionState`는 범용 서버 상태 cache가 아니다. `useOptimistic`은 성공을 보장하지 않는다. 각 API가 framework·Suspense·form Action 경계와 결합한다는 점을 보고 선택한다.

## 실무 관점

### Hook이 숨겨도 되는 것과 드러내야 하는 것

숨겨도 되는 것은 브라우저 event 등록, controller 생성, 정리 순서 같은 기계적 절차다. 호출자의 제품 결정을 숨기면 안 된다.

| 결정 | Hook이 임의로 고정하면 생기는 문제 |
|---|---|
| 재시도 횟수 | 중복 mutation이나 과도한 트래픽을 만들 수 있다 |
| 오류 표시 | toast와 inline error가 중복될 수 있다 |
| cache 수명 | 화면마다 데이터 신선도 요구가 다른데 하나로 고정된다 |
| 권한 실패 처리 | redirect·403 view·로그인 dialog 중 제품 흐름이 사라진다 |
| cancel 시 마지막 데이터 유지 | 사용자에게 보이는 상태 의미가 달라진다 |

기계적 로직과 제품 정책을 option·callback·상위 boundary로 분리한다. option 수가 계속 늘면 하나의 범용 Hook이 너무 많은 변경 축을 소유하는 신호다.

### stale closure는 추상화 뒤에서도 그대로다

custom hook 안의 Effect도 컴포넌트 렌더의 closure다. dependency를 생략하면 추상화 밖에서 보이지 않을 뿐 오래된 값을 읽는다. 해결 순서는 [5-4 Effect](../phase-5/04-effects.md)와 같다.

1. Effect 자체가 불필요한 파생 계산인지 확인한다.
2. state 갱신만 필요하면 함수형 updater로 읽기 의존성을 제거한다.
3. 외부 동기화에 필요한 반응형 값은 dependency에 포함한다.
4. event 의미의 로직과 동기화 의미의 Effect를 분리한다.
5. linter를 끄는 주석으로 계약을 숨기지 않는다.

### HOC·Render Props에서 점진적으로 전환한다

기존 wrapper의 외부 API를 한 번에 없앨 필요는 없다.

```tsx
function withOnlineStatus<P extends object>(
  View: ComponentType<P & { online: boolean }>,
) {
  return function OnlineStatusAdapter(props: P) {
    const online = useOnlineStatus();
    return <View {...props} online={online} />;
  };
}
```

내부 로직을 Hook으로 모은 뒤 기존 HOC는 얇은 adapter로 유지한다. 새 소비자는 Hook을 직접 쓰고, 기존 소비자를 단계적으로 옮긴다. Render Props도 owner component가 실제 DOM·focus·portal을 소유하지 않는다면 같은 방식으로 평탄화할 수 있다([5a-5](./05-render-props-pattern.md)).

### 관찰 실험

**실험 1 — 로직과 상태의 구분**

1. `useCounter`를 두 sibling에서 호출한다.
2. 한쪽만 증가시켜 다른 쪽 값이 유지되는지 본다.
3. 두 값이 함께 움직여야 한다면 state를 공통 부모로 올리고 두 컴포넌트에 같은 controller를 전달한다.
4. “Hook 공유”와 “state 공유”의 tree를 각각 그린다.

**실험 2 — 불필요한 Effect 제거**

1. `items + query → filtered`를 Effect와 state로 구현한다.
2. query 한 번 변경 시 렌더 로그와 커밋을 기록한다.
3. 렌더 중 계산으로 바꾸고 중간의 stale view와 추가 commit이 사라지는지 확인한다.
4. 목록이 매우 클 때만 Profiler로 계산 시간을 측정해 memoization 여부를 결정한다.

**실험 3 — 외부 store 계약**

`useOnlineStatus`를 두 컴포넌트에서 호출하고 offline/online event를 발생시킨다. UI는 같은 외부 snapshot을 보지만 각 컴포넌트가 독립 consumer임을 DevTools에서 확인한다. `getSnapshot`이 매번 새 객체를 반환하는 잘못된 버전도 만들어 무한 갱신 경고 또는 불필요한 렌더를 관찰한다.

### 선택 체크리스트

- 반복되는 것이 stateful React 로직인가, Hook이 필요 없는 일반 계산인가?
- 각 호출이 독립 state를 가져도 되는가? 공유해야 한다면 원본은 어디인가?
- 이름이 lifecycle이 아니라 사용자·외부 시스템의 의도를 나타내는가?
- 반응형 입력, cleanup, 오류, 취소와 SSR snapshot이 API에 드러나는가?
- tuple 위치가 안정적인가, object 필드가 더 읽기 쉬운가?
- 외부 시스템을 포트로 주입해 결정적 테스트를 만들 수 있는가?
- 서버 상태 cache나 framework Action을 custom hook으로 다시 만들고 있지 않은가?

## 정리

- custom hook은 호출한 컴포넌트의 Hook 호출을 묶어 로직을 재사용하며, 호출 간 state cell을 공유하지 않는다.
- 좋은 Hook은 Effect를 숨기는 파일이 아니라 React 렌더 모델과 외부 protocol 사이의 adapter다.
- 파생 계산은 일반 함수/렌더 계산으로 두고, 구독 가능한 외부 원본에는 `useSyncExternalStore`를 검토한다.
- 비동기 상태는 `loading` boolean보다 판별 유니언으로 오류·취소·성공을 보존한다.
- `use`, `useActionState`, `useFormStatus`, `useOptimistic`은 Suspense·Action·form·낙관적 view라는 서로 다른 소유권을 표현한다.
- HOC와 Render Props의 순수 로직은 Hook으로 옮기되 실제 tree owner는 wrapper로 남길 수 있다.

## 확인 문제

**Q1.** 두 컴포넌트가 `useCart()`를 호출했는데 장바구니가 서로 다르다. Hook 내부 코드를 모듈 singleton으로 바꾸지 않고 원인을 설명하고 설계를 수정하라.

<details>
<summary>정답과 해설</summary>

custom hook 호출마다 호출한 컴포넌트 인스턴스의 별도 state cell이 생기므로 정상 동작이다. 장바구니처럼 같은 값을 수정해야 하면 공통 부모나 기능 Provider가 하나의 state 원본을 소유하고, `useCart`는 그 Context를 읽는 adapter가 되어야 한다. 새로고침을 넘어 유지해야 한다면 서버나 storage 동기화 책임도 별도로 정한다.
</details>

**Q2.** `useFilteredItems`가 Effect에서 `setFiltered`를 호출한다. dependency가 정확한데도 이 설계가 나쁜 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

필터 결과는 외부 시스템이 아니라 현재 렌더의 `items`와 `query`에서 완전히 계산된다. Effect 버전은 입력이 바뀐 뒤 낡은 결과로 한 번 렌더하고, 커밋 뒤 state를 갱신해 추가 렌더를 만든다. 렌더 중 계산하거나 일반 함수로 추출한다. 실제 계산 비용이 측정된 경우에만 memoization한다.
</details>

**Q3.** `useFormStatus()`를 form을 렌더하는 컴포넌트 상단에서 호출했더니 `pending`이 계속 false다. Hook 규칙 위반은 아닌데 왜 그런가?

<details>
<summary>정답과 해설</summary>

`useFormStatus`는 호출한 컴포넌트가 렌더하는 form이 아니라 tree 위쪽의 가장 가까운 부모 form 상태를 읽는다. submit button 같은 하위 컴포넌트로 호출을 옮기고 그 컴포넌트를 form 안에 렌더해야 한다. 이는 호출 순서가 아니라 tree 소유권 계약이다.
</details>

## 참고 자료

- [React — Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks) — top-level과 React 함수 호출 제약을 확인한다.
- [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — 로직과 state 공유의 구분, 이름·추출 기준을 확인한다.
- [React — `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore) — 외부 snapshot·subscribe·server snapshot 계약을 확인한다.
- [React — `use`](https://react.dev/reference/react/use) — Context/Promise 읽기, 조건부 호출, Suspense와 cache caveat를 확인한다.
- [React — `useActionState`](https://react.dev/reference/react/useActionState), [`useOptimistic`](https://react.dev/reference/react/useOptimistic), [React DOM — `useFormStatus`](https://react.dev/reference/react-dom/hooks/useFormStatus) — React 19 Action·form 상태 API의 현재 signature와 경계를 확인한다.
- [Patterns.dev — Hooks Pattern](https://www.patterns.dev/react/hooks-pattern/) — 패턴의 문제 설정을 위한 2차 자료다.
