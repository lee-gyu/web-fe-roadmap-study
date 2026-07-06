# 9-4. 구조·경계 패턴

> 한 줄 요약: 이 문서를 읽고 나면 외부 API, 브라우저 API, 레거시 코드, 횡단 관심사를 adapter, facade, proxy, decorator, middleware로 감싸 내부 계약을 안정화할 수 있다.

이 문서는 [9-2 생성·구성 패턴](./02-creational-and-composition-patterns.md)의 DI와 [9-3 행위 패턴](./03-behavioral-patterns.md)의 command/observer 모델을 전제로 한다. 네트워크와 브라우저 API의 세부 동작은 Phase 3-8, Phase 8-2를 전제로 하고, 특정 백엔드 아키텍처 계층 설계는 다루지 않는다.

## 학습 목표

- adapter가 외부 응답, 브라우저 API, 저장소 스키마를 내부 모델로 변환하는 경계임을 설명하고 구현할 수 있다.
- facade가 복잡한 하위 시스템을 좁은 API로 감싸는 조건과 정보 은닉의 비용을 판단할 수 있다.
- proxy가 lazy loading, access control, cache, logging을 끼워 넣는 구조와 투명성의 한계를 설명할 수 있다.
- decorator와 middleware가 함수 합성으로 책임을 누적하는 방식과 실행 순서 비용을 설명할 수 있다.
- 구조 패턴이 내부 계약을 안정화하는 도구인지, 단순 파일 이동인지 구분할 수 있다.

## 배경: 왜 이것이 존재하는가

프론트엔드 애플리케이션은 경계 위에 서 있다. 서버 API는 스키마를 바꾸고, 브라우저 API는 동기/비동기와 권한 정책이 섞여 있으며, 써드파티 SDK는 전역 객체와 side effect를 만들고, 레거시 코드는 현재 도메인 언어와 다른 이름을 쓴다. 구조·경계 패턴(structural and boundary patterns)은 이 불안정한 바깥쪽을 내부 코드가 이해할 수 있는 계약으로 바꾸는 기술이다.

중요한 점은 "레이어를 많이 만든다"가 목표가 아니라는 것이다. 경계가 없으면 외부 변화가 내부 전역으로 번진다. 반대로 경계가 과하면 단순 데이터 이동에도 DTO, mapper, service, repository, facade가 쌓이고 어디서 무엇이 바뀌는지 흐려진다. 좋은 경계 패턴은 외부의 변동성을 한곳에 가두고, 내부가 안정된 모델로 사고하게 만든다.

백엔드의 anti-corruption layer와 비슷하지만 프론트엔드에는 추가 제약이 있다. 번들 크기, 메인 스레드 비용, 렌더링 지연, 브라우저 보안 정책, 캐시 계층이 모두 경계 설계에 영향을 준다. adapter 하나가 단순히 타입을 바꾸는 것이 아니라, 런타임 검증, 캐시 키, 에러 메시지, 접근성 속성, 리렌더 범위까지 바꿀 수 있다.

## 핵심 개념

### Adapter는 외부 형식을 내부 모델로 바꾼다

외부 API 응답을 화면에서 직접 쓰면 서버 스키마가 UI 전체로 번진다.

```ts
type ProductResponse = {
  product_id: string;
  display_name: string;
  price_cents: number;
  in_stock: boolean;
};

type Product = {
  id: string;
  name: string;
  price: number;
  available: boolean;
};

function adaptProduct(response: ProductResponse): Product {
  return {
    id: response.product_id,
    name: response.display_name,
    price: response.price_cents / 100,
    available: response.in_stock,
  };
}
```

이 adapter의 목적은 snake_case를 camelCase로 바꾸는 미관이 아니다. 내부 모델을 외부 스키마와 분리한다. 서버가 `price_cents`를 `amount`와 `currency`로 바꾸면 adapter만 수정하면 된다. 내부 컴포넌트와 도메인 함수는 `Product`라는 안정된 계약을 유지한다.

런타임 검증이 필요한 경계에서는 adapter가 parse 단계도 포함한다.

```ts
function assertProductResponse(value: unknown): asserts value is ProductResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("product_id" in value) ||
    !("display_name" in value) ||
    !("price_cents" in value) ||
    !("in_stock" in value)
  ) {
    throw new Error("Invalid product response");
  }
}

async function fetchProduct(fetchJson: (url: string) => Promise<unknown>, id: string) {
  const raw = await fetchJson(`/products/${id}`);
  assertProductResponse(raw);
  return adaptProduct(raw);
}
```

