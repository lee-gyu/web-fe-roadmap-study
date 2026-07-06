# 3-2. 클로저와 함수 — 환경의 캡처와 생존

> 한 줄 요약: 클로저가 값이 아니라 환경 레코드 자체를 캡처한다는 모델을 세우고, 그 모델로 루프 함정·stale 값·상태 은닉 패턴을 예측하며, DevTools에서 캡처된 환경을 직접 관찰할 수 있다.

## 학습 목표

- 클로저의 캡처 단위가 값이 아니라 환경(Environment Record)임을 코드로 검증하고, 같은 환경을 공유하는 클로저들이 변수를 함께 보는 이유를 설명할 수 있다.
- `var` 루프 함정이 `let`으로 해결되는 정확한 스펙 근거(per-iteration environment)를 설명할 수 있다.
- 디바운스·메모이제이션·once 같은 고차 함수 패턴을 "상태를 은닉한 함수"라는 하나의 원리로 구현할 수 있다.
- 화살표 함수가 this를 "렉시컬로 바인딩"하는 게 아니라 바인딩 자체를 만들지 않는다는 설계를 설명하고, `bind(this)` 시대가 끝난 이유를 말할 수 있다.
- Sources 패널의 [[Scopes]]로 함수가 실제로 붙잡고 있는 환경을 확인할 수 있다.

## 배경: 왜 이것이 존재하는가

클로저(closure)라는 단어는 대부분의 현대 언어에 있다. Java의 람다, C#의 델리게이트, Python의 중첩 함수 — 전부 "바깥 변수를 참조하는 함수"다. 그래서 경력자는 클로저를 새 개념으로 배우지 않는다. 문제는 **같은 단어가 언어마다 다른 모델을 가리킨다**는 데 있다.

Java 람다가 캡처하는 지역 변수는 effectively final이어야 한다 — 사실상 **값의 복사**이고, 캡처 후 변수와 람다는 남남이다. JS의 클로저는 정반대다. 캡처하는 것은 값이 아니라 **변수가 사는 환경 자체**이고, 환경 속 변수가 나중에 바뀌면 클로저는 바뀐 값을 본다. 이 차이를 모른 채 Java 모델을 가져오면 두 방향의 사고가 난다: 루프에서 만든 콜백들이 전부 마지막 값을 보는 고전 함정(공유를 예상 못 함), 그리고 React에서 이펙트가 옛 상태를 보는 stale closure(공유가 끊기는 지점을 예상 못 함 — Phase 5-4의 원형).

[3-1](./01-execution-model.md)에서 복선을 깔았다: 함수 객체는 [[Environment]]로 자신이 정의된 환경 레코드를 가리키고, 그래서 환경 레코드는 스택 프레임과 달리 호출이 끝나도 힙에 살아남을 수 있다. 이 문서는 그 생존 메커니즘이 무엇을 가능하게 하고(상태 은닉, 모듈 패턴), 무엇을 요구하는지(누수 관리 — 진단은 [3-10](./10-memory-and-storage.md))를 다룬다.

## 핵심 개념

### 캡처 단위는 환경이다

클로저는 별도 기능이 아니다. [3-1](./01-execution-model.md)의 두 규칙 — ① 함수는 정의 위치의 환경을 [[Environment]]에 저장한다, ② 식별자 해석은 [[OuterEnv]] 체인을 탐색한다 — 의 조합이 만드는 현상에 붙은 이름일 뿐이다. 따라서 캡처되는 것은 개별 값이 아니라 **환경 레코드에 대한 참조**다. 관찰 가능한 귀결이 두 가지 있다.

**첫째, 클로저는 변수의 현재 값을 본다.** 캡처 시점의 값이 아니다.

```js
function makeReader() {
  let secret = "initial";
  const read = () => secret;
  secret = "changed"; // read를 만든 뒤에 바꿨다
  return read;
}
console.log(makeReader()()); // 출력: "changed"
// Java의 값 복사 모델이라면 "initial"이었을 것이다
```

**둘째, 같은 환경에서 만들어진 클로저들은 변수를 공유한다.** 각자 복사본을 갖는 게 아니라 같은 환경 레코드를 함께 가리킨다.

