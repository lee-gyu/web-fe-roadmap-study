# 9-5. React 컴포넌트 합성 패턴

> 한 줄 요약: 이 문서를 읽고 나면 React 함수 컴포넌트 트리에서 확장 가능한 UI 계약을 props, children, context, controlled state 중 어디에 둘지 판단하고 리렌더 비용을 검증할 수 있다.

이 문서는 React 19의 함수 컴포넌트와 hook 모델을 기준으로 한다. class component, mixin, legacy lifecycle은 다루지 않는다. HOC(higher-order component)는 함수 컴포넌트와도 함께 쓸 수 있지만, 이 문서에서는 migration과 라이브러리 호환 맥락으로만 언급하고 주요 패턴은 children, context, custom hook 기반으로 설명한다.

## 학습 목표

- React가 상속보다 합성(composition)을 기본 확장 모델로 삼는 이유를 렌더링 모델과 연결해 설명할 수 있다.
- children-as-slot 패턴으로 layout ownership과 rendering ownership을 분리할 수 있다.
- compound component 패턴으로 부모·자식 컴포넌트의 암묵적 계약을 context와 타입으로 표현할 수 있다.
- controlled/uncontrolled component를 상태 소유권 기준으로 선택하고 전환 비용을 설명할 수 있다.
- polymorphic component의 `as` prop, ref, 접근성 role이 만드는 타입·런타임 경계를 판단할 수 있다.
- context 기반 합성의 리렌더 비용을 React DevTools Profiler 또는 로그로 확인할 수 있다.

## 배경: 왜 이것이 존재하는가

React의 컴포넌트는 클래스 계층보다 **요소 트리(element tree)를 반환하는 함수**에 가깝다. UI 확장은 "부모 클래스를 상속해서 일부 메서드를 override한다"가 아니라, "어떤 요소를 어디에 끼워 넣고, 상태를 누가 소유하며, 이벤트를 어느 방향으로 흘릴 것인가"의 문제다. 그래서 React의 기본 확장 방식은 상속이 아니라 합성이다.

상속 기반 UI 프레임워크에서는 `BaseDialog`를 상속한 `ConfirmDialog`, `FormDialog` 같은 계층이 자연스러울 수 있다. React에서는 Dialog가 내부 layout과 focus boundary를 제공하고, 호출자가 `children`으로 내용을 제공하는 편이 더 맞다. 부모는 배치와 상호작용 계약을 소유하고, 자식은 렌더링 내용을 소유한다. 이 분리가 합성 패턴의 출발점이다.

합성은 단순히 `children`을 받는 것이 아니다. 탭, 메뉴, 다이얼로그, 폼 필드처럼 여러 하위 컴포넌트가 하나의 상태와 접근성 계약을 공유해야 하는 위젯에서는 compound component가 필요하다. 입력 컴포넌트는 상태를 내부에 둘지 호출자가 제어할지 결정해야 한다. 디자인 시스템 컴포넌트는 `button`처럼 보이지만 `a`로 렌더되어야 할 수 있다. 이 모든 문제는 props, children, context, state ownership의 배치 문제다.

## 핵심 개념

### 합성은 렌더링 책임을 나누는 구조다

가장 작은 합성은 `children`을 slot으로 받는 것이다.

```tsx
import { useId } from "react";

type PanelProps = {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export function Panel({ title, actions, children }: PanelProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId}>
      <header>
        <h2 id={titleId}>{title}</h2>
        {actions}
      </header>
      <div>{children}</div>
    </section>
  );
}

function ProductPanel() {
  return (
    <Panel
      title="상품"
      actions={<button type="button">새로고침</button>}
    >
      <p>상품 목록이 여기에 렌더링된다.</p>
    </Panel>
  );
}
```

`Panel`은 section, header, 제목 연결, action 위치를 소유한다. 호출자는 내부 내용을 소유한다. 이것이 layout ownership과 rendering ownership의 분리다. props만으로 모든 변형을 열거하면 `showAction`, `actionLabel`, `actionDisabled`, `footer`, `variant`가 계속 늘어난다. slot은 변형의 축을 호출자에게 돌려준다.

경계 조건은 일관성이다. slot이 너무 자유로우면 디자인 시스템의 접근성 계약이 깨질 수 있다. 예를 들어 Dialog의 title slot을 호출자가 완전히 생략할 수 있다면 `aria-labelledby`가 깨진다. 이 경우 slot을 열되 필수 구조는 부모가 검증하거나 더 좁은 하위 컴포넌트를 제공해야 한다.

### Compound component는 여러 자식이 하나의 계약을 공유한다

