# C-3. JSX와 컴포넌트 — 지연된 props 읽기와 owner 경계를 보존한다

> 한 줄 요약: Solid component는 UI를 반복 계산하는 함수가 아니라 반응형 지점과 수명 경계를 설치하는 함수이며, props·Context·lifecycle·ref는 값을 언제 읽고 누가 정리하는지에 따라 동작한다.

> 집필 기준: `solid-js` 1.9.14. JSX compiler의 생성 코드 모양은 구현 세부이므로 개념적 구조만 다룬다.

## 학습 목표

- Solid JSX의 문법 규칙과 compile-time/runtime 책임을 구분할 수 있다.
- component 최초 실행과 JSX 내부 reactive expression의 재실행을 trace할 수 있다.
- props의 지연된 읽기를 보존하고 destructuring·spread·`mergeProps`·`splitProps`를 올바르게 선택할 수 있다.
- props 전달, Context, module state의 소유 범위와 테스트 비용을 비교할 수 있다.
- `onMount`·`onCleanup`·ref의 실행 시점을 이용해 외부 DOM resource를 누수 없이 연결할 수 있다.

## 배경: 왜 이것이 존재하는가

JSX를 공유한다는 사실 때문에 React component와 Solid component를 같은 것으로 보기 쉽다. 그러나 React의 JSX는 주로 다음 render의 element description을 만들고, Solid의 표준 JSX는 compiler가 실제 DOM과 reactive update 지점을 만들 재료가 된다.

이 차이는 component API 전체에 전파된다.

- component 함수가 반복 실행되지 않으므로 props를 조기에 읽으면 다음 실행에서 회복되지 않는다.
- Context는 매 render마다 새 value를 비교하는 broadcast 장치가 아니라 owner tree에서 값을 찾는 scope다.
- lifecycle은 mount/update/unmount 세 단계보다 owner 생성·재실행·dispose에 가깝다.
- ref callback은 실제 element를 직접 받으므로 DOM ownership과 cleanup 책임이 즉시 생긴다.

## 핵심 개념

### JSX 규칙은 HTML과 닮았지만 JavaScript expression이다

JSX는 JavaScript 문법 확장이다. 브라우저가 `.tsx`를 HTML parser로 읽는 것이 아니다. compiler가 JavaScript와 DOM operation으로 바꾼다.

```tsx
function Profile() {
  return (
    <section aria-labelledby="profile-title">
      <h2 id="profile-title">Profile</h2>
      <img src="/avatar.png" alt="" />
    </section>
  );
}
```

기본 규칙은 다음과 같다.

- component는 하나의 root expression을 반환한다. 여러 sibling에는 fragment `<>...</>`를 쓸 수 있다.
- 모든 element를 닫는다. HTML void element도 `<img />`처럼 적는다.
- JavaScript expression은 `{...}`에 넣는다.
- component 이름은 대문자로 시작한다. 소문자 이름은 native element로 해석된다.
- DOM 표준 이름을 따른다. `class`, `for`를 사용하며 React식 `className`, `htmlFor`에 기대지 않는다.
- 값이 없는 boolean attribute는 `true`로 해석되므로 의미를 확인한다.
- expression과 spread는 작성 순서가 실제 property 적용 순서에 영향을 줄 수 있다.

JSX가 XML처럼 보인다는 이유로 HTML semantics가 자동으로 보장되는 것은 아니다. button type, label association, focus order, ARIA name은 여전히 개발자 책임이다.

### static과 dynamic expression은 실행 위치가 다르다

```tsx
const [name, setName] = createSignal("Ada");

const node = (
  <p class="greeting" title={name()}>
    Hello {name()}
  </p>
);
```

`class="greeting"`은 static 값이므로 초기 DOM에 한 번 적용할 수 있다. `title={name()}`과 text의 `{name()}`은 각각 reactive update 지점이 된다. 같은 signal을 읽어도 서로 다른 DOM consumer가 별도 computation을 가질 수 있다.

compiler는 expression을 언제 함수로 감쌀지, property와 attribute 중 무엇을 쓸지, insertion을 어떻게 갱신할지 결정한다. 개발자는 compiler output에 의존하지 말고 다음 두 질문으로 읽는다.