TypeScript 타입만으로 네트워크 응답을 보장할 수 없다. 타입 단언은 컴파일러를 조용하게 만들 뿐 런타임 데이터를 검사하지 않는다. 외부 경계에서는 필요에 따라 Zod, Valibot 같은 스키마 검증 도구를 쓰거나 최소한 수동 assert를 둔다. 내부 코드에서는 검증된 모델만 다루게 한다.

경계 조건은 adapter의 폭이다. API 응답이 이미 내부 모델과 거의 같고 변경 가능성이 낮다면 별도 adapter가 비용일 수 있다. 반대로 응답을 여러 화면에서 직접 쓰고 있다면 adapter 도입은 변경 비용을 크게 줄인다.

### Facade는 복잡한 하위 시스템을 좁은 API로 감싼다

facade 패턴은 여러 하위 API를 내부에서 조합하고 호출자에게 좁은 표면만 제공한다. 브라우저 저장소를 예로 든다.

```ts
type Preferences = {
  theme: "light" | "dark";
  density: "comfortable" | "compact";
};

const defaultPreferences: Preferences = {
  theme: "light",
  density: "comfortable",
};

export function createPreferenceStorage(storage: Storage) {
  const key = "app:preferences";

  return {
    read(): Preferences {
      const raw = storage.getItem(key);

      if (!raw) {
        return defaultPreferences;
      }

      try {
        return { ...defaultPreferences, ...(JSON.parse(raw) as Partial<Preferences>) };
      } catch {
        return defaultPreferences;
      }
    },
    write(preferences: Preferences) {
      storage.setItem(key, JSON.stringify(preferences));
    },
    reset() {
      storage.removeItem(key);
    },
  };
}
```

호출자는 `localStorage` key, JSON parse 실패, 기본값 병합을 몰라도 된다. facade는 사용하기 쉬운 API를 제공하고 하위 시스템의 세부를 숨긴다.

비용은 정보 은닉의 방향이 잘못될 때 생긴다. 예를 들어 저장 실패를 모두 삼키면 호출자는 quota exceeded, private mode, serialization 오류를 구분할 수 없다. facade는 복잡도를 숨기되 **의사결정에 필요한 정보까지 숨기면 안 된다**.

```ts
type WriteResult =
  | { ok: true }
  | { ok: false; reason: "quota-exceeded" | "unavailable" | "unknown" };
```

실무 facade는 종종 결과 타입을 통해 내부 실패를 호출자가 판단 가능한 수준으로 다시 노출한다.

### Proxy는 접근 사이에 동작을 끼워 넣는다

proxy 패턴은 대상과 같은 인터페이스를 제공하면서 접근 제어, lazy initialization, cache, logging 같은 동작을 끼워 넣는다. JavaScript에는 `Proxy` 객체도 있지만, 모든 proxy 패턴이 `new Proxy()`를 써야 하는 것은 아니다.

먼저 함수 wrapper로 cache proxy를 만든다.

```ts
type LoadUser = (id: string) => Promise<{ id: string; name: string }>;

function withUserCache(loadUser: LoadUser): LoadUser {
  const cache = new Map<string, Promise<{ id: string; name: string }>>();

  return function cachedLoadUser(id) {
    const cached = cache.get(id);

    if (cached) {
      return cached;
    }

    const request = loadUser(id);
    cache.set(id, request);
    return request;
  };
}
```

같은 `id`에 대한 동시 요청이 하나의 Promise를 공유한다. 호출자는 원래 `LoadUser`와 같은 인터페이스를 사용한다. 이 투명성이 proxy의 장점이다. 동시에 한계이기도 하다. cache가 언제 무효화되는지 호출자가 모르면 오래된 데이터를 볼 수 있다. 투명한 proxy는 부수 효과도 투명하게 숨긴다.

JavaScript `Proxy`는 프로퍼티 접근 자체를 가로챌 수 있다.

```ts
function createReadOnly<T extends object>(target: T): T {
  return new Proxy(target, {
    set() {
      throw new Error("read-only object");
    },
    deleteProperty() {
      throw new Error("read-only object");
    },
  });
}

const config = createReadOnly({ apiBaseUrl: "/api" });
console.log(config.apiBaseUrl); // 출력: /api
```

`Proxy`는 강력하지만 최적화와 디버깅 비용이 있다. 프로퍼티 접근이 일반 객체처럼 보이지만 trap이 실행된다. 일부 엔진 최적화에 불리할 수 있고, 객체 identity와 reflection 동작이 예상과 달라질 수 있다. library boundary나 개발 도구용 instrumentation에는 유용하지만, 단순 객체 접근을 전부 proxy로 감싸는 것은 비용이 크다.

