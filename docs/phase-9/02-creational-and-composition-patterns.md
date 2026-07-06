# 9-2. 생성·구성 패턴

> 한 줄 요약: 이 문서를 읽고 나면 객체와 서비스를 어디에서 만들고 어떤 의존성을 주입해야 테스트 가능성, 번들 경계, 상태 수명이 예측 가능한지 판단할 수 있다.

이 문서는 [9-1 패턴을 설계 어휘로 읽기](./01-patterns-as-design-vocabulary.md)의 판단 기준을 전제로 한다. 예제는 JavaScript와 TypeScript의 함수, 객체 리터럴, 클래스, ESM을 사용한다. 서버 프레임워크의 DI 컨테이너나 reflect metadata 기반 런타임 주입은 다루지 않는다.

## 학습 목표

- factory function과 class constructor가 생성 책임, private 상태, 타입 추론, mock 경계에서 어떻게 다른지 설명할 수 있다.
- builder가 옵션 조합의 복잡도를 낮추는 조건과, 단순 옵션 객체보다 과해지는 조건을 판단할 수 있다.
- ESM module pattern이 private 상태, 초기화 시점, 사이드 이펙트, tree shaking과 어떻게 연결되는지 설명할 수 있다.
- singleton을 "인스턴스 1개"가 아니라 전역 상태 공유의 비용으로 읽을 수 있다.
- fetch, clock, storage, crypto 같은 외부 경계를 dependency injection으로 분리하고 테스트할 수 있다.

## 배경: 왜 이것이 존재하는가

생성·구성 패턴(creational and composition patterns)은 "무엇을 만들 것인가"보다 "누가 만들 권한을 가지는가"의 문제다. 프론트엔드 코드에서는 생성 책임이 생각보다 많은 경계와 얽힌다. `fetch`는 네트워크와 HTTP 캐시를 만지고, `Date.now()`는 테스트를 불안정하게 만들며, `localStorage`는 동기 I/O와 보안 경계를 갖고, React 렌더 중 객체 생성은 리렌더와 참조 안정성에 영향을 준다.

전통적 객체지향 언어에서는 생성 패턴이 `new`와 class 계층을 감싸는 모양으로 설명되는 경우가 많다. JavaScript에서는 `new` 자체가 필수 출발점이 아니다. 클로저를 반환하는 factory function, ESM 모듈 스코프, 객체 리터럴, 함수 주입이 모두 생성과 구성을 담당할 수 있다. 그래서 "factory class를 만들 것인가"보다 "생성 시점과 상태 수명이 어디에 놓이는가"를 먼저 보아야 한다.

백엔드 경험과 비교하면 의존성 주입(dependency injection)의 목적은 같다. DB 클라이언트, clock, logger를 직접 만들면 테스트와 환경 전환이 어려워진다. 프론트엔드에서는 그 대상이 브라우저 API, 네트워크 클라이언트, 스토리지, 라우터, feature flag, analytics SDK로 바뀐다. DI는 거창한 컨테이너가 아니라 외부 세계와 순수 로직 사이의 경계를 값으로 전달하는 기술이다.

## 핵심 개념

### Factory function은 생성과 private 상태를 작은 단위로 묶는다

클래스 생성자는 `new` 호출과 프로토타입 메서드를 제공한다. factory function은 어떤 값이든 반환할 수 있고, 클로저로 private 상태를 가질 수 있으며, 호출자가 `new`를 알 필요가 없다.

```ts
type FetchJson = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createFetchJson(baseUrl: string, fetchImpl: typeof fetch): FetchJson {
  return async function fetchJson<T>(path, init) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  };
}

const fetchJson = createFetchJson("https://api.example.com", fetch);
```

이 factory의 생성 책임은 세 가지다.

- `baseUrl`과 `fetchImpl`을 한 번 묶어 이후 호출자의 중복을 줄인다.
- 네트워크 실패 정책을 한 곳에 둔다.
- 테스트에서 `fetchImpl`을 fake로 교체할 경계를 만든다.

클래스로도 표현할 수 있다.

```ts
export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async json<T>(path: string, init?: RequestInit) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
```

둘 중 어느 쪽이 맞는지는 기능보다 힘이 정한다. 메서드가 여러 개이고 인스턴스 정체성이 중요하며 상속이 아니라도 `instanceof`나 class private field가 필요하면 클래스가 자연스럽다. 단일 행위와 캡처된 설정이면 factory function이 더 작다. TypeScript에서 둘 다 구조적으로 같은 계약을 만족할 수 있으므로, "클래스가 더 객체지향적이다"는 좋은 판단 기준이 아니다.

