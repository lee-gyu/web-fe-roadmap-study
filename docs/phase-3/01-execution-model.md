# 3-1. 실행 모델 — 실행 컨텍스트, 스코프, this

> 한 줄 요약: 호이스팅·TDZ·this의 "이상한 규칙들"을 암기 목록이 아니라 실행 컨텍스트 생성 절차라는 단일 구조의 필연적 결과로 설명할 수 있고, DevTools Sources 패널에서 그 구조를 직접 관찰할 수 있다.

## 학습 목표

- 실행 컨텍스트와 렉시컬 환경(Lexical Environment), Environment Record의 관계를 스펙 용어로 설명할 수 있다.
- "호이스팅"이라는 통념을 컨텍스트 생성 단계의 바인딩 등록·초기화 시점 차이로 재정의하고, TDZ가 왜 별도 장치가 아닌지 설명할 수 있다.
- 스코프 체인이 호출 위치가 아니라 정의 위치로 결정된다는 사실을 코드로 검증할 수 있다.
- this 바인딩 4규칙과 결정 시점(호출 형태)을 근거로, 메서드를 변수에 담으면 this가 바뀌는 현상을 진단할 수 있다.
- 중단점에 멈춘 상태에서 Sources 패널의 Call Stack·Scope 창을 읽고 환경 레코드의 실제 내용을 확인할 수 있다.

## 배경: 왜 이것이 존재하는가

JavaScript는 문법이 Java/C#과 닮아서 "아는 언어"라는 착각을 만든다. 하지만 핵심 의미론은 정반대 지점이 많다. `var` 선언이 선언 위치보다 위에서 읽히고, 같은 함수인데 호출하는 방법에 따라 this가 달라지고, 블록 안의 `let`을 블록 첫 줄에서 읽으면 `ReferenceError`가 난다. 이런 현상들은 흔히 "호이스팅", "TDZ", "this 바인딩 규칙"이라는 별개의 암기 항목으로 유통된다.

이 문서의 주장은 하나다: **이것들은 별개의 규칙이 아니라, ECMA-262가 정의한 실행 컨텍스트 생성 절차 하나에서 전부 유도된다.** 코드를 실행하기 전에 엔진이 무엇을 준비하는지(바인딩 등록), 그 준비 단계에서 선언 종류별로 무엇이 다른지(초기화 여부), 그리고 준비된 환경들이 어떻게 연결되는지([[OuterEnv]])를 알면, 위 현상들은 예측 가능한 출력이 된다.

경력자에게 이 문서의 핵심 대비는 this다. Java/C#에서 `this`는 인스턴스 메서드라는 **선언 위치**가 결정하고, 컴파일 타임에 확정된다. JS의 this는 **호출 형태**가 런타임에 결정한다. "메서드를 변수에 담아 호출하면 this가 깨진다"는 현상은 버그가 아니라 모델이 다른 것이다. 이 문서는 정적으로 결정되는 축(스코프 체인)과 동적으로 결정되는 축(this)이 서로 독립적인 두 축이라는 사실을 종착점으로 삼는다.

이 문서가 세우는 어휘 — 실행 컨텍스트, 환경 레코드, [[OuterEnv]] — 는 Phase 3 전체의 공용 어휘다. 클로저([3-2](./02-closures-and-functions.md))는 환경 레코드의 생존 문제이고, 이벤트 루프([3-5](./05-event-loop.md))는 콜 스택이 비는 순간의 문제이며, 모듈([3-9](./09-modules.md))의 순환 의존 에러는 TDZ의 재등장이다.

## 핵심 개념

### 실행 컨텍스트 스택 — 코드가 실행되는 단위

엔진은 실행 가능한 코드 조각(스크립트, 모듈, 함수 본문, eval)에 진입할 때마다 **실행 컨텍스트(execution context)** 를 만들어 스택에 쌓고, 그 코드가 끝나면 걷어낸다. 다른 언어의 콜 스택 프레임과 같은 구조다. 스펙(ECMA-262 §9.4)이 정의하는 실행 컨텍스트의 주요 구성 요소는 다음과 같다.

