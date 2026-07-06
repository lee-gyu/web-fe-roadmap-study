# 3-6. Promise와 async — 마이크로태스크 연쇄의 의미론

> 한 줄 요약: async/await가 만드는 마이크로태스크 경계와 에러 전파 경로를 추적할 수 있고, 취소가 언어에 없는 이유를 이해한 위에서 AbortController로 취소 가능한 비동기 흐름을 설계할 수 있다.

## 학습 목표

- Promise 상태 머신(단방향 정착)과 executor의 동기 실행을 설명하고, then의 반환 규칙으로 체인의 값 흐름을 예측할 수 있다.
- async 함수가 어디까지 동기로 실행되고 await마다 어떤 경계가 생기는지 [3-5](./05-event-loop.md)의 모델로 도출할 수 있다.
- rejection의 전파 경로를 추적해 `forEach(async ...)`·floating promise·`return await` 유무 같은 흔한 실수의 메커니즘을 규명할 수 있다.
- AbortController가 강제 중단이 아니라 협력 프로토콜인 이유를 설명하고 signal을 계층 간에 전파할 수 있다.
- all/allSettled/race/any의 실패 의미론을 비교하고, 순차/병렬/동시 개수 제한을 코드 형태로 구분해 구현할 수 있다.

## 배경: 왜 이것이 존재하는가

Promise 이전의 비동기는 콜백 인자였다. 콜백의 문제는 들여쓰기(콜백 지옥)가 아니라 **합성이 안 된다는 것**이다 — 반환값이 없으니 결과를 변수에 담아 전달할 수 없고, throw가 스택을 벗어나니 에러 처리를 조합할 수 없으며, "완료됐는가"라는 상태가 일급이 아니니 이미 끝난 작업에 나중에 구독을 걸 수 없다. Promise는 "미래의 결과"를 **값으로** 만들어 이 세 가지를 복구한 것이고, async/await는 그 값 위에 동기 코드의 문법(return, throw, try/catch)을 복원한 것이다.

경력자의 기존 모델과 짚어야 할 차이가 하나 있다. Java의 CompletableFuture, C#의 Task는 겉이 Promise와 거의 같지만, 콜백이 **어느 스레드에서 실행되는가**라는 질문이 항상 따라붙는다(executor 지정, ConfigureAwait). JS에는 이 질문이 존재하지 않는다 — 모든 Promise 콜백은 **반드시 같은 스레드의 마이크로태스크로** 돌아온다([3-5](./05-event-loop.md)). await 앞뒤에서 스레드가 바뀌지 않으므로 동기화도 락도 필요 없고, 이것이 JS 비동기 코드가 동시성 버그 없이 상태를 만질 수 있는 근거다. 대신 잃는 것도 명확하다: 병렬성이 없다(CPU 작업은 여전히 한 줄).

취소에 대한 모델 차이도 미리 세운다. Java의 `Thread.interrupt`나 Future.cancel 같은 "밖에서 멈추는" 수단이 JS에는 없다. Promise는 한번 만들어지면 정착까지 간다 — 이것이 결함이 아니라 정착 불변성이라는 설계인 이유, 그리고 그 위에 취소를 얹는 표준 협력 프로토콜(AbortController)이 이 문서 후반부다. fetch 자체의 의미론은 [3-8](./08-network-apis.md)에서, 제너레이터·이터레이터 프로토콜은 async/await의 변환 모델을 이해하는 데 필요한 만큼만 다룬다.

## 핵심 개념

### 상태 머신 — 단방향 정착

Promise는 세 상태의 단방향 머신이다: pending → fulfilled(값과 함께) 또는 pending → rejected(사유와 함께). fulfilled/rejected를 합쳐 settled(정착)라 부르고, **정착은 불변**이다 — 한번 정착하면 상태도 값도 바뀌지 않고, 이후의 resolve/reject 호출은 조용히 무시된다.

