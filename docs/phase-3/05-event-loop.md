# 3-5. 이벤트 루프 — 태스크, 마이크로태스크, 렌더링 기회

> 한 줄 요약: `setTimeout(fn, 0)`·`Promise.then`·`requestAnimationFrame`의 실행 시점 차이를 WHATWG HTML의 이벤트 루프 처리 모델로 도출할 수 있고, long task가 프레임을 떨어뜨리는 구조를 Performance 패널에서 직접 관찰할 수 있다.

## 학습 목표

- 이벤트 루프가 ECMA-262가 아니라 WHATWG HTML 스펙 소관임을 알고, 두 스펙의 관할 경계(Job vs event loop)를 설명할 수 있다.
- run-to-completion 의미론과 "단일 스레드"의 정확한 의미(렌더러 메인 스레드 공유)를 설명할 수 있다.
- 태스크·마이크로태스크·렌더링 기회의 우선순위 규칙으로 임의 코드의 실행 순서를 예측할 수 있다.
- setTimeout 지연이 최소 보장일 뿐인 이유(클램핑, 스로틀링)와 rAF 루프가 타이머 루프보다 나은 근거를 말할 수 있다.
- 같은 비동기 코드가 브라우저와 Node.js에서 순서가 달라지는 지점을 식별할 수 있다.

## 배경: 왜 이것이 존재하는가

"JS의 이벤트 루프"라는 통념 표현부터 교정하고 시작한다. **ECMA-262에는 이벤트 루프가 없다.** 언어 스펙이 정의하는 것은 Job — "나중에 실행될 코드 단위"의 추상 — 과 그것이 콜 스택이 빌 때 실행된다는 제약뿐이고, 언제 무엇을 어떤 순서로 돌릴지는 전부 **호스트**(브라우저라면 WHATWG HTML 스펙, 서버라면 Node.js)의 소관이다. 브라우저의 이벤트 루프 처리 모델(event loop processing model)은 HTML 스펙 §8.1.7에 절차로 명시되어 있다. 같은 언어가 브라우저와 Node에서 다른 실행 순서를 보이는 이유가 이 관할 분리다 — 언어는 같고 루프가 다르다.

경력자의 기존 모델과의 대비가 이 문서의 축이다. Java 백엔드의 동시성 모델은 "요청마다 스레드, 대기는 블로킹"이고, 동시성 문제는 공유 상태의 락으로 관리한다. JS는 반대 극단이다: 스레드는 하나, **대기는 큐로 바뀐다**. I/O를 기다리는 동안 스레드가 멈추는 게 아니라, 완료 시 실행할 콜백을 큐에 등록하고 스레드는 다음 태스크로 넘어간다. 락이 필요 없는 대신(태스크 하나가 도는 동안 아무도 끼어들 수 없으므로) 다른 비용을 치른다 — **CPU를 오래 잡는 코드가 모든 것을 멈춘다**.

브라우저에서 이 비용이 특히 치명적인 이유는 [0-1](../phase-0/01-how-the-web-works.md)에서 세운 전제에 있다: JS가 도는 스레드는 렌더러의 **메인 스레드**이고, 스타일 계산·레이아웃·사용자 입력 처리와 같은 스레드를 공유한다. "비동기로 처리했는데 왜 UI가 먹통인가"라는 질문의 답이 여기 있다 — 논블로킹은 I/O 이야기일 뿐, CPU 바운드 작업은 여전히 스택을 점유하고, 스택이 점유된 동안 렌더링도 클릭 처리도 큐에서 기다린다.

이 문서는 루프의 구조까지만 다룬다. 큐에 들어가는 대표 주자인 Promise의 의미론은 [3-6](./06-promises-and-async.md)에서, 렌더링 파이프라인의 내부(스타일→레이아웃→페인트)는 Phase 7-1에서 다룬다. 멀티 스레드 탈출구인 Web Worker는 존재만 언급한다 — 메시지 패싱 기반의 별도 스레드로, CPU 바운드 작업을 메인 스레드 밖으로 옮기는 표준 수단이다.

