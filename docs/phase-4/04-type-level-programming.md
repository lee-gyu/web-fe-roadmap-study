# 4-4. 타입 레벨 프로그래밍

> 한 줄 요약: 조건부 타입·infer·mapped type·template literal type이 타입 공간의 함수형 언어를 이룬다는 관점을 세우면, Partial·ReturnType 같은 유틸리티 타입을 직접 구현할 수 있고 타입 계산이 과잉이 되는 경계를 판단할 수 있다.

이 문서는 TypeScript 5.9 기준이다. [4-1](./01-type-system-foundations.md)의 리터럴 타입·never, [4-3](./03-generics-and-variance.md)의 제네릭·추론을 전제한다.

## 학습 목표

- 타입 공간을 "제네릭이 함수, 조건부가 분기, 재귀가 루프인 함수형 언어"로 설명할 수 있다.
- 유니언 분배(distributive conditional type)가 일어나는 정확한 조건과 이를 막는 관용구를 설명할 수 있다.
- Partial, Pick, ReturnType 등 표준 유틸리티 타입을 조건부 타입·infer·mapped type으로 직접 구현할 수 있다.
- 타입 계산이 tsc 성능과 가독성을 해치는 경계 조건을 알고, 계측 방법(`--extendedDiagnostics`)과 함께 과잉 여부를 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

`Partial<T>`, `ReturnType<F>` 같은 유틸리티 타입을 쓰다 보면 이것이 어디서 오는 힘인지 궁금해진다 — Java 제네릭에는 "타입에서 새 타입을 계산하는" 능력이 사실상 없다(소거 위에서 매개변수화만 가능하다). TS가 이 능력을 갖게 된 것은 우연이 아니라 임무의 결과다: **기존 JS API의 동적인 패턴을 정적으로 서술**해야 했기 때문이다.

JS 라이브러리들은 이런 함수를 아무렇지 않게 만든다 — "객체와 키 배열을 받아 그 키들만 남긴 객체를 반환한다"(pick), "이벤트 이름 `click`을 받으면 핸들러 프로퍼티 `onClick`을 찾는다", "함수를 받아 같은 인자에 로깅만 얹은 함수를 반환한다"(데코레이터 패턴). 이런 API의 반환 타입은 **입력 타입으로부터 계산**되어야만 정확히 서술된다. 고정된 타입 몇 개로는 불가능하고, 타입을 받아 타입을 만드는 언어가 필요하다.

그래서 TS는 타입 공간에 계산 능력을 단계적으로 추가했다: mapped type(2.1) → 조건부 타입과 infer(2.8) → template literal type(4.1). 그 결과물이 이 문서의 주제인 **타입 레벨 언어**다. C++ 템플릿 메타프로그래밍과 구조가 같지만(컴파일 타임 순수 함수형 계산, 난해한 에러 메시지까지), 용도가 다르다 — C++은 값·코드 생성에 쓰고, TS는 소거되므로 오직 **서술의 정밀화**에만 쓴다.

경고도 배경의 일부다. 이 언어는 튜링 완전에 가깝고, 그래서 남용이 가능하다. 이 문서의 목표는 곡예가 아니라 두 가지다: 표준 유틸리티 타입이 마법이 아님을 구현으로 확인하는 것, 그리고 이 도구가 정당한 자리(라이브러리 경계)와 과잉인 자리(애플리케이션 코드)를 구분하는 판단 기준을 세우는 것이다.

## 핵심 개념

### 관점: 타입 공간의 함수형 언어

값 공간의 코드와 타입 공간의 코드를 나란히 놓으면 대응이 보인다.

| 값 공간 | 타입 공간 |
|---|---|
| 함수 `(x) => ...` | 제네릭 타입 `type F<T> = ...` |
| 분기 `cond ? a : b` | 조건부 타입 `T extends U ? A : B` |
| 재귀 호출 | 재귀 타입 참조 |
| 배열과 map | 유니언과 분배 / mapped type |
| 문자열 연산 | template literal type |
| 패턴 매칭·구조 분해 | `infer` |