### Builder는 옵션 조합의 순서와 불변식을 드러낸다

옵션 객체는 JavaScript에서 가장 흔한 생성 패턴이다.

```ts
type SearchOptions = {
  query: string;
  page?: number;
  pageSize?: number;
  sort?: "relevance" | "createdAt";
  includeArchived?: boolean;
};

export function createSearchUrl(options: SearchOptions) {
  const params = new URLSearchParams({
    q: options.query,
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 20),
    sort: options.sort ?? "relevance",
  });

  if (options.includeArchived) {
    params.set("archived", "true");
  }

  return `/search?${params}`;
}
```

이 정도에서는 builder가 필요 없다. 옵션 객체는 읽기 쉽고 테스트도 쉽다. builder가 정당해지는 시점은 옵션 간 제약이 많아지고, 생성 과정의 순서가 의미를 갖거나, 중간 결과를 재사용해야 할 때다.

```ts
type SearchRequest = {
  path: string;
  headers: Headers;
};

class SearchRequestBuilder {
  private readonly params = new URLSearchParams();
  private readonly headers = new Headers({ accept: "application/json" });

  query(value: string) {
    this.params.set("q", value);
    return this;
  }

  page(value: number) {
    if (value < 1) {
      throw new Error("page must be positive");
    }

    this.params.set("page", String(value));
    return this;
  }

  auth(token: string) {
    this.headers.set("authorization", `Bearer ${token}`);
    return this;
  }

  build(): SearchRequest {
    if (!this.params.has("q")) {
      throw new Error("query is required");
    }

    return {
      path: `/search?${this.params}`,
      headers: new Headers(this.headers),
    };
  }
}

const request = new SearchRequestBuilder()
  .query("react")
  .page(2)
  .auth("token")
  .build();

console.log(request.path); // 출력: /search?q=react&page=2
```

builder의 이점은 "점 체이닝이 예쁘다"가 아니다. 생성 중 불변식을 한 곳에서 검사하고, 선택적 단계와 필수 단계를 분리하며, 최종 산출물을 불변에 가깝게 반환하는 것이다. 비용은 builder 인스턴스의 가변 상태, 호출 순서 추적, 테스트 표면 증가다. 옵션이 단순하면 builder는 의도를 흐린다.

### Module pattern은 ESM 이후 언어 기본값이 되었다

과거 module pattern은 IIFE로 private 스코프를 만드는 기법이었다. ESM 이후 모듈 스코프는 기본이다.

```ts
// token-store.ts
let accessToken: string | null = null;

export function setToken(token: string) {
  accessToken = token;
}

export function clearToken() {
  accessToken = null;
}

export function readToken() {
  return accessToken;
}
```

이 코드는 private 상태를 갖는 module pattern이다. `accessToken`은 export되지 않았으므로 외부가 직접 바꿀 수 없다. 그러나 ESM의 모듈 평가와 캐시 때문에 이 상태는 모듈 인스턴스 단위로 공유된다. 이것은 편리하지만 수명 문제가 생긴다.

테스트에서 다음과 같은 실패가 나타날 수 있다.

```ts
import { readToken, setToken } from "./token-store";

test("로그인하면 토큰을 읽는다", () => {
  setToken("a");
  expect(readToken()).toBe("a");
});

test("초기 토큰은 없다", () => {
  // 이전 테스트가 같은 모듈 인스턴스를 공유하면 실패할 수 있다.
  expect(readToken()).toBe(null);
});
```

이 경우 선택지는 셋이다.

- 테스트마다 `clearToken()`을 호출한다.
- 모듈 상태를 없애고 store 인스턴스를 factory로 만든다.
- 실제 제품 요구가 앱 전역 세션 상태라면 module pattern을 유지하고 테스트 격리 정책을 명시한다.

module pattern은 캡슐화 도구이면서 singleton의 한 형태다. private 상태가 있다는 사실보다 **그 상태의 수명과 공유 범위**가 설계 판단의 핵심이다.

### Singleton은 하나만 만든다는 말로 충분하지 않다

singleton은 "인스턴스가 하나"라는 구현보다 "모든 소비자가 같은 상태와 부수 효과를 공유한다"는 결과가 중요하다.

```ts
// ❌ 요청별 설정이 섞일 수 있는 전역 singleton
class AnalyticsClient {
  private userId: string | null = null;

  identify(userId: string) {
    this.userId = userId;
  }

  track(event: string) {
    console.log({ userId: this.userId, event });
  }
}

export const analytics = new AnalyticsClient();
```

