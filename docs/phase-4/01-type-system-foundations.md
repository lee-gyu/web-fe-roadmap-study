# 4-1. 타입 시스템의 기초

> 한 줄 요약: TypeScript의 할당 가능성 판정이 이름이 아니라 구조로 동작하며 컴파일 후 완전히 소거된다는 사실로부터, 타입 에러를 예측하고 런타임 검증이 필요한 경계를 판단할 수 있다.

이 문서는 TypeScript 5.9 기준이다.

## 학습 목표

- 타입 소거(type erasure)가 무엇을 의미하는지 설명하고, 런타임 검증이 별도로 필요한 경계를 판단할 수 있다.
- 구조적 타이핑(structural typing)의 할당 가능성(assignability) 판정 규칙으로 "왜 이 할당은 통과/실패하는가"를 설명할 수 있다.
- 넓히기(widening)와 좁히기(narrowing)의 규칙으로 추론 결과를 예측하고, 좁히기가 무효화되는 지점을 진단할 수 있다.
- any / unknown / never의 차이를 타입 격자(lattice) 상의 위치로 설명하고, 경계 코드에서 무엇을 선택할지 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

JavaScript의 타입은 값에 붙고 실행 중에 판정된다([3-3](../phase-3/03-types-and-coercion.md)). 이 동적 모델은 작은 코드에서는 자유지만, 코드베이스가 커지면 함수의 계약(무엇을 받고 무엇을 반환하는가)이 문서와 관례에만 존재하게 된다. 리팩터링할 때 호출처가 전부 깨졌는지 확인할 방법이 실행뿐이라면, 실행 경로가 수천 개인 앱에서 리팩터링은 도박이 된다.

TypeScript는 이 문제에 **점진적 타이핑(gradual typing)** 으로 답했다. 기존 JS 코드를 그대로 받아들이면서(모든 JS는 유효한 TS), 타입 서술을 얹은 만큼만 정적 검사를 받는다. 같은 문제를 두고 경쟁했던 대안들과 비교하면 설계 의도가 드러난다.

- **Dart(초기), CoffeeScript류** — 아예 다른 언어로 대체: 기존 생태계와의 호환을 포기해서 실패했다.
- **Flow** — TS와 같은 접근(JS + 타입 주석)이었지만 생태계(에디터 지원, 서드파티 타입 정의)의 규모 경쟁에서 밀렸다.
- **JSDoc 주석 기반 검사** — 문법 추가 없이 주석만으로: 지금도 TS 검사기가 지원하지만, 표현력의 상한이 낮다.

TS의 결정적 설계 선택은 두 가지고, 이 문서 전체가 이 두 선택의 귀결이다.

1. **타입은 컴파일하면 사라진다(소거).** 런타임 성능·의미론에 개입하지 않는 대신, 타입이 런타임에 아무것도 보장하지 않는다.
2. **호환성 판정은 구조로 한다.** 타입 주석이 없는 기존 JS 코드(덕 타이핑으로 짜인)와 공존해야 했기 때문에, 이름 기반(명목적) 판정은 처음부터 선택지가 아니었다.

Java나 C#을 주력으로 썼다면 "타입"이라는 단어에 런타임 실체(리플렉션 가능, 캐스트는 런타임 검사)를 기대하게 된다. TS의 타입은 그것이 아니다 — **실행에 관여하지 않는 정적 서술 계층**이다. 이 차이를 기준으로 세우는 것이 이 문서의 목적이다.

## 핵심 개념

### 타입 소거: 컴파일하면 무엇이 남는가

먼저 산출물을 직접 본다. 다음 TS 코드를 컴파일하면:

```ts
interface User {
  id: number;
  name: string;
}

function greet(user: User): string {
  return `hello, ${user.name}`;
}

const u: User = { id: 1, name: "kim" };
```

JS 산출물은 이것이 전부다:

```js
function greet(user) {
  return `hello, ${user.name}`;
}
const u = { id: 1, name: "kim" };
```

