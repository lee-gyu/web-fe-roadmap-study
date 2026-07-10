# 5a-3. Compound Component Pattern

> 한 줄 요약: compound component는 관련 UI 조각을 하나의 상태·접근성 aggregate로 묶어 유연한 마크업을 주지만, Context·focus·controlled 상태라는 숨은 문법을 공개 계약으로 관리해야 한다.

이 문서는 React 19.x와 TypeScript strict를 기준으로 한다. Tabs의 role·keyboard·focus 계약은 2026-07-10에 WAI-ARIA Authoring Practices Guide(APG)의 Tabs Pattern과 다시 대조했다.

## 학습 목표

- compound component의 root·list·trigger·panel 역할과 데이터 흐름을 컴포넌트 tree로 설명할 수 있다.
- provider 밖 오용을 즉시 실패시키는 Context sentinel과 전용 Hook을 구현할 수 있다.
- controlled/uncontrolled API를 단일 원본으로 유지하고 전환 오류를 타입으로 차단할 수 있다.
- Tabs의 role, accessible name, roving focus와 keyboard 동작을 패턴의 핵심 계약으로 구현할 수 있다.
- clone 기반과 Context 기반 합성의 구조적 한계 및 Context consumer 리렌더 범위를 측정할 수 있다.

## 배경: 왜 이것이 존재하는가

Tabs는 버튼 몇 개와 조건부 panel 몇 개가 아니다. 선택된 값, trigger와 panel의 ID 연결, 방향키 focus 이동, 비활성 tab의 tab 순서 제외가 함께 움직여야 한다. 호출자가 모든 props를 직접 연결하면 유연하지만 한 속성만 빠져도 접근성·상태 invariant가 깨진다. 반대로 `<Tabs items={...} />` 하나에 모든 markup을 숨기면 안전하지만 badge, 설명, panel 배치를 바꾸기 어렵다.

compound component는 HTML의 `<select>/<option>`처럼 관련 조각이 함께 하나의 기능을 이루게 한다.

```tsx
<Tabs.Root defaultValue="profile">
  <Tabs.List aria-label="계정 설정">
    <Tabs.Trigger value="profile">프로필</Tabs.Trigger>
    <Tabs.Trigger value="security">보안</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="profile">...</Tabs.Panel>
  <Tabs.Panel value="security">...</Tabs.Panel>
</Tabs.Root>
```

호출자는 배치를 소유하고 root는 공유 상태와 행동을 소유한다. 이 JSX는 작은 DSL(domain-specific language)이다. `Trigger`와 `Panel`은 아무 곳에서나 의미가 있는 컴포넌트가 아니며 같은 root 아래에서 같은 `value`로 연결되어야 한다.

## 핵심 개념

### Root가 aggregate invariant를 소유한다

Tabs의 tree와 데이터 흐름은 다음과 같다.

```text
Tabs.Root                     ← selected value의 단일 원본
├─ Tabs.List                  ← tablist의 accessible name
│  ├─ Tabs.Trigger(profile)   ← value 읽기, select 명령, focus 이동
│  └─ Tabs.Trigger(security)
├─ layout wrapper             ← Context 방식에서는 허용
│  └─ Tabs.Panel(profile)     ← value 읽기, ID 연결, hidden 결정
└─ Tabs.Panel(security)
```

공개적으로는 여러 컴포넌트지만 invariant는 하나다.

- selected value는 root 한 곳에서만 결정한다.
- 각 trigger는 같은 value의 panel을 제어한다.
- 한 tab만 `aria-selected=true`다.
- keyboard focus와 selected state를 manual/automatic activation 정책에 맞게 구분한다.
- root 밖 하위 컴포넌트 사용은 조용히 기본값으로 동작하지 않는다.

백엔드의 aggregate가 여러 entity의 불변 조건을 한 transaction 경계에서 지키는 것과 비슷하다. 편리한 JSX 문법을 제공하는 대신 root가 상태 전이 문법을 책임진다.

