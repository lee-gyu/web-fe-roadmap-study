# 5a-1. HOC Pattern

> 한 줄 요약: HOC는 여러 컴포넌트에 같은 트리 경계를 일관되게 씌우는 데 유효하지만, 주입 props·컴포넌트 신원·ref·정적 계약을 명시하지 않으면 재사용보다 추적 비용이 더 커진다.

이 문서는 React 19.x와 TypeScript strict를 기준으로 하며, API 지원 상태는 2026-07-10에 React 공식 문서에서 다시 확인했다. 새 코드의 기본 선택은 일반 합성과 custom hook이지만, HOC(higher-order component)는 장기 운영 코드와 라이브러리 경계를 해석하는 데 여전히 필요한 패턴이다.

## 학습 목표

- HOC를 `Component<P & Injected> → Component<P>` 변환으로 설명하고 데이터 흐름을 추적할 수 있다.
- 횡단 관심사가 실제 트리 경계를 요구하는지 판단해 HOC와 Hook·일반 wrapper 중 하나를 선택할 수 있다.
- 주입 props, 이름 충돌, `displayName`, ref와 정적 멤버의 경계를 TypeScript 공개 API로 표현할 수 있다.
- 렌더 중 HOC 생성이 자식 상태를 초기화하는 원인을 컴포넌트 타입과 재조정으로 설명할 수 있다.
- 동일 동작을 custom hook으로 옮길 때 얻는 제어권과 지불하는 중복을 비교할 수 있다.

## 배경: 왜 이것이 존재하는가

분석 이벤트, 권한, feature flag처럼 여러 화면에 같은 정책을 적용해야 한다고 하자. 모든 컴포넌트가 직접 정책 코드를 호출하면 호출 누락과 서로 다른 예외 처리가 생긴다. 반대로 하나의 wrapper component를 모든 호출 지점에서 손으로 조립하면 JSX는 명시적이지만 적용 지점이 반복된다.

HOC는 이 반복을 **컴포넌트 변환**으로 만든다.

```tsx
const TrackedCheckout = withPageAnalytics(Checkout);
```

일반 컴포넌트가 props를 React element로 바꾼다면 HOC는 컴포넌트 타입을 다른 컴포넌트 타입으로 바꾼다. React의 별도 API가 아니라 [3-2 고차 함수](../phase-3/02-closures-and-functions.md)와 컴포넌트 합성에서 나오는 관용구다.

HOC의 역사적 사용 사례에는 외부 store 구독, router·번역 데이터 주입이 많았다. 함수 컴포넌트와 Hooks가 보편화된 뒤 순수 로직 주입의 상당수는 custom hook으로 평탄화할 수 있다. 그렇다고 모든 HOC가 사라지는 것은 아니다. error/suspense boundary, provider, 권한 차단처럼 **소비자 주위에 같은 트리 구조를 강제**해야 한다면 wrapper의 존재 자체가 정책이다.

## 핵심 개념

### 최소 모델: 내부 요구와 외부 공개 props를 나눈다

다음 예제에서 `CheckoutView`는 분석 포트를 요구하지만, 외부 호출자는 그 포트를 알 필요가 없다.

```tsx
import type { ComponentType } from "react";

type Analytics = {
  pageViewed(name: string): void;
  action(name: string, attributes?: Record<string, string>): void;
};

type InjectedAnalytics = {
  instrumentation: Analytics;
};

function createWithPageAnalytics(instrumentation: Analytics) {
  return function withPageAnalytics<PublicProps extends object>(
    Wrapped: ComponentType<PublicProps & InjectedAnalytics>,
  ) {
    function WithPageAnalytics(props: PublicProps) {
      return <Wrapped {...props} instrumentation={instrumentation} />;
    }

    const wrappedName = Wrapped.displayName ?? Wrapped.name ?? "Component";
    WithPageAnalytics.displayName = `withPageAnalytics(${wrappedName})`;
    return WithPageAnalytics;
  };
}
```