Tabs는 compound component의 전형적인 예다. `Tabs`, `Tabs.List`, `Tabs.Trigger`, `Tabs.Panel`은 따로 쓰면 의미가 약하고 함께 쓰일 때 하나의 위젯 계약을 만든다.

```tsx
import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type TabsContextValue = {
  value: string;
  setValue(value: string): void;
  baseId: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);

  if (!context) {
    throw new Error("Tabs 하위 컴포넌트는 <Tabs> 안에서만 사용할 수 있다.");
  }

  return context;
}

type TabsProps = {
  value?: string;
  defaultValue: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
};

function TabsRoot({ value, defaultValue, onValueChange, children }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const baseId = useId();
  const selectedValue = value ?? internalValue;

  const context = useMemo<TabsContextValue>(
    () => ({
      value: selectedValue,
      setValue(nextValue) {
        if (value === undefined) {
          setInternalValue(nextValue);
        }

        onValueChange?.(nextValue);
      },
      baseId,
    }),
    [baseId, onValueChange, selectedValue, value],
  );

  return <TabsContext.Provider value={context}>{children}</TabsContext.Provider>;
}

function TabsList({ children }: { children: ReactNode }) {
  return <div role="tablist">{children}</div>;
}

function TabsTrigger({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const { value: selectedValue, setValue, baseId } = useTabsContext();
  const selected = selectedValue === value;

  return (
    <button
      id={`${baseId}-trigger-${value}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      onClick={() => setValue(value)}
    >
      {children}
    </button>
  );
}