### Sentinel은 “기본값”과 “Provider 누락”을 구분한다

의미 있는 기본값을 Context에 넣으면 provider 누락이 정상 UI처럼 보인다. 고유 sentinel을 사용해 조기에 실패시킨다.

```tsx
import { createContext, useContext } from "react";

const MISSING = Symbol("TabsContextMissing");

function createRequiredContext<T>(name: string) {
  const Context = createContext<T | typeof MISSING>(MISSING);

  function useRequiredContext() {
    const value = useContext(Context);
    if (value === MISSING) {
      throw new Error(`${name}는 Tabs.Root 안에서만 사용할 수 있다.`);
    }
    return value;
  }

  return [Context, useRequiredContext] as const;
}

const [TabsValueContext, useTabsValue] =
  createRequiredContext<string>("Tabs 하위 컴포넌트");
const [TabsSelectContext, useTabsSelect] =
  createRequiredContext<(value: string) => void>("Tabs 하위 컴포넌트");
const [TabsIdContext, useTabsId] =
  createRequiredContext<string>("Tabs 하위 컴포넌트");
```

`null`을 유효 값으로 쓰지 않는 Context라면 `null` sentinel도 가능하다. 고유 symbol은 도메인의 `null`과 provider 누락을 확실히 분리한다. 오류 메시지는 내부 Context 이름보다 사용자가 고쳐야 할 JSX 계약을 말한다.

### Controlled와 uncontrolled는 합칠 수 있지만 원본은 하나다

호출자 state가 원본인 controlled mode와 root 내부 state가 원본인 uncontrolled mode를 판별 유니언으로 표현한다.

```tsx
import { useCallback, useId, useRef, useState, type ReactNode } from "react";

type ControlledTabs = {
  value: string;
  defaultValue?: never;
  onValueChange(value: string): void;
};

type UncontrolledTabs = {
  value?: never;
  defaultValue: string;
  onValueChange?(value: string): void;
};

type TabsRootProps = {
  children: ReactNode;
} & (ControlledTabs | UncontrolledTabs);

export function TabsRoot(props: TabsRootProps) {
  const controlled = "value" in props;
  const controlledOnFirstRender = useRef(controlled);
  const [internalValue, setInternalValue] = useState(() =>
    controlled ? props.value : props.defaultValue,
  );
  const baseId = useId();

  if (controlledOnFirstRender.current !== controlled) {
    throw new Error("Tabs.Root의 controlled/uncontrolled mode를 수명 중 바꿀 수 없다.");
  }

  const selectedValue = controlled ? props.value : internalValue;
  const select = useCallback(
    (nextValue: string) => {
      if (!controlled) {
        setInternalValue(nextValue);
      }
      props.onValueChange?.(nextValue);
    },
    [controlled, props.onValueChange],
  );

  return (
    <TabsIdContext value={baseId}>
      <TabsSelectContext value={select}>
        <TabsValueContext value={selectedValue}>
          {props.children}
        </TabsValueContext>
      </TabsSelectContext>
    </TabsIdContext>
  );
}
```

TypeScript는 `value`와 `defaultValue` 동시 제공, controlled mode의 `onValueChange` 누락을 막는다. 런타임 검사는 첫 렌더 이후 mode 전환을 막는다. uncontrolled mode에서도 callback을 호출해 관찰은 허용하지만 내부 state가 원본이다. controlled mode에서는 root가 내부 복사본을 갱신하지 않고 호출자에게 의도를 알린다.

`useState(props.value)`로 controlled 값을 복사해 두 원본을 만들면 props 변경과 내부 변경 중 누가 이길지 모호해진다. “두 API를 지원한다”는 “두 state를 동시에 유지한다”는 뜻이 아니다.

### Tabs의 시각적 API와 접근성 API는 하나다

아래 코드는 핵심 계약에 집중한 실행 가능한 예제다. 제품용 컴포넌트는 disabled tab, 동적 추가·삭제, vertical orientation, RTL과 중복 value 정책까지 확장해야 한다.