타입 변환은 다음과 같다.

```text
입력: ComponentType<PublicProps & InjectedAnalytics>
출력: ComponentType<PublicProps>
```

`InjectedAnalytics`를 외부 props에서 `Omit`하는 형태보다 애초에 공개 props와 주입 props를 별도 generic으로 세우면 불필요한 단언을 피하기 쉽다. 주입 이름도 `analytics` 같은 흔한 이름 대신 `instrumentation`처럼 이름 공간을 둔다. 그래도 `PublicProps`가 같은 키를 선언하면 계약이 모호해지므로 코드 리뷰와 타입 테스트에서 충돌을 금지해야 한다.

실제 기능은 모듈 경계에서 한 번 합성한다.

```tsx
type CheckoutProps = {
  orderId: string;
};

function CheckoutView({ orderId, instrumentation }: CheckoutProps & InjectedAnalytics) {
  return (
    <button
      type="button"
      onClick={() => instrumentation.action("checkout", { orderId })}
    >
      결제
    </button>
  );
}

const withPageAnalytics = createWithPageAnalytics(browserAnalytics);
export const Checkout = withPageAnalytics(CheckoutView);
```

호출자는 `<Checkout orderId="o-42" />`만 본다. 분석 포트가 암묵적으로 주입된다는 것이 장점이자 비용이다.

### 데이터 흐름과 트리 소유권

HOC 결과는 보통 실제 wrapper 인스턴스를 하나 추가한다.

```text
호출자
└─ WithPageAnalytics        ← 정책·구독·Effect 소유
   └─ CheckoutView          ← 주입 props 소비
      └─ button
```

상태와 Effect는 HOC 함수 호출 자체가 아니라 렌더된 `WithPageAnalytics` 인스턴스에 속한다. 같은 HOC를 두 위치에서 렌더하면 상태도 두 개다. 이 점은 [5-3 상태 스냅샷과 Hook 슬롯](../phase-5/03-state-and-batching.md)의 규칙과 같다.

일반 wrapper와 비교하면 차이는 적용 시점이다.

```tsx
// 호출 지점 합성: 경계가 JSX에 보인다.
const checkoutElement = (
  <AnalyticsBoundary page="checkout">
    <Checkout orderId="o-42" />
  </AnalyticsBoundary>
);

// 정의 지점 합성: 모든 호출자에게 같은 정책을 강제한다.
const Checkout = withPageAnalytics(CheckoutView);
```

누락을 막아야 하는 정책이면 정의 지점 합성이 유리하다. 화면마다 page name이나 fallback을 달리해야 하면 호출 지점 합성이 더 정직하다.

### 컴포넌트 타입은 상태 주소의 일부다

다음 코드는 문법상 가능하지만 잘못된 사용이다.

```tsx
function CheckoutRoute() {
  const [coupon, setCoupon] = useState("");
  const TrackedCheckout = withPageAnalytics(CheckoutView); // 매 렌더 새 함수

  return (
    <TrackedCheckout
      orderId="o-42"
      coupon={coupon}
      onCouponChange={setCoupon}
    />
  );
}
```

`CheckoutRoute`가 렌더될 때마다 `withPageAnalytics`가 새 컴포넌트 함수를 반환한다. 이전 타입과 새 타입이 `===`가 아니므로 React는 같은 위치의 같은 컴포넌트로 보지 않는다. 이전 subtree를 unmount하고 새 subtree를 mount하므로 입력 focus와 자식 state가 사라진다. 성능 문제가 아니라 정합성 문제다. [5-2 재조정](../phase-5/02-rendering-and-reconciliation.md)의 `type + key + position` 규칙이 그대로 적용된다.

합성은 모듈 최상위에서 한 번 수행한다.

```tsx
const TrackedCheckout = withPageAnalytics(CheckoutView);

function CheckoutRoute() {
  return <TrackedCheckout orderId="o-42" />;
}
```

