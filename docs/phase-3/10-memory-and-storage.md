# 3-10. 메모리와 저장소 — 도달 가능성, 누수 패턴, 저장소의 트레이드오프

> 한 줄 요약: GC 언어의 누수를 "해제 실패"가 아니라 "의도보다 오래 유지되는 도달 경로"로 재정의하고, 프론트엔드 4대 누수 패턴을 힙 스냅샷으로 발견·수정·재확인할 수 있으며, 브라우저 저장소를 동기성·직렬화·용량 기준으로 선택할 수 있다.

*이 문서의 계측 절차와 저장소 API는 브라우저 전용이다.*

## 학습 목표

- 도달 가능성(reachability) 모델과 GC 루트를 기준으로 "GC가 있는데 왜 누수가 있는가"에 답할 수 있다.
- 프론트엔드 4대 누수 패턴(리스너·클로저 환경·detached DOM·한계 없는 캐시)의 도달 경로를 각각 지목할 수 있다.
- Memory 패널의 3-스냅샷 기법과 Detached 검색으로 누수를 발견하는 절차를 수행할 수 있다(과제 C의 절차).
- WeakMap/WeakSet의 용도(도달성에 영향 없는 메타데이터)와 WeakRef를 피해야 하는 이유를 설명할 수 있다.
- 쿠키/localStorage/sessionStorage/IndexedDB를 동기성·직렬화·용량·접근 범위로 비교하고 localStorage의 블로킹 비용을 계측할 수 있다.

## 배경: 왜 이것이 존재하는가

"GC가 있는 언어에서 메모리 누수"는 형용모순처럼 들리지만, JVM 경력자라면 이미 안다 — static Map에 쌓이는 캐시, 해제 안 한 리스너는 Java에서도 누수였다. GC가 보장하는 것은 **도달할 수 없는** 객체의 수거뿐이고, 누수의 정의가 바뀔 뿐이다: 해제를 잊은 메모리가 아니라, **의도한 수명보다 오래 유지되는 도달 경로**. 참조가 하나라도 살아 있으면 GC에게 그 객체는 "사용 중"이다.

프론트엔드 고유성은 누수가 **어디서** 오는가에 있다. 서버의 누수는 대체로 컬렉션에 쌓인다. 프론트엔드의 누수는 리스너, 클로저, 분리된 DOM 노드에서 온다 — 우연이 아니라 구조다. 이 Phase에서 세운 메커니즘들이 각각 도달 경로의 재료이기 때문이다: 리스너는 해제 전까지 살아 있는 참조이고([3-7](./07-dom-and-events.md)), 클로저는 환경 레코드 전체를 붙잡으며([3-2](./02-closures-and-functions.md)), DOM 노드는 JS 래퍼와 C++ 노드가 얽힌 참조 구조다. SPA의 등장이 이것을 실무 문제로 만들었다 — 페이지 전환마다 프로세스가 죽던 시대에는 누수가 리셋됐지만, 화면 전환이 JS 안에서 일어나는 SPA는 몇 시간을 사는 프로세스다.

실패 모드의 차이도 의식할 지점이다. 서버의 OOM은 모니터링이 잡고 재시작이 수습하지만, 프론트의 메모리 압박은 **사용자가 직접 목격한다** — GC 일시 정지가 프레임 드랍으로([3-5](./05-event-loop.md)), 최악에는 탭 크래시로. 게다가 힙 예산이 탭 단위이고 모바일에서는 훨씬 작다.

문서 후반은 JS 힙 밖의 저장소다. 상태를 어디에 두는가 — 쿠키([2-3](../phase-2/03-cookies-and-state.md) 전제), Web Storage, IndexedDB — 는 동기성과 직렬화 모델이 갈리는 설계 선택이고, "Redis처럼 쓰려고 localStorage를 골랐다"는 유의 오판이 메인 스레드 블로킹이라는 이 Phase의 주제로 되돌아온다. 저장소 보안(XSS 노출, 토큰 저장 위치 논쟁)은 Phase 7-4로 위임한다.

## 핵심 개념

### 도달 가능성 — GC의 유일한 질문