```js
function makeCounter() {
  let count = 0; // 이 변수가 사는 환경 레코드 하나를
  return {
    increment: () => ++count, // 이 세 클로저가
    decrement: () => --count, // 전부 함께
    current: () => count,     // 가리킨다
  };
}

const c = makeCounter();
c.increment();
c.increment();
console.log(c.current()); // 출력: 2 — increment가 바꾼 것을 current가 본다

const c2 = makeCounter(); // 호출마다 새 Function ER가 만들어지므로
console.log(c2.current()); // 출력: 0 — c와 c2는 서로 다른 환경
```

`makeCounter`의 호출은 끝났고 스택 프레임은 사라졌지만, 세 클로저의 [[Environment]]가 그 호출의 환경 레코드를 가리키는 한 `count`는 힙에 살아 있다. 그리고 이 변수에 도달하는 유일한 경로는 세 함수뿐이다 — **접근 제어자 없이 성립하는 캡슐화**이고, 이 문서 후반의 모든 패턴이 이 구조의 응용이다.

### 루프와 클로저 — per-iteration environment

캡처 단위가 환경이라는 모델의 대표적 시험대가 루프다.

```js
// ❌ var: 함수 스코프 — 루프 전체에 환경이 하나
const fnsVar = [];
for (var i = 0; i < 3; i++) {
  fnsVar.push(() => i);
}
console.log(fnsVar.map((f) => f())); // 출력: [3, 3, 3]

// ✅ let: 반복마다 새 환경
const fnsLet = [];
for (let j = 0; j < 3; j++) {
  fnsLet.push(() => j);
}
console.log(fnsLet.map((f) => f())); // 출력: [0, 1, 2]
```

`var`의 결과는 이제 설명이 필요 없다: `i`는 VariableEnvironment(함수/스크립트 스코프)에 하나뿐이고, 세 클로저는 같은 환경을 공유하므로 루프가 끝난 시점의 값 3을 함께 본다. 클로저가 "고장난" 것이 아니라 명세대로 정확히 동작한 것이다.

`let`이 해결하는 방식이 핵심이다. "let은 블록 스코프라서"라는 통상의 설명은 반만 맞다 — 블록 스코프라는 것만으로는 "루프 전체에 환경 하나"일 수도 있다. 스펙(§14.7.4.2 ForBodyEvaluation의 CreatePerIterationEnvironment)은 `for (let ...)`에 대해 **반복(iteration)마다 새 환경 레코드를 만들고, 직전 반복의 변수 값을 새 환경으로 복사**하도록 명시한다. 그래서 각 반복에서 만들어진 클로저는 서로 다른 환경의 서로 다른 `j`를 캡처한다. 증가식 `j++`가 다음 반복의 새 `j`에 적용되는 것까지 스펙이 절차로 정의해 놓았다. `let`이 "루프 함정을 해결"하는 것은 문법 설탕이 아니라 이 명시적 스펙 동작이다.

같은 원리로 `for...of`도 반복마다 새 바인딩을 만들며, 콜백 기반 순회(`arr.forEach((item) => ...)`)는 애초에 반복마다 함수 호출이라 매번 새 Function ER이 생겨 문제가 없다.

### V8의 구현 — 무엇이 힙으로 가는가

여기서부터는 **V8 구현 세부**다. 표준은 환경 레코드를 어디에 저장하는지 규정하지 않는다.

V8은 함수를 파싱할 때 각 변수의 탈출 여부를 분석한다. 내부 함수가 참조하지 않는 변수는 스택 슬롯/레지스터에 두고 호출 종료와 함께 버린다. 내부 함수가 참조하는 변수만 힙의 **Context 객체**로 승격한다. 클로저(JSFunction)는 이 Context를 가리키는 포인터를 갖는다 — [[Environment]]의 실제 구현이다.

중요한 경계 조건: **Context는 스코프 단위로 하나**다. 같은 스코프의 변수 중 하나라도 어떤 내부 함수에 캡처되면 그 변수는 Context에 들어가는데, 서로 다른 클로저가 같은 스코프의 서로 다른 변수를 캡처하면 두 클로저가 **같은 Context를 공유**하게 된다.

```js
function setup() {
  const bigData = new Array(1_000_000).fill(0); // 큰 데이터
  const label = "small";

  // bigData는 이 함수만 참조한다
  const analyze = () => bigData.length;

  // label만 참조하는 함수를 반환한다
  return () => label;
}
const getLabel = setup();
// 직관: bigData는 아무도 안 쓰니 해제된다?
// V8의 실제: analyze가 bigData를 캡처하므로 bigData는 setup의 Context에 들어가고,
// getLabel도 (label 때문에) 같은 Context를 가리킨다.
// getLabel이 살아 있는 한 bigData까지 힙에 남을 수 있다.
```

