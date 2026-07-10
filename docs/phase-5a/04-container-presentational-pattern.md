# 5a-4. Container/Presentational Pattern

> 한 줄 요약: Container/Presentational은 파일명 규칙이 아니라 외부 원본·상태 전이·event 번역과 시각적 표현의 변경 이유를 분리하는 국소 경계이며, 정책 없는 1:1 wrapper는 제거해야 한다.

이 문서는 React 19.x와 TypeScript strict를 기준으로 한다. 데이터 요청의 cache·재검증은 [5-8 서버 상태](../phase-5/08-server-state.md), Server Component 실행 모델은 [8-6 Next.js와 RSC](../phase-8/06-nextjs-and-rsc.md)에 위임한다.

## 학습 목표

- 데이터 원본·오케스트레이션과 props→UI 표현이라는 두 변경 축을 구분할 수 있다.
- loading·empty·error·success를 판별 유니언 view model로 설계해 순수 view의 상태 공간을 완전하게 렌더할 수 있다.
- custom hook, container component, route/provider/boundary 중 적절한 orchestration 경계를 선택할 수 있다.
- fixture·동작 테스트가 쉬워지는 조건과 props drilling·파일 ceremony가 늘어나는 실패 조건을 판단할 수 있다.
- 1:1 wrapper가 정책을 소유하지 않을 때 계층을 안전하게 제거할 수 있다.

## 배경: 왜 이것이 존재하는가

다음 기능은 한 컴포넌트 안에서 모두 동작할 수 있다.

```tsx
function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("recent");

  useEffect(() => {
    fetch("/api/orders")
      .then((response) => response.json())
      .then(setOrders)
      .finally(() => setLoading(false));
  }, []);

  // fetch, 오류, 정렬, 분석 event, JSX가 계속 이어진다.
}
```

문제는 줄 수가 아니라 변경 이유가 섞이는 것이다. API schema와 retry 정책이 바뀌는 이유, 사용자가 정렬을 선택하는 상태 전이, empty view의 copy와 markup이 바뀌는 이유가 다르다. 한 파일에 있으면 모든 변경이 같은 component를 건드리고, UI 한 상태를 보기 위해 네트워크까지 준비해야 한다.

Container/Presentational 패턴은 이 변경 축을 나눈다.

- **container**: 데이터 원본, 외부 시스템 연결, 상태 전이, view model 변환, event 번역을 소유한다.
- **presentational component(view)**: 명시적 props를 접근 가능한 UI로 매핑하고 사용자 의도를 callback으로 올린다.

Presentational이 지역 state를 절대 가지면 안 된다거나 Container가 class여야 한다는 역사적 규칙은 버린다. dropdown 열림, focus, 입력 draft처럼 순수하게 시각적 수명의 state는 view에 있어도 된다. 판정 기준은 state 유무가 아니라 **변경 이유와 의존성 방향**이다.

## 핵심 개념

### 경계는 데이터 흐름을 한 방향으로 만든다

```text
API / URL / cache / provider
          │
          ▼
OrdersContainer 또는 useOrdersPage
  - 원본 읽기
  - 상태 전이
  - domain → view model
  - UI event → domain command
          │ props
          ▼
OrdersView
  - loading/empty/error/success 표현
  - click/change 의도를 callback으로 전달
```

View는 `fetch`, query client, router, SDK를 import하지 않는다. Container는 버튼 색이나 list markup을 소유하지 않는다. 의존성은 바깥 시스템에서 view의 작은 props 계약으로 향한다.

이 구조는 ports/adapters와 닮았지만 애플리케이션 전체를 계층화하는 처방은 아니다. 한 feature에서 API 변화와 UI variation이 독립적으로 자주 바뀔 때 두는 국소 seam이다.

### Boolean 조합 대신 유효한 상태만 표현한다

다음 props는 불가능한 조합을 허용한다.

```tsx
type FragileProps = {
  loading: boolean;
  error?: Error;
  orders?: Order[];
};
```

`loading=true`이면서 `error`와 `orders`가 모두 있는 경우 View가 무엇을 그려야 하는가? 판별 유니언(discriminated union)으로 상태 공간을 닫는다.

```tsx
type OrderRow = {
  id: string;
  label: string;
  total: string;
};

type OrdersViewState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string; retryable: boolean }
  | { status: "success"; rows: OrderRow[] };

type OrdersViewProps = {
  state: OrdersViewState;
  sort: "recent" | "total";
  onSortChange(sort: "recent" | "total"): void;
  onRetry(): void;
  onOrderOpen(id: string): void;
};
```

