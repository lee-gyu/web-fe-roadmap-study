# 4-2. 타입 설계

> 한 줄 요약: 유니언과 리터럴 타입으로 "불가능한 상태를 표현 불가능하게" 만드는 설계를 구사하고, interface/type/enum의 선택을 근거를 갖고 판단할 수 있다.

이 문서는 TypeScript 5.9 기준이다. [4-1](./01-type-system-foundations.md)의 할당 가능성·좁히기·리터럴 타입·never를 전제한다.

## 학습 목표

- interface와 type의 실질적 차이(선언 병합, 판정·표시 방식)를 설명하고 팀 컨벤션의 근거를 세울 수 있다.
- 판별 유니언(discriminated union)으로 상태를 모델링하고, 좁히기가 자동화되는 메커니즘을 설명할 수 있다.
- never를 이용한 철저성 검사(exhaustiveness check)로 "variant 추가가 컴파일 에러를 낳는" 구조를 만들 수 있다.
- enum의 문제를 타입 소거 원칙과 할당 규칙으로 설명하고, `as const` 객체·리터럴 유니언 중 대안을 선택할 수 있다.
- 구조적 타이핑이 뚫리는 지점을 브랜드 타입으로 막을지 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

타입 시스템의 소극적 용도는 오타와 타입 불일치를 잡는 것이다. 적극적 용도는 **도메인의 제약을 타입으로 표현해서, 잘못된 상태가 컴파일조차 되지 않게 만드는 것**이다. 함수형 커뮤니티의 표어로는 "불가능한 상태를 표현 불가능하게(make illegal states unrepresentable)"라고 부른다.

전형적인 반례부터 본다. Phase 3 과제 B에서 만든 검색 앱의 상태를 클래스 필드 감각으로 직역하면 이렇게 된다.

```ts
// ❌ boolean 플래그의 조합 — 표현 가능한 상태 2⁴ = 16가지, 유효한 상태는 4가지
interface SearchState {
  isLoading: boolean;
  data: Result[] | null;
  error: Error | null;
  isEmpty: boolean;
}
```

`isLoading: true`이면서 `error`가 있는 상태는 무엇인가? `data`와 `error`가 둘 다 있으면? 이 12가지 무의미한 조합은 타입상 전부 합법이므로, 방어는 런타임 코드(if 문과 관례)의 몫이 되고 언젠가 뚫린다. 렌더 함수는 "isLoading을 먼저 확인하고, 그다음 error를 확인하고…"라는 암묵적 우선순위에 의존하게 된다.

Java였다면 이 문제를 상속 계층(State 추상 클래스 + 서브클래스들)이나 sealed class로 풀었을 것이다. TS의 답은 계층 없이 **유니언 + 리터럴 타입 + 좁히기**의 조합으로 같은 것을 얻는 것이고, 이 문서가 그 도구들을 다룬다. 이 조합은 [4-1](./01-type-system-foundations.md)에서 세운 부품들(리터럴 타입, 제어 흐름 분석, never)의 응용이라서, 새 기능이 아니라 새 설계 관점에 가깝다.

## 핵심 개념

### interface vs type: 실제 차이는 어디에 있는가

객체 타입을 정의하는 두 문법은 대부분의 자리에서 교환 가능하다. 확장도 양쪽 다 된다(extends / 교차 타입 `&`). 실질적 차이는 세 지점이다.

**첫째, 선언 병합(declaration merging)은 interface만 된다.** 같은 이름의 interface 선언들은 하나로 합쳐진다.

```ts
interface Window { myApp: { version: string } }
// 기존 lib.dom.d.ts의 Window와 병합된다 — window.myApp이 타입을 갖게 된다

type Alias = { a: number };
// ❌ TS2300: Duplicate identifier 'Alias' — type은 재선언 자체가 에러
// type Alias = { b: string };
```

병합은 양날이다. 라이브러리가 열어 둔 확장점(전역 객체 보강, 플러그인이 옵션 타입에 필드 추가)을 소비자가 채우는 공식 통로이자 — [4-5](./05-compiler-and-config.md)의 모듈 보강이 이것이다 — 동시에, 어디서든 아무나 타입을 소리 없이 바꿀 수 있다는 뜻이기도 하다. 애플리케이션 내부 타입이라면 병합될 이유가 없고, 병합된다면 대개 사고다.