이 동작은 엔진·버전에 따라 다를 수 있는 구현 세부이므로 여기에 의존하는 코드를 쓰면 안 되지만, **큰 객체가 예상 밖으로 오래 사는** 메모리 문제의 흔한 원인이므로 존재는 알아야 한다. 진단 절차는 [3-10](./10-memory-and-storage.md)에서 다루고, 여기서는 관찰 방법만 세운다: DevTools 콘솔에서 `console.dir(getLabel)`을 펼치면 `[[Scopes]]` 항목에 이 함수가 붙잡은 Context들이 나열된다. 위 코드에서 `bigData`가 목록에 보이면 공유 Context에 함께 붙잡힌 것이다. Sources 패널 중단점의 Scope 창 `Closure` 항목도 같은 정보를 보여준다.

### 고차 함수 패턴 — 전부 "상태를 은닉한 함수"다

커링, 메모이제이션, once, 디바운스는 별개의 암기 대상이 아니라 makeCounter와 같은 구조 — **환경에 상태를 숨기고 함수만 내보내기** — 의 변주다. 은닉하는 상태가 무엇인지만 다르다.

```js
// once — 은닉 상태: 호출 여부와 결과
function once(fn) {
  let called = false;
  let result;
  return (...args) => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

// memoize — 은닉 상태: 인자→결과 캐시
function memoize(fn) {
  const cache = new Map();
  return (arg) => {
    if (!cache.has(arg)) cache.set(arg, fn(arg));
    return cache.get(arg);
  };
}
// 경계 조건: cache는 클로저에 붙잡혀 절대 비워지지 않는다.
// 인자 공간이 무한하면 이것은 메모리 누수다 — 3-10의 "한계 없는 캐시" 패턴
```

디바운스는 과제 B(검색 자동완성)에서 직접 쓸 패턴이다. 은닉 상태는 "예약된 타이머"다.

```js
// debounce — 마지막 호출 후 delay가 지나야 실행
function debounce(fn, delay) {
  let timerId; // 이 변수가 연속 호출들 사이에서 살아남는 것이 핵심
  return (...args) => {
    clearTimeout(timerId); // 직전 예약 취소
    timerId = setTimeout(() => fn(...args), delay);
  };
}

const onInput = debounce((q) => console.log("검색:", q), 300);
onInput("a"); onInput("ab"); onInput("abc");
// 출력 (300ms 후): 검색: abc — 앞의 두 예약은 취소됐다
```

`timerId`가 일반 변수였다면 호출들 사이에 상태가 이어지지 않아 취소가 불가능하다. 스로틀(throttle)은 같은 구조에서 은닉 상태만 "마지막 실행 시각"으로 바꾼 것이다. 두 패턴의 사용처 구분은 실무 관점 절에서 다룬다.

ESM 이전 시대의 **모듈 패턴**도 같은 구조를 파일 규모로 확장한 것이다. 언어에 모듈이 없던 시절, IIFE(즉시 실행 함수)의 스코프를 "모듈 스코프"로, 반환 객체를 "export"로 썼다.

```js
// ESM 이전의 모듈 패턴 — 전역에는 storage 하나만 노출된다
const storage = (() => {
  const data = new Map(); // private — 이 IIFE의 환경에만 존재
  return {
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
  };
})();
```

언어가 모듈([3-9](./09-modules.md))을 도입하면서 이 컨벤션은 문법으로 대체되었지만, "스코프 = 캡슐화 경계"라는 원리는 모듈 스코프에 그대로 계승되었다.

### 화살표 함수 — 바인딩의 부재라는 설계

화살표 함수의 this를 흔히 "렉시컬 this를 바인딩한다"고 설명하지만, 스펙의 실제는 더 단순하다. 화살표 함수는 자신의 Function ER에 **this 바인딩을 만들지 않는다**(arguments, super, new.target도 마찬가지). 그 결과 화살표 함수 안의 `this`는 특별 처리 없이, 다른 모든 식별자와 똑같이 [[OuterEnv]] 체인을 타고 올라가 **바깥 함수의 this**에 도달한다.

즉 화살표 함수는 [3-1](./01-execution-model.md)의 결론 — 스코프(정적 축)와 this(동적 축)는 독립이다 — 에서 동적 축을 제거하고 this를 정적 축으로 편입시킨 것이다. 호출 형태가 아니라 정의 위치가 this를 결정하게 된다.

