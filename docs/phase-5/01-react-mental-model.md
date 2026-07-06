# 5-1. React 멘털 모델

> 한 줄 요약: 이 문서를 읽고 나면 "UI는 상태의 함수"라는 말을 JSX 컴파일 산출물과 렌더 재실행 수준에서 설명할 수 있고, 직접 DOM 조작 대비 React가 무엇을 사고 무엇을 지불하는지 판단할 수 있다.

이 문서는 React 19 기준이다.

## 학습 목표

- JSX가 컴파일되는 결과물(`jsx()` 호출)과 React 요소(플레인 객체)의 구조를 직접 확인하고 설명할 수 있다.
- 요소(element) ≠ 컴포넌트 인스턴스 ≠ DOM 노드의 3층 구분으로 React의 렌더링 대상을 구분할 수 있다.
- "렌더 = 컴포넌트 함수 재실행"이라는 규칙에서 컴포넌트가 순수해야 하는 이유를 유도할 수 있다.
- 직접 DOM 조작 대비 React가 제거하는 비용(전이 코드)과 새로 지불하는 비용(서술 생성 + diff)을 계산해, React가 적합하지 않은 경계 조건을 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

[3-7](../phase-3/07-dom-and-events.md)의 방식으로 UI를 만들면, 상태가 바뀔 때마다 "무엇을 어떻게 고칠지"를 직접 쓴다.

```js
// Phase 3 방식: 상태 전이마다 DOM 갱신 코드를 직접 작성한다
function addTodo(text) {
  todos.push({ text, done: false });
  const li = document.createElement('li');
  li.textContent = text;
  list.appendChild(li);          // 목록 갱신
  counter.textContent = `${todos.length}개`; // 카운터도 갱신
  emptyMessage.hidden = true;    // 빈 목록 안내도 갱신
}
```

문제는 규모다. 상태를 바꾸는 코드 경로가 M개이고 그 상태를 표시하는 DOM 지점이 N개면, 동기화 코드는 최악의 경우 M×N개 필요하다. `addTodo`는 카운터를 갱신했지만 `removeTodo`에서 빼먹으면, 상태와 화면이 어긋난 채로 동작한다. 이 버그는 컴파일러도 테스트도 잘 못 잡는다 — 코드가 틀린 게 아니라 **빠진** 것이기 때문이다.

역사적으로 이 문제의 해법은 두 갈래였다. 하나는 데이터 바인딩(AngularJS의 양방향 바인딩, Knockout의 observable)으로, 상태와 DOM 지점을 선언적으로 연결해 두면 프레임워크가 전파한다. 다른 하나가 React(2013)의 선택이다: 연결을 관리하는 대신, **상태가 바뀌면 UI 서술 전체를 다시 계산한다**. 서버 렌더링이 요청마다 HTML 전체를 다시 만드는 것과 같은 발상인데, 브라우저에서 매번 DOM을 갈아엎으면 [3-7](../phase-3/07-dom-and-events.md)에서 본 렌더링 비용을 감당할 수 없으므로, "전체를 다시 계산하되 실제 DOM에는 차이만 반영한다"는 절충을 넣었다.

백엔드 경험에 빗대면 SQL과 커서 루프의 관계다. 커서로 행을 하나씩 옮기는 코드는 "어떻게"를 쓰고, SQL은 "무엇을"만 선언하고 실행 계획은 옵티마이저에 맡긴다. React에서 JSX가 선언이고, 재조정(reconciliation)이 옵티마이저다. 그리고 SQL을 잘 쓰는 사람이 실행 계획을 읽을 줄 알듯, React를 잘 쓰려면 이 엔진의 비용 모델을 알아야 한다 — 그것이 Phase 5 전체의 주제다.

## 핵심 개념

### JSX는 함수 호출의 표기법이다

JSX는 React의 일부가 아니라 별도의 문법 확장이고, 브라우저는 이를 모른다. 빌드 도구(esbuild, Babel, tsc)가 자바스크립트로 변환한다. 다음을 esbuild로 컴파일해 보면:

```jsx
const el = <button className="primary">저장</button>;
```