## 핵심 개념

### 콜 스택과 run-to-completion

이벤트 루프의 기본 계약은 단순하다: **큐에서 태스크 하나를 꺼내 콜 스택이 빌 때까지 실행하고, 다음으로 넘어간다.** 태스크 하나가 도는 동안 다른 태스크도, 이벤트 처리도, 렌더링도 끼어들 수 없다 — run-to-completion이다.

```js
setTimeout(() => console.log("타이머"), 0);

const start = Date.now();
while (Date.now() - start < 2000) {} // 2초간 스택 점유 (동기 블로킹)

console.log("루프 끝");
// 출력: 루프 끝 → (그 후에야) 타이머
// 0ms 타이머가 2초 뒤에 실행됐다 — 타이머는 "만기"를 정할 뿐 실행은 스택이 비어야 한다
```

이 계약이 주는 것: 한 태스크 안에서는 데이터 경쟁이 원천적으로 없다. 검사와 갱신 사이에 다른 코드가 끼어들 수 없으므로 락 없이 상태를 다룬다. 빼앗는 것: 선점(preemption)이 없다. 위 while 루프 동안 사용자의 클릭은 큐에 쌓일 뿐 처리되지 않고, 화면은 프레임을 건너뛴다. 이것이 long task이고, 이 문서 후반의 관찰 대상이다.

### 태스크 큐 — 복수의 큐와 task source

통념 그림은 "큐 하나"지만, HTML 스펙의 실제 모델은 **task source별 복수 큐**다. 타이머 콜백, DOM 조작 유발 태스크, 네트워크 응답, 사용자 인터랙션은 각각 다른 source이고, 스펙은 **같은 source 안에서의 순서만** 보장한다. 루프의 매 회전에서 어느 큐를 먼저 꺼낼지는 구현이 정한다 — 브라우저는 이 재량으로 입력 이벤트를 타이머보다 우선 처리하는 등의 반응성 튜닝을 한다. "setTimeout 두 개는 등록 순서대로 실행된다"(같은 source)는 믿어도 되지만, "타이머가 네트워크 콜백보다 먼저"(다른 source)는 보장이 아니다.

태스크(task)를 만드는 대표 API: `setTimeout`/`setInterval`, 이벤트 디스패치, `MessageChannel`의 postMessage. 역사적 명칭 "매크로태스크(macrotask)"는 스펙 용어가 아니다 — 스펙은 그냥 task라고 부른다.

### 마이크로태스크 — "태스크 사이"가 아니라 "스택이 빌 때마다"

마이크로태스크 큐는 별도의 단일 큐이고, 실행 규칙이 태스크와 결정적으로 다르다. HTML 스펙의 **microtask checkpoint** 규칙: 콜 스택이 빌 때마다(태스크 하나가 끝날 때, 그리고 몇몇 다른 지점에서) 마이크로태스크 큐를 **빌 때까지 전부** 소진한다. 실행 중 새로 추가된 마이크로태스크도 같은 체크포인트에서 계속 소진된다.

마이크로태스크를 만드는 것: Promise 콜백(`.then`/`catch`/`finally`, await 재개 — [3-6](./06-promises-and-async.md)), `queueMicrotask()`, MutationObserver 콜백.

두 큐의 차이를 순서 실험으로 확정한다. 실행 전에 출력을 예측해 보라. (Node 24와 브라우저에서 동일하게 동작한다.)

```js
console.log("1: 동기");

setTimeout(() => console.log("4: 태스크 (타이머)"), 0);

Promise.resolve().then(() => console.log("3: 마이크로태스크"));

console.log("2: 동기");
// 출력: 1: 동기 → 2: 동기 → 3: 마이크로태스크 → 4: 태스크 (타이머)
```

