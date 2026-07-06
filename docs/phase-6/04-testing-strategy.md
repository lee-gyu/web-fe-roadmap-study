# 6-4. 테스트 전략

> 한 줄 요약: 이 문서를 읽고 나면 프론트엔드 테스트의 계약을 구현 상세가 아니라 접근성 트리와 사용자 상호작용으로 정의하고, Vitest·React Testing Library·MSW의 역할 경계를 설계할 수 있다.

이 문서는 React 19, Vitest 4.1, Testing Library 문서, MSW 2 계열의 네트워크 mocking 모델을 기준으로 한다. React의 렌더링·상태 모델은 Phase 5, Vite 변환 파이프라인은 [6-2](./02-bundlers.md)를 전제한다.

## 학습 목표

- 프론트엔드에서 테스트 피라미드보다 통합 중심의 테스트 트로피가 자주 맞는 이유를 UI 상호작용 비용 구조로 설명할 수 있다.
- 구현 상세와 사용자 관찰 가능한 동작을 구분하고, 리팩터링에 강한 테스트를 설계할 수 있다.
- React Testing Library의 role 우선 쿼리가 접근성 트리를 계약으로 삼는다는 점을 설명할 수 있다.
- 함수 mock, 모듈 mock, MSW 네트워크 mock의 비용과 경계를 비교해 선택할 수 있다.
- Vitest가 Vite 설정과 변환 파이프라인을 공유하는 구조와 jsdom/happy-dom 환경의 한계를 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

백엔드 테스트에서 익숙한 기본 구도는 단위 테스트를 많이, 통합 테스트를 적당히, E2E를 적게 두는 피라미드다. 이 구도는 순수 함수와 명확한 port가 많은 서버 코드에 잘 맞는다. 프론트엔드 UI는 조금 다르다. 사용자가 관찰하는 버그는 컴포넌트 하나의 계산보다 **렌더 결과, 이벤트, 상태 전이, 네트워크 응답, 접근성 속성의 결합**에서 자주 생긴다.

예를 들어 장바구니 버튼은 다음 조각이 모두 맞아야 사용자에게 맞다.

- 버튼이 접근성 트리에 올바른 이름과 role로 노출된다.
- 클릭 이벤트가 핸들러에 연결된다.
- optimistic UI 또는 loading state가 적절히 보인다.
- 서버 요청 성공/실패에 따라 화면이 갱신된다.
- React 상태 batching과 rerender가 의도한 결과를 만든다.

이 조각을 모두 함수 단위 mock으로 분해하면 테스트는 빠르지만, 사용자가 겪는 계약을 놓치기 쉽다. 반대로 브라우저 E2E만으로 모두 검증하면 느리고 실패 원인 진단이 어렵다. 프론트엔드에서 통합 테스트가 중심이 되는 이유는 이 중간 지점, 즉 **실제 DOM과 사용자 이벤트는 사용하되 브라우저·네트워크 전체는 필요한 만큼만 제어하는 지점**이 비용 대비 신뢰도가 높기 때문이다.

이 장은 [1-7 접근성](../phase-1/07-accessibility.md)의 접근성 트리, [5-2 렌더링과 재조정](../phase-5/02-rendering-and-reconciliation.md)의 "렌더는 구현이고 결과가 계약", [5-8 서버 상태](../phase-5/08-server-state.md)의 캐시/네트워크 경계와 연결된다.

## 핵심 개념

### 테스트 대상은 구현이 아니라 계약이다

다음 컴포넌트가 있다.

```jsx
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount((value) => value + 1)}>
      Count: {count}
    </button>
  );
}
```

구현 상세에 결합한 테스트는 내부 state나 컴포넌트 함수 호출에 관심을 둔다. React 함수 컴포넌트에서는 state를 직접 읽기 어렵기 때문에, 이런 테스트는 대개 mock과 구조 노출을 요구한다.

```jsx
// ❌ 구현 상세에 묶인 사고방식
// "setCount가 호출됐는가"를 확인하면 UI 계약은 확인하지 못한다.
```

사용자 계약은 다르다. 사용자는 버튼을 찾고 클릭한 뒤 화면의 이름이 바뀌는지 본다.

```jsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Counter } from "./Counter.jsx";

test("클릭하면 카운터 표시가 증가한다", async () => {
  const user = userEvent.setup();
  render(<Counter />);

  const button = screen.getByRole("button", { name: "Count: 0" });
  await user.click(button);

  expect(
    screen.getByRole("button", { name: "Count: 1" }),
  ).toBeInTheDocument();
});
```

