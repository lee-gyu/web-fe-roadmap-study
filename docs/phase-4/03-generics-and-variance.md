# 4-3. 제네릭과 변성

> 한 줄 요약: 제네릭 타입 인자가 어떻게 추론되는지, 그리고 컨테이너·함수 타입의 할당 가능성이 원소 타입으로부터 어떤 방향(변성)으로 유도되는지를 알면, TS가 의도적으로 남긴 소리(soundness) 구멍까지 포함해 제네릭 코드의 통과/실패를 예측할 수 있다.

이 문서는 TypeScript 5.9 기준이다. [4-1](./01-type-system-foundations.md)의 할당 가능성 판정을 전제한다 — 변성은 그 판정을 타입 생성자(제네릭)로 확장한 것이다.

## 학습 목표

- 제네릭 타입 인자의 추론 과정을 설명하고, 명시적 타입 인자가 필요한 시점을 판단할 수 있다.
- `T extends U` 제약이 여는 것과 "T는 U의 부분 타입일 수 있다"는 사실이 만드는 함정을 설명할 수 있다.
- 공변/반공변/불변을 함수 타입의 대입 관점에서 도출하고, 배열 공변과 메서드 이변(bivariance)이 왜 의도된 구멍인지 설명할 수 있다.
- strictFunctionTypes가 검사하는 것과 검사하지 못하는 것(메서드 축약 표기)을 구분하여 라이브러리 타입을 작성할 수 있다.

## 배경: 왜 이것이 존재하는가

제네릭 자체는 경력자에게 새 개념이 아니다 — "타입을 매개변수화한다"는 아이디어는 Java 5, C# 2.0부터 주력 언어에 있었다. TS에서 새로 배워야 하는 것은 두 가지다.

**첫째, 추론의 비중이 다르다.** Java에서 제네릭 호출은 대부분 다이아몬드 연산자나 명시적 인자로 타입을 지정하는 감각이지만, TS는 **호출 인자의 구조로부터 타입 인자를 역산하는 추론**이 기본 경로다. 게다가 [4-1](./01-type-system-foundations.md)의 리터럴 타입·넓히기가 추론과 상호작용하므로, "왜 T가 string이 아니라 `"hello"`로 잡혔는가" 같은, 명목적 언어에는 없는 질문이 생긴다.

**둘째, 변성(variance)의 처리 방식이 다르다.** `Array<Dog>`를 `Array<Animal>`이 필요한 자리에 넘겨도 되는가 — 이 질문에 Java는 사용처 와일드카드(`? extends`)로, Kotlin/C#은 선언처 주석(in/out)으로 답하게 한다. TS는 원칙적으로 **구조로부터 변성을 계산**하며, 그 계산에는 실용을 위해 의도적으로 열어 둔 구멍이 두 개 있다(배열 공변, 메서드 이변). 이 구멍들은 문서화된 설계 선택이고, 알고 있으면 예측 가능하며, 모르면 "타입은 통과했는데 런타임에 터지는" 미스터리가 된다.

이 문서의 목표는 제네릭 문법 사용법이 아니라 이 두 지점 — 추론의 동작과 변성의 규칙 — 을 판정 모델로 세우는 것이다.

## 핵심 개념

### 타입 인자 추론: 검사기는 T를 어떻게 역산하는가

```ts
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

const n = first([1, 2, 3]);       // T = number로 추론, n: number | undefined
const s = first(["a", "b"]);      // T = string
```

추론의 기본 동작: 검사기는 매개변수 타입(`T[]`)과 실제 인자 타입(`number[]`)을 **구조적으로 대응**시켜, 타입 매개변수가 놓인 위치의 실제 타입을 수집한다. 이것을 추론 지점(inference site)이라고 부른다.

추론 지점이 여러 개면 수집된 후보들을 통합해야 한다. 여기서 동작이 갈린다.

```ts
function pair<T>(a: T, b: T): [T, T] {
  return [a, b];
}

pair(1, 2);        // T = number — 리터럴 후보들이 공통 원시 타입으로 넓혀진다
pair(1, "a");
// ❌ TS2345: '"a"' is not assignable to parameter of type '1'
// 첫 지점의 후보(1)와 "a"는 통합할 수 없다
// — 유니언 number | string을 "만들어 주지" 않는다

declare const x: number | string;
pair(x, "a");      // ✅ T = string | number — 선언된 유니언은 그대로 쓴다
```

