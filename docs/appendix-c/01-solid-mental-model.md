# C-1. Solid의 실행 모델 — 컴포넌트가 아니라 의존 지점을 갱신한다

> 한 줄 요약: Solid는 컴포넌트 함수를 반복 실행해 새 UI 서술을 비교하지 않고, 최초 실행에서 만든 반응형 그래프를 따라 실제로 의존하는 계산과 DOM 지점만 다시 실행한다.

> 집필 기준: 원본의 Solid v1.8 개념을 `solid-js` 1.9.14 및 2026-07-11 현재 공식 문서와 대조했다. 이 문서는 개발 환경 직접 구성과 Webpack 설정을 다루지 않는다.

## 학습 목표

- Solid가 상태와 UI의 동기화 문제를 어떤 실행 모델로 푸는지 설명할 수 있다.
- 컴포넌트 함수, 반응형 computation, 실제 DOM 갱신을 서로 다른 실행 단위로 구분할 수 있다.
- JSX 컴파일이 정적 DOM과 동적 표현식을 어떻게 분리하는지 개념적으로 추적할 수 있다.
- React의 컴포넌트 재실행 모델과 Solid의 세밀한 반응성 모델을 비용 축으로 비교할 수 있다.
- 브라우저 렌더링 비용과 JavaScript 반응성 비용을 혼동하지 않고 성능 병목을 관찰할 수 있다.

## 배경: 왜 이것이 존재하는가

웹 UI의 핵심 문제는 DOM 생성이 아니라 **시간에 따라 변하는 상태와 화면을 계속 일치시키는 일**이다. 장바구니 수량 하나가 바뀌면 합계, 재고 경고, 결제 버튼 상태가 함께 바뀌어야 한다. 직접 DOM을 조작하면 각 상태 변경 경로가 모든 표시 지점을 빠뜨리지 않고 갱신해야 한다. 선언형 UI 라이브러리는 상태에서 화면을 파생하게 만들어 이 전이 코드를 줄인다.

React는 컴포넌트 함수를 다시 실행해 새 UI 서술을 만들고 이전 서술과 비교한다. Solid도 선언형 JSX를 쓰지만 같은 비용 모델을 택하지 않는다. Solid는 최초 실행 때 상태를 읽는 지점과 그 상태에 의존하는 계산을 연결한다. 이후 상태가 바뀌면 컴포넌트 전체가 아니라 연결된 계산만 다시 실행한다.

두 모델은 모두 “상태에서 UI를 파생한다”는 문제를 풀지만 갱신 단위가 다르다.

| 판단 축 | React의 전형적 모델 | Solid의 전형적 모델 |
|---|---|---|
| 컴포넌트 함수 | 상태 갱신 시 다시 실행될 수 있다 | 생성 시 한 번 실행된다 |
| 동적 UI 계산 | 렌더 중 다시 계산하고 이전 요소 트리와 비교한다 | 신호를 읽은 작은 computation이 다시 실행된다 |
| DOM 반영 | reconciliation 뒤 commit에서 반영한다 | 의존 지점이 실제 DOM을 직접 갱신한다 |
| 최적화 질문 | 어떤 컴포넌트 재실행을 생략할까 | 어떤 읽기가 어떤 computation을 구독하는가 |
| 대표 실패 모드 | 불필요한 하위 렌더, stale closure | 추적 밖 조기 읽기, 소유권 없는 computation |

이 표는 우열표가 아니다. React는 렌더를 다시 실행할 수 있다는 전제에서 순수성, interruptible rendering, 요소를 값처럼 다루는 합성 모델을 얻는다. Solid는 갱신 지점을 작게 유지해 반복 서술과 비교 비용을 줄이지만, 값이 **언제 읽혔는지**와 reactive owner의 수명을 더 엄격히 이해해야 한다.

## 핵심 개념

### 세 층을 분리해서 본다

Solid 코드를 읽을 때 다음 세 층을 섞지 않는다.

1. 컴포넌트 함수: signal, context, lifecycle, JSX 구조를 한 번 설정한다.
2. 반응형 computation: signal을 읽고 의존성을 등록하며 값이 바뀔 때 다시 실행된다.
3. DOM 갱신 지점: text, attribute, class, list와 같은 구체적인 노드를 변경한다.

다음 예제에서 로그와 화면은 서로 다른 실행 규칙을 따른다.

