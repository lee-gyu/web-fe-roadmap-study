# 3-7. DOM과 이벤트 — 경계 비용과 전파 모델

> 한 줄 요약: "DOM 조작은 느리다"에서 실제로 비싼 것이 무엇인지(경계 호출이 아니라 무효화되는 후속 작업) 구분할 수 있고, 이벤트 전파 3단계 위에서 위임과 커스텀 이벤트로 프레임워크 없는 컴포넌트 경계를 세울 수 있다.

*이 문서의 예제는 브라우저 전용이다 (DOM API — Node 24에서는 실행되지 않는다).*

## 학습 목표

- DOM 노드가 JS 객체가 아니라 렌더러 내부 구조에 대한 바인딩임을 알고, 조작 비용의 실제 소재(스타일·레이아웃 무효화)를 설명할 수 있다.
- live 컬렉션과 static 컬렉션의 차이로 "순회 중 절반만 처리되는" 버그를 진단할 수 있다.
- 이벤트 전파 3단계(capture/target/bubble)와 리스너 옵션(capture/once/passive)의 효과를 설명할 수 있다.
- 이벤트 위임의 성립 조건과 안 되는 이벤트를 알고, 동적 목록의 리스너를 위임으로 설계할 수 있다(과제 A의 핵심 패턴).
- CustomEvent로 프레임워크 없이 컴포넌트 간 통신 경계를 세울 수 있다.

## 배경: 왜 이것이 존재하는가

"DOM 조작은 느리니 최소화하라"는 조언은 프론트엔드에서 가장 오래된 통념 중 하나이고, React의 존재 이유 설명에도 단골로 등장한다. 하지만 이 문장은 무엇이 느린지 말해 주지 않아서, 잘못된 방향의 최적화(DOM 접근 자체를 겁내는 코드)를 낳는다. 이 문서의 첫 번째 목표는 비용의 소재를 분해하는 것이다: **접근(경계 호출)은 싸고, 조작이 유발하는 후속 작업(스타일·레이아웃 재계산)이 비싸며, 가장 비싼 것은 읽기와 쓰기의 교차가 강제하는 동기화다.**

경력자의 기존 경험에서 정확한 유비가 있다. DOM 경계는 JNI/FFI 경계와 같은 구조다 — JS 객체처럼 보이는 `element`는 실제로는 렌더러의 C++ 노드에 대한 바인딩(프록시)이고, 호출 하나는 싸지만 루프 안에서 경계를 교차하며 상태를 읽고 쓰면 비용이 계단식으로 커진다. JNI에서 "경계를 넘는 횟수를 줄이고 배치로 넘겨라"가 규칙이듯, DOM에서도 같은 규칙(읽기 모아서, 쓰기 모아서)이 성립한다.

두 번째 축인 이벤트 시스템에도 서버 경험의 유비가 있다. 이벤트 위임(delegation)은 서버 라우터가 하는 일 — 진입점 하나에서 요청을 받고 경로로 디스패치 — 의 DOM 버전이다. 항목 1,000개에 리스너 1,000개를 붙이는 대신 컨테이너 하나가 받아서 어느 항목인지 판별한다. 이 패턴이 성립하는 근거(버블링)와 무너지는 지점(버블링 안 하는 이벤트)까지가 이 문서의 범위다.

이 문서는 [3-5](./05-event-loop.md)의 이벤트 루프(이벤트 디스패치와 태스크의 관계)와 [1-1](../phase-1/01-html-basics.md)에서 세운 속성 vs 프로퍼티 구분을 전제한다. 렌더링 파이프라인의 내부(스타일→레이아웃→페인트의 각 단계, layout thrashing의 상세 진단)는 Phase 7-1로 위임하고, 여기서는 비용 모델의 뼈대만 세운다. innerHTML의 보안 문제(XSS)는 존재만 언급하고 상세는 Phase 7-4에서 다룬다. Shadow DOM과 Web Components는 컴포넌트 경계의 표준화 시도로 존재만 언급한다.