도출 과정: 스크립트 실행 자체가 하나의 태스크다. 동기 코드(1, 2)가 끝나 스택이 비면 microtask checkpoint가 돌고(3), 그 다음 루프가 다음 태스크(4)를 꺼낸다. **마이크로태스크는 항상 "지금 태스크와 다음 태스크 사이"에, 그것도 전부 실행된다** — 이 한 문장이 [3-6](./06-promises-and-async.md)의 모든 순서 문제를 푸는 열쇠다.

"빌 때까지 전부"라는 규칙은 경계 조건을 내장한다. 마이크로태스크가 마이크로태스크를 낳으면 체크포인트가 끝나지 않는다.

```js
// ❌ 실행하면 탭이 멈춘다 — 렌더링 기아(starvation)
function loop() {
  queueMicrotask(loop);
}
loop();

// ✅ 태스크로 양보하면 루프 사이에 렌더링 기회가 생긴다
function loopSafe() {
  setTimeout(loopSafe, 0);
}
```

태스크는 한 회전에 하나씩 처리되므로 사이사이 렌더링이 끼어들 수 있지만, 마이크로태스크 연쇄는 루프 회전 자체를 넘겨주지 않는다. "then 체인으로 재귀하면 안전하겠지"라는 직관이 무너지는 지점이다.

### 렌더링 기회 — 루프와 화면의 결합

브라우저 루프가 Node 루프와 갈라지는 핵심이 이것이다. HTML 스펙의 처리 모델에서 **update the rendering(렌더링 갱신)은 태스크 사이에만** 끼어든다 — 태스크 하나 + 마이크로태스크 소진이 끝난 뒤, 이 문서(document)에 **렌더링 기회(rendering opportunity)** 가 있으면 스타일 재계산→레이아웃→페인트로 이어지는 갱신을 수행한다. 렌더링 기회는 보통 디스플레이 주사율에 동기화된다(60Hz면 약 16.7ms 간격) — 즉 렌더링은 매 태스크마다가 아니라 프레임 주기에 맞춰 일어난다.

이 구조에서 두 가지가 유도된다.

**첫째, long task는 프레임을 통째로 떨어뜨린다.** 렌더링은 태스크 사이에만 가능하므로, 100ms짜리 태스크가 돌면 그동안 도래한 렌더링 기회들(6프레임분)이 전부 소실된다. 사용자에게는 스크롤 버벅임·애니메이션 끊김으로 보인다. 관찰 기준으로 50ms 초과 태스크를 long task라 부른다(Performance 패널이 빨간 삼각형으로 표시하는 기준).

**둘째, requestAnimationFrame의 위치가 특별하다.** rAF 콜백은 태스크도 마이크로태스크도 아니고, **렌더링 갱신 절차의 일부**로 — 스타일 계산 직전에 — 실행된다. 그래서 rAF는 "다음 프레임이 그려지기 직전"을 정확히 잡는 유일한 API다.

```js
// 애니메이션 루프의 표준형
function tick(timestamp) { // 프레임 시작 기준의 고해상도 시각이 들어온다
  moveBox(timestamp);
  requestAnimationFrame(tick); // 다음 렌더링 기회 직전에 다시
}
requestAnimationFrame(tick);
```

`setTimeout(tick, 16)` 방식과의 차이는 정렬이다. 타이머는 프레임 경계와 무관하게 만기되므로 한 프레임에 두 번 돌거나(낭비) 프레임을 놓치고(끊김), 백그라운드 탭에서도 계속 돈다. rAF는 정의상 프레임당 정확히 한 번이고, 렌더링 기회가 없으면(백그라운드 탭, 화면 밖) 호출 자체가 멈춘다 — 전력·CPU 절약이 공짜로 따라온다.

### setTimeout의 실제 의미론

`setTimeout(fn, delay)`의 delay는 **최소 지연 보장일 뿐**이다. 실제 실행 시점을 늦추는 요인이 겹겹이 있다.

