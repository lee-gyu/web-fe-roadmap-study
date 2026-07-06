# 9-3. 행위 패턴

> 한 줄 요약: 이 문서를 읽고 나면 조건 분기, 이벤트 전파, 명령 기록, 상태 전이, 지연 순회를 어떤 구조로 분리해야 변경 축과 디버깅 경로가 선명해지는지 판단할 수 있다.

이 문서는 [9-1](./01-patterns-as-design-vocabulary.md)의 패턴 판단 기준과 [9-2](./02-creational-and-composition-patterns.md)의 생성·주입 경계를 전제로 한다. 예제는 JavaScript와 TypeScript로 작성하며, DOM 이벤트와 React 상태 모델은 각각 Phase 3-7, Phase 5-3을 전제로 한다.

## 학습 목표

- strategy 패턴이 조건 분기를 함수 테이블이나 정책 객체로 옮기는 기준과 과잉 추상화의 경계를 설명할 수 있다.
- command 패턴이 실행, 기록, undo, queue, retry를 분리하는 구조임을 구현할 수 있다.
- observer/pub-sub이 DOM 이벤트, `EventTarget`, 외부 store 구독과 연결되는 방식을 설명하고 디버깅 비용을 판단할 수 있다.
- state pattern, reducer, 명시적 state machine의 차이를 상태 전이의 복잡도 기준으로 선택할 수 있다.
- iterator/generator가 지연 평가와 순회 프로토콜을 통해 UI 데이터 흐름을 안정화하는 조건을 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

행위 패턴(behavioral patterns)은 객체를 어떻게 만들 것인가보다 **시간에 따라 무엇이 어떤 순서로 일어나는가**를 다룬다. 프론트엔드에서는 이 문제가 특히 자주 나타난다. 사용자의 클릭, 입력, 네트워크 응답, 타이머, 애니메이션 프레임, 외부 store 갱신이 모두 같은 화면 위에서 섞인다. 코드는 동기 함수처럼 보이지만 실제 동작은 이벤트 루프, 마이크로태스크, 브라우저 렌더링 파이프라인과 연결된다.

조건 분기는 처음에는 가장 명확한 구조다. 그러나 분기 기준이 여러 파일에 복제되거나, 상태 전이가 암묵적으로 흩어지거나, 실행 기록을 남겨야 하는 순간 단순 분기는 비용을 만든다. 행위 패턴은 이 비용을 분리한다. strategy는 "어떤 정책으로 실행할 것인가"를, command는 "무엇을 실행했고 되돌릴 수 있는가"를, observer는 "누가 누구에게 알리는가"를, state pattern은 "어떤 상태에서 어떤 이벤트가 허용되는가"를 드러낸다.

대가도 있다. 행위를 간접층으로 옮기면 호출 경로가 길어진다. pub-sub은 생산자와 소비자의 결합을 낮추지만 원인 추적을 어렵게 만든다. state machine은 불가능한 상태를 줄이지만 작은 흐름에는 과하다. 행위 패턴은 "흐름을 숨기는가, 흐름을 기록 가능한 구조로 만드는가"로 평가해야 한다.

## 핵심 개념

### Strategy는 조건 분기의 변경 축을 분리한다

다음 코드는 할인 정책이 한 함수에 모여 있다.

```ts
type Customer = {
  tier: "normal" | "vip" | "staff";
  firstPurchase: boolean;
};

export function calculateDiscount(customer: Customer, amount: number) {
  if (customer.tier === "staff") {
    return amount * 0.3;
  }

  if (customer.tier === "vip") {
    return amount * 0.15;
  }

  if (customer.firstPurchase) {
    return amount * 0.1;
  }

  return 0;
}
```

정책이 이 함수 한 곳에서만 바뀌고 경우의 수가 작다면 이 코드는 나쁘지 않다. strategy가 필요해지는 신호는 정책이 제품 실험, 지역, 결제 수단, 계정 설정처럼 별도 변경 축이 될 때다.