```tsx
import { createSignal } from "solid-js";

export function Counter() {
  const [count, setCount] = createSignal(0);

  console.log("component", count());

  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Count: {count()}
    </button>
  );
}
```

버튼을 세 번 눌러도 `component 0`은 최초 한 번만 출력된다. 반면 `{count()}`가 만든 동적 표현식은 signal의 구독자가 되므로 텍스트는 `1`, `2`, `3`으로 바뀐다. 컴포넌트 본문의 `count()`는 값을 조기에 읽었을 뿐, 그 로그를 반복 실행할 computation 안에 있지 않다.

이 차이는 Solid 디버깅의 출발점이다. “상태가 바뀌었는데 컴포넌트가 왜 다시 실행되지 않지?”가 아니라 “이 읽기는 추적 scope 안에 있었나?”를 묻는다.

### 반응성은 값이 아니라 읽기 관계에 있다

signal은 단순한 상자가 아니다. accessor를 호출할 때 현재 실행 중인 computation이 있다면 둘 사이에 구독 관계가 생긴다.

```text
count signal ──읽음──> text computation ──쓰기──> button.textContent
     │
     └──읽음──> total memo ──읽음──> summary computation
```

setter가 새 값을 저장하면 signal은 구독자에게 알린다. 구독자는 다시 실행되면서 실제로 읽은 의존성을 새로 구성한다. 조건문 때문에 지난 실행과 이번 실행에서 읽는 signal이 달라질 수도 있다. 따라서 Solid의 의존성 그래프는 정적 import graph가 아니라 **실행 중의 읽기**로 만들어지는 동적 그래프다.

### JSX는 HTML 문자열도, 가상 DOM 요소 객체도 아니다

Solid의 표준 JSX 경로는 빌드 시점 변환을 전제로 한다. 컴파일러는 정적 구조를 재사용 가능한 DOM template로 끌어올리고, 동적 표현식에는 필요한 갱신 코드를 배치한다. 다음은 정확한 컴파일 출력이 아니라 구조를 보여 주는 의사 코드다.

```tsx
const view = <p class="counter">Count: {count()}</p>;
```

```ts
// 개념적 출력: 실제 compiler output과 식별자는 버전에 따라 달라질 수 있다.
const node = cloneTemplate('<p class="counter">Count: </p>');
const text = document.createTextNode("");
node.append(text);

createRenderComputation(() => {
  text.data = String(count());
});

return node;
```

정적 class와 element 구조는 상태가 바뀔 때 다시 만들 필요가 없다. 동적인 text만 signal을 구독한다. JSX를 쓰는 이유는 문법 편의만이 아니라 compiler가 정적 영역과 동적 영역을 구분할 정보를 얻기 위해서다.

컴파일 산출물은 공개 계약이 아니다. application code가 생성된 내부 helper 이름이나 DOM marker 모양에 의존하면 안 된다. 관찰 목적이라면 Playground의 compiled output과 production bundle을 비교하되, 설계 판단은 “정적 template + 반응형 갱신 지점”이라는 모델에 둔다.

### 세밀한 갱신은 브라우저 렌더링 비용을 없애지 않는다

Solid가 줄이는 것은 주로 JavaScript 쪽의 반복 계산과 중간 UI 서술 비교다. DOM 변경 뒤 브라우저가 수행하는 style recalculation, layout, paint, compositing은 그대로 존재한다.

```text
signal write
  → dependent computation
  → DOM property/text/class 변경
  → style recalculation
  → 필요하면 layout
  → paint
  → compositing
```

한 signal이 1,000개 행의 class를 실제로 바꾸면 computation이 세밀해도 브라우저는 1,000개의 DOM 변경을 처리한다. 큰 이미지를 매번 paint하거나 layout을 강제로 읽고 쓰는 코드는 UI 라이브러리의 갱신 전략만으로 해결되지 않는다. 성능을 주장하려면 다음을 분리해 측정해야 한다.

- JavaScript: computation 실행 횟수와 duration
- DOM: mutation 수와 node 생명주기
- Rendering: style/layout/paint 시간
- Network: code와 data의 전송량·waterfall

### 단방향 데이터 흐름과 세밀한 반응성은 별개다

Solid의 signal은 어디서나 setter를 전달할 수 있지만, 그 사실이 무제한 양방향 데이터 흐름을 권장한다는 뜻은 아니다. 상태 소유자가 setter 또는 명시적 command를 자식에 제공하고, 자식은 의도를 위로 전달하며, 화면은 accessor에서 파생하는 흐름이 추적하기 쉽다.

