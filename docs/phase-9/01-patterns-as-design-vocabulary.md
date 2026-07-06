# 9-1. 패턴을 설계 어휘로 읽기

> 한 줄 요약: 이 문서를 읽고 나면 설계 패턴을 코드 템플릿이 아니라 변경 축, 의존성 방향, 테스트 경계, 런타임 비용을 드러내는 의사소통 도구로 사용할 수 있다.

이 문서는 JavaScript의 일급 함수, 클로저(closure), 프로토타입(prototype), ECMAScript 모듈(ESM), TypeScript의 구조적 타입 시스템을 전제한다. React 예제는 React 19의 함수 컴포넌트와 hook 모델만 사용한다. 클래스 컴포넌트, mixin, legacy lifecycle은 현재 코드베이스를 읽기 위한 역사적 맥락으로만 언급한다.

## 학습 목표

- 설계 패턴을 문제, 맥락, 힘(force), 결과(consequence)의 묶음으로 설명할 수 있다.
- 전통적 객체지향 패턴이 JavaScript에서 함수, 객체 리터럴, 클로저, ESM으로 다른 형태를 갖는 이유를 설명할 수 있다.
- 변경 축, 상태 소유권, 의존성 방향, 테스트 경계, 런타임 비용을 기준으로 패턴 적용 여부를 판단할 수 있다.
- 패턴 이름을 붙이는 것과 불필요한 간접층을 추가하는 것을 구분할 수 있다.
- "패턴을 쓰지 않는 결정"도 설계 판단으로 문서화할 수 있다.

## 배경: 왜 이것이 존재하는가

설계 패턴(design pattern)은 원래 특정 언어 기능의 부족을 보완하기 위한 코드 조각 모음이 아니었다. 반복해서 나타나는 설계 문제를 설명하기 위한 **공통 어휘**였다. 같은 문제를 겪은 개발자들이 "여기서는 strategy가 필요하다"라고 말할 때, 핵심은 특정 클래스 다이어그램이 아니라 "조건 분기의 변경 축을 실행 시점에 교체 가능한 정책으로 분리하자"는 판단이다.

문제는 이 어휘가 Java, C++, Smalltalk 같은 클래스 중심 언어의 예제로 널리 전파되었다는 점이다. JavaScript는 다른 재료를 가진다. 함수가 값이고, 클로저가 private 상태를 만들 수 있으며, 객체는 명목적 클래스보다 구조가 중요하고, ESM은 모듈 스코프와 정적 그래프를 제공한다. TypeScript는 런타임 클래스를 강제하지 않고도 구조적 계약을 표현한다. 그래서 GoF 패턴의 모양을 그대로 옮기면 오히려 JavaScript의 단순한 해법을 우회하는 경우가 많다.

예를 들어 "factory pattern"은 Java에서는 생성자 호출을 숨기고 인터페이스 타입을 반환하는 클래스가 되기 쉽다. JavaScript에서는 단순 함수 하나가 같은 역할을 한다. "module pattern"은 과거 IIFE로 스코프를 만들던 기법이었지만, ESM 이후에는 언어의 기본 단위가 되었다. "singleton"은 전역 인스턴스 1개 보장이라기보다 모듈 캐시와 전역 상태 공유의 비용으로 읽어야 한다.

따라서 Phase 9의 목적은 패턴 이름을 많이 외우는 것이 아니다. 이미 Phase 3~8에서 배운 JavaScript 런타임, TypeScript 타입 설계, React 렌더링 모델 위에서 "이 구조가 실제 문제를 줄이는가, 아니면 문제를 다른 이름으로 숨기는가"를 판단하는 것이다.

## 핵심 개념

### 패턴은 코드가 아니라 힘의 이름이다

패턴을 적용하기 전에 먼저 힘(force)을 식별한다. 힘은 설계를 서로 다른 방향으로 당기는 압력이다.

```text
문제: 결제 수단마다 수수료 계산이 다르다.
힘 1: 결제 수단은 자주 추가된다.
힘 2: 계산 결과는 테스트 가능해야 한다.
힘 3: 호출자는 결제 수단별 세부 규칙을 몰라야 한다.
힘 4: 수수료 계산은 요청마다 실행되므로 불필요한 객체 생성은 피하고 싶다.
```