```ts
type DiscountContext = {
  amount: number;
  firstPurchase: boolean;
};

type DiscountStrategy = (context: DiscountContext) => number;

const discountByTier = {
  normal: ({ amount, firstPurchase }: DiscountContext) =>
    firstPurchase ? amount * 0.1 : 0,
  vip: ({ amount }: DiscountContext) => amount * 0.15,
  staff: ({ amount }: DiscountContext) => amount * 0.3,
} satisfies Record<Customer["tier"], DiscountStrategy>;

export function calculateDiscount(customer: Customer, amount: number) {
  const strategy = discountByTier[customer.tier];

  return strategy({
    amount,
    firstPurchase: customer.firstPurchase,
  });
}
```

이 구조의 이점은 TypeScript가 누락된 tier를 잡고, 각 전략을 독립 테스트할 수 있으며, 정책 추가가 기존 조건문 수정이 아니라 테이블 확장이 된다는 점이다. 비용은 호출 경로가 간접화되고, 정책이 서로 다른 입력을 요구하기 시작하면 공통 `DiscountContext`가 비대해질 수 있다는 점이다.

경계 조건은 전략의 독립성이다. 한 전략이 다른 전략의 결과를 알아야 하거나, 우선순위가 복잡하게 겹치면 단순 strategy 테이블보다 rule engine, pipeline, 명시적 정책 순서가 필요하다. 반대로 경우의 수가 둘이고 바뀌지 않으면 `switch`가 더 낫다.

### Command는 실행 가능한 행위를 값으로 만든다

command 패턴은 "실행할 코드"를 값으로 만들어 queue, undo, redo, retry, logging이 가능하게 한다. 에디터나 드로잉 도구처럼 사용자의 조작을 기록해야 하는 UI에서 자주 등장한다.

```ts
type TextState = {
  value: string;
};

type Command = {
  label: string;
  execute(state: TextState): TextState;
  undo(state: TextState): TextState;
};

function insertText(index: number, text: string): Command {
  return {
    label: `insert:${text}`,
    execute(state) {
      return {
        value: state.value.slice(0, index) + text + state.value.slice(index),
      };
    },
    undo(state) {
      return {
        value: state.value.slice(0, index) + state.value.slice(index + text.length),
      };
    },
  };
}

let state: TextState = { value: "Hello" };
const history: Command[] = [];

const command = insertText(5, " React");
state = command.execute(state);
history.push(command);

console.log(state.value); // 출력: Hello React

const last = history.pop();
if (last) {
  state = last.undo(state);
}

console.log(state.value); // 출력: Hello
```

여기서 command는 상태를 직접 바꾸지 않고 새 상태를 반환한다. React reducer와 결합하기 쉽고, 테스트도 입력 상태와 출력 상태 비교로 끝난다. command가 부수 효과를 포함한다면 undo가 어려워진다. 예를 들어 서버에 이미 전송한 요청은 단순히 반대로 실행할 수 없다. 그때는 보상 트랜잭션(compensating action), idempotent API, retry 정책이 필요하다.

command의 설계 배경은 실행과 실행 요청을 분리하는 데 있다. 버튼 클릭 핸들러가 곧바로 상태를 바꾸면 기록할 단위가 없다. command 객체 또는 함수가 있으면 같은 행위를 즉시 실행할 수도 있고, 큐에 넣거나, 로깅하거나, 테스트에서 시뮬레이션할 수 있다.

### Observer와 pub-sub은 결합을 낮추고 원인 추적 비용을 만든다

observer 패턴은 어떤 주체(subject)의 변화에 observer들이 반응하는 구조다. DOM 이벤트는 브라우저 플랫폼의 observer 모델이다.

```ts
const button = document.createElement("button");
button.textContent = "save";

button.addEventListener("click", () => {
  console.log("save requested");
});

button.click(); // 출력: save requested
```

직접 호출과 다르게 이벤트 생산자는 소비자를 모른다. 이 성질은 UI에서 중요하다. 버튼은 analytics, 저장 로직, 알림 로직을 직접 import하지 않아도 된다. 하지만 원인 추적은 어려워진다. 누가 이벤트를 듣고 무엇을 하는지는 등록 지점들을 찾아야 한다.

브라우저의 `EventTarget`으로 작은 pub-sub을 만들 수 있다.