```js
const p = new Promise((resolve, reject) => {
  console.log("executor는 동기 실행이다"); // new 하는 순간 즉시 실행
  resolve("first");
  resolve("second"); // 무시 — 이미 정착
  reject(new Error("too late")); // 무시
});
console.log("after new");
p.then((v) => console.log(v));
// 출력: executor는 동기 실행이다 → after new → first
```

두 가지 사실이 실무 예측력을 만든다. 첫째, **executor는 동기 실행된다** — `new Promise(...)` 자체는 아무것도 미루지 않는다. 미뤄지는 것은 then 콜백뿐이다. 둘째, **이미 정착한 Promise에 then을 걸어도 콜백은 마이크로태스크로 간다** — "정착 여부에 따라 동기/비동기가 갈리는" 일관성 파괴(이른바 "Zalgo 방출" 문제)를 스펙이 원천 차단했다. then 콜백은 어떤 경우에도 현재 동기 코드보다 먼저 실행되지 않는다.

정착 불변성은 뒤에 나올 두 주제의 뿌리다: race의 의미론(먼저 정착한 것이 이기고, 진 쪽의 정착은 무시된다)과 취소가 언어에 없는 이유(정착을 밖에서 강제로 바꾸는 수단은 불변성과 모순이다).

### then의 반환 규칙 — 체인이 성립하는 이유

`p.then(onFulfilled, onRejected)`는 **항상 새 Promise를 반환**하고, 그 새 Promise의 운명은 콜백의 행동이 정한다. 규칙은 네 줄이다.

| 콜백이 | 새 Promise는 |
|--------|-------------|
| 일반 값을 반환 | 그 값으로 fulfilled |
| throw | 그 예외로 rejected |
| Promise(또는 thenable)를 반환 | **그 Promise의 결과를 그대로 따라간다** (흡수) |
| 해당 콜백이 없음 | 원래 결과가 통과(pass-through) |

세 번째 규칙(흡수, 스펙 용어로는 resolve의 재귀적 unwrapping)이 체이닝의 핵심이다. 콜백이 비동기 작업을 반환하면 체인이 자동으로 그 완료를 기다린다 — 콜백 시대처럼 중첩할 필요가 없어진 정확한 이유다.

```js
fetchUser(1)
  .then((user) => fetchPosts(user.id)) // Promise 반환 → 흡수: 다음 then은 posts를 받는다
  .then((posts) => posts.length)       // 값 반환 → 그 값으로 fulfilled
  .then((count) => console.log(count));

// ❌ 같은 일을 중첩으로 — 흡수 규칙을 모르면 이렇게 쓰게 된다
fetchUser(1).then((user) => {
  fetchPosts(user.id).then((posts) => {
    console.log(posts.length); // 에러 처리·값 전달이 바깥 체인과 단절된다
  });
});
```

네 번째 규칙(통과)은 catch의 동작 원리다. `catch(fn)`은 `then(undefined, fn)`의 별칭일 뿐이고, fulfilled 값은 onRejected가 없는 then을 그냥 통과해 흘러간다. rejection도 마찬가지로 onFulfilled만 있는 then들을 통과해 **가장 가까운 onRejected까지 흘러간다** — 에러 전파 절에서 다시 쓴다.

### async 함수의 변환 모델 — await는 마이크로태스크 경계다

async 함수는 문법 설탕이지만 무엇의 설탕인지가 중요하다. 실행 모델은 이렇다.

1. async 함수 호출은 **첫 await(또는 return/throw)까지 동기 실행**된다 — 호출 즉시 본문이 시작된다는 점에서 일반 함수와 같다.
2. await를 만나면 피연산자를 resolve하고, **함수 실행을 그 지점에서 중단(suspend)** 한 뒤 호출자에게 (pending인) Promise를 반환한다. 실행 컨텍스트의 code evaluation state([3-1](./01-execution-model.md))가 중단 지점을 보존한다.
3. 기다리던 값이 정착하면 나머지 본문의 재개가 **마이크로태스크로** 예약된다.

즉 **await 하나 = 마이크로태스크 경계 하나**다. [3-5](./05-event-loop.md)의 순서 실험을 async/await로 다시 쓰면 같은 모델이 확인된다.

