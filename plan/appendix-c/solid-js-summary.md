# SolidJS 가이드 챕터별 핵심 요약

> 분석 대상: `.raw/solid-js.md`의 Chapter 1~35와 Appendix 1. 원문은 Solid v1.8을 기준으로 하므로, 실제 교육 과정에 반영할 때는 특히 Solid Router와 SolidStart의 버전 민감 API를 최신 공식 문서와 다시 대조해야 한다.

각 챕터는 교육 과정 검토에 필요한 세 가지 관점으로 정리한다.

- **학습 초점**: 해당 챕터를 통해 이해해야 할 중심 질문
- **핵심 내용**: 원문에서 다루는 주요 개념과 API
- **교육 과정 연결**: 선수 지식과 다음 학습 단계에서의 역할

## 1. 입문과 기본 관점

### Chapter 1. Introduction

- **학습 초점**: Solid의 성격과 책의 학습 범위, 학습에 필요한 사전 조건을 파악한다.
- **핵심 내용**: Solid는 클라이언트와 서버에서 사용할 수 있는 작고 효율적인 UI 라이브러리이며, 책은 내부 반응성 원리와 API를 함께 설명한다. JavaScript·HTML·CSS 기초와 Node.js 환경을 전제로 하고, 온라인 Playground와 공식 템플릿을 시작 방법으로 소개한다.
- **교육 과정 연결**: React와 JSX 외에는 실행 모델이 크게 다르다는 경고를 통해 기존 React식 추론을 내려놓고 Solid 고유의 모델을 배울 준비를 시킨다.

### Chapter 3. On SolidJS

- **학습 초점**: Solid가 상태와 UI의 동기화 문제를 어떤 반응성 모델로 해결하는지 큰 그림을 잡는다.
- **핵심 내용**: 브라우저의 DOM·CSSOM·레이아웃·페인팅 파이프라인을 배경으로, 상태에서 UI를 파생하는 선언형 모델과 세밀한 반응성, 합성 가능한 컴포넌트를 소개한다. 컴파일된 코드, 단방향 데이터 흐름, 스트리밍 SSR과 대체 렌더링 방식도 Solid의 장점으로 제시한다.
- **교육 과정 연결**: 뒤의 signals·computations·memos를 하나의 실행 모델로 묶어 주는 개관이다. 세부 API보다 “무엇이 다시 실행되고 무엇이 실제 DOM을 갱신하는가”라는 질문을 먼저 세운다.

## 2. 반응성 핵심 모델

### Chapter 4. How Solid's Reactive System Works

- **학습 초점**: Solid의 세밀한 반응성이 내부에서 의존성을 수집하고 갱신을 전파하는 방식을 이해한다.
- **핵심 내용**: Observer 패턴을 출발점으로 signals, computations, memos로 이루어진 간단한 reactive core를 직접 구현한다. 현재 실행 중인 computation, signal의 구독자 집합, 자동 의존성 추적과 파생 값의 전파 과정을 설명한다.
- **교육 과정 연결**: 이후 반응성 관련 동작을 암기 대신 추론하게 만드는 가장 중요한 기반 챕터다. effects, context, lifecycle, owners를 배우기 전에 충분히 이해해야 한다.

### Chapter 5. Tracking State With Signals

- **학습 초점**: `createSignal`로 상태를 읽고 갱신하며, 갱신 여부와 반응성 경계를 정확히 제어한다.
- **핵심 내용**: accessor와 setter, 기본 `===` 비교와 `equals` 재정의, 함수형 갱신, signal로부터 값 파생하기, 반환 tuple의 구조 분해, `batch`를 다룬다. 같은 객체 참조를 변이한 뒤 다시 설정하면 기본적으로 갱신되지 않는다는 점을 강조한다.
- **교육 과정 연결**: Chapter 4의 구독 모델을 실제 상태 API에 적용한다. accessor를 호출해야 값 읽기와 의존성 추적이 일어난다는 사실이 이후 모든 예제의 전제가 된다.

