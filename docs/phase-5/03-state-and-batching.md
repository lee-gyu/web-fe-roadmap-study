# 5-3. 상태와 배칭

> 한 줄 요약: 이 문서를 읽고 나면 훅이 호출 순서로 식별되는 이유, 상태 갱신의 스냅샷 의미론과 자동 배칭 규칙을 근거로 "이 핸들러가 끝나면 몇 번 렌더되고 값은 무엇인가"를 예측할 수 있다.

이 문서는 React 19 기준이다.

## 학습 목표

- 훅 상태가 어디에 저장되고 어떻게 자기 슬롯을 찾는지 설명하고, 훅 규칙(최상위 호출)을 스타일 가이드가 아니라 식별 메커니즘의 요구사항으로 설명할 수 있다.
- `setCount(count + 1)`을 연달아 불러도 1만 오르는 동작을 클로저 스냅샷으로 설명하고, 함수형 갱신이 언제 필요한지 판단할 수 있다.
- 자동 배칭의 규칙(무엇이 묶이고 리렌더는 언제 도는가)과 `flushSync` 탈출구의 비용을 설명할 수 있다.
- 불변 갱신이 관례가 아니라 React 변경 감지(`Object.is`)의 전제임을 설명하고, 제어/비제어 컴포넌트의 선택 기준을 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

[5-1](./01-react-mental-model.md)에서 렌더는 함수 재실행이고 지역 변수는 매번 초기화된다고 했다. 그렇다면 렌더를 넘어 살아남는 값 — 상태 — 은 함수 밖 어딘가에 있어야 하고, 재실행된 함수가 그것을 다시 찾아올 방법이 있어야 한다. `useState`는 이 두 문제(보관, 식별)의 해법이고, 이 문서는 그 해법의 규칙들을 다룬다.

이 규칙들이 낯선 이유는 상태 갱신이 **대입이 아니기 때문**이다. 대부분의 언어 경험에서 `x = x + 1`은 즉시 반영되고 다음 줄에서 새 값이 읽힌다. React의 `setCount(count + 1)`은 그렇지 않다 — 다음 줄의 `count`는 여전히 옛 값이다. 백엔드 경험에 빗대면 이것은 MVCC 데이터베이스의 트랜잭션과 같은 구조다: **읽기는 트랜잭션 시작 시점의 스냅샷에서, 쓰기는 커밋 요청으로 큐에, 반영은 커밋(리렌더) 때 일괄로.** 이 모델을 받아들이면 "왜 setState가 비동기인가"라는 잘못된 질문("비동기"가 아니라 "다음 렌더에 반영") 대신 정확한 예측이 가능해진다.

이 설계는 임의의 선택이 아니다. 갱신이 즉시 반영되면 핸들러 중간에 화면이 여러 번 그려지고(성능), 같은 렌더 안에서 읽는 값이 시점에 따라 달라진다(일관성 — 한 화면의 절반은 옛 값, 절반은 새 값으로 그려지는 것을 막는다). React는 "한 렌더 안의 값은 고정"을 불변식으로 삼고, 그 대가로 "갱신 직후 읽기"를 포기했다.

## 핵심 개념

### useState의 내부 — 훅은 호출 순서로 식별된다

훅 상태는 컴포넌트 함수 밖, React가 유지하는 인스턴스(현 구현은 Fiber 노드, [5-2](./02-rendering-and-reconciliation.md))에 산다. 그런데 `useState`에는 키가 없다 — `useState('name')`처럼 이름을 주지 않는데 어떻게 자기 값을 찾는가?

답은 **호출 순서**다. React는 컴포넌트별로 훅 상태의 연결 리스트를 유지하고, 렌더 중 커서를 하나 둔다. n번째 훅 호출은 리스트의 n번째 슬롯을 받는다. 단순화한 모델:

```js
// React 내부의 단순화 모델 (실제 구현이 아니라 동작 원리의 스케치)
let hookSlots = [];   // 이 컴포넌트 인스턴스의 훅 슬롯 (렌더 간 유지)
let cursor = 0;       // 렌더마다 0으로 리셋

function useState(initial) {
  const i = cursor++;                       // 이번 호출은 i번째 슬롯
  if (hookSlots[i] === undefined) hookSlots[i] = initial;  // 최초 마운트에만 초기값 사용
  const setState = (next) => { hookSlots[i] = next; scheduleRerender(); };
  return [hookSlots[i], setState];
}
```

