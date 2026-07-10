# 5a-5. Render Props Pattern

> 한 줄 요약: Render Props는 state나 tree boundary를 소유한 컴포넌트가 내부 UI 전략을 일급 함수로 호출자에게 위임하는 패턴이며, 순수 로직만 전달한다면 custom hook이 더 평평한 API다.

이 문서는 React 19.x와 TypeScript strict를 기준으로 한다. render prop은 현재도 유효하지만 React 공식 legacy 문서가 “현대 React에서 흔하지 않으며 많은 경우 custom Hook으로 대체되었다”고 밝히는 상태를 전제로 한다.

## 학습 목표

- React node를 반환하는 함수값 prop과 일반 event callback을 반환값·실행 시점·tree 소유권으로 구분할 수 있다.
- children-as-function과 명시적 `renderX` slot을 TypeScript generic으로 설계할 수 있다.
- HOC의 암묵적 prop 병합과 render function 인자의 명시적 데이터 흐름을 비교할 수 있다.
- owner component가 DOM·ref·focus·portal 경계를 가져야 Render Props의 wrapper가 정당화되는 조건을 판단할 수 있다.
- callback pyramid를 custom hook·compound component·일반 composition으로 점진적으로 평탄화할 수 있다.

## 배경: 왜 이것이 존재하는가

컴포넌트가 로직이나 state를 재사용하려면 그 결과를 소비자 UI에 전달해야 한다. HOC는 props를 암묵적으로 주입한다. Compound Component는 Context로 관련 조각에 전달한다. Render Props는 **“이 값으로 무엇을 렌더할지” 함수를 받는다.**

```tsx
<OnlineStatus>
  {({ online }) => (
    <SaveButton disabled={!online}>
      {online ? "저장" : "재연결 중"}
    </SaveButton>
  )}
</OnlineStatus>
```

`OnlineStatus`가 state와 구독 수명을 소유하고 호출자가 JSX를 소유한다. 데이터가 함수 매개변수로 드러나므로 HOC의 주입 prop 이름 충돌은 없다. Hooks 이전에는 로직 재사용의 핵심 도구였고 지금도 headless component와 typed slot에서 남는다.

문제는 wrapper와 callback 안에 callback이 쌓이기 쉽다는 점이다. 로직만 필요하고 owner가 tree에 존재할 이유가 없다면 `const online = useOnlineStatus()`가 같은 목적을 더 직접 달성한다.

## 핵심 개념

### Render prop은 “React node를 반환하는 전략 함수”다

일반 callback과 차이는 함수라는 모양이 아니라 계약이다.

```tsx
type SearchProps = {
  onSubmit(query: string): void;          // 명령: 반환값을 UI로 쓰지 않는다
  renderResult(result: SearchResult): ReactNode; // 렌더 전략: 반환값이 tree가 된다
};
```

owner component는 render function을 **렌더 중** 호출한다. 따라서 render function도 컴포넌트 렌더와 같은 순수성 전제를 지켜야 한다. 네트워크 요청이나 DOM 변경을 넣으면 렌더 횟수·중단·재시작에 따라 부수 효과가 반복된다([5-1 멘털 모델](../phase-5/01-react-mental-model.md)).

이름은 역할을 드러낸다.

- `children`: primary slot이 하나이고 children-as-function 관용이 분명할 때 간결하다.
- `renderItem`, `renderEmpty`, `renderTrigger`: 여러 slot의 의미와 매개변수를 자동완성에서 드러낸다.
- `onSelect`, `onOpenChange`: event callback이므로 `render`라고 부르지 않는다.

### Children-as-function은 한 개의 주 렌더 전략에 적합하다

```tsx
import { useState, type ReactNode } from "react";

type ToggleApi = {
  open: boolean;
  toggle(): void;
  close(): void;
};

type ToggleProps = {
  initialOpen?: boolean;
  children(api: ToggleApi): ReactNode;
};

export function Toggle({ initialOpen = false, children }: ToggleProps) {
  const [open, setOpen] = useState(initialOpen);

  return children({
    open,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
  });
}
```

사용 지점에서 값과 행동이 함수 인자로 보인다.

```tsx
<Toggle>
  {({ open, toggle, close }) => (
    <section>
      <button type="button" aria-expanded={open} onClick={toggle}>
        도움말
      </button>
      {open && (
        <div>
          <p>결제 수단을 확인한다.</p>
          <button type="button" onClick={close}>닫기</button>
        </div>
      )}
    </section>
  )}
</Toggle>
```