## 핵심 개념

### DOM은 바인딩이다 — 비용의 3층 분해

`document.createElement("div")`가 돌려주는 것은 순수 JS 객체가 아니다. 렌더러 내부(Blink라면 C++)의 노드 객체가 실체이고, JS가 만지는 것은 그것에 대한 바인딩이다. DOM Standard가 인터페이스를 IDL로 정의하고 각 브라우저가 자기 엔진에 바인딩을 생성한다. 이 구조에서 비용이 3층으로 나뉜다.

**1층 — 경계 호출 비용: 싸다.** `el.id` 읽기, `getAttribute` 호출 같은 단순 접근은 JS→C++ 왕복이 있지만 나노초~마이크로초 수준이다. 이것을 겁내서 DOM 읽기를 캐싱하는 최적화는 대부분 무의미하다.

**2층 — 무효화 비용: 조작의 진짜 가격.** 노드를 추가·삭제하거나 스타일에 영향을 주는 값을 바꾸면, 렌더러는 계산해 둔 스타일과 레이아웃(기하 정보)에 "더 이상 유효하지 않음" 표시를 한다. 재계산 자체는 즉시 하지 않고 다음 렌더링 기회([3-5](./05-event-loop.md))까지 미룬다 — 그래서 같은 태스크 안에서 스타일을 100번 바꿔도 재계산은 한 번이다. 브라우저가 이미 배칭을 해 주는 것이다.

**3층 — 강제 동기 레이아웃: 배칭을 깨는 비용.** 문제는 무효화된 상태에서 **기하 정보를 읽을 때** 터진다. `offsetHeight`, `getBoundingClientRect()`, `getComputedStyle()` 같은 읽기는 정확한 값을 줘야 하므로, 무효 표시가 있으면 브라우저는 미뤄 둔 재계산을 **그 자리에서 동기로** 수행한다(forced synchronous layout). 쓰기→읽기→쓰기→읽기가 교차하는 루프는 반복마다 이 동기 재계산을 강제한다.

```js
// ❌ 쓰기(width 변경)와 읽기(offsetWidth)가 교차 — 반복마다 강제 동기 레이아웃
boxes.forEach((box) => {
  box.style.width = `${box.parentElement.offsetWidth / 2}px`; // 읽고 → 쓴다 → 다음 반복의 읽기가 재계산 강제
});

// ✅ 읽기 전부 → 쓰기 전부: 재계산은 최대 1회
const widths = boxes.map((box) => box.parentElement.offsetWidth);
boxes.forEach((box, i) => {
  box.style.width = `${widths[i] / 2}px`;
});
```

관찰 방법: Performance 패널에서 기록하면 교차 버전은 보라색 Layout 블록이 루프 안에 반복해서 나타나고, DevTools가 "Forced reflow is a likely performance bottleneck" 경고를 붙인다. 분리 버전은 태스크 끝에 Layout이 한 번이다. 어떤 API가 강제 동기 레이아웃을 유발하는지의 목록과 파이프라인 내부는 Phase 7-1에서 상세히 다룬다 — 여기서는 **"기하를 읽는 API는 밀린 계산서를 그 자리에서 청구한다"** 는 모델까지만 세운다.

### 배치 관점의 조작 도구

비용 모델에서 도구 선택 기준이 나온다. 목표는 "무효화 횟수"가 아니라(어차피 배칭된다) **경계 교차 횟수와 문서 연결 시점**의 관리다.

- **DocumentFragment** — 문서에 연결되지 않은 임시 컨테이너. 노드 100개를 문서에 하나씩 append하는 대신 fragment에 조립한 뒤 한 번에 붙인다. fragment 안에서의 조작은 렌더 트리와 무관하므로 무효화가 없고, 최종 append 한 번만 문서를 건드린다.