이 테스트는 `useState`를 `useReducer`로 바꾸거나 버튼 내부 markup을 조금 바꿔도, 사용자가 보는 계약이 유지되면 통과한다. 반대로 버튼이 div로 바뀌어 접근성 role을 잃거나, 클릭해도 이름이 바뀌지 않으면 실패한다. 좋은 테스트는 리팩터링에 둔감하고 동작 변화에 민감하다.

### React Testing Library의 쿼리는 접근성 트리를 계약으로 삼는다

Testing Library의 우선순위는 `getByRole`을 맨 위에 둔다. 이유는 단순한 취향이 아니다. role과 accessible name은 [1-7](../phase-1/07-accessibility.md)에서 본 접근성 트리의 핵심이다. 사용자는 시각적으로 "저 버튼"을 클릭하지만, 스크린 리더와 자동화 도구는 접근성 트리를 통해 같은 대상을 찾는다.

```jsx
// ✅ 사용자와 보조 기술이 인식하는 계약
screen.getByRole("button", { name: /저장/ });

// ✅ form control은 label이 계약이다
screen.getByLabelText("이메일");

// ⚠️ 마지막 선택지: 사용자가 볼 수 없는 테스트 전용 계약
screen.getByTestId("save-button");

// ❌ class는 styling 구현 상세다
container.querySelector(".primary-button");
```

`getByTestId`가 항상 나쁜 것은 아니다. 아이콘만 있고 텍스트가 시각적으로 숨겨지는 복잡한 canvas wrapper, 동적으로 변하는 텍스트, 접근성 트리에 노출되지 않아야 하는 내부 요소에는 테스트 전용 stable hook이 필요할 수 있다. 하지만 버튼, 링크, 입력, 제목, 목록처럼 사용자가 인식하는 요소는 role/name으로 찾는 것이 기본이다.

쿼리 종류도 상태 모델을 표현한다.

```jsx
screen.getByRole("alert");       // 지금 반드시 있어야 한다. 없으면 즉시 실패.
screen.queryByRole("alert");     // 없어야 함을 검사할 때 null을 받을 수 있다.
await screen.findByRole("alert"); // 비동기 상태 전이를 기다린다.
```

`findBy`는 "이벤트 후 DOM이 나중에 바뀐다"는 React/네트워크 상태 전이를 테스트 코드에 드러낸다. `setTimeout`으로 임의 대기하는 대신, 사용자가 관찰할 요소가 나타날 때까지 기다린다.

### Mock은 경계를 어디에 두는가의 문제다

상품 목록 컴포넌트가 서버에서 데이터를 읽는다고 하자.

```jsx
export function ProductList() {
  const { data, status } = useQuery({
    queryKey: ["products"],
    queryFn: () => fetch("/api/products").then((res) => res.json()),
  });

  if (status === "pending") return <p role="status">Loading</p>;

  return (
    <ul>
      {data.map((product) => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}
```

함수 mock은 `fetchProducts()` 같은 wrapper를 가짜 함수로 바꾸는 방식이다.

```js
vi.mock("./api", () => ({
  fetchProducts: vi.fn().mockResolvedValue([{ id: 1, name: "Keyboard" }]),
}));
```

빠르고 단순하지만 테스트가 "컴포넌트가 어떤 함수 모듈을 import하는가"에 결합한다. 서버 상태 라이브러리, fetch wrapper, 에러 처리 구조를 바꾸면 사용자 계약이 같아도 테스트가 깨진다.

MSW는 경계를 네트워크에 둔다.

```js
// test/server.js
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const server = setupServer(
  http.get("/api/products", () => {
    return HttpResponse.json([{ id: 1, name: "Keyboard" }]);
  }),
);
```

```jsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { ProductList } from "./ProductList.jsx";

function renderWithClient(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

test("상품 목록을 서버 응답 기준으로 표시한다", async () => {
  renderWithClient(<ProductList />);

  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  expect(await screen.findByText("Keyboard")).toBeInTheDocument();
});
```

이 테스트는 fetch wrapper를 바꿔도 `/api/products` 요청 계약만 유지되면 통과한다. [5-8](../phase-5/08-server-state.md)의 서버 상태 캐시도 실제로 동작한다. 단점은 테스트 설정이 조금 무겁고, 네트워크 경계 밖의 순수 로직 단위 실패를 좁히기는 어렵다는 점이다.