장점은 호출자가 markup을 완전히 통제하는 것이다. 비용도 같은 지점에서 나온다. `Toggle`은 호출자가 `aria-controls`, focus 복귀, dialog role을 올바르게 연결했는지 보장하지 못한다. 자유를 연 만큼 접근성 책임도 slot 계약과 테스트로 전달해야 한다.

단순 toggle state만 재사용한다면 `useToggle`이 더 작다. `Toggle`이 animation lifecycle, portal, focus scope 같은 실제 tree를 소유할 때 component form이 정당화된다.

### 명시적 `renderX`는 여러 slot과 generic 추론을 드러낸다

목록 owner가 empty와 item 표현을 호출자에게 맡긴다고 하자.

```tsx
import { Fragment, type Key, type ReactNode } from "react";

type CollectionProps<Item> = {
  items: readonly Item[];
  getKey(item: Item): Key;
  renderItem(item: Item, index: number): ReactNode;
  renderEmpty?(): ReactNode;
};

export function Collection<Item>({
  items,
  getKey,
  renderItem,
  renderEmpty = () => <p>항목이 없다.</p>,
}: CollectionProps<Item>) {
  if (items.length === 0) return renderEmpty();

  return items.map((item, index) => (
    <Fragment key={getKey(item)}>{renderItem(item, index)}</Fragment>
  ));
}
```

```tsx
type Product = { id: string; name: string; price: number };
const products: Product[] = loadProducts();

<Collection
  items={products}
  getKey={(product) => product.id}
  renderItem={(product, index) => (
    <article aria-label={`${index + 1}번째 상품`}>
      <h2>{product.name}</h2>
      <p>{formatCurrency(product.price)}</p>
    </article>
  )}
  renderEmpty={() => <EmptyProducts />}
/>;
```

`items`에서 `Item=Product`가 추론되고 그 타입이 `getKey`와 `renderItem` 매개변수까지 흐른다. key의 책임도 owner가 가져가도록 `getKey`를 별도 계약으로 받았다. render function이 fragment를 반환할 수도 있어 반환 node 자체에 key를 강제하는 것보다 추적하기 쉽다.

여러 slot을 모두 `children` 객체 하나로 묶을 수도 있지만 `renderItem`/`renderEmpty`처럼 이름이 있으면 선택적 slot과 fallback이 문서화된다. slot이 너무 많아지면 하나의 component가 여러 layout 변경 축을 소유하는 신호이므로 compound API나 작은 component composition을 검토한다.

### 데이터 흐름은 HOC보다 명시적이다

HOC는 이 호출 지점에서 어떤 prop이 생기는지 보이지 않는다.

```tsx
const TrackedProduct = withAnalytics(ProductCard);
<TrackedProduct product={product} />;
```

Render Props는 제공 값과 지역 이름이 함수 signature에 드러난다.

```tsx
<Analytics>
  {(instrumentation) => (
    <ProductCard product={product} instrumentation={instrumentation} />
  )}
</Analytics>
```

prop 충돌 대신 명시적 전달을 얻지만 JSX가 깊어진다. TypeScript 오류는 주입 generic 대신 render function 매개변수와 반환 타입에 나타난다. 값 하나를 같은 component 내부에서 쓸 뿐이라면 Hook이 가장 직접적이다.

```tsx
function ProductCard({ product }: { product: Product }) {
  const instrumentation = useAnalytics();
  // ...
}
```

세 방식은 유행 순서가 아니라 제어권 위치가 다르다.

| 패턴 | 값 전달 | tree 소유자 | 주요 비용 |
|---|---|---|---|
| HOC | 주입 props | wrapper/HOC | 암묵적 prop·컴포넌트 신원 |
| Render Props | 함수 인자 | render component + 호출자 JSX | callback 중첩 |
| Custom Hook | 반환값 | 호출 컴포넌트 | 각 호출이 로직을 직접 조합 |

### Owner가 tree 일부여야 하면 Render Props가 남는다

focus region이 실제 wrapper DOM과 ref를 소유하지만 내부 controls는 호출자가 작성해야 하는 예를 보자.

```tsx
import { useCallback, useEffect, useRef, type ReactNode } from "react";

type FocusRegionApi = {
  focusFirst(): void;
};

type FocusRegionProps = {
  children(api: FocusRegionApi): ReactNode;
};

export function FocusRegion({ children }: FocusRegionProps) {
  const regionRef = useRef<HTMLDivElement>(null);

  const focusFirst = useCallback(() => {
    regionRef.current
      ?.querySelector<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]',
      )
      ?.focus();
  }, []);

  useEffect(() => {
    focusFirst();
  }, [focusFirst]);

  return (
    <div ref={regionRef} tabIndex={-1}>
      {children({ focusFirst })}
    </div>
  );
}
```