검사기는 추론 지점들의 후보 중 **다른 모든 후보를 포괄하는 것**을 찾으며, 없으면 임의로 유니언을 합성하지 않고 에러를 낸다. "호출자가 유니언을 원했는지, 실수했는지"를 구분할 수 없으므로 보수적으로 실패하는 설계다. 유니언이 의도라면 명시적 타입 인자(`pair<number | string>(1, "a")`)로 선언한다 — **추론이 실패하거나 의도와 다르게 잡힐 때가 명시적 인자의 자리**라는 일반 원칙의 한 예다.

리터럴 타입과의 상호작용도 예측 대상이다.

```ts
declare function useState<T>(initial: T): [T, (next: T) => void];

const [count, setCount] = useState(0);       // T = number — 리터럴 0이 넓혀진다
const [mode, setMode] = useState("dark");    // T = string — "dark"가 아니라
setMode("light");                            // ✅ 그래서 통과한다

const [mode2, setMode2] = useState<"dark" | "light">("dark"); // 좁게 고정하려면 명시
```

일반 위치의 T는 [4-1](./01-type-system-foundations.md)의 넓히기 규칙을 따른다(재할당될 수 있는 자리로 흘러가므로). 반대로 T가 **리터럴을 유지해야 유용한 위치**(extends 제약이 리터럴 계열인 경우, `const` 타입 매개변수 — TS 5.0의 `function f<const T>`)에서는 좁게 유지된다. "왜 어떤 함수는 리터럴을 유지하고 어떤 함수는 넓히는가"의 답은 함수 선언 쪽에 있다.

### 제약: extends가 여는 것과 흔한 오해

제약(constraint)은 "T는 최소한 이 구조를 갖는다"는 선언으로, 제네릭 함수 본문에서 T 값의 프로퍼티에 접근할 근거를 만든다.

```ts
function longest<T extends { length: number }>(a: T, b: T): T {
  // 제약 덕분에 .length 접근이 정당화된다 — 제약이 없으면 TS2339
  return a.length >= b.length ? a : b;
}

longest("hello", "hi");       // T = "hello" | "hi" — 둘 다 length를 가진 문자열
longest([1, 2, 3], [4, 5]);   // T = number[]
longest(10, 20);              // ❌ TS2345: number에는 length가 없다
```

경력자가 자주 걸리는 오해는 "제약을 만족하니 T를 제약 타입으로 취급해도 된다"는 방향이다.

```ts
function fill<T extends string>(value: T): T {
  // ❌ TS2322: string은 T에 할당 불가
  // return "default";
  // T는 string의 "부분 타입"이다 — 호출자가 fill<"on" | "off">로 부르면
  // "default"는 그 타입의 값이 아니다
  return value;
}
```

`T extends string`은 "T는 string이다"가 아니라 "T는 string에 할당 가능한 **어떤** 타입이다"이다. 그 어떤 타입은 `"on"`일 수도, `"on" | "off"`일 수도 있다. 제약은 T에서 밖으로 나가는 것(프로퍼티 접근, string 자리에 전달)을 열지만, 밖에서 T로 들어오는 것(string 값을 T 자리에 반환)은 열지 않는다. 이 비대칭이 다음 절 변성의 예고편이다.

제약과 자주 결합하는 것이 `keyof`다 — "이 객체에 실제로 있는 키"를 타입으로 강제하는, 제네릭 설계의 가장 흔한 실전 패턴이다.

```ts
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user = { id: 1, name: "kim" };
getProp(user, "name");  // ✅ 반환 타입 string — K = "name", T[K]가 정확히 계산된다
getProp(user, "email"); // ❌ TS2345: "email"은 "id" | "name"에 할당 불가
```

### 변성: 컨테이너의 호환은 원소로부터 어느 방향으로 유도되는가

준비가 끝났다. 본 질문: `Dog`가 `Animal`에 할당 가능할 때(부분 타입일 때), `F<Dog>`와 `F<Animal>`의 관계는 무엇인가. 논리적 선택지는 넷이고 각각 이름이 있다.