```js
const fragment = document.createDocumentFragment();
for (const item of items) {
  const li = document.createElement("li");
  li.textContent = item.title;
  fragment.append(li);
}
list.append(fragment); // 문서 변경은 이 한 번 — fragment 자신이 아니라 자식들이 이동한다
```

- **textContent vs innerHTML** — 텍스트만 바꿀 때는 textContent가 정답이다. innerHTML은 문자열을 **HTML로 파싱**하므로(파서 기동 비용 + 기존 자식 전부 파괴·재생성), 텍스트 갱신 용도로는 순수 낭비다. 더 중요한 차이는 보안이다: innerHTML에 사용자 입력이 섞이면 마크업으로 해석되어 스크립트 주입(XSS)의 통로가 된다 — 방어 상세는 Phase 7-4에서 다루고, 여기서는 규칙만 세운다: **사용자 데이터는 textContent로, 구조는 createElement로**. 신뢰된 정적 템플릿 문자열에만 innerHTML을 쓴다.

### live vs static 컬렉션 — "왜 절반만 지워지는가"

DOM 질의 API는 반환물의 성격이 둘로 갈린다. `getElementsByTagName`·`getElementsByClassName`·`children`이 돌려주는 **HTMLCollection은 live**다 — 컬렉션이 결과의 복사본이 아니라 "그 조건에 맞는 현재 노드들"에 대한 뷰라서, 문서가 바뀌면 내용이 따라 바뀐다. `querySelectorAll`이 돌려주는 **NodeList는 static**이다 — 호출 시점의 스냅숏이고 이후 문서 변경과 무관하다.

live 컬렉션을 순회하며 문서를 바꾸면 고전적인 함정이 발동한다.

```html
<div id="box"><p>1</p><p>2</p><p>3</p><p>4</p></div>
<script>
  // ❌ live 컬렉션 + 제거 — 절반만 지워진다
  const live = box.getElementsByTagName("p"); // live: 길이가 실시간으로 변한다
  for (let i = 0; i < live.length; i++) {
    live[i].remove();
    // i=0에서 <p>1</p> 제거 → 컬렉션이 [2,3,4]로 줄고 → i=1은 <p>3</p>다!
  }
  console.log(box.innerHTML); // 출력: <p>2</p><p>4</p> — 하나 걸러 하나 생존

  // ✅ static 스냅숏으로 순회
  for (const p of box.querySelectorAll("p")) p.remove();
</script>
```

인덱스가 전진하는 동안 컬렉션이 수축해서 요소를 건너뛰는 것 — 배열을 순회하며 splice하는 버그와 같은 구조인데, DOM에서는 **내가 splice를 호출하지 않아도** 컬렉션이 스스로 변한다는 점이 함정을 키운다. live 순회가 필요하면 역방향 인덱스나 `while (live.length)` 패턴을 쓰지만, 기본값은 querySelectorAll이다. 반대급부로 static은 "질의 후 추가된 노드를 모른다" — 스냅숏 시점을 의식해야 한다.

`childNodes`처럼 NodeList인데 live인 예외도 있으므로(타입이 아니라 API별로 정해진다), 판단 기준은 "이 API의 반환물이 live인가"를 MDN에서 확인하는 것이다.

### 속성 vs 프로퍼티 — 폼 상태 관리의 관점

[1-1](../phase-1/01-html-basics.md)에서 세운 구분 — 속성(attribute)은 HTML에 적힌 초기 설정, 프로퍼티는 DOM 객체의 살아있는 상태 — 이 폼에서 실무 문제가 된다.

```js
const input = document.querySelector("#title");
// 사용자가 "hello"를 타이핑한 상태에서:
input.getAttribute("value"); // 출력: "" (또는 HTML의 초기값) — 문서의 직렬화 상태
input.value;                 // 출력: "hello" — 지금의 진짜 상태
input.defaultValue;          // 속성 쪽을 프로퍼티로 읽는 별도 통로
```