```js
async function main() {
  console.log("1: async 함수도 여기까진 동기");
  await null; // 이미 정착한 값이라도 경계는 생긴다
  console.log("3: await 이후 = 마이크로태스크");
}
main();
console.log("2: 호출자의 나머지 동기 코드");
// 출력: 1 → 2 → 3
// then 버전과 완전히 같다: Promise.resolve(null).then(() => console.log("3..."))
```

`await null`처럼 이미 정착한(또는 Promise가 아닌) 값을 기다려도 경계는 생긴다 — await는 "필요하면 기다림"이 아니라 "무조건 양보 후 재개"다. 이 규칙 덕에 async 함수의 실행 순서는 런타임 값에 따라 동기/비동기로 오락가락하지 않는다.

이 모델은 제너레이터의 중단·재개 메커니즘을 그대로 쓴다. async 함수는 개념적으로 "yield 지점마다 then을 걸어 재개하는 제너레이터 + 그것을 구동하는 러너"로 변환된다(실제로 TypeScript의 ES2015 타깃 출력이 정확히 이 형태다). 제너레이터 프로토콜 자체는 여기까지만 필요하므로 상세는 생략한다.

### 에러 전파 — rejection은 어디로 흐르는가

동기 코드의 예외는 콜 스택을 거슬러 오르지만, 비동기 콜백의 예외는 그 시점에 원래 스택이 이미 사라졌다([3-5](./05-event-loop.md)의 run-to-completion). Promise의 답: **예외를 rejection으로 물화(reify)하고, 체인을 따라 흐르게 한다.** rejection은 onRejected가 없는 then들을 통과해 가장 가까운 catch(또는 await의 try/catch)에서 잡힌다. async 함수 안에서는 throw와 rejected await가 그 함수가 반환한 Promise의 rejection이 된다 — 동기 의미론의 복원이다.

끝까지 아무도 잡지 않으면 호스트가 **unhandledrejection 이벤트**(브라우저)를 발화한다. 전역 계측 지점으로 쓴다:

```js
window.addEventListener("unhandledrejection", (e) => {
  reportError(e.reason); // 에러 추적 서비스로
  e.preventDefault();    // 콘솔 기본 출력 억제 (선택)
});
```

흔한 실수 세 가지를 메커니즘으로 규명한다.

**① `forEach(async ...)`는 기다려지지 않는다.**

```js
// ❌ "저장이 끝나기 전에 완료 처리된다"는 버그의 원형
async function saveAll(items) {
  items.forEach(async (item) => {
    await save(item); // 이 await는 콜백 Promise 안의 일이다
  });
  console.log("완료"); // 저장은 시작만 됐다
}
```

async 콜백은 호출 즉시 Promise를 **반환**하지만, forEach는 반환값을 버리도록 정의된 함수다. 바깥의 await가 붙을 대상 자체가 없다. 순차면 `for...of` + await, 병렬이면 `await Promise.all(items.map(save))` — map은 Promise 배열을 **돌려주므로** 합성이 성립한다. 콜백의 근본 문제(반환값 없음 = 합성 불가)가 async 시대에 재현되는 사례다.

**② floating promise — 버려진 Promise는 에러도 버린다.** `save(item);`처럼 await도 then도 없이 호출만 하면, 성공은 티가 안 나지만 실패 시 rejection이 어느 catch에도 연결되지 않아 unhandledrejection으로 새어 나간다. 의도적으로 버리는 경우(발사 후 망각)라면 `void save(item).catch(reportError)`처럼 **에러 경로만은 명시적으로 연결**한다. 린트 규칙 `@typescript-eslint/no-floating-promises`가 이것을 강제한다.

**③ `return await`는 try 안에서만 의미가 있다.**

```js
async function load() {
  try {
    return fetchData();       // ❌ 반환 후 실패해도 이 try는 이미 벗어났다
    // return await fetchData(); // ✅ 실패가 이 지점의 throw가 되어 catch에 잡힌다
  } catch (e) {
    return FALLBACK;
  }
}
```