### Decorator는 같은 인터페이스 위에 책임을 누적한다

decorator 패턴은 원래 객체에 책임을 덧씌우는 구조다. JavaScript에서는 함수 합성으로 자주 표현한다.

```ts
type FetchJson = <T>(url: string, init?: RequestInit) => Promise<T>;

function withLogging(fetchJson: FetchJson): FetchJson {
  return async function loggedFetchJson<T>(url, init) {
    const startedAt = performance.now();

    try {
      return await fetchJson<T>(url, init);
    } finally {
      console.log("request", url, `${performance.now() - startedAt}ms`);
    }
  };
}

function withAuth(fetchJson: FetchJson, getToken: () => string | null): FetchJson {
  return function authedFetchJson<T>(url, init) {
    const token = getToken();

    return fetchJson<T>(url, {
      ...init,
      headers: {
        ...init?.headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  };
}
```

decorator는 같은 타입을 받고 같은 타입을 반환하므로 조합할 수 있다.

```ts
const baseFetchJson: FetchJson = async (url, init) => {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
};

const fetchJson = withLogging(withAuth(baseFetchJson, () => "token"));
```

실행 순서가 중요하다. logging이 auth 바깥에 있으면 인증 header 추가까지 포함한 시간을 잰다. retry decorator와 logging decorator를 섞으면 각 재시도를 로그로 남길지 전체 요청을 한 번만 로그로 남길지 순서가 결정한다. decorator는 책임을 깔끔하게 분리하지만, 조합 순서를 문서화하지 않으면 동작이 암묵적이 된다.

### Middleware와 chain of responsibility는 단계별 처리를 만든다

middleware는 요청 또는 값을 여러 단계로 통과시키는 구조다. 각 단계는 다음 단계 호출 여부를 결정할 수 있다. fetch pipeline을 예로 든다.

```ts
type RequestContext = {
  url: string;
  init: RequestInit;
};

type Next = (context: RequestContext) => Promise<Response>;
type Middleware = (context: RequestContext, next: Next) => Promise<Response>;

function composeMiddleware(middlewares: Middleware[], terminal: Next): Next {
  return middlewares.reduceRight<Next>(
    (next, middleware) => (context) => middleware(context, next),
    terminal,
  );
}

const authMiddleware: Middleware = async (context, next) => {
  return next({
    ...context,
    init: {
      ...context.init,
      headers: {
        ...context.init.headers,
        authorization: "Bearer token",
      },
    },
  });
};

const retryMiddleware: Middleware = async (context, next) => {
  try {
    return await next(context);
  } catch (error) {
    return next(context);
  }
};

const send: Next = ({ url, init }) => fetch(url, init);

const request = composeMiddleware([authMiddleware, retryMiddleware], send);
```

chain of responsibility의 핵심은 단계가 요청을 처리하거나 다음으로 넘길 수 있다는 점이다. validation pipeline, form submission, route guard, fetch client에 자연스럽다.

비용은 순서와 공유 context다. middleware가 같은 context를 mutate하면 단계 간 결합이 숨는다. 가능한 한 새 context를 반환하거나 불변에 가깝게 다룬다. 또한 retry와 auth의 순서처럼 의미 있는 순서를 테스트해야 한다. pipeline은 작은 함수가 많아지는 만큼 stack trace와 로그가 중요해진다.

## 실무 관점

### 경계 패턴 선택표

| 문제 | 패턴 | 얻는 것 | 비용 | 무너지는 조건 |
|---|---|---|---|---|
| 외부 스키마와 내부 모델 분리 | adapter | 변경 격리, 런타임 검증 | 매핑 코드 유지 | 외부와 내부가 사실상 동일하고 단일 사용처 |
| 복잡한 하위 API 단순화 | facade | 호출 표면 축소, 기본 정책 중앙화 | 필요한 정보까지 숨길 위험 | 호출자별로 다른 세부 제어가 핵심 |
| 동일 인터페이스에 cache/access/logging 삽입 | proxy | 호출부 변경 최소화 | 투명성이 부수 효과를 숨김 | 무효화와 권한 정책이 호출자 판단에 필요 |
| 책임을 조합 가능하게 누적 | decorator | 횡단 관심사 분리 | 조합 순서가 동작을 좌우 | 책임 간 순서 의존이 복잡 |
| 단계별 처리와 중단 | middleware/chain | pipeline 관찰과 재사용 | context 설계, stack trace 비용 | 단순 한두 단계 호출 |