이 이중성이 만드는 설계 문제: 폼의 "상태"는 어디에 있는가? DOM 프로퍼티에 흩어져 있는 상태(각 input의 value, checked)를 진실로 삼으면, 상태를 읽으려면 매번 DOM을 긁어야 하고, 상태 변경이 곧 DOM 변경이라 추적이 어렵다. 과제 A(Todo 앱)의 요구사항인 **상태와 DOM의 분리** — JS 상태 객체를 단일 출처(single source of truth)로 두고, 렌더 함수가 상태를 DOM에 반영하며, 이벤트는 DOM이 아니라 상태를 갱신하는 구조 — 가 이 문제에 대한 응답이다. React의 제어 컴포넌트(Phase 5-3)는 이 구조를 프레임워크 규약으로 만든 것이므로, 맨손으로 먼저 겪어 보는 것이 과제 A의 목적이다.

### 이벤트 전파 3단계와 리스너 옵션

DOM 이벤트 디스패치(DOM Standard §2.9)는 대상 요소에서 시작하지 않는다. 전파 경로는 3단계다:

1. **캡처(capture) 단계** — window에서 대상의 부모까지, 트리를 **내려가며** 캡처 리스너를 실행
2. **타깃(target) 단계** — 대상 요소의 리스너 실행
3. **버블(bubble) 단계** — 대상의 부모에서 window까지, 트리를 **올라가며** 일반 리스너를 실행

`addEventListener(type, fn, options)`의 옵션이 이 모델의 제어판이다.

- `capture: true` — 리스너를 1단계에 배치한다. 자식보다 먼저 가로채야 할 때(로깅, 접근 차단) 쓴다.
- `once: true` — 1회 실행 후 자동 제거. "removeEventListener를 위해 참조를 보관"하는 상용구를 없앤다.
- `passive: true` — "이 리스너는 preventDefault를 호출하지 않겠다"는 **선언**이다. 왜 이것이 성능 옵션인가: 스크롤은 별도 스레드(컴포지터)가 처리할 수 있지만, touchstart/wheel 리스너가 있으면 컴포지터는 "리스너가 preventDefault로 스크롤을 막을지도 모르므로" **메인 스레드의 리스너 실행이 끝날 때까지 스크롤을 보류**해야 한다. 메인 스레드가 바쁘면([3-5](./05-event-loop.md)의 long task) 스크롤이 손가락을 못 따라온다. passive 선언은 이 대기를 없앤다 — 리스너 실행과 무관하게 스크롤이 즉시 진행된다. 이 이유로 최신 브라우저는 문서/윈도우 레벨 touchstart·wheel 리스너를 기본 passive로 취급한다.
- `signal` — [3-6](./06-promises-and-async.md)의 AbortSignal로 리스너를 해제한다. 화면 단위 정리의 표준 패턴:

```js
// SPA 화면 하나가 등록하는 모든 리스너를 signal 하나로 관리
const screen = new AbortController();
list.addEventListener("click", onItemClick, { signal: screen.signal });
window.addEventListener("resize", onResize, { signal: screen.signal });
// 화면 전환 시
screen.abort(); // 전부 일괄 해제 — 3-10의 리스너 누수 패턴에 대한 구조적 방어
```

혼동하기 쉬운 두 메서드는 **관할이 다르다**. `stopPropagation()`은 전파(위 3단계 진행)를 멈추는 것이고, `preventDefault()`는 이벤트의 기본 동작(링크 이동, 폼 제출, 스크롤)을 취소하는 것이다 — 서로 완전히 독립이며, 폼 제출을 막으면서 전파는 허용하는 조합도, 그 반대도 가능하다. `cancelable: false`인 이벤트(passive 리스너의 이벤트 포함)에서 preventDefault는 무시된다.

### 이벤트 위임 — 라우터 패턴의 DOM 버전