`return p`는 Promise를 그대로 흡수 규칙에 넘기고 함수를 떠나지만, `return await p`는 이 지점에서 정착을 기다렸다가 rejection을 **현재 스택의 throw로** 되돌린다. try/catch 범위 밖(마지막 문장 등)에서는 둘의 관찰 가능한 차이가 에러 스택 트레이스 품질 정도라(엔진의 async stack trace에 호출 지점이 남는다), "try 안에서는 return await, 밖에서는 취향"이 규칙이다.

### 취소 — 언어에 없는 이유와 협력 프로토콜

Promise에 cancel()이 없는 것은 누락이 아니다. 두 가지 설계 근거가 있다. 첫째, 정착 불변성 — 밖에서 상태를 강제하는 수단은 "정착한 결과는 신뢰할 수 있다"는 계약을 깬다. 둘째, Promise는 **결과의 소비자**이지 작업의 소유자가 아니다 — 같은 Promise를 여러 곳에서 구독할 수 있는데, 한 소비자의 취소가 다른 소비자의 결과까지 없애는 권한 문제를 낳는다(실제로 TC39에서 취소 가능 Promise 제안이 이 문제로 좌초했다).

그래서 취소는 별도 채널로 표준화됐다: **AbortController/AbortSignal**(WHATWG DOM 스펙). 이것은 강제 중단이 아니라 Java의 interrupt와 같은 **협력적 신호**다 — "취소해 달라"는 요청이 signal로 전달되고, 작업 쪽이 그것을 확인해 스스로 멈춘다. 확인하지 않는 작업은 멈추지 않는다.

```js
const controller = new AbortController();

// 소비: 신호를 받는 쪽 — fetch는 signal을 네이티브 지원 (3-8)
fetch("/api/search?q=abc", { signal: controller.signal })
  .then((res) => res.json())
  .catch((e) => {
    if (e.name === "AbortError") return; // 취소는 실패가 아니다 — 구분 처리
    throw e;
  });

// 발행: 취소하는 쪽
controller.abort(); // signal.aborted = true, 구독자들에게 abort 이벤트
```

직접 만드는 비동기 작업에 취소를 지원하려면 signal을 인자로 받아 두 지점에서 협력한다 — 시작 전 검사와 진행 중 구독.

```js
function delay(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted(); // 이미 취소됐으면 즉시 reject
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);                 // 자원 정리 — 협력의 실체
      reject(signal.reason);            // AbortError로 정착
    }, { once: true });
  });
}
```

signal은 **전파되도록** 설계됐다. 상위 계층의 signal을 하위 호출들에 그대로 넘기면 취소 한 번이 트리 전체를 정리한다. 조합 유틸도 표준에 있다: `AbortSignal.timeout(5000)`(시한부 signal), `AbortSignal.any([userSignal, timeoutSignal])`(둘 중 먼저 발화하는 쪽). 언어에 구조적 동시성(스코프를 벗어나면 자식 작업이 자동 정리되는 모델)이 없으므로, **정리 책임은 코드에 남는다** — signal 전파가 그 책임을 지는 표준 형태다. addEventListener의 `{ signal }` 옵션과 결합해 리스너를 일괄 해제하는 패턴은 [3-7](./07-dom-and-events.md)에서 다룬다.

### 동시성 조합기 — 실패 의미론이 갈림 기준이다

네 조합기는 "여러 Promise"를 다룬다는 점만 같고, **실패를 다루는 계약**이 다르다.

| 조합기 | 정착 조건 | 실패 의미론 | 적합한 상황 |
|--------|----------|------------|------------|
| `all` | 전부 fulfilled → 값 배열 | **하나라도 reject → 즉시 reject** (나머지는 계속 돌지만 결과는 버려진다) | 전부 있어야 진행 가능한 필수 데이터 |
| `allSettled` | 전부 정착 → `{status, value/reason}` 배열 | reject가 없다 — 실패도 결과다 | 독립 작업 일괄 처리 후 성공/실패 분류 |
| `race` | 첫 **정착** (성공이든 실패든) | 첫 rejection이 이길 수 있다 | 타임아웃 패턴(지금은 AbortSignal.timeout이 더 낫다), "먼저 끝나는 쪽" |
| `any` | 첫 fulfilled | 전부 reject일 때만 AggregateError | 미러 서버 중 아무나, 폴백 체인 |