이 힘을 보지 않고 "strategy를 쓰자"라고 시작하면 설계가 이름에 끌려간다. 반대로 힘을 먼저 쓰면 선택지가 보인다. 단순 `switch`가 충분한지, 함수 테이블이 필요한지, 외부 설정으로 전략을 주입해야 하는지 판단할 수 있다.

나쁜 적용은 이름이 문제보다 먼저 나온다.

```ts
type PaymentMethod = "card" | "transfer" | "point";

// ❌ 변경 축이 아직 작고 계산 규칙도 한 파일에 모여 있는데,
// 패턴 이름을 위해 클래스 계층을 먼저 만든다.
abstract class FeeStrategy {
  abstract calculate(amount: number): number;
}

class CardFeeStrategy extends FeeStrategy {
  calculate(amount: number) {
    return amount * 0.03;
  }
}

class TransferFeeStrategy extends FeeStrategy {
  calculate(amount: number) {
    return 500;
  }
}
```

같은 힘을 JavaScript식으로 읽으면 더 작은 구조로 충분할 수 있다.

```ts
type PaymentMethod = "card" | "transfer" | "point";
type FeeCalculator = (amount: number) => number;

const feeByMethod: Record<PaymentMethod, FeeCalculator> = {
  card: (amount) => amount * 0.03,
  transfer: () => 500,
  point: () => 0,
};

export function calculateFee(method: PaymentMethod, amount: number) {
  return feeByMethod[method](amount);
}

console.log(calculateFee("card", 10_000)); // 출력: 300
```

여기서 패턴의 본질은 "조건 분기를 함수 테이블로 옮겼다"는 점이다. 클래스가 없어서 strategy가 아닌 것이 아니다. 변경 축이 결제 수단이고, 각 전략이 같은 입력과 출력을 가지며, 호출자가 전략 선택 이후의 계산 세부를 모른다면 패턴의 힘은 이미 충족된다.

경계 조건도 함께 본다. 결제 수단이 셋이고 규칙이 거의 안 바뀌면 명시적 `switch`가 더 낫다. 반대로 전략이 서버 설정에서 내려오거나, 실험군별로 바뀌거나, 플러그인처럼 외부에서 등록된다면 함수 테이블도 registry나 dependency injection으로 확장되어야 한다.

### JavaScript는 패턴의 구현 재료가 다르다

JavaScript에서 패턴의 모양을 바꾸는 재료는 네 가지다.

첫째, 함수는 값이다. 객체를 만들지 않고도 행위를 전달할 수 있다.

```ts
function withRetry<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown, attempt: number) => boolean,
) {
  return async function run() {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        attempt += 1;

        if (!shouldRetry(error, attempt)) {
          throw error;
        }
      }
    }
  };
}
```

`shouldRetry`는 strategy다. 별도 인터페이스나 추상 클래스가 없어도 된다. 함수 타입이 계약이고, 클로저가 필요한 상태를 붙잡는다.

둘째, 클로저는 private 상태를 만든다. 생성 패턴과 모듈 패턴은 class private field 없이도 캡슐화할 수 있다.

```ts
export function createCounter(initial = 0) {
  let value = initial;

  return {
    increment() {
      value += 1;
      return value;
    },
    read() {
      return value;
    },
  };
}

const counter = createCounter(10);
console.log(counter.increment()); // 출력: 11
console.log((counter as Record<string, unknown>).value); // 출력: undefined
```

셋째, 객체는 명목보다 구조가 중요하다. TypeScript의 구조적 타입 시스템에서는 특정 클래스를 상속하지 않아도 필요한 메서드 형태만 맞으면 계약을 만족한다.

```ts
interface Clock {
  now(): number;
}

function formatElapsed(clock: Clock, startedAt: number) {
  return `${clock.now() - startedAt}ms`;
}

const realClock = { now: () => Date.now() };
const testClock = { now: () => 1_700_000_000_000 };

console.log(formatElapsed(testClock, 1_699_999_999_000)); // 출력: 1000ms
```