동적 목록의 리스너 문제를 보자. 항목이 추가·삭제되는 Todo 목록에서 각 항목에 리스너를 붙이면, 항목 생성마다 등록·항목 제거마다 해제를 챙겨야 하고 항목 수만큼 리스너가 쌓인다. **위임**은 버블링을 이용해 이 문제를 구조적으로 없앤다: 컨테이너 하나에만 리스너를 두고, 이벤트가 올라오면 `event.target`에서 어느 항목인지 판별한다.

```html
<ul id="todos">
  <li data-id="1">우유 사기 <button data-action="delete">×</button></li>
  <li data-id="2">문서 쓰기 <button data-action="delete">×</button></li>
</ul>
<script>
  todos.addEventListener("click", (e) => {
    // closest: target에서 위로 올라가며 조건에 맞는 첫 요소 — 위임의 표준 짝
    const button = e.target.closest("[data-action='delete']");
    if (!button || !todos.contains(button)) return; // 관할 밖 클릭은 무시
    const item = button.closest("li");
    removeTodo(item.dataset.id); // DOM이 아니라 상태를 갱신한다 (과제 A 구조)
  });
</script>
```

동적 요소에 리스너가 "붙어 있는 것처럼" 보이는 원리가 여기 있다 — 리스너는 항목이 아니라 컨테이너에 있으므로, **나중에 추가된 항목도 즉시 동작한다**. 등록·해제 관리가 사라지고, 리스너 수는 항목 수와 무관하게 1이다. `e.target`(실제 클릭된 가장 깊은 요소)과 `e.currentTarget`(리스너가 붙은 요소 = 컨테이너)의 구분, 그리고 `closest`를 통한 판별이 패턴의 전부다.

**성립 조건은 버블링이다.** 그래서 버블링하지 않는 이벤트에서는 위임이 그대로는 안 된다 — 대표적으로 `focus`/`blur`. 대안이 둘 있다: 버블링하도록 정의된 대응 이벤트 `focusin`/`focusout`을 쓰거나, 캡처 단계 리스너(`capture: true`)를 쓴다(캡처는 버블링 여부와 무관하게 경로를 지나므로). `mouseenter`/`mouseleave`(비버블)와 `mouseover`/`mouseout`(버블)도 같은 관계다. 또 하나의 경계: `stopPropagation`을 호출하는 중간 요소가 있으면 이벤트가 컨테이너에 도달하지 못해 위임이 침묵한다 — 위임 기반 코드베이스에서 stopPropagation을 금기시하는 이유다.

### CustomEvent — 프레임워크 없는 컴포넌트 통신

컴포넌트 경계를 세울 때의 문제는 "자식의 내부 사건을 부모가 어떻게 아는가"다. 자식이 부모의 함수를 직접 호출하면 결합이 생긴다(자식이 부모의 존재와 API를 알아야 한다). DOM 이벤트 시스템 자체가 이 문제의 표준 답이다 — 자식은 **자기 요소에서 커스텀 이벤트를 발행**하고, 관심 있는 조상이 구독한다. 발행자는 구독자를 모른다.

```js
// 자식 컴포넌트: 검색 박스 — 자신의 DOM 요소에서 발행
function createSearchBox(root) {
  const input = root.querySelector("input");
  input.addEventListener("input", () => {
    root.dispatchEvent(
      new CustomEvent("search-change", {
        detail: { query: input.value }, // 페이로드는 detail에
        bubbles: true,                  // 조상이 위임으로 받을 수 있게
      })
    );
  });
}

// 부모: 자식의 내부 구조를 모른 채 구독
page.addEventListener("search-change", (e) => {
  runSearch(e.detail.query);
});
```