### Chapter 6. Running Side-Effects with Effects

- **학습 초점**: 반응형 값의 변화에 맞춰 외부 효과를 실행하되 의존성과 자원 수명을 통제한다.
- **핵심 내용**: `createEffect`의 자동 의존성 추적, 이전 실행 값, 중첩 effect, `on`을 통한 명시적 추적, `untrack`을 통한 추적 제외를 설명한다. 외부 이벤트·구독 같은 자원은 cleanup과 함께 다뤄야 한다.
- **교육 과정 연결**: signal로 표현한 상태와 외부 시스템의 동기화 경계를 세운다. 파생 값 계산을 effect로 처리하지 않고 memo와 구분하는 기준이 필요하다.

### Chapter 7. Caching Values with Memos

- **학습 초점**: 다른 반응형 값에서 파생되는 계산 결과를 캐시하고 필요한 경우에만 하위 구독자에게 전파한다.
- **핵심 내용**: `createMemo`는 내부 computation과 read-only signal을 결합해 의존성이 바뀔 때 계산하고, 결과가 달라질 때 구독자에게 알린다. 초기값, 이전 값, `equals` 비교 옵션과 일반 함수 기반 파생 값과의 차이를 다룬다.
- **교육 과정 연결**: 상태(signal), 부수 효과(effect), 캐시된 파생 값(memo)의 역할을 분리하는 마지막 기초 단계다. 성능 최적화 수단이기 전에 반응형 그래프의 중복 계산과 전파를 제어하는 도구로 이해해야 한다.

## 3. JSX와 컴포넌트 기초

### Chapter 8. Rules of JSX

- **학습 초점**: Solid 컴포넌트의 뷰를 기술하는 JSX의 기본 문법과 HTML과의 차이를 익힌다.
- **핵심 내용**: 요소 닫기와 중첩, JavaScript 표현식 삽입, 속성, 값 없는 boolean 속성, 주석, 공백 정리 규칙을 설명한다. 사용자 정의 컴포넌트와 render props 같은 합성 가능성도 소개한다.
- **교육 과정 연결**: 컴포넌트와 제어 흐름을 배우기 위한 문법 전제다. JSX가 HTML 문자열이 아니라 컴파일 대상 표현식이라는 관점을 Chapter 3의 컴파일 모델과 연결한다.

### Chapter 9. Composing User Interfaces

- **학습 초점**: Solid 컴포넌트의 실행 방식과 props의 반응성이 UI 합성에 어떤 영향을 주는지 이해한다.
- **핵심 내용**: 컴포넌트의 반환 계약, 단일 루트, props와 children, TypeScript 컴포넌트 타입, 조건부 렌더링을 다룬다. 컴포넌트 함수는 일반적으로 한 번 실행되고 반응형 표현식만 다시 평가되며, props는 읽기 전용이고 구조 분해하면 반응성과 평가 순서를 깨뜨릴 수 있음을 설명한다.
- **교육 과정 연결**: React의 함수 컴포넌트 재렌더 모델과 Solid의 세밀한 갱신 모델을 구분하는 핵심 챕터다. 이후 props·context·lifecycle을 이해하는 기준이 된다.

### Chapter 10. Working With Props

- **학습 초점**: 컴포넌트 사이에서 데이터와 행동을 명시적으로 전달하면서 반응성을 보존한다.
- **핵심 내용**: 부모에서 자식으로 값 전달, 상태 끌어올리기, accessor·setter 또는 callback을 이용한 제어된 공유와 자식에서 부모로의 이벤트 전달을 설명한다. props 구조 분해와 spread, 여러 props의 forwarding, spread 순서에 따른 우선순위, TypeScript 기반 검증을 다룬다.
- **교육 과정 연결**: 기본 컴포넌트 합성을 실제 데이터 흐름으로 확장한다. 깊은 트리에서 전달 비용이 커질 때 Chapter 11의 Context가 필요한 이유를 준비한다.