```ts
type AppEvents = {
  "cart:add": { productId: string };
  "toast:show": { message: string };
};

function createEventBus() {
  const target = new EventTarget();

  return {
    emit<K extends keyof AppEvents>(type: K, detail: AppEvents[K]) {
      target.dispatchEvent(new CustomEvent(String(type), { detail }));
    },
    on<K extends keyof AppEvents>(type: K, listener: (detail: AppEvents[K]) => void) {
      const handler = (event: Event) => {
        listener((event as CustomEvent<AppEvents[K]>).detail);
      };

      target.addEventListener(String(type), handler);

      return () => target.removeEventListener(String(type), handler);
    },
  };
}

const bus = createEventBus();
const unsubscribe = bus.on("toast:show", ({ message }) => {
  console.log(message);
});

bus.emit("toast:show", { message: "저장했다" }); // 출력: 저장했다
unsubscribe();
```

이 구조가 적합한 조건은 생산자와 소비자의 방향을 끊어야 하고, 여러 독립 소비자가 같은 이벤트를 들어야 하며, 이벤트 로그가 있어도 되는 경우다. 부적합한 조건은 단순 부모-자식 호출, 반드시 순서가 보장되어야 하는 비즈니스 로직, 실패가 호출자에게 즉시 전파되어야 하는 흐름이다.

프론트엔드에서 pub-sub 남용은 데이터 흐름을 숨긴다. "장바구니 추가" 이벤트를 누가 받아 서버 상태를 갱신하고, 누가 toast를 띄우고, 누가 route를 바꾸는지 흩어지면 디버깅은 이벤트 이름 검색이 된다. observer를 쓰려면 이벤트 이름, payload 타입, 구독 해제, 로그 정책을 함께 설계한다.

### State pattern은 허용된 전이를 명시한다

상태가 문자열 플래그 여러 개로 흩어지면 불가능한 조합이 생긴다.

```ts
type BadUploadState = {
  isIdle: boolean;
  isUploading: boolean;
  isSuccess: boolean;
  error: string | null;
};
```

`isUploading`과 `isSuccess`가 동시에 `true`인 상태가 타입상 가능하다. state pattern은 가능한 상태를 유한 집합으로 만들고, 이벤트에 따른 전이를 명시한다.

```ts
type UploadState =
  | { tag: "idle" }
  | { tag: "uploading"; fileName: string }
  | { tag: "success"; url: string }
  | { tag: "failed"; message: string };

type UploadEvent =
  | { type: "select"; fileName: string }
  | { type: "resolve"; url: string }
  | { type: "reject"; message: string }
  | { type: "reset" };

function transition(state: UploadState, event: UploadEvent): UploadState {
  switch (state.tag) {
    case "idle":
      return event.type === "select"
        ? { tag: "uploading", fileName: event.fileName }
        : state;

    case "uploading":
      if (event.type === "resolve") {
        return { tag: "success", url: event.url };
      }

      if (event.type === "reject") {
        return { tag: "failed", message: event.message };
      }

      return state;

    case "success":
    case "failed":
      return event.type === "reset" ? { tag: "idle" } : state;
  }
}
```

이 reducer는 state pattern의 함수형 표현이다. 상태별로 허용 이벤트가 제한되고, 불가능한 상태 조합이 사라진다. 복잡해지면 전이 테이블로 바꿀 수 있다.

```ts
const allowedEvents = {
  idle: ["select"],
  uploading: ["resolve", "reject"],
  success: ["reset"],
  failed: ["reset"],
} as const;
```

명시적 state machine 도구가 정당해지는 조건은 병렬 상태, 중첩 상태, guard, effect, 시각화, 테스트 생성이 필요할 때다. 단순 비동기 요청의 `idle/loading/success/error`에는 판별 유니언과 reducer가 충분한 경우가 많다.

### Iterator와 generator는 순회와 생산을 분리한다

iterator 패턴은 "다음 값을 어떻게 가져오는가"를 소비자와 분리한다. JavaScript는 iterable protocol을 언어에 포함한다. `for...of`, spread, `Array.from()`은 `[Symbol.iterator]()`를 호출한다.