function TabsPanel({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const { value: selectedValue, baseId } = useTabsContext();
  const selected = selectedValue === value;

  return (
    <div
      id={`${baseId}-panel-${value}`}
      role="tabpanel"
      aria-labelledby={`${baseId}-trigger-${value}`}
      hidden={!selected}
    >
      {children}
    </div>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  Panel: TabsPanel,
});
```

사용자는 다음처럼 구조를 조합한다.

```tsx
function ProductTabs() {
  return (
    <Tabs defaultValue="details">
      <Tabs.List>
        <Tabs.Trigger value="details">상세</Tabs.Trigger>
        <Tabs.Trigger value="reviews">리뷰</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Panel value="details">상세 설명</Tabs.Panel>
      <Tabs.Panel value="reviews">리뷰 목록</Tabs.Panel>
    </Tabs>
  );
}
```

이 패턴의 설계 배경은 두 요구를 동시에 만족하는 데 있다. 호출자는 markup 순서와 배치를 조정하고 싶고, 컴포넌트는 선택 상태와 접근성 속성을 일관되게 유지해야 한다. context가 부모·자식 계약의 통로가 된다.

경계 조건은 context의 리렌더 비용과 암묵성이다. `Tabs.Trigger`는 `Tabs` 밖에서 쓰면 런타임 오류를 낸다. TypeScript만으로 JSX 트리의 부모 관계를 완전히 보장하기 어렵기 때문이다. 또한 `value`가 바뀔 때 context consumer가 리렌더된다. 탭 수가 적으면 문제가 아니지만, 큰 table cell마다 compound component를 넣는 구조에서는 비용을 확인해야 한다.

### Controlled와 uncontrolled는 상태 소유권의 결정이다

입력 컴포넌트는 상태를 내부에 둘 수도 있고 호출자에게 맡길 수도 있다.

```tsx
type SearchBoxProps = {
  value: string;
  onValueChange(value: string): void;
};

export function ControlledSearchBox({ value, onValueChange }: SearchBoxProps) {
  return (
    <input
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}
```

controlled component는 호출자가 상태의 원본이다. form validation, URL 동기화, 서버 제출, 여러 입력 간 파생 상태가 필요할 때 적합하다. 비용은 입력마다 부모가 리렌더될 수 있다는 점과 호출자가 상태를 반드시 제공해야 한다는 점이다.

uncontrolled component는 DOM 또는 컴포넌트 내부가 상태를 가진다.

```tsx
import { useRef } from "react";

export function UncontrolledSearchBox({
  onSubmit,
}: {
  onSubmit(value: string): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(inputRef.current?.value ?? "");
      }}
    >
      <input ref={inputRef} defaultValue="" />
      <button type="submit">검색</button>
    </form>
  );
}
```

uncontrolled는 제출 시점에만 값이 필요하거나, 고빈도 입력을 부모 상태로 올릴 필요가 없을 때 적합하다. 비용은 현재 값을 React 상태처럼 즉시 조합하기 어렵다는 점이다.

라이브러리 컴포넌트는 두 방식을 모두 지원할 수 있다.

```tsx
function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value: T | undefined;
  defaultValue: T;
  onChange?: (value: T) => void;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const controlled = value !== undefined;
  const currentValue = controlled ? value : internalValue;

  function setValue(nextValue: T) {
    if (!controlled) {
      setInternalValue(nextValue);
    }

    onChange?.(nextValue);
  }

  return [currentValue, setValue] as const;
}
```

경계 조건은 모드 전환이다. 한 컴포넌트 인스턴스가 렌더 중간에 controlled에서 uncontrolled로 바뀌거나 반대로 바뀌면 상태 원본이 바뀐다. React input도 이 전환을 경고한다. 컴포넌트 라이브러리는 초기 렌더의 controlled 여부를 유지하도록 경고하거나 문서화해야 한다.

### Polymorphic component는 렌더 대상과 의미를 함께 바꾼다

디자인 시스템의 Button은 상황에 따라 `<button>`이거나 `<a>`일 수 있다. `as` prop은 렌더할 요소를 선택하게 한다.

```tsx
type ButtonLikeProps =
  | ({
      as?: "button";
      children: React.ReactNode;
    } & React.ButtonHTMLAttributes<HTMLButtonElement>)
  | ({
      as: "a";
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>);

export function Action(props: ButtonLikeProps) {
  if (props.as === "a") {
    const { as, children, ...anchorProps } = props;

    return <a {...anchorProps}>{children}</a>;
  }

  const { as, children, type = "button", ...buttonProps } = props;

  return (
    <button type={type} {...buttonProps}>
      {children}
    </button>
  );
}
```

polymorphic component의 핵심은 태그만 바꾸는 것이 아니다. 의미와 접근성 계약도 바뀐다. `<button>`은 클릭 가능한 동작을 나타내고 Space/Enter 키 동작, disabled 속성을 갖는다. `<a>`는 navigation을 나타내고 `href`가 있어야 한다. `div`에 `role="button"`을 붙이는 것은 키보드 동작과 focus 관리까지 직접 구현해야 하므로 기본값으로 삼지 않는다.

넓은 generic `as`는 타입이 복잡해진다. 디자인 시스템 내부에서는 제한된 union부터 시작하는 편이 안정적이다. ref도 렌더 대상에 따라 타입이 달라진다. React 19의 ref 전달 모델을 사용하더라도 컴포넌트가 어떤 DOM 노드를 노출하는지 명확해야 한다. "스타일만 같게 보이게 하는 컴포넌트"와 "상호작용 의미를 감싸는 컴포넌트"를 혼동하면 접근성 버그가 생긴다.

### Context 기반 합성은 리렌더 비용을 측정해야 한다

compound component는 보통 context를 사용한다. Provider의 value가 바뀌면 해당 context를 읽는 consumer들이 리렌더된다. 작은 위젯에서는 비용보다 API 일관성이 중요하다. 하지만 수백 개 item이 있는 Menu, DataTable, Tree에서 context value가 자주 바뀌면 문제가 된다.

관찰용 로그는 간단히 넣을 수 있다.

```tsx
function TabTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  const { value: selectedValue, setValue } = useTabsContext();
  console.count(`Trigger render: ${value}`);

  return (
    <button
      type="button"
      aria-selected={selectedValue === value}
      onClick={() => setValue(value)}
    >
      {children}
    </button>
  );
}
```

더 정확한 확인은 React DevTools Profiler다.

1. Profiler에서 녹화를 시작한다.
2. 탭 선택을 바꾼다.
3. 어떤 `Trigger`와 `Panel`이 리렌더되었는지 확인한다.
4. context value를 분리하거나 memoization했을 때 commit duration과 리렌더 범위가 줄었는지 비교한다.

주의할 점은 memoization이 기본 해법이 아니라는 것이다. context value가 실제로 바뀌면 consumer는 리렌더된다. 값을 쪼개거나, 상태와 dispatch context를 분리하거나, 자주 바뀌는 값은 외부 store 또는 지역 상태로 옮기는 것이 더 근본적일 수 있다.

## 실무 관점

### 합성 패턴 선택표

| 문제 | 패턴 | 장점 | 비용 | 적합한 조건 |
|---|---|---|---|---|
| 레이아웃 틀과 내용 분리 | children-as-slot | 호출자 자유도, props 폭증 방지 | 필수 구조 누락 가능 | Panel, Card, Page layout |
| 여러 하위 컴포넌트가 상태 공유 | compound component | API가 도메인 구조를 닮음 | context 비용, 부모 관계 암묵성 | Tabs, Menu, Dialog, Accordion |
| 상태 소유권을 호출자가 가져야 함 | controlled | 검증, URL/서버 동기화 쉬움 | 부모 리렌더, boilerplate | form, filter, selected row |
| 상태를 내부에 둬도 충분함 | uncontrolled | 고빈도 입력 비용 감소 | 외부 조합 어려움 | 제출 시점만 값 필요 |
| 렌더 태그를 바꿔야 함 | polymorphic `as` | 디자인 재사용 | 타입/ref/a11y 복잡도 | Button/link, Text/heading |

패턴 선택은 API 취향이 아니라 소유권과 계약의 문제다. 호출자가 값을 조합해야 하면 controlled다. 호출자가 배치를 조정해야 하면 slot이다. 자식들이 하나의 상호작용 상태를 공유해야 하면 compound다.

### compound component의 암묵 계약을 문서화한다

`<Tabs.Trigger>`는 `<Tabs>` 밖에서 의미가 없다. 이 관계는 TypeScript만으로 충분히 강제하기 어렵다. 따라서 세 겹의 방어가 필요하다.

- 런타임 `useTabsContext()` 오류로 잘못된 사용을 빠르게 실패시킨다.
- Storybook 또는 문서 예제에서 올바른 구조를 보여 준다.
- 접근성 속성(`role`, `aria-controls`, `aria-labelledby`)을 하위 컴포넌트가 자동으로 맞춘다.

compound component가 단순 namespace처럼 보이지만 실제로는 위젯 프로토콜이다. 부모와 자식 사이의 context shape가 공개 API가 되므로 쉽게 바꾸지 않는다.

### class component 패턴을 그대로 옮기지 않는다

과거 React 코드에서는 render prop, HOC, class inheritance, mixin이 로직 재사용 도구로 쓰였다. 함수 컴포넌트와 hook 이후에는 대부분 custom hook과 composition으로 대체된다. HOC는 여전히 권한 wrapper, error boundary 호환, legacy library adapter에서 보일 수 있지만, 새 코드의 기본값은 아니다. 특히 class lifecycle을 흉내 내려고 `useEffect`를 남발하면 React의 "렌더는 계산, effect는 외부 동기화" 모델을 놓치게 된다.

## 더 깊이

### React element는 호출 결과가 아니라 UI 설명이다

JSX는 React element 객체로 변환된다. `children`은 특별한 렌더 콜백이 아니라 props의 한 필드다. 부모 컴포넌트는 자기 렌더 중 `children`을 어디에 배치할지 결정한다. 이 모델 때문에 slot 패턴이 자연스럽다. 호출자는 이미 만들어진 element를 넘기고, 부모는 그 element를 자신의 layout 안에 위치시킨다.

이 점은 ownership과 연결된다. `Panel`은 `actions` element를 실행하지 않는다. React가 전체 트리를 렌더링할 때 element의 type을 따라 컴포넌트를 호출한다. `Panel`은 구조를 소유하지만 `actions` 내부 상태는 action 컴포넌트가 소유한다. "부모가 자식을 호출한다"보다 "부모가 자식 element를 포함한 설명을 반환한다"가 더 정확하다.

### Context 전파와 bailout

Context provider의 value가 바뀌면 해당 context consumer는 부모가 memoized되어 있어도 갱신될 수 있다. React는 context dependency를 추적하기 때문이다. 따라서 `React.memo`로 compound component의 모든 리렌더를 막을 수 있다고 기대하면 안 된다.

리렌더 비용을 줄이는 실무 방법은 다음 순서로 검토한다.

- context value를 `useMemo`로 안정화해 관계없는 부모 리렌더가 consumer를 깨우지 않게 한다.
- 갱신 빈도가 다른 값을 다른 context로 나눈다.
- dispatch 함수처럼 참조가 안정적인 값은 state context와 분리한다.
- 수백 개 consumer가 고빈도 값 일부만 읽는다면 외부 store의 selector 구독을 검토한다.

이 판단은 [5-6 상태 아키텍처](../phase-5/06-state-architecture.md)의 기준과 같다. Compound component도 상태 전파 문제에서 자유롭지 않다.

### 접근성은 합성 API의 일부다

Tabs, Dialog, Menu 같은 compound component는 시각적 묶음이 아니라 접근성 tree의 위젯이다. `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, 키보드 이동 규칙은 API의 일부다. slot을 너무 자유롭게 열면 호출자가 이 계약을 깨뜨릴 수 있다.