**둘째, type만 표현할 수 있는 것이 있다.** 유니언, 튜플, 조건부 타입, mapped type, 원시 타입 별칭은 interface로 쓸 수 없다. 이 문서의 중심인 판별 유니언부터가 type 전용이다.

**셋째, 에러 표시와 검사 시점이 다르다.** interface의 extends는 선언 지점에서 즉시 호환성을 검사해 그 자리에서 에러를 내지만, 교차 타입은 충돌하는 멤버를 조용히 never로 만들고 에러는 사용처에서 난다. 또 에디터 hover에서 interface는 이름으로, type의 복잡한 결과는 전개된 구조로 표시되는 경향이 있어 큰 타입에서는 가독성 차이가 된다.

컨벤션의 근거는 이렇게 정리된다: **확장·병합에 열려 있어야 하는 공개 계약(라이브러리의 공개 타입)은 interface, 유니언·조합·계산이 필요한 곳은 type.** "객체는 interface, 나머지는 type"이라는 흔한 규칙은 이 근거의 근사치로, 어느 쪽이든 팀 안에서 일관되기만 하면 실익 차이는 크지 않다 — 성능 차이가 있다는 통념이 있었으나 현재 버전에서 일반화할 근거는 없다.

### 판별 유니언: 상태 설계의 중심 도구

배경의 boolean 플래그 문제를 유니언으로 다시 설계한다.

```ts
type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: Result[] }
  | { status: "error"; error: Error };
```

각 멤버가 `status`라는 공통 프로퍼티를 **서로 다른 리터럴 타입**으로 갖는다. 이 프로퍼티를 판별자(discriminant)라고 부르고, 이런 유니언을 판별 유니언(discriminated union)이라고 부른다. 표현 가능한 상태가 정확히 유효한 상태 4가지로 줄었다 — `data`는 success에만, `error`는 error에만 존재하므로 "로딩 중인데 에러가 있는" 상태는 타입 수준에서 존재할 수 없다.

소비하는 쪽에서는 판별자 비교가 [4-1](./01-type-system-foundations.md)의 좁히기 장치로 동작한다.

```ts
function render(state: SearchState): string {
  switch (state.status) {
    case "loading":
      return "spinner";
    case "success":
      // 이 분기에서 state의 타입: { status: "success"; data: Result[] }
      return state.data.map((r) => r.title).join(", ");
    case "error":
      return state.error.message; // 여기서만 error에 접근 가능
    case "idle":
      return "";
  }
}
```

메커니즘을 정확히 말하면: `state.status === "success"`라는 비교에서 제어 흐름 분석이 "이 분기에서는 status가 리터럴 `"success"`인 멤버만 남는다"고 유니언을 소거한다. Kotlin의 sealed class + when, Rust/Swift의 enum + match가 하는 일 — 대수적 데이터 타입(algebraic data type)의 합 타입(sum type) — 과 동일한 표현력인데, TS는 이것을 상속 계층도 특수 선언도 없이 **구조와 리터럴 타입만으로** 얻는다는 점이 다르다. 아무 객체 유니언이나 공통 리터럴 프로퍼티만 있으면 판별 유니언이 된다.

판별자의 조건은 리터럴 타입이어야 한다는 것뿐이다. 문자열이 관례지만 숫자·boolean도 된다(`{ ok: true; value: T } | { ok: false; error: E }` 형태의 Result 패턴이 후자의 예).

### 철저성 검사: variant 추가가 에러를 낳게 만들기

위의 `render`에 상태를 하나 추가하면 어떻게 되는가. `{ status: "cancelled" }`를 유니언에 추가해도 switch는 그냥 통과한다 — 어떤 case에도 걸리지 않고 undefined를 반환할 뿐이다(반환 타입이 string이라 이 예에서는 에러가 나지만, 반환값이 없는 함수라면 조용히 지나간다). 처리 누락을 컴파일 에러로 만드는 장치가 **철저성 검사(exhaustiveness check)** 다.