타입 공간에는 루프도 가변 변수도 없다 — 재귀와 조건뿐인 **순수 함수형 언어**다. 이 대응을 쥐고 있으면 아래의 각 기능이 문법 조각이 아니라 언어의 부품으로 읽힌다.

### 조건부 타입: 타입 공간의 분기

```ts
type IsString<T> = T extends string ? true : false;

type A = IsString<"hello">; // true
type B = IsString<42>;      // false
```

`T extends U ? X : Y`의 `extends`는 [4-1](./01-type-system-foundations.md)의 할당 가능성 판정 그대로다 — "T가 U에 할당 가능하면 X, 아니면 Y". 새 판정 규칙이 아니라 기존 판정을 분기 조건으로 재사용한 것이다.

조건부 타입의 진짜 비범함은 다음 규칙에 있다. **naked type parameter(다른 타입으로 감싸지지 않고 홀로 검사 위치에 놓인 타입 매개변수)에 유니언을 넣으면, 조건부 타입이 유니언의 각 멤버에 분배(distribute)된다.**

```ts
type ToArray<T> = T extends unknown ? T[] : never;

type R = ToArray<string | number>;
// string | number가 통째로 검사되는 것이 아니라:
// ToArray<string> | ToArray<number> = string[] | number[]
```

유니언이 컬렉션이고 분배가 map인 셈이다. 표준 유틸리티 `Exclude`가 이 규칙 하나로 만들어진다.

```ts
type MyExclude<T, U> = T extends U ? never : T;

type Status = "idle" | "loading" | "success" | "error";
type Active = MyExclude<Status, "idle">;
// 각 멤버가 개별 검사된다:
// "idle" → never, "loading" → "loading", "success" → "success", "error" → "error"
// never는 유니언에서 자동 소거되므로: "loading" | "success" | "error"
```

never가 유니언의 항등원(합쳐도 사라짐)이라는 [4-1](./01-type-system-foundations.md)의 성질이 "멤버 삭제"의 표현 수단이 되는 것에 주목할 만하다 — 필터가 map + 빈 값으로 구현되는 함수형 관용구 그대로다.

분배는 강력한 만큼, **의도하지 않았을 때는 버그의 원천**이다.

```ts
type IsStringNaked<T> = T extends string ? true : false;
type X = IsStringNaked<string | number>; // boolean (= true | false) — 분배됐다!

// 분배를 막는 관용구: 튜플로 감싸면 T가 naked가 아니게 된다
type IsStringWhole<T> = [T] extends [string] ? true : false;
type Y = IsStringWhole<string | number>; // false — 유니언 전체로 한 번 판정
```

"유니언을 넣었더니 결과도 유니언으로 흩어진다"를 만나면 분배를, "유니언 전체를 하나로 판정하고 싶다"면 `[T] extends [U]`를 떠올리면 된다. 분배는 오직 naked 타입 매개변수에서만 일어난다는 조건이 정확한 진단 기준이다.

### infer: 타입 패턴 매칭

조건부 타입의 extends 절 안에서 `infer R`은 "이 위치의 타입을 R로 잡아라"라는 패턴 매칭이다. 표준 유틸리티 `ReturnType`을 직접 만들어 본다.

```ts
type MyReturnType<F> = F extends (...args: never[]) => infer R ? R : never;

type F1 = MyReturnType<() => string>;              // string
type F2 = MyReturnType<(x: number) => Promise<void>>; // Promise<void>
```

읽는 법: "F가 함수 꼴에 매칭되면, 반환 위치에서 잡힌 R을 내놓아라." 값 공간의 구조 분해(`const { data } = res`)가 타입 공간으로 온 것이다. 매개변수 쪽을 잡으면 `Parameters`, 배열 원소를 잡으면 원소 타입 추출이 된다.

```ts
type MyParameters<F> = F extends (...args: infer P) => unknown ? P : never;
type ElementOf<A> = A extends readonly (infer E)[] ? E : never;

type P1 = MyParameters<(id: number, name: string) => void>; // [id: number, name: string]
type E1 = ElementOf<string[]>;      // string
type E2 = ElementOf<[1, 2, 3]>;     // 3 | 2 | 1 — 튜플 원소들의 유니언
```