경계 선택은 다음 질문으로 한다.

```text
이 테스트가 지키려는 계약은 무엇인가?
  함수 입력/출력인가 → 함수 단위 테스트
  컴포넌트와 hook의 결합인가 → 컴포넌트 통합 테스트
  HTTP 요청/응답 계약인가 → MSW 네트워크 mock
  실제 브라우저 라우팅/렌더링/스토리지인가 → E2E 또는 browser mode
```

### Vitest는 Vite 프로젝트의 변환 파이프라인을 재사용한다

Vitest는 Vite 기반 test runner다. 테스트 파일도 결국 모듈이다.

```text
test file
  → Vite/Vitest transform pipeline
  → ESM module graph
  → test runner가 test/expect 실행
```

Vite 프로젝트에서 Vitest가 자연스러운 이유는 다음이다.

- Vite config와 plugin을 읽어 JSX/TS/CSS/asset import를 같은 방식으로 처리한다.
- native ESM과 빠른 transformer를 전제로 한다.
- watch mode에서 변경된 모듈과 관련 테스트를 빠르게 다시 실행한다.
- Node, jsdom, happy-dom, edge-runtime 같은 환경을 선택할 수 있다.

하지만 환경은 실제 브라우저가 아니다. Vitest의 `jsdom`과 `happy-dom`은 Node 프로세스 안에서 DOM API를 흉내 낸다. 레이아웃, paint, 실제 CSS cascade, browser navigation, media query, focus 세부 동작은 실제 브라우저와 다를 수 있다. 따라서 다음 분리선이 필요하다.

| 검증 대상 | 적합한 도구 |
|---|---|
| 순수 함수, hook 계산, DOM 상호작용 대부분 | Vitest + jsdom/happy-dom + RTL |
| 접근성 role/name, form interaction | RTL + user-event |
| 실제 CSS 레이아웃, viewport, drag/drop, browser API 통합 | Playwright 같은 browser E2E |
| API 경계와 서버 상태 캐시 | MSW + Vitest/RTL |

`happy-dom`은 빠를 수 있지만 API 구현 범위가 jsdom보다 좁을 수 있다. 속도 때문에 바꾸기 전에 실패하는 테스트가 어떤 브라우저 API를 요구하는지 확인한다.

### 스냅샷 테스트는 구조 변화에 민감하다

스냅샷(snapshot)은 렌더 결과 전체를 저장해 다음 실행과 비교한다. 작은 pure output에는 유용할 수 있다.

```js
expect(formatInvoice(invoice)).toMatchInlineSnapshot(`
  "INV-2026-001: 12000 KRW"
`);
```

하지만 React DOM 전체 스냅샷은 자주 구현 상세에 묶인다. 클래스 이름, wrapper div, attribute 순서가 바뀌면 사용자 계약이 같아도 실패한다. 스냅샷은 "무엇이 바뀌었는지 사람이 읽을 수 있는 작은 출력"에 제한하는 것이 좋다. UI 계약은 role/name과 상호작용 assertion으로 드러내는 편이 리팩터링에 강하다.

## 실무 관점

### 테스트 전략의 기본 비율

| 테스트 종류 | 주로 검증하는 것 | 장점 | 경계 조건 |
|---|---|---|---|
| 단위 테스트 | 순수 함수, reducer, parser, 포매터 | 빠르고 원인 좁히기 쉽다 | UI 결합 버그를 놓친다 |
| 컴포넌트 통합 테스트 | 렌더 결과, 사용자 이벤트, 상태 전이 | 비용 대비 신뢰도가 높다 | 실제 브라우저 레이아웃은 못 본다 |
| 네트워크 mock 통합 테스트 | HTTP 계약, 서버 상태 캐시, 에러 상태 | 구현 mock 결합을 줄인다 | mock이 실제 API와 drift될 수 있다 |
| E2E 테스트 | 실제 브라우저, 라우팅, 배포 환경 | 가장 사용자에 가깝다 | 느리고 flaky 원인 진단이 어렵다 |

프론트엔드에서 "단위 테스트 80%" 같은 비율을 목표로 삼으면 잘게 찢긴 컴포넌트 내부를 mock하는 테스트가 늘기 쉽다. 기준은 수가 아니라 신뢰도다. 핵심 사용자 흐름은 통합 테스트로, 복잡한 계산은 단위 테스트로, 브라우저와 배포 설정이 걸린 흐름은 E2E로 보낸다.