| 변성 | 관계 | 직관 |
|---|---|---|
| 공변(covariant) | `F<Dog>` → `F<Animal>` 할당 가능 | 원소와 같은 방향 |
| 반공변(contravariant) | `F<Animal>` → `F<Dog>` 할당 가능 | 원소와 반대 방향 |
| 불변(invariant) | 어느 쪽도 불가 | 정확히 같아야 함 |
| 이변(bivariant) | 양쪽 다 가능 | 검사 안 함에 가깝다 |

어느 것이 맞는지는 **F가 원소를 어느 방향으로 흘리는가**로 결정되며, 함수 타입에서 가장 선명하게 도출된다. `(x: P) => R` 타입의 자리에 다른 함수를 대입한다고 하자.

```ts
type Animal = { name: string };
type Dog = { name: string; bark(): void };

// 이 자리에 어떤 함수를 넣어도 되는가?
declare let handler: (animal: Animal) => Dog;

// 반환 쪽: Dog를 반환하기로 한 자리에 "더 구체적인 것"을 반환하는 함수 → 안전
// 호출자는 Dog를 기대하고, 받은 것은 Dog 이상이다
declare const returnsMore: (animal: Animal) => Dog & { breed: string };
handler = returnsMore; // ✅ 반환 타입은 공변

// 매개변수 쪽: Animal을 받기로 한 자리에 "더 일반적인 것"을 받는 함수 → 안전
// 호출자는 Animal을 넘기고, 함수는 Animal이면 무엇이든 처리할 수 있다
declare const acceptsMore: (thing: { name?: string }) => Dog;
handler = acceptsMore; // ✅ 매개변수 타입은 반공변

// 반대로, Dog만 받는 함수를 이 자리에 넣으면?
declare const acceptsLess: (dog: Dog) => Dog;
handler = acceptsLess;
// ❌ TS2322 (strictFunctionTypes) — 호출자가 bark 없는 Animal을 넘기면
// 함수 본문의 dog.bark()가 런타임에 터진다
```

요약하면: **출력 위치(반환)는 공변, 입력 위치(매개변수)는 반공변.** "주는 쪽은 약속보다 더 줘도 되고, 받는 쪽은 약속보다 더 받아 줘야 한다" — 리스코프 치환 원칙을 함수 시그니처에 적용한 것과 같다. 원소가 입출력 양쪽에 나타나는 컨테이너(읽고 쓰는 가변 배열)는 논리적으로 불변이어야 한다.

TS는 이 계산을 선언처 주석 없이 **구조에서 수행**한다. 프로퍼티가 읽기 전용이면 공변, 함수 매개변수 위치면 반공변 — 타입의 모양이 변성을 결정한다. Java의 사용처 와일드카드(`List<? extends Animal>` — 쓰는 쪽이 매번 지정), Kotlin/C#의 선언처 주석(`out T` — 정의하는 쪽이 한 번 지정)과 나란히 놓으면, TS는 "지정하지 않는다(계산한다)"는 세 번째 접근이다.

### 의도된 구멍 1: 배열은 공변이다

논리대로면 가변 배열은 불변이어야 한다. 그러나:

```ts
const dogs: Dog[] = [{ name: "choco", bark() {} }];
const animals: Animal[] = dogs; // ✅ TS는 이것을 허용한다 — 배열 공변

animals.push({ name: "nabi" }); // Animal로서는 합법인 쓰기
dogs[1].bark();                 // 💥 런타임 TypeError: dogs[1].bark is not a function
// 검사기는 침묵했다 — dogs와 animals는 같은 배열이다
```

이것은 Java가 배열에서 했던 것과 같은 선택이다 — 단, Java는 쓰기 지점에서 `ArrayStoreException`이라는 **런타임 검사**라도 던지지만, 타입이 소거되는 TS는 그것조차 없다. 구멍이 조용히 뚫린다.

왜 이렇게 두었는가. `Dog[]`를 `readAnimals(list: Animal[])`에 넘기는 코드는 실무에서 압도적으로 읽기 용도이고, 이를 전부 거부하면(불변) 기존 JS 패턴 대부분이 에러가 된다 — 점진적 타이핑이라는 존재 이유와의 타협이다. TS 팀은 이를 문서화된 unsoundness로 인정한다. 방어하는 방법은 읽기 전용 의도를 타입으로 말하는 것이다: `readonly Animal[]`(ReadonlyArray)은 쓰기 메서드가 없으므로 공변이어도 논리적으로 안전하고, push 시도는 컴파일 에러가 된다.