GC의 판정 기준은 하나다: **GC 루트에서 참조를 따라 도달할 수 있는가.** 루트는 전역 객체(globalThis와 그 프로퍼티), 현재 콜 스택의 지역 변수들, 그리고 호스트가 유지하는 참조들(활성 타이머의 콜백, 등록된 이벤트 리스너, 진행 중인 fetch의 콜백 등)이다. 도달 가능하면 생존, 불가능하면 수거 대상 — 순환 참조끼리만 서로를 가리키는 섬은 루트에서 끊긴 순간 통째로 수거된다(참조 카운팅이 아니라 도달성 추적이므로).

이 모델에서 누수 진단의 질문이 정해진다. "왜 이 객체가 해제 안 되지?"가 아니라 — **"루트에서 이 객체까지의 경로에 무엇이 있지?"** Memory 패널의 Retainers 뷰가 정확히 이 경로를 보여주며, 이 문서의 계측 절차 전체가 이 질문의 답을 찾는 과정이다.

호스트 참조가 루트에 포함된다는 점이 프론트엔드 누수의 문법이다: `setInterval(cb, 1000)`은 clearInterval 전까지 cb를(그리고 cb가 캡처한 환경 전체를) 루트에 묶고, `el.addEventListener(t, fn)`은 el이 살아 있는 한 fn을 묶는다. "내 코드 어디에도 참조가 없는데"의 답은 대부분 호스트 쪽 장부에 있다.

### V8의 세대별 GC — 구현 세부와 관찰 지점

여기서부터 한 절은 **V8 구현 세부**다(표준은 GC의 존재조차 규정하지 않는다). JVM 경력자에게는 구조가 낯익다 — 세대 가설(객체 대부분은 어리게 죽는다) 위의 세대별 수집이라는 점이 같다.

- **New space(young generation)** — 새 객체가 태어나는 작은 공간(수 MB). **Scavenger**가 semi-space 복사 방식으로 자주, 짧게(밀리초 미만~수 ms) 수집한다. 두 번의 수집에서 살아남은 객체는 old space로 승격.
- **Old space** — **Mark-Sweep-Compact**가 담당한다. 전체 힙 마킹은 비싸므로 V8은 동시(concurrent) 마킹·증분(incremental) 마킹·병렬 스위핑으로 메인 스레드 정지를 잘게 쪼갠다(Orinoco 프로젝트).

그래도 정지는 0이 아니고, 메인 스레드 정지는 곧 프레임 드랍이다([3-5](./05-event-loop.md)의 "태스크 사이에만 렌더링"에서, GC 정지는 태스크와 무관하게 끼어드는 침입자다). **관찰 방법**: Performance 패널에서 기록하면 Main 트랙에 "Minor GC"(Scavenger)와 "Major GC" 블록이 노란색으로 표시된다. 애니메이션 도중 대량 할당(매 프레임 큰 배열 생성 등)을 하면 Minor GC가 프레임 예산을 갉아먹는 것을 직접 볼 수 있다 — "핫 루프에서 할당을 줄여라"라는 조언의 관찰 가능한 근거다. 단, 이 최적화는 계측으로 GC가 병목임을 확인한 뒤에만 한다.

### 프론트엔드 4대 누수 패턴 — 도달 경로의 해부

각 패턴을 재현 코드와 함께, "루트에서의 경로"를 지목하며 해부한다. 공통 무대는 SPA의 화면 전환 — 화면 A를 만들었다 B로 이동하며 A를 "버리는" 상황이다.

**① 해제 안 한 리스너.** 경로: `window`(루트) → 리스너 목록 → 핸들러 클로저 → 캡처된 환경 → 화면 A의 모든 것.

```js
// ❌ 화면 A — 전환 시 아무도 이 리스너를 해제하지 않는다
function mountScreenA(container) {
  const bigState = loadHugeData();
  window.addEventListener("resize", () => relayout(bigState, container));
  // container를 DOM에서 제거해도, window의 리스너가
  // 클로저 → bigState와 container를 루트에 묶어 둔다
}

// ✅ 화면 수명과 리스너 수명을 signal 하나로 묶는다 (3-6, 3-7)
function mountScreenA(container) {
  const controller = new AbortController();
  const bigState = loadHugeData();
  window.addEventListener("resize", () => relayout(bigState, container), {
    signal: controller.signal,
  });
  return () => controller.abort(); // unmount 함수 — 화면 전환 시 호출
}
```

주의할 구분: 리스너가 누수가 되는 것은 **대상이 화면보다 오래 살 때**(window, document, 전역 이벤트 버스)다. 제거되는 요소 자신에 붙은 리스너는 요소와 함께 도달 불가능해지므로 그 자체로는 누수가 아니다.