```js
// esbuild --jsx=automatic 산출물 (React 17+의 automatic 런타임)
import { jsx } from "react/jsx-runtime";
const el = /* @__PURE__ */ jsx("button", { className: "primary", children: "저장" });
```

JSX 한 줄은 함수 호출 한 번이다. 중첩된 JSX는 중첩된 호출이고, `{count}` 같은 중괄호는 그냥 인자 위치의 표현식이다. 템플릿 언어(JSP, Thymeleaf, Jinja)와 결정적으로 다른 지점이 여기다 — 템플릿은 문자열을 만들지만, JSX는 **객체를 만든다**. 그래서 JSX에는 반복문·조건문 전용 문법이 없다. `arr.map(...)`, 삼항 연산자, `&&`가 그대로 쓰이는 이유는 JSX가 특별해서가 아니라 그냥 표현식이기 때문이다.

`className`처럼 HTML 속성명과 다른 이름을 쓰는 것도 같은 이유다. 이 객체의 키는 HTML 속성이 아니라 DOM 프로퍼티 쪽 관례를 따른다([3-7](../phase-3/07-dom-and-events.md)의 속성 vs 프로퍼티 구분이 여기서 반복된다).

### React 요소는 플레인 객체다

`jsx()`가 반환하는 것을 직접 열어 보면:

```jsx
const el = <button className="primary">저장</button>;

console.log(typeof el);
// 출력: object
console.log(JSON.stringify({ type: el.type, props: el.props, key: el.key }));
// 출력: {"type":"button","props":{"className":"primary","children":"저장"},"key":null}
console.log(Object.isFrozen(el.props));
// 출력: true
```

React 요소(element)는 `{ type, props, key }`를 가진 불변의 플레인 객체다. 클래스 인스턴스도, DOM 노드도 아니다. 화면에 아무 일도 일으키지 않는다 — **UI가 어떻게 생겨야 하는지의 서술(description)** 일 뿐이다. 만들다 버려도 비용은 객체 할당뿐이다.

`type`이 문자열(`"button"`)이면 호스트 요소(DOM 태그), 함수면 컴포넌트다. `<Button />`이 `jsx(Button, {...})`로 컴파일되는 것에서 알 수 있듯, 대문자 시작 규칙은 컨벤션이 아니라 컴파일 규칙이다 — 소문자면 문자열 리터럴로, 대문자면 스코프의 식별자로 변환된다.

여기서 3층 구분이 선다. Phase 5 전체에서 이 어휘를 쓴다.

| 층 | 정체 | 수명 |
|---|---|---|
| **요소(element)** | `{ type, props }` 플레인 객체. UI 서술 | 렌더 한 번. 매 렌더 새로 만들어지고 버려진다 |
| **인스턴스** | React가 내부에 유지하는 상태 단위(현 구현은 Fiber 노드). 훅 상태가 여기 산다 | 재조정이 "같은 것"으로 판정하는 동안([5-2](./02-rendering-and-reconciliation.md)) |
| **DOM 노드** | 실제 문서의 노드 | 커밋이 만들고 지우는 동안 |

개발자가 코드로 만드는 것은 요소뿐이다. 인스턴스와 DOM 노드는 React가 요소 서술을 보고 관리한다.

### 렌더는 함수 재실행이다

컴포넌트 함수는 "마운트 때 한 번 실행되고 이후 살아 있는" 객체가 아니다. **상태가 바뀔 때마다 처음부터 끝까지 다시 호출되는 함수**다. 직접 관찰하면:

```jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  console.log('render, count =', count); // 함수 본문 전체가 다시 실행된다
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
// 최초 렌더 출력: render, count = 0
// 클릭 후 출력:   render, count = 1
```

클릭할 때마다 `Counter` 함수 전체가 재실행되고, 지역 변수·이벤트 핸들러·JSX 요소가 전부 새로 만들어진다. 이 사실 하나에서 Phase 5의 많은 것이 유도된다.