```ts
function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

function render(state: SearchState): string {
  switch (state.status) {
    case "idle": return "";
    case "loading": return "spinner";
    case "success": return state.data.map((r) => r.title).join(", ");
    case "error": return state.error.message;
    default:
      // 모든 case를 처리했다면 여기서 state는 never — never 매개변수에 할당 가능
      return assertNever(state);
  }
}
```

원리는 [4-1](./01-type-system-foundations.md)의 never가 격자의 바닥이라는 사실이다. 제어 흐름 분석이 case마다 유니언 멤버를 소거하고, 전부 소거되면 default에서 남는 타입은 never다. never는 never 매개변수에 할당 가능하므로 통과한다. 이제 `"cancelled"`를 유니언에 추가하면 default의 state는 `{ status: "cancelled" }`가 되고, 이것은 never에 할당 불가능하므로 **switch를 안 고친 모든 위치에서 컴파일 에러가 난다** (TS2345). "새 상태를 추가했는데 처리 안 한 렌더 분기가 있다"는 버그가 컴파일 타임으로 당겨진 것이다.

런타임 throw까지 넣는 이유는 이중 방어다: 타입이 거짓말일 수 있는 경계(서버가 새 status 값을 먼저 배포한 경우)에서는 검사기가 못 잡으므로, 도달하면 즉시 명확하게 실패하게 한다.

### enum: 소거 원칙의 예외가 만드는 문제들

TS의 `enum`은 Java의 enum처럼 보이지만, 언어 설계 관점에서는 이질적인 존재다 — **타입 소거 원칙을 깨고 런타임 산출물을 생성하는 몇 안 되는 기능**이다.

```ts
enum Direction { Up, Down }
```

이것의 컴파일 산출물은 다음 JS다.

```js
var Direction;
(function (Direction) {
  Direction[Direction["Up"] = 0] = "Up";
  Direction[Direction["Down"] = 1] = "Down";
})(Direction || (Direction = {}));
// Direction = { "0": "Up", "1": "Down", "Up": 0, "Down": 1 } — 역방향 매핑 포함
```

타입인 줄 알았던 것이 값 공간에 객체를 만든다. 이 예외성에서 문제들이 파생된다.

- **숫자 enum의 할당 구멍**: 역사적으로 숫자 enum 타입에는 임의의 number가 할당 가능했다(비트 플래그 용도 때문). TS 5.0에서 상당 부분 조여졌지만, 열거의 "닫힌 집합" 보장이 약하다는 근본 성격은 남아 있다.
- **const enum의 도구 문제**: `const enum`은 산출물 없이 사용처에 값을 인라인하는 변형인데, 이 인라인은 **다른 파일의 타입 정보를 알아야** 가능하다. 파일 단위로 독립 변환하는 도구(esbuild, Babel — [4-5](./05-compiler-and-config.md)의 isolatedModules)에서는 원리적으로 불가능해서 에러 또는 비호환이 된다.
- **소거 세계와의 이질성**: "타입 관련 구문은 지워도 동작이 같다"는 TS의 일반 원칙이 enum에서 깨지므로, 타입 전용 import 분리(`verbatimModuleSyntax`) 같은 도구 규약과 계속 마찰한다.

대안은 두 가지고, 필요한 것이 무엇인지에 따라 갈린다.

```ts
// 대안 1: 리터럴 유니언 — "타입만" 필요할 때
type Direction = "up" | "down";

// 대안 2: as const 객체 + 파생 타입 — "런타임 값 목록 + 타입" 둘 다 필요할 때
const Direction = {
  Up: "up",
  Down: "down",
} as const;
type Direction = (typeof Direction)[keyof typeof Direction]; // "up" | "down"
```

