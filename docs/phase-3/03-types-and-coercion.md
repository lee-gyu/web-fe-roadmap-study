# 3-3. 타입과 강제 변환 — 추상 연산이라는 알고리즘

> 한 줄 요약: `[] + {}`류의 "이상한" 결과를 ToPrimitive·ToNumber·ToString 몇 개의 추상 연산 조합으로 기계적으로 도출할 수 있고, `===` 컨벤션과 명시적 변환이 취향이 아니라 판정 규칙의 비대칭성에서 나온 방어임을 설명할 수 있다.

## 학습 목표

- 타입이 변수가 아니라 값에 붙는다는 동적 타이핑 모델과 원시 7종 + 객체의 타입 구조를 설명할 수 있다.
- 모든 암묵 변환을 ToPrimitive/ToNumber/ToString/ToBoolean 추상 연산의 조합으로 분해해 결과를 예측할 수 있다.
- `==`(IsLooselyEqual)의 실제 판정 규칙을 근거로, `===` 강제 컨벤션의 실질적 이유를 말할 수 있다.
- NaN·-0·BigInt 혼합 연산 금지 같은 경계 사례를 스펙과 IEEE 754 근거로 설명할 수 있다.
- `??`와 `||`의 판정 기준 차이를 알고 falsy 함정(0, 빈 문자열)이 있는 코드를 진단할 수 있다.

## 배경: 왜 이것이 존재하는가

`[] + {}`가 `"[object Object]"`이고 `{} + []`가 (콘솔에서) `0`이라는 사실은 JS를 조롱하는 밈의 단골 소재다. 하지만 스펙을 열어 보면 이 결과들은 임의가 아니라 **몇 개의 알고리즘이 기계적으로 돌아간 출력**이다. ECMA-262는 언어의 모든 암묵 변환을 추상 연산(abstract operation)이라는 의사코드 함수로 정의하고, 모든 연산자는 피연산자를 이 함수들에 통과시킨다. 알고리즘이 몇 개 안 되므로, 규칙을 알면 어떤 괴상한 조합도 손으로 도출할 수 있다.

경력자에게 이 문서의 대비점은 해석 시점이다. Java/C#에서 `a + b`가 문자열 연결인지 산술인지는 **컴파일 타임**에 타입으로 확정되고, 런타임에는 이미 결정된 명령이 실행될 뿐이다. JS는 타입이 값에 붙어 있으므로 **매 연산마다 런타임에** "피연산자가 무엇인가 → 어떻게 변환할 것인가"의 판정이 돈다. 이 차이가 실무 컨벤션의 실제 근거다: `===`를 강제하고 명시적 변환(`Number(x)`, `String(x)`)을 요구하는 린트 규칙은 스타일 취향이 아니라, 런타임 판정 규칙이 비대칭적이고 추론 비용이 크다는 사실에 대한 방어다.

이 문서가 다루는 것은 판정 규칙 그 자체까지다. 규칙을 정적으로 검사해 판정을 컴파일 타임으로 되돌리려는 시도가 TypeScript이고, 그것은 Phase 4 전체에서 다룬다. 부동소수점 일반론(0.1 + 0.2 문제)은 경력자 전제이므로 한 문장으로 지나간다: JS의 Number는 IEEE 754 배정밀도이고, 이진 부동소수점의 정밀도 문제는 다른 언어의 double과 동일하다.

## 핵심 개념

### 타입은 값에 붙는다 — 원시 7종 + 객체

JS의 타입은 8가지다: 원시(primitive) 7종 — undefined, null, Boolean, Number, BigInt, String, Symbol — 과 Object. **타입은 변수가 아니라 값의 속성**이다. `let x`의 x에는 타입이 없고, 담긴 값이 타입을 갖는다. 정적 언어에서 "변수의 타입이 담길 값을 제약"하는 것과 방향이 반대다.

원시 값은 불변(immutable)이다. `"abc".toUpperCase()`가 가능한 것은 문자열이 객체라서가 아니라, 프로퍼티 접근 순간 임시 래퍼 객체가 만들어지는 것이다(스펙 용어로 ToObject). 이 래퍼는 표현식이 끝나면 버려지므로 원시 값에 프로퍼티를 붙이려는 시도는 조용히 증발한다.

런타임 타입 검사의 1차 도구인 `typeof`에는 유명한 함정 둘이 있다.