### Chapter 11. Sharing Data Through the Context API

- **학습 초점**: 중간 컴포넌트를 거치지 않고 하위 트리에 값을 제공하되 데이터의 소유 범위를 명확히 한다.
- **핵심 내용**: `createContext`, `Provider`, `useContext`와 기본값, 중첩 provider의 동작을 설명한다. Context 값이 computation의 owner 계층을 따라 저장되고 탐색되는 내부 원리와 custom context hook 같은 사용 패턴도 다룬다.
- **교육 과정 연결**: props 전달과 전역 상태 사이의 범위 기반 공유 수단이다. Chapter 4의 computation과 Chapter 16의 owner 모델을 컴포넌트 트리에 연결한다.

### Chapter 12. Component Lifecycle

- **학습 초점**: 컴포넌트가 생성되고 폐기되는 시점에 외부 자원을 안전하게 할당하고 해제한다.
- **핵심 내용**: `onMount`로 초기 설정을 수행하고 `onCleanup`으로 이벤트 리스너, timer, 구독 같은 자원을 정리한다. cleanup이 컴포넌트 폐기뿐 아니라 소유 computation의 재실행과도 관계있음을 보여 준다.
- **교육 과정 연결**: effect를 외부 자원과 결합할 때 발생하는 누수 문제를 다룬다. refs·외부 라이브러리 연동과 owner 수명주기의 선수 지식이다.

### Chapter 13. Accessing DOM Nodes With `ref`

- **학습 초점**: 선언형 UI만으로 처리하기 어려운 경우 실제 DOM 노드에 안전하게 접근한다.
- **핵심 내용**: callback ref와 변수 ref, ref 함수의 실행 시점, props를 통한 ref forwarding을 설명한다. 외부 라이브러리 초기화에는 mount 시점과 cleanup을 함께 사용하고, 가능한 경우 선언형 접근을 우선하는 기준을 제시한다.
- **교육 과정 연결**: JSX와 브라우저의 명령형 DOM API 사이의 경계다. lifecycle과 함께 가르쳐 자원 해제 없는 DOM 연동을 피하게 한다.

## 4. 반응성 런타임 확장

### Chapter 14. Working with Computations

- **학습 초점**: 목적과 실행 시점이 다른 computation primitive를 구분하고 적절한 도구를 선택한다.
- **핵심 내용**: 즉시 실행되는 `createComputed`, 렌더링에 쓰이는 `createRenderEffect`, DOM 삽입 뒤 실행되는 `createEffect`, 캐시를 만드는 `createMemo`, 스케줄러에 작업을 미루는 `createDeferred`, 추적과 반응을 분리하는 `createReaction`을 비교한다.
- **교육 과정 연결**: Chapter 4·6·7을 런타임 스케줄링 관점에서 심화한다. 일반 애플리케이션에서 자주 쓰는 API와 라이브러리·저수준 최적화용 API의 경계를 분명히 해야 한다.

### Chapter 15. Handling Errors

- **학습 초점**: 반응형 그래프 일부에서 발생한 실패를 격리하고 복구 가능한 UI로 전환한다.
- **핵심 내용**: `ErrorBoundary`의 fallback과 reset, 저수준 `catchError`를 이용한 오류 포착을 다룬다. 동기 렌더링 오류와 Promise rejection 같은 비동기 오류가 전파되는 방식이 다르므로 비동기 실패를 반응형 경계로 다시 연결하는 방법도 설명한다.
- **교육 과정 연결**: 컴포넌트 합성과 비동기 데이터 학습 사이의 실패 처리 기반이다. 모든 오류를 한 전역 handler에 모으기보다 복구 단위에 맞춰 경계를 배치하는 관점을 제공한다.

### Chapter 16. Working with Owners