### 구현 상세에 묶였다는 신호

| 신호 | 왜 위험한가 | 대체 |
|---|---|---|
| state 변수명을 테스트가 안다 | `useState` → `useReducer` 리팩터링에 깨진다 | 화면 텍스트, role, aria state |
| child component가 몇 번 호출됐는지 본다 | 컴포넌트 분리/합치기에 깨진다 | 사용자가 보는 결과 |
| CSS class로 요소를 찾는다 | styling 변경에 깨진다 | role/name, label, text |
| API wrapper 함수를 과하게 mock한다 | 네트워크/캐시/에러 흐름을 못 본다 | MSW로 HTTP 경계 mock |
| `waitFor` 안에 내부 구현 조건을 둔다 | 실제 사용자 상태와 어긋난다 | `findByRole`, `findByText` |

### Mock의 비용을 기록한다

mock은 테스트를 빠르게 하지만, 동시에 실제 시스템과 멀어진다. 특히 서버 응답 mock은 시간이 지나면 API와 drift된다. 방지책은 다음이다.

- MSW handler를 개발, Storybook, 테스트에서 공유해 mock의 단일 원본을 만든다.
- OpenAPI/GraphQL schema가 있다면 mock data를 schema에서 생성하거나 runtime validator와 함께 둔다.
- 에러, 지연, 빈 목록, 권한 없음 같은 실패 상태를 handler 변형으로 명시한다.
- 테스트가 요청이 "몇 번 호출됐는가"보다 사용자가 보는 결과를 assert하게 한다.

## 더 깊이

### user-event는 DOM event 한 번이 아니라 상호작용 시퀀스다

`fireEvent.click(button)`은 click event를 하나 dispatch한다. 실제 사용자의 클릭은 pointerdown, focus, pointerup, click 같은 여러 이벤트와 default action의 조합이다. `@testing-library/user-event`는 이 시퀀스를 더 가깝게 흉내 낸다.

```jsx
const user = userEvent.setup();
await user.type(screen.getByLabelText("이메일"), "ada@example.com");
await user.click(screen.getByRole("button", { name: "가입" }));
```

그래서 user-event API는 대개 async다. React state update, input event, selection, clipboard 같은 작업이 비동기 관찰과 연결된다. 테스트가 `await`을 빠뜨리면 assertion이 상태 전이 전 실행되어 flaky해질 수 있다.

### jsdom의 한계는 성능 문제가 아니라 모델 문제다

jsdom은 DOM API 구현이지 브라우저 엔진이 아니다. layout box를 계산하지 않고, 실제 paint/composite도 없다. 따라서 다음 테스트는 jsdom에서 의미가 약하다.

```js
expect(element.getBoundingClientRect().width).toBeGreaterThan(0);
```

이 값은 실제 CSS layout 결과가 아닐 수 있다. 반응형 layout, sticky, overflow, intersection observer, drag/drop, 실제 focus 이동이 핵심이면 Playwright 같은 browser runner로 보낸다. 도구 선택은 "테스트가 어떤 엔진 계층을 요구하는가"로 판단한다.

### 커버리지는 신뢰도의 대리 지표일 뿐이다

커버리지 90%가 사용자 흐름 90%를 의미하지 않는다. 구현 상세 단위 테스트만 많아도 statement coverage는 오른다. 반대로 핵심 checkout flow 하나의 통합 테스트는 많은 내부 라인을 통과하지만, assertion이 약하면 결제 실패를 놓칠 수 있다.

커버리지는 다음 용도로 쓴다.

- 아예 실행되지 않는 위험 파일을 찾는다.
- 새로 만든 복잡한 순수 로직에 테스트가 없는지 확인한다.
- CI에서 급격한 하락을 감지한다.

커버리지를 목표로 코드를 짜기보다, 사용자 계약과 실패 모드를 먼저 쓰고 커버리지는 보조 지표로 본다.

## 정리