```tsx
import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";

function domId(baseId: string, role: "tab" | "panel", value: string) {
  return `${baseId}-${role}-${encodeURIComponent(value)}`;
}

type TabsListProps = Omit<HTMLAttributes<HTMLDivElement>, "role">;

export function TabsList(props: TabsListProps) {
  return <div {...props} role="tablist" />;
}

type TabsTriggerProps = {
  value: string;
  children: ReactNode;
};

function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
  const list = event.currentTarget.closest('[role="tablist"]');
  if (!list) return;

  const tabs = Array.from(
    list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
  );
  const current = tabs.indexOf(event.currentTarget);
  if (current < 0) return;

  let next: number | undefined;
  if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
  if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = tabs.length - 1;

  if (next !== undefined) {
    event.preventDefault();
    tabs[next]?.focus();
  }
}

export function TabsTrigger({ value, children }: TabsTriggerProps) {
  const selectedValue = useTabsValue();
  const select = useTabsSelect();
  const baseId = useTabsId();
  const selected = selectedValue === value;

  return (
    <button
      id={domId(baseId, "tab", value)}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={domId(baseId, "panel", value)}
      tabIndex={selected ? 0 : -1}
      onClick={() => select(value)}
      onKeyDown={moveFocus}
    >
      {children}
    </button>
  );
}

type TabsPanelProps = {
  value: string;
  children: ReactNode;
};

export function TabsPanel({ value, children }: TabsPanelProps) {
  const selectedValue = useTabsValue();
  const baseId = useTabsId();
  const selected = selectedValue === value;

  return (
    <div
      id={domId(baseId, "panel", value)}
      role="tabpanel"
      aria-labelledby={domId(baseId, "tab", value)}
      hidden={!selected}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
```

이 구현은 **manual activation**이다. 방향키는 focus만 이동하고, native `button`이 Enter/Space를 click으로 변환하므로 `onClick` 한 경로가 선택을 바꾼다. keydown에서 Enter/Space에도 `select`를 호출하면 native click과 중복 실행될 수 있다. panel이 즉시 표시되고 사전 로드되어 있다면 focus 이동과 동시에 선택하는 automatic activation도 가능하다. 네트워크 지연이 있는 panel에 automatic activation을 적용하면 방향키 탐색마다 기다리게 되므로 APG도 latency를 기준으로 선택하라고 안내한다.

핵심 접근성 계약은 다음과 같다.

| 역할 | 계약 |
|---|---|
| `tablist` | `aria-label` 또는 `aria-labelledby`로 그룹 이름을 가진다 |
| `tab` | `aria-selected`, 같은 panel의 `aria-controls`, roving `tabIndex`를 가진다 |
| `tabpanel` | 같은 tab의 `aria-labelledby`를 가진다. 숨겨진 panel은 노출하지 않는다 |
| keyboard | 수평 목록에서 Left/Right, 선택에 Enter/Space, 선택적 Home/End를 지원한다 |
| focus | Tab은 tablist 내부 모든 tab을 순회하지 않고 active tab 하나에 진입한다 |

`tabIndex={0}`을 모든 trigger에 주면 마우스로는 되지만 composite widget의 keyboard 흐름은 깨진다. 접근성은 CSS 뒤에 붙이는 속성이 아니라 compound API가 보존해야 하는 상태 전이다.

### Namespace API와 named export

```tsx
export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Panel: TabsPanel,
};
```

`Tabs.Trigger`는 관련 역할을 자동완성에서 묶고 DSL의 소속을 드러낸다. 개별 named export는 import가 명시적이고 도구가 사용하지 않는 export를 제거하기 쉬우며 필요하면 이름을 바꿀 수 있다. 라이브러리는 둘을 함께 제공할 수도 있지만 public surface가 두 배가 된다. tree shaking은 번들러·패키지 side-effect 설정에 좌우되므로 이름 모양만 보고 보장하지 말고 [6-2 번들러](../phase-6/02-bundlers.md)에서 산출물을 확인한다.