구조 패턴은 파일 이름으로 증명되지 않는다. `adapter.ts`라는 파일이 있어도 외부 변동성을 내부에서 계속 직접 알고 있다면 adapter가 아니다. 반대로 이름이 `parseProduct.ts`여도 외부 응답을 내부 모델로 안정화한다면 adapter다.

### adapter를 어디까지 둘 것인가

adapter는 경계에 둔다. 서버 응답을 받는 즉시 내부 모델로 바꾸면 그 아래 계층은 외부 스키마를 몰라도 된다. 반대로 컴포넌트마다 필요한 필드만 그때그때 매핑하면 같은 변환이 흩어진다.

단, 모든 계층마다 모델을 새로 만들 필요는 없다. `ProductResponse -> ProductDto -> ProductEntity -> ProductViewModel` 같은 사슬이 실제 변경 축을 반영하지 않는다면 비용이다. 프론트엔드에서는 보통 다음 둘을 구분하면 충분한 경우가 많다.

- API 응답 모델: 외부 계약, 런타임 검증 대상
- UI/도메인 모델: 내부 계약, 컴포넌트와 로직이 사용하는 형태

view model이 별도로 필요한 조건은 표시 규칙이 복잡하고 여러 화면에서 재사용되거나, 로케일/권한/feature flag에 따라 파생값이 많을 때다.

### middleware는 로그 없이는 디버깅하기 어렵다

middleware는 실행 경로가 여러 함수에 나뉜다. 실패가 terminal fetch에서 났는지, auth 단계에서 header가 빠졌는지, retry가 같은 요청을 두 번 보냈는지 로그 없이는 알기 어렵다. 최소한 개발 환경에서는 각 middleware 진입/종료와 context의 주요 식별자를 남긴다.

```ts
const traceMiddleware: Middleware = async (context, next) => {
  console.debug("request:start", context.url);

  try {
    const response = await next(context);
    console.debug("request:finish", context.url, response.status);
    return response;
  } catch (error) {
    console.debug("request:error", context.url, error);
    throw error;
  }
};
```

관찰 가능성은 middleware의 부가 기능이 아니라 구조를 안전하게 쓰기 위한 조건이다.

## 더 깊이

### Adapter와 anti-corruption layer

adapter가 많아지는 지점은 보통 외부 모델이 내부 언어를 오염시키는 지점이다. 서버 응답의 `is_del_yn`, `prodNo`, `usrNm` 같은 이름이 UI 전체로 퍼지면 내부 코드는 외부 시스템의 역사에 종속된다. adapter는 이 오염을 경계에서 멈추게 한다. 도메인 주도 설계에서는 이를 anti-corruption layer라고 부른다.

프론트엔드에서 이 경계는 서버 API뿐 아니라 브라우저 API에도 적용된다. `matchMedia`, `IntersectionObserver`, `localStorage`, `BroadcastChannel`은 각각 구독, 권한, 동기성, 브라우저 지원 조건이 다르다. 내부 코드가 이 차이를 직접 알 필요가 없다면 adapter 또는 facade로 좁힌다.

### JavaScript Proxy의 불변식

`Proxy` trap은 아무렇게나 동작할 수 없다. ECMAScript는 proxy invariant를 정의한다. 예를 들어 non-configurable property를 없는 것처럼 보고하거나, non-writable property에 성공적으로 값을 썼다고 거짓 보고하면 TypeError가 발생할 수 있다. 즉 `Proxy`는 완전한 마법이 아니라 대상 객체의 기본 불변식을 지켜야 하는 메타 객체 프로토콜이다.

또한 `Proxy`는 identity를 바꾼다. `proxy !== target`이고, WeakMap key나 참조 비교에 영향을 준다. React props나 dependency array에 proxy 객체를 넣으면 매번 새 proxy를 만드는 구조에서 불필요한 리렌더가 생길 수 있다. proxy 패턴이 필요할 때도 JavaScript `Proxy`가 아니라 명시적 wrapper 함수가 더 안정적인 경우가 많다.

### Decorator와 middleware의 순서 법칙

decorator와 middleware는 조합 순서가 동작이다. 수학의 함수 합성처럼 `withLogging(withRetry(fetchJson))`과 `withRetry(withLogging(fetchJson))`은 다르다. 전자는 전체 재시도 묶음을 한 번 로그할 수 있고, 후자는 각 시도마다 로그할 수 있다. 어느 쪽이 맞는지는 제품 요구다.

따라서 pipeline은 배열 순서를 테스트해야 한다.

```ts
const calls: string[] = [];

const a: Middleware = async (context, next) => {
  calls.push("a:before");
  const response = await next(context);
  calls.push("a:after");
  return response;
};

const b: Middleware = async (context, next) => {
  calls.push("b:before");
  const response = await next(context);
  calls.push("b:after");
  return response;
};
```