infer가 한 패턴에 여러 번 나오면 후보들이 통합되고([4-3](./03-generics-and-variance.md)의 추론 통합과 같은 원리), `infer R extends string`처럼 제약을 결합해 잡히는 타입을 제한할 수도 있다(TS 4.7+).

### mapped type: 객체 타입의 순회 변형

객체 타입의 프로퍼티들을 순회하며 새 객체 타입을 만드는 구문이다. 표준 유틸리티 대부분이 이것으로 만들어진다 — 직접 구현하며 확인한다.

```ts
// keyof T의 각 키 K에 대해, 프로퍼티를 옵셔널로 복사한다
type MyPartial<T> = { [K in keyof T]?: T[K] };

// 반대: -? 는 옵셔널 수식어를 "제거"한다
type MyRequired<T> = { [K in keyof T]-?: T[K] };

// readonly도 같은 방식으로 추가/제거된다
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };

// 순회 대상을 keyof T가 아니라 주어진 키 유니언으로 제한하면 Pick
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };

// Omit = "빼고 남은 키들로 Pick" — 유틸리티의 합성
type MyOmit<T, K extends PropertyKey> = MyPick<T, MyExclude<keyof T, K>>;
```

`[K in keyof T]`가 순회, `T[K]`(인덱스 접근)가 원본 값 타입 참조, `?`/`readonly`와 `-` 접두사가 수식어 조작이다. 수식어를 "제거"할 수 있다는 것(`-?`, `-readonly`)이 처음에는 낯설지만, mapped type이 복사가 아니라 **변형 규칙의 서술**이라는 관점에서는 자연스럽다.

TS 4.1의 key remapping(`as`)은 순회 중 키 자체를 바꾸는 확장이다.

```ts
// 각 키를 "get" + 대문자화로 바꾼 getter 인터페이스를 계산한다
type Getters<T> = {
  [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K];
};

interface User { id: number; name: string }
type UserGetters = Getters<User>;
// { getId: () => number; getName: () => string }
```

`as` 절이 never를 반환하면 그 키는 결과에서 빠진다 — 값 조건으로 키를 필터링하는 관용구(`[K in keyof T as T[K] extends Function ? never : K]`)가 여기서 나온다.

### template literal type: 문자열의 타입 레벨 조합과 분해

위의 `` `get${Capitalize<K & string>}` `` 이 template literal type이다. 문자열 리터럴 타입을 조합하고, infer와 결합하면 **분해**도 된다.

```ts
// 조합: 유니언이 들어가면 분배되어 조합 전체가 생성된다
type Dir = "top" | "bottom";
type Side = "left" | "right";
type Corner = `${Dir}-${Side}`;
// "top-left" | "top-right" | "bottom-left" | "bottom-right"

// 분해: 패턴 매칭으로 문자열 구조를 파싱한다
type EventName<S> = S extends `on${infer E}` ? Uncapitalize<E> : never;
type E3 = EventName<"onClick">;  // "click"
type E4 = EventName<"onChange">; // "change"
```

이 도구의 실전 가치는 **문자열 규약을 타입으로 승격**하는 데 있다. JS 생태계에는 문자열 컨벤션 API가 많다 — 이벤트 이름(`on` + 대문자), 경로 파라미터(`/users/:id`), 액션 타입(`"user/fetch"`). 문자열이라 검사 불가능했던 규약이 template literal type으로 닫힌 집합이 된다.

```ts
// 경로 문자열에서 파라미터 객체 타입을 "계산"한다 — 재귀 조건부 타입과의 결합
type PathParams<S extends string> =
  S extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof PathParams<Rest>]: string }
    : S extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : {};

type P = PathParams<"/users/:userId/posts/:postId">;
// { userId: string; postId: string }
```

이 예제가 세 부품(template literal 분해, 재귀, mapped type)의 합성이자, 타입 레벨 언어가 "언어"인 이유의 시연이다. 라우팅 라이브러리들이 경로 오타를 컴파일 에러로 만드는 원리가 정확히 이것이다.