- **학습 초점**: computation의 소유권 트리가 중첩 반응성, context, cleanup의 수명을 관리하는 방식을 이해한다.
- **핵심 내용**: owner와 owned computation의 관계, 부모 재실행·폐기 시 자식 정리, `getOwner`, `runWithOwner`, `createRoot`를 다룬다. `await` 이후에는 현재 owner와 추적 문맥이 보존되지 않는 비동기 경계도 설명한다.
- **교육 과정 연결**: effect 누수, context 탐색, 라이브러리 수준 반응성 API를 하나의 수명주기 모델로 통합한다. 고급 과정에서는 비동기 callback에 owner를 무분별하게 넘길 때의 위험까지 함께 다뤄야 한다.

### Chapter 17. Styling Elements

- **학습 초점**: 정적·반응형 스타일을 선언적으로 적용하고 필요한 경우 명령형 DOM 스타일링을 사용한다.
- **핵심 내용**: 문자열과 객체 형태의 `style`, class·id·data 속성 및 CSS Modules, 조건부 `classList`를 설명한다. 애니메이션이나 외부 라이브러리 연동에서는 ref와 DOM style API를 이용하는 명령형 방식도 비교한다.
- **교육 과정 연결**: 반응형 값을 실제 시각적 표현에 연결하는 실용 챕터다. 선언형 상태로 표현할 부분과 DOM을 직접 조작할 부분의 경계를 연습하기 좋다.

### Chapter 18. Reactive Utilities

- **학습 초점**: 자주 반복되는 반응성 제어·props 변환·외부 시스템 연동을 보조 utility로 해결한다.
- **핵심 내용**: `batch`, `untrack`, `on`, `createRoot`, 반응성을 보존하는 `mergeProps`·`splitProps`, 목록용 `mapArray`·`indexArray`, Observable 연동용 `observable`·`from`, transition API를 개관한다.
- **교육 과정 연결**: 앞에서 배운 원리를 실제 조합 도구로 정리하는 참조형 챕터다. 목록과 transition처럼 뒤에서 자세히 다루는 항목은 여기서 암기시키기보다 해당 후속 챕터로 연결하는 편이 적절하다.

## 5. 제어 흐름과 상태 추상화

### Chapter 19. A Better Conditional Rendering

- **학습 초점**: 반응성을 보존하면서 조건에 따라 UI 분기를 선언적으로 표현한다.
- **핵심 내용**: `Show`의 `when`·`fallback`, keyed 렌더링과 render props, 여러 조건을 처리하는 `Switch`·`Match`를 다룬다. 단순 삼항식과 달리 분기 평가와 자식 생성을 제어하는 방식을 설명한다.
- **교육 과정 연결**: JSX 조건식에서 Solid 전용 제어 흐름 컴포넌트로 넘어가는 단계다. 값의 truthiness뿐 아니라 분기 안에서 제공되는 좁혀진 값과 DOM 보존 여부를 관찰하게 한다.

### Chapter 20. Working with Lists

- **학습 초점**: 목록의 변경 형태에 맞춰 항목 신원과 반응성 단위를 선택한다.
- **핵심 내용**: 항목 참조를 기준으로 재사용하는 `For`·`mapArray`와 인덱스를 고정하고 항목을 signal로 제공하는 `Index`·`indexArray`를 비교한다. `createSelector`로 선택 상태 갱신을 필요한 항목에 한정하는 방법도 다룬다.
- **교육 과정 연결**: 단순 `Array.map`을 넘어서 세밀한 DOM 재사용 비용을 이해하는 챕터다. 삽입·삭제·재정렬·제자리 값 갱신 실험으로 두 전략의 차이를 확인하기 좋다.

### Chapter 21. Rendering Components Outside Component Hierarchy