View는 외부 오류 객체나 domain entity 전체를 몰라도 된다.

```tsx
function isSort(value: string): value is "recent" | "total" {
  return value === "recent" || value === "total";
}

export function OrdersView({
  state,
  sort,
  onSortChange,
  onRetry,
  onOrderOpen,
}: OrdersViewProps) {
  return (
    <section aria-labelledby="orders-heading">
      <h1 id="orders-heading">주문</h1>
      <label>
        정렬
        <select
          value={sort}
          onChange={(event) => {
            if (isSort(event.target.value)) {
              onSortChange(event.target.value);
            }
          }}
        >
          <option value="recent">최근 주문</option>
          <option value="total">금액</option>
        </select>
      </label>

      {state.status === "loading" && <p aria-live="polite">불러오는 중…</p>}
      {state.status === "empty" && <p>아직 주문이 없다.</p>}
      {state.status === "error" && (
        <div role="alert">
          <p>{state.message}</p>
          {state.retryable && <button onClick={onRetry}>다시 시도</button>}
        </div>
      )}
      {state.status === "success" && (
        <ul>
          {state.rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => onOrderOpen(row.id)}>
                {row.label} · {row.total}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

DOM의 `event.target.value`는 arbitrary string이므로 `isSort`가 통과한 값만 callback으로 보낸다. TypeScript가 닫은 상태 공간을 DOM 경계의 근거 없는 단언으로 다시 여는 일을 피한다([4-2 타입 설계](../phase-4/02-type-design.md)).

### Container는 domain을 view 언어로 번역한다

Container는 server state 도구를 직접 재구현하지 않고 이미 선택한 원본을 소비한다고 가정한다.

```tsx
function toOrdersViewState(query: OrdersQueryResult): OrdersViewState {
  if (query.status === "pending") return { status: "loading" };
  if (query.status === "error") {
    return {
      status: "error",
      message: "주문을 불러오지 못했다.",
      retryable: query.error.kind !== "forbidden",
    };
  }
  if (query.data.length === 0) return { status: "empty" };

  return {
    status: "success",
    rows: query.data.map((order) => ({
      id: order.id,
      label: `주문 ${order.number}`,
      total: formatCurrency(order.total, order.currency),
    })),
  };
}

export function OrdersContainer() {
  const [sort, setSort] = useOrderSortFromUrl();
  const query = useOrdersQuery({ sort });
  const navigate = useNavigate();
  const instrumentation = useAnalytics();

  return (
    <OrdersView
      state={toOrdersViewState(query)}
      sort={sort}
      onSortChange={setSort}
      onRetry={query.retry}
      onOrderOpen={(id) => {
        instrumentation.action("order_open", { id });
        navigate(`/orders/${id}`);
      }}
    />
  );
}
```

Container가 소유하는 것은 단순 전달이 아니라 정책이다.

- sort의 원본은 local state가 아니라 URL이다.
- domain 오류를 사용자 copy와 retry 가능 여부로 바꾼다.
- money formatting을 view용 문자열로 바꾼다.
- UI의 `onOrderOpen(id)`를 분석 event와 navigation으로 번역한다.

View는 어떤 router·query cache·analytics SDK를 썼는지 모른다. 반대로 Container는 `<ul>`인지 table인지 모른다.

### Hook과 Container는 대체 관계가 아니라 다른 축이다

데이터 연결을 custom hook으로 추출할 수 있다.

```tsx
function useOrdersPage(): OrdersViewProps {
  // URL, query, analytics, navigation을 조합한다.
  return controller;
}