브라우저 SPA에서 이 singleton은 현재 사용자 세션의 analytics로 적절할 수 있다. SSR 서버나 멀티 테넌트 앱에서는 위험하다. `identify()`가 전역 인스턴스 상태를 바꾸므로 요청 A의 사용자와 요청 B의 이벤트가 섞일 수 있다.

요청 또는 앱 인스턴스마다 생성하도록 바꾸면 수명이 명시된다.

```ts
type AnalyticsSink = (payload: { userId: string | null; event: string }) => void;

export function createAnalyticsClient(sink: AnalyticsSink) {
  let userId: string | null = null;

  return {
    identify(nextUserId: string) {
      userId = nextUserId;
    },
    track(event: string) {
      sink({ userId, event });
    },
  };
}

const analytics = createAnalyticsClient((payload) => {
  console.log(payload);
});
```

singleton을 완전히 금지할 필요는 없다. feature flag registry, 브라우저 세션 캐시, analytics SDK wrapper처럼 앱 전체에서 하나인 것이 요구사항일 수 있다. 다만 ADR에는 "왜 하나여야 하는가", "어떤 범위에서 하나인가", "테스트와 SSR에서 어떻게 초기화하는가"가 적혀야 한다.

### Dependency injection은 외부 세계를 값으로 넘긴다

DI는 컨테이너가 아니라 방향이다. 순수 로직이 외부 세계를 직접 import하거나 생성하지 않고, 필요한 능력을 인자로 받게 한다.

```ts
type Clock = {
  now(): number;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function createDraftRepository(storage: StorageLike, clock: Clock) {
  return {
    save(id: string, content: string) {
      storage.setItem(
        `draft:${id}`,
        JSON.stringify({
          content,
          updatedAt: clock.now(),
        }),
      );
    },
    read(id: string) {
      const raw = storage.getItem(`draft:${id}`);
      return raw ? (JSON.parse(raw) as { content: string; updatedAt: number }) : null;
    },
  };
}
```

테스트는 브라우저 API 없이 실행된다.

```ts
const memoryStorage = new Map<string, string>();

const storage: StorageLike = {
  getItem: (key) => memoryStorage.get(key) ?? null,
  setItem: (key, value) => {
    memoryStorage.set(key, value);
  },
};

const repository = createDraftRepository(storage, { now: () => 1000 });
repository.save("a", "hello");

console.log(repository.read("a"));
// 출력: { content: "hello", updatedAt: 1000 }
```

DI의 경계 조건은 과도한 매개변수다. 모든 작은 유틸리티가 `logger`, `metrics`, `config`, `clock`, `fetch`를 받기 시작하면 호출부가 컨테이너 역할을 떠안는다. 주입은 외부 효과가 있거나 테스트에서 교체해야 하는 경계에 집중한다. 순수 계산 함수에는 주입할 것이 없다.

## 실무 관점

### 생성 패턴 선택표

| 선택 | 장점 | 비용 | 적합한 조건 | 무너지는 조건 |
|---|---|---|---|---|
| 옵션 객체 | 단순하고 직렬화하기 쉽다 | 옵션 간 불변식이 흩어진다 | 옵션 수가 적고 순서가 없다 | 필수 단계와 선택 단계가 복잡하다 |
| Factory function | 클로저 private 상태, 작은 테스트 경계 | 반환 객체의 정체성이 약할 수 있다 | 단일 책임 인스턴스, 외부 의존성 캡처 | 메서드가 많고 상속/인스턴스 식별이 필요하다 |
| Class constructor | 프로토타입 메서드, private field, 인스턴스 정체성 | `new`와 생성자 계약이 노출된다 | 수명 있는 도메인 객체, 여러 메서드 | 상태 없는 함수 묶음 |
| Builder | 생성 단계와 불변식이 드러난다 | 가변 중간 상태와 API 표면 증가 | 옵션 조합과 검증 규칙이 많다 | 단순 옵션 객체로 충분하다 |
| Module singleton | import만으로 공유 가능 | 테스트 격리, SSR 요청 격리, 초기화 순서 문제 | 앱 세션 전역 값 | 요청별/사용자별 상태 |
| DI | 테스트와 환경 전환이 쉽다 | 호출부 구성 코드가 필요하다 | 브라우저 API, 네트워크, 시간, 저장소 | 순수 계산 함수 |

선택은 추상화 수준이 아니라 수명과 변경 축으로 결정한다. 생성한 값이 "한 호출 동안", "한 컴포넌트 인스턴스 동안", "한 앱 세션 동안", "한 서버 프로세스 동안" 살아야 하는지 먼저 써 보면 대부분의 답이 좁혀진다.