- 렌더의 반환값은 "count가 1일 때 UI는 이렇게 생겼다"는 새 서술이다. React는 이전 서술과 비교(diff)해 달라진 부분(`textContent`만)을 DOM에 반영한다. 이 비교·반영 과정이 [5-2](./02-rendering-and-reconciliation.md)의 주제다.
- 각 렌더의 `count`는 그 실행의 지역 변수, 즉 [클로저](../phase-3/02-closures-and-functions.md)에 잡힌 스냅샷이다. "이벤트 핸들러가 옛 상태를 본다"는 React 3대 미스터리는 전부 이것의 귀결이다([5-3](./03-state-and-batching.md)).
- 지역 변수는 렌더마다 초기화되므로 렌더를 넘어 살아남는 값은 별도 장치(useState)가 필요하다 — `useState`가 값을 함수 밖 어딘가에 보관했다가 돌려준다는 뜻이고, 그 "어딘가"가 위 표의 인스턴스다.

"가상 DOM"이라는 통용어를 여기서 정리해 두자. 요소 트리를 가상 DOM이라 부르곤 하지만, 가상 DOM은 React의 목적이 아니라 **"전체를 다시 서술하고 차이만 반영한다"는 전략이 요구하는 자료구조**다. 비교하려면 이전 서술을 들고 있어야 하고, 그 보관물이 내부 트리다. "가상 DOM이라 빠르다"는 마케팅 문구는 인과가 뒤집혀 있다 — 직접 조작보다 항상 느리다(비교 작업이 추가되므로). 산 것은 속도가 아니라 선언형 모델이다.

### 컴포넌트는 순수해야 한다 — 규칙이 아니라 전제

렌더가 함수 재실행이라면, React는 그 함수를 **언제, 몇 번 호출할지에 대한 재량**을 갖는다. 실제로 React는 필요하면 렌더를 여러 번 수행하거나, 수행 결과를 버리고 다시 하거나(동시성 렌더링, [5-2](./02-rendering-and-reconciliation.md)), 미리 수행해 둘 수 있다. 이 재량이 성립하려면 렌더는 호출 횟수·시점과 무관하게 같은 입력 → 같은 서술을 내놓는 순수 계산이어야 한다.

즉 "컴포넌트를 순수하게 유지하라"는 스타일 가이드가 아니라, React가 렌더를 다루는 방식의 **전제 조건**이다. 렌더 중에 외부 변수를 변경하거나, 네트워크 요청을 보내거나, DOM을 직접 만지면, 그 부수 효과는 React의 재량만큼 예측 불가능한 횟수로 실행된다.