function OrdersPage() {
  const props = useOrdersPage();
  return <OrdersView {...props} />;
}
```

이때 `OrdersPage`는 얇은 container component이고 `useOrdersPage`가 orchestration을 재사용한다. wrapper가 무조건 나쁜 것은 아니다. route element, provider, Suspense/error boundary, layout을 소유하면 component boundary가 필요하다.

```tsx
function OrdersRoute() {
  return (
    <OrdersFilterProvider>
      <Suspense fallback={<OrdersSkeleton />}>
        <OrdersContainer />
      </Suspense>
    </OrdersFilterProvider>
  );
}
```

반대로 boundary를 전혀 소유하지 않고 `const props = useX(); return <XView {...props} />`만 하는 1:1 component가 앱 전역 규칙처럼 반복된다면 Hook을 feature page에서 직접 호출해 파일을 줄여도 된다. 계층 수가 아니라 각 계층의 정책으로 판단한다.

### View model 위치는 재사용 방향을 바꾼다

Container가 `Order`를 `OrderRow`로 미리 바꾸면 View는 단순하고 fixture가 작아진다. 하지만 다른 화면이 같은 View를 재사용하면서 currency나 label 형식을 바꾸고 싶다면 변환이 너무 일찍 고정될 수 있다.

| 변환 위치 | 이점 | 비용 |
|---|---|---|
| Container에서 문자열까지 완성 | View가 표시만 하고 locale/API를 모른다 | 다른 표현에서 row model을 다시 만들어야 한다 |
| View가 domain entity를 직접 받음 | domain 정보로 다양한 표현 가능 | View가 API/domain 변경과 formatting 의존성을 떠안는다 |
| 중간 view model + formatter prop | 변경 축을 열어 둔다 | props와 추상화 수가 늘어난다 |

기본값은 **현재 view가 실제로 필요한 최소 데이터**다. 미래의 모든 표현을 예상해 거대한 `OrderViewModel`을 만들지 않는다.

## 실무 관점

### 순수 View의 테스트 seam

외부 시스템 없이 모든 상태를 fixture로 렌더할 수 있다.

```tsx
const fixtures: Record<string, OrdersViewProps> = {
  loading: {
    state: { status: "loading" },
    sort: "recent",
    onSortChange() {},
    onRetry() {},
    onOrderOpen() {},
  },
  error: {
    state: { status: "error", message: "일시적 오류", retryable: true },
    sort: "recent",
    onSortChange() {},
    onRetry() {},
    onOrderOpen() {},
  },
  success: {
    state: {
      status: "success",
      rows: [{ id: "o-1", label: "주문 1001", total: "₩12,000" }],
    },
    sort: "recent",
    onSortChange() {},
    onRetry() {},
    onOrderOpen() {},
  },
};
```

Storybook이 없어도 작은 fixture route나 component test로 loading/error/success를 결정적으로 본다. 테스트는 “내부에 Hook이 몇 개 있는가”가 아니라 role·이름·callback이라는 사용자 동작 계약을 검증한다([6-4 테스트 전략](../phase-6/04-testing-strategy.md)).

Container test는 adapter 계약에 집중한다.

- domain query 상태가 올바른 view state로 변환되는가?
- retry 불가능 오류에서 button이 숨는가?
- order click이 분석과 navigation command를 올바른 순서로 호출하는가?
- URL sort가 view와 query key의 같은 원본인가?

### 과도한 계층의 징후

다음 구조는 이름만 책임을 나눴을 가능성이 높다.

```tsx
function UserContainer(props: UserProps) {
  return <UserPresentational {...props} />;
}
```

Container가 원본·전이·변환·boundary 중 아무것도 소유하지 않는다. 파일 두 개, props type 재수출, 테스트 setup만 늘어난다. View 이름에 `Presentational` 접미사를 붙인다고 재사용성이 생기지 않는다.

제거 실험을 한다.

1. wrapper를 inline하거나 삭제한다.
2. 외부 SDK import가 View로 새지 않는지 확인한다.
3. fixture가 여전히 외부 시스템 없이 동작하는지 확인한다.
4. 파일·props hop이 줄고 정책 손실이 없다면 제거가 맞다.

### Props drilling은 경계 실패와 항상 같지 않다

Container에서 View로 5~8개 명시적 props를 한 단계 전달하는 것은 추적 가능한 계약이다. 여러 중간 layout이 사용하지 않는 props를 계속 전달하면 drilling 문제가 된다. 해결책은 무조건 Context가 아니다.

- Container를 실제 consumer 가까이 내린다.
- 관련 props를 작은 controller object로 묶되 god object가 되지 않게 한다.
- composition slot으로 중간 component가 props를 몰라도 되게 한다.
- 같은 feature subtree가 실제 공유한다면 Context를 둔다.

Context는 drilling을 없애는 대신 의존성을 암묵적으로 만들고 consumer 전파 범위를 만든다([5a-3](./03-compound-pattern.md)).

### Server/Client 경계는 현대적 Container 역할의 일부만 대체한다

framework의 Server Component나 route loader는 data access와 초기 loading 경계를 서버/route로 올릴 수 있다. 이는 client container의 일부 책임을 줄인다. 그러나 사용자의 local interaction, optimistic state, browser API, event translation과 pure view 계약은 여전히 남는다. 실행 위치·직렬화·hydration을 이 패턴 문서에서 재교육하지 않고 [8-5 렌더링 전략](../phase-8/05-rendering-strategies.md)과 [8-6](../phase-8/06-nextjs-and-rsc.md)로 넘긴다.

### 관찰 실험

**실험 1 — 혼합 컴포넌트 분리**

1. fetch·sort·format·JSX가 섞인 화면에서 외부 원본과 UI 상태 목록을 작성한다.
2. 유효 상태를 판별 유니언으로 만들고 pure View를 분리한다.
3. loading/error/empty/success fixture만으로 View를 렌더한다.
4. 같은 사용자 동작 테스트를 분리 전후에 적용해 행동 보존을 확인한다.

**실험 2 — 빈 wrapper 제거**

정책 없는 1:1 Container를 삭제하고 다음을 비교한다.

| 지표 | 삭제 전 | 삭제 후 |
|---|---|---|
| 파일/props hop | | |
| 외부 의존성이 View로 샜는가 | | |
| fixture 독립성 | | |
| route/provider boundary 손실 | | |

### 선택 체크리스트

- 외부 원본·전이와 UI 표현이 서로 다른 이유로 바뀌는가?
- View props가 query client나 SDK type이 아니라 유효한 UI 상태를 표현하는가?
- Container가 data shaping, event translation, route/provider/boundary 중 실제 정책을 소유하는가?
- View를 외부 시스템 없이 모든 상태 fixture로 렌더할 수 있는가?
- view model이 현재 UI에 필요한 최소 데이터인가?
- props hop을 줄이려다 Context로 의존성을 숨기고 있지 않은가?
- wrapper를 제거해도 경계가 유지된다면 제거했는가?

## 정리

- Container/Presentational은 stateful/stateless나 폴더 접미사 규칙이 아니라 외부 오케스트레이션과 UI 표현의 변경 축을 분리한다.
- Boolean 조합 대신 판별 유니언 view state를 쓰면 loading·empty·error·success 계약을 완전하게 렌더할 수 있다.
- Container는 원본 읽기, domain→view 변환, UI event→command 번역을 소유하고 View는 명시적 props만 렌더한다.
- custom hook은 orchestration 로직을 추출하고 container component는 route/provider/boundary를 소유할 수 있다.
- fixture와 동작 테스트라는 이득이 없다면 pure view 분리가 형식에 그쳤는지 점검한다.
- 아무 정책도 없는 1:1 wrapper는 ceremony이므로 제거한다.

## 확인 문제

**Q1.** `loading`, `error`, `data`를 각각 optional prop으로 받은 View가 loading spinner와 error를 동시에 그린다. 타입과 경계를 어떻게 수정하는가?

<details>
<summary>정답과 해설</summary>

Container에서 외부 query 상태를 `loading | empty | error | success` 판별 유니언 view state로 변환한다. 각 variant가 필요한 데이터만 갖게 하고 View는 `status`로 철저하게 분기한다. 그러면 불가능한 조합을 생성하는 책임은 adapter 한 곳에 모이고 View에는 유효 상태만 들어간다.
</details>

**Q2.** `UserContainer`가 props를 한 줄로 `UserView`에 전달할 뿐이다. 무조건 삭제해도 되는가?

<details>
<summary>정답과 해설</summary>

현재 한 줄만 보고 결정하지 않는다. route element, provider, error/Suspense boundary, lazy 경계처럼 component 자체가 tree 정책을 소유하는지 확인한다. 아무 정책도 없고 제거 후에도 View의 외부 의존성·fixture 독립성이 유지된다면 삭제한다.
</details>

**Q3.** View가 재사용 가능해야 한다는 이유로 API의 `Order` entity 전체와 query client를 props로 받는다. 어떤 결합이 생기는가?

<details>
<summary>정답과 해설</summary>

View가 API schema, cache 상태, domain formatting에 결합해 외부 시스템 없는 fixture가 어려워지고 schema 변경이 시각적 component까지 전파된다. 현재 UI에 필요한 최소 `OrderRow`와 판별 상태로 변환하고 retry·open 같은 의도를 callback으로 전달한다. 다른 화면의 요구가 실제 생겼을 때 공통 model이나 formatter seam을 추출한다.
</details>

## 참고 자료

- [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — container 로직 추출과 view 분리의 현재 기본 도구를 확인한다.
- [React — Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) — 단일 원본과 데이터 흐름을 확인한다.
- [React — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — data shaping과 파생 상태를 Effect로 옮기지 않을 기준을 확인한다.
- [Patterns.dev — Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) — 패턴의 역사와 문제 설정을 위한 2차 자료다.