all의 "즉시 reject"에는 함정이 내장되어 있다: 결과는 버려져도 **나머지 작업은 취소되지 않는다**(취소는 별도 채널이므로). 진행 중인 요청까지 정리하려면 all의 실패 시 공유 signal을 abort하는 조합이 필요하다.

**순차 vs 병렬은 await의 위치가 정한다.** async 함수를 호출하는 순간 작업은 시작된다 — await는 시작이 아니라 합류 지점이다.

```js
// 순차 — 총 시간 = a + b
const a = await fetchA();
const b = await fetchB();

// 병렬 — 총 시간 = max(a, b). 시작을 먼저, 합류를 나중에
const [resA, resB] = await Promise.all([fetchA(), fetchB()]);
```

무제한 병렬이 무너지는 지점이 곧 온다 — 항목이 수백 개면 서버 rate limit, 브라우저의 오리진당 연결 제한([2-4](../phase-2/04-http-versions.md))에 부딪힌다. 표준 해법은 **동시 실행 개수 제한(풀)** 이고, 과제 B에서 직접 쓴다.

```js
// 동시 limit개를 유지하는 실행기 — worker 패턴
async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++; // 단일 스레드라 검사-증가 사이에 경쟁이 없다 (3-5)
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
```

`next++` 부분이 이 Phase의 모델들이 합류하는 지점이다 — 멀티 스레드 언어라면 원자적 연산이 필요한 코드지만, JS에서는 await 경계에서만 제어가 넘어가므로 동기 구간 안의 검사-증가는 안전하다.

## 실무 관점

**async를 "함수에 붙이는 장식"으로 쓰지 않는다.** async의 실제 의미는 "반환값이 Promise로 감싸이고, await를 쓸 수 있다"다. await가 없는 async 함수는 경계 비용(호출자에게 마이크로태스크 합류를 강제)만 낳는다. 반대로 Promise를 반환하는 함수를 then과 async/await 스타일로 뒤섞으면(then 안에서 await, await 결과에 then) 에러 경로 추적이 두 배로 어려워진다 — 한 코드베이스에서는 async/await로 통일하고, then은 조합기 결과 처리나 발사 후 망각의 catch 연결처럼 문법상 필요한 곳에만 남긴다.

**"취소는 실패가 아니다"를 에러 처리 계층에 새긴다.** 검색 자동완성에서 이전 요청을 abort하는 패턴([3-8](./08-network-apis.md)의 핵심)을 쓰면 AbortError가 일상적으로 발생한다. 이것을 일반 에러와 같은 경로로 보내면 사용자에게 "검색 실패" 토스트가 난사된다. catch의 첫 줄에서 `e.name === "AbortError"`(또는 `signal.aborted`)를 구분하는 것이 취소 도입의 필수 짝이다.

**병렬화는 의존성 그래프를 그린 다음에 한다.** "전부 Promise.all로"가 아니다 — B가 A의 결과를 쓰면 순차가 정답이고, 독립이면 병렬이 정답이다. 순차로 적어 놓은 독립 요청(위 예제의 ❌ 형태)은 흔한 성능 낭비이고, Network 패널의 워터폴에서 계단 모양(직렬)과 병렬 블록으로 즉시 구분된다 — 근거는 코드 리뷰보다 워터폴이 빠르다.

## 더 깊이

**스펙에서 await의 정확한 비용.** await는 피연산자를 PromiseResolve로 감싸고 PerformPromiseThen으로 재개를 건다(§27.7.5.3 Await). 초기 스펙은 이 과정에서 마이크로태스크가 최대 3개 생겼지만, 2018년의 "optimize await" 변경(V8 팀 주도, ECMA-262 반영)이 이미 Promise인 피연산자의 재포장을 없애 **경계 1개**로 줄였다. "await는 then보다 느리다"는 옛 블로그 지식은 이 변경 이전 이야기다 — 현재는 관찰 가능한 순서까지 포함해 then 한 단계와 동일하다.