`StrictMode`는 이 전제를 개발 모드에서 검증하는 장치다. 컴포넌트 함수를 의도적으로 두 번 호출해, 이중 실행에서 결과가 달라지는(= 순수하지 않은) 코드를 드러낸다.

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')).render(
  <StrictMode><Counter /></StrictMode>
);
// 개발 모드 출력:
// render, count = 0
// render, count = 0   ← 의도적 이중 호출. 프로덕션 빌드에서는 한 번만 실행된다
```

렌더가 두 번 돌아도 화면과 상태가 같다면 순수한 것이고, 로그가 두 배로 찍히는 것 이상의 문제가 생긴다면 렌더에 부수 효과가 섞인 것이다. 부수 효과가 실제로 필요한 코드(구독, 타이머, 네트워크)는 렌더 밖의 지정석 — 이벤트 핸들러 또는 이펙트([5-4](./04-effects.md)) — 로 옮긴다.

### 비용의 정직한 계산

React가 파는 것과 받는 값을 정리하면:

**산다** — 상태 전이 코드의 삭제. "지금 상태가 X면 UI는 Y"만 서술하면, 어떤 경로로 X가 되었든 화면은 Y다. M×N 동기화 코드가 사라지고, 상태-화면 불일치 버그가 구조적으로 불가능해진다.

**지불한다** — 상태가 바뀔 때마다: ① 컴포넌트 함수 재실행(서술 생성), ② 이전 서술과의 비교(diff), ③ 차이의 DOM 반영. ①②는 직접 조작에는 없던 비용이고, ③은 직접 조작이라면 손으로 정확히 짚었을 지점을 기계적으로 찾아낸 결과다. 여기에 라이브러리 자체의 번들 크기(react + react-dom, gzip 후 수십 KB)가 초기 로딩에 얹힌다.

이 거래가 남는 장사인 조건은 **상태 전이의 조합이 많고 UI가 상태의 함수로 잘 서술되는 경우**다. 반대로 다음 경계에서는 거래가 뒤집힌다.

- 전이가 한두 개뿐인 정적 페이지: 지불(번들, 런타임)은 그대로인데 사는 것(전이 코드 삭제)이 거의 없다.
- 프레임 단위 갱신(캔버스 애니메이션, 드래그 추적, 차트 실시간 스트리밍): 16ms마다 서술 생성 + diff를 도는 것은 낭비이고, 이런 코드는 React 안에서도 ref로 DOM을 직접 만진다([5-5](./05-performance-model.md)).
- DOM을 자기 방식으로 소유하려는 외부 라이브러리(지도, 에디터): React의 "DOM은 내 서술의 산출물"이라는 전제와 충돌하므로, 경계를 지정해 격리해야 한다.

## 실무 관점

### "React가 DOM 조작을 없애 준다"는 오해

React가 없애는 것은 DOM 조작이 아니라 **전이 코드**다. DOM 조작은 커밋 단계에서 React가 대신 수행할 뿐 사라지지 않으며, 오히려 diff 비용이 추가된다. 이 구분이 실무에서 중요한 이유: "React를 쓰면 빠르다"는 전제로 성능 문제를 프레임워크에 맡기는 팀은, 넓은 리렌더 전파([5-5](./05-performance-model.md))라는 React 고유의 성능 문제를 만난다. 성능은 산 것이 아니라 관리 대상으로 바뀐 것이다.

### 렌더 중 부수 효과 — 가장 흔한 위반 패턴

```jsx
// ❌ 렌더 중 부수 효과: StrictMode에서 두 번, 동시성 렌더에서 예측 불가 횟수로 실행된다
function SearchResults({ query }) {
  fetch(`/api/search?q=${query}`).then(/* ... */); // 렌더마다 요청 발사
  logPageView(query);                               // 분석 이벤트 중복 집계
  return <ul>{/* ... */}</ul>;
}