### 재귀와 그 한계: 계산에는 예산이 있다

타입 공간의 루프는 재귀다. 그리고 재귀에는 명시적 예산이 있다 — tsc는 조건부 타입의 재귀 인스턴스화를 **깊이 약 50, 꼬리 재귀로 인정되는 경우 약 1000**에서 자르고 `TS2589: Type instantiation is excessively deep and possibly infinite`를 낸다. 유니언에도 크기 상한이 있다(멤버 수만 단위에서 `TS2590: union type that is too complex to represent`).

이 한계는 결함이 아니라 설계다. 타입 검사는 에디터 키 입력마다 도는 계산이므로, 튜링 완전에 가까운 언어가 무한히 돌게 둘 수 없다. 실무적 함의는 두 가지다.

- **폭발은 조합에서 온다.** template literal에 유니언을 넣으면 분배가 곱집합을 만든다 — 멤버 10개짜리 유니언 4개를 조합하면 10,000개 유니언이다. "타입은 맞는데 에디터가 느려졌다"의 흔한 범인.
- **한계에 닿았다면 설계 신호다.** 재귀 깊이 에러를 우회 기교(깊이 카운터 튜플 등)로 뚫는 것은 대개 잘못된 방향이다 — 그 계산이 정말 타입 공간에서 일어나야 하는지(코드 생성이 대안은 아닌지)를 먼저 묻는다.

성능은 주장이 아니라 계측 대상이다. `tsc --noEmit --extendedDiagnostics`가 검사 시간·인스턴스화 횟수(Instantiations)·메모리를 보여 주고, 특정 파일이 병목이면 `tsc --generateTrace <dir>`의 산출물을 크롬 DevTools의 Performance 패널(trace 열기) 또는 `@typescript/analyze-trace`로 열어 어느 타입의 인스턴스화가 시간을 먹는지 특정할 수 있다. "타입 때문에 느리다"는 추측을 이 절차가 사실로 바꾼다.

## 실무 관점

### 정당한 자리와 과잉의 자리

타입 레벨 프로그래밍의 비용은 명확하다: 읽는 사람이 이 문서의 내용을 알아야 하고, 에러 메시지가 전개된 내부 구조로 터지며, 검사 시간이 든다. 이 비용을 지불할 가치가 있는 자리는 대체로 정해져 있다.

| 자리 | 판단 | 근거 |
|---|---|---|
| 라이브러리의 공개 API 경계 | 정당 | 한 번의 복잡성으로 모든 소비자가 정확한 추론을 얻는다 — 비용 1회, 이득 N회 |
| 문자열 규약의 승격 (경로, 이벤트 이름) | 정당 | 런타임 검증이 불가능했던 오타를 컴파일 에러로 바꾼다 |
| 코드 생성의 대체 (스키마→타입) | 조건부 | 생성기 유지보수 vs 타입 계산 복잡성의 트레이드오프 — 규모가 크면 생성기가 이긴다 |
| 애플리케이션 코드의 DRY (비슷한 타입 두 개를 계산으로 통합) | 대개 과잉 | 중복 타입 두 개가 mapped type 하나보다 읽기 쉽고 에러도 명확하다 |
| "타입 퍼즐" 스타일의 곡예 | 과잉 | 유지보수자가 해독해야 하는 코드는 실패한 코드다 |

경험칙: **hover했을 때 결과 타입이 사람이 읽을 수 있는 형태로 전개되는가.** 전개 결과가 화면을 넘기면 소비자에게 복잡성을 전가한 것이다.

### 표준 유틸리티부터, 직접 구현은 그다음

TS에 내장된 유틸리티 타입(Partial, Required, Readonly, Pick, Omit, Exclude, Extract, NonNullable, ReturnType, Parameters, Awaited, Record...)은 이 문서의 부품들로 만들어진 표준 어휘다. 직접 구현해 본 것은 원리 이해를 위해서고, **실전에서는 표준을 쓴다** — 팀원 모두가 아는 이름이고, 컴파일러가 일부(Awaited 등)를 특별 취급해 더 정확하기 때문이다. 직접 만드는 것이 정당한 경우는 표준에 없는 도메인 어휘(`DeepPartial`, `PathParams`)가 반복적으로 필요할 때이며, 이때도 이름을 값 함수처럼 동사구로 붙이고 테스트를 단다.