1. 이 expression은 accessor를 늦게 읽는가?
2. 결과가 바뀌면 어떤 DOM 지점 또는 child branch가 바뀌는가?

### component는 한 번 실행되어 reactive system을 설치한다

```tsx
function Greeting(props: { name: string }) {
  console.count("Greeting component");

  createEffect(() => {
    console.count("Greeting effect");
    console.log(props.name);
  });

  return <p>Hello {props.name}</p>;
}
```

component가 생성되면 본문은 한 번 실행된다. `createEffect`는 reactive computation을 등록하고 JSX의 `props.name` 읽기는 DOM update 지점에 연결된다. parent가 dynamic prop을 제공해 값이 바뀌면 component를 다시 호출하지 않고 effect와 text expression이 각자 갱신된다.

component boundary의 주요 역할은 다음과 같다.

- setup logic과 JSX 구조를 캡슐화한다.
- child owner를 만들어 context와 cleanup의 scope를 정한다.
- props라는 명시적 input contract를 제공한다.
- reusable UI behavior의 이름과 TypeScript boundary를 만든다.

component를 잘게 나눈다고 자동으로 update가 더 세밀해지는 것은 아니다. update granularity는 signal을 읽은 expression이 결정한다. component 분리는 이해·소유·재사용 경계를 기준으로 판단한다.

### props는 read-only이며 지연된 property 접근이다

parent가 dynamic expression을 prop에 넣으면 compiler는 child가 읽을 때 최신 값을 얻도록 property access를 구성할 수 있다.

```tsx
function Parent() {
  const [name, setName] = createSignal("Ada");
  return <Child name={name()} rename={() => setName("Grace")} />;
}

function Child(props: { name: string; rename: () => void }) {
  return <button onClick={props.rename}>{props.name}</button>;
}
```

`props.name`을 JSX 안에서 읽으면 그 읽기는 reactive expression에 남는다. 반면 다음 destructuring은 component 최초 실행 때 property를 평가해 plain local value에 복사한다.

```tsx
function BrokenChild(props: { name: string }) {
  const { name } = props;
  return <p>{name}</p>; // 이후 prop 변경을 관찰하지 못할 수 있다.
}
```

단순한 대안은 property를 그대로 읽는 것이다.

```tsx
return <p>{props.name}</p>;
```

함수로 이름을 짧게 만들 수도 있다.

```tsx
const name = () => props.name;
return <p>{name()}</p>;
```

destructuring 문법이 필요한 library component라면 `splitProps`를 사용한다.

```tsx
import { splitProps, type JSX } from "solid-js";

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "neutral";
};

function Button(props: ButtonProps) {
  const [local, buttonProps] = splitProps(props, ["tone", "children"]);

  return (
    <button
      {...buttonProps}
      class={`button button--${local.tone ?? "neutral"}`}
    >
      {local.children}
    </button>
  );
}
```

`splitProps`가 반환하는 객체는 property의 반응성을 보존한다. 다만 spread와 명시 property의 순서가 override 정책이다. 위 예제에서 `class`를 spread 뒤에 두었으므로 caller의 class를 덮는다. library API라면 merge할지 override할지 명시해야 한다.

### default props에는 `mergeProps`를 쓴다

```tsx
import { mergeProps } from "solid-js";

type AvatarProps = {
  size?: number;
  alt?: string;
  src: string;
};

function Avatar(input: AvatarProps) {
  const props = mergeProps({ size: 40, alt: "" }, input);

  return (
    <img
      src={props.src}
      alt={props.alt}
      width={props.size}
      height={props.size}
    />
  );
}
```

`Object.assign`이나 object spread로 새 객체를 만들면 getter를 그 시점에 평가해 반응성을 잃을 수 있다. `mergeProps`는 reactive property access를 보존하는 merge 도구다.

### children은 이미 생성된 값이 아닐 수 있다

`props.children`은 getter이며 접근할 때 child를 resolve할 수 있다. 여러 번 접근하거나 배열로 정규화해야 하면 `children` helper를 사용한다.