대안 2의 파생 부분을 풀어 읽으면: `typeof Direction`은 값 `Direction`의 타입(as const 덕에 리터럴들이 유지된 `{ readonly Up: "up"; readonly Down: "down" }`)이고, `keyof typeof Direction`은 그 키들의 유니언 `"Up" | "Down"`이며, 인덱스 접근 `T[K]`로 값들의 유니언 `"up" | "down"`을 얻는다. enum이 하던 일(이름 붙은 상수 집합 + 그 집합의 타입)을 소거 원칙 안에서 재현한 것으로, 값과 타입에 같은 이름을 쓸 수 있는 것은 두 이름이 다른 공간(값 공간/타입 공간)에 살기 때문이다.

문자열 리터럴 유니언이 Java 감각으로는 "그냥 문자열이라 불안"해 보이지만, 검사기 관점에서는 닫힌 집합이다 — `move("north")`는 컴파일 에러다. 오히려 enum보다 판별 유니언·템플릿 리터럴 타입([4-4](./04-type-level-programming.md))과의 합성이 자연스럽다.

### 브랜드 타입: 구조적 시스템에 명목성이 필요해지는 지점

[4-1](./01-type-system-foundations.md)에서 예고한 구멍이다. 구조가 계약이므로, 구조가 같은 두 타입은 의미가 달라도 완전히 호환된다.

```ts
type UserId = number;
type PostId = number;

function deletePost(userId: UserId, postId: PostId) { /* ... */ }

const userId: UserId = 3;
const postId: PostId = 7;
deletePost(postId, userId); // ✅ 통과한다 — 인자가 뒤바뀌었는데
```

도메인에서는 명백한 버그지만 타입은 둘 다 number이므로 검사기는 도울 수 없다. 해법은 구조적 시스템 안에서 **인위적으로 구조를 다르게 만드는** 관례 — 브랜드 타입(branded type)이다.

```ts
type UserId = number & { readonly __brand: "UserId" };
type PostId = number & { readonly __brand: "PostId" };

const userId = 3 as UserId;   // 생성 지점에서만 단언으로 브랜드를 부여한다
const postId = 7 as PostId;

deletePost(postId, userId);
// ❌ TS2345: 'PostId'는 'UserId'에 할당 불가 — __brand 리터럴 타입이 다르다
```

`__brand` 프로퍼티는 런타임에 존재하지 않는다(값은 그냥 number다). 순전히 타입 공간에서 두 타입의 구조를 다르게 만들어 할당 가능성 판정을 실패시키는 장치로, 명목적 타이핑을 구조적 시스템 위에서 흉내 낸 것이다. 생성 지점의 단언은 [4-1](./01-type-system-foundations.md)의 기준("왜 안전한지 답할 수 있는가")을 충족하는 정당한 단언이다 — 검증 함수(`function toUserId(n: number): UserId`) 안에 격리하면 더 좋다.

비용도 명확하다: 모든 생성 지점이 단언 또는 팩토리 함수를 거쳐야 하고, 산술 연산 결과는 브랜드를 잃는다. 그래서 **모든 ID에 기계적으로 바르는 것이 아니라, 혼동의 비용이 큰 곳**(돈 단위 — 원/달러, 좌표계 — 픽셀/논리 좌표, 검증 전/후 문자열 — raw/sanitized)에 선택적으로 쓴다.

## 실무 관점

### 상태 설계 리팩터링의 판단 기준

기존 코드의 boolean 플래그 뭉치를 발견했을 때 판별 유니언으로 바꿀지의 판단:

| 신호 | 판단 |
|---|---|
| 플래그 간 배타 관계가 주석·관례로 존재 ("loading이면 error는 무시") | 판별 유니언으로 — 그 관례가 바로 유니언 멤버 정의다 |
| 상태 조합이 실제로 전부 유효 (독립적 토글들) | 그대로 둔다 — 곱 타입이 맞는 모델이다 |
| 상태마다 동반 데이터가 다르다 (success만 data를 가짐) | 판별 유니언으로 — 동반 데이터가 멤버로 묶인다 |
| 상태 전이가 제한적이다 (idle→loading→success/error) | 판별 유니언 + 전이 함수. 단, 전이 규칙 자체는 타입만으로 강제되지 않는다는 한계를 인지 |