### 의도된 구멍 2: 메서드 축약 표기는 이변이다

strictFunctionTypes(strict에 포함)가 켜지면 함수 타입의 매개변수는 반공변으로 검사된다 — 위의 `acceptsLess` 에러가 그것이다. 그런데 이 검사에는 명시적 예외가 있다: **메서드 축약 표기(method shorthand)로 선언된 시그니처는 이변(bivariant)으로 남는다.**

```ts
interface StrictHandler {
  handle: (animal: Animal) => void;  // 프로퍼티 표기 — 반공변 검사
}
interface LooseHandler {
  handle(animal: Animal): void;      // 메서드 축약 표기 — 이변 (검사 느슨)
}

const dogOnly = { handle: (dog: Dog) => dog.bark() };

const s: StrictHandler = dogOnly; // ❌ TS2322 — 정확히 거부된다
const l: LooseHandler = dogOnly;  // ✅ 통과한다 — 같은 의미인데!
l.handle({ name: "nabi" });       // 💥 런타임 TypeError — bark가 없다
```

의미가 같은 두 표기가 다른 검사 강도를 갖는다. 이유는 실용이다: DOM과 기존 라이브러리의 계층 구조가 메서드 매개변수의 공변에 광범위하게 의존한다. 대표 예가 이벤트 타깃이다 — `HTMLElement`의 `addEventListener`를 오버라이드하는 하위 타입들, `Array<T>`의 메서드들이 반공변 검사 아래에서는 서로 호환 불가능해진다(`Dog[]`가 `Animal[]`에 할당되려면 `push(item: Dog)`가 `push(item: Animal)`을 받아들여야 하는데 반공변 검사는 이를 거부한다 — 배열 공변 자체가 메서드 이변 위에 서 있다). 그래서 strictFunctionTypes 도입(TS 2.6) 때 메서드 표기를 의도적으로 검사에서 제외했다.

실무 규칙이 여기서 나온다: **콜백을 받는 타입을 정의할 때는 프로퍼티 표기를 쓴다.** 검사받을 수 있는 곳에서 검사를 끄지 않는 것이다. 메서드 표기는 "이것은 객체의 메서드이고, 계층 간 공변 호환이 필요하다"는 의도가 있을 때로 한정한다.

### in/out 변성 주석: 계산의 보조 수단

TS 4.7부터 타입 매개변수에 선언처 변성 주석을 붙일 수 있다.

```ts
interface Producer<out T> { get(): T }        // T는 출력 위치에만 — 공변 선언
interface Consumer<in T> { accept(value: T): void } // 입력 위치에만 — 반공변 선언
```

Kotlin/C#과 같은 문법이지만 역할이 다르다는 점이 중요하다. TS의 변성은 여전히 구조에서 계산되며, 주석은 ① 계산 결과와 주석이 다르면 **선언 지점에서 에러**를 내는 문서화·검증 장치이고 ② 순환 참조가 깊은 대형 타입에서 검사기가 변성 계산을 반복하지 않게 하는 성능 힌트다. 주석으로 구조와 다른 변성을 강제할 수는 없다 — 구조가 진실이고 주석은 그 구조에 대한 주장이다.

## 실무 관점

### 추론 실패의 신호와 대응

제네릭 관련 에러의 대부분은 "추론이 내 의도와 다르게 잡힌" 경우다. 신호별 대응:

| 증상 | 원인 | 대응 |
|---|---|---|
| T가 unknown으로 잡힘 | 추론 지점이 없다(인자에 T가 안 나타남) | 명시적 타입 인자, 또는 시그니처 재설계 |
| T가 기대보다 넓다(string) | 리터럴이 넓혀졌다 | `const` 타입 매개변수, `as const` 인자, 명시적 인자 |
| 인자 2개에서 TS2345 | 후보 통합 실패 — 유니언을 합성하지 않는다 | 의도가 유니언이면 명시적 인자 |
| 콜백 매개변수가 any/에러 | 추론 순서상 콜백이 먼저 검사됨 | 콜백을 마지막 매개변수로 두는 API 설계(추론이 앞 인자에서 확정된 뒤 콜백에 전파된다) |