```js
typeof null;        // 출력: "object" — 초기 구현의 태그 표현이 굳어진 역사적 버그.
                    // 고치려는 시도(ES5.1 시기)가 있었으나 웹 호환성 때문에 영구 표준화됐다
typeof function(){}; // 출력: "function" — 스펙상 함수도 Object지만
                    // [[Call]]을 가진 객체는 typeof가 별도로 구분해 준다
```

null 검사는 `x === null`로, "객체인가"는 `typeof x === "object" && x !== null`로 쓴다.

### 추상 연산 — 변환의 전체 어휘는 네 개다

스펙의 모든 암묵 변환은 다음 네 추상 연산의 조합이다. 이 절이 문서의 뼈대다.

**ToBoolean** — 가장 단순하다. 변환이 아니라 **falsy 목록 조회**다: `false`, `0`, `-0`, `0n`, `""`, `null`, `undefined`, `NaN`의 8개만 false이고 나머지 전부(빈 배열, 빈 객체 포함) true다. 알고리즘이 없고 표만 있으므로 다른 변환과 조합되지 않는다.

**ToNumber** — 문자열은 숫자 리터럴 문법으로 파싱하고(`""`와 공백만 있는 문자열은 **0**, 파싱 실패는 NaN), `null`은 0, `undefined`는 **NaN**, `true`/`false`는 1/0. 객체는 먼저 ToPrimitive(hint: number)를 거친다.

**ToString** — 원시는 예상대로 문자열화되고(`null` → `"null"`), 객체는 먼저 ToPrimitive(hint: string)를 거친다.

**ToPrimitive** — 객체를 원시로 낮추는 관문이며, 객체가 연산에 참여하는 모든 곳에서 호출된다. 절차는:

1. 객체에 `Symbol.toPrimitive` 메서드가 있으면 그것을 hint(`"number"`/`"string"`/`"default"`)와 함께 호출하고 끝.
2. 없으면 hint에 따라 순서가 정해진다 — number/default면 `valueOf()` → `toString()`, string이면 `toString()` → `valueOf()`. 먼저 원시를 반환하는 쪽이 채택된다.

일반 객체의 `valueOf()`는 자기 자신(객체)을 반환하므로 건너뛰어지고, 결국 `toString()`이 채택된다 — 평범한 객체가 연산에 들어가면 거의 항상 `"[object Object]"`가 되는 이유다. 배열의 `toString()`은 `join(",")`이다.

이제 밈의 사례를 손으로 도출한다. `+`의 판정 규칙(§13.15.3)은 "양쪽을 ToPrimitive(hint: default)로 낮춘 뒤, **어느 한쪽이 String이면 문자열 연결**, 아니면 산술"이다.

```js
[] + {};
// [] → ToPrimitive → valueOf는 배열 자신 → toString → "" (빈 join)
// {} → ToPrimitive → valueOf는 객체 자신 → toString → "[object Object]"
// 한쪽이 문자열 → 연결
// 출력: "[object Object]"

1 + "2";   // 출력: "12" — 문자열 우선 규칙
1 + null;  // 출력: 1  — 양쪽 다 문자열 아님 → ToNumber(null)=0 → 산술
1 + undefined; // 출력: NaN — ToNumber(undefined)=NaN
[] + [];   // 출력: "" — "" + ""
```

유명한 `{} + []`가 0이 되는 것은 변환 규칙이 아니라 **파싱** 문제다. 문 위치의 `{}`는 객체 리터럴이 아니라 빈 블록으로 파싱되고, 남는 `+[]`는 단항 플러스(=ToNumber) 적용이라 `ToNumber("") = 0`이다. 콘솔이 아닌 표현식 위치(`({} + [])`)에서는 `"[object Object]"`다.

관계 연산자(`<`, `>` 등)는 `+`와 달리 hint: number로 ToPrimitive를 적용하고, **양쪽 다 문자열일 때만** 사전순 비교를 한다. `"10" < "9"`가 true(문자열 비교)인데 `"10" < 9`는 false(숫자 비교)인 비대칭이 여기서 나온다.

`Symbol.toPrimitive`는 이 관문을 직접 제어하는 표준 훅이다.

```js
const duration = {
  minutes: 90,
  [Symbol.toPrimitive](hint) {
    if (hint === "number") return this.minutes;
    return `${this.minutes}분`;
  },
};
console.log(duration * 2);      // 출력: 180 — hint: "number"
console.log(`${duration}`);     // 출력: "90분" — 템플릿 리터럴은 hint: "string"
console.log(duration + "");     // 출력: "90"  — +는 hint: "default" → number 절로
```