- **LexicalEnvironment** — 현재 코드가 식별자를 해석할 때 쓰는 환경. `let`/`const`/`class` 바인딩이 여기에 등록된다.
- **VariableEnvironment** — `var`와 함수 선언이 등록되는 환경. 함수 컨텍스트에서는 보통 LexicalEnvironment와 같은 환경을 가리키지만, 블록에 진입하면 LexicalEnvironment만 새 환경으로 갈아끼워진다. `var`가 블록을 무시하는 이유가 바로 이 분리다.
- **code evaluation state** — 실행이 어디까지 진행됐는가. 제너레이터·async 함수가 중단·재개될 수 있는 근거다([3-6](./06-promises-and-async.md)에서 사용).

즉 "스코프"라고 부르던 것의 스펙상 실체는 실행 컨텍스트가 참조하는 **환경(Environment)** 이고, 환경의 핵심이 다음 절의 Environment Record다.

### Environment Record — 바인딩의 실제 저장소

**Environment Record(환경 레코드)** 는 식별자 이름 → 값의 바인딩을 저장하는 스펙상의 자료구조다. 스펙은 다섯 종류를 정의한다(§9.1).

| 종류 | 무엇의 바인딩을 담는가 | 비고 |
|------|----------------------|------|
| Declarative ER | `let`/`const`/`class` 등 선언문 | 블록·catch절도 이걸 만든다 |
| Function ER | 함수 호출 하나의 매개변수·지역 변수, this | declarative ER의 특수형 |
| Module ER | 모듈 최상위 바인딩 | import 바인딩의 간접 참조 포함, [3-9](./09-modules.md) |
| Object ER | 어떤 객체의 프로퍼티를 바인딩처럼 노출 | `with`문과 전역 객체에 사용 |
| Global ER | 스크립트 전역 | object ER(전역 객체) + declarative ER의 합성 |

Global ER이 합성 구조라는 점은 관찰 가능한 차이를 만든다. 전역에서 `var x = 1`은 object ER 쪽, 즉 전역 객체의 프로퍼티가 되지만, `let y = 2`는 declarative ER 쪽에 들어가 전역 객체에 나타나지 않는다.

```js
// 전역 스크립트에서 실행 (Node 24 REPL 또는 브라우저 콘솔)
var x = 1;
let y = 2;
console.log(globalThis.x); // 출력: 1  — object ER = 전역 객체의 프로퍼티
console.log(globalThis.y); // 출력: undefined — declarative ER에만 존재
```

모든 환경 레코드는 **[[OuterEnv]]** 라는 필드로 자신을 감싸는 바깥 환경 레코드를 가리킨다. 최상위(전역/모듈)의 [[OuterEnv]]는 null이다. 식별자 해석(ResolveBinding)은 현재 환경에서 이름을 찾고, 없으면 [[OuterEnv]]를 따라 올라가는 단순한 연결 리스트 탐색이다. 이 연결 리스트가 통념에서 "스코프 체인"이라고 부르는 것의 실체다.

### "호이스팅"의 실체 — 등록과 초기화의 분리

"호이스팅(hoisting)"은 스펙에 없는 통념 용어다. 선언이 "위로 끌어올려진다"는 이미지는 근사 모델로는 쓸 만하지만, `let`이 등장하면서 무너진다 — `let`도 "끌어올려지는데" 접근하면 에러가 나기 때문이다. 스펙의 실제 절차는 이동이 아니라 **2단계 처리**다.

1. **컨텍스트 생성 시점(선언 인스턴스화, §10.2.11 FunctionDeclarationInstantiation 등)**: 코드를 실행하기 전에, 그 스코프의 모든 선언을 스캔해 환경 레코드에 바인딩을 **등록**한다. 이때 선언 종류별로 처리가 다르다.
   - `var` — 등록하면서 `undefined`로 **초기화까지** 한다.
   - 함수 선언 — 등록하면서 함수 객체를 만들어 **값까지 할당**한다.
   - `let`/`const`/`class` — 등록만 하고 **초기화하지 않는다**.