마지막 행이 이 도구의 경계 조건이다: 판별 유니언은 **어떤 상태가 존재할 수 있는가**를 강제하지만 **어떤 전이가 허용되는가**는 강제하지 않는다. `state = { status: "success", data }`를 loading을 거치지 않고 대입해도 타입은 통과한다. 전이 강제까지 필요하면 상태 머신 라이브러리(XState 등)나 전이 함수로의 캡슐화가 다음 단계다.

### 판별 유니언이 어색해지는 경계

- **멤버가 수십 개로 늘어날 때**: switch가 거대해지고, 멤버별 처리가 여러 함수에 흩어지면 "새 variant 추가 시 고칠 곳"이 많아진다. 이것은 표현식 문제(expression problem)의 고전적 트레이드오프다 — 유니언(함수형 축)은 연산 추가가 쉽고 variant 추가가 비싸며, 클래스 계층(객체지향 축)은 그 반대다. variant가 자주 늘고 연산이 고정적이면 다형성(인터페이스 + 구현들)이 맞는 축일 수 있다.
- **판별자 없이 구조만 다른 유니언**: `string | string[]` 같은 유니언은 판별자가 없어 typeof/Array.isArray로 좁히게 되는데, 멤버가 둘을 넘으면 좁히기 코드가 취약해진다. 처음부터 판별자를 넣어 설계하는 쪽이 확장에 강하다.
- **직렬화 경계**: 판별 유니언은 JSON과 1:1로 직렬화되므로 API 응답 설계와 궁합이 좋다. 반대로 클래스 계층은 직렬화에서 타입 정보를 잃는다 — 서버 응답을 클래스로 역직렬화하는 습관(Java의 Jackson 감각)이 TS에서 어색한 이유다.

### enum을 이미 쓰고 있는 코드베이스

enum이 있는 기존 코드를 전부 걷어내는 리팩터링이 항상 이득인 것은 아니다. 판단 기준: **도구 경계를 넘는가.** tsc로만 빌드하는 폐쇄된 코드베이스의 일반 enum은 실질 문제가 거의 없다. 문제는 ① const enum이 라이브러리 공개 API에 노출되는 경우 ② esbuild/SWC 계열로 빌드를 옮기는 경우 ③ `verbatimModuleSyntax`를 켜는 경우로, 이때는 대안 패턴으로의 전환 비용을 지불할 근거가 생긴다. 신규 코드의 기본값은 리터럴 유니언(타입만 필요) 또는 as const 객체(값 목록 필요)로 두는 것이 무난하다.

## 더 깊이

### 좁히기가 판별자를 인식하는 정확한 조건

모든 프로퍼티 비교가 유니언을 좁히는 것은 아니다. 검사기가 프로퍼티를 판별자로 인정하는 조건은 "유니언의 각 멤버에서 그 프로퍼티가 **리터럴 타입(또는 리터럴들의 유니언, null, undefined)** 을 가질 것"이다. 판별자가 `status: string`인 멤버가 하나라도 섞이면 그 유니언 전체에서 판별 좁히기가 동작하지 않는다 — 서버 스키마에서 타입을 생성할 때 한 멤버만 느슨하게 정의되어 전체 switch의 좁히기가 조용히 깨지는 사고가 이 규칙에서 나온다.

또 하나의 세부: 판별자 비교는 **직접적인** 프로퍼티 접근에서만 동작한다. `const s = state.status`로 뽑아낸 뒤 `s === "success"`를 검사해도 state는 좁혀지지 않았던 것이 오랜 규칙이었고, TS 4.4부터 조건을 별칭 const에 담는 경우 등 일부 패턴이 지원되지만, 판별자 검사와 사용 지점이 멀어질수록 분석이 끊기기 쉽다는 사실은 여전하다. 좁히기는 지역적 분석이라는 [4-1](./01-type-system-foundations.md)의 원칙이 여기서도 작동한다.

### 교차 타입으로 판별 유니언에 공통 필드 얹기

실전 상태 타입에는 모든 멤버가 공유하는 필드(요청 id, 타임스탬프)가 생긴다. 멤버마다 반복하는 대신 교차로 합성할 수 있다.

```ts
type WithMeta = { requestId: string; updatedAt: number };

type SearchState = WithMeta &
  (
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; data: Result[] }
    | { status: "error"; error: Error }
  );
```