### 테스트를 위한 추상화와 제품을 위한 추상화

테스트 가능성은 중요하지만 테스트만을 위해 제품 코드가 과하게 일반화되면 설계가 흔들린다. `Date.now()`를 직접 호출하는 계산 함수는 clock 주입이 좋다. 하지만 모든 문자열 포맷 함수에 "formatter service"를 주입하는 것은 제품의 변경 축이 아니라 테스트의 불편함을 제품 구조에 밀어 넣은 것일 수 있다.

판단 기준은 실제 외부 효과다.

- 시간, 난수, 네트워크, 스토리지, 브라우저 환경은 주입 후보가 된다.
- 순수 계산, 배열 변환, 객체 매핑은 직접 호출해도 된다.
- 제품에서 여러 구현이 실제로 존재하지 않는데 테스트 mock만을 위해 인터페이스를 만들면 비용을 의심한다.

### 번들 경계와 사이드 이펙트

모듈 최상위에서 SDK를 초기화하면 import만으로 부수 효과가 생긴다.

```ts
// analytics-sdk.ts
import { initSdk } from "vendor-sdk";

export const sdk = initSdk({ key: "public-key" });
```

이 모듈을 import하는 순간 SDK 초기화 코드가 번들에 포함되고 실행된다. tree shaking도 어려워진다. 필요한 시점에 factory로 만들면 초기화 시점이 명시된다.

```ts
import { initSdk } from "vendor-sdk";

export function createAnalyticsSdk() {
  return initSdk({ key: "public-key" });
}
```

이 차이는 Phase 6-2의 번들러 관점과 연결된다. ESM의 정적 그래프는 사용하지 않는 export 제거를 가능하게 하지만, 모듈 평가 자체가 사이드 이펙트를 갖는다면 제거가 보수적으로 바뀐다. 생성 패턴은 런타임 구조뿐 아니라 빌드 결과에도 영향을 준다.

## 더 깊이

### factory와 class의 메모리 모델 차이

클래스 메서드는 프로토타입에 있어 인스턴스들이 같은 함수 객체를 공유한다. factory가 매 호출마다 객체 리터럴과 메서드 함수를 새로 만들면 각 인스턴스가 별도 함수 객체를 갖는다.

```ts
class CounterClass {
  #value = 0;
  increment() {
    this.#value += 1;
  }
}

function createCounterFactory() {
  let value = 0;
  return {
    increment() {
      value += 1;
    },
  };
}
```

수천 개 인스턴스를 만드는 hot path에서는 클래스의 프로토타입 공유가 메모리 측면에서 유리할 수 있다. 반대로 대부분의 프론트엔드 서비스 객체는 앱 시작 시 몇 개만 만들어지므로 이 차이가 설계를 지배하지 않는다. 성능 주장은 Chrome DevTools Memory 패널이나 Node heap snapshot으로 확인해야 한다. 구현 세부에 기대기보다 객체 생성 수, 수명, 참조 유지 경로를 먼저 줄인다.

### DI 컨테이너가 없어도 composition root는 필요하다

DI를 컨테이너 없이 쓰더라도 "어디에서 실제 구현을 조립하는가"는 필요하다. 이를 composition root라고 부를 수 있다. 프론트엔드 앱에서는 보통 앱 진입점, route loader, React provider, 테스트 setup이 그 역할을 한다.

```ts
// app-services.ts
export function createAppServices() {
  const fetchJson = createFetchJson("/api", fetch);
  const draftRepository = createDraftRepository(localStorage, { now: Date.now });

  return {
    users: createUserRepository(fetchJson),
    drafts: draftRepository,
  };
}
```

구성 코드를 한곳에 두면 제품 코드의 하위 모듈은 구체 구현을 몰라도 된다. 반대로 아무 곳에서나 `createAppServices()`를 호출하면 singleton과 다를 바 없는 숨은 전역이 된다. composition root도 하나의 생성 패턴이며, 호출 위치가 수명을 결정한다.

### SSR과 요청 스코프

브라우저 SPA에서는 "앱 전체에서 하나"가 대개 사용자 세션과 일치한다. SSR 서버에서는 프로세스가 여러 사용자의 요청을 처리한다. 따라서 "모듈 singleton"과 "사용자 요청 singleton"은 다르다.

요청별 권한, locale, A/B 실험군, tracing id는 factory로 요청 스코프 인스턴스를 만들어야 한다. Next.js나 Remix 같은 프레임워크의 서버 실행 경계에서는 이 차이가 보안 문제로 이어질 수 있다. 클라이언트 전용 코드에서 안전했던 module pattern을 서버 코드로 옮길 때는 상태 수명을 다시 검토한다.