// ✅ 부수 효과는 지정석으로: 사용자 행동에 속하면 핸들러, 표시 자체와의 동기화면 이펙트
function SearchResults({ query }) {
  useEffect(() => {
    logPageView(query); // 커밋 후 1회 (이펙트의 정확한 의미론은 5-4)
  }, [query]);
  return <ul>{/* ... */}</ul>;
}
```

위반의 미묘한 형태는 렌더 중 객체 변경이다. props로 받은 배열에 `sort()`를 호출하는 코드(원본 변형)는 첫 렌더에서는 티가 안 나지만, 같은 배열을 보는 다른 컴포넌트와 화면이 어긋나는 시점에 터진다. `toSorted()` 같은 비변형 API나 복사 후 정렬이 기본값이다.

### 선택 판단: 직접 조작 vs React

| 상황 | 판단 | 근거 |
|---|---|---|
| 상태 전이가 많은 대화형 앱(폼, 목록, 대시보드) | React | 전이 코드 삭제의 이득이 diff 비용을 압도 |
| 콘텐츠 중심 정적 페이지 + 소량의 인터랙션 | 직접 조작(또는 서버 렌더 + 소량 JS) | 번들·런타임 지불 대비 사는 것이 없음 |
| 프레임 단위 갱신(캔버스, 드래그, 실시간 차트) | React 골격 + 해당 부분만 ref 직접 조작 | 서술-비교 루프가 프레임 예산(16ms)을 잠식 |
| DOM을 소유하는 외부 라이브러리 통합 | React + 격리 경계(ref로 컨테이너만 넘김) | 두 소유권 모델의 충돌을 경계에서 차단 |

중간 지대도 있다. 서술-비교를 빌드 타임으로 옮기는 접근(Svelte)이나 세밀한 반응성(SolidJS의 signal)은 같은 선언형 모델을 다른 비용 구조로 판다. 이 문서 범위 밖이지만, "React의 비용 구조는 여러 선택지 중 하나"라는 사실은 알아 둘 가치가 있다.

## 더 깊이

### automatic 런타임 이전 — `React.createElement`

React 17 이전의 JSX는 `React.createElement("button", { className: "primary" }, "저장")`으로 컴파일되었다. 모든 JSX 파일에 `import React`가 필요했던 이유가 이것이다(변환 산출물이 `React` 식별자를 참조하므로). automatic 런타임은 `react/jsx-runtime`에서 `jsx`를 자동 import해 이 요구를 없앴고, `children`을 가변 인자가 아니라 props에 넣는 형태로 시그니처도 정리했다. 옛 코드베이스에서 상단의 `import React from 'react'`만 남아 있는 것을 보면 이 역사의 흔적이다.

### 요소의 내부 표식 — `$$typeof`

```jsx
console.log(String((<div />).$$typeof));
// 출력: Symbol(react.transitional.element)
```

React 요소에는 Symbol 표식이 붙어 있다. 이는 보안 장치다: 서버가 사용자 입력(JSON)을 그대로 children으로 흘리는 경우, JSON에는 Symbol이 존재할 수 없으므로 `{ type: "script", ... }` 모양을 흉내 낸 악성 데이터가 요소로 취급되는 것을 막는다. Symbol 이름이 `react.element`에서 `react.transitional.element`로 바뀐 것(React 19)에서 보듯 이 값은 구현 세부이며, 코드가 여기 의존해서는 안 된다.

### "전체 재계산"의 이론적 배경

React의 모델은 함수형 프로그래밍의 오래된 아이디어 — 시간에 따라 변하는 UI를 `state → view` 순수 함수의 반복 적용으로 보는 것 — 의 실용화다. 순수 함수라면 메모이제이션이 성립하고(입력이 같으면 재계산 생략 — [5-5](./05-performance-model.md)의 memo), 실행 시점·횟수의 재량이 생기고(동시성 렌더링), 서버에서도 같은 함수를 실행할 수 있다(SSR — 7-5에서 다룬다). Phase 5 후반과 Phase 7의 기능들이 전부 "렌더는 순수 계산"이라는 한 전제의 배당금이다.

## 정리

- JSX는 `jsx(type, props)` 호출로 컴파일되는 표기법이고, 그 반환값인 React 요소는 `{ type, props, key }` 플레인 객체 — 화면이 아니라 화면의 서술이다.
- 요소(매 렌더 새로 생성) / 인스턴스(상태 보관, React 내부) / DOM 노드(커밋 산출물)의 3층을 구분한다. 개발자가 만드는 것은 요소뿐이다.
- 렌더는 컴포넌트 함수의 재실행이다. React는 새 서술과 이전 서술을 비교해 차이만 DOM에 반영하며, 가상 DOM은 이 전략의 자료구조이지 속도의 비결이 아니다.
- 렌더는 React가 호출 시점·횟수의 재량을 갖는 순수 계산이어야 한다. StrictMode의 이중 호출은 이 전제의 검증 장치이고, 부수 효과의 지정석은 핸들러와 이펙트다.
- React는 전이 코드 삭제를 팔고 서술 생성 + diff 비용을 받는다. 전이가 적은 정적 페이지, 프레임 단위 갱신, DOM을 소유하는 외부 라이브러리가 이 거래가 뒤집히는 경계다.

## 확인 문제

**Q1.** 동료가 "React는 가상 DOM을 쓰기 때문에 직접 DOM 조작보다 빠르다"고 말한다. 이 주장의 어디가 틀렸고, React가 실제로 제공하는 가치는 무엇인가?

<details>
<summary>정답과 해설</summary>

틀린 지점: 같은 DOM 변경을 기준으로 비교하면 React는 직접 조작보다 항상 느리다. 직접 조작이 `el.textContent = x` 한 줄로 끝낼 일을, React는 컴포넌트 함수 재실행(서술 생성) + 이전 서술과의 비교(diff)를 거친 뒤에야 같은 DOM 변경에 도달한다. 가상 DOM은 속도 최적화가 아니라 "전체를 다시 서술하고 차이만 반영한다"는 전략이 요구하는 보관용 자료구조다.

실제 가치: 상태 전이 코드의 삭제다. 상태를 바꾸는 경로가 M개, 표시 지점이 N개일 때 필요한 M×N 동기화 코드가 "상태 → UI" 서술 하나로 대체되고, 갱신 누락으로 인한 상태-화면 불일치가 구조적으로 불가능해진다. 비교 대상은 "손으로 정확히 짚은 최적 코드"가 아니라 "사람이 M×N 동기화를 유지보수하는 비용"이어야 공정하다.
</details>

**Q2.** 다음 컴포넌트는 개발 모드(StrictMode)에서 분석 이벤트가 두 번씩 집계된다. 원인을 렌더링 모델로 설명하고, 두 가지 다른 상황(사용자가 버튼을 눌러 열었을 때 / 화면에 표시되는 것 자체를 집계할 때)에 맞는 수정을 각각 제시하라.

```jsx
function Modal({ id, onClose }) {
  trackEvent('modal_open', { id }); // 분석 이벤트
  return <dialog open>{/* ... */}</dialog>;
}
```

<details>
<summary>정답과 해설</summary>

원인: `trackEvent`가 렌더 중에 실행되는 부수 효과이기 때문이다. 렌더는 React가 호출 횟수의 재량을 갖는 순수 계산이어야 하고, StrictMode는 그 전제를 검증하려고 컴포넌트 함수를 의도적으로 두 번 호출한다. 이중 집계는 StrictMode의 버그가 아니라 "이 코드는 렌더 횟수에 의존한다"는 위반의 검출이다.

수정: ① 모달 열기가 사용자 행동의 결과라면, 집계는 그 행동에 속한다 — 모달을 여는 쪽의 이벤트 핸들러에서 `trackEvent`를 호출한다(부모의 `onClick` 안). ② "화면에 표시됨" 자체를 집계해야 한다면(어떤 경로로 열렸든), 표시와의 동기화이므로 이펙트로 옮긴다: `useEffect(() => { trackEvent('modal_open', { id }); }, [id])`. 커밋 후 실행되므로 렌더 횟수의 재량과 분리된다(정확한 의미론은 5-4).
</details>

**Q3.** `const el = <UserCard user={user} />;`를 실행한 시점에 네트워크 요청, DOM 생성, `UserCard` 함수 호출 중 무엇이 일어나는가? 그리고 이 성질 덕분에 가능한 패턴을 하나 들어 보라.

<details>
<summary>정답과 해설</summary>

아무것도 일어나지 않는다 — `UserCard` 함수조차 호출되지 않는다. 이 줄은 `jsx(UserCard, { user })`로 컴파일되고, 반환값은 `{ type: UserCard, props: { user } }` 플레인 객체다. `type`에 함수가 참조로 담길 뿐 호출은 React가 이 요소를 실제로 렌더할 때, 즉 트리에 포함되어 재조정이 도달했을 때 일어난다.

가능해지는 패턴: 요소를 값으로 다루는 모든 것. 조건에 따라 요소를 변수에 담아 두고 하나만 반환하기, 요소를 props로 전달하기(`<Layout sidebar={<Nav />} />` — 렌더되지 않으면 `Nav`는 호출되지 않는다), 배열에 모아 두기. 요소 생성이 저렴하고 부수 효과가 없으므로 "만들어 두고 안 쓰기"가 공짜다. 이 성질은 5-2의 children 전파 차단, 5-7의 라우트 테이블(모든 라우트의 요소를 미리 서술)에서 반복 등장한다.
</details>

## 참고 자료

- [react.dev — Describing the UI](https://react.dev/learn/describing-the-ui) — 요소·컴포넌트·순수성의 공식 서술. 이 문서의 1차 자료.
- [react.dev — Keeping Components Pure](https://react.dev/learn/keeping-components-pure) — 순수성 규칙과 StrictMode 이중 호출의 공식 설명.
- [react.dev — Writing Markup with JSX](https://react.dev/learn/writing-markup-with-jsx) / [Introducing the New JSX Transform](https://legacy.reactjs.org/blog/2020/09/22/introducing-the-new-jsx-transform.html) — JSX 문법 규칙과 automatic 런타임 도입 배경.
- [overreacted.io — React as a UI Runtime](https://overreacted.io/react-as-a-ui-runtime/) — React 코어 팀(Dan Abramov)이 쓴 런타임 관점의 모델 정리. 요소/인스턴스 구분의 심화.