`bubbles: true`를 줘야 조상에서 위임으로 받을 수 있다(기본값 false). 이 구조의 효용과 한계를 함께 본다: 발행-구독으로 결합은 끊기지만, 이벤트 이름이 문자열 계약이라 오타·중복을 컴파일러가 못 잡고, 데이터 흐름이 코드에서 추적되지 않으며(어디서 누가 구독하는지 검색해야 안다), 상태 동기화는 여전히 수동이다. React(Phase 5)는 같은 문제 — 컴포넌트 간 데이터 흐름 — 를 이벤트 대신 **props 단방향 전달 + 콜백**으로 푼다. 두 방식을 모두 겪어 봐야 프레임워크가 무엇을 대신해 주는지가 보인다 — 과제 A에서 CustomEvent 경계를 직접 세워 보는 이유다.

## 실무 관점

**"DOM이 느리다"를 계측 없이 말하지 않는다.** 이 문서의 비용 모델을 진단 순서로 바꾸면: ① Performance 패널에서 실제로 Layout/Recalculate Style이 병목인지 확인한다(대부분 아니다 — 진짜 병목은 long task인 JS 자신인 경우가 많다). ② Layout이 루프 안에 반복되면 읽기/쓰기 교차를 찾는다. ③ 대량 삽입이 느리면 fragment 배치를 적용한다. "혹시 느릴까 봐" DOM 접근을 캐싱하고 우회하는 코드는 근거 없는 복잡도다.

**위임 vs 개별 리스너의 선택 기준.**

| | 위임 | 개별 리스너 |
|---|------|------------|
| 항목 수가 많고 동적 | ✅ 등록·해제 관리 소멸 | 등록·해제 누락이 누수로 ([3-10](./10-memory-and-storage.md)) |
| 비버블 이벤트(focus/blur 등) | focusin/focusout 또는 capture로 우회 | 자연스럽다 |
| 중간에 stopPropagation하는 서드파티 | 침묵 — 원인 추적이 어렵다 | 영향 없음 |
| 항목별로 완전히 다른 동작 | 판별 분기가 비대해진다 | 각자 명확 |

정적이고 소수인 요소(모달의 닫기 버튼 하나)에 위임을 쓰는 것은 과설계다. 위임은 "동적 다수"의 도구다.

**인라인 핸들러 속성은 쓰지 않는다.** `<button onclick="del(7)">`은 전역 함수를 요구하고(모듈 스코프와 충돌 — [3-9](./09-modules.md)), 데이터가 마크업 문자열에 박혀 XSS 표면이 되며, CSP(Content Security Policy)가 차단하는 대상이다. `data-*` 속성 + 위임이 같은 일을 하는 표준 형태다.

## 더 깊이

**이벤트 디스패치와 태스크의 관계.** 사용자 입력 이벤트의 디스패치는 태스크로 큐잉되고, 하나의 디스패치 안에서 전파 경로의 모든 리스너가 **동기로 연달아** 실행된다 — 리스너 하나가 끝나야 다음 리스너가 돌지만, 그 사이에 마이크로태스크 체크포인트가 끼어든다는 것이 미묘한 지점이다(스택이 비는 순간마다 — [3-5](./05-event-loop.md)). 반면 `el.click()`이나 `dispatchEvent`로 코드가 직접 발화하면 **현재 스택 위에서 동기로** 전체 디스패치가 실행된다 — 재진입(리스너 안에서 다시 dispatchEvent)이 가능하다는 뜻이고, 이벤트 기반 코드의 재귀 폭주는 이 경로에서 나온다.

**바인딩 객체의 정체성은 보장된다.** 같은 C++ 노드에 대해 JS 래퍼는 하나만 존재한다 — `document.querySelector("#a") === document.querySelector("#a")`는 항상 true다. 래퍼가 매번 새로 만들어진다면 Map의 키로 노드를 쓰는 패턴(노드에 메타데이터 연결 — [3-10](./10-memory-and-storage.md)의 WeakMap 용례)이 불가능했을 것이다. 이 정체성 유지 자체가 래퍼를 GC에서 함부로 수거할 수 없는 이유이기도 하고, JS 래퍼 ↔ C++ 노드 ↔ 리스너 클로저로 이어지는 참조 사이클이 detached DOM 누수의 배경이 된다 — [3-10](./10-memory-and-storage.md)에서 스냅숏으로 관찰한다.