### Context는 깊이에 강하지만 구독 범위가 생긴다

Context consumer는 직접 자식일 필요가 없다. 호출자가 layout wrapper를 삽입해도 가장 가까운 provider를 찾는다. 이 유연성의 비용은 암묵적 의존성과 갱신 전파다.

위 예제는 selected value, select action, ID를 세 Context로 나눴다.

- `TabsPanel`은 selection에 따라 바뀌므로 value를 구독한다.
- selection을 바꾸기만 하는 consumer는 select Context만 읽을 수 있다.
- base ID는 root 수명 동안 안정적이다.

모든 값을 `{ value, select, baseId }` 새 객체 하나로 묶으면 어떤 필드가 바뀌어도 모든 consumer가 다시 렌더된다. 그렇다고 무조건 Context를 세분화하는 것도 비용이다. 먼저 대표 Tabs를 Profiler로 기록하고 panel 내용이 무겁거나 tab이 많은 실제 병목에서 분리한다.

### `Children.map`과 `cloneElement`는 얕은 구조를 계약으로 만든다

오래된 구현은 직접 자식을 순회해 props를 주입한다.

```tsx
function Tabs({ children }: { children: ReactNode }) {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    return cloneElement(child, { selectedValue: "profile" });
  });
}
```

이 방식의 실패 조건은 구조적이다.

- `Children`은 임의 컴포넌트가 반환할 내부 tree까지 내려가지 않는다.
- 호출자가 `<div><Tab /></div>`를 넣으면 직접 자식 계약이 끊긴다.
- clone의 props가 소비자가 준 같은 이름을 덮을 수 있다.
- TypeScript가 child의 실제 prop 계약을 일반 `ReactNode`에서 복구하기 어렵다.
- 데이터 출처가 JSX에 보이지 않아 React 공식 문서도 `cloneElement`를 uncommon/fragile로 분류한다.

직접 자식의 순서 자체가 API인 breadcrumb·step indicator처럼 작은 변환에는 쓸 수 있다. 중첩 가능한 headless widget의 기본값으로는 Context 또는 명시적 render prop이 더 견고하다.

## 실무 관점

### Compound API가 과한 신호

다음 조건에서는 단일 component와 props가 더 낫다.

- 허용되는 배치가 하나뿐이고 소비자가 markup을 바꿀 이유가 없다.
- 하위 역할이 둘뿐이며 공유 상태도 없다.
- 접근성 invariant를 호출자 자유보다 우선해 완전히 캡슐화해야 한다.
- Context를 이해해야만 쓸 수 있는데 API가 줄여 주는 반복이 거의 없다.

반대로 디자인 시스템의 Tabs, Menu, Accordion처럼 시각적 조합은 달라져도 상태·focus 계약은 같다면 compound/headless API가 가치를 만든다.

### 관찰 실험

**실험 1 — 구조 내성**

1. clone 기반 Tabs에서 Trigger 둘 사이에 `<div>` wrapper를 넣는다.
2. 선택 prop 주입이 끊기는지 확인한다.
3. Context 기반 구현에 같은 wrapper를 넣고 가장 가까운 root를 여전히 읽는지 확인한다.
4. 중첩된 두 Tabs root에서 각 consumer가 가까운 root state만 읽는지도 검증한다.

**실험 2 — 접근성 동작**

- Tab key로 tablist에 진입하면 active tab 하나에 focus가 오는가?
- Left/Right가 순환하고, manual activation에서 focus와 selection이 구분되는가?
- Enter/Space가 선택을 바꾸고 tab/panel ID가 상호 연결되는가?
- panel이 느리다면 automatic activation을 사용하지 않았는가?

**실험 3 — Context 렌더 범위**

1. 단일 객체 Context 버전과 value/action 분리 버전을 만든다.
2. selection을 바꾸며 React DevTools Profiler에서 Trigger·Panel·action-only consumer의 렌더를 기록한다.
3. commit 시간과 사용자 체감 차이가 없으면 더 복잡한 분리를 유지할 이유가 있는지 재평가한다.