### `==`의 실제 규칙 — IsLooselyEqual

"느슨한 비교는 무조건 나쁘다"는 컨벤션의 결론만 외운 것이다. 실제 알고리즘(§7.2.14 IsLooselyEqual)을 보면 왜 그런 컨벤션이 생겼는지가 드러난다.

| 좌 \ 우 조합 | 판정 |
|------|------|
| 같은 타입 | `===`와 동일 (IsStrictlyEqual로 위임) |
| null ↔ undefined | **무조건 true** (다른 어떤 값과도 false) |
| Number ↔ String | 문자열을 ToNumber 후 재비교 |
| Boolean ↔ 아무것 | 불리언을 ToNumber(1/0) 후 재비교 |
| 객체 ↔ Number/String/Symbol | 객체를 ToPrimitive 후 재비교 |
| 그 외 (예: null ↔ 0) | false |

이 표에서 두 가지가 읽힌다.

첫째, **규칙 자체는 결정적이지만 방향이 비직관적이다.** 불리언이 끼면 상대를 불리언화하는 게 아니라 **불리언을 숫자로** 낮춘다. 그래서:

```js
"0" == false;  // true  — false→0, "0"→0
"" == false;   // true  — false→0, ""→0
"0" == "";     // false — 같은 타입(문자열)이라 그대로 비교!
```

`a == b`, `b == c`가 참인데 `a == c`가 거짓 — 추이성(transitivity)이 없다. 판정마다 표를 다시 타야 하고, 이것이 "추론 비용이 크다"의 실체다.

둘째, **유일하게 유용한 특례가 null ↔ undefined다.** `x == null`은 정확히 "x가 null 또는 undefined"이며 다른 어떤 것도 통과시키지 않는다. `===` 강제 린트 규칙(eqeqeq)이 `null` 비교만 예외로 허용하는 옵션(`"smart"`)을 두는 이유다. 이 한 가지를 제외하면 `==`가 `===`보다 나은 경우는 없고, 컨벤션은 "표를 매번 소환하는 비용 vs 특례 하나를 포기하는 비용"의 합리적 선택이다.

동등성의 세 번째 축으로 `Object.is`가 있다. `===`와의 차이는 정확히 두 지점이다.

```js
NaN === NaN;          // false — IEEE 754의 규정
Object.is(NaN, NaN);  // true

0 === -0;             // true  — ===는 부호 0을 구분하지 않는다
Object.is(0, -0);     // false
```

`Object.is`는 "같은 값인가(SameValue)"의 수학적 정의에 가깝고, `===`는 IEEE 754 의미론을 따른다. 실무에서 `Object.is`를 직접 쓸 일은 드물지만, React가 상태 변경 감지에 이것을 쓴다는 사실(Phase 5-3)이 이 구분을 실무 지식으로 만든다.

### 경계 사례 — 스펙과 IEEE 754로 설명하기

**NaN은 자기 자신과 같지 않다.** JS의 발명이 아니라 IEEE 754의 규정이다 — NaN은 "실패한 연산의 결과"라는 표지이고, 서로 다른 실패가 같은 값일 이유가 없다는 설계다. 이 성질 때문에 NaN 검사는 전용 함수가 필요한데, 두 함수의 차이가 함정이다.

```js
isNaN("abc");        // true  — 전역 isNaN은 인자를 ToNumber로 변환부터 한다!
Number.isNaN("abc"); // false — 변환 없이 "값이 NaN인가"만 판정
Number.isNaN(NaN);   // true
```

전역 `isNaN`은 "ToNumber 결과가 NaN인가"라서 문자열·undefined에도 true를 준다. ES2015가 `Number.isNaN`을 추가한 것은 이 변환을 제거한 교정이다. 같은 이유로 `parseInt`/`parseFloat`(문자열 앞부분만 관대하게 파싱)와 `Number()`(전체가 유효해야 함)도 구분한다.