2. **실행 시점**: 코드가 한 줄씩 평가되면서, `let x = 1`을 만나는 순간에야 바인딩이 초기화된다.

이 절차에서 익숙한 현상들이 전부 유도된다.

```js
// 실행 전에 이미 f, a, b가 환경 레코드에 등록되어 있다
console.log(f());   // 출력: "ok"      — 함수 선언: 값까지 있음
console.log(a);     // 출력: undefined — var: undefined로 초기화됨
console.log(b);     // ReferenceError: Cannot access 'b' before initialization
                    //                — let: 등록됐지만 미초기화

function f() { return "ok"; }
var a = 1;
let b = 2;
```

`b`의 에러 메시지를 보면 "b is not defined"가 아니라 "before initialization"이다. 엔진은 `b`가 이 스코프에 있다는 것을 **알고 있다**. 등록은 됐는데 초기화가 안 된 상태 — 스펙 용어로 바인딩이 uninitialized인 상태 — 에 접근한 것이다.

**TDZ(Temporal Dead Zone)도 스펙에 정의된 별도 장치가 아니다.** "미초기화 바인딩에 접근하면 ReferenceError"라는 일반 규칙이 있을 뿐이고, TDZ는 그 규칙이 만드는 시간 구간(스코프 진입 ~ 선언문 실행)에 붙은 별명이다. "Temporal(시간적)"이라는 이름이 붙은 이유는 이 구간이 코드의 위치가 아니라 **실행 시간**으로 정의되기 때문이다.

```js
function readLater() {
  return value; // 선언보다 위에 있는 코드지만 —
}
let value = 42;
console.log(readLater()); // 출력: 42 — 호출 시점에는 이미 초기화됐다
```

`var`가 대체된 이유도 이 절차로 설명된다. `undefined` 자동 초기화는 "선언 전 접근"이라는 논리 오류를 에러가 아니라 `undefined`라는 정상 값으로 둔갑시킨다. `let`/`const`의 미초기화 정책은 같은 오류를 즉시 ReferenceError로 드러낸다 — 편의를 줄이고 오류 검출을 얻은 트레이드오프다.

### 스코프 체인 — 어디서 정의했는가가 결정한다

함수 객체는 생성될 때 자신이 **정의된 위치의 환경 레코드**를 내부 슬롯 [[Environment]]에 저장한다. 나중에 그 함수가 호출되면, 새 Function ER이 만들어지고 그 [[OuterEnv]]가 저장해 둔 [[Environment]]로 설정된다. 즉 스코프 체인은 함수를 **어디서 호출했는가와 무관하게, 어디서 정의했는가**로 이미 확정되어 있다. 이것이 렉시컬(정적) 스코프다.

호출 위치가 체인에 영향을 주지 못한다는 것을 직접 확인한다.

```js
const label = "outer";

function report() {
  // 이 함수의 [[Environment]]는 전역 환경 — 정의 위치가 전역이므로
  console.log(label);
}

function caller() {
  const label = "caller"; // 호출자 스코프에 같은 이름이 있어도
  report();               // report의 체인은 전역으로 연결된다
}

caller(); // 출력: "outer"
```

만약 JS가 동적 스코프였다면 출력은 "caller"였을 것이다. 이 정적 연결은 다음 문서의 핵심 복선이기도 하다: 함수가 [[Environment]]로 환경 레코드를 붙잡고 있는 한, 그 환경은 함수 호출이 끝나도 사라질 수 없다. 스택 프레임과 달리 **환경 레코드는 힙에 살아남을 수 있다** — 이것이 클로저다([3-2](./02-closures-and-functions.md)).

### this — 스코프와 독립적인 동적 축

스코프 체인이 정의 위치로 확정되는 것과 정반대로, this는 **호출 형태(call-site)** 가 매 호출마다 결정한다. this는 식별자가 아니라 키워드이고, 스코프 체인 탐색이 아니라 Function ER에 저장된 [[ThisValue]]를 읽는다. 그 값은 함수를 호출하는 방식에 따라 네 규칙으로 결정된다.