```js
class Poller {
  constructor() {
    this.count = 0;
  }
  start() {
    // ❌ 일반 함수: setTimeout이 기본 바인딩으로 호출 → this는 start의 this가 아니다
    setTimeout(function () {
      this.count += 1; // TypeError 또는 전역 오염
    }, 1000);

    // ✅ 화살표 함수: 자기 this가 없으므로 start의 this를 그대로 본다
    setTimeout(() => {
      this.count += 1;
    }, 1000);
  }
}
```

이 설계가 나오기 전의 코드가 왜 그렇게 생겼는지도 같은 모델로 읽힌다. `var self = this`는 this(스코프 탐색이 안 되는 키워드)를 일반 변수(스코프 탐색이 되는)로 옮겨 클로저 캡처를 가능하게 만든 우회였고, `fn.bind(this)`는 콜백의 [[ThisValue]]를 호출 전에 고정하는 우회였다. 화살표 함수는 두 우회를 언어 차원에서 불필요하게 만들었다 — this 바인딩을 만들지 않으면 애초에 잃어버릴 것이 없다.

경계 조건도 같은 논리에서 나온다. this가 **호출 형태에 따라 달라져야 하는** 자리에는 화살표 함수를 쓸 수 없다: 객체 리터럴의 메서드(this가 객체를 가리키길 원할 때 — 화살표는 바깥 스코프의 this를 봐 버린다), `call`/`apply`/`bind`로 this를 바꿔야 하는 함수(화살표에는 바꿀 바인딩 자체가 없어 조용히 무시된다), 생성자(new 불가 — [[Construct]]가 없다).

## 실무 관점

**stale 값 문제는 "클로저가 무엇을 캡처했는가"의 문제다.** 클로저는 변수의 현재 값을 본다 — 단, **자신이 캡처한 그 환경의** 변수다. 비동기 콜백이 실행되는 시점에 코드의 다른 곳에서 *새 변수*(새 환경)가 만들어져 있다면, 콜백은 여전히 옛 환경을 본다. React 함수 컴포넌트는 렌더마다 새 환경을 만들기 때문에 이 상황이 구조적으로 반복된다(stale closure — Phase 5-4에서 다룬다). 바닐라 JS에서도 원형은 같다: "콜백을 만든 시점의 환경"과 "실행 시점에 보이길 원하는 상태"가 다른 환경에 있으면 어긋난다. 해법의 방향도 같다 — 공유가 필요한 상태는 하나의 환경(또는 객체)에 두고 클로저들이 그것을 함께 가리키게 한다.

**디바운스 vs 스로틀은 "마지막이 중요한가, 주기가 중요한가"로 갈린다.**

| | 디바운스 | 스로틀 |
|---|---------|--------|
| 의미 | 입력이 멈춘 뒤 한 번 | 최대 N ms에 한 번 |
| 적합한 곳 | 검색 자동완성, 폼 검증, 리사이즈 완료 후 재계산 | 스크롤 위치 추적, 드래그 좌표, 무한 스크롤 트리거 |
| 무너지는 지점 | 입력이 끊기지 않으면 **영원히 실행되지 않는다** (타이핑을 멈추지 않는 사용자, 연속 스크롤) | 마지막 이벤트가 버려질 수 있다 — trailing 호출 옵션 없이는 최종 상태가 반영 안 됨 |

**클로저에 숨긴 상태는 테스트와 직렬화가 안 된다.** makeCounter의 count는 완벽하게 은닉되지만, 그래서 테스트에서 검증하려면 공개 함수를 통해야만 하고, 상태를 저장/복원(직렬화)할 방법이 없으며, DevTools에서도 [[Scopes]]를 파고들어야 보인다. 상태가 단순하고 소유자가 하나면 클로저 은닉이 깔끔하지만, 상태를 검사·저장·공유해야 하는 순간이 오면 명시적 객체(또는 class — [3-4](./04-object-model.md))로 갈아타는 것이 맞다. "완벽한 은닉"은 공짜가 아니다.

**리스너에 넘긴 클로저는 해제 경로를 함께 설계한다.** `addEventListener`에 넘긴 클로저는 (bind 결과든 화살표든) 그 자리에서 만든 함수라면 참조를 보관하지 않는 한 `removeEventListener`로 제거할 수 없고, 리스너가 살아 있는 한 캡처된 환경 전체가 산다. SPA처럼 화면이 수명을 가지는 구조에서 이것이 대표적 누수 경로가 된다 — 패턴별 진단은 [3-10](./10-memory-and-storage.md), AbortSignal 일괄 해제는 [3-6](./06-promises-and-async.md)·[3-7](./07-dom-and-events.md)에서 다룬다.