**-0은 존재하고, 보이지 않을 뿐이다.** IEEE 754에는 부호 있는 0이 있고 JS도 그대로 갖는다. `String(-0)`이 `"0"`이라 관찰이 어려울 뿐이다. 관찰 방법: `Object.is(x, -0)` 또는 `1 / x === -Infinity`. 실무에서 만나는 곳은 `Math.round(-0.4)`(= -0), 정렬 비교 함수의 반환값 등 — 대부분 무해하지만, 값을 키로 쓰는 자료구조(Map은 -0과 0을 같은 키로 취급하도록 SameValueZero를 쓴다)의 판정 기준이 왜 세 번째 알고리즘인지를 설명해 준다.

**BigInt와 Number는 섞어 연산할 수 없다.** `1n + 1`은 TypeError다. 이것은 제약이 아니라 설계다 — BigInt는 임의 정밀도, Number는 53비트 정수 한계(`Number.MAX_SAFE_INTEGER`)를 가지므로, 암묵 변환을 허용하면 **어느 방향이든 정밀도 손실이 조용히 일어날 수 있다**. 언어가 이례적으로 암묵 변환을 거부한 지점이라는 사실 자체가, 나머지 암묵 변환들이 얼마나 손실에 관대한지를 보여주는 대조군이다. 비교 연산(`1n < 2`)은 정밀도 손실이 없으므로 허용된다.

### truthy/falsy 실무 — `||` vs `??`

ToBoolean의 falsy 목록이 조건문을 넘어 **기본값 패턴**에 관여하면서 함정이 된다. `||`는 좌항을 ToBoolean으로 판정하므로, "값이 없으면"이 아니라 "값이 falsy면" 우항으로 넘어간다.

```js
function render(options) {
  // ❌ 0과 ""가 유효한 입력인데 기본값으로 덮인다
  const width = options.width || 100;   // options.width가 0이면 → 100
  const label = options.label || "제목"; // ""이면 → "제목"

  // ✅ ??는 null/undefined만 통과시킨다 (== null과 같은 판정)
  const width2 = options.width ?? 100;  // 0이면 → 0
  const label2 = options.label ?? "제목"; // ""이면 → ""
}
```

`??`(nullish coalescing, ES2020)의 판정 기준은 ToBoolean이 아니라 "null 또는 undefined인가"다. **"없음"을 표현하는 값이 null/undefined라면 `??`, 정말로 falsy 전체를 걸러야 한다면 `||`** — 의도를 연산자로 구분해서 쓴다. 숫자·문자열 입력을 다루는 코드에서 `||` 기본값은 거의 항상 버그다(0원, 빈 검색어, 체크 해제가 전부 "없음"으로 취급된다).

같은 판정 기준의 짝으로 옵셔널 체이닝 `?.`이 있다 — `a?.b`는 a가 null/undefined일 때만 단락하고 undefined를 준다. falsy 전체가 아니라는 점이 `&&` 체인(`a && a.b`)과의 차이다.

## 실무 관점

**명시적 변환을 표준 관용구로 통일한다.** 같은 변환에 여러 표기가 있고 팀마다 갈리는 지점이다.

| 목적 | 권장 | 대안 표기와 차이 |
|------|------|----------------|
| → Number | `Number(x)` | `+x`는 동일 의미지만 검색·가독성이 나쁘다. `parseInt(x, 10)`은 "앞부분 파싱"이라는 다른 의미 |
| → String | `String(x)` | `` `${x}` ``도 동일(둘 다 ToString). `x.toString()`은 null/undefined에서 TypeError |
| → Boolean | `Boolean(x)` | `!!x`는 동일 의미의 관용구 — 팀 컨벤션으로 하나만 |

경계 조건: `Number("")`가 0이라는 사실 때문에, 폼 입력처럼 빈 문자열이 가능한 소스는 `Number()` 전에 빈 값 검사가 먼저다. "입력이 비었다"와 "입력이 0이다"가 같은 값이 되면 위의 `??`로도 구분할 수 없다.

**JSON 직렬화는 ToString이 아니다.** `JSON.stringify`는 자체 규칙을 따른다 — undefined·함수·Symbol 값은 객체에서 **키째 사라지고**, 배열에서는 null이 되며, `toJSON()` 메서드가 있으면 그것이 우선한다(Date가 ISO 문자열이 되는 이유). "객체를 문자열로 만든다"는 점이 같아서 ToPrimitive와 혼동하기 쉽지만 완전히 별개의 경로다.