마지막 행은 라이브러리 설계 규칙이기도 하다 — TS의 추론이 인자 순서에 민감하므로, "데이터 먼저, 콜백 나중" 시그니처가 추론 친화적이다.

### 제네릭 과잉의 경계

타입 매개변수는 **두 위치 이상을 연결할 때만** 값을 한다. 한 번만 나타나는 T는 아무것도 연결하지 않는다.

```ts
// ❌ T가 한 번만 등장 — unknown과 다를 게 없고 읽기만 어렵다
function log<T>(value: T): void { console.log(value); }

// ✅ 같은 의미, 더 정직하다
function log(value: unknown): void { console.log(value); }

// ✅ T가 입력과 출력을 "연결"한다 — 제네릭의 정당한 자리
function identity<T>(value: T): T { return value; }
```

"제네릭이 있어야 뭔가 유연해 보인다"는 감각으로 붙인 단일 등장 T는 TS 공식 가이드라인도 명시적으로 반대하는 안티패턴이다. 반대 방향의 과잉은 제약 연쇄(`<T extends A, K extends keyof T, V extends T[K]>`)가 시그니처를 뒤덮는 경우로, 대개 조건부 타입([4-4](./04-type-level-programming.md))으로 옮기거나 오버로드로 나누는 편이 읽기 쉽다.

### 변성 구멍의 실무 방어선

배열 공변과 메서드 이변은 끌 수 없다(strict에도 스위치가 없다). 방어는 코드 관례로 한다.

- **읽기 전용 의도는 `readonly T[]`로 선언한다.** 특히 함수 매개변수 — 받은 배열을 변경하지 않는 함수가 `T[]`로 받으면 호출자에게 불필요하게 좁은 요구를 하는 동시에 공변 구멍에 노출된다. `readonly`는 쓰기 메서드를 타입에서 제거하므로 구멍의 전제(쓰기)가 사라진다.
- **콜백 필드는 프로퍼티 표기로.** 앞 절의 규칙. 린트(typescript-eslint의 `method-signature-style`)로 강제할 수 있다.
- **공변이 필요한 계층에는 메서드 표기를 의도적으로.** 이변은 결함이 아니라 도구다 — 이벤트 핸들러 계층처럼 공변 호환이 설계 요구인 곳에서는 메서드 표기가 맞는 선택이고, 그 사실을 주석으로 남긴다.

## 더 깊이

### 검사기의 변성 계산과 그 비용

검사기가 `F<A>`와 `F<B>`의 호환을 판정하는 원칙적 방법은 구조 전개다 — F의 정의에 A와 B를 각각 대입해 결과 구조를 [4-1](./01-type-system-foundations.md)의 규칙으로 비교한다. 그러나 매번 전개하면 재귀 타입에서 비용이 폭발하므로, tsc는 타입 매개변수별 변성을 **한 번 계산해 캐시**하고(공변/반공변/불변/이변 마킹), 이후 `F<A> vs F<B>`를 "원소 쌍의 방향 비교"로 축약한다. in/out 주석이 성능 힌트가 되는 이유가 이것이다 — 계산을 선언으로 대체한다.

이 최적화가 관찰 가능한 지점도 있다: 변성 축약과 구조 전개가 드물게 다른 결론을 내는 코너 케이스(조건부 타입이 끼면 변성이 "unmeasurable"로 처리되는 경우 등)가 컴파일러 이슈로 보고되곤 한다. "제네릭 호환 판정이 전개 순서에 따라 달라 보이는" 미스터리를 만나면 이 캐시 계층을 의심 목록에 올릴 수 있다.

### 함수 오버로드와 추론의 상호작용

오버로드된 함수의 호출은 **선언 순서대로 첫 번째로 매칭되는 시그니처**를 쓰며, 제네릭 추론도 그 시그니처 안에서만 일어난다. 이것이 만드는 함정: 넓은 시그니처를 위에 두면 좁은 시그니처가 영원히 선택되지 않는다. 오버로드는 구체적인 것부터 선언한다는 규칙의 근거다. 또 하나 — 오버로드 시그니처들의 유니언으로 추론해 주지는 않으므로, "이 함수는 string이든 number든 받는다"는 의도라면 오버로드보다 유니언 매개변수가 추론 친화적이다.