## 더 깊이

**스펙에는 "클로저"가 없다.** ECMA-262 본문은 closure를 정의하지 않는다. 있는 것은 OrdinaryFunctionCreate(§10.2.3)가 함수 객체의 [[Environment]] 슬롯에 실행 중인 컨텍스트의 LexicalEnvironment를 저장하는 한 줄, 그리고 나중에 그 함수가 호출될 때(PrepareForOrdinaryCall) 새 Function ER의 [[OuterEnv]]를 [[Environment]]로 설정하는 한 줄뿐이다. 모든 함수가 이 절차를 거치므로, 스펙 관점에서는 **모든 JS 함수가 클로저**다. "바깥 변수를 실제로 쓰는 함수"만 클로저라고 부르는 것은 관찰 가능한 효과 기준의 통용 어법일 뿐이다.

**V8은 캡처 분석을 파스 타임에 끝낸다.** 어떤 변수를 Context로 승격할지는 실행 중이 아니라 파싱 시점의 정적 분석으로 결정된다. 이것이 `eval`과 `with`가 최적화의 적인 이유다 — 함수 본문에 직접 `eval`이 있으면 어떤 변수가 참조될지 정적으로 알 수 없어, V8은 그 스코프의 모든 변수를 Context에 유지해야 한다(구현 세부). strict mode가 `with`를 금지하고 direct eval의 스코프 주입을 제한한 것은 이 분석 가능성을 지키는 방향의 설계다.

**한때 실무 지식이었던 것: 클로저 vs 프로토타입 메서드의 메모리 비용.** 인스턴스를 수만 개 만드는 상황이라면, makeCounter 스타일은 인스턴스마다 함수 객체 세 개 + Context를 만들지만 class는 프로토타입에 메서드 하나를 공유한다([3-4](./04-object-model.md)). 다만 이 차이가 실제 병목이 되는 경우는 드물다 — 주장하려면 Memory 패널 힙 스냅샷에서 (closure) 항목의 shallow size를 비교해 확인하는 것이 순서다([3-10](./10-memory-and-storage.md)의 계측 절차).

## 정리

- 클로저의 캡처 단위는 값이 아니라 환경 레코드다. 그래서 클로저는 변수의 현재 값을 보고, 같은 환경에서 태어난 클로저들은 상태를 공유한다 — Java 람다의 값 복사 모델과 정반대다.
- `var` 루프 함정의 원인은 "환경이 하나"이고, `let`의 해결은 블록 스코프 일반론이 아니라 스펙이 명시한 per-iteration environment(반복마다 새 환경 + 값 복사)다.
- V8은 캡처된 변수만 힙 Context로 승격하며, Context는 스코프 단위 공유라 무관한 큰 변수가 함께 붙잡힐 수 있다(구현 세부 — [[Scopes]]로 관찰).
- once·memoize·디바운스·모듈 패턴은 전부 "환경에 상태를 은닉하고 함수만 내보내기"라는 하나의 구조다. 은닉은 캡슐화인 동시에 검사·직렬화 불가라는 비용이다.
- 화살표 함수는 this·arguments·super 바인딩을 만들지 않는다. this가 정적 축(스코프 체인)으로 편입되므로 콜백에 이상적이고, this가 호출 형태를 따라야 하는 자리(메서드, 생성자)에는 부적합하다.

## 확인 문제

**Q1.** 다음 코드의 출력을 예측하고, "클로저는 만든 시점의 값을 기억한다"는 통념이 어느 지점에서 무너지는지 설명하라.

```js
function makeGreeters() {
  let greeting = "Hello";
  const casual = () => `${greeting}!`;
  greeting = "Hi";
  const formal = () => `${greeting}, sir.`;
  return [casual, formal];
}
const [casual, formal] = makeGreeters();
console.log(casual()); // (1)
console.log(formal()); // (2)
```

<details>
<summary>정답과 해설</summary>

(1) `"Hi!"`, (2) `"Hi, sir."`

통념대로라면 casual은 생성 시점의 "Hello"를 기억해야 하지만, 두 클로저는 **같은 환경 레코드**를 가리킬 뿐 값을 복사하지 않는다. `greeting = "Hi"`는 그 공유 환경의 변수를 바꾸므로, 언제 만들어졌든 두 클로저 모두 호출 시점의 현재 값 "Hi"를 읽는다. "만든 시점의 값을 기억한다"는 통념은 환경이 이후 변경되지 않는 흔한 경우에만 우연히 맞는 근사 모델이다.
</details>