교차가 유니언에 분배되어(`A & (B | C)` = `(A & B) | (A & C)`) 각 멤버가 공통 필드를 갖는 판별 유니언이 유지된다. 이 분배 법칙은 [4-4](./04-type-level-programming.md)의 조건부 타입 분배와 함께, 유니언이 타입 연산에서 "컬렉션처럼" 동작하는 일반 규칙의 한 예다.

### interface extends가 교차 타입보다 에러를 일찍 내는 이유

```ts
interface A { prop: string }

// ❌ TS2430: 선언 지점에서 즉시 — prop이 string과 number로 충돌한다고 알려준다
// interface B extends A { prop: number }

type C = A & { prop: number };
// ✅ 선언은 통과한다 — 그러나 C의 prop은 string & number = never
const c: C = { prop: 1 }; // ❌ 사용처에서야 에러: number는 never에 할당 불가
```

interface extends는 "상속 관계 선언"이므로 검사기가 선언 시점에 부모와의 호환을 검증한다. 교차 타입은 "타입 연산"이므로 결과(never 프로퍼티)를 계산할 뿐 그것이 의도인지 판단하지 않는다. 큰 타입을 조합할 때 interface 쪽 에러가 원인 지점에 가깝게 나는 이유이고, "공개 계약은 interface" 컨벤션의 실질 근거 중 하나다.

## 정리

- interface와 type의 실질 차이는 선언 병합(interface 전용 — 확장점이자 오염 통로), 표현력(유니언·조건부는 type 전용), 에러 검사 시점(extends는 선언 지점, 교차는 사용처)이다.
- 판별 유니언은 공통 리터럴 프로퍼티로 좁히기를 자동화하는 합 타입이다 — boolean 플래그 조합이 만드는 무효 상태를 타입 수준에서 제거하며, sealed class/ADT가 하던 일을 상속 계층 없이 얻는다.
- never 매개변수를 받는 assertNever를 switch의 default에 두면, 유니언에 variant를 추가할 때 처리 누락이 전부 컴파일 에러로 드러난다.
- enum은 타입 소거 원칙의 예외(런타임 객체 생성)라서 도구 경계(파일 단위 변환, const enum 인라인)와 마찰한다. 신규 코드는 리터럴 유니언 또는 `as const` 객체 + `keyof typeof` 파생을 기본값으로 한다.
- 구조가 같으면 의미가 달라도 호환되는 것이 구조적 타이핑의 구멍이며, 혼동 비용이 큰 값(ID, 돈, 좌표)에는 브랜드 타입으로 명목성을 선택적으로 도입한다.

## 확인 문제

**Q1.** 다음 상태 타입에는 표현 가능하지만 무의미한 상태가 있다. 판별 유니언으로 재설계하고, 재설계가 소비 코드(렌더 함수)에 강제하는 것이 무엇인지 설명하라.

```ts
interface UploadState {
  file: File | null;
  progress: number;       // 0~100
  uploadedUrl: string | null;
  failedReason: string | null;
}
```

<details>
<summary>정답과 해설</summary>

무의미한 상태의 예: `uploadedUrl`과 `failedReason`이 동시에 존재, `file: null`인데 `progress: 50`, 완료됐는데 progress가 30. 재설계:

```ts
type UploadState =
  | { status: "idle" }
  | { status: "uploading"; file: File; progress: number }
  | { status: "done"; file: File; uploadedUrl: string }
  | { status: "failed"; file: File; failedReason: string };
```

각 상태에 유효한 데이터만 멤버로 묶이므로 위의 무효 조합들은 타입 수준에서 존재할 수 없다. 소비 코드에 강제되는 것: `state.uploadedUrl`에 아무 데서나 접근할 수 없고, **판별자 검사(좁히기)를 통과한 분기 안에서만** 해당 상태의 데이터에 접근할 수 있다. 즉 "지금이 어떤 상태인지 확인하고 나서 그 상태의 데이터를 쓴다"는 순서가 문법으로 강제된다. assertNever를 default에 두면 새 상태 추가 시 렌더 함수 수정도 강제된다.