**Shadow DOM은 전파 경로를 다시 쓴다.** Web Components의 Shadow DOM 경계를 지나는 이벤트는 target이 **재지정(retarget)** 된다 — 그림자 내부 요소가 아니라 호스트 요소가 target으로 보인다. 캡슐화(내부 구조 은닉)를 이벤트 시스템까지 관철한 설계다. 이 문서의 위임 패턴이 서드파티 웹 컴포넌트 내부까지는 못 본다는 경계 조건으로만 기억해 두면 된다.

## 정리

- DOM 노드는 렌더러 내부 노드에 대한 바인딩이다. 경계 호출은 싸고, 조작의 무효화는 다음 렌더링 기회로 배칭되며, 진짜 비싼 것은 무효 상태에서 기하를 읽어 강제되는 동기 레이아웃이다 — 읽기와 쓰기를 분리하라.
- 대량 조작은 DocumentFragment로 조립 후 한 번에 연결한다. 텍스트는 textContent, 구조는 createElement — innerHTML은 파싱 비용과 XSS 표면을 함께 가진다.
- getElementsBy*는 live(문서를 따라 변하는 뷰), querySelectorAll은 static(스냅숏)이다. live 컬렉션을 순회하며 문서를 바꾸면 요소를 건너뛴다.
- 이벤트는 캡처→타깃→버블로 전파되고, 옵션(capture/once/passive/signal)이 배치·수명·스크롤 협상·일괄 해제를 제어한다. stopPropagation(전파)과 preventDefault(기본 동작)는 관할이 다르다.
- 위임은 버블링 위의 라우터 패턴이다 — 컨테이너 리스너 하나 + closest 판별로 동적 항목을 관리 없이 처리한다. CustomEvent(bubbles + detail)는 프레임워크 없이 컴포넌트 발행-구독 경계를 세우는 표준 수단이다.

## 확인 문제

**Q1.** 다음 코드는 목록의 모든 항목을 강조 표시하는데, 항목이 2,000개일 때 눈에 띄게 버벅인다. 느린 지점을 비용 모델의 3층으로 진단하고 수정하라.

```js
items.forEach((item, i) => {
  const el = list.children[i];
  el.style.height = `${el.scrollHeight}px`; // 접힌 항목 펼치기
  el.classList.add("highlight");
});
```

<details>
<summary>정답과 해설</summary>

1층(경계 호출 — children[i], classList.add)은 2,000회여도 병목이 아니다. 문제는 3층: `el.scrollHeight` **읽기**와 `style.height`·classList **쓰기**가 반복마다 교차한다. i번째의 쓰기가 레이아웃을 무효화하고, i+1번째의 scrollHeight 읽기가 그 재계산을 동기로 강제한다 — 강제 동기 레이아웃 2,000회다. Performance 패널에서 루프 태스크 안에 보라색 Layout 블록이 반복되는 것으로 확인한다.

수정: 읽기 일괄 → 쓰기 일괄로 분리한다.

```js
const heights = items.map((_, i) => list.children[i].scrollHeight); // 읽기 전부
items.forEach((_, i) => {
  const el = list.children[i];
  el.style.height = `${heights[i]}px`; // 쓰기 전부
  el.classList.add("highlight");
});
```

레이아웃 재계산은 최대 1회(첫 읽기 시)로 줄어든다.
</details>

**Q2.** Todo 목록에 위임을 적용했더니, 서드파티 위젯이 들어 있는 항목에서만 삭제 버튼이 동작하지 않는다. 원인 후보를 두 가지 제시하고 각각의 확인·대응 방법을 답하라.

<details>
<summary>정답과 해설</summary>