이 메커니즘에서 훅 규칙이 **유도된다**. 조건문 안에서 훅을 호출하면 렌더마다 호출 횟수가 달라지고, 커서가 어긋나 두 번째 렌더의 `useState`가 엉뚱한 슬롯을 받는다 — 이름 없는 식별이므로 순서가 곧 신원이다. "항상 최상위에서 호출하라"는 규칙은 스타일이 아니라 이 식별 방식의 요구사항이고, ESLint 규칙(`rules-of-hooks`)이 정적으로 강제하는 이유다. 왜 이름 대신 순서인가는 더 깊이에서 다룬다.

`useState(initial)`의 `initial`이 최초 마운트에만 쓰인다는 것도 이 모델에서 바로 나온다 — 이후 렌더에서는 슬롯에 이미 값이 있다. `useState(expensiveCompute())`가 매 렌더 계산을 낭비하는 이유(인자는 어쨌든 평가된다)와, 지연 초기화 `useState(() => expensiveCompute())`가 있는 이유도 여기 있다.

### 스냅샷 의미론 — 한 렌더의 값은 고정이다

렌더 한 번의 `count`는 그 실행에서 만들어진 지역 상수이고, 그 렌더가 만든 이벤트 핸들러는 [클로저](../phase-3/02-closures-and-functions.md)로 그 값을 캡처한다. 유명한 퀴즈를 실측하면:

```jsx
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => {
      setCount(count + 1); // 이 렌더의 count는 0 → setCount(1)
      setCount(count + 1); // count는 여전히 0 → setCount(1)
      setCount(count + 1); // count는 여전히 0 → setCount(1)
    }}>{count}</button>
  );
}
// 클릭 후 출력: render, count = 1   ← 3이 아니다
```

`count`는 변수 감시 장치가 아니라 그냥 값이다. 핸들러 세 줄이 전부 "0 + 1을 예약"했으므로 결과는 1이다. `setCount` 뒤에 `console.log(count)`를 찍어도 옛 값이 나오는 것(실측: `핸들러 안에서 읽은 count: 6` — 갱신을 예약해도 이번 렌더의 클로저 값은 불변) 역시 같은 원리다.

"이전 값 기반으로 갱신"이 의도라면 값을 주는 대신 **갱신 함수**를 준다:

```jsx
setCount(c => c + 1); // "큐 앞까지 적용된 값을 받아 +1" — 스냅샷이 아니라 큐를 읽는다
setCount(c => c + 1);
setCount(c => c + 1);
// 클릭 후 출력: render, count = 3
```

React는 리렌더 때 큐를 순서대로 실행한다: 값이면 교체, 함수면 직전 결과에 적용. 판단 기준은 하나다 — **새 값이 이전 값에 의존하면 함수형, 아니면 값**. 특히 한 핸들러에서 여러 번 갱신하거나, 비동기 콜백([5-4](./04-effects.md)의 이펙트 안 등)에서 갱신할 때 함수형이 스냅샷 문제를 원천 차단한다.

### 자동 배칭 — 리렌더는 큐가 마르면 한 번

위 실측에서 또 하나 볼 것: `setCount`를 세 번 불렀는데 렌더 로그는 **한 번**이다. React는 갱신마다 리렌더하지 않고, 갱신을 큐에 모았다가 실행 컨텍스트가 끝나면 한 번의 렌더로 처리한다(배칭). 핸들러 중간의 미완성 상태로 화면이 그려지는 일을 막고 렌더 횟수를 줄인다.

React 17까지는 React 이벤트 핸들러 안에서만 배칭됐고, `setTimeout`·Promise 콜백·네이티브 이벤트에서는 갱신마다 렌더가 돌았다. React 18의 `createRoot`부터는 **어디서 갱신하든** 배칭된다(automatic batching):

```jsx
setTimeout(() => {
  setCount(c => c + 1);
  setCount(c => c + 1); // 18+: 이 둘도 한 번의 렌더로 묶인다
}, 0);
// 출력: render, count = 6   ← 렌더 로그 한 번 (17 이전이라면 두 번)
```