넷째, ESM은 모듈 스코프와 한 번만 평가되는 모듈 캐시를 제공한다. 최상위 `const cache = new Map()`은 편하지만 사실상 프로세스 또는 브라우저 세션 안의 singleton이다. 이 선택은 테스트 격리, SSR 요청 격리, 번들 사이드 이펙트와 연결된다.

```ts
// user-cache.ts
const cache = new Map<string, unknown>();

export function readUser(id: string) {
  return cache.get(id);
}

export function writeUser(id: string, user: unknown) {
  cache.set(id, user);
}
```

이 코드는 간단하지만 "누가 언제 비우는가"라는 수명 문제가 생긴다. 브라우저 SPA에서는 합리적일 수 있고, SSR 서버에서는 사용자 요청 간 데이터가 섞일 수 있어 위험하다. 같은 코드 모양도 실행 환경에 따라 패턴의 결과가 달라진다.

### 패턴 적용 판단 기준

패턴은 복잡도를 없애지 않는다. 복잡도를 옮기고 이름 붙인다. 그래서 적용 전후로 어떤 비용이 이동하는지 확인해야 한다.

| 판단 축 | 묻는 질문 | 패턴이 도움이 되는 신호 | 패턴이 과한 신호 |
|---|---|---|---|
| 변경 축 | 무엇이 자주 바뀌는가 | 바뀌는 부분이 한 축으로 반복된다 | 변경이 드물고 예외가 적다 |
| 상태 소유권 | 상태의 원본은 어디인가 | 소유자를 분리하면 동기화가 줄어든다 | 상태가 여러 곳으로 복사된다 |
| 의존성 방향 | 누가 누구를 알아야 하는가 | 외부 경계를 안쪽 계약으로 감쌀 수 있다 | 단순 호출이 service locator가 된다 |
| 테스트 경계 | 무엇을 mock 또는 fake로 바꿔야 하는가 | 브라우저 API, 시간, 네트워크가 주입된다 | 테스트를 위해서만 추상화가 생긴다 |
| 런타임 비용 | 생성, 구독, 리렌더 비용은 어디서 생기는가 | 비용이 측정 가능하고 좁아진다 | 간접 호출과 객체 생성만 늘어난다 |
| 디버깅 가능성 | 흐름을 추적할 수 있는가 | 이벤트와 상태 전이가 기록된다 | pub-sub으로 원인 경로가 사라진다 |

예를 들어 외부 API 응답을 내부 모델로 바꾸는 adapter는 대부분 가치가 있다. 외부 스키마는 바뀌고, 내부 코드는 안정된 계약을 원한다. 반대로 컴포넌트 내부에서만 쓰는 계산 함수를 "service"로 빼는 것은 의존성 방향을 선명하게 만들지 못한다면 비용만 늘린다.

### 패턴은 의사결정 기록과 함께 완성된다

패턴을 썼다는 사실보다 왜 썼는지가 오래 남는다. 작은 ADR(Architecture Decision Record)은 충분하다.

```md
# ADR: 가격 계산을 함수 테이블 기반 strategy로 분리한다

## 문제
결제 수단별 수수료 규칙이 분기문에 섞여 있고, 새 수단 추가 때 기존 조건문을 수정해야 한다.

## 선택
`Record<PaymentMethod, FeeCalculator>` 형태의 함수 테이블을 사용한다.

## 대안
- `switch`: 단순하지만 변경 축이 한 함수에 계속 누적된다.
- 클래스 strategy: 현재 규칙에는 생성자 상태와 상속 계층이 필요 없다.

## 검증
결제 수단별 단위 테스트를 독립적으로 작성하고, 누락된 key는 TypeScript가 잡는다.

## 재검토 조건
전략이 원격 설정에서 등록되거나, 수수료 계산에 외부 의존성이 필요해지면 factory + DI로 확장한다.
```