- 프론트엔드 테스트의 핵심 계약은 구현 상세이 아니라 사용자가 관찰하는 DOM, 접근성 트리, 상호작용 결과다.
- React Testing Library의 role 우선 쿼리는 접근성 트리를 테스트 계약으로 삼게 만든다. test-id와 class 선택은 마지막 수단이다.
- mock은 경계 선택이다. 함수 mock은 빠르지만 구현에 결합하고, MSW는 HTTP 경계에서 mock해 서버 상태와 캐시 흐름을 더 실제에 가깝게 검증한다.
- Vitest는 Vite 프로젝트의 변환 파이프라인과 설정을 재사용하지만, jsdom/happy-dom은 실제 브라우저가 아니다. layout·paint·실제 navigation은 browser test로 넘긴다.
- 테스트 피라미드 숫자보다 비용 대비 신뢰도가 중요하다. 복잡한 계산은 단위, UI 흐름은 통합, 배포/브라우저 계약은 E2E로 나눈다.

## 확인 문제

**Q1.** 버튼 컴포넌트 테스트가 `container.querySelector(".primary")`로 요소를 찾고 클릭한다. 디자인 리팩터링으로 class가 바뀌자 테스트가 깨졌지만 사용자는 아무 차이를 느끼지 않는다. 이 테스트의 문제와 수정 방향을 설명하라.

<details>
<summary>정답과 해설</summary>

class는 styling 구현 상세다. 테스트가 사용자 계약이 아니라 CSS 구조에 결합했기 때문에, 동작 변화가 없어도 깨졌다. 버튼이면 `screen.getByRole("button", { name: /저장/ })`처럼 접근성 role과 name으로 찾는다. 이 쿼리는 사용자가 버튼으로 인식할 수 있는지까지 함께 검증한다. class는 시각 표현의 내부 구현으로 남긴다.
</details>

**Q2.** 서버 상태 컴포넌트를 테스트하면서 `api.fetchProducts`를 모듈 mock했다. 이후 TanStack Query를 도입하고 fetch wrapper를 바꾸자 모든 테스트가 깨졌다. 사용자 화면은 같다. 어떤 경계가 잘못 선택되었고, MSW를 쓰면 무엇이 달라지는가?

<details>
<summary>정답과 해설</summary>

테스트가 HTTP 계약이 아니라 내부 함수 경계에 결합했다. fetch wrapper와 캐시 계층은 구현 상세인데, 모듈 mock은 그 상세를 테스트의 전제로 삼았다. MSW는 `/api/products` 요청/응답 경계에서 mock하므로 컴포넌트가 fetch를 직접 쓰든 Query를 쓰든, HTTP 계약과 화면 결과가 유지되면 테스트가 통과한다. 동시에 loading/error/cache 상태도 더 실제 흐름에 가깝게 검증할 수 있다.
</details>

**Q3.** `jsdom` 환경에서 tooltip 위치 계산 테스트가 계속 실패한다. 컴포넌트는 `getBoundingClientRect()`와 CSS transform을 사용한다. 어떤 계층의 테스트로 옮겨야 하며, jsdom에서 유지할 수 있는 테스트는 무엇인가?

<details>
<summary>정답과 해설</summary>

tooltip 위치는 실제 layout과 paint에 가까운 브라우저 엔진 계층을 요구한다. jsdom은 DOM API를 흉내 내지만 layout box와 transform 결과를 실제로 계산하지 않으므로 이 테스트의 모델과 맞지 않는다. 위치 계산과 viewport 상호작용은 Playwright 같은 실제 browser test로 옮긴다. jsdom에는 "hover/focus 시 tooltip DOM이 나타난다", "aria-describedby가 연결된다", "Escape로 닫힌다"처럼 접근성 트리와 이벤트 상태 전이 테스트를 남긴다.
</details>

## 참고 자료

- [Testing Library — About Queries](https://testing-library.com/docs/queries/about/) — `getByRole` 우선순위, query 종류, test-id가 마지막 선택지인 이유를 설명한다.
- [Vitest — Getting Started](https://vitest.dev/guide/) — Vitest가 Vite 기반 test framework이며 Vite config를 읽는 구조를 확인할 수 있다.
- [Vitest — Test Environment](https://vitest.dev/guide/environment.html) — `node`, `jsdom`, `happy-dom`, `edge-runtime` 환경의 차이와 한계를 확인할 수 있다.
- [MSW — Introduction](https://mswjs.io/docs/) — 브라우저와 Node에서 네트워크 요청을 가로채 API mocking layer를 만드는 모델을 설명한다.
- [접근성](../phase-1/07-accessibility.md) — role/name 쿼리가 기대는 접근성 트리 모델의 선행 설명이다.