```tsx
import { children, type ParentComponent } from "solid-js";

const Stack: ParentComponent = (props) => {
  const resolved = children(() => props.children);

  return <div class="stack">{resolved()}</div>;
};
```

`children` helper는 child resolution을 memoize하고 `toArray()` 같은 정규화 경로를 제공한다. 단순히 한 번 JSX에 삽입할 때는 `props.children`으로 충분하다. helper도 reactive node이므로 필요 없는 곳에 일괄 적용하지 않는다.

### TypeScript component type은 contract를 드러내는 정도로 쓴다

```tsx
import type {
  Component,
  FlowComponent,
  ParentComponent,
  VoidComponent,
} from "solid-js";

const Badge: Component<{ label: string }> = (props) => <span>{props.label}</span>;
const Panel: ParentComponent<{ title: string }> = (props) => (
  <section><h2>{props.title}</h2>{props.children}</section>
);
```

모든 component에 `Component<Props>`를 붙여야 하는 것은 아니다. 함수 parameter와 return inference가 더 명확한 경우 일반 함수로 두어도 된다. 중요한 것은 required/optional props, children 허용 여부, DOM attribute forwarding과 callback의 의미를 contract로 표현하는 것이다.

### props, Context, module state는 범위가 다르다

| 선택 | 소유 범위 | 장점 | 실패 모드 |
|---|---|---|---|
| props | 명시적 parent-child edge | data flow와 test input이 보인다 | 깊은 전달에서 중간 component가 오염된다 |
| Context | 특정 owner subtree | 중간 전달 없이 scope별 override 가능 | 숨은 dependency, provider 누락, 과도한 shared state |
| module state | module을 import한 모든 consumer | 가장 단순한 singleton 공유 | SSR request 간 공유, test 격리, 다중 app root 문제 |

Context는 prop drilling이 조금 있다는 이유만으로 도입하지 않는다. composition으로 중간 layer를 없앨 수 있는지 먼저 본다. theme, current user capability, form field registry처럼 subtree scope가 명확하고 많은 descendant가 쓰는 값에 적합하다.

```tsx
import {
  createContext,
  createSignal,
  useContext,
  type ParentComponent,
} from "solid-js";

type CounterContextValue = {
  count: () => number;
  increment: () => void;
};

const CounterContext = createContext<CounterContextValue>();

export const CounterProvider: ParentComponent = (props) => {
  const [count, setCount] = createSignal(0);
  const value: CounterContextValue = {
    count,
    increment: () => setCount((current) => current + 1),
  };

  return (
    <CounterContext.Provider value={value}>
      {props.children}
    </CounterContext.Provider>
  );
};

export function useCounter() {
  const value = useContext(CounterContext);
  if (!value) throw new Error("CounterProvider is missing");
  return value;
}
```

provider의 `value` object는 component가 한 번 실행되므로 React처럼 매 render identity가 바뀌는 문제로 접근하지 않는다. 그 안의 signal accessor가 fine-grained update를 제공한다. custom hook에서 provider 누락을 즉시 실패시키면 `undefined`가 깊은 곳까지 퍼지는 것을 막는다.

### lifecycle은 외부 resource의 수명 계약이다

`onMount`는 component가 initial DOM에 mount된 뒤 한 번 실행되는 non-tracking callback이다. `onCleanup`은 현재 owner가 dispose되거나 현재 computation이 refresh될 때 실행된다.

```tsx
import { onCleanup, onMount } from "solid-js";

function OnlineStatus() {
  const handleOnline = () => console.log("online");

  onMount(() => {
    window.addEventListener("online", handleOnline);
  });

  onCleanup(() => {
    window.removeEventListener("online", handleOnline);
  });

  return <span>Network observer installed</span>;
}
```

dependency가 바뀔 때 subscription을 교체해야 하면 `createEffect` 안에서 `onCleanup`을 등록한다. 단 한 번 DOM에 연결하는 작업이면 `onMount`가 의도를 더 잘 드러낸다. 외부 효과를 무조건 `onMount`로 미루지 않는다. ref callback에서 이미 element를 받을 수 있고 mount 이전 초기화가 허용되는 API라면 ref가 더 직접적이다.