- **학습 초점**: 논리적 컴포넌트 관계를 유지하면서 DOM의 부모 레이아웃 제약 밖에 UI를 렌더링한다.
- **핵심 내용**: `Portal`로 modal·tooltip 등을 `body` 또는 별도 mount 지점에 배치한다. event 전파를 위한 wrapper, 기본 mount, Shadow DOM을 쓰는 `useShadow`, SVG mount용 `isSVG` 옵션을 설명한다.
- **교육 과정 연결**: 컴포넌트 트리와 실제 DOM 트리가 항상 같지 않음을 보여 준다. modal 실습에서는 focus 관리와 접근성도 별도 교육 항목으로 보완할 필요가 있다.

### Chapter 22. Managing Complex States with Stores

- **학습 초점**: 깊게 중첩된 객체·배열 상태를 필드 단위 반응성과 예측 가능한 갱신 API로 관리한다.
- **핵심 내용**: `createStore`가 제공하는 proxy 기반 읽기 추적, `setStore`의 path 문법과 부분 갱신, 반응형 scope 밖 읽기와 구조 분해 같은 제한을 설명한다. `produce`, `reconcile`, `unwrap`, 변경 가능한 모델의 `createMutable`도 비교한다.
- **교육 과정 연결**: signal 기반 객체 갱신이 복잡해지는 지점에서 도입한다. store를 무조건적인 전역 상태 도구가 아니라 중첩 구조와 외부 데이터 동기화 문제에 맞춘 선택지로 다뤄야 한다.

### Chapter 23. Abstracting Behavior With Custom Directives

- **학습 초점**: 반복되는 저수준 DOM 동작을 재사용 가능한 선언형 부착 기능으로 추상화한다.
- **핵심 내용**: `use:` 문법이 element와 값 accessor를 directive 함수에 전달하는 컴파일 결과, directive 내부 반응성과 cleanup을 설명한다. TypeScript의 JSX directive 타입 확장과 외부 모듈에서 가져온 directive의 이름 해석도 다룬다.
- **교육 과정 연결**: ref를 여러 컴포넌트에서 반복하는 문제를 더 작은 DOM 행동 단위로 분리한다. focus, click-outside, observer 같은 동작을 lifecycle과 함께 캡슐화하는 실습에 적합하다.

## 6. 비동기 UI와 상호작용

### Chapter 24. Working with Asynchronous Data

- **학습 초점**: 비동기 요청을 pending·success·error 상태 전이로 모델링하고 렌더링과 데이터 획득을 분리한다.
- **핵심 내용**: Promise 상태, loading·오류·재시도 UI, HTTP 실패와 parsing 오류 처리를 signal과 판별 가능한 상태로 구현한다. 컴포넌트 mount 뒤 fetch하는 방식의 waterfall을 설명하고, fetcher를 분리해 fetch-then-render로 이동한다.
- **교육 과정 연결**: 직접 구현을 통해 비동기 UI가 해결해야 할 문제를 먼저 드러낸 뒤 Chapter 25의 Resource API 필요성을 만든다. 취소·경쟁 상태·낙관적 갱신은 후속 보완 주제로 남는다.

### Chapter 25. Using Resource API for Data Fetching

- **학습 초점**: `createResource`로 비동기 데이터의 요청, 상태 추적, 갱신을 반응성 그래프에 통합한다.
- **핵심 내용**: source signal, fetcher, options와 resource accessor의 상태 정보, `mutate`·`refetch` action을 설명한다. UI 표시·렌더 중 재던지기·effect에서 재던지기 같은 오류 처리와 pagination 예제를 다룬다.
- **교육 과정 연결**: Chapter 24의 수동 상태 기계를 Solid 표준 추상화로 대체한다. source 변화가 재요청을 일으키고 resource는 읽히는 위치에서 Suspense와 연결된다는 점이 Chapter 26의 전제다.

### Chapter 26. Managing Loading States with Suspense