동적 설정이 필요하면 HOC를 동적으로 만들기보다 설정을 prop 또는 Context로 흘리는 편이 신원을 안정적으로 유지한다.

### props 병합 순서는 공개 계약이다

JSX spread의 뒤쪽 값이 앞쪽 값을 덮는다.

```tsx
// 호출자가 instrumentation을 덮을 수 있다.
const callerWins = <Wrapped instrumentation={instrumentation} {...props} />;

// HOC 정책이 최종 값을 가진다.
const policyWins = <Wrapped {...props} instrumentation={instrumentation} />;
```

외부 타입에서 주입 prop을 숨겨도 JavaScript 호출이나 넓은 타입을 통해 값이 들어올 수 있다. 따라서 순서는 우연한 구현 세부가 아니라 우선순위 정책이다. 이벤트 핸들러를 합칠 때도 한쪽을 덮지 말고 호출 순서와 오류 전파를 명시한다.

```tsx
function mergeClickHandlers(
  before: () => void,
  after?: () => void,
) {
  return () => {
    before();
    after?.();
  };
}
```

### `displayName`, ref, static은 자동 전파되지 않는다

`displayName`은 DevTools에서 `withPageAnalytics(CheckoutView)`라는 경계를 찾게 한다. HOC 여러 개를 중첩했다면 트리는 실제 간접층 수만큼 깊어진다. 숨기려 하기보다 이름을 붙여 추적 가능하게 만든다.

React 19에서는 함수 컴포넌트가 `ref`를 prop으로 받을 수 있고 `forwardRef`는 더 이상 새 코드의 필수 장치가 아니다. 그러나 HOC가 ref를 자동으로 내부 컴포넌트에 전달한다는 뜻은 아니다. 외부 ref가 무엇을 가리키는지 공개 타입과 구현에서 명시해야 한다.

```tsx
import type { ComponentPropsWithRef } from "react";

type SearchInputProps = ComponentPropsWithRef<"input"> & {
  label: string;
};

function SearchInput({ label, ref, ...inputProps }: SearchInputProps) {
  return (
    <label>
      {label}
      <input ref={ref} {...inputProps} />
    </label>
  );
}
```

HOC가 이 계약을 보존해야 한다면 `PublicProps`에 ref를 포함시키고 그대로 전달한다. React 18 이하를 지원하는 라이브러리는 `forwardRef` 호환 계층이 필요할 수 있으므로 지원 범위를 별도로 기록한다.

컴포넌트 함수의 custom static도 반환된 wrapper로 복사되지 않는다. route metadata나 query descriptor를 static에 매달기보다 별도 named export로 분리하면 HOC와 무관한 계약이 된다.

### HOC가 적합한 횡단 경계

HOC는 **같은 wrapper를 강제로 적용**해야 할 때 가장 설득력이 있다.

| 문제 | HOC 적합도 | 이유 |
|---|---|---|
| 화면별 분석 포트 주입 | 조건부 | 누락 방지가 중요하면 유효하다. 호출 지점별 설정이 많으면 Hook이 낫다 |
| 권한이 없을 때 subtree 자체를 차단 | 높음 | 렌더 경계와 fallback을 중앙화한다 |
| feature flag로 구현 교체 | 조건부 | 전환 정책을 정의 지점에 고정할 때 유효하다 |
| error boundary 적용 | 높음 | 함수 Hook이 대신할 수 없는 실제 트리 경계다 |
| 단순 계산 함수 공유 | 낮음 | 일반 함수가 더 작고 React 결합도 없다 |
| 컴포넌트 내부에서만 필요한 구독 | 낮음 | custom hook이 데이터 흐름을 호출 지점에 드러낸다 |

## 실무 관점

### Wrapper hell은 노드 수보다 추적 비용이 문제다

```tsx
export default withAuth(
  withFeatureFlag("new-checkout")(
    withPageAnalytics(
      withTranslation(CheckoutView),
    ),
  ),
);
```