**암묵 변환을 전부 죄악시할 필요는 없다.** 조건문의 ToBoolean(`if (list.length)`), 템플릿 리터럴의 ToString은 관용구로 정착했고 오독 위험이 낮다. 방어해야 하는 것은 **비교와 산술에서의 암묵 변환**이다 — 판정 표가 비대칭적인 곳(`==`, 관계 연산자, `+`). 린트로 강제할 수 있는 것(eqeqeq)은 린트로 강제하고, 나머지는 명시적 변환 함수를 통일한다. 이 규칙 전체를 컴파일 타임 검사로 옮기는 것이 Phase 4의 TypeScript다.

## 더 깊이

**스펙 읽는 법 자체가 이 문서의 도구다.** tc39.es/ecma262에서 추상 연산은 파란 링크로 상호 참조된다. 예컨대 Addition의 평가 절차(§13.15.3 ApplyStringOrNumericBinaryOperator)를 열면 ToPrimitive → (String 검사) → ToNumeric의 호출 순서가 의사코드로 그대로 있다. "이 연산자는 어떻게 변환하더라?"를 블로그가 아니라 스펙 원문에서 30초 안에 확인하는 습관이 이 Phase가 목표하는 작업 방식이다.

**추상 연산은 왜 "추상"인가.** ToNumber는 실제 함수가 아니라 명세 서술 장치다 — 엔진이 그 이름의 함수를 구현할 의무는 없고, 관찰 가능한 결과만 일치하면 된다. V8은 자주 실행되는 코드에서 타입 피드백을 수집해, "이 덧셈은 늘 Number끼리였다"면 판정 절차를 건너뛰는 기계어를 생성한다(인라인 캐시 — 구현 세부). 같은 함수에 갑자기 다른 타입을 섞어 넣으면 이 최적화가 무효화(deopt)되는데, 이는 **단형(monomorphic) 코드가 빠르다**는 실무 조언의 근거다. 관찰하려면 Node에서 `node --trace-deopt`로 디옵트 로그를 볼 수 있다(버전에 따라 출력이 다르며, 표준이 보장하는 동작이 아니다).

**동등성 알고리즘은 정확히 넷이다.** IsLooselyEqual(`==`), IsStrictlyEqual(`===`), SameValue(`Object.is`), SameValueZero(NaN은 같고 ±0도 같음). 네 번째가 숨은 실세다 — `Array.prototype.includes`, Map/Set의 키 비교가 SameValueZero를 쓴다. `[NaN].indexOf(NaN)`은 -1(IsStrictlyEqual)이지만 `[NaN].includes(NaN)`은 true인 비대칭이 여기서 나온다.

## 정리

- 타입은 변수가 아니라 값에 붙고, 판정은 매 연산마다 런타임에 돈다 — 정적 언어에서 컴파일 타임에 끝나던 일이 실행 비용과 추론 비용으로 옮겨온 구조다.
- 모든 암묵 변환은 ToPrimitive(hint + valueOf/toString 순서)·ToNumber·ToString·ToBoolean 네 추상 연산의 조합이며, `[] + {}`류의 결과는 전부 손으로 도출 가능하다.
- `==`는 비결정적이 아니라 **비대칭적**이다(불리언을 숫자로 낮추는 방향, 추이성 부재). `===` 컨벤션은 취향이 아니라 이 판정 표의 암기 비용에 대한 방어이고, 유일한 합리적 예외가 `x == null`이다.
- NaN 자기 비동등은 IEEE 754 유래이고(`Number.isNaN`으로 검사), -0은 존재하며(`Object.is`로 관찰), BigInt·Number 혼합 금지는 정밀도 손실을 언어가 거부한 예외적 설계다.
- `||`는 falsy 전체를, `??`는 null/undefined만 걸러낸다 — 0과 빈 문자열이 유효한 도메인에서 `||` 기본값은 버그다.

## 확인 문제

**Q1.** 다음 각 표현식의 결과를 추상 연산의 호출 순서로 도출하라.

```js
[10] + 1;      // (1)
[10] - 1;      // (2)
[] == false;   // (3)
[null] == "";  // (4)
```

<details>
<summary>정답과 해설</summary>

(1) `"101"` — `+`는 양쪽을 ToPrimitive(default)로 낮춘다: `[10]` → valueOf는 객체 → toString → `"10"`. 한쪽이 문자열이므로 연결 경로로 가고, `1`이 ToString되어 `"10" + "1" = "101"`.