- **학습 초점**: 여러 비동기 자원의 준비 상태를 하나의 선언적 UI 경계로 관리한다.
- **핵심 내용**: `Suspense`는 하위에서 실제로 읽힌 pending resource를 추적하고, 모두 준비될 때까지 `fallback`을 표시한다. 읽히지 않은 resource는 경계를 활성화하지 않으며 중첩 boundary로 로딩 범위를 나눌 수 있다.
- **교육 과정 연결**: resource 상태를 각 컴포넌트에서 반복 검사하는 방식에서 경계 기반 조정으로 이동한다. 오류는 ErrorBoundary, 표시 순서는 SuspenseList와 역할을 분리한다.

### Chapter 27. Achieving Better Consistency with Transitions

- **학습 초점**: 비동기 갱신 중 기존 화면과 새 입력이 불일치하거나 로딩 화면으로 급격히 전환되는 문제를 줄인다.
- **핵심 내용**: `startTransition`과 `useTransition`으로 resource source 갱신을 transition에 넣고, 새 데이터가 준비될 때까지 이전 UI를 유지한다. `useTransition`이 제공하는 pending signal로 진행 표시와 중복 사용자 동작을 제어한다.
- **교육 과정 연결**: Suspense를 단순 fallback 장치에서 일관된 화면 전환 도구로 확장한다. 페이지네이션처럼 기존 콘텐츠를 유지할 가치가 있는 흐름에서 효과를 비교하게 한다.

### Chapter 28. Coordinating Loading States

- **학습 초점**: 여러 Suspense boundary가 제각각 나타날 때 콘텐츠 공개 순서를 조정한다.
- **핵심 내용**: `SuspenseList`의 `revealOrder`로 앞에서부터, 뒤에서부터, 함께 공개하는 전략을 선택하고 `tail`로 fallback 표시 방식을 조절한다. 원문은 이 컴포넌트가 실험적이며 SSR을 완전히 지원하지 않는다는 제한도 명시한다.
- **교육 과정 연결**: 비동기 데이터의 정확성보다 사용자에게 보이는 공개 순서와 안정성을 설계하는 단계다. 독립 로딩이 나은 경우와 일괄 조정이 나은 경우를 비교해야 한다.

### Chapter 29. Code Splitting and Lazy Loading

- **학습 초점**: 초기 JavaScript 전송량과 실행 비용을 줄이기 위해 필요한 컴포넌트만 지연 로드한다.
- **핵심 내용**: dynamic import와 `lazy`로 번들을 chunk로 분할하고, 지연 컴포넌트의 로딩을 Suspense로 처리한다. default export 제약과 named export 우회, route 단위 활용, 지나치게 작은 분할이 만드는 추가 비용도 설명한다.
- **교육 과정 연결**: 비동기 UI 모델을 데이터뿐 아니라 코드 자체의 로딩에 적용한다. 실제 교육에서는 번들 분석과 네트워크 waterfall을 관찰해 최적화 효과를 검증하는 활동이 필요하다.

### Chapter 30. Handling Events

- **학습 초점**: Solid의 이벤트 부착 방식과 브라우저 네이티브 이벤트 의미를 구분해 적절한 처리 방식을 선택한다.
- **핵심 내용**: 위임되는 `onClick` 같은 `on` prefix 속성과 직접 listener를 붙이는 `on:` namespace, custom event property, ref·directive 기반 등록을 비교한다. handler에 데이터를 tuple로 전달하는 문법과 네이티브 `input`·`change` 차이도 설명한다.
- **교육 과정 연결**: JSX가 어떤 DOM 이벤트 코드로 컴파일되는지 확인하는 상호작용 챕터다. React의 합성 이벤트와 다른 네이티브 의미, cleanup과 이벤트 위임 비용을 함께 비교하면 좋다.

### Chapter 31. Dynamically Rendering Components