### ref callback과 variable ref의 시점을 구분한다

```tsx
import { onCleanup, onMount } from "solid-js";

function Chart() {
  let host!: HTMLDivElement;
  let disposeChart: undefined | (() => void);

  onMount(() => {
    disposeChart = mountChart(host);
  });

  onCleanup(() => {
    disposeChart?.();
  });

  return <div ref={host} />;
}
```

variable ref는 JSX element가 만들어질 때 할당되므로 `onMount`에서 사용할 수 있다. definite assignment assertion은 type checker에게 lifecycle contract를 알릴 뿐 runtime check를 추가하지 않는다.

callback ref는 element를 직접 받는다.

```tsx
function FocusableInput() {
  return <input ref={(element) => element.focus()} />;
}
```

ref callback은 element가 생성된 뒤 호출되지만 반드시 document에 연결된 뒤라는 보장은 없다. layout measurement, focus, document-dependent library 초기화는 `onMount`가 안전하다. element 생성 직후 property 설정은 callback ref로 충분할 수 있다.

child가 raw DOM ref를 전달받게 하기보다 필요한 capability를 callback으로 노출하는 편이 결합이 작다.

```tsx
function TextField(props: { ref?: (element: HTMLInputElement) => void }) {
  return <input ref={props.ref} />;
}
```

공개 component에서 DOM node를 노출하면 element type과 내부 구조가 API contract가 된다. `focus()` 같은 목적 기반 handle로 좁힐 수 있는지 검토한다.

## 실무 관점

### props destructuring lint만으로는 충분하지 않다

문제는 문법 자체가 아니라 **read 시점**이다. 다음 항목도 같은 조기 평가 문제를 만든다.

```tsx
const name = props.name;
const options = { ...props };
const normalized = normalize(props.value);
```

값이 실제로 reactive해야 하는지 먼저 묻는다. 최초 configuration이면 snapshot이 맞을 수 있다. 계속 바뀌어야 한다면 accessor, memo, `splitProps`, `mergeProps`로 read를 늦춘다.

### Context에 setter 전체를 노출하지 않는다

store setter나 여러 signal setter를 그대로 제공하면 모든 descendant가 invariant를 우회할 수 있다. `increment`, `renameUser`, `submitOrder`처럼 domain command로 좁히면 update policy와 validation을 provider가 소유한다.

### ref는 declarative model의 탈출구다

ref가 적합한 사례는 focus, selection, ResizeObserver, canvas, media, 외부 widget처럼 DOM identity가 필요한 작업이다. text, class, visibility처럼 state에서 표현할 수 있는 값을 ref로 매번 직접 갱신하면 reactive graph와 DOM의 source of truth가 둘로 갈라진다.

### cleanup을 확인하는 방법

1. `<Show>`로 component를 mount/unmount할 수 있게 만든다.
2. listener, timer, observer, external instance 수를 counter로 기록한다.
3. branch를 열고 닫는 동작을 반복한다.
4. Chrome Memory panel에서 detached node와 listener가 남는지 확인한다.
5. cleanup이 여러 번 호출되어도 안전한지, 초기화 중 오류가 나도 부분 resource를 정리하는지 확인한다.

## 더 깊이: Context 탐색은 owner tree를 따른다

Context는 실제 DOM parent를 따라 찾지 않는다. component가 실행되는 owner chain에서 가장 가까운 provider 값을 찾는다. 이 때문에 Portal로 DOM 위치를 바꿔도 component hierarchy의 Context를 유지할 수 있다. 반대로 owner가 없는 async callback에서 component나 computation을 만들면 기대한 Context와 cleanup scope를 잃을 수 있다.

owner와 dependency tracking은 별개의 축이다. `untrack`으로 signal 구독을 막아도 현재 owner는 유지된다. 자세한 owner 복원과 async 경계는 [C-4](./04-reactive-runtime.md)에서 다룬다.

## 정리