후보 ①: **위젯 내부의 stopPropagation.** 위젯이 자신의 클릭 처리에서 전파를 끊으면 이벤트가 컨테이너까지 올라오지 못한다. 확인: DevTools 콘솔에서 `monitorEvents(todos, "click")`을 걸거나 캡처 단계 리스너(`{capture: true}`)를 임시로 붙여 — 캡처는 내려가는 경로라 stopPropagation(버블 단계)보다 먼저 지나간다 — 이벤트가 대상까지는 가는지 본다. 대응: 컨테이너 리스너를 캡처 단계로 옮기면 위젯이 버블을 끊어도 가로챌 수 있다(단, 위젯보다 먼저 실행되므로 상호작용 순서를 검토한다).

후보 ②: **Shadow DOM 재지정.** 위젯이 Shadow DOM을 쓰면 그림자 내부에서 발생한 클릭의 target이 호스트 요소로 재지정되어, `e.target.closest("[data-action='delete']")`가 그림자 내부의 버튼을 찾지 못한다. 확인: 리스너에서 `e.target`을 로그해 실제 버튼 대신 위젯 호스트가 찍히는지, `e.composedPath()`에 내부 경로가 있는지 본다. 대응: 삭제 버튼을 그림자 밖(라이트 DOM)에 두도록 구조를 바꾸거나, composedPath 기반 판별을 쓴다.
</details>

**Q3.** 스크롤 성능 개선을 위해 `document.addEventListener("wheel", handler, { passive: true })`로 바꿨더니, "Ctrl+휠로 페이지 줌을 막는" 기존 기능이 죽었다. 무슨 일이 일어난 것인지 passive의 계약으로 설명하고, 두 요구(부드러운 스크롤 + 줌 차단)를 함께 만족하는 설계를 제안하라.

<details>
<summary>정답과 해설</summary>

passive는 "이 리스너는 preventDefault를 호출하지 않는다"는 **계약 선언**이다. 계약 덕에 컴포지터는 메인 스레드를 기다리지 않고 스크롤을 진행하지만, 그 대가로 리스너 안의 `preventDefault()`는 무시된다(콘솔에 "Unable to preventDefault inside passive event listener" 경고). Ctrl+휠 줌 차단은 preventDefault로 구현되어 있었으므로 침묵 실패한 것이다.

설계: 두 요구는 같은 리스너에서 만족할 수 없으므로 분리한다 — 일반 스크롤 경로는 passive 리스너(또는 리스너 제거)로 컴포지터에 맡기고, 줌 차단은 `{ passive: false }`인 별도 리스너에서 `if (e.ctrlKey) e.preventDefault()`만 수행하고 즉시 반환한다. non-passive 리스너가 존재하는 한 컴포지터의 대기는 생기지만, 리스너 본문이 조건 검사 한 줄이면 대기 시간은 무시할 수준이다 — "preventDefault가 필요한 최소 범위만 non-passive로"가 일반 원칙이다. 효과는 Performance 패널에서 스크롤 중 프레임 트랙으로 전후 비교한다.
</details>

## 참고 자료

- [WHATWG DOM Standard — Events (§2)](https://dom.spec.whatwg.org/#events) — 디스패치 알고리즘, 전파 3단계, 리스너 옵션의 원 정의.
- [WHATWG DOM Standard — Old-style collections (§4.2.10)](https://dom.spec.whatwg.org/#old-style-collections) — HTMLCollection의 live 의미론이 명시된 위치.
- [MDN — Event delegation (Learn: Events)](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling) — 버블링과 위임 패턴의 실습형 정리.
- [Chrome for Developers — Passive event listeners](https://developer.chrome.com/docs/lighthouse/best-practices/uses-passive-event-listeners) — passive가 스크롤 지연을 없애는 구조의 공식 설명.
- [web.dev — Avoid large, complex layouts and layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing) — 강제 동기 레이아웃의 관찰·회피. Phase 7-1의 예고편.