### 왜 `Promise<T>`는 공변처럼 동작하는가

`Promise<Dog>`는 `Promise<Animal>`에 할당 가능하다. 선언을 보면 이유가 구조에서 계산됨을 확인할 수 있다 — Promise의 T는 `then`의 콜백 **매개변수의 매개변수**, 즉 입력의 입력 = 출력 위치에 나타난다(반공변의 반공변 = 공변). resolve된 값은 소비자에게 "주어지는" 것뿐이므로 공변이 논리적으로도 맞고, lib.es5.d.ts의 구조가 그 사실을 표현하고 있다. 변성 주석 없이 구조가 변성을 결정한다는 이 문서의 원칙을 표준 라이브러리에서 확인하는 예다.

## 정리

- 타입 인자 추론은 인자 구조에서 T의 위치별 후보를 수집해 통합한다. 유니언을 임의 합성하지 않으며, 추론이 의도와 다를 때가 명시적 타입 인자의 자리다. 리터럴 인자는 일반 위치에서 넓혀진다.
- `T extends U`는 "T는 U에 할당 가능한 어떤 타입"이다 — U의 프로퍼티 접근은 열리지만, U 타입 값을 T 자리에 넣는 것은 열리지 않는다.
- 함수 타입의 할당 가능성은 반환 공변·매개변수 반공변으로 유도된다. TS는 이 변성을 선언 주석이 아니라 구조에서 계산하며, in/out 주석(4.7+)은 검증·성능 보조다.
- TS에는 문서화된 소리 구멍이 있다: 가변 배열의 공변(Java 배열과 같은 선택, 런타임 검사는 없음)과 메서드 축약 표기의 이변(DOM·배열 계층 호환을 위한 의도적 예외). `readonly T[]`와 콜백의 프로퍼티 표기가 방어선이다.
- 타입 매개변수는 두 위치 이상을 연결할 때만 정당하다 — 한 번 등장하는 T는 unknown으로 바꾼다.

## 확인 문제

**Q1.** 다음 각 호출에서 T가 무엇으로 추론되는지, 에러가 나는 것은 왜인지 설명하라.

```ts
declare function wrap<T>(value: T, fallback: T): T;

const a = wrap("on", "off");            // ①
const b = wrap(1, "off");               // ②
const c = wrap<number | string>(1, "off"); // ③
```

<details>
<summary>정답과 해설</summary>

① T = `"on" | "off"`. 두 추론 지점에서 리터럴 타입 `"on"`과 `"off"`가 수집되고, 같은 원시 계열의 리터럴 후보들은 유니언으로 통합된다. 반환값이 `const a`에 담기므로([4-1](./01-type-system-foundations.md)의 넓히기 규칙) 리터럴 유니언이 유지된다 — `a`의 타입은 `"on" | "off"`다.

② ❌ TS2345: `'"off"' is not assignable to parameter of type '1'`. 첫 지점에서 후보 `1`이 잡히고, `"off"`(string 계열)는 그와 통합할 수 없다. 검사기는 서로 다른 원시 계열을 가로지르는 유니언을 임의로 합성하지 않는다 — 실수와 의도를 구분할 수 없기 때문이다.

③ T = `number | string`로 명시했으므로 두 인자 모두 그 유니언에 할당 가능해 통과한다. ②의 의도가 유니언이었다면 이것이 정답 경로다.

</details>

**Q2.** 다음 코드는 strict 모드에서도 잘못된 구현 할당을 잡지 못하고 런타임에 터진다. 원인을 변성으로 설명하고 수정하라.

```ts
interface Middleware {
  handle(req: { url: string }): void;
}

// url 외에 token도 있다고 가정하는 구현 — 실제 요청에는 없을 수 있다
const authMiddleware = {
  handle: (req: { url: string; token: string }) => {
    console.log(req.token.length);
  },
};

const m: Middleware = authMiddleware; // ✅ 통과해 버린다
m.handle({ url: "/home" }); // 💥 TypeError: req.token이 undefined
```

<details>
<summary>정답과 해설</summary>