```ts
function* paginate<T>(items: T[], pageSize: number) {
  for (let index = 0; index < items.length; index += pageSize) {
    yield items.slice(index, index + pageSize);
  }
}

for (const page of paginate(["a", "b", "c", "d", "e"], 2)) {
  console.log(page);
}
// 출력: ["a", "b"]
// 출력: ["c", "d"]
// 출력: ["e"]
```

generator는 값을 한 번에 모두 만들지 않는다. 소비자가 다음 값을 요구할 때까지 실행을 멈춘다. 이 지연 평가(lazy evaluation)는 큰 데이터 변환, 무한 시퀀스, 페이지 단위 처리에서 유용하다.

비동기 순회도 가능하다.

```ts
async function* fetchPages<T>(firstUrl: string) {
  let nextUrl: string | null = firstUrl;

  while (nextUrl) {
    const response = await fetch(nextUrl);
    const page = (await response.json()) as {
      items: T[];
      nextUrl: string | null;
    };

    yield page.items;
    nextUrl = page.nextUrl;
  }
}

async function printAllProducts() {
  for await (const products of fetchPages<{ id: string }>("/api/products")) {
    console.log(products.map((product) => product.id));
  }
}
```

경계 조건은 취소와 오류다. `for await` 루프가 중단되면 generator의 `finally` 블록으로 정리할 수 있지만, 네트워크 요청 자체의 취소는 `AbortController`와 결합해야 한다. UI에서 generator를 직접 React 렌더에 섞기보다 데이터 로딩 계층에서 순회 모델을 만들고, React에는 현재 스냅샷을 전달하는 편이 안전하다.

## 실무 관점

### 행위 패턴 선택표

| 문제 | 단순 해법 | 패턴 해법 | 얻는 것 | 잃는 것 |
|---|---|---|---|---|
| 조건 분기 증가 | `switch` | strategy | 변경 축 분리, 독립 테스트 | 간접 호출, 공통 context 설계 |
| 실행 기록 필요 | 핸들러 직접 실행 | command | undo/redo, queue, logging | command 설계와 보상 처리 |
| 여러 소비자 알림 | 직접 함수 호출 | observer/pub-sub | 생산자/소비자 분리 | 원인 추적 비용, 구독 해제 |
| 상태 플래그 충돌 | 여러 boolean | state pattern/reducer | 불가능한 상태 제거 | 전이 설계 비용 |
| 큰 데이터 순회 | 배열 전체 생성 | iterator/generator | 지연 평가, backpressure 설계 | 취소와 오류 처리 복잡도 |

패턴 적용 전에는 "흐름을 더 잘 추적할 수 있는가"를 묻는다. strategy나 state machine은 흐름을 명시한다. 무분별한 pub-sub은 흐름을 숨긴다. command는 기록을 남긴다. 기록 없는 command bus는 단순 함수 호출보다 나쁠 수 있다.

### 이벤트 기반 구조의 관찰 가능성

observer와 pub-sub은 반드시 관찰 가능성을 함께 설계해야 한다. 최소한 다음이 필요하다.

- 이벤트 이름은 도메인 동사로 정하고 문자열 상수를 흩뿌리지 않는다.
- payload 타입을 한곳에 모은다.
- 구독 해제 함수를 반환하고 컴포넌트 unmount 또는 테스트 종료에서 호출한다.
- 개발 환경에서는 이벤트 emit 로그를 남길 수 있게 한다.
- 실패가 중요한 이벤트는 fire-and-forget으로 처리하지 않고 결과를 호출자에게 돌려준다.

DOM 이벤트는 전파 단계와 기본 동작 취소라는 플랫폼 규칙이 있다. 커스텀 event bus는 그런 규칙이 없다. 순서, 오류 전파, 비동기 listener 처리, 중복 구독을 직접 정해야 한다. 작은 앱에서 전역 event bus가 빠르게 technical debt가 되는 이유다.

### reducer는 state pattern의 React 친화적 표현이다