**Q2.** 아래 두 루프의 출력이 다른 이유를 환경 레코드 개수로 설명하라. 그리고 `var`를 유지한 채 `[0, 1, 2]`를 만들려면 ES5 시절 개발자들이 무엇을 했을지 클로저 원리로 답하라.

```js
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i));   // 3 3 3
for (let j = 0; j < 3; j++) setTimeout(() => console.log(j));   // 0 1 2
```

<details>
<summary>정답과 해설</summary>

`var i`는 함수/스크립트 스코프에 환경이 **하나**이고, 세 콜백이 같은 환경을 캡처한다. setTimeout 콜백은 루프가 끝난 뒤 실행되므로([3-5](./05-event-loop.md)) 셋 다 최종 값 3을 본다. `let j`는 CreatePerIterationEnvironment에 의해 반복마다 새 환경이 만들어지고 값이 복사되므로 환경이 **세 개**, 콜백마다 다른 j를 캡처한다.

ES5 시절 해법은 IIFE로 반복마다 새 환경을 수동으로 만드는 것이다: `for (var i = 0; i < 3; i++) (function (k) { setTimeout(() => console.log(k)); })(i);` — 함수 호출마다 새 Function ER이 생기고 매개변수 k가 그 시점의 i 값으로 초기화된다. `let`의 per-iteration environment는 사실상 이 IIFE 패턴을 언어에 내장한 것이다.
</details>

**Q3.** 동료가 "화살표 함수는 this를 자동으로 bind해 주니까 항상 화살표 함수를 쓰면 된다"며 객체 리터럴의 메서드까지 화살표로 바꿨다. 아래 코드에서 무엇이 잘못되는지, "바인딩 부재" 모델로 설명하라.

```js
const timer = {
  seconds: 0,
  tick: () => {
    this.seconds += 1; // 의도: timer.seconds 증가
  },
};
timer.tick();
console.log(timer.seconds); // 0 — 왜?
```

<details>
<summary>정답과 해설</summary>

화살표 함수는 this 바인딩을 만들지 않으므로 `tick` 안의 this는 스코프 체인을 타고 **객체 리터럴 바깥 스코프의 this**로 해석된다. 객체 리터럴은 스코프가 아니다 — `timer.tick()`이라는 호출 형태(암시적 바인딩)는 화살표 함수에 바인딩할 [[ThisValue]] 슬롯 자체가 없으니 아무 효과가 없다. 모듈 최상위라면 this는 undefined라 TypeError, non-strict 스크립트라면 globalThis에 `NaN`인 seconds가 생기고 timer.seconds는 그대로 0이다.

"자동 bind"라는 이해가 틀린 이유: bind는 값을 고정하는 것이지만, 화살표는 **바인딩이 없어서 바깥 것이 보이는** 것이다. 바깥 this가 원하는 값일 때(메서드/생성자 안의 콜백)만 유효하고, this가 호출 형태를 따라야 하는 자리(객체 메서드)에서는 정확히 역효과가 난다. 여기서는 `tick() { this.seconds += 1; }` 단축 메서드가 맞다.
</details>

## 참고 자료

- [ECMA-262 — OrdinaryFunctionCreate (§10.2.3)](https://tc39.es/ecma262/#sec-ordinaryfunctioncreate) — [[Environment]] 캡처가 일어나는 정확한 지점.
- [ECMA-262 — ForBodyEvaluation / CreatePerIterationEnvironment (§14.7.4.2)](https://tc39.es/ecma262/#sec-forbodyevaluation) — `let` 루프가 반복마다 새 환경을 만드는 스펙 절차.
- [ECMA-262 — Arrow Function Definitions (§15.3)](https://tc39.es/ecma262/#sec-arrow-function-definitions) — ThisMode가 lexical인 함수의 정의. "바인딩을 만들지 않는다"의 원문.
- [v8.dev — Understanding V8's Bytecode](https://v8.dev/blog/understanding-v8-bytecode) — Context 접근(LdaContextSlot 등)이 바이트코드 수준에서 어떻게 표현되는지. 구현 세부 검증용.
- [MDN — Closures](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures) — 통용 어법 기준의 클로저 정리. 스펙 모델과 대조하며 읽기.