`interface User`는 흔적도 없다. 타입 주석은 지워지고, 값 코드만 남는다. 이것이 타입 소거이며, 세 가지 귀결이 따라온다.

**첫째, 타입은 런타임 검사에 쓸 수 없다.**

```ts
function handle(input: unknown) {
  // ❌ TS2693: 'User'는 타입이라 값 위치에 쓸 수 없다
  // if (input instanceof User) { ... }
}
```

`instanceof`는 런타임 연산자라서 런타임에 존재하는 값(생성자 함수)이 필요한데, `interface`는 컴파일 후 존재하지 않는다. Java에서 `obj instanceof MyInterface`가 되는 것은 인터페이스가 클래스 파일에 실재하기 때문이고, TS에서 안 되는 것은 결함이 아니라 소거의 정의 그대로다.

**둘째, 타입 단언은 캐스트가 아니다.** `as`는 아무 코드도 생성하지 않는다.

```ts
const data = JSON.parse('{"id": "oops"}') as User;
// 런타임에는 아무 일도 일어나지 않는다. data.id는 문자열 "oops"다.
console.log(data.id + 1); // 출력: "oops1" — 타입은 number라고 말하지만
```

Java의 캐스트는 런타임에 검사하고 실패하면 `ClassCastException`을 던진다. TS의 `as`는 검사기에게 "내가 책임질 테니 이 판정을 받아들여라"라고 선언하는 것뿐이며, 틀려도 아무도 알려주지 않는다. `as`를 "캐스트"라고 부르는 습관이 이 차이를 가린다 — 정확한 이름은 **검사 포기 선언**이다.