- **스택 점유**: 만기돼도 스택이 비어야 실행된다(위 run-to-completion 실험).
- **중첩 클램핑**: HTML 스펙은 타이머가 5겹 이상 중첩되면(setTimeout 안에서 setTimeout을 반복) 최소 지연을 **4ms로 강제**한다. `setTimeout(fn, 0)` 재귀 루프가 초당 250회를 넘지 못하는 이유이고, 스펙에 명시된 동작이다.
- **백그라운드 탭 스로틀링**: 비활성 탭에서 브라우저는 타이머를 1초 1회 이하 등으로 묶는다(구현 재량이 크고 브라우저·상황별로 다르다). "탭을 벗어나면 폴링이 느려진다"는 현상의 원인.

정리하면 setTimeout은 "그 시각에 실행"이 아니라 "**그 시각 이후의 어느 태스크 회전에서** 실행"이다. 시간 정밀도가 필요한 로직(애니메이션은 rAF, 경과 시간 계산은 타이머 횟수가 아니라 timestamp 차이)의 설계 근거다.

### Node.js 루프와의 차이

Node에도 루프가 있지만 HTML 스펙과 무관한 별도 구현(libuv)이고, 구조가 다르다. 차이가 드러나는 지점만 짚는다.

- **렌더링이 없다** — 브라우저 루프의 절반(렌더링 기회, rAF)이 통째로 없다. 브라우저 경험자가 Node에서, Node 경험자가 브라우저에서 각각 놓치는 부분이 이것이다.
- **phase 구조** — Node 루프는 timers → pending callbacks → poll(I/O) → check(setImmediate) → close의 위상(phase)을 순환하고, 태스크들이 phase별로 묶여 처리된다. `setImmediate`는 poll phase 직후(check)에 실행되는 Node 전용 API로, "I/O 콜백 안에서는 setImmediate가 setTimeout(0)보다 항상 먼저"라는 브라우저에 없는 순서 규칙을 만든다.
- **process.nextTick** — 마이크로태스크보다도 먼저 도는 Node 전용 큐다. nextTick 큐 소진 → 마이크로태스크 큐 소진 순서.

```js
// Node 24에서 실행
setTimeout(() => console.log("3: setTimeout"));
setImmediate(() => console.log("4: setImmediate")); // 브라우저엔 없는 API
process.nextTick(() => console.log("1: nextTick")); // 마이크로태스크보다 먼저
Promise.resolve().then(() => console.log("2: promise"));
// 출력: 1: nextTick → 2: promise → 3: setTimeout → 4: setImmediate
// (3과 4의 순서는 메인 모듈 직행 실행에선 타이밍에 따라 뒤집힐 수 있다 —
//  I/O 콜백 안에서 실행하면 4 → 3으로 항상 고정된다)
```

같은 코드의 순서가 환경에 따라 달라질 수 있다는 사실 자체가 교훈이다: **마이크로태스크 vs 태스크의 상대 순서만이 양쪽에서 동일하게 보장되는 계약**이고, 태스크들 사이의 미세 순서에 의존하는 코드는 이식성이 없다.

### 관찰 절차 — Performance 패널에서 루프 읽기

[0-2](../phase-0/02-frontend-toolchain.md)의 DevTools 표에서 예고한 내용이다. 다음 페이지로 long task와 프레임 드랍을 직접 만든다.

```html
<button id="block">200ms 블로킹</button>
<div id="spinner" style="width:40px;height:40px;background:tomato"></div>
<script>
  // CSS 애니메이션 대신 rAF로 스피너를 돌린다 — 메인 스레드 의존을 만들기 위해
  let angle = 0;
  (function spin() {
    spinner.style.transform = `rotate(${(angle += 4)}deg)`;
    requestAnimationFrame(spin);
  })();

  block.addEventListener("click", () => {
    const start = performance.now();
    while (performance.now() - start < 200) {} // 의도적 long task
  });
</script>
```

Performance 패널에서 Record → 버튼 몇 번 클릭 → Stop. 읽는 법:

1. **Main 트랙**에서 클릭마다 200ms짜리 태스크 블록이 보이고, 오른쪽 위 빨간 삼각형이 long task 표시다. 태스크를 클릭하면 하단에 콜 트리(이벤트 리스너 → while)가 나온다.
2. **Frames 트랙**에서 그 구간의 프레임이 길게 늘어지거나 건너뛰어진 것을 확인한다 — "렌더링은 태스크 사이에만"의 실물이다.
3. 태스크 블록 안에서 **Run Microtasks** 구간을 찾을 수 있다 — 태스크 끝의 microtask checkpoint가 트레이스에 그대로 나타난다.

콘솔에서 수치로 보려면 Long Task를 직접 구독할 수도 있다: `new PerformanceObserver((l) => console.log(l.getEntries())).observe({ type: "longtask", buffered: true })`.

## 실무 관점

**"비동기로 바꿨는데 여전히 멈춘다"는 진단의 제1 관문.** async/await·Promise는 **대기를** 비동기화할 뿐 **계산을** 비동기화하지 않는다. JSON 10만 건 파싱, 큰 배열 정렬, 무거운 정규식은 어디에 적혀 있든 스택을 점유한다. 대응은 세 갈래이고 갈림 기준이 뚜렷하다.

| 전략 | 방법 | 무너지는 지점 |
|------|------|--------------|
| 쪼개기(yielding) | 작업을 청크로 나눠 태스크 경계로 양보 — `await new Promise(r => setTimeout(r))` 또는 `scheduler.yield()`(지원 확대 중) | 총 소요 시간은 늘어난다. 쪼갤 수 없는 단일 연산(거대 JSON.parse 한 방)에는 무력 |
| Web Worker | CPU 작업을 별도 스레드로 | 메시지 직렬화 비용(structured clone — [3-10](./10-memory-and-storage.md)), DOM 접근 불가, 코드 구조 변경 비용 |
| 안 하기 | 서버에서 계산해서 내려보내기 | 네트워크 왕복과 서버 비용 |

50ms(long task 기준)를 넘는 동기 구간이 Performance 패널에서 관찰되면 그때 위 표를 꺼낸다 — 계측 전에 최적화하지 않는다.

**읽기 좋은 순서 의존만 남긴다.** "마이크로태스크가 태스크보다 먼저"는 스펙 보장이므로 설계에 써도 되지만(예: 같은 틱의 상태 변경을 모아 한 번에 반영 — 프레임워크 배칭의 원리, Phase 5-3), "타이머 0ms 두 태스크 사이에 네트워크 콜백이 안 끼어든다"류의 가정은 보장이 아니다. 순서가 중요하면 큐 타이밍이 아니라 **명시적 체이닝**(await, then)으로 표현한다.

**setInterval보다 재귀 setTimeout/rAF.** setInterval은 콜백 실행 시간이 간격을 넘으면 실행이 밀리며 쌓이고, 탭 복귀 시 몰아서 발화하는 구현도 있다. 주기 작업은 "끝나고 나서 다음 예약"(재귀 setTimeout), 화면 갱신은 rAF — 간격의 의미가 각각 "휴지 간격"과 "프레임"으로 정확해진다.

## 더 깊이

**스펙의 처리 모델 원문 구조.** HTML §8.1.7.3 "Processing model"은 루프를 의사코드로 정의한다: ① 태스크 큐들 중 하나를 골라(구현 재량) 가장 오래된 태스크를 꺼내 실행 ② microtask checkpoint 수행 ③ 렌더링 갱신이 필요한 문서들에 대해 update the rendering — 이 안에 rAF 콜백 실행(run the animation frame callbacks), 스타일 재계산, 레이아웃, IntersectionObserver 통지 등이 순서대로 나열되어 있다. "rAF는 렌더 직전"이라는 이 문서의 서술은 이 목록의 순서를 읽은 것이다. resize/scroll 이벤트가 이 갱신 절차 안에서 디스패치된다는 것도 원문에서 확인할 수 있다 — scroll 핸들러가 "프레임당 최대 한 번"인 이유다.