`handle`이 **메서드 축약 표기**로 선언되어 매개변수의 변성 검사가 이변(bivariant)으로 느슨해졌다. 안전하려면 반공변이어야 한다 — Middleware 사용자는 `{ url: string }`만 보장되는 요청을 넘기므로, 그보다 좁은 요청(`token` 요구)을 가정한 구현은 거부되어야 한다. 그러나 메서드 표기는 strictFunctionTypes의 명시적 예외라서 이 검사를 하지 않고, 좁은 구현의 할당이 통과한다.

수정: 콜백/구현이 대입되는 시그니처를 프로퍼티 표기로 바꾼다.

```ts
interface Middleware {
  handle: (req: { url: string }) => void;
}
```

이제 같은 할당은 TS2322로 거부된다 — `{ url: string }`은 `{ url: string; token: string }`에 할당 불가능하므로 매개변수의 반공변 검사가 실패한다. "구현이 대입될 함수 멤버는 프로퍼티 표기로"가 라이브러리 타입 작성의 규칙인 이유다. 참고로 이변 예외는 **메서드 시그니처 자체의 비교**에만 적용된다 — 메서드의 인자로 함수를 넘길 때 그 함수 타입끼리의 비교는 표기와 무관하게 반공변으로 검사된다.

</details>

**Q3.** 다음 함수는 컴파일이 통과하지만 호출자의 데이터를 망가뜨릴 수 있다. 무엇이 문제이고, 시그니처를 어떻게 고쳐야 하는가?

```ts
function firstOrDefault(items: Animal[], fallback: Animal): Animal {
  if (items.length === 0) {
    items.push(fallback); // "비어 있으면 기본값을 채워 준다"는 선의의 부수 효과
    return fallback;
  }
  return items[0];
}

const dogs: Dog[] = [];
const result = firstOrDefault(dogs, { name: "nabi" }); // ✅ 통과한다
dogs[0].bark(); // 💥 TypeError — dogs에 bark 없는 Animal이 들어갔다
```

<details>
<summary>정답과 해설</summary>

배열 공변 구멍의 전형이다. `Dog[]`는 `Animal[]`에 (의도된 unsoundness로) 할당 가능하므로 호출은 통과하고, 함수 안의 `push(fallback)`은 `Animal[]` 관점에서 합법이지만 실제 배열은 `Dog[]`라서 bark 없는 원소가 섞인다. TS는 Java의 ArrayStoreException 같은 런타임 검사도 없으므로 오염은 사용 지점에서야 터진다.

수정 방향 두 가지:

1. **변경하지 않는 시그니처로**: `items: readonly Animal[]`로 받고 push를 제거한다. readonly 배열은 쓰기 메서드가 없으므로 push가 컴파일 에러가 되고, 공변이어도 안전하다. 읽기만 하는 함수의 기본형이다.
2. **변경이 정말 필요하면 제네릭으로**: `function firstOrDefault<T extends Animal>(items: T[], fallback: T): T` — fallback이 배열의 실제 원소 타입 T여야 한다는 연결이 생기므로, `firstOrDefault(dogs, { name: "nabi" })`는 fallback이 Dog가 아니라서 에러가 된다.

교훈: 매개변수 타입 `T[]`는 "읽고 쓸 권리"의 선언이다. 읽기만 한다면 `readonly T[]`가 정직한 계약이고, 이 정직함이 공변 구멍의 노출 면적을 줄인다.

</details>

## 참고 자료

- [TypeScript Handbook — Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) — 추론·제약·keyof 패턴의 공식 서술.
- [TypeScript 2.6 Release Notes — Strict function types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-6.html) — 반공변 검사 도입과 메서드 이변 예외의 근거를 설계팀이 직접 설명한 1차 자료.
- [TypeScript 4.7 Release Notes — Optional Variance Annotations](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html) — in/out 주석의 의도(검증·성능)와 한계.
- [TypeScript Wiki — FAQ: "Why are function parameters bivariant?"](https://github.com/microsoft/TypeScript/wiki/FAQ#why-are-function-parameters-bivariant) — 배열 공변·메서드 이변이 의도된 트레이드오프임을 확인할 수 있는 공식 문답.
- [TypeScript Handbook — Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html) — 단일 등장 타입 매개변수 등 제네릭 안티패턴의 공식 가이드.