**셋째, 프로그램의 신뢰 경계에는 런타임 검증이 별도로 필요하다.** `fetch` 응답, `JSON.parse`, `localStorage`, 폼 입력 — 외부에서 들어오는 값의 타입은 컴파일 타임에 증명할 수 없으므로, 타입을 붙이려면 런타임에 실제로 확인하는 코드(타입 가드 또는 스키마 검증)가 있어야 한다. 이 구조는 [실무 관점](#실무-관점)에서 다시 다룬다.

소거 원칙에는 예외가 있다. `enum`과 `class`는 런타임 산출물을 만든다(값 공간과 타입 공간에 동시에 존재한다). `enum`이 이 예외라는 사실이 만드는 문제는 [4-2](./02-type-design.md)에서 다룬다.

### 구조적 타이핑: 이름이 아니라 모양이 계약이다

TS의 호환성 판정에는 선언 관계가 필요 없다.

```ts
interface Point {
  x: number;
  y: number;
}

function distance(p: Point): number {
  return Math.hypot(p.x, p.y);
}

// Point를 implements한 적 없는 객체 — 그래도 통과한다
const click = { x: 10, y: 20, timestamp: 1699999999 };
console.log(distance(click)); // 출력: 22.360679774997898
```

`click`은 `Point`라고 선언한 적이 없지만, `Point`가 요구하는 구조(x: number, y: number)를 **포함**하므로 할당 가능하다. Java라면 `implements Point`가 없는 클래스의 인스턴스는 어떤 구조든 거부된다 — 그쪽은 이름(선언 관계)이 계약이고, TS는 모양이 계약이다.

이 판정 방식의 이름이 구조적 타이핑이다. 세 언어의 접근을 나란히 놓으면 위치가 잡힌다.

| | 판정 기준 | 판정 시점 | 대표 |
|---|---|---|---|
| 명목적 타이핑 | 선언된 이름·상속 관계 | 컴파일 타임 | Java, C#, Swift |
| 구조적 타이핑 | 구조의 포함 관계 | 컴파일 타임 | TypeScript, Go 인터페이스 |
| 덕 타이핑 | 실제 사용 성공 여부 | 런타임 | Python, Ruby, JS |

TS가 구조적인 이유는 취향이 아니다. 타입 주석 없이 덕 타이핑으로 짜인 기존 JS 생태계를 서술하려면, "이 함수는 x와 y가 있는 아무 객체나 받는다"는 사실을 표현할 수 있어야 했다. 명목적 시스템은 그 사실을 표현할 수 없다 — 구조적 타이핑은 **덕 타이핑을 컴파일 타임으로 옮긴 것**이라고 이해하면 정확하다. 차이는 검증 시점이다: Python은 런타임에 시도하고 실패하면 `AttributeError`, TS는 컴파일 타임에 구조 포함을 증명한다.

### 할당 가능성: 검사기가 실제로 하는 판정

에러 메시지에 늘 나오는 표현이 있다: `Type 'X' is not assignable to type 'Y'` (TS2322). 검사기가 하는 거의 모든 일이 이 **할당 가능성(assignability)** 판정이다. 객체 타입의 규칙은 다음과 같다.

> S가 T에 할당 가능하려면, T가 요구하는 모든 프로퍼티에 대해 S가 같은 이름의 프로퍼티를 갖고, 그 프로퍼티의 타입이 다시 (재귀적으로) 할당 가능해야 한다.

핵심은 **포함이면 충분하다**는 것이다. S가 T보다 프로퍼티를 더 갖고 있어도 통과한다 — 위의 `click`이 그랬다. 더 구체적인(정보가 많은) 값은 덜 구체적인 것이 필요한 자리에 놓일 수 있다는, 서브타이핑의 일반 원리다.

그런데 이 규칙을 그대로 믿으면 설명이 안 되는 현상이 있다.

```ts
interface Point {
  x: number;
  y: number;
}

// ❌ TS2353: 'timestamp'는 Point에 없는 프로퍼티다
const p1: Point = { x: 10, y: 20, timestamp: 1699999999 };

// ✅ 같은 값인데 변수를 거치면 통과한다
const tmp = { x: 10, y: 20, timestamp: 1699999999 };
const p2: Point = tmp;
```

초과 프로퍼티가 있어도 할당 가능하다면서, 리터럴을 직접 쓰면 에러가 난다. 이것은 **초과 프로퍼티 검사(excess property check)** 라는 별도의 검사로, 오직 **신선한(fresh) 객체 리터럴** — 아직 어떤 변수에도 담기지 않고 다른 타입으로 판정된 적 없는 리터럴 — 에만 적용된다.

근거는 의도 추론이다. 리터럴을 `Point` 자리에 직접 쓰는 사람이 `timestamp`를 넣었다면, "더 큰 타입의 값을 재사용"하는 것일 수 없고(방금 만들었으니까) 오타이거나 착오일 가능성이 압도적이다. 반면 변수에 담긴 값은 다른 곳에서 온 것일 수 있으므로 일반 규칙(포함이면 통과)을 적용한다. 즉 초과 프로퍼티 검사는 타입 시스템의 공리가 아니라 **린트에 가까운 실용 장치**이며, "왜 변수에 담으면 에러가 사라지는가"라는 흔한 미스터리의 답이다.

### 넓히기: 추론은 어디까지 일반화하는가

TS는 주석이 없는 곳의 타입을 추론한다. 이때 리터럴 값의 타입을 얼마나 구체적으로 유지할지의 규칙이 **넓히기(widening)** 다.

```ts
const a = "hello";  // 타입: "hello" (리터럴 타입 — const는 재할당이 없으므로 좁게 유지)
let b = "hello";    // 타입: string  (let은 재할당 가능하므로 원시 타입으로 넓힘)

const obj = { kind: "circle", radius: 10 };
// 타입: { kind: string; radius: number }
// 프로퍼티는 const로 선언해도 넓혀진다 — 객체 내부는 변경 가능하므로
```

`"hello"`라는 **리터럴 타입**은 string의 부분 타입으로, 그 문자열 하나만 담는 타입이다. 검사기는 "이 바인딩이 나중에 바뀔 수 있는가"를 기준으로 리터럴 타입을 유지할지 넓힐지 결정한다. `const` 변수는 좁게, `let`과 객체 프로퍼티는 넓게.

객체 프로퍼티의 넓히기가 문제가 되는 지점이 있다.

```ts
function move(direction: "up" | "down") { /* ... */ }

const cmd = { direction: "up" };
// ❌ TS2345: string은 "up" | "down"에 할당 불가 — direction이 string으로 넓혀졌다
move(cmd.direction);

const cmd2 = { direction: "up" } as const;
// ✅ as const는 모든 프로퍼티를 readonly + 리터럴 타입으로 고정한다
move(cmd2.direction);
```

`as const`는 "이 값의 어떤 부분도 변하지 않는다"는 선언으로, 넓히기를 전면 중단시킨다. 리터럴 유니언 기반 설계([4-2](./02-type-design.md))에서 핵심 도구가 된다.

### 좁히기: 제어 흐름이 타입을 바꾼다

넓히기의 반대 방향이 **좁히기(narrowing)** 다. 검사기는 코드의 제어 흐름을 따라가며, 각 지점에서 변수가 가질 수 있는 타입을 조건 검사에 따라 줄여 나간다. 이 분석의 이름이 **제어 흐름 분석(control flow analysis)** 이다.

```ts
function format(value: string | number | Date): string {
  if (typeof value === "string") {
    return value.toUpperCase(); // 여기서 value의 타입: string
  }
  if (value instanceof Date) {
    return value.toISOString(); // 여기서 value의 타입: Date
  }
  return value.toFixed(2);      // 남은 타입: number — 검사기가 소거법으로 안다
}
```

같은 변수 `value`가 위치마다 다른 타입을 갖는다. Java의 (패턴 매칭 이전) 캐스트 후 사용과 달리, 검사기가 조건문의 의미를 이해하고 타입을 자동으로 갱신한다. 좁히기를 일으키는 장치는 정해져 있다: `typeof`, `instanceof`, `in`, 판별 프로퍼티 비교(`value.kind === "circle"`, [4-2](./02-type-design.md)의 중심), 진리값 검사, 그리고 사용자 정의 타입 가드.

사용자 정의 타입 가드는 소거된 타입과 런타임 검증을 잇는 공식 통로다.

```ts
interface User {
  id: number;
  name: string;
}

// 반환 타입 "value is User"가 이 함수를 좁히기 장치로 등록한다
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" && value !== null &&
    typeof (value as Record<string, unknown>).id === "number" &&
    typeof (value as Record<string, unknown>).name === "string"
  );
}

const raw: unknown = JSON.parse('{"id": 1, "name": "kim"}');
if (isUser(raw)) {
  console.log(raw.name); // raw의 타입: User — 런타임 검사가 정적 타입을 벌어 왔다
}
```

주의할 것은 `is`의 본문을 검사기가 **검증하지 않는다**는 점이다(구현이 항상 true를 반환해도 통과한다). 타입 가드는 단언과 마찬가지로 "내가 책임진다" 선언이되, 책임의 근거(런타임 검사 코드)를 같은 자리에 두는 관례라는 점이 다르다.

좁히기에는 유효 범위가 있다. **함수 경계를 넘으면 무효화된다.**

```ts
function process(id: number | null) {
  if (id !== null) {
    setTimeout(() => {
      // ❌ 검사기는 여기서 id를 number | null로 되돌린다
      // 콜백이 실행되는 시점([3-5])에 id가 여전히 null이 아니라는 보장이 없다
      console.log(id.toFixed());
    }, 100);
  }
}
```

이 예제에서 `id`는 매개변수라 실제로는 바뀔 수 없지만, 검사기는 클로저([3-2](../phase-3/02-closures-and-functions.md))가 캡처한 변수가 콜백 실행 전에 변경될 가능성을 일반 규칙으로 처리한다 — 좁히기는 **동기적 제어 흐름 안에서만** 신뢰된다(단, `const` 바인딩은 예외적으로 유지된다). 이것은 검사기의 한계라기보다, 좁히기가 시점에 결부된 정보라는 사실의 정직한 반영이다.

### any, unknown, never: 격자의 꼭대기와 바닥

타입들을 "누가 누구에게 할당 가능한가"로 정렬하면 격자(lattice) 구조가 나온다. 세 특수 타입은 이 격자에서 각자의 자리가 있다.

**unknown은 꼭대기(top)다.** 모든 타입이 unknown에 할당 가능하지만, unknown은 (any 외의) 어디에도 할당할 수 없다. "무엇이든 들어오지만, 확인 전에는 아무것도 할 수 없다."

```ts
function handleInput(value: unknown) {
  // ❌ TS18046: 'value' is of type 'unknown'
  // value.toUpperCase();

  // ✅ 좁히기를 통과해야만 사용할 수 있다
  if (typeof value === "string") {
    return value.toUpperCase();
  }
}
```

**never는 바닥(bottom)이다.** never는 모든 타입에 할당 가능하지만, never에는 (never 외의) 아무것도 할당할 수 없다. "값이 존재할 수 없음"의 타입으로, 도달 불가능한 코드 지점에서 나타난다. 모든 경우를 소거한 뒤 남는 타입이 never라는 성질이 철저성 검사([4-2](./02-type-design.md))의 원리가 된다.

**any는 격자 바깥의 탈출구다.** any는 모든 타입에 할당 가능하고 모든 타입이 any에 할당 가능하다 — 양방향 모두 통과라는 것은 판정 자체를 끈다는 뜻이다. 문제는 이것이 전염된다는 점이다.

```ts
function parse(json: string): any {
  return JSON.parse(json);
}

const user = parse('{"id": 1}');   // user: any
const name = user.nmae;            // 오타인데 통과 — any의 프로퍼티는 전부 any
const upper = name.toUpperCase();  // upper도 any — 오염이 하류로 번진다
// 런타임: TypeError: Cannot read properties of undefined
```

any가 하나 들어오면 그것을 거친 모든 값의 검사가 꺼진다. unknown과 any의 차이를 한 문장으로 줄이면: **unknown은 "모르니까 확인해라"를 강제하고, any는 "모르니까 믿어라"를 강제한다.** 신뢰 경계에서 선택할 것은 언제나 unknown 쪽이다. 참고로 `JSON.parse`의 반환 타입이 any인 것은 unknown이 언어에 추가(TS 3.0)되기 전에 굳은 역사적 시그니처다.

## 실무 관점

### 신뢰 경계의 설계: 어디에 런타임 검증을 두는가

타입 소거의 실무적 귀결은 하나로 모인다: **컴파일 타임 보장은 프로그램 내부에서만 성립하고, 외부에서 들어오는 값에는 성립하지 않는다.** fetch 응답, JSON.parse, localStorage, URL 파라미터, 폼 입력이 그 경계다. 경계 처리의 선택지를 비교하면:

| 접근 | 코드 | 무엇을 얻는가 | 무너지는 지점 |
|---|---|---|---|
| 제네릭 단언 | `res.json() as User` | 편의. 코드 0줄 | 서버 응답이 바뀌는 순간 타입이 거짓말이 된다 — 에러는 멀리 떨어진 사용처에서 터져 원인 추적이 어렵다 |
| unknown + 직접 가드 | `isUser(raw)` | 경계에서 즉시 실패. 의존성 0 | 필드가 많아지면 가드 코드가 타입 정의와 이중 관리된다 |
| 스키마 검증 라이브러리 | zod, valibot 등 | 스키마 하나에서 타입과 검증을 함께 도출 — 이중 관리 해소 | 번들 크기와 의존성. 소량의 경계에는 과잉 |

원칙은 접근의 선택보다 **배치**다: 검증은 경계에서 한 번, 내부에서는 검증된 타입만 흐르게 한다. 경계 안쪽 코드에 `as`가 반복해서 나타난다면 경계 설계가 없다는 신호다.

Phase 3 과제 B의 fetch 코드가 정확히 이 문제를 갖고 있다 — API 응답을 unknown으로 받아 가드를 통과시키는 재설계가 Phase 4 실습 과제의 요구사항이다.

### 에러 진압 습관의 비용

타입 에러를 만났을 때의 선택지는 넷이고, 비용이 다르다.

```ts
const el = document.querySelector(".title");
// el의 타입: Element | null — DOM에 없을 수 있다는 정직한 서술

el.textContent = "hi";          // ❌ TS18047: 'el' is possibly 'null'

el!.textContent = "hi";         // 진압 1: non-null 단언 — 없으면 런타임 TypeError
(el as HTMLElement).focus();    // 진압 2: 타입 단언 — 검사 포기
// @ts-ignore                   // 진압 3: 해당 줄의 모든 검사 정지 — 최악
if (el) el.textContent = "hi";  // ✅ 좁히기 — 검사기와 런타임이 같은 것을 본다
```

단언이 정당한 경우는 분명히 있다 — **검사기보다 내가 더 많이 아는 지점**(방금 위에서 만든 DOM, 제어가 보장된 불변식)이다. 문제는 근거 없이 습관화될 때다. 실용적인 기준: 단언을 쓸 때마다 "왜 검사기는 이것을 모르는가, 왜 나는 아는가"를 한 줄이라도 답할 수 있어야 한다. 답할 수 없다면 그 단언은 미래의 런타임 에러를 예약한 것이다. Phase 4 실습 과제의 "타입 설계 문서"가 이 훈련이다.

### 구조적 타이핑이 실무에서 만드는 함정

구조가 계약이라는 규칙은 대부분 편의지만, 두 지점에서 뒤통수를 친다.

**의미가 다른데 구조가 같은 타입.** `type UserId = number`와 `type PostId = number`는 구조가 동일하므로 서로 완전히 호환된다 — 인자 순서를 바꿔 넣어도 검사기는 침묵한다. 구조적 시스템 안에서 명목적 구분이 필요해지는 이 경계 조건과 해법(브랜드 타입)은 [4-2](./02-type-design.md)에서 다룬다.

**빈 타입은 모든 것을 받는다.** `interface Options {}`는 아무 프로퍼티도 요구하지 않으므로 사실상 모든 값이 할당 가능하다(null/undefined 제외). "일단 빈 인터페이스로 두고 나중에 채우자"는 습관이 검사를 조용히 무력화하는 이유다.

## 더 깊이

### 검사기는 순환 구조를 어떻게 판정하는가

구조적 판정은 프로퍼티별 재귀 비교라고 했다. 그러면 재귀적 타입은 무한 루프에 빠지지 않는가?

```ts
interface TreeA { value: number; children: TreeA[] }
interface TreeB { value: number; children: TreeB[] }

const a: TreeA = { value: 1, children: [] };
const b: TreeB = a; // ✅ 통과한다 — 어떻게?
```

TreeA와 TreeB의 비교는 children의 비교를 낳고, 그것은 다시 TreeA/TreeB의 비교다. tsc의 검사기는 진행 중인 판정 쌍을 스택에 기록하고, **같은 쌍의 판정이 재귀적으로 다시 요구되면 일단 참으로 가정(coinductive assumption)** 하고 진행한다 — 순환 참조를 "지금까지 모순이 없었으면 호환"으로 처리하는 것이다. 이는 명목적 시스템에는 아예 없는 문제(이름만 비교하면 끝이므로)로, 구조적 판정이 지불하는 계산 비용의 한 예다. 타입이 복잡해질수록 이 판정 비용이 에디터 반응성으로 체감되는 문제와 계측 방법은 [4-4](./04-type-level-programming.md)에서 다룬다.

### freshness의 정확한 소멸 조건

초과 프로퍼티 검사가 적용되는 "신선한 리터럴"의 신선함은 언제 사라지는가. 규칙은: 객체 리터럴 타입은 생성 직후에만 fresh이며, **변수에 할당되거나 타입 단언을 거치는 순간** freshness를 잃고 일반 객체 타입이 된다. 그래서 다음 세 가지가 모두 다른 결과를 낸다.

```ts
interface Point { x: number; y: number }

const p1: Point = { x: 1, y: 2, z: 3 };          // ❌ fresh 리터럴 → 초과 검사
const tmp = { x: 1, y: 2, z: 3 };
const p2: Point = tmp;                            // ✅ 변수 경유 → 일반 규칙
const p3: Point = { x: 1, y: 2, z: 3 } as Point;  // ✅ 단언 → freshness 소멸
```

세 번째가 함정이다 — `as Point`는 초과 프로퍼티 경고를 없애는 용도로 자주 쓰이지만, 동시에 **부족한** 프로퍼티 검사도 상당 부분 약화시킨다(전혀 겹치지 않는 타입 간 단언만 거부된다). 초과 검사를 피하려고 단언을 쓰는 것은 린트를 끄려고 검사기를 끄는 격이다.

### 왜 스펙이 없는가

ECMA-262([3-1](../phase-3/01-execution-model.md))에 해당하는 TS의 공식 명세는 없다. 과거의 언어 명세 문서는 2016년경 유지가 중단되었고, 현재의 "명세"는 microsoft/TypeScript 저장소의 구현과 릴리스 노트, Handbook이다. 이는 실무적 함의가 있다: TS의 동작은 버전 간에 (검사 강화라는 방향으로) 달라질 수 있으며, "표준이 보장하는 동작"과 "현재 구현의 동작"의 구분이 원칙적으로 불가능하다. 이 문서를 포함한 Phase 4 전체가 기준 버전(5.9)을 명시하는 이유다.

## 정리

- TS의 타입은 컴파일하면 소거된다. `as`는 캐스트가 아니라 검사 포기 선언이고, `instanceof interface`가 안 되는 것은 소거의 정의이며, 외부 입력 경계에는 런타임 검증(타입 가드·스키마)이 별도로 필요하다.
- 할당 가능성은 이름이 아니라 구조의 포함 관계로 판정된다. 기존 JS의 덕 타이핑을 컴파일 타임으로 옮긴 설계이며, Go 인터페이스와 같은 계열이다.
- 초과 프로퍼티 검사는 fresh 객체 리터럴에만 적용되는 별도의 실용 장치다 — "변수에 담으면 통과"하는 것은 일반 규칙(포함이면 충분)으로 돌아가기 때문이다.
- 추론은 재할당 가능성을 기준으로 리터럴 타입을 넓히고(`let`, 객체 프로퍼티), 제어 흐름 분석은 조건 검사를 따라 타입을 좁힌다. 좁히기는 동기 흐름 안에서만 유효하며 콜백 경계에서 무효화된다.
- unknown은 "확인해야 쓸 수 있는" top, never는 "값이 있을 수 없는" bottom, any는 판정 자체를 끄고 하류로 전염되는 탈출구다. 신뢰 경계에서는 unknown을 선택한다.

## 확인 문제

**Q1.** 다음 코드에서 ①은 에러이고 ②는 통과한다. 각각의 판정 근거를 설명하라.

```ts
interface Config { host: string; port: number }

function connect(c: Config) { /* ... */ }

connect({ host: "localhost", port: 8080, debug: true }); // ① ❌
const opts = { host: "localhost", port: 8080, debug: true };
connect(opts);                                            // ② ✅
```

<details>
<summary>정답과 해설</summary>

②가 일반 규칙이다: 할당 가능성은 구조의 포함 관계로 판정하므로, `Config`가 요구하는 host·port를 모두 (맞는 타입으로) 가진 `opts`는 초과 프로퍼티 debug가 있어도 할당 가능하다.

①이 특례다: 인자가 **fresh 객체 리터럴**(생성 직후, 변수 미경유)이므로 초과 프로퍼티 검사가 추가로 적용된다. 방금 만든 리터럴에 대상 타입에 없는 프로퍼티가 있다면 재사용일 수 없고 오타·착오일 가능성이 높다는 의도 추론에 기반한 실용 장치로, 타입 시스템의 포함 규칙 자체와는 별개의 검사다.

</details>

**Q2.** 다음 코드는 컴파일이 통과하지만 런타임에 `TypeError`가 난다. 어디서 무엇이 잘못되었고, 단언 없이 고치는 설계는 무엇인가?

```ts
interface Product { id: number; price: number }

async function getProduct(): Promise<Product> {
  const res = await fetch("/api/product/1");
  return res.json() as Promise<Product>;
}

const p = await getProduct();
console.log(p.price.toFixed(2)); // TypeError: Cannot read properties of undefined
```

<details>
<summary>정답과 해설</summary>

`res.json() as Promise<Product>`가 문제다. 타입은 소거되므로 이 단언은 런타임에 아무것도 검사하지 않는다 — 서버가 `price` 없는 JSON을 보내면(스키마 변경, 에러 응답 등) 타입은 `Product`라고 말하지만 실제 값에는 price가 없고, 에러는 단언 지점이 아니라 멀리 떨어진 사용처(`p.price.toFixed`)에서 터진다.

수정: 경계에서 unknown으로 받고 런타임 검증을 통과시킨다.

```ts
function isProduct(v: unknown): v is Product {
  return typeof v === "object" && v !== null &&
    typeof (v as Record<string, unknown>).id === "number" &&
    typeof (v as Record<string, unknown>).price === "number";
}

async function getProduct(): Promise<Product> {
  const res = await fetch("/api/product/1");
  const raw: unknown = await res.json();
  if (!isProduct(raw)) throw new Error("unexpected response shape");
  return raw; // 가드 통과로 Product로 좁혀졌다 — 단언 없음
}
```

잘못된 응답이 경계에서 즉시, 명확한 에러로 실패한다. HTTP 에러와 네트워크 에러의 구분 처리는 [3-8](../phase-3/08-network-apis.md)의 구조를 따른다.

</details>

**Q3.** 아래에서 검사기는 콜백 안의 `user`를 다시 `User | null`로 되돌린다. 검사기가 좁히기를 버리는 이유를 실행 모델로 설명하고, 에러를 해소하는 방법을 두 가지 제시하라.

```ts
let user: User | null = getUser();

if (user !== null) {
  button.addEventListener("click", () => {
    console.log(user.name); // ❌ 'user' is possibly 'null'
  });
}
```

<details>
<summary>정답과 해설</summary>

좁히기는 제어 흐름 분석의 산물로, **검사한 시점**의 정보다. 콜백은 등록만 되고 실행은 미래의 태스크([3-5](../phase-3/05-event-loop.md))에서 일어나며, 클로저는 값이 아니라 변수 자체를 캡처하므로([3-2](../phase-3/02-closures-and-functions.md)) 검사 시점과 실행 시점 사이에 `let user`에 null이 재할당될 수 있다. 검사기는 이 시간 축을 정적으로 추적할 수 없으므로 함수 경계에서 좁히기를 보수적으로 무효화한다.

해소 방법:

1. **const 스냅샷**: `const u = user;`를 if 안에서 만들어 콜백이 그것을 캡처하게 한다. const 바인딩은 재할당이 불가능하므로 좁혀진 타입이 함수 경계를 넘어 유지된다.
2. **선언을 const로**: 애초에 `const user = getUser()`로 선언하면 같은 이유로 좁히기가 유지된다. 재할당이 실제로 필요 없다면 이쪽이 근본 해결이다.

</details>

## 참고 자료

- [TypeScript Handbook — The Basics / Everyday Types](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) — 소거·추론·단언의 공식 서술. TS는 별도 스펙이 없으므로 Handbook이 1차 자료다.
- [TypeScript Handbook — Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — 제어 흐름 분석과 좁히기 장치 전체 목록.
- [TypeScript Handbook — Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html) — 구조적 할당 가능성 판정 규칙의 공식 정의.
- [TypeScript FAQ (microsoft/TypeScript Wiki)](https://github.com/microsoft/TypeScript/wiki/FAQ) — 초과 프로퍼티 검사, 빈 인터페이스 등 "왜 이렇게 동작하는가"류 질문에 대한 설계팀의 직접 답변.
- [TypeScript Playground](https://www.typescriptlang.org/play) — 컴파일 산출물(.JS 탭)과 타입 판정을 즉시 관찰하는 도구. 이 문서의 모든 예제를 붙여 넣어 검증할 수 있다.