"패턴을 쓰지 않는다"도 같은 형식으로 기록할 수 있다. 예를 들어 옵션이 두 개뿐인 요청 빌더에 builder를 쓰지 않기로 한 결정은 좋은 설계 판단이다. 패턴은 늘리는 것이 목표가 아니라 변경 비용을 예측 가능하게 만드는 도구다.

## 실무 관점

### 패턴 이름이 설계를 가리는 경우

실무에서 가장 흔한 실패는 패턴 이름이 문제를 설명하는 대신 문제를 덮는 경우다.

```ts
// ❌ "Manager", "Service", "Factory"라는 이름은 있지만 변경 축이 드러나지 않는다.
class UserManagerFactoryService {
  create() {
    return {
      getUser: (id: string) => fetch(`/users/${id}`).then((r) => r.json()),
    };
  }
}
```

이 코드는 factory, service, manager라는 단어를 동시에 쓰지만 실제 판단 기준은 없다. 무엇을 생성하는가, 왜 생성 책임을 분리했는가, fetch를 어떻게 교체하는가가 보이지 않는다.

```ts
type FetchJson = <T>(url: string) => Promise<T>;

export function createUserRepository(fetchJson: FetchJson) {
  return {
    findById(id: string) {
      return fetchJson<{ id: string; name: string }>(`/users/${id}`);
    },
  };
}
```

두 번째 코드는 이름이 더 작지만 경계가 선명하다. 외부 의존성은 `fetchJson`으로 주입되고, repository는 사용자 API의 내부 계약만 제공한다. 테스트에서는 `fetchJson`을 fake로 바꾸면 된다.

### 단순 분기와 패턴의 트레이드오프

명시적 분기는 나쁜 것이 아니다. 분기가 흩어져 있을 때 문제가 된다.

| 선택 | 장점 | 비용 | 적합한 조건 | 무너지는 조건 |
|---|---|---|---|---|
| `if`/`switch` | 흐름이 한눈에 보인다 | 분기가 커지면 변경 충돌이 생긴다 | 경우의 수가 작고 변경이 드물다 | 같은 분기가 여러 곳에 복제된다 |
| 함수 테이블 | 변경 축이 데이터 구조로 드러난다 | 간접 호출로 흐름 추적이 한 단계 늘어난다 | 같은 입력/출력의 정책이 반복된다 | 정책마다 필요한 의존성이 크게 다르다 |
| 객체/클래스 전략 | 상태와 행위를 묶을 수 있다 | 생성과 수명 관리가 필요하다 | 전략마다 설정, 캐시, 외부 의존성이 있다 | 상태 없는 순수 함수로 충분하다 |
| 플러그인 registry | 확장 지점을 외부에 열 수 있다 | 등록 순서, 충돌, 디버깅 비용이 생긴다 | 제품/조직 단위 확장이 필요하다 | 같은 팀의 작은 코드베이스다 |

경계 조건은 "미래에 바뀔 수도 있다"가 아니다. 모든 것은 미래에 바뀔 수 있다. 패턴을 정당화하려면 현재 이미 반복되는 변경 축, 테스트 경계, 배포 단위, 팀 경계가 있어야 한다.

### 성능과 디버깅 비용은 측정 가능한 형태로 둔다

패턴은 런타임 비용을 만들 수 있다. React의 compound component는 context consumer를 만들고, observer는 구독 목록을 만들며, middleware는 요청마다 함수 체인을 돈다. 비용 자체가 문제는 아니다. 문제는 비용이 어디서 생기는지 관찰할 수 없는 구조다.

검증 방법도 패턴별로 다르다.

- strategy와 adapter는 단위 테스트로 입력/출력 계약을 검증한다.
- observer와 command는 이벤트 로그 또는 액션 로그로 순서를 검증한다.
- React context 기반 패턴은 React DevTools Profiler로 리렌더 범위를 확인한다.
- module singleton은 테스트 실행 순서를 바꿔도 상태가 오염되지 않는지 확인한다.
- middleware는 실패 지점과 재시도 횟수를 로그로 남긴다.