배칭을 뚫어야 하는 경우 — 갱신이 DOM에 반영된 직후 그 DOM을 읽어야 할 때(스크롤 위치 계산, 포커스 이동 등) — 를 위한 탈출구가 `flushSync`다:

```jsx
import { flushSync } from 'react-dom';

flushSync(() => setN(1));            // 이 안의 갱신을 동기로 렌더+커밋까지 완료
console.log(container.textContent);  // 출력: 1   ← DOM이 이미 반영됨
setN(2);                             // 일반 갱신 — 아직 DOM은 1
console.log(container.textContent);  // 출력: 1
// 핸들러 종료 후 DOM: 2
```

`flushSync`는 배칭의 이점을 그 지점에서 포기하는 것이다 — 호출마다 렌더+커밋이 동기로 돌므로 루프 안에서 쓰면 배칭이 없던 시절로 돌아간다. "상태 갱신 직후 DOM 측정"이라는 좁은 용도 밖에서 보이면 설계를 의심한다.

### 불변성 — 관례가 아니라 감지 메커니즘의 전제

React가 "상태가 바뀌었는가"를 판정하는 방법은 단 하나, `Object.is` 참조 비교다. 깊은 비교는 하지 않는다 — 큰 상태 트리의 깊은 비교는 비용을 예측할 수 없고, React는 그 비용을 지불하지 않기로 했다. 귀결: **객체를 변형(mutate)하고 같은 참조를 넘기면 갱신은 무시된다.**

```jsx
const [user, setUser] = useState({ name: 'kim' });

// ❌ 변형 + 같은 참조: Object.is(user, user) === true → 갱신 없음으로 판정
user.name = 'lee';
setUser(user);
// 실측: 렌더 로그 없음, DOM은 'kim' 그대로

// ✅ 새 객체: 참조가 다르므로 갱신으로 판정
setUser({ ...user, name: 'park' });
// 실측: Form render: park
```

더 나쁜 것은 이 버그가 간헐적으로 "동작해 보인다"는 점이다 — 다른 상태 갱신이 함께 일어나면 리렌더에 묻어가서 변형된 값이 화면에 나온다. 그러다 memo([5-5](./05-performance-model.md))가 붙는 순간 얕은 비교가 "변경 없음"으로 판정해 갱신이 사라진다. 변형은 즉시 티가 나지 않고 최적화를 붙일 때 터지는 부채다.

[3-4](../phase-3/04-object-model.md)의 참조 모델이 그대로 적용된다: 스프레드(`{ ...user, name }`)는 한 단계 얕은 복사이므로, 중첩 갱신은 경로의 각 단계를 새로 만든다(`{ ...state, address: { ...state.address, city } }`). 이 보일러플레이트가 부담스러운 규모가 되면 Immer 같은 도구(변형 문법 → 불변 갱신으로 변환)나 상태 구조 자체의 평탄화를 검토한다.

### 제어 컴포넌트와 폼 — 상태의 이중 소유 문제

`<input>`은 React 없이도 자기 상태(입력값)를 가진 DOM이다([3-7](../phase-3/07-dom-and-events.md)). React 상태와 DOM 상태, 두 소유자가 생기는 지점이고, 누가 원본인가에 따라 두 패턴이 갈린다.

```jsx
// 제어(controlled): React 상태가 원본. value가 렌더마다 DOM을 덮는다
<input value={text} onChange={e => setText(e.target.value)} />

// 비제어(uncontrolled): DOM이 원본. defaultValue는 마운트 시 한 번만
<input defaultValue={initial} ref={inputRef} />  // 읽을 때 inputRef.current.value
```

제어는 타이핑마다 렌더가 돌아 "입력값에 반응하는 UI"(실시간 검증, 조건부 활성화, 입력 포맷팅)가 자연스럽다. 비용은 입력마다 렌더 — 무거운 트리에서 타이핑이 버벅이면 이 비용이다. 비제어는 렌더 비용이 0이지만 값이 React 세계 밖에 있어 "값에 반응하는" 것을 못 한다. 기준: **입력 중에 그 값으로 무언가 해야 하면 제어, 제출 시점에만 필요하면 비제어**.