### 선택 체크리스트

- 여러 조각이 함께 지켜야 할 상태·접근성 invariant가 있는가?
- root, trigger, content/item의 허용 문법과 provider 오용 오류가 명확한가?
- controlled/uncontrolled mode마다 state 원본이 정확히 하나인가?
- role·name·keyboard·focus가 public API와 동작 테스트에 포함되는가?
- Context consumer 갱신 범위를 측정했는가?
- `cloneElement`의 직접 자식 제약이 실제 요구와 맞는가?
- 단순 props component보다 소비자 자유가 실질적으로 필요한가?

## 정리

- compound component는 관련 UI 조각을 하나의 state·behavior aggregate로 묶고 호출자에게 markup 조합권을 준다.
- Context sentinel과 전용 Hook은 root 밖 오용을 즉시 설명 가능한 오류로 바꾼다.
- controlled/uncontrolled 동시 지원에서도 state 원본은 하나이며 수명 중 mode 전환을 허용하지 않는다.
- Tabs의 role, ID 연결, roving focus, arrow/Enter/Space 동작은 스타일이 아니라 컴포넌트 계약이다.
- Context는 중첩에 강하지만 consumer 전파 비용을 만들고, `Children`/`cloneElement`는 직접 자식 구조를 숨은 계약으로 만든다.
- provider 분할과 memoization은 Profiler 증거가 있을 때 적용한다.

## 확인 문제

**Q1.** Context의 기본값을 `{ value: "first", select() {} }`로 두었더니 `Tabs.Trigger`를 root 밖에서 써도 조용히 보였다. 이 설계가 왜 위험하며 어떻게 바꾸는가?

<details>
<summary>정답과 해설</summary>

provider 누락이 정상 상태처럼 보이므로 테스트와 개발에서 계약 위반을 놓친다. 도메인 값과 구분되는 sentinel을 기본값으로 두고 전용 consumer Hook이 sentinel을 만나면 “Tabs.Root 안에서 사용”하라는 오류를 던지게 한다.
</details>

**Q2.** controlled Tabs가 `value` prop을 내부 `useState`에 복사하고 click 때 내부 state도 바꾼다. 어떤 두 원본이 생기며 올바른 click 흐름은 무엇인가?

<details>
<summary>정답과 해설</summary>

호출자의 `value`와 root의 내부 state가 경쟁하는 두 원본이 된다. controlled mode의 표시 값은 항상 prop에서 읽고 click은 `onValueChange(next)`만 호출한다. 호출자가 state를 갱신한 다음 새 prop이 내려와 화면이 바뀐다. uncontrolled mode만 내부 state를 갱신한다.
</details>

**Q3.** 자동 활성화 Tabs에서 방향키를 누를 때마다 원격 panel을 fetch해 focus 이동이 지연된다. 접근성 계약 관점의 수정은 무엇인가?

<details>
<summary>정답과 해설</summary>

panel을 즉시 표시할 수 없는 상황에는 manual activation을 사용한다. 방향키는 focus만 옮기고 Enter/Space가 선택과 fetch를 시작하게 한다. 또는 panel을 사전 로드해 focus와 selection을 함께 바꿔도 지연이 없다는 증거를 만든다.
</details>

## 참고 자료

- [React — Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) — 가까운 provider 탐색과 Context 데이터 흐름을 확인한다.
- [React — `Children`](https://react.dev/reference/react/Children), [`cloneElement`](https://react.dev/reference/react/cloneElement) — 얕은 traversal, props 병합과 fragile API 경고를 확인한다.
- [WAI-ARIA APG — Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) — tablist/tab/tabpanel role, state, keyboard, activation latency 계약을 확인한다.
- [WAI-ARIA APG — Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) — composite widget과 roving `tabindex`의 원리를 확인한다.
- [Patterns.dev — Compound Pattern](https://www.patterns.dev/react/compound-pattern/) — 패턴의 문제 설정을 위한 2차 자료다.