따라서 합성 API는 자유도와 보장을 균형 잡아야 한다. Dialog의 title은 `Dialog.Title`로 제공해 `aria-labelledby`를 자동 연결하고, 임의 heading을 children으로만 받는 구조보다 안전하게 만들 수 있다. 반대로 단순 Card는 접근성 계약이 약하므로 children slot만으로 충분하다.

## 정리

- React의 확장 기본값은 상속이 아니라 합성이다. 함수 컴포넌트는 요소 트리를 반환하고, `children`은 렌더링 책임을 호출자에게 열어 주는 slot이다.
- compound component는 여러 하위 컴포넌트가 하나의 상태와 접근성 계약을 공유할 때 적합하다. context는 이 계약의 통로이지만 리렌더 비용이 있다.
- controlled/uncontrolled 선택은 상태 소유권의 결정이다. 호출자가 값을 조합하고 검증해야 하면 controlled, 제출 시점에만 필요하면 uncontrolled가 적합하다.
- polymorphic component는 태그뿐 아니라 의미, ref, 접근성 동작을 바꾼다. 넓은 `as`보다 제한된 union이 안전한 시작점이다.
- React 패턴은 API 모양만 보지 않고 Profiler와 로그로 리렌더 범위를 확인해야 한다.

## 확인 문제