타입의 테스트는 값 테스트와 같은 원리로 가능하다.

```ts
// 타입 단언 테스트 관용구 — 조건이 어긋나면 이 파일이 컴파일되지 않는다
type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type _test1 = Expect<Equal<MyPartial<{ a: number }>, { a?: number }>>;
type _test2 = Expect<Equal<PathParams<"/u/:id">, { id: string }>>;
```

라이브러리 타입을 작성한다면 이런 테스트 파일(또는 vitest의 `expectTypeOf`, `tsd`)이 리팩터링의 안전망이 된다.

### 에러 메시지 읽기: 전개를 거슬러 올라가기

계산된 타입의 에러는 **계산 결과가 전개된 형태**로 나온다 — `Getters<User>` 자리에 `{ getId: () => number; ... }`가 인쇄된다. 이때 원인 추적의 요령은 에러 메시지의 마지막 줄부터 읽는 것이다. tsc는 판정 실패를 바깥 타입부터 안쪽으로 좁혀 가며 보고하므로("Types of property 'x' are incompatible" 연쇄), 마지막 줄이 실제로 어긋난 원자적 판정이다. 중간 결과를 보고 싶으면 hover 대신 임시 타입 별칭에 담아 전개시키는 방법이 있다 — 관용구 `type Debug<T> = { [K in keyof T]: T[K] }`는 교차 타입 등을 단일 객체 타입으로 펼쳐 보여 준다.

## 더 깊이

### 인스턴스화는 지연되고 캐시된다

`type ToArray<T> = ...`를 선언하는 시점에 tsc는 아무것도 계산하지 않는다 — 조건부 타입은 타입 인자가 확정될 때까지 **지연(deferred)** 상태로 남는다. 제네릭 함수 본문 안에서 `ToArray<T>`가 미해결로 보이는 것이 이 때문이다: T가 아직 매개변수라서 분기를 결정할 수 없고, 검사기는 양쪽 분기 모두에 안전한 판정만 통과시킨다. "제네릭 함수 안에서는 조건부 타입에 할당이 안 되는데, 호출하면 잘 된다"는 흔한 미스터리의 답이다.

인스턴스화 결과는 타입 ID 조합을 키로 캐시된다. 같은 `Partial<User>`를 백 번 써도 계산은 한 번이다 — 역으로, 매번 다른 익명 타입을 만들어 넣는 패턴(인라인 객체 타입의 반복)은 캐시를 무효화해 Instantiations 수치를 밀어 올린다. `--extendedDiagnostics`의 Instantiations가 수백만 단위라면 이 캐시가 안 먹는 지점을 의심한다.

### homomorphic mapped type: 수식어가 보존되는 이유

`MyPartial<T>`에 옵셔널·readonly가 이미 섞인 타입을 넣어도 기존 수식어가 유지된다. 이것은 `[K in keyof T]` 형태 — 순회 대상이 정확히 `keyof T`인 mapped type을 검사기가 **homomorphic**(구조 보존)으로 특별 취급하기 때문이다. homomorphic mapped type은 원본 프로퍼티의 수식어를 복사한 위에 선언된 수식어 조작을 적용하고, 튜플·배열에 적용하면 객체가 아니라 튜플·배열을 유지하며(`MyReadonly<[1, 2]>`는 `readonly [1, 2]`), `Getters`처럼 `as`로 키를 바꾸면 이 특별 취급이 사라진다. "같아 보이는 mapped type이 배열에서 다르게 동작하는" 사례들의 원인이 이 구분이다.

### Awaited가 재귀인 이유