측정하지 않는 패턴은 "좋아 보이는 구조"에 머문다. Phase 9의 실습에서 패턴 적용 전후 실행 로그, 테스트, Profiler 결과를 함께 남기는 이유가 여기에 있다.

## 더 깊이

### 구조적 타입 시스템은 패턴의 소속을 약하게 만든다

명목적 타입 시스템에서는 `class CardFeeStrategy implements FeeStrategy`처럼 패턴 참여자가 이름으로 묶인다. TypeScript에서는 구조가 맞으면 계약을 만족한다. 이것은 패턴 적용을 가볍게 만들지만, 동시에 "어떤 함수들이 같은 전략군인가"가 코드만으로 덜 명시적일 수 있다.

```ts
type Parser<T> = (input: string) => T;

const parseNumber: Parser<number> = (input) => Number(input);
const parseBoolean: Parser<boolean> = (input) => input === "true";
```

`Parser<T>`라는 타입 별칭은 런타임에는 사라지지만 설계 어휘로 남는다. TypeScript에서 패턴 이름은 클래스 계층보다 타입 별칭, 인터페이스, 파일 경계, 테스트 이름에 더 자주 남는다. 런타임에 남지 않는 어휘가 팀 의사소통에는 충분히 강력할 수 있다는 점이 JavaScript/TypeScript 코드베이스의 특징이다.

### 모듈 평가는 숨은 생성 시점이다

ESM은 import된 모듈을 한 번 평가하고 그 결과를 캐시한다. 이 특성 때문에 모듈 최상위 코드는 "보이지 않는 생성자"처럼 작동한다.

```ts
// analytics.ts
const sessionId = crypto.randomUUID();

export function track(event: string) {
  console.log(sessionId, event);
}
```

이 코드는 `track` 호출 시점이 아니라 모듈 평가 시점에 `sessionId`를 만든다. 브라우저 SPA에서는 앱 세션의 식별자로 적절할 수 있다. 테스트에서는 모듈 캐시 때문에 매 테스트가 같은 `sessionId`를 공유할 수 있다. SSR에서는 요청별로 달라야 하는 값이 모듈 스코프에 있으면 요청 간 누수가 된다.

생성 패턴을 읽을 때 "어느 함수가 객체를 만드는가"만 보지 말고 "모듈이 언제 평가되는가"까지 봐야 한다. JavaScript에서 생성 시점은 `new`, factory 호출, 모듈 평가, React render, hook 초기화로 분산된다.

### 구현 세부와 표준 보장의 경계

패턴 설명에서 엔진 최적화를 근거로 삼을 때는 조심해야 한다. 예를 들어 V8은 객체의 shape 또는 hidden class를 이용해 프로퍼티 접근을 최적화한다. 그래서 같은 구조의 객체를 반복해서 만드는 factory가 런타임에 유리할 수 있다. 하지만 hidden class는 ECMAScript 표준이 보장하는 모델이 아니라 엔진 구현 세부다. 설계 문서에서는 "객체 구조를 안정적으로 유지하면 주요 엔진의 최적화에 유리할 수 있다" 정도로만 쓰고, 올바른 동작의 근거로 삼지 않는다.

표준이 보장하는 것은 프로퍼티 접근, 프로토타입 탐색, 모듈 평가 순서, 함수 호출 의미론이다. 성능 판단은 Chrome DevTools Performance, Memory, React Profiler, 번들 분석 결과처럼 관찰 가능한 도구와 연결해야 한다.

## 정리

- 패턴은 코드 템플릿이 아니라 반복되는 힘과 선택의 이름이다. 이름보다 변경 축, 상태 소유권, 의존성 방향을 먼저 본다.
- JavaScript에서는 일급 함수, 클로저, 객체 리터럴, ESM, 구조적 타입 때문에 전통적 클래스 패턴이 더 작은 형태로 표현된다.
- 패턴은 복잡도를 없애지 않고 이동시킨다. 테스트 경계와 디버깅 가능성이 좋아지지 않는다면 간접층일 가능성이 높다.
- 단순 분기, 함수 테이블, 객체 전략, 플러그인 registry는 같은 문제의 다른 비용 구조다. 현재의 변경 압력이 선택을 정한다.
- 패턴을 쓰지 않기로 한 결정도 ADR로 남길 수 있다. 불필요한 추상화를 피하는 것도 설계 판단이다.