- Solid JSX는 compiler가 정적 DOM과 동적 update 지점을 만들기 위한 JavaScript expression이다.
- component 함수는 일반적으로 한 번 실행되므로 reactive prop을 조기에 평가하면 다음 render가 복구해 주지 않는다.
- `mergeProps`와 `splitProps`는 reactive property access를 보존하며, spread 순서는 공개 override 정책이다.
- props는 명시적 edge, Context는 owner subtree scope, module state는 process/module singleton이라는 서로 다른 비용을 가진다.
- `onMount`, `onCleanup`, ref를 DOM 연결 시점과 resource 수명에 맞춰 선택해야 한다.

## 확인 문제

1. 다음 component의 `label`이 갱신되지 않는 이유를 설명하고 두 가지 수정 방법을 제시하라.

   ```tsx
   function Label(props: { value: string }) {
     const label = props.value.trim();
     return <span>{label}</span>;
   }
   ```

   <details>
   <summary>정답과 해설</summary>

   `props.value`를 component 최초 실행 때 읽고 `label`이라는 plain string으로 고정했다. 값싼 계산이면 `const label = () => props.value.trim()`으로 늦게 읽고 `{label()}`을 사용한다. 계산을 여러 consumer가 공유하거나 비싸다면 `createMemo(() => props.value.trim())`를 사용할 수 있다.

   </details>

2. 전역 module signal과 Context가 브라우저에서는 비슷하게 동작했다. SSR에서 module signal이 더 위험한 이유는 무엇인가?

   <details>
   <summary>정답과 해설</summary>

   module state는 server process의 여러 request가 공유할 수 있어 사용자별 데이터가 섞일 수 있다. Context는 request마다 생성되는 application owner subtree 안에 값을 둘 수 있다. 인증·개인화 state는 request scope에서 만들고 client로 전달할 범위를 명시해야 한다.

   </details>

3. 외부 chart library가 resize listener와 canvas resource를 만든다. ref callback만으로 초기화하고 cleanup하지 않은 구현의 실패 모드와 개선안을 설명하라.

   <details>
   <summary>정답과 해설</summary>

   branch가 사라져도 listener와 chart instance가 남아 detached DOM, 중복 handler, memory leak을 만든다. document 연결과 layout이 필요하면 `onMount`에서 initialize하고 반환된 disposer를 `onCleanup`에서 호출한다. ref callback에서 초기화해도 disposer를 owner에 등록해야 한다.

   </details>

4. reusable Button에서 `{...props}` 뒤에 `class="button"`을 적었다. caller의 class가 사라지는 현상을 bug라고 단정할 수 없는 이유는 무엇인가?

   <details>
   <summary>정답과 해설</summary>

   JSX property와 spread는 적용 순서가 override 정책을 만든다. 뒤의 명시 class가 caller 값을 덮는 것은 작성된 contract일 수 있다. 문제는 정책이 불명확한 것이다. `splitProps`로 local과 DOM props를 나누고 class를 merge할지, library class를 강제할지 API 문서와 테스트로 고정해야 한다.

   </details>

## 참고 자료

- [Solid 공식 문서 — Understanding JSX](https://docs.solidjs.com/concepts/understanding-jsx) — JSX의 기본 규칙과 static/dynamic property 처리 관점을 확인한다.
- [Solid 공식 문서 — Component basics](https://docs.solidjs.com/concepts/components/basics) — component 최초 실행과 reactive lifecycle의 공식 설명을 확인한다.
- [Solid 공식 문서 — Props](https://docs.solidjs.com/concepts/components/props) — destructuring 위험, `mergeProps`, `splitProps`, `children`의 사용 조건을 확인한다.
- [Solid 공식 문서 — Context](https://docs.solidjs.com/concepts/context) — Provider와 `useContext`, shared state의 범위를 확인한다.
- [Solid 공식 문서 — Refs](https://docs.solidjs.com/concepts/refs) — variable/callback ref와 element 생성 시점을 확인한다.
- [Solid 공식 API — `onMount`](https://docs.solidjs.com/reference/lifecycle/on-mount) / [`onCleanup`](https://docs.solidjs.com/reference/lifecycle/on-cleanup) — mount와 owner cleanup의 현재 계약을 확인한다.