`Awaited<T>`는 단순히 `T extends Promise<infer V> ? V : T`가 아니다 — thenable의 재귀적 흡수([3-6](../phase-3/06-promises-and-async.md)의 resolve 규칙)를 타입으로 재현해야 하므로, `Promise<Promise<string>>`을 string까지 풀고 커스텀 thenable도 처리하는 재귀 조건부 타입이다. 런타임 의미론(await의 동작)과 타입 정의가 정확히 대응해야 하는 사례로, lib.es5.d.ts의 실제 정의를 읽어 보면 이 문서의 부품들(infer, 분배 방지, 재귀)이 전부 등장한다 — 표준 라이브러리 자체가 타입 레벨 프로그래밍의 교본이다.

## 정리

- 타입 공간에는 제네릭(함수)·조건부 타입(분기)·재귀(루프)·유니언(컬렉션)·infer(패턴 매칭)로 이루어진 순수 함수형 언어가 있다. 유틸리티 타입은 이 언어로 짠 표준 라이브러리다.
- 조건부 타입은 naked 타입 매개변수에서 유니언에 분배된다 — Exclude가 이 규칙의 산물이고, `[T] extends [U]`가 분배를 막는 관용구다.
- infer는 함수·배열·문자열 등 타입 구조에서 부분을 잡아내는 패턴 매칭이고, mapped type은 `[K in keyof T]` 순회로 객체 타입을 변형하며 수식어를 추가·제거(`-?`)할 수 있다. template literal type은 문자열 규약을 닫힌 타입 집합으로 승격한다.
- 타입 계산에는 예산이 있다(재귀 깊이 제한, 유니언 크기 상한). 조합 폭발이 에디터 반응성을 잡아먹으며, `tsc --extendedDiagnostics`와 `--generateTrace`로 계측한다.
- 정당한 자리는 라이브러리 경계와 문자열 규약의 승격이다. 애플리케이션 코드에서 중복 타입 두 개는 대개 계산된 타입 하나보다 낫다 — hover 결과를 사람이 읽을 수 없다면 과잉의 신호다.

## 확인 문제

**Q1.** 다음 두 타입의 결과가 왜 다른지 분배 규칙으로 설명하라.

```ts
type A = string | number extends string ? "yes" : "no";

type Check<T> = T extends string ? "yes" : "no";
type B = Check<string | number>;
```

<details>
<summary>정답과 해설</summary>

A는 `"no"`, B는 `"yes" | "no"`다.

A에는 타입 매개변수가 없다 — `string | number`라는 구체 타입이 통째로 `extends string` 판정을 받고, 유니언 전체는 string에 할당 불가능하므로 "no"다. 분배는 일어나지 않는다.

B는 **naked 타입 매개변수** T의 검사이므로 분배가 일어난다: `Check<string> | Check<number>` = `"yes" | "no"`. 분배는 "조건부 타입"의 성질이 아니라 "naked 타입 매개변수에 유니언이 대입되는 상황"의 성질이라는 것이 이 문제의 핵심이다. B에서 분배를 막아 A와 같은 판정을 원하면 `[T] extends [string]`으로 감싼다.

</details>

**Q2.** API 클라이언트의 메서드 이름 규약이 `fetchUser`, `fetchPosts`처럼 `fetch` + 자원명이다. 다음 타입이 하는 일을 단계별로 설명하고, `resource`의 타입이 무엇이 되는지 답하라.

```ts
interface Api {
  fetchUser(): Promise<unknown>;
  fetchPosts(): Promise<unknown>;
  clearCache(): void;
}

type ResourceOf<T> = keyof {
  [K in keyof T as K extends `fetch${infer R}` ? Uncapitalize<R> : never]: true;
};

declare const resource: ResourceOf<Api>;
```

<details>
<summary>정답과 해설</summary>

`resource`의 타입은 `"user" | "posts"`다. 단계별로:

1. `[K in keyof T ...]` — Api의 키 `"fetchUser" | "fetchPosts" | "clearCache"`를 순회한다.
2. `as K extends \`fetch${infer R}\` ? ... : never` — key remapping에서 각 키를 template literal 패턴에 매칭한다. `"fetchUser"`는 R = `"User"`로 매칭되어 `Uncapitalize<"User">` = `"user"`로 리매핑되고, `"clearCache"`는 매칭 실패로 never가 된다 — **as 절의 never는 그 키를 결과에서 제거**한다.
3. 결과 객체 타입은 `{ user: true; posts: true }`이고, `keyof`가 키 유니언 `"user" | "posts"`를 뽑는다.