**② 클로저가 잡은 환경.** [3-2](./02-closures-and-functions.md)의 캡처 단위(환경 레코드 전체, V8에서는 스코프 공유 Context)가 낳는 결과다. 오래 사는 콜백 하나(setInterval, 전역 캐시에 든 함수)가 의도치 않게 큰 환경을 붙잡는다. ①과 결합해 증폭되는 것이 전형이다 — 리스너 하나가 화면 전체의 환경을 물고 있는 구조. 진단 시 Retainers에 `context in ...`이 보이면 이 패턴이다.

**③ 분리된(detached) DOM 노드.** DOM에서 떼어냈지만 JS 참조가 남은 노드다. 함정의 크기는 **노드 하나가 아니라 트리**라는 데 있다 — 부모를 잡으면 자식 전체가, 자식 하나를 잡아도 (parentNode 링크로) 트리 전체가 산다.

```js
// ❌ 목록을 다시 그리며 옛 노드 참조를 배열에 계속 쌓는 코드
const rendered = [];
function renderList(items) {
  list.replaceChildren(); // DOM에서는 제거됐지만
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item.title;
    rendered.push(li); // 참조가 남아 detached 트리로 생존
    list.append(li);
  }
}
// 갱신마다 이전 세대의 <li>들이 전부 detached로 누적된다
```

수리는 참조 수명을 DOM 수명에 맞추는 것 — 여기서는 `rendered.length = 0`을 갱신 시점에 넣거나, 애초에 참조 보관 자체를 없앤다(필요할 때 querySelector).

**④ 한계 없는 캐시/Map.** [3-2](./02-closures-and-functions.md)의 memoize가 경고한 지점이다. Map·객체에 keyed로 쌓기만 하는 자료구조는 도달 경로가 명시적이라 GC가 손댈 수 없다. 수리는 정책 부여다 — 크기 상한(LRU), TTL, 또는 키가 객체라면 다음 절의 WeakMap.

### WeakMap/WeakSet — 도달성에 영향 없는 연결

④의 특수하지만 흔한 경우: **객체에 메타데이터를 붙이고 싶은데, 그 연결이 객체를 살리면 안 된다.** DOM 노드별 상태, 서드파티 객체에 대한 주석 등이다. 일반 Map은 키를 강하게 참조하므로 실격이다. WeakMap의 키 참조는 도달성 계산에서 **제외**된다 — 키 객체가 다른 곳에서 도달 불가능해지면 (키, 값) 항목이 통째로 수거된다.

```js
const nodeState = new WeakMap(); // 노드 → 상태. 노드의 수명에 개입하지 않는다
function markProcessed(node, info) {
  nodeState.set(node, info);
}
// node가 DOM과 다른 참조에서 사라지면 info까지 함께 수거된다 — 정리 코드가 필요 없다
```

설계상의 필연으로 WeakMap은 순회할 수 없고 size도 없다 — "지금 뭐가 들었나"를 관찰할 수 있다면 그 관찰이 곧 도달 경로가 되기 때문이다. 키는 객체(와 등록된 심벌)만 가능하다(원시 값은 정체성이 없으므로).

**WeakRef/FinalizationRegistry는 다른 물건이다** — "거의 항상 쓰지 말아야 한다"가 TC39 제안 문서 자체의 권고다. WeakMap이 선언적 관계(연결의 수명 위임)라면, WeakRef는 GC의 동작을 코드에 노출한다(`deref()`가 undefined를 주는 시점이 GC 타이밍에 달렸다). GC 타이밍은 표준이 아무것도 보장하지 않으므로 — 수거가 일어난다는 보장조차 없다 — WeakRef 의존 로직은 엔진·버전·메모리 압박에 따라 다르게 동작하는 코드다. 정당한 용도는 "있으면 쓰고 없으면 다시 만드는" 순수 최적화 캐시 정도로 좁다.

### 계측 절차 — 과제 C의 뼈대

[0-2](../phase-0/02-frontend-toolchain.md)에서 예고한 Memory 패널이 이 절의 도구다. 누수는 코드 리뷰가 아니라 계측으로 발견한다.

**절차 1 — 3-스냅샷 기법 (누수 존재의 확인과 범인 식별):**