## 확인 문제

**Q1.** 결제 수단이 `card`, `transfer` 두 개뿐이고 1년 동안 추가 계획이 없다. 현재 `switch` 한 곳에서만 수수료를 계산한다. 이 코드를 strategy 패턴으로 바꾸자는 제안이 나왔다. 어떤 질문으로 판단해야 하는가?

<details>
<summary>정답과 해설</summary>

먼저 변경 축이 실제로 존재하는지 묻는다. 수수료 분기가 한 곳에 있고 경우의 수가 둘이며 변경이 드물다면 `switch`는 명시성과 낮은 비용이라는 장점이 있다. strategy로 바꾸려면 결제 수단 추가가 잦아지거나, 계산 규칙을 독립 테스트해야 하거나, 규칙을 런타임에 교체해야 하거나, 같은 분기가 여러 곳에 복제되는 신호가 있어야 한다. 그런 신호가 없다면 패턴 적용은 미래 가능성만으로 현재 간접층을 사는 결정이다. ADR에는 "현재는 명시적 분기를 유지하고, 결제 수단이 세 개 이상으로 늘거나 분기가 두 곳 이상 복제되면 함수 테이블로 전환한다"처럼 재검토 조건을 남길 수 있다.
</details>

**Q2.** 모듈 최상위에 `const cache = new Map()`을 두고 여러 함수가 공유한다. 이 구조를 singleton으로 볼 수 있는 이유와, SSR 환경에서 위험해지는 이유를 설명하라.

<details>
<summary>정답과 해설</summary>

ESM은 모듈을 한 번 평가하고 캐시한다. 따라서 모듈 최상위의 `cache`는 해당 모듈을 import하는 모든 소비자가 공유하는 하나의 인스턴스가 된다. 이것이 JavaScript식 singleton의 흔한 형태다. 브라우저 SPA에서는 앱 세션 범위 캐시로 적절할 수 있지만, SSR 서버에서는 여러 사용자의 요청이 같은 프로세스와 같은 모듈 인스턴스를 공유할 수 있다. 요청별 데이터나 권한 관련 값을 모듈 캐시에 넣으면 사용자 간 데이터가 섞일 위험이 있다. 요청 스코프 factory나 명시적 캐시 인스턴스 주입으로 수명을 분리해야 한다.
</details>

**Q3.** TypeScript 코드에서 `interface Parser<T> { parse(input: string): T }`를 구현하는 클래스 없이 `(input: string) => T` 함수 타입을 사용했다. 이것은 패턴을 포기한 것인가?

<details>
<summary>정답과 해설</summary>

아니다. 패턴의 본질이 "동일한 입력 계약을 가진 여러 파싱 전략을 교체 가능하게 한다"라면 함수 타입도 같은 힘을 해결한다. JavaScript에서는 함수가 값이므로 상태 없는 전략은 함수 하나가 가장 작은 구현이다. 클래스가 필요한 경우는 전략마다 private 상태, 설정, 수명, 여러 메서드가 필요할 때다. TypeScript의 구조적 타입 시스템에서는 런타임 상속 계층보다 타입 별칭과 테스트 이름이 패턴 어휘를 담당할 수 있다.
</details>

## 참고 자료

- [ECMA-262 — ECMAScript Language Specification](https://tc39.es/ecma262/) — 함수, 객체, 모듈 평가, 프로퍼티 접근의 표준 동작 모델을 확인할 수 있다.
- [MDN — JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — ESM의 모듈 스코프, import/export, 브라우저 동작을 정리한 공식 참고 자료다.
- [TypeScript Handbook — Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html) — 구조적 타입 시스템이 명목적 계층 없이 계약을 판단하는 방식을 설명한다.
- [React — Thinking in React](https://react.dev/learn/thinking-in-react) — React 함수 컴포넌트 설계에서 상태 소유권과 합성 경계를 나누는 기본 모델을 제공한다.