문자열 규약(fetch 접두사)이 타입 집합으로 승격됐다 — 이제 `loadResource(name: ResourceOf<Api>)` 같은 함수가 자원명 오타를 컴파일 에러로 잡는다. Api에 `fetchComments`를 추가하면 이 유니언이 자동으로 갱신된다는 것이 계산된 타입의 가치다.

</details>

**Q3.** 팀원이 폼 검증을 위해 다음 타입을 만들었고, 이후 에디터가 눈에 띄게 느려졌다. 원인 후보를 계측으로 특정하는 절차와, 설계 대안을 제시하라.

```ts
type Field = "email" | "phone" | "address" | "name" | /* ...20개 */ "memo";
type Locale = "ko" | "en" | "ja" | /* ...10개 */ "de";
type Rule = "required" | "min" | "max" | /* ...8개 */ "pattern";

type MessageKey = `${Field}.${Locale}.${Rule}`; // 모든 조합의 메시지 키
type Messages = Record<MessageKey, string>;
```

<details>
<summary>정답과 해설</summary>

원인: template literal type에 유니언이 들어가면 분배가 **곱집합**을 만든다 — 20 × 10 × 8 = 1,600개 멤버의 유니언이 생기고, `Record`가 그것을 1,600개 프로퍼티의 객체 타입으로 전개한다. 이 타입이 등장하는 모든 파일에서 검사기가 이 구조를 다루므로 에디터 반응성이 떨어진다. 조합 수가 유니언 상한(수만)에 닿으면 TS2590으로 아예 실패한다.

계측 절차: ① `tsc --noEmit --extendedDiagnostics`로 전체 검사 시간과 Instantiations·Types 수치를 기록한다. ② 문제 타입을 주석 처리하고 재실행해 차이를 확인한다 — 수치 차이가 크면 범인 확정. ③ 더 정밀하게는 `tsc --generateTrace trace` 산출물을 `@typescript/analyze-trace`로 분석해 어느 타입의 인스턴스화가 시간을 차지하는지 본다. "느려진 것 같다"를 수치로 바꾸는 것이 먼저다.

설계 대안: 이 타입이 실제로 강제하는 것이 무엇인지 묻는다. 메시지 키 오타 방지가 목적이라면 ① 전체 곱집합 대신 **실제로 존재하는 키만** 담은 as const 객체에서 `keyof typeof`로 타입을 도출하거나(존재하는 메시지는 1,600개보다 훨씬 적을 것이다), ② 차원을 분리해 `Record<Field, Record<Locale, Partial<Record<Rule, string>>>>`처럼 중첩 구조로 바꾸면 유니언 폭발 없이 같은 검사를 얻는다. 곱집합 유니언은 "모든 조합이 유효하고 전부 열거해야 하는" 드문 경우에만 정당하다.

</details>

## 참고 자료

- [TypeScript Handbook — Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html) — 분배 조건과 infer의 공식 서술. "naked type parameter" 규칙의 원전.
- [TypeScript Handbook — Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html) — 수식어 조작과 key remapping.
- [TypeScript Handbook — Template Literal Types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html) — 조합·분해와 내장 문자열 조작 타입(Capitalize 등).
- [TypeScript Handbook — Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html) — 표준 어휘 전체 목록. 직접 구현과 대조하며 읽는다.
- [TypeScript Wiki — Performance](https://github.com/microsoft/TypeScript/wiki/Performance) — 타입 수준 병목의 공식 진단 가이드(extendedDiagnostics, generateTrace 사용법 포함).
- [type-challenges](https://github.com/type-challenges/type-challenges) — 타입 레벨 언어의 연습 문제집. 원리 확인용으로 유용하나, 실무 코드의 기준이 아니라 체조라는 점을 전제로.