React의 `useReducer`는 command와 state pattern을 모두 담을 수 있다. action은 command보다 작고, reducer는 상태 전이를 순수 함수로 만든다. 상태 전이가 UI 이벤트와 네트워크 응답에 의해 복잡해지면 `useState` 여러 개보다 reducer가 낫다. 하지만 reducer는 부수 효과를 직접 실행하지 않아야 한다. 서버 요청, 타이머, analytics는 event handler나 effect에서 실행하고, reducer는 결과 이벤트를 받아 상태를 바꾼다.

이 원칙이 무너지면 reducer가 "모든 것을 하는 함수"가 된다. reducer 내부에서 `fetch`를 호출하거나 `Date.now()`를 직접 읽으면 테스트와 replay가 어려워진다. 시간과 네트워크는 [9-2](./02-creational-and-composition-patterns.md)의 DI 경계로 빼고, reducer는 전이 모델만 담당한다.

## 더 깊이

### Observer와 이벤트 루프

DOM 이벤트 listener는 같은 task 안에서 동기적으로 호출된다. `dispatchEvent()`도 listener들을 동기 실행한다. listener 안에서 Promise를 만들면 그 후속 `then`은 마이크로태스크로 밀린다. 따라서 pub-sub이 비동기 메시지 큐처럼 동작한다고 가정하면 순서 버그가 생긴다.

```ts
const target = new EventTarget();

target.addEventListener("done", () => {
  Promise.resolve().then(() => console.log("microtask"));
});

target.addEventListener("done", () => {
  console.log("listener");
});

target.dispatchEvent(new Event("done"));
console.log("after");

// 출력:
// listener
// after
// microtask
```

`dispatchEvent()`는 listener 호출이 끝난 뒤 반환한다. Promise callback은 현재 콜 스택이 비워진 뒤 실행된다. 이벤트 기반 패턴을 설계할 때 "알림"과 "비동기 작업 큐"를 구분해야 한다.

### 상태 전이 테이블과 철저성 검사

상태와 이벤트의 조합이 많아지면 중첩 `switch`가 읽기 어려워진다. 이때 전이 테이블을 쓸 수 있다.

```ts
type StateTag = UploadState["tag"];
type EventType = UploadEvent["type"];

const transitions: Partial<Record<StateTag, Partial<Record<EventType, StateTag>>>> = {
  idle: { select: "uploading" },
  uploading: { resolve: "success", reject: "failed" },
  success: { reset: "idle" },
  failed: { reset: "idle" },
};
```

테이블은 시각화와 테스트 생성에 유리하지만, 이벤트 payload를 상태별로 다르게 처리해야 할 때는 별도 action handler가 필요하다. TypeScript의 판별 유니언은 불가능한 payload 접근을 막는 데 강하고, 테이블은 전이 전체를 한눈에 보는 데 강하다. 둘을 섞을 때는 "전이 가능성"과 "상태 생성 로직"을 분리한다.

### Generator와 backpressure

generator는 소비자가 `next()`를 호출할 때만 생산한다. 이 구조는 backpressure의 작은 모델이다. 배열 전체를 먼저 만들면 생산자가 소비자 속도를 모른다. generator는 소비자가 다음 값을 요구할 때까지 멈출 수 있다. 비동기 generator는 네트워크 페이지네이션에서도 같은 구조를 제공한다.

다만 React 렌더 함수 안에서 generator를 직접 진행시키면 렌더가 순수해야 한다는 규칙을 깨기 쉽다. 렌더는 같은 입력에 대해 같은 출력을 만들어야 한다. generator의 내부 커서가 이동하는 것은 부수 효과다. 따라서 generator는 데이터 계층에서 실행하고 React 상태에는 현재 결과를 저장한다.

## 정리

- strategy는 조건 분기의 변경 축을 분리하지만, 경우의 수가 작고 변경이 드물면 명시적 분기가 더 낫다.
- command는 실행 가능한 행위를 값으로 만들어 undo, redo, queue, retry, logging을 가능하게 한다. 부수 효과가 있는 command는 보상 전략이 필요하다.
- observer/pub-sub은 생산자와 소비자를 분리하지만 원인 추적과 구독 해제 비용을 만든다. 이벤트 타입과 로그 정책이 함께 필요하다.
- state pattern은 불가능한 상태를 타입과 전이 함수로 제거한다. React reducer는 그 함수형 표현이다.
- iterator/generator는 생산과 소비를 분리하고 지연 평가를 제공하지만, UI 렌더 안에서 직접 커서를 진행시키면 순수성을 깨뜨릴 수 있다.