</details>

**Q2.** 팀원이 "enum이 있는데 왜 굳이 `as const` 객체를 쓰냐"고 묻는다. enum의 컴파일 산출물과 도구 경계를 근거로 답하고, 반대로 enum을 그대로 둬도 되는 조건을 제시하라.

<details>
<summary>정답과 해설</summary>

근거: ① enum은 타입 소거 원칙의 예외로, 컴파일 시 역방향 매핑을 포함한 런타임 객체를 생성한다 — "타입 구문은 지워도 동작이 같다"는 TS의 일반 원칙이 깨지는 지점이다. ② const enum은 사용처 인라인을 위해 파일 간 타입 정보가 필요하므로, 파일 단위 독립 변환 도구(esbuild, Babel, isolatedModules 환경)와 원리적으로 비호환이다. ③ `as const` 객체 + `keyof typeof` 파생은 같은 것(이름 붙은 닫힌 상수 집합 + 그 타입)을 소거 원칙 안에서 제공하므로 도구 마찰이 없다.

그대로 둬도 되는 조건: tsc로만 빌드하고, const enum을 쓰지 않거나 공개 API에 노출하지 않으며, 빌드 도구 전환 계획이 없는 폐쇄 코드베이스. 이 경우 일반 enum의 실질 문제는 작으므로 걷어내는 리팩터링 비용이 이득을 넘기 어렵다.

</details>

**Q3.** 다음 코드는 철저성 검사가 있는데도 새 variant `"cancelled"` 추가 시 컴파일 에러가 나지 않았다. 원인과 수정 방법은?

```ts
type Status = { status: "active" } | { status: "closed" } | { status: string };

function label(s: Status) {
  switch (s.status) {
    case "active": return "진행 중";
    case "closed": return "종료";
    default: return assertNever(s); // 원래부터 에러가 나고 있었다
  }
}
```

<details>
<summary>정답과 해설</summary>

세 번째 멤버 `{ status: string }`이 원인이다. 판별 좁히기는 유니언의 **모든 멤버에서 판별자가 리터럴 타입일 때만** 동작한다. `status: string`인 멤버가 섞이면 ① `"active"` case 비교로도 그 멤버는 소거되지 않고(string은 "active"일 수도 있으므로), ② default에서 남는 타입이 never가 되지 않아 assertNever가 처음부터 에러였다 — 즉 철저성 검사가 이미 깨져 있었고, "cancelled" 추가를 감지할 능력이 없었다. 이런 느슨한 멤버는 대개 서버 스키마 생성기나 임시 타입에서 유입된다.

수정: 열린 집합이 정말 필요한 게 아니라면 세 번째 멤버를 리터럴로 고친다(`{ status: "archived" }` 등). "알 수 없는 값도 올 수 있는" 경계라면 유니언을 닫고, 경계에서 런타임 검증([4-1](./01-type-system-foundations.md)의 타입 가드)으로 알 수 없는 값을 별도 처리한 뒤 내부에는 닫힌 유니언만 흘린다.

</details>

## 참고 자료

- [TypeScript Handbook — Object Types / Everyday Types (Interfaces vs Type Aliases)](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#differences-between-type-aliases-and-interfaces) — 두 문법의 공식 비교.
- [TypeScript Handbook — Narrowing (Discriminated unions, Exhaustiveness checking)](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) — 판별 유니언과 never 검사의 공식 서술.
- [TypeScript Handbook — Enums](https://www.typescriptlang.org/docs/handbook/enums.html) — enum의 컴파일 산출물과 const enum의 함정("Objects vs Enums" 절이 as const 대안을 직접 권한다).
- [TypeScript 5.0 Release Notes — Enum Overhaul](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html) — 숫자 enum 할당 구멍이 어떻게 조여졌는지.
- [Making Impossible States Impossible (Richard Feldman, elm-conf)](https://www.youtube.com/watch?v=IcgmSRJHu_8) — "불가능한 상태를 표현 불가능하게" 설계 원칙의 원전 격 발표. 언어는 Elm이지만 원리는 동일하다.