**이벤트 루프는 window당이 아니라 agent 단위다.** 같은 프로세스의 same-origin iframe들은 하나의 이벤트 루프를 공유할 수 있다 — 한 프레임의 long task가 다른 프레임까지 멈추는 이유. 반대로 Worker는 자기 전용 루프를 가진 별도 agent다. Site Isolation(프로세스 분리 — [0-1](../phase-0/01-how-the-web-works.md))과 결합하면 "어떤 코드와 루프를 공유하는가"가 성능 격리의 실제 경계가 된다.

**Atomics와 SharedArrayBuffer — "단일 스레드"의 진짜 예외.** SharedArrayBuffer는 agent 간 메모리 공유를 허용하며, 이때만큼은 JS에도 데이터 경쟁이 존재한다(그래서 Atomics API가 있다). Spectre 이후 cross-origin isolation 헤더를 요구하게 된 배경 포함, 일반 앱 코드에서 만날 일은 드물지만 "JS엔 락이 필요 없다"는 명제의 정확한 경계로 알아 둔다.

## 정리

- 이벤트 루프는 ECMA-262가 아니라 WHATWG HTML 스펙(브라우저)·libuv(Node)의 소관이다. 언어는 Job만 정의한다 — 같은 코드의 순서가 환경마다 다를 수 있는 이유.
- 루프의 계약은 run-to-completion이다: 태스크 하나가 끝날 때까지 렌더링도 입력도 끼어들 수 없다. 논블로킹은 I/O 이야기일 뿐, CPU 바운드 코드는 여전히 모든 것을 멈춘다.
- 태스크는 source별 복수 큐(같은 source 안에서만 순서 보장), 마이크로태스크는 스택이 빌 때마다 **전부** 소진 — 그래서 마이크로태스크 연쇄는 렌더링을 굶긴다.
- 렌더링 갱신은 태스크 사이, 프레임 주기에 맞춰 일어나고 rAF 콜백은 그 갱신 절차의 첫머리(렌더 직전)에서 돈다. long task(>50ms)는 그 구간의 프레임을 통째로 소실시킨다 — Performance 패널의 Main/Frames 트랙으로 관찰한다.
- setTimeout의 지연은 최소 보장일 뿐이다(스택 점유, 중첩 4ms 클램핑, 백그라운드 스로틀링). 프레임 정렬은 rAF, 주기 작업은 재귀 setTimeout이 정확한 도구다.

## 확인 문제

**Q1.** 다음 코드의 출력 순서를 예측하고, 각 단계가 어느 큐/체크포인트에서 실행되는지 근거를 대라.

```js
setTimeout(() => {
  console.log("A");
  Promise.resolve().then(() => console.log("B"));
}, 0);

setTimeout(() => console.log("C"), 0);

Promise.resolve().then(() => {
  console.log("D");
  queueMicrotask(() => console.log("E"));
});

console.log("F");
```

<details>
<summary>정답과 해설</summary>

출력: **F → D → E → A → B → C**

도출: 스크립트 태스크에서 동기 F. 스택이 비면 microtask checkpoint — D 실행, D가 등록한 E도 **같은 체크포인트에서**(빌 때까지 소진) 실행. 다음 태스크로 첫 타이머 — A 실행, B를 마이크로태스크로 등록. 태스크가 끝나면 체크포인트 — B. 그 다음 태스크로 두 번째 타이머 — C. 핵심 판별점 두 곳: E가 A보다 먼저(마이크로태스크 소진은 다음 태스크보다 항상 먼저), B가 C보다 먼저(체크포인트는 태스크 하나 끝날 때마다 — 타이머 두 개 사이에도 돈다).
</details>

**Q2.** 진행률 표시를 위해 다음 코드를 짰는데, 화면의 진행률이 0%에서 멈춰 있다가 갑자기 100%가 된다. 원인을 이벤트 루프 모델로 설명하고, 실제로 중간 상태가 그려지게 고쳐라.

```js
async function processAll(items) { // items: 100,000건
  for (let i = 0; i < items.length; i++) {
    heavyTransform(items[i]); // 각 1ms 정도의 동기 작업
    progressBar.style.width = `${(i / items.length) * 100}%`;
  }
}
```