1. 앱을 안정 상태로 만들고(초기 로딩 완료), 스냅샷 ①을 찍는다. 찍기 전 패널의 GC 버튼(휴지통)으로 강제 수거를 해 둔다.
2. 의심 시나리오를 수행한다 — 화면 A 진입 → 이탈을 한 사이클.
3. 강제 GC 후 스냅샷 ②. 다시 같은 시나리오를 반복하고 강제 GC 후 스냅샷 ③.
4. 스냅샷 ③을 열고 비교 뷰를 "Objects allocated between Snapshot 1 and Snapshot 2"로 설정한다 — **1~2 사이에 할당됐는데 ③까지 살아남은 객체들**, 즉 "화면 이탈 후에도 남는 것"만 걸러진다. 사이클을 반복해도 이 목록이 계속 자라면 누수 확정이다.
5. 항목을 클릭해 하단 **Retainers**에서 루트까지의 경로를 읽는다 — 경로에 보이는 이름(리스너 핸들러, context, 배열)이 곧 4대 패턴 중 무엇인지 알려 준다.

**절차 2 — Detached 검색 (패턴 ③ 전용):** 스냅샷의 클래스 필터에 "Detached"를 입력하면 detached 상태의 요소·트리가 모인다. shallow size 대비 **retained size**(이것까지 수거되면 함께 풀리는 총량)가 큰 항목이 우선 수사 대상이다.

**절차 3 — Allocation timeline (할당의 시간 분포):** "Allocations on timeline"으로 기록하면 파란 막대(생존)와 회색 막대(수거됨)가 시간축에 찍힌다. 특정 인터랙션마다 파란 막대가 남는다면 그 시점의 할당 스택을 바로 펼쳐 볼 수 있다 — 어느 함수의 할당인지까지 한 번에 나온다.

과제 C는 이 절차를 그대로 수행한다: 의도적 누수 버전을 만들고 → 절차 1~2로 "발견"하고 → 수정 후 같은 절차로 목록이 자라지 않음을 재확인한다. 원인-관찰-수정-재확인의 구조가 Phase 7 성능 리포트의 축소 연습이다.

### 브라우저 저장소 — 동기성과 직렬화가 갈림 기준

JS 힙은 탭이 닫히면 사라진다. 살아남아야 하는 상태의 자리가 저장소이고, 선택 기준은 API 모양이 아니라 **동기성·직렬화·용량·접근 범위**다.

| | 쿠키 | localStorage | sessionStorage | IndexedDB |
|---|------|-------------|----------------|-----------|
| 동기성 | (자동 전송) | **동기 — 메인 스레드 블로킹** | 동기 | **비동기(트랜잭션)** |
| 값 모델 | 문자열 | 문자열만 | 문자열만 | structured clone — 객체·Blob·Map까지 |
| 용량 | ~4KB/개 | 오리진당 ~5MB | ~5MB | 수백 MB+ (디스크 여유 기반 할당) |
| 범위/수명 | 서버로 **매 요청 전송**([2-3](../phase-2/03-cookies-and-state.md)) | 오리진, 영구 | 오리진 + **탭**, 탭 종료까지 | 오리진, 영구 |
| 워커 접근 | — | 불가 | 불가 | 가능 |
| 적합 | 서버가 읽어야 하는 소량(세션 식별) | 소량 설정, 동기 필요 값 | 탭 단위 임시 상태 | 구조화 데이터, 대용량, 오프라인 |

(XSS 노출 — 스크립트가 읽을 수 있는가 — 도 비교축이지만 상세는 Phase 7-4에서 다룬다.)

두 지점을 메커니즘으로 짚는다.

**localStorage의 동기 블로킹 — "간편함의 가격".** `getItem`/`setItem`은 동기 API다 — 디스크 I/O가 얽힌 작업이 메인 스레드에서 완료까지 기다린다. 값이 크거나 호출이 잦으면(스크롤마다 상태 저장 등) 이것이 long task의 재료가 된다. **계측 방법**: Performance 패널에서 기록하며 대용량 setItem을 실행하면 Main 트랙에 해당 블록이 그대로 보인다. 코드로도 잰다:

```js
const big = JSON.stringify({ items: new Array(50_000).fill({ title: "x".repeat(50) }) });
performance.mark("ls-start");
localStorage.setItem("state", big);
performance.mark("ls-end");
performance.measure("localStorage write", "ls-start", "ls-end");
console.log(performance.getEntriesByName("localStorage write")[0].duration, "ms");
// 수 MB급 문자열에서 수십 ms — 프레임 여러 개 값이다. JSON.stringify 비용도 함께 든다
```