테스트는 `["a:before", "b:before", "b:after", "a:after"]` 같은 순서를 검증할 수 있다. 구조 패턴의 correctness는 타입뿐 아니라 실행 순서에도 있다.

## 정리

- adapter는 외부 형식을 내부 모델로 바꾸는 경계다. 네트워크 응답은 TypeScript 타입만으로 안전하지 않으므로 필요한 경우 런타임 검증을 포함한다.
- facade는 복잡한 하위 시스템을 좁은 API로 감싸지만, 호출자가 판단해야 할 실패 정보까지 숨기면 안 된다.
- proxy는 같은 인터페이스 사이에 cache, access control, logging을 끼워 넣는다. 투명성은 장점이면서 무효화와 디버깅 비용을 숨길 수 있다.
- decorator는 같은 타입을 받고 같은 타입을 반환하는 wrapper로 책임을 누적한다. 조합 순서가 동작을 결정한다.
- middleware와 chain은 단계별 처리를 만들지만 context 설계, 로그, 순서 테스트 없이는 흐름 추적이 어려워진다.

## 확인 문제

**Q1.** 서버 응답의 `product_id`, `price_cents`를 React 컴포넌트 여러 곳에서 직접 사용하고 있다. 서버가 통화 정보를 추가하면서 `price` 구조를 바꾸려 한다. 어떤 패턴을 도입해야 하며, 도입 위치는 어디가 좋은가?

<details>
<summary>정답과 해설</summary>

API 경계에 adapter를 둔다. 응답을 받은 직후 `ProductResponse`를 내부 `Product` 모델로 변환하고, 컴포넌트는 내부 모델만 사용하게 한다. 서버 스키마 변경은 adapter와 런타임 검증만 수정하면 된다. 컴포넌트마다 개별 매핑을 두면 변경 비용이 흩어진다. 필요하다면 통화 포맷 같은 표시 규칙은 별도 view model 또는 formatter로 분리하되, 외부 응답 이름이 UI 전체로 퍼지지 않게 하는 것이 핵심이다.
</details>

**Q2.** fetch client에 auth, retry, logging을 decorator로 붙였다. 운영에서 retry가 세 번 일어났는데 로그는 한 줄만 남아 원인을 알 수 없다. 어떤 순서 문제가 가능한가?

<details>
<summary>정답과 해설</summary>

`withLogging(withRetry(fetchJson))`처럼 logging이 retry 바깥에 있으면 전체 요청 묶음만 한 번 로그할 수 있다. 각 retry 시도를 보고 싶다면 `withRetry(withLogging(fetchJson))`처럼 logging을 retry 안쪽에 두거나 retry middleware 자체가 시도별 로그를 남겨야 한다. decorator와 middleware는 조합 순서가 동작이므로, "전체 요청 단위 로그"와 "시도 단위 로그" 중 무엇이 필요한지 정하고 순서를 테스트해야 한다.
</details>

**Q3.** JavaScript `Proxy`로 모든 domain object의 읽기/쓰기를 추적하려는 제안이 있다. 어떤 비용과 경계 조건을 검토해야 하는가?

<details>
<summary>정답과 해설</summary>

`Proxy`는 프로퍼티 접근을 투명하게 가로챌 수 있지만 identity가 바뀌고, trap 실행 때문에 디버깅과 성능 비용이 생기며, ECMAScript proxy invariant를 지켜야 한다. React props나 dependency array에 매번 새 proxy가 들어가면 리렌더가 늘 수 있다. 또한 모든 객체 접근이 side effect를 가진 것처럼 되면 코드 추론이 어려워진다. 개발 도구, validation boundary, 특정 store 라이브러리처럼 추적의 이점이 큰 곳에서는 유효하지만, 일반 domain object 전체에 적용하려면 관찰 목적, 수명, 참조 안정성, 성능 측정 방법이 먼저 정의되어야 한다.
</details>

## 참고 자료

- [ECMA-262 — Proxy Object Internal Methods and Internal Slots](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots) — JavaScript `Proxy`의 trap과 불변식의 표준 모델을 확인할 수 있다.
- [MDN — Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) — `Proxy` API의 trap 종류와 사용 예를 제공한다.
- [MDN — Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) — fetch wrapper, decorator, middleware 예제의 기반이 되는 브라우저 네트워크 API 문서다.
- [TypeScript Handbook — Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — 외부 값을 내부 타입으로 좁히는 assertion function과 타입 가드의 기반을 설명한다.