<details>
<summary>정답과 해설</summary>

async 키워드가 붙어 있어도 이 함수 본문에는 await가 없어 **전체가 하나의 동기 실행**(약 100초의 단일 태스크)이다. `style.width` 할당은 스타일을 즉시 그리는 명령이 아니라 다음 렌더링 갱신 때 반영될 값을 써 두는 것인데, 렌더링 기회는 태스크 사이에만 오므로 루프가 끝날 때까지 화면은 한 번도 갱신되지 않는다 — 마지막 값 100%만 그려진다.

수정: 주기적으로 태스크 경계를 만들어 렌더링 기회를 준다.

```js
async function processAll(items) {
  for (let i = 0; i < items.length; i++) {
    heavyTransform(items[i]);
    if (i % 50 === 0) { // 청크당 약 50ms — long task 기준선 아래로
      progressBar.style.width = `${(i / items.length) * 100}%`;
      await new Promise((r) => setTimeout(r)); // 태스크 경계 → 렌더링 기회
    }
  }
}
```

`await Promise.resolve()`로는 안 된다는 점이 함정이다 — 마이크로태스크 경계는 태스크를 끝내지 않으므로 렌더링 기회가 생기지 않는다. 더 근본적으로는 이 작업 자체를 Worker로 옮기는 선택지를 검토한다.
</details>

**Q3.** 스크롤에 따라 요소 위치를 갱신하는 코드 A와 B가 있다. 두 방식의 실행 횟수와 프레임 정렬을 비교하고, 어느 쪽을 택할지 근거와 함께 답하라. (scroll 이벤트 디스패치가 렌더링 갱신 절차 안에서 일어난다는 사실을 전제로.)

```js
// A
window.addEventListener("scroll", () => reposition());

// B
let scheduled = false;
window.addEventListener("scroll", () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    reposition();
    scheduled = false;
  });
});
```

<details>
<summary>정답과 해설</summary>

scroll 이벤트는 렌더링 갱신 절차 안에서 디스패치되므로 프레임당 최대 한 번 발화한다 — 따라서 A도 프레임당 1회 수준으로 돌고, "scroll은 수백 번 난사된다"는 통념은 현대 브라우저에서는 과장이다. 그럼에도 B가 나은 지점이 있다: ① A의 reposition은 이벤트 디스패치 시점(이번 프레임 rAF 이후일 수 있음)에 실행되어 이번 프레임의 스타일 반영을 놓칠 수 있는 반면, B는 다음 rAF — 즉 스타일 계산 직전 — 로 정렬되어 갱신과 페인트의 시차가 없다. ② 스크롤 외 다른 소스(리사이즈, 데이터 갱신)에서도 같은 rAF 스케줄러를 공유하면 프레임당 1회 합류가 보장된다. 대가는 한 프레임의 지연 가능성과 코드 복잡도다. 위치 계산이 가볍다면 A로 충분하고, reposition이 레이아웃을 읽는 무거운 작업이라면 B로 프레임 정렬을 명시하는 것이 맞다 — 판단은 Performance 패널에서 reposition의 실행 위치가 프레임 경계와 어긋나는지 관찰한 뒤에 한다.
</details>

## 참고 자료

- [WHATWG HTML — Event loop processing model (§8.1.7)](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model) — 이 문서 전체의 원문. 태스크 선택→체크포인트→렌더링 갱신의 절차와 rAF의 실행 위치.
- [WHATWG HTML — Timers (§8.6)](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers) — setTimeout의 중첩 클램핑(4ms)이 명시된 위치.
- [ECMA-262 — Jobs and Host Operations (§9.5)](https://tc39.es/ecma262/#sec-jobs) — 언어 쪽 관할의 전부. HostEnqueuePromiseJob이 호스트에 위임되는 지점.
- [Jake Archibald — Tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/) — 단계별 시각화가 뛰어난 검증용 참고. 스펙 원문과 대조하며 읽기.
- [Node.js — The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) — phase 구조, setImmediate, nextTick의 공식 설명.