과제 C의 계측 항목 ③이 이 측정이다. Todo 앱 수준(수 KB)에서는 무해하지만, "전체 앱 상태를 매 변경마다 localStorage에"라는 설계가 데이터 성장과 함께 무너지는 경계가 이 숫자에 있다. Redis처럼 쓰려면 IndexedDB(비동기)가 맞는 도구다.

**structured clone은 JSON이 아니다.** IndexedDB가 값을 저장할 때 쓰는 직렬화(HTML 스펙의 structured clone 알고리즘)는 Worker 메시지([3-5](./05-event-loop.md))와 같은 것으로, JSON보다 표현력이 넓다: Date·Map·Set·ArrayBuffer·Blob·순환 참조까지 다룬다(함수·DOM 노드·프로토타입 체인은 안 된다 — 데이터만 복제된다). "JSON.stringify 왕복으로 Date가 문자열이 되는" 문제가 IndexedDB에는 없다.

IndexedDB의 생 API(이벤트 기반 트랜잭션)는 장황하기로 유명하므로, 실무에서는 Promise 래퍼(idb 등)를 쓰는 것이 통례다 — 과제에서는 키-값 수준의 얕은 사용이면 충분하다.

## 실무 관점

**누수 대응은 사후 진단보다 수명 설계가 먼저다.** 4대 패턴의 공통 수리가 전부 "수명의 명시화"였다: 리스너는 signal로 화면 수명에, 캐시는 정책으로 상한에, 노드 참조는 DOM 수명에, 메타데이터는 WeakMap으로 대상 수명에 묶는다. "만드는 코드마다 파괴 경로를 함께 쓴다"는 규율 — mount가 unmount 함수를 반환하는 위 패턴 — 이 프레임워크 없는 코드의 최소 장치이고, React의 이펙트 클린업(Phase 5-4)은 이 규율의 프레임워크 버전이다.

**"메모리가 는다 ≠ 누수다"를 구분한다.** GC 언어의 힙은 톱니 모양으로 오르내리는 것이 정상이고, V8은 여유가 있으면 수거를 미룬다. 판정 기준은 절대량이 아니라 **강제 GC 후에도 사이클마다 단조 증가하는가**(3-스냅샷 기법이 정확히 이것을 걸러낸다)다. 성급한 "누수 같다" 보고 전에 강제 GC 버튼부터 누른다.

**저장소 선택의 흔한 오판 두 가지.** ① 인증 토큰을 localStorage에 — 편하지만 XSS 노출 논쟁의 중심이다(판단 기준은 Phase 7-4에서). ② 서버가 읽을 필요 없는 데이터를 쿠키에 — 쿠키는 **매 요청 헤더에 실려 나간다**([2-3](../phase-2/03-cookies-and-state.md)). 4KB 쿠키는 모든 API 호출에 4KB 업로드 세금이다. "서버가 읽는가"가 쿠키 여부의 유일한 기준이다.

**Storage 이벤트로 탭 간 동기화가 된다는 것도 알아 둔다.** 다른 탭이 localStorage를 바꾸면 `window`의 `storage` 이벤트가 온다(바꾼 탭 자신에게는 안 온다). "한 탭에서 로그아웃하면 모든 탭이 반응"의 표준 구현 경로다 — 더 일반화된 채널은 BroadcastChannel.

## 더 깊이

**retained size의 정확한 의미.** 스냅샷의 shallow size는 객체 자신의 크기, retained size는 "이 객체가 수거되면 함께 도달 불가능해지는 모든 것"의 합 — 지배자 트리(dominator tree)에서 이 노드가 지배하는 서브트리 크기다. 누수 수사에서 shallow가 작아도 retained가 거대한 객체(작은 클로저가 큰 환경을 물고 있는)가 진짜 범인인 이유이고, 정렬 기준을 retained로 두는 것이 관례다.

**DOM 노드의 수거는 두 힙의 협상이다.** JS 래퍼는 V8 힙에, C++ 노드는 Blink 힙(Oilpan)에 살고 서로를 참조한다. 순환처럼 보이는 이 구조를 위해 두 GC가 교차 참조를 추적하는 통합 절차(unified heap)를 돈다 — 스냅샷에서 detached 노드의 retainer가 JS 객체로 이어지는 것을 볼 수 있는 배경이다. 구현 세부이지만, "DOM 참조 하나가 문서 밖 트리 전체 + 그 리스너들 + 클로저 환경까지 잡는" 연쇄의 물리적 근거다.