**1. 기본 바인딩** — 아무 수식 없이 `f()`로 호출하면, non-strict에서는 전역 객체, strict mode에서는 `undefined`.

```js
function whoAmI() {
  "use strict";
  return this;
}
console.log(whoAmI()); // 출력: undefined
// strict가 아니면 globalThis — 전역 객체 오염 사고의 온상이라 strict가 막았다
```

**2. 암시적 바인딩** — `obj.f()` 형태로 호출하면 this는 `obj`. 결정하는 것은 함수가 어느 객체 "소속"인가가 아니라, **호출식에서 점(.) 왼쪽에 무엇이 있었는가**다.

```js
const counter = {
  count: 0,
  increment() {
    this.count += 1;
    return this.count;
  },
};

console.log(counter.increment()); // 출력: 1 — 점 왼쪽이 counter

const fn = counter.increment;     // 함수 값만 꺼냈다. 소속 정보는 없다
console.log(fn());                // TypeError (strict 모듈 기준):
                                  // this가 undefined라 this.count 접근 실패
```

`fn`은 `counter.increment`와 완전히 같은 함수 객체다. 잃어버린 것은 함수가 아니라 **호출 형태**다. Java라면 메서드 참조를 어디로 옮기든 인스턴스가 함께 따라가지만, JS의 함수는 소속이라는 개념 자체가 없다 — this는 호출할 때마다 새로 정해진다. 이벤트 핸들러로 메서드를 넘길 때(`button.addEventListener("click", counter.increment)`) 매번 만나게 될 현상이고, class 문법도 이것을 감추지 못한다([3-4](./04-object-model.md)).

**3. 명시적 바인딩** — `call`/`apply`는 첫 인자를 this로 지정해 즉시 호출하고, `bind`는 this가 영구 고정된 **새 함수**를 만든다.

```js
const fixed = counter.increment.bind(counter);
console.log(fixed());        // 출력: 2 — 어떻게 호출해도 this는 counter
console.log(fixed.call({})); // 출력: 3 — bind가 call보다 우선한다
```

**4. new 바인딩** — `new f()`는 새 객체를 만들어 this로 넘긴다. 우선순위는 new > bind > 암시적 > 기본이다.

정리하면 이 문서의 종착점은 이 표다. **두 축은 서로 독립이다.** 함수 하나를 놓고 "이 변수는 어디서 찾는가"는 정의 위치가(정적), "this는 무엇인가"는 호출 형태가(동적) 각각 따로 결정한다.

| 축 | 결정 요인 | 결정 시점 | 저장 위치 |
|----|----------|----------|----------|
| 스코프 체인 | 함수가 **정의된** 위치 | 함수 객체 생성 시 | [[Environment]] → [[OuterEnv]] 체인 |
| this | 함수가 **호출된** 형태 | 매 호출 시 | Function ER의 [[ThisValue]] |

화살표 함수는 이 표의 예외처럼 보이지만, 실제로는 두 번째 축을 **만들지 않아서** 첫 번째 축으로 통합한 것이다 — 상세는 [3-2](./02-closures-and-functions.md)에서 다룬다. class 내부의 this와 super는 [3-4](./04-object-model.md)에서 다룬다.

### 관찰 절차 — Sources 패널에서 환경 레코드 읽기

[0-2](../phase-0/02-frontend-toolchain.md)의 DevTools 표에서 예고한 내용이다. 위 모델은 전부 Sources 패널에서 눈으로 확인할 수 있다.

```html
<script>
  const globalMsg = "global";

  function outer() {
    const outerMsg = "outer";
    function inner() {
      const innerMsg = "inner";
      debugger; // 여기서 멈춘다
      console.log(globalMsg, outerMsg, innerMsg);
    }
    inner();
  }
  outer();
</script>
```

DevTools를 연 채 이 페이지를 로드하면 `debugger` 문에서 멈춘다. 오른쪽 패널에서:

- **Call Stack** — `inner → outer → (anonymous)` 순으로 실행 컨텍스트 스택이 그대로 보인다. 각 프레임을 클릭하면 그 컨텍스트 기준으로 Scope 창이 바뀐다.
- **Scope** — `Local`(inner의 Function ER: innerMsg), `Closure (outer)`(outer의 환경: outerMsg), `Script`/`Global` 순서로 나열된다. 이 목록이 곧 [[OuterEnv]] 체인이다. `let`/`const` 전역 선언이 Global이 아니라 `Script` 항목에 나타나는 것도 확인할 수 있다 — Global ER이 object ER + declarative ER의 합성이라는 앞 절의 서술을 DevTools가 그대로 보여주는 것이다.
- 중단점을 `let` 선언보다 앞줄에 걸면 Scope 창에서 해당 변수가 `<value unavailable>`로 표시된다 — 미초기화 바인딩(TDZ 구간)의 실물이다.

## 실무 관점

**"메서드를 넘겼는데 this가 undefined"는 프론트엔드에서 가장 흔한 this 사고다.** 콜백을 받는 모든 API — `addEventListener`, `setTimeout`, 배열 메서드, Promise 체인 — 는 함수 값만 받는다. 호출 형태는 API 내부가 정하므로 암시적 바인딩은 항상 끊긴다. 대응은 세 가지이고 트레이드오프가 갈린다.

| 방법 | 코드 | 비용/경계 조건 |
|------|------|---------------|
| `bind` | `el.addEventListener("click", obj.handle.bind(obj))` | 매번 새 함수가 생긴다 — `removeEventListener`로 **같은 리스너를 제거할 수 없다**(참조가 다르므로). 해제가 필요하면 bind 결과를 변수에 보관해야 한다 |
| 화살표 함수 래핑 | `el.addEventListener("click", () => obj.handle())` | 가장 명시적. 역시 해제하려면 참조 보관 필요 |
| this를 안 쓰는 설계 | 클로저로 상태 은닉([3-2](./02-closures-and-functions.md)) | this 문제 자체가 사라진다. 함수형 스타일 코드베이스의 실제 근거 |

**`var`를 만나면 "왜 대체되었는가"로 읽는다.** 레거시 코드의 `var`는 (1) 블록 무시 — VariableEnvironment에 등록되므로 `if`/`for` 블록을 뚫고 함수 전체에 존재하고, (2) undefined 초기화 — 선언 전 접근이 에러가 아니며, (3) 전역에서 전역 객체 프로퍼티가 된다. 세 가지 모두 오류를 숨기는 방향이라 `let`/`const`가 반대로 설계됐다. 루프 + 클로저 조합에서 생기는 유명한 `var` 함정은 [3-2](./02-closures-and-functions.md)에서 per-iteration environment로 설명한다.

**strict mode는 선택이 아니라 기본 환경이 되었다.** ES 모듈([3-9](./09-modules.md))과 class 본문은 자동으로 strict다. 실무 코드는 사실상 전부 모듈이므로 "기본 바인딩 = 전역 객체"라는 옛 규칙은 이제 non-strict 스크립트에서만 만난다. 다만 콘솔에서 붙여 넣어 실험할 때는 non-strict라서 결과가 달라질 수 있다 — 실행 환경이 곧 의미론의 일부라는 점을 기억한다.

**전역을 참조할 일이 있으면 `globalThis`를 쓴다.** `window`(브라우저 메인 스레드), `self`(워커), `global`(Node)로 갈라져 있던 전역 객체 접근을 ES2020이 통일했다. 라이브러리처럼 여러 런타임을 겨냥하는 코드에서 환경 감지 코드를 제거해 준다.

## 더 깊이