React 19의 폼 액션은 세 번째 선택지를 더한다 — `<form action={fn}>`으로 제출을 함수에 연결하면 React가 `FormData`를 넘겨주고 제출 상태(`useFormStatus`) 등을 관리한다. "필드 상태를 일일이 제어하지 않고 제출 단위로 다룬다"는 점에서 비제어 쪽 계보이고, 서버 액션(7-6)과 이어지는 API다. 여기서는 위치만 확인한다.

## 실무 관점

### "setState가 반영이 안 돼요"의 감별 진단

증상은 하나("갱신했는데 값이 옛날 것")지만 원인은 세 갈래이고, 처방이 다르다.

| 원인 | 식별법 | 처방 |
|---|---|---|
| 스냅샷 읽기 (갱신 직후 같은 렌더에서 읽음) | `set` 다음 줄의 `console.log` | 다음 렌더의 값을 기다리거나, 계산값이 필요하면 지역 변수로 (`const next = count + 1; setCount(next); use(next)`) |
| 이전 값 기반 연속 갱신 | 같은 핸들러/틱에 `set` 여러 번 | 함수형 갱신 `set(c => ...)` |
| 변형 + 같은 참조 | 렌더 로그 자체가 없음 | 불변 갱신 (새 객체/배열) |

첫 번째가 가장 흔한 오해다: "setState는 비동기라서 그렇다"는 설명은 부정확하다 — 갱신은 비동기가 아니라 **다음 렌더의 일**이고, 이번 렌더의 변수는 정의상 불변이다. 이 구분이 되면 "await하면 되나요?" 같은 잘못된 시도가 사라진다.

### 상태 갱신 설계의 기본값

- 이전 값에 의존하는 갱신은 항상 함수형으로. 특히 핸들러 밖(타이머, 구독 콜백, 이펙트)에서의 갱신은 스냅샷이 얼마나 오래된 것인지 보장이 없으므로 함수형이 기본값이다 — 이것이 [5-4](./04-effects.md)에서 의존성을 줄이는 핵심 도구로 재등장한다.
- 연관된 상태 여러 개를 개별 `useState`로 두고 항상 같이 갱신하고 있다면, 하나의 객체로 합치거나 `useReducer`로 전이를 명시한다. 상태 모양이 "불가능한 조합"을 허용하고 있다면 [4-2](../phase-4/02-type-design.md)의 판별 유니언으로 상태를 재설계한다 — `{ status: 'loading' } | { status: 'success', data }` 형태의 reducer 상태는 타입 설계와 상태 설계가 만나는 지점이다.
- 파생 가능한 값(필터된 목록, 합계)은 상태로 두지 않는다. 상태 두 개의 동기화는 [5-1](./01-react-mental-model.md)에서 없앤 M×N 문제를 컴포넌트 안에 재도입하는 것이다 — 렌더 중 계산이 기본값이고, 비싸면 [5-5](./05-performance-model.md)의 useMemo다.

### 배칭 경계에서의 사고

배칭은 "실행 컨텍스트가 끝나면"이므로, `await`가 사이에 끼면 경계가 갈린다: `set(a); await fetch(...); set(b)`는 두 번의 렌더다(첫 배치는 await에서 컨텍스트가 끝날 때 처리). 핸들러가 async일 때 "await 앞 갱신은 반영됐는데 뒤는 나중에"가 보이면 이 경계다. 문제가 되면 await 이후 한 번에 갱신하도록 재배치한다.

## 더 깊이

### 왜 이름이 아니라 호출 순서인가

훅 설계 시점(2018, RFC)에 대안들이 검토되었다. 키 문자열(`useState('count')`)은 오타·중복이 런타임 버그가 되고, 커스텀 훅 두 개가 같은 키를 쓰면 충돌한다 — 순서 기반은 커스텀 훅이 내부적으로 훅을 몇 개 쓰든 호출 지점이 곧 네임스페이스가 되어 합성이 안전하다. 클래스 인스턴스 필드(당시 현역)는 `this` 바인딩 문제와 로직 재사용의 어려움(mixin, HOC의 실패)이 이미 확인된 상태였다. 즉 호출 순서는 "키 관리 없는 안전한 합성"을 위해 "조건부 호출 금지"를 지불한 트레이드오프다. 이 대가는 정적 분석(린트)으로 상쇄 가능하다는 계산이 깔려 있다.