**thenable — 흡수 규칙의 표면적.** resolve는 "then이라는 메서드를 가진 아무 객체"(thenable)를 전부 재귀적으로 흡수한다. Promise 표준화 이전의 서드파티 Promise 라이브러리(Q, Bluebird)와의 상호운용을 위한 설계였다. 부작용: `then` 메서드가 있는 일반 객체를 resolve하면 그 메서드가 호출되어 버린다 — 데이터 객체의 프로퍼티명으로 `then`을 쓰면 안 되는, 스펙이 만든 함정이다.

**unhandledrejection의 판정 시점은 휴리스틱이다.** "아무도 안 잡았다"는 판정은 rejection 직후가 아니라 마이크로태스크 큐가 소진된 뒤에 내려지고, 그 후에 catch를 붙이면 rejectionhandled 이벤트로 정정된다. 즉 "나중에 catch를 붙일 계획"인 Promise를 변수에 담아 두는 패턴은 타이밍에 따라 오탐 로그를 남길 수 있다 — 정착 전에 에러 경로를 연결하는 것이 안전하다.

## 정리

- Promise는 미래의 결과를 값으로 만든 것이다. executor는 동기 실행되고, 정착은 단방향·불변이며, then 콜백은 정착 여부와 무관하게 항상 마이크로태스크로 실행된다.
- then은 항상 새 Promise를 반환하고 콜백의 반환값(값/throw/Promise 흡수/부재 시 통과)이 그 운명을 정한다 — 체이닝과 catch의 동작 전부가 이 네 규칙이다.
- async 함수는 첫 await까지 동기이고, await마다 마이크로태스크 경계가 생긴다(이미 정착한 값이어도). rejection은 체인을 타고 가장 가까운 catch/try로 흐르고, 새는 것은 unhandledrejection으로 계측한다.
- 취소는 정착 불변성 때문에 언어 밖에 있다 — AbortController는 협력 프로토콜이고, signal 전파와 "AbortError는 실패가 아니다" 처리가 항상 짝으로 간다.
- 조합기의 갈림 기준은 실패 의미론이다(all: 하나의 실패가 전체 실패 / allSettled: 실패도 결과 / any: 하나의 성공이면 충분). 병렬성은 await 위치가 정하고, 무제한 병렬은 풀 패턴으로 제한한다.

## 확인 문제

**Q1.** 출력 순서를 예측하고, async 함수의 "동기 구간"이 어디까지인지 표시하라.

```js
async function a() {
  console.log("A1");
  await b();
  console.log("A2");
}
async function b() {
  console.log("B1");
}
console.log("S1");
a();
console.log("S2");
Promise.resolve().then(() => console.log("P1"));
```

<details>
<summary>정답과 해설</summary>

출력: **S1 → A1 → B1 → S2 → A2 → P1**

`a()` 호출은 첫 await까지 동기다: A1 출력 후 await의 피연산자 평가를 위해 `b()`를 **동기 호출** — b는 await가 없으므로 본문 전체(B1)가 동기로 끝나고 fulfilled Promise를 반환한다. 여기서 a가 중단되고 제어가 호출자로 돌아와 S2. a의 재개(A2)는 await가 만든 마이크로태스크 경계로 예약되어 있었고, P1의 then은 그보다 늦게 등록됐으므로 A2 → P1. 판별점: "await 오른쪽 표현식의 평가는 동기"라는 것(B1이 S2보다 먼저), 그리고 재개 순서는 마이크로태스크 큐의 FIFO라는 것(A2가 P1보다 먼저).
</details>

**Q2.** 다음 코드는 "하나라도 실패하면 전체 실패"를 의도했는데, 프로덕션에서 unhandledrejection 로그가 간헐적으로 올라온다. 원인을 규명하고 수정하라.