**this 결정의 스펙 경로.** `obj.f()`라는 호출식에서 `obj.f` 평가 결과는 함수 값이 아니라 **Reference Record**다 — base(obj)와 프로퍼티 이름(f)을 함께 담은 스펙 내부 구조. 호출 평가(§13.3.6)는 이 Reference Record에서 base를 꺼내 this로 넘긴다. `const fn = obj.f`처럼 값을 변수에 담는 순간 Reference Record는 값으로 풀리고(GetValue) base 정보가 소거된다 — "메서드 추출이 this를 잃는" 현상의 스펙상 정확한 지점이다. 흥미로운 경계 사례로 `(obj.f)()`는 괄호가 Reference Record를 유지하므로 this가 살지만, `(0, obj.f)()`는 콤마 연산자가 GetValue를 수행하므로 this가 끊긴다 — 번들러가 간접 호출을 만들 때 실제로 쓰는 패턴이다.

**환경 레코드는 명세상의 추상이고, V8의 실제 표현은 다르다.** V8은 탈출하지 않는 변수를 스택 슬롯이나 레지스터에 두고, 내부 함수가 참조하는 변수만 힙의 Context 객체로 옮긴다(구현 세부 — 표준은 "어디에 저장하는가"를 규정하지 않는다). 어떤 변수가 힙으로 가는가, 그것이 메모리에 어떤 영향을 주는가는 [3-2](./02-closures-and-functions.md)의 V8 절에서 관찰 방법과 함께 다룬다.

**함수 선언의 블록 스코핑은 역사적 타협 지점이다.** ES2015부터 블록 안 함수 선언은 스펙상 블록 스코프지만, 웹 호환성을 위해 Annex B(§B.3.2)가 non-strict 코드에서 `var`처럼 함수 스코프로도 보이게 하는 절충 의미론을 추가로 정의한다. 같은 코드가 strict/non-strict에서 다르게 동작하는 지점이므로, 블록 안 함수 선언 자체를 피하고 함수 표현식을 쓰는 것이 안전한 컨벤션이다.

## 정리

- 실행 컨텍스트는 코드 실행 단위마다 만들어져 스택에 쌓이고, 식별자 바인딩의 실제 저장소는 환경 레코드다. 전역은 object ER + declarative ER의 합성이라 `var`만 전역 객체에 나타난다.
- "호이스팅"의 실체는 컨텍스트 생성 시 선언 스캔·등록이다. `var`는 undefined로 초기화되고 `let`/`const`는 미초기화로 남는다 — TDZ는 별도 장치가 아니라 "미초기화 바인딩 접근 = ReferenceError"라는 일반 규칙의 시간 구간이다.
- 스코프 체인은 함수의 [[Environment]] → [[OuterEnv]] 연결이며, 정의 위치가 확정한다. 호출 위치는 영향을 주지 못한다.
- this는 반대로 호출 형태가 매번 결정한다: 기본(strict에선 undefined) < 암시적(점 왼쪽) < 명시적(call/apply/bind) < new. 메서드 추출이 this를 잃는 것은 호출 형태 정보의 소거다.
- 스코프(정적)와 this(동적)는 독립적인 두 축이고, Sources 패널의 Call Stack·Scope 창에서 두 축 모두 직접 관찰할 수 있다.

## 확인 문제

**Q1.** 다음 코드의 출력과 그 근거를 실행 컨텍스트 생성 절차로 설명하라.

```js
function run() {
  console.log(typeof readConfig); // (1)
  console.log(typeof settings);   // (2)
  console.log(typeof mode);       // (3)

  function readConfig() {}
  var settings = {};
  let mode = "dark";
}
run();
```

<details>
<summary>정답과 해설</summary>

(1) `"function"`, (2) `"undefined"`, (3) **ReferenceError**.

`run`의 컨텍스트 생성 시점에 세 선언이 모두 환경 레코드에 등록되지만 처리 방식이 다르다. 함수 선언 `readConfig`는 함수 객체까지 할당되고, `var settings`는 undefined로 초기화되며, `let mode`는 미초기화로 등록만 된다. `typeof`는 미선언 식별자에는 에러 없이 "undefined"를 주지만, **등록은 됐으나 미초기화인 바인딩**에는 일반 접근 규칙이 적용되어 ReferenceError를 던진다. `typeof`가 TDZ의 방패가 되지 못한다는 점이 함정이다.
</details>