DOM 노드가 반드시 늘어나는 것은 아니지만 React component tree, stack trace, generic 오류 메시지는 깊어진다. 더 큰 문제는 어떤 계층이 어떤 prop을 넣고 차단했는지 호출 지점에서 보이지 않는다는 점이다. 합성 순서가 동작을 바꾼다면 순서도 공개 계약이다.

세 개 이상의 enhancer가 반복되면 다음을 검토한다.

- provider/boundary를 route 레이아웃 하나로 모을 수 있는가?
- 데이터 주입은 custom hook으로 옮기고 실제 트리 경계만 남길 수 있는가?
- 관련 정책을 하나의 도메인 HOC로 묶을 때 결합이 줄어드는가, 단지 이름만 숨기는가?

### 현대적 전환: 호출 지점에 제어권을 돌려준다

같은 분석 요구를 Hook으로 옮기면 wrapper가 사라지고 값의 출처가 보인다.

```tsx
function useAnalytics() {
  return useContext(AnalyticsContext);
}

function Checkout({ orderId }: CheckoutProps) {
  const instrumentation = useAnalytics();

  return (
    <button
      type="button"
      onClick={() => instrumentation.action("checkout", { orderId })}
    >
      결제
    </button>
  );
}
```

Hook은 내부 분기를 소비자가 제어하고 TypeScript 추론도 직접 값에 작동한다. 대신 모든 소비자가 Hook을 호출해야 하므로 누락 방지는 lint·테스트·상위 boundary로 옮겨 간다. error boundary처럼 Hook으로 표현할 수 없는 트리 소유권은 HOC 또는 wrapper로 남긴다.

점진적 전환은 외부 API를 보존한 채 가능하다.

1. HOC 내부 로직을 `useAnalytics` 같은 Hook으로 먼저 추출한다.
2. 새 컴포넌트는 Hook을 직접 사용한다.
3. 기존 export의 HOC는 호환 adapter로 유지한다.
4. 소비자 이전이 끝나면 wrapper와 주입 prop을 제거한다.

### 관찰 실험

**실험 1 — 신원과 state 보존**

1. HOC를 부모 렌더 함수 안에서 만들고, 자식 `<input defaultValue="보존되어야 함" />`에 값을 입력한다.
2. 부모 state를 갱신한다.
3. 입력값과 focus가 사라지고 mount cleanup/setup 로그가 반복되는지 확인한다.
4. HOC 생성을 모듈 최상위로 옮긴 뒤 같은 동작에서 state가 보존되는지 비교한다.

**실험 2 — HOC와 Hook 비교**

동일한 사용자 동작 테스트를 두 구현에 적용하고 다음 증거를 남긴다.

| 비교 축 | HOC에서 볼 것 | Hook에서 볼 것 |
|---|---|---|
| 호출 지점 | 주입 값이 숨는가 | Hook 반환값이 보이는가 |
| 트리 | wrapper 수와 이름 | wrapper 제거 여부 |
| 타입 | 주입/공개 prop 경계 | Hook 반환 타입 추론 |
| 테스트 | HOC factory의 포트 주입 | provider 또는 Hook 포트 주입 |
| 전환 | export를 유지할 수 있는가 | 소비자 본문 수정 범위 |

Profiler에서는 wrapper가 있다는 이유만으로 느리다고 결론 내리지 않는다. 대표 상호작용의 commit 수·렌더 범위·시간을 [5-5 성능 모델](../phase-5/05-performance-model.md)의 방법으로 기록한다.

### 선택 체크리스트

- 같은 **트리 경계**를 모든 대상에 강제해야 하는가?
- 주입 값이 호출 지점에서 안 보여도 이해 가능한가?
- 외부 props와 주입 props의 이름 충돌·우선순위가 타입과 코드에 드러나는가?
- 합성이 모듈 경계에서 한 번만 일어나 컴포넌트 신원이 안정적인가?
- DevTools 이름, ref 의미, static export 정책을 정했는가?
- custom hook이나 명시적 wrapper보다 누락 방지·호환성에서 실제 이득이 있는가?
- 제거할 때 소비자 API를 단계적으로 이전할 수 있는가?