wrapper를 Hook으로 없애면 ref를 붙일 DOM node와 focus scope의 경계를 호출자에게 다시 요구해야 한다. 이 경우 component owner는 단순 로직 전달자가 아니라 tree 계약을 구현한다. portal container, animation presence, measurement boundary, virtualized viewport도 비슷하다.

다만 위 최소 예제가 modal focus trap 전체를 구현하는 것은 아니다. Escape, focus 복귀, 외부 focus 차단, dialog naming까지 필요하면 검증된 headless primitive나 APG 계약을 사용한다. Render Props는 접근성을 자동 제공하지 않는다.

## 실무 관점

### Callback pyramid는 composition 비용을 눈에 보이게 한다

```tsx
<Auth>
  {(user) => (
    <FeatureFlag name="checkout-v2">
      {(enabled) => (
        <Analytics>
          {(instrumentation) => (
            <Checkout user={user} enabled={enabled} instrumentation={instrumentation} />
          )}
        </Analytics>
      )}
    </FeatureFlag>
  )}
</Auth>
```

데이터 흐름은 보이지만 정상 경로가 오른쪽으로 밀리고 각 provider의 loading/error 분기가 중첩된다. 순수 값 제공자는 Hook 조합으로 옮긴다.

```tsx
function CheckoutContainer() {
  const user = useAuth();
  const enabled = useFeatureFlag("checkout-v2");
  const instrumentation = useAnalytics();

  return <Checkout user={user} enabled={enabled} instrumentation={instrumentation} />;
}
```

실제 tree boundary만 component로 남긴다. 여러 관련 slot이 상태를 공유하면 [5a-3 Compound](./03-compound-pattern.md)가 읽기 쉬울 수 있다.

### Inline function identity는 측정 대상이지 금지 규칙이 아니다

```tsx
<Collection items={items} renderItem={(item) => <Row item={item} />} />
```

부모 렌더마다 새 함수가 생긴다. 하지만 `Collection`이 매번 렌더되어야 하고 item 렌더가 가볍다면 `useCallback`은 아무 이득 없이 dependency 관리만 추가한다. 비용이 생기는 조건은 보통 다음이 함께 있을 때다.

- owner가 `memo`로 렌더 생략 가능한 component다.
- render function이 유일하게 매번 바뀌는 prop이다.
- owner subtree가 충분히 무겁고 상호작용 빈도가 높다.
- Profiler에서 함수 신원 때문에 생략이 깨졌다는 증거가 있다.

그때만 `useCallback` 또는 안정된 component slot을 검토한다. React Compiler를 사용하는 환경이라면 수동 memoization 정책도 compiler 설정과 함께 측정한다([5-5 성능 모델](../phase-5/05-performance-model.md)).

### Children-as-function과 일반 children을 타입에서 구분한다

`children: ReactNode | ((api) => ReactNode)`처럼 두 방식을 한 prop에 허용하면 구현은 runtime type check를 해야 하고 호출자 문서도 두 갈래가 된다. 정말 두 API가 필요한지 먼저 묻는다. 필요한 경우 판별 prop이나 별도 component 이름으로 나눠 모호성을 줄인다.

```tsx
type StaticPanelProps = { children: ReactNode };
type HeadlessPanelProps = { render(api: PanelApi): ReactNode };
```

`ReactNode`에는 function이 포함되지 않으므로 children-as-function은 명시적으로 함수 타입을 선언해야 한다.

### 점진적 전환

Render Props owner가 순수 로직만 소유한다면 다음 순서로 옮긴다.

1. state/Effect를 `useFeature`로 추출한다.
2. 기존 render component는 Hook을 호출하고 `children(api)`를 호출하는 호환 adapter가 된다.
3. 새 소비자는 Hook을 직접 사용한다.
4. legacy 소비자 이전 후 adapter를 제거한다.

owner가 DOM/ref/portal을 소유하면 Hook 추출 후에도 wrapper는 유지한다. 이때 render prop이 여러 개라면 compound slot 또는 명시적 component props로 재구성할 수 있다.

### 관찰 실험

**실험 1 — 동일 로직 비교**

online status나 geolocation을 children-as-function과 custom hook으로 각각 구현한다. 동일 동작 테스트를 적용하고 다음을 기록한다.

| 축 | Render Props | Hook |
|---|---|---|
| 상태·Effect 소유 인스턴스 | | |
| tree wrapper | | |
| 호출 지점 분기 | | |
| 타입 추론 위치 | | |
| owner DOM 필요 여부 | | |