실제 구현에서 훅 슬롯은 배열이 아니라 Fiber의 `memoizedState`에 걸린 연결 리스트이고, 각 `useState` 슬롯은 갱신 큐(pending queue)를 함께 가진다. `setState`는 큐에 갱신 객체를 연결하고 스케줄러에 리렌더를 예약하며, 다음 렌더의 `useState` 호출이 큐를 소비해 새 값을 계산한다 — 본문의 "값이면 교체, 함수면 적용"이 이 소비 과정이다.

### 갱신에도 우선순위가 있다 — lane 모델

React 18+의 스케줄러는 갱신을 lane(우선순위 비트)으로 분류한다. 같은 배치라도 긴급 갱신(입력)과 전환 갱신(`startTransition` 안)은 다른 lane이며, 렌더 중 더 급한 lane이 도착하면 진행 중 렌더를 폐기하고 급한 것부터 처리한다([5-2](./02-rendering-and-reconciliation.md)의 동시성 렌더링). "배칭 = 같은 우선순위 갱신의 묶음"이 더 정확한 서술인 이유다. lane 개수·의미는 구현 세부로 버전마다 바뀌므로, 가져갈 것은 "갱신은 균질하지 않고 React가 스케줄링 재량을 갖는다"는 모델이다.

### `useState`는 `useReducer`다

내부적으로 `useState`는 `useReducer(basicStateReducer, initial)`과 같은 경로를 탄다 — `basicStateReducer`는 "액션이 함수면 적용, 아니면 교체"뿐인 reducer다. 함수형 갱신이 자연스럽게 존재하는 이유가 이것이다(갱신 함수가 곧 액션). 반대로 보면 `useReducer`는 "갱신 로직을 컴포넌트 밖 순수 함수로 추출한 useState"이고, 전이가 여러 종류거나 다음 상태가 여러 필드에 걸칠 때 reducer가 전이를 한 곳에 모아 테스트 가능하게 만든다.

## 정리

- 훅 상태는 컴포넌트 밖(Fiber)에 살고 호출 순서로 자기 슬롯을 찾는다. 훅 규칙은 이 식별 방식의 요구사항이며, 순서 기반은 키 관리 없는 커스텀 훅 합성을 위한 트레이드오프다.
- 한 렌더의 props/state는 클로저에 고정된 스냅샷이다. `set` 직후 읽기는 옛 값이고, 이전 값 기반 갱신은 함수형(`c => c + 1`)으로 큐를 읽는다.
- 갱신은 큐에 모여 실행 컨텍스트 종료 후 한 번의 렌더로 처리된다(18+에서는 타이머·Promise 안까지). 갱신 직후 DOM을 읽어야 할 때만 `flushSync`로 뚫는다.
- 변경 감지는 `Object.is` 참조 비교뿐이다. 변형 + 같은 참조는 갱신 무시이고, 당장 티가 안 나도 memo가 붙는 순간 터진다. 불변 갱신이 전제다.
- 폼 입력은 제어(React가 원본 — 입력에 반응해야 할 때)와 비제어(DOM이 원본 — 제출 시점만 필요할 때)로 소유자를 정하고 시작한다.

## 확인 문제

**Q1.** 다음 핸들러 실행 후 화면의 값과 렌더 횟수를 예측하고 근거를 설명하라. (초기값 `count = 0`)

```jsx
const onClick = () => {
  setCount(count + 5);
  setCount(c => c + 1);
  setCount(count + 2);
  setCount(c => c * 10);
};
```

<details>
<summary>정답과 해설</summary>

값은 20, 렌더는 1번이다. 네 갱신은 배칭되어 큐에 쌓이고, 다음 렌더에서 순서대로 소비된다: ① `count + 5` — 이 렌더의 스냅샷 `count = 0`으로 평가된 값 5로 교체 → 5. ② 함수형 — 직전 결과에 적용 → 6. ③ `count + 2` — 역시 스냅샷 0으로 평가된 값 2로 **교체** → 2 (직전 결과 6을 덮는다. 값 갱신은 큐의 앞선 결과를 무시한다). ④ 함수형 → 20. 핸들러가 끝나면 큐가 한 번에 처리되므로 렌더는 한 번이고 화면은 20이다. 값 갱신과 함수형 갱신을 한 큐에 섞으면 이렇게 추적이 어려워지므로, 이전 값 의존 갱신은 전부 함수형으로 통일하는 것이 실무 기본값이다.
</details>