```tsx
type QuantityProps = {
  value: () => number;
  increment: () => void;
};

function Quantity(props: QuantityProps) {
  return (
    <button type="button" onClick={props.increment}>
      {props.value()}
    </button>
  );
}
```

여기서 accessor를 전달한 이유는 현재 값을 늦게 읽게 하기 위해서다. 숫자 `value()`를 부모 컴포넌트 본문에서 먼저 평가해 넘기면 전달 시점의 값만 고정될 수 있다. 자세한 props 규칙은 [C-3](./03-jsx-and-components.md)에서 다룬다.

### Solid core와 실행 환경의 경계를 구분한다

Solid core의 반응성은 DOM에 종속되지 않는다. signal, memo, effect는 브라우저 밖에서도 계산 그래프로 쓸 수 있다. DOM 렌더링은 `solid-js/web`이 맡고, SSR은 같은 component tree를 서버용 renderer로 실행한다. SolidStart는 routing, server function, deployment runtime을 결합한다.

```text
solid-js       signal, memo, effect, owner, control flow
solid-js/web   DOM render, hydrate, server rendering primitives
@solidjs/router URL matching, navigation, query/action integration
@solidjs/start file routes, server functions, request/response runtime
```

이 경계를 알아야 브라우저 전용 API를 서버에서 읽는 오류, request 사이에 module state가 공유될 것이라는 가정, client bundle에 비밀을 포함하는 사고를 피할 수 있다.

## 실무 관점

### React 습관이 만드는 세 가지 오류

첫째, 컴포넌트 본문을 “다음 상태에서 다시 실행될 렌더 함수”로 간주한다.

```tsx
const [user, setUser] = createSignal({ name: "Ada" });
const upperName = user().name.toUpperCase(); // 최초 값으로 고정
```

반응형 파생 값이 필요하면 함수나 memo로 늦게 읽는다.

```tsx
const upperName = () => user().name.toUpperCase();
```

둘째, 모든 계산을 memo로 감싼다. 값싼 계산을 한 곳에서만 읽는다면 일반 파생 함수가 더 단순할 수 있다. memo는 계산 결과를 여러 구독자가 공유하거나, 비교를 통해 하위 전파를 막을 가치가 있을 때 사용한다.

셋째, component boundary가 update boundary라고 가정한다. Solid에서 갱신 단위는 component가 아니라 signal을 읽은 expression이다. 성능 문제를 component tree 모양만으로 추론하지 말고 실제 dependency와 DOM mutation을 본다.

### compiler가 있다는 사실을 배포 전략에 포함한다

표준 JSX 경로는 compiler를 사용한다. Content Security Policy, 동적 template 생성, library 배포, 빌드 없는 embed 같은 환경에서는 이 전제가 문제가 될 수 있다. `solid-js/html`의 tagged template와 `solid-js/h`의 Hyperscript가 대안이지만 다음 비용이 있다.

- 표준 JSX 경로보다 성숙도와 생태계 사용량이 낮다.
- 반응형 표현식을 함수로 감싸야 하는 등 runtime 규칙이 늘어난다.
- 원본 범위 기준으로 SSR을 지원하지 않는 제약이 있다.
- compiler가 수행하던 정적 분석과 최적화를 잃는다.

대안이 있다는 사실과 대안의 비용을 함께 기록해야 한다. 이 비교는 [C-6](./06-async-ui-and-interactions.md)에서 다시 다룬다.

### 성능 검증 절차

1. 컴포넌트 본문, memo, effect, JSX 동적 표현식에 구분되는 counter를 둔다.
2. 하나의 signal만 갱신하고 어떤 counter가 증가하는지 기록한다.
3. Chrome DevTools Performance에서 scripting과 rendering 구간을 분리한다.
4. DOM breakpoint 또는 MutationObserver로 실제 변경 node 수를 확인한다.
5. production build에서도 같은 시나리오를 측정한다. 개발 도구와 로그 자체의 비용을 결과에서 분리한다.

세밀한 반응성의 장점은 “항상 빠르다”가 아니라, 상태 의존 관계가 작고 실제 DOM 변경도 작을 때 반복 계산과 중간 allocation을 줄일 수 있다는 조건부 주장이다.

## 더 깊이: 초기 실행이 그래프를 만든다