**저장소의 지속성은 절대가 아니다.** "영구" 저장소도 스토리지 압박 시 브라우저가 오리진 단위로 비울 수 있다(eviction). `navigator.storage.persist()`로 지속성을 요청하고 `estimate()`로 할당량을 조회하는 Storage API가 이 계약의 명시적 표면이다. 오프라인 앱(Phase 7)에서 중요해지는 전제이므로 위치만 기억해 둔다.

## 정리

- GC는 도달 불가능만 수거한다. 누수 = 의도한 수명보다 오래 유지되는 도달 경로이고, 진단 질문은 "루트에서 이 객체까지 무엇이 잇는가"(Retainers 뷰)다.
- V8은 세대별 GC(Scavenger + Mark-Sweep-Compact, 구현 세부)이고, GC 정지는 Performance 패널에서 Minor/Major GC 블록으로 — 프레임 드랍의 형태로 — 관찰된다.
- 4대 누수 패턴(오래 사는 대상의 리스너, 클로저가 잡은 환경, detached DOM 참조, 한계 없는 캐시)의 공통 수리는 수명의 명시화다 — AbortSignal, 캐시 정책, 참조 정리, WeakMap.
- 누수 판정은 3-스냅샷 기법(사이클 반복 + 강제 GC 후에도 단조 증가하는가)으로 하고, detached 검색과 allocation timeline이 범인의 종류와 발생 지점을 좁힌다.
- 저장소는 동기성·직렬화·용량·범위로 고른다: 서버가 읽으면 쿠키, 소량 동기 값은 localStorage(블로킹 비용을 계측 전제로), 탭 임시는 sessionStorage, 구조화·대용량·워커 접근은 IndexedDB(structured clone — JSON보다 넓다).

## 확인 문제

**Q1.** 다음 코드의 화면을 100번 열고 닫은 뒤 힙이 계속 자라 있었다. 도달 경로(루트 → …)를 구체적으로 지목하고, 이 코드에 필요한 수리를 전부 나열하라.

```js
function openChart(container, dataUrl) {
  let points = [];
  const timer = setInterval(async () => {
    points = points.concat(await (await fetch(dataUrl)).json());
    drawChart(container.querySelector("canvas"), points);
  }, 5000);
  window.addEventListener("resize", () => drawChart(container.querySelector("canvas"), points));
  container.innerHTML = "<canvas></canvas>";
}
// 화면 닫기: container.remove() 만 호출한다
```

<details>
<summary>정답과 해설</summary>

도달 경로가 둘이다. ① **활성 타이머**(루트) → setInterval 콜백 클로저 → 환경(points 배열 — 5초마다 무한히 자란다! — container, dataUrl). clearInterval이 없으므로 화면을 닫아도 타이머는 영원히 돌며 fetch까지 계속 날린다. ② **window**(루트) → resize 리스너 → 클로저 → 같은 환경. container.remove()는 DOM에서 떼어낼 뿐 — 두 경로가 container를 잡고 있으므로 canvas를 포함한 트리 전체가 detached로 생존한다(패턴 ①+②+③+④가 한 코드에 다 있다).

수리: unmount 경로를 만든다 — `const controller = new AbortController()`로 리스너 등록(`{signal}`), 타이머 id 보관 후 정리 함수에서 `clearInterval(timer); controller.abort()`. fetch에도 signal을 전파해 진행 중 요청을 끊는다([3-8](./08-network-apis.md)). points에는 상한(최근 N개 유지)을 둔다. 검증은 3-스냅샷 기법으로 열기/닫기 사이클 후 생존 객체 목록이 더 이상 자라지 않음을 확인한다.
</details>

**Q2.** DOM 노드마다 툴팁 설정을 연결하는 유틸을 만들려 한다. 두 구현의 메모리 동작 차이를 설명하고 어느 쪽을 택할지 답하라. 그리고 WeakMap 버전에서 "현재 등록된 툴팁 개수"를 세는 기능 요청이 왔다면 어떻게 답하겠는가?