**Q2.** 장바구니 수량 버튼이 "가끔" 동작하지 않는다는 리포트가 왔다. 코드는 다음과 같고, 렌더 로그를 붙였더니 안 되는 경우에는 로그 자체가 안 찍힌다. 원인과 이 버그가 "가끔"만 재현되는 이유, 수정을 설명하라.

```jsx
const [cart, setCart] = useState({ items: [] });
const increment = (id) => {
  const item = cart.items.find(i => i.id === id);
  item.qty += 1;
  setCart(cart);
};
```

<details>
<summary>정답과 해설</summary>

원인: `item`은 `cart.items` 안의 객체 참조이므로 `item.qty += 1`은 기존 상태의 변형이고, `setCart(cart)`는 같은 참조를 넘긴다. React의 변경 감지는 `Object.is(이전, 새값)`뿐이므로 "변경 없음"으로 판정, 리렌더 자체가 스케줄되지 않는다(로그가 안 찍히는 이유).

"가끔" 되는 이유: 데이터는 이미 변형되어 있으므로, 다른 원인(다른 상태 갱신, 부모 리렌더)으로 이 컴포넌트가 렌더되기만 하면 변형된 `qty`가 화면에 나온다. 즉 버튼 직후 다른 상호작용이 있으면 동작한 것처럼 보인다 — 전형적인 변형 버그의 위장이다.

수정: 경로를 불변으로 재구성한다. `setCart(prev => ({ ...prev, items: prev.items.map(i => i.id === id ? { ...i, qty: i.qty + 1 } : i) }))`. 이전 값 기반이므로 함수형 갱신까지 적용하는 것이 맞다.
</details>

**Q3.** "추가" 버튼을 누르면 목록 맨 아래에 항목을 추가하고 그 항목으로 스크롤해야 한다. 다음 코드는 항상 **직전 항목**까지만 스크롤된다. 원인을 이 문서의 두 개념으로 설명하고 수정하라.

```jsx
const add = () => {
  setItems([...items, newItem]);
  listRef.current.lastElementChild.scrollIntoView();
};
```

<details>
<summary>정답과 해설</summary>

원인은 두 겹이다. ① 스냅샷/큐: `setItems`는 갱신을 예약할 뿐이고, ② 배칭: 렌더+커밋은 핸들러가 끝난 뒤 일어난다. 따라서 `scrollIntoView()` 시점의 DOM에는 새 항목이 아직 없고, `lastElementChild`는 직전 항목이다.

수정: 이것이 정확히 `flushSync`의 용도다 — "갱신이 DOM에 반영된 직후 그 DOM을 읽어야 하는" 경우.

```jsx
import { flushSync } from 'react-dom';
const add = () => {
  flushSync(() => setItems(prev => [...prev, newItem])); // 동기로 렌더+커밋 완료
  listRef.current.lastElementChild.scrollIntoView();      // 새 항목이 DOM에 있다
};
```

flushSync는 배칭을 포기하는 비용이 있으므로 이 지점에만 국소적으로 쓴다. (이펙트에서 items 변경에 반응해 스크롤하는 설계도 가능하며, 그 트레이드오프는 5-4에서 다룬다.)
</details>

## 참고 자료

- [react.dev — State as a Snapshot](https://react.dev/learn/state-as-a-snapshot) / [Queueing a Series of State Updates](https://react.dev/learn/queueing-a-series-of-state-updates) — 스냅샷 의미론과 갱신 큐의 공식 서술. 이 문서 핵심 개념의 1차 자료.
- [react.dev — Updating Objects in State](https://react.dev/learn/updating-objects-in-state) — 불변 갱신 패턴과 변형이 문제가 되는 이유의 공식 설명.
- [React 18 — Automatic Batching 소개](https://github.com/reactwg/react-18/discussions/21) — 배칭 확대의 배경과 flushSync 탈출구. React 워킹 그룹의 공식 논의.
- [react.dev — flushSync](https://react.dev/reference/react-dom/flushSync) — 사용 조건과 비용에 대한 공식 경고.
- [React Hooks RFC](https://github.com/reactjs/rfcs/blob/main/text/0068-react-hooks.md) — 훅 설계의 동기와 대안 검토(키 기반, 클래스). 호출 순서 설계의 1차 자료.