- **학습 초점**: 런타임 값에 따라 HTML 요소나 컴포넌트 타입 자체를 바꾸어 렌더링한다.
- **핵심 내용**: 고정된 분기 중 하나를 고르는 조건부 렌더링과 동적 컴포넌트 선택을 구분한다. 중간 변수 방식의 반응성 한계를 살펴보고, `Dynamic`의 `component` prop으로 태그·컴포넌트와 나머지 props를 동적으로 전달한다.
- **교육 과정 연결**: 조건부 렌더링과 목록 다음에 배치해 “내용의 변화”와 “렌더링 타입의 변화”를 구분한다. schema 기반 UI나 플러그인 렌더러가 대표 실습 사례다.

### Chapter 32. Solid Without JSX

- **학습 초점**: 컴파일러를 사용할 수 없는 환경에서 JSX 없이 Solid UI를 구성하는 대안을 이해한다.
- **핵심 내용**: `solid-js/html`의 tagged template literal과 `solid-js/h`의 Hyperscript를 사용해 요소와 컴포넌트를 만든다. 반응형 표현식을 함수로 감싸기, props 반응성 보존, ref 처리 같은 런타임 제약과 SSR 미지원이라는 단점을 설명한다.
- **교육 과정 연결**: Solid의 핵심 반응성이 JSX 자체에 종속되지 않음을 보여 주지만 일반 애플리케이션의 필수 과정은 아니다. 컴파일 단계의 가치와 대체 문법의 비용을 비교하는 선택형 심화 주제로 적합하다.

## 7. 서버 렌더링과 풀스택

### Chapter 33. Server Side Rendering

- **학습 초점**: 클라이언트 전용 SPA의 한계를 이해하고 서버 렌더링 결과를 브라우저에서 이어받는 전체 흐름을 구현한다.
- **핵심 내용**: SEO·초기 표시·복잡성·보안 등 SPA의 trade-off를 살펴보고 `renderToString`, `renderToStringAsync`, `renderToStream`을 비교한다. hydration, hydration script와 식별자, `isServer`·`DEV`, Express 기반 SSR, application shell과 client logic 분리, Router 결합을 다룬다.
- **교육 과정 연결**: 앞서 배운 컴포넌트·resource·Suspense·lazy를 서버 실행과 hydration 관점으로 통합하는 고급 챕터다. 세 렌더링 방식의 응답 시점과 상호작용 가능 시점을 네트워크 관찰로 비교해야 한다.

### Chapter 34. Solid Router

- **학습 초점**: URL을 애플리케이션 상태와 데이터 작업의 경계로 사용해 탐색 가능한 SPA를 구성한다.
- **핵심 내용**: `Router`·`Route`, 동적·선택·wildcard 경로, 중첩 route와 layout, Hash·Memory Router를 설명한다. `A`, programmatic navigation과 redirect, base path, preload, location·search params·params·match hook, 전환 차단과 indicator를 다룬다.
- **교육 과정 연결**: 후반부는 query 기반 중복 제거, action과 HTML form mutation, submission 추적, 인증·검증까지 포함해 범위가 크다. 실제 과정에서는 “경로와 탐색”, “데이터 로딩”, “mutation과 form”의 세 단위로 나누는 편이 검토하기 쉽다.

### Chapter 35. Isomorphic Apps with SolidStart

- **학습 초점**: SolidStart의 파일 기반 규약과 서버·클라이언트 기능을 결합해 동형 full-stack 애플리케이션을 만든다.
- **핵심 내용**: 파일 기반 route·layout, asset과 styling, API endpoint·server function·server action, cache·preload·prerender, middleware와 server event, head·header·status·client-only component를 다룬다. Echoes 예제로 데이터 조회·수정, session 기반 인증·인가, 오류, toast와 확인 dialog까지 통합한다.
- **교육 과정 연결**: Chapter 33과 34를 실제 프레임워크 규약으로 종합하는 capstone이다. 서버리스 환경의 요청 격리, 영속 저장소, cache invalidation, 비밀 정보의 서버 경계를 별도 성공 기준으로 두어야 한다.