## 정리

- HOC는 React API가 아니라 `Component<P & Injected> → Component<P>` 형태의 컴포넌트 변환 패턴이다.
- 정의 지점에서 횡단 경계를 강제하는 것이 핵심 이점이며, 데이터 출처와 props 병합이 암묵적이 된다는 비용을 지불한다.
- HOC를 렌더 중 만들면 매번 새 컴포넌트 타입이 생겨 subtree state가 초기화된다. 합성은 모듈 최상위에서 수행한다.
- `displayName`, ref, custom static은 자동 보존된다고 가정할 수 없다. React 19의 ref-as-prop도 명시적 전달 계약이 필요하다.
- 순수 로직 공유는 custom hook, 호출 지점별 경계는 일반 wrapper가 대개 더 명시적이다. error·권한 boundary처럼 트리 자체를 소유해야 할 때 HOC가 남는다.

## 확인 문제

**Q1.** `withAuth(Page)`를 route component 본문에서 호출하자 검색 입력이 route state 갱신 때마다 초기화되었다. `useState`나 key를 바꾸지 않고도 왜 이런 일이 일어나는지 설명하고 수정하라.

<details>
<summary>정답과 해설</summary>

HOC 호출은 새 컴포넌트 함수를 반환한다. route가 다시 렌더될 때 이전 타입과 새 타입이 참조상 다르므로 React는 같은 위치의 같은 인스턴스로 재조정하지 않고 이전 subtree를 unmount한 뒤 새로 mount한다. HOC 합성을 모듈 최상위로 옮겨 반환된 타입을 안정화한다. 동적 auth 설정은 prop 또는 Context로 전달한다.
</details>

**Q2.** 분석 이벤트 하나를 주입하는 HOC를 Hook으로 바꾸면 React tree와 공개 API, 누락 가능성은 각각 어떻게 달라지는가?

<details>
<summary>정답과 해설</summary>

wrapper component가 제거되고 분석 객체는 Hook 반환값으로 컴포넌트 본문에 드러난다. 주입 props generic과 병합 충돌은 줄지만 각 소비자가 Hook을 직접 호출해야 하므로 적용 누락 가능성은 커진다. 누락이 허용되지 않는 정책이면 route boundary, lint, 공통 action adapter 같은 별도 강제가 필요하다.
</details>

**Q3.** HOC가 외부 `ref`를 받아 내부 input에 전달해야 한다. “나머지 props를 spread했으니 자동 전달된다”는 설명이 왜 불충분한가?

<details>
<summary>정답과 해설</summary>

ref가 어떤 인스턴스나 DOM 노드를 가리킬지는 wrapper의 공개 명령형 계약이다. React 19에서는 ref를 prop으로 받을 수 있지만 HOC가 그 값을 내부 대상까지 명시적으로 전달해야 한다. React 18 이하 지원 여부에 따라 `forwardRef` 호환도 달라진다. 타입·지원 버전·실제 전달 위치를 함께 정의해야 한다.
</details>

## 참고 자료

- [React legacy — Higher-Order Components](https://legacy.reactjs.org/docs/higher-order-components.html) — HOC의 고전적 정의, 합성 관례, 렌더 중 생성·static·ref caveat를 확인한다. 현재 문서가 아님을 전제로 읽는다.
- [React — Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) — 컴포넌트 타입과 위치가 상태 보존을 결정하는 현재 모델을 확인한다.
- [React — `forwardRef`](https://react.dev/reference/react/forwardRef) — React 19의 ref-as-prop 전환과 이전 버전 호환 경계를 확인한다.
- [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — HOC에서 순수 로직을 옮길 현대적 대안의 상태 소유권을 확인한다.
- [Patterns.dev — HOC Pattern](https://www.patterns.dev/react/hoc-pattern/) — 패턴의 문제 설정과 비교 사례를 위한 2차 자료다.