**실험 2 — 중첩 평탄화**

render component 세 개를 중첩하고 loading/error 분기를 추가한다. Hook 조합 또는 Context/compound로 바꾼 뒤 코드 줄 수보다 **정상·오류 데이터 흐름을 한 번에 추적할 수 있는지** 비교한다.

**실험 3 — 함수 신원**

무거운 memoized `Collection`에 inline `renderItem`을 전달해 대표 입력 상호작용을 Profiler로 기록한다. 안정된 callback 전후의 commit 시간과 렌더 범위가 실제로 달라질 때만 최적화를 유지한다.

### 선택 체크리스트

- owner가 React tree의 실제 DOM·ref·portal·focus·animation boundary를 소유하는가?
- 함수 인자가 HOC 주입보다 데이터 흐름과 타입을 더 명시적으로 만드는가?
- primary slot 하나면 `children`, 여러 의미 slot이면 `renderX`로 읽히는가?
- generic item·key·optional fallback 책임이 타입에 드러나는가?
- 접근성 props와 focus 책임을 owner와 호출자 중 누가 맡는지 정했는가?
- 순수 로직 전달만 한다면 custom hook으로 평탄화할 수 있는가?
- inline function 비용을 Profiler로 확인했는가?

## 정리

- Render Props는 React node를 반환하는 전략 함수를 prop으로 받아 state/behavior와 UI 표현을 분리한다.
- children-as-function은 주 렌더 전략 하나에 간결하고, `renderItem`·`renderEmpty`는 여러 typed slot의 의미를 드러낸다.
- HOC보다 값이 함수 인자로 명시적이지만 여러 owner를 중첩하면 callback pyramid가 생긴다.
- owner가 DOM·focus·portal 같은 tree 일부여야 할 때 wrapper가 유효하다. 순수 로직만 전달하면 custom hook이 더 직접적이다.
- generic 추론, key, fallback, 접근성 책임은 slot 타입과 동작 테스트에 포함한다.
- inline 함수의 성능 비용은 memoization을 적용하기 전에 Profiler로 입증한다.

## 확인 문제

**Q1.** `MousePosition` render component를 `useMousePosition`으로 바꿨더니 코드가 평평해졌다. 반대로 `FocusRegion`은 Hook만으로 바꾸기 어려운 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

mouse position owner가 단지 event/state 로직을 전달한다면 호출 component가 Hook을 직접 조합할 수 있다. FocusRegion은 focus 대상을 한정하는 실제 DOM wrapper와 ref 수명을 소유한다. Hook만 남기면 그 DOM/ref 연결 책임을 모든 호출자에게 다시 노출하므로 component boundary의 의미가 남는다.
</details>

**Q2.** `Collection<T>`가 `renderItem`이 반환한 element의 `key`를 호출자에게 맡겼더니 누락 경고가 반복된다. API를 어떻게 바꿀 수 있는가?

<details>
<summary>정답과 해설</summary>

`getKey(item): Key`를 별도 필수 prop으로 받고 owner가 각 render 결과를 keyed Fragment로 감싼다. 그러면 item identity 정책이 타입에 드러나고 renderItem은 표현만 책임진다. index를 기본 key로 고정하지 않는다.
</details>

**Q3.** memoized owner에 inline `renderItem`을 전달했다는 이유만으로 모두 `useCallback`으로 감싸자는 제안이 나왔다. 어떤 증거가 필요한가?

<details>
<summary>정답과 해설</summary>

owner가 다른 props는 안정적이라 실제로 memo 생략 가능하고, render function 신원만 때문에 렌더되며, 그 subtree 비용과 상호작용 빈도가 유의미하다는 Profiler 기록이 필요하다. 전후 commit 시간·렌더 범위 차이가 없으면 dependency와 인지 비용만 늘린 최적화이므로 되돌린다.
</details>

## 참고 자료

- [React legacy — Render Props](https://legacy.reactjs.org/docs/render-props.html) — 패턴의 정의, children-as-function, HOC와의 관계를 확인한다. 현재 문서가 아님을 전제로 읽는다.
- [React — `cloneElement` alternatives](https://react.dev/reference/react/cloneElement#alternatives) — render prop, Context, custom Hook을 명시적 데이터 전달 대안으로 비교한다.
- [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — 순수 로직 owner를 평탄화할 현대적 전환 기준을 확인한다.
- [Patterns.dev — Render Props Pattern](https://www.patterns.dev/react/render-props-pattern/) — 패턴 지형과 비교 사례를 위한 2차 자료다.