```js
// A
const tooltips = new Map();
// B
const tooltips = new WeakMap();
// 공통: tooltips.set(node, { text, position });
```

<details>
<summary>정답과 해설</summary>

A(Map)는 키(node)를 강하게 참조한다 — 노드가 DOM에서 제거되고 다른 참조가 없어도 Map이 도달 경로가 되어 노드(와 parentNode 체인으로 이어진 detached 트리)가 영원히 산다. 명시적 `tooltips.delete(node)`를 노드 제거 시마다 챙겨야 하는데, 그 규율이 무너지는 지점이 곧 누수다. B(WeakMap)는 키 참조가 도달성에서 제외되므로 노드가 사라지면 (노드, 설정) 항목이 자동 수거된다 — 정리 코드 자체가 불필요하다. 노드 수명에 부속되는 메타데이터이므로 B가 정답이다.

개수 세기 요청에는: WeakMap은 설계상 순회·size가 불가능하다(관찰 가능하면 그 관찰이 도달 경로가 되어 자동 수거와 모순). 기능이 정말 필요하면 수명 관리 책임을 되가져와야 한다 — 등록/해제를 명시 API로 만들고 내부에서 Map + 명시적 delete(또는 Set으로 키 목록만 별도 추적)를 쓰는 것이며, 이는 "자동 수거"라는 B의 이점을 포기하는 트레이드오프임을 함께 알린다. 두 속성(자동 수거, 열거 가능)은 원리적으로 양립하지 않는다.
</details>

**Q3.** 오프라인에서도 동작하는 메모 앱을 설계 중이다. 동료가 "localStorage로 통일하자, API가 제일 간단하다"고 한다. 메모에 이미지 첨부(수 MB Blob)와 작성일(Date), 그리고 "저장 중에도 타이핑이 끊기면 안 된다"는 요구가 있다. localStorage 선택이 무너지는 지점 세 곳을 요구사항과 짝지어 설명하고 대안을 제시하라.

<details>
<summary>정답과 해설</summary>

① **동기 블로킹 vs "타이핑이 끊기면 안 된다"**: setItem은 메인 스레드에서 완료까지 동기로 돈다. 수 MB 문자열 쓰기는 수십 ms — long task로 입력 처리와 프레임을 막는다(performance.measure로 계측 가능). ② **문자열 한정 vs 이미지 Blob**: localStorage는 문자열만 저장하므로 Blob을 base64로 인코딩해야 한다 — 크기가 약 4/3로 붓고, 인코딩/디코딩 비용이 매번 메인 스레드에 추가된다. ③ **용량 ~5MB vs 수 MB 첨부**: 메모 몇 개면 오리진 할당량이 끝나고, 초과 시 setItem이 QuotaExceededError를 던진다. 부수적으로 ④ Date도 JSON 직렬화에서 문자열로 퇴화해 복원 코드가 필요하다.

대안: IndexedDB — 비동기 트랜잭션(타이핑과 저장이 겹쳐도 메인 스레드를 세우지 않는다), structured clone(Blob·Date를 그대로 저장), 수백 MB급 할당량. 생 API의 장황함은 idb 같은 Promise 래퍼로 흡수한다. localStorage는 "마지막 열람 위치" 같은 소량 동기 설정에만 남긴다 — 도구를 데이터의 크기·모양·동시성 요구에 맞추는 것이 저장소 선택의 전부다.
</details>

## 참고 자료

- [MDN — Memory management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management) — 도달 가능성 모델과 GC 개요의 표준 참조.
- [v8.dev — Trash talk: the Orinoco garbage collector](https://v8.dev/blog/trash-talk) — Scavenger/Mark-Sweep-Compact, 동시·증분 수집의 공식 해설(구현 세부의 1차 자료).
- [Chrome DevTools — Memory 패널로 메모리 문제 해결](https://developer.chrome.com/docs/devtools/memory-problems) — 힙 스냅샷 비교, Detached 검색, allocation timeline의 공식 가이드. 과제 C의 절차 원본.
- [WHATWG HTML — Web storage (§12)](https://html.spec.whatwg.org/multipage/webstorage.html) — localStorage/sessionStorage의 동기 API와 storage 이벤트 정의.
- [W3C — Indexed Database API](https://www.w3.org/TR/IndexedDB/) — 트랜잭션 모델과 structured clone 저장의 표준. Promise 래퍼로는 [idb](https://github.com/jakearchibald/idb) 참고.