## 확인 문제

**Q1.** 주문 상태가 `isPaid`, `isCanceled`, `isRefunded` 세 boolean으로 표현되어 있고, `isPaid && isCanceled` 같은 조합이 실제로 발생했다. 어떤 패턴으로 바꾸는 것이 적절하며, 왜 boolean을 추가하는 방식으로는 한계가 있는가?

<details>
<summary>정답과 해설</summary>

판별 유니언과 reducer 또는 state pattern으로 바꾸는 것이 적절하다. 주문은 `pending`, `paid`, `canceled`, `refunded` 같은 상호 배타적 상태를 갖고, 이벤트에 따라 허용된 전이만 일어나야 한다. 여러 boolean은 상태 공간을 곱으로 만든다. 세 boolean이면 8개 조합이 가능하지만 실제 도메인이 허용하는 조합은 일부뿐이다. boolean을 추가할수록 불가능한 상태가 늘어난다. 상태를 tag로 표현하고 전이 함수를 두면 불가능한 조합을 타입 수준에서 줄이고, 허용되지 않은 이벤트를 명시적으로 무시하거나 오류 처리할 수 있다.
</details>

**Q2.** 전역 event bus에 `cart:add` 이벤트를 emit하면 서버 상태 갱신, toast 표시, analytics 기록, route 이동이 각각 다른 파일에서 일어난다. 이 구조의 장점과 위험을 설명하고, 유지한다면 어떤 관찰 장치를 추가해야 하는가?

<details>
<summary>정답과 해설</summary>

장점은 이벤트 생산자가 소비자를 몰라도 되어 결합이 낮아지고 여러 소비자가 같은 이벤트에 반응할 수 있다는 점이다. 위험은 원인 추적이 어려워지는 것이다. `cart:add` 하나가 어떤 순서로 어떤 부수 효과를 일으키는지 코드 흐름에서 보이지 않는다. 실패 전파도 불명확하다. 유지한다면 이벤트 payload 타입을 중앙에 두고, emit 로그와 listener 실행 로그를 개발 환경에서 남기며, 구독 해제 규칙을 강제해야 한다. 서버 상태 갱신처럼 실패가 중요한 작업은 fire-and-forget event가 아니라 호출자가 결과를 받을 수 있는 command나 explicit function call이 더 적절할 수 있다.
</details>

**Q3.** `for await...of`로 페이지네이션 API를 순회하는 비동기 generator를 만들었다. React 컴포넌트의 render 함수에서 이 generator를 직접 진행시키면 왜 문제가 되는가?

<details>
<summary>정답과 해설</summary>

React render는 순수해야 한다. 같은 props와 state에 대해 같은 JSX를 계산해야 하며, 렌더 중 외부 상태를 변경하거나 비동기 작업을 시작하면 안 된다. generator의 `next()` 호출은 내부 커서를 이동시키는 부수 효과이고, 비동기 generator라면 네트워크 요청까지 시작할 수 있다. concurrent rendering이나 재렌더에서 같은 generator가 여러 번 진행되면 데이터가 누락되거나 순서가 어긋난다. generator는 데이터 로딩 계층이나 effect/event handler에서 소비하고, React에는 현재 스냅샷을 state로 전달하는 구조가 안전하다.
</details>

## 참고 자료

- [ECMA-262 — Iterator Objects](https://tc39.es/ecma262/#sec-iterator-objects) — JavaScript iterator protocol과 generator 동작의 표준 모델을 확인할 수 있다.
- [MDN — EventTarget](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget) — DOM 이벤트와 커스텀 event bus 구현의 기반이 되는 API를 설명한다.
- [MDN — Iterators and generators](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Iterators_and_generators) — iterable protocol, generator, async iteration의 사용 모델을 정리한다.
- [React — Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) — React에서 상태 전이를 reducer로 분리하는 공식 모델을 제공한다.