(2) `9` — `-`에는 문자열 규칙이 없다. 양쪽 다 ToNumber: `[10]` → ToPrimitive → `"10"` → 10. `10 - 1 = 9`. `+`와 `-`의 비대칭이 핵심이다.

(3) `true` — IsLooselyEqual에서 불리언은 먼저 숫자로: `false → 0`. `[] == 0` → 객체는 ToPrimitive: `[] → ""`. `"" == 0` → 문자열을 ToNumber: `0 == 0` → true.

(4) `true` — `[null]` → ToPrimitive → join인데, **join은 null/undefined를 빈 문자열로 취급**하므로 `""`. `"" == ""` → 같은 타입, true. 배열 toString의 세부 규칙까지 필요한 사례다.
</details>

**Q2.** 다음 함수는 "수량 미입력 시 1개"를 의도했지만 QA에서 "0개 주문이 1개로 접수된다"는 버그가 보고됐다. 원인을 판정 규칙으로 설명하고 수정하라. 수정 후에도 남는 문제(폼 입력이 문자열이라는 점)까지 지적하라.

```js
function normalizeQuantity(input) {
  return input || 1;
}
```

<details>
<summary>정답과 해설</summary>

`||`는 좌항을 ToBoolean으로 판정하므로 `0`은 falsy → 1로 덮인다. "미입력"(undefined/null)과 "0 입력"이 같은 분기로 합쳐진 것이 원인이다. 1차 수정은 `input ?? 1` — null/undefined만 기본값으로 보낸다.

남는 문제: 폼 입력은 문자열이므로 실제 값은 `"0"`(truthy!)일 가능성이 높고, 그 경우 원래 코드도 `??` 코드도 문자열 `"0"`을 그대로 반환해 이후 산술에서 암묵 변환에 의존하게 된다. 올바른 처리는 경계에서 명시 변환 + 유효성 검사다: `const n = Number(input); return Number.isInteger(n) && n >= 0 ? n : 1;` — 단 `Number("")`가 0이므로 "미입력 = 빈 문자열"인 소스라면 빈 값 검사를 변환보다 먼저 둬야 한다.
</details>

**Q3.** 동료가 "NaN 필터링이 안 된다"며 다음 코드를 가져왔다. 각 줄의 결과와 원인 알고리즘을 답하고, 올바른 코드를 제시하라.

```js
const values = [1, NaN, 2];
values.indexOf(NaN);   // (1)
values.includes(NaN);  // (2)
values.filter((v) => v !== NaN); // (3) — 왜 아무것도 안 걸러지는가?
```

<details>
<summary>정답과 해설</summary>

(1) `-1` — indexOf는 IsStrictlyEqual(`===`)을 쓰고, `NaN === NaN`은 IEEE 754 규정상 false이므로 영원히 못 찾는다.

(2) `true` — includes는 SameValueZero를 쓰며, 이 알고리즘은 NaN을 자기 자신과 같다고 판정한다. 같은 배열에 대한 두 메서드의 결과가 갈리는 것은 동등성 알고리즘이 다르기 때문이다.

(3) `v !== NaN`은 모든 v에 대해 true다(NaN 자신도 `NaN !== NaN`이 true). 올바른 필터는 `values.filter((v) => !Number.isNaN(v))`. 전역 `isNaN`을 쓰면 배열에 문자열이 섞였을 때 ToNumber 변환 때문에 오탐이 나므로 `Number.isNaN`이어야 한다.
</details>

## 참고 자료

- [ECMA-262 — Type Conversion (§7.1)](https://tc39.es/ecma262/#sec-type-conversion) — ToPrimitive/ToNumber/ToString/ToBoolean의 원문 알고리즘. 이 문서의 모든 도출의 근거.
- [ECMA-262 — IsLooselyEqual (§7.2.14)](https://tc39.es/ecma262/#sec-islooselyequal) — `==`의 판정 표 원문. 본문 표와 대조하며 읽기.
- [ECMA-262 — Addition Operator (§13.15)](https://tc39.es/ecma262/#sec-addition-operator-plus) — `+`의 문자열 우선 규칙이 명시된 위치. 스펙 읽기 연습의 좋은 출발점.
- [MDN — Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness) — 4가지 동등성 알고리즘의 비교표.
- [IEEE 754 — Wikipedia](https://en.wikipedia.org/wiki/IEEE_754) — NaN 비동등·부호 0의 출처 확인용. JS 고유가 아니라 표준 부동소수점 의미론임을 확인한다.