**Q1.** 디자인 시스템의 `Card` 컴포넌트에 `title`, `subtitle`, `primaryActionLabel`, `secondaryActionLabel`, `footerText`, `showDivider` 같은 props가 계속 추가되고 있다. 어떤 합성 패턴을 검토해야 하며, 무엇을 부모가 계속 소유해야 하는가?

<details>
<summary>정답과 해설</summary>

children-as-slot 또는 named slot(`header`, `actions`, `footer`)을 검토한다. 변형을 props로 모두 열거하면 Card가 모든 사용처의 렌더링 세부를 알아야 한다. slot을 사용하면 호출자가 header/action/footer 내용을 직접 제공할 수 있다. 다만 부모인 Card는 spacing, section 구조, 기본 heading 연결, divider 정책처럼 디자인 시스템의 일관성을 만드는 layout ownership을 유지해야 한다. 자유도가 접근성이나 레이아웃 계약을 깨뜨리지 않는 범위에서 slot을 연다.
</details>

**Q2.** Tabs를 compound component로 구현했더니 탭 선택 때 모든 Trigger와 Panel이 리렌더된다. 이것이 항상 문제인가? 어떤 기준으로 개선 여부를 판단해야 하는가?

<details>
<summary>정답과 해설</summary>

항상 문제는 아니다. 탭 수가 적고 렌더 비용이 작으면 context 기반 compound component의 API 일관성이 비용보다 중요하다. 개선 여부는 Profiler에서 commit duration, 리렌더된 컴포넌트 수, 사용자 입력 지연을 확인해 판단한다. 비용이 실제로 크다면 context value 안정화, state/dispatch context 분리, Panel lazy mount, 선택 값 구독 범위 축소를 검토한다. 수백 개 consumer가 고빈도 값을 읽는 구조라면 context보다 selector 기반 외부 store가 맞을 수 있다.
</details>

**Q3.** `Action as="a"`가 `href` 없이 렌더되고, 클릭 핸들러만으로 route를 이동한다. 왜 polymorphic component의 접근성 경계가 깨진 것인가?

<details>
<summary>정답과 해설</summary>

`a` 요소의 의미는 navigation이고 `href`가 있어야 키보드, 컨텍스트 메뉴, 새 탭 열기, 보조 기술에서 링크로 제대로 동작한다. `href` 없는 anchor에 click handler만 붙이면 button과 link 의미가 섞인다. 이동이면 `href`를 가진 `a` 또는 라우터의 Link를 사용해야 하고, 현재 페이지 안의 동작이면 `button`이 맞다. polymorphic component는 태그만 바꾸는 스타일 도구가 아니라 DOM 의미와 접근성 계약을 함께 바꾸는 API다.
</details>

## 참고 자료

- [React — Passing JSX as children](https://react.dev/learn/passing-props-to-a-component#passing-jsx-as-children) — `children`을 통한 합성의 기본 모델을 설명한다.
- [React — Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) — controlled component와 상태 끌어올리기의 공식 기준을 제공한다.
- [React — Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) — context 사용 전 검토할 대안과 Provider/consumer 모델을 설명한다.
- [React DevTools — Profiler](https://react.dev/learn/react-developer-tools) — 리렌더 범위와 commit 비용을 확인하는 도구의 출발점이다.
- [WAI-ARIA Authoring Practices Guide — Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) — Tabs compound component가 지켜야 할 role과 keyboard interaction 계약을 확인할 수 있다.