컴포넌트가 한 번 실행된다는 말은 정적이라는 뜻이 아니다. 최초 실행은 DOM과 반응형 graph를 **설치하는 단계**다. 조건부 branch가 생성되면 그 branch에는 별도 owner와 computation이 생기고, branch가 사라지면 함께 dispose된다. Context 탐색과 cleanup도 이 owner tree를 사용한다.

따라서 Solid의 component tree는 매 갱신마다 비교할 서술이 아니라 resource lifetime과 context scope를 만드는 구조에 더 가깝다. owner 모델은 [C-4](./04-reactive-runtime.md)에서 자세히 다룬다.

## 정리

- Solid는 상태에서 UI를 파생하지만 컴포넌트 전체 재실행과 요소 트리 비교를 기본 갱신 단위로 삼지 않는다.
- signal accessor를 tracking scope에서 읽을 때 dependency가 생기고, setter는 그 dependency를 따라 computation을 다시 실행한다.
- JSX compiler는 정적 DOM과 동적 갱신 지점을 분리한다. compiler output 자체는 공개 API가 아니다.
- 세밀한 반응성은 JavaScript 계산 비용을 줄일 수 있지만 layout·paint·network 비용까지 제거하지 않는다.
- Solid를 제대로 읽으려면 component, computation, DOM mutation, owner를 서로 다른 층으로 구분해야 한다.

## 확인 문제

1. 다음 코드에서 버튼을 눌러도 `message`가 바뀌지 않는 이유와 가장 단순한 수정은 무엇인가?

   ```tsx
   const [count, setCount] = createSignal(0);
   const message = `count=${count()}`;

   return <button onClick={() => setCount(count() + 1)}>{message}</button>;
   ```

   <details>
   <summary>정답과 해설</summary>

   `message`를 계산한 시점은 컴포넌트 최초 실행이며 그 계산을 다시 실행할 tracking scope가 없다. JSX에는 이미 완성된 문자열이 전달된다. `const message = () => \`count=${count()}\`;`로 바꾸고 `{message()}`에서 읽으면 compiler가 만든 동적 expression이 signal을 구독한다. 여러 구독자가 공유하는 비싼 계산이라면 `createMemo`를 검토하지만 이 경우 일반 함수면 충분하다.

   </details>

2. Solid로 바꾼 뒤 JavaScript 실행 시간은 크게 줄었지만 스크롤 중 frame drop은 그대로다. 어떤 계층을 추가로 조사해야 하는가?

   <details>
   <summary>정답과 해설</summary>

   DOM mutation 수, style recalculation, forced layout, paint 영역, composited layer와 이미지 decode를 조사한다. fine-grained update는 UI 서술 재계산 비용을 줄일 뿐, 대량 DOM 변경이나 비싼 layout/paint를 없애지 않는다. Performance 패널에서 scripting과 rendering을 분리하고 실제 변경 node 수를 함께 측정해야 한다.

   </details>

3. React 경험자가 “Solid component도 state가 변하면 다시 호출되므로 component body는 순수해야 한다”고 설명했다. 맞는 부분과 틀린 부분을 구분하라.

   <details>
   <summary>정답과 해설</summary>

   외부 효과를 임의로 component body에 두지 않고 lifecycle과 cleanup을 명시해야 한다는 결론은 일부 맞다. 그러나 근거가 틀렸다. Solid component 함수는 일반적으로 생성 시 한 번 실행되고, 이후에는 내부에서 설치된 reactive computation이 다시 실행된다. 따라서 주요 질문은 component 재호출보다 어떤 코드가 tracking scope에 들어갔고 어느 owner가 그 수명을 관리하는가이다.

   </details>

## 참고 자료

- [Solid 공식 문서 — Fine-grained reactivity](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity) — signal 읽기와 subscriber 사이에 dependency graph가 생기는 핵심 모델을 확인한다.
- [Solid 공식 문서 — Component basics](https://docs.solidjs.com/concepts/components/basics) — component 최초 실행과 이후 반응형 지점 갱신의 차이를 확인한다.
- [Solid 공식 문서 — Understanding JSX](https://docs.solidjs.com/concepts/understanding-jsx) — Solid JSX의 정적·동적 처리와 HTML과의 차이를 확인한다.
- [solid-js npm package](https://www.npmjs.com/package/solid-js) — 이 부록의 집필 시점 core 기준 버전과 공식 package 설명을 확인한다.