```js
async function loadDashboard() {
  const users = fetchUsers();   // Promise
  const stats = fetchStats();   // Promise
  try {
    return { users: await users, stats: await stats };
  } catch (e) {
    showError(e);
  }
}
```

<details>
<summary>정답과 해설</summary>

두 요청을 먼저 시작해 두고 순서대로 await하는 병렬 패턴인데, **`await users`가 reject되는 순간 catch로 빠져 함수가 끝나고, `stats`는 아무도 기다리지 않는 floating promise가 된다.** stats까지 실패하면 그 rejection은 어느 catch에도 연결되지 않아 unhandledrejection으로 샌다(users는 성공하고 stats만 실패하는 경우는 정상 동작처럼 보이므로 "간헐적"이다).

수정: 합류를 조합기에 맡긴다 — `const [u, s] = await Promise.all([fetchUsers(), fetchStats()]);` all은 첫 실패로 reject하되 두 Promise 모두에 핸들러를 걸어 두므로 나머지 실패가 새지 않는다. "변수에 담아 나중에 각각 await" 패턴은 병렬화 관용구로 알려져 있지만 에러 경로가 이렇게 찢어지는 함정이 있다 — 병렬 합류는 Promise.all이 표준형이다.
</details>

**Q3.** 검색 자동완성에 취소를 도입했는데, 빠르게 타이핑하면 화면에 "검색 중 오류가 발생했습니다"가 깜빡인다. 아래 코드에서 문제 지점을 찾고, 이 함수가 지켜야 할 "취소 협력"의 계약 두 가지를 답하라.

```js
let controller;
async function search(query) {
  controller?.abort();
  controller = new AbortController();
  try {
    const res = await fetch(`/api?q=${query}`, { signal: controller.signal });
    render(await res.json());
  } catch (e) {
    renderError(e); // ← ?
  }
}
```

<details>
<summary>정답과 해설</summary>

이전 요청을 abort하면 그 요청의 fetch가 **AbortError로 reject되어 catch로 들어오고**, renderError가 취소를 오류로 그린다 — 의도된 취소가 사용자에게 오류로 보이는 것이 깜빡임의 원인이다. catch 첫 줄에서 구분한다: `if (e.name === "AbortError") return;`.

취소 협력의 계약: ① **취소를 실패와 구분해 처리한다** — 취소는 요청한 쪽의 의도이므로 오류 UI·재시도·에러 리포팅의 대상이 아니다. ② **취소 시 자원과 후속 효과를 정리한다** — 이 예에서는 fetch가 signal을 네이티브 지원해 네트워크 정리는 되지만, 취소된 경로의 render가 절대 실행되지 않는 것(응답 역전 방지)까지가 계약이다. 추가로 `render` 직전에 `controller.signal.aborted`를 재확인하면 "json 파싱 중에 다음 타이핑이 온" 경계까지 막을 수 있다. 전체 패턴은 [3-8](./08-network-apis.md)과 과제 B에서 완성한다.
</details>

## 참고 자료

- [ECMA-262 — Promise Objects (§27.2)](https://tc39.es/ecma262/#sec-promise-objects) — 상태 머신, PerformPromiseThen, resolve의 thenable 흡수 절차 원문.
- [ECMA-262 — Await (§27.7.5.3)](https://tc39.es/ecma262/#await) — await 한 번이 만드는 정확한 스펙 절차.
- [WHATWG DOM — AbortController / AbortSignal](https://dom.spec.whatwg.org/#interface-abortcontroller) — 취소 프로토콜의 표준 정의. timeout/any 포함.
- [WHATWG HTML — unhandled promise rejections (§8.1.7.5)](https://html.spec.whatwg.org/multipage/webappapis.html#unhandled-promise-rejections) — unhandledrejection/rejectionhandled 이벤트의 발화 조건.
- [v8.dev — Faster async functions and promises](https://v8.dev/blog/fast-async) — await의 마이크로태스크 개수가 줄어든 스펙 변경의 배경. "await는 느리다" 통념의 검증 자료.