## 정리

- 생성 패턴의 핵심 질문은 "누가 만든다"가 아니라 "생성된 값이 어떤 수명과 공유 범위를 갖는가"다.
- factory function은 클로저와 주입 경계를 이용해 작은 인스턴스를 만들고, class constructor는 인스턴스 정체성과 프로토타입 공유가 필요할 때 자연스럽다.
- builder는 옵션이 많아서가 아니라 생성 과정의 순서와 불변식이 중요할 때 정당화된다.
- ESM module pattern은 private 상태를 쉽게 만들지만, 모듈 캐시 때문에 singleton과 같은 수명 비용을 갖는다.
- DI는 컨테이너가 아니라 외부 세계를 값으로 전달하는 방향이다. 시간, 네트워크, 저장소, 브라우저 API가 주요 주입 후보가 된다.

## 확인 문제

**Q1.** `localStorage`에 임시 글을 저장하는 함수가 여러 컴포넌트에서 직접 `localStorage.setItem()`을 호출한다. 테스트는 jsdom 환경에 의존하고, 저장 포맷 변경 때 수정 지점이 흩어진다. 어떤 패턴을 적용할 수 있으며, 어디까지 추상화해야 하는가?

<details>
<summary>정답과 해설</summary>

`createDraftRepository(storage, clock)` 같은 factory + DI가 적합하다. 저장소 API와 시간은 외부 세계이므로 주입하고, 저장 포맷과 key 규칙은 repository 내부 계약으로 모은다. 이렇게 하면 테스트는 memory storage와 고정 clock을 넘기면 된다. 다만 모든 컴포넌트에 거대한 repository 계층을 강제할 필요는 없다. 임시 글 저장이라는 경계를 좁게 감싸고, 순수 문자열 변환이나 단순 UI 상태까지 service로 분리하지 않는다.
</details>

**Q2.** 검색 URL을 만드는 함수에 옵션이 5개 있다. 팀원이 builder를 제안했다. 어떤 조건이면 builder가 정당하고, 어떤 조건이면 옵션 객체가 더 나은가?

<details>
<summary>정답과 해설</summary>

옵션들이 독립적이고 기본값만 있으면 옵션 객체가 낫다. 호출부가 한눈에 보이고 직렬화와 테스트도 쉽다. builder가 정당한 조건은 필수 단계와 선택 단계가 섞여 있고, 옵션 간 불변식이 많으며, 생성 순서가 의미를 갖고, 중간 상태를 안전하게 검증해야 할 때다. 예를 들어 `query()`가 반드시 먼저 필요하고 `auth()` 여부에 따라 header 생성이 달라지며, `build()` 시점에 누락을 검증해야 한다면 builder가 비용을 상쇄한다.
</details>

**Q3.** `export const apiClient = createApiClient(fetch)` 형태의 모듈 singleton이 있다. 브라우저 SPA에서는 문제가 없었지만 SSR 전환 뒤 사용자별 인증 헤더가 섞이는 버그가 발생했다. 원인을 생성 패턴 관점에서 설명하라.

<details>
<summary>정답과 해설</summary>

모듈 singleton은 모듈 평가 시점에 한 번 만들어지고 프로세스 또는 번들 인스턴스 범위로 공유된다. 브라우저 SPA에서는 그 범위가 대체로 한 사용자 세션이라 안전해 보였지만, SSR 서버에서는 여러 사용자의 요청이 같은 모듈 인스턴스를 공유한다. 인증 헤더나 사용자 컨텍스트가 client 내부 상태에 들어가면 요청 간 데이터가 섞인다. 해결은 요청마다 `createApiClient({ fetch, token })`을 호출해 요청 스코프 인스턴스를 만들거나, 인증 토큰을 각 호출의 명시적 인자로 전달하는 것이다.
</details>

## 참고 자료

- [ECMA-262 — ECMAScript Modules](https://tc39.es/ecma262/#sec-modules) — ESM의 모듈 평가, 바인딩, 캐시 모델을 확인할 수 있다.
- [MDN — Classes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes) — class syntax, private field, constructor 동작을 확인할 수 있다.
- [MDN — Closures](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures) — factory function과 module pattern의 private 상태를 이해하는 기반 자료다.
- [TypeScript Handbook — Interfaces](https://www.typescriptlang.org/docs/handbook/interfaces.html) — 구조적 계약을 인터페이스로 표현하는 방식과 JavaScript 런타임과의 분리를 설명한다.