**Q2.** 다음 코드에서 두 호출의 출력이 다른 이유를 Reference Record(또는 호출 형태) 관점에서 설명하라. 그리고 `logger.log`를 `setTimeout`에 안전하게 넘기는 방법을 두 가지 제시하라.

```js
"use strict";
const logger = {
  prefix: "[app]",
  log(msg) { console.log(this.prefix, msg); },
};

logger.log("직접 호출");        // 출력: [app] 직접 호출
setTimeout(logger.log, 0, "콜백"); // TypeError: Cannot read properties of undefined
```

<details>
<summary>정답과 해설</summary>

`logger.log("...")`는 호출식의 점 왼쪽(base)이 logger이므로 암시적 바인딩으로 this = logger다. 반면 `setTimeout(logger.log, ...)`는 인자 평가 시점에 Reference Record가 값으로 풀려 함수 객체만 전달된다. setTimeout 내부는 그 함수를 아무 수식 없이 호출하므로 기본 바인딩이 적용되고, strict 함수라 this = undefined, `undefined.prefix` 접근에서 TypeError가 난다.

안전한 전달: ① `setTimeout(logger.log.bind(logger), 0, "콜백")` — this를 영구 고정한 새 함수. ② `setTimeout((msg) => logger.log(msg), 0, "콜백")` — 호출 형태(`logger.log(...)`)를 코드에 보존하는 래핑.
</details>

**Q3.** 팀 동료가 "let도 호이스팅되니까 결국 var와 같은 것 아니냐"고 묻는다. 아래 코드의 (A), (B) 결과를 근거로, '끌어올림' 모델 대신 등록/초기화 분리 모델로 답하라.

```js
let shadow = "outer";
{
  console.log(shadow); // (A)
  let shadow = "inner"; // (B) 이 선언이 없다면 (A)의 결과는?
}
```

<details>
<summary>정답과 해설</summary>

(A)는 **ReferenceError**다. 블록 진입 시 declarative ER이 만들어지고, 블록 내 `let shadow` 선언이 그 환경에 **등록**된다(미초기화). (A) 시점의 식별자 해석은 현재 환경에서 shadow를 찾아내므로 바깥 "outer"까지 올라가지 않고, 미초기화 바인딩 접근으로 에러가 난다. (B)의 선언을 지우면 블록 환경에 shadow가 등록되지 않아 [[OuterEnv]] 체인을 타고 "outer"가 출력된다.

이 사례가 보여주는 것: `let`의 등록은 실행 전에 일어난다는 점에서 "호이스팅"이라 부를 수 있지만, var와 달리 **초기화가 분리**되어 있어 선언 전 접근이 에러가 된다. 심지어 바깥에 같은 이름이 있어도 가려진다 — 끌어올림 모델로는 설명이 안 되고, 등록/초기화 2단계 모델로는 자연스럽게 유도된다.
</details>

## 참고 자료

- [ECMA-262 — Executable Code and Execution Contexts (§9)](https://tc39.es/ecma262/#sec-executable-code-and-execution-contexts) — 환경 레코드 5종과 실행 컨텍스트 구성 요소의 원 정의.
- [ECMA-262 — FunctionDeclarationInstantiation (§10.2.11)](https://tc39.es/ecma262/#sec-functiondeclarationinstantiation) — "호이스팅"의 실체인 선언 인스턴스화 절차 그 자체.
- [ECMA-262 — The Reference Record Specification Type (§6.2.5)](https://tc39.es/ecma262/#sec-reference-record-specification-type) — 메서드 호출에서 this가 결정되는 스펙 경로.
- [MDN — globalThis](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis) — 런타임별 전역 객체 접근의 통일.
- [Chrome DevTools — Debug JavaScript](https://developer.chrome.com/docs/devtools/javascript/) — Sources 패널 중단점·Call Stack·Scope 창 사용법 공식 가이드.
