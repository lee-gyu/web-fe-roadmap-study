# 8-1. 브라우저 렌더링

> 한 줄 요약: 이 문서를 읽고 나면 DOM·CSS 변경이 스타일 계산, 레이아웃, 페인트, 합성 중 어디를 다시 실행하는지 예측하고, DevTools trace로 렌더링 병목을 확인할 수 있다.

이 문서는 Chromium 계열 브라우저의 DevTools 관찰 모델과 web.dev의 렌더링 성능 문서를 기준으로 한다. 렌더링 파이프라인의 큰 구조는 여러 브라우저에 공통으로 적용되지만, 레이어 승격 휴리스틱과 DevTools 표시 방식은 Blink, WebKit, Gecko 구현마다 달라질 수 있다. 표준이 보장하는 CSSOM View API와 브라우저 구현의 최적화 세부를 구분해서 읽어야 한다.

## 학습 목표

- DOM·CSS 변경이 스타일 계산(style calculation), 레이아웃(layout), 페인트(paint), 합성(composite) 중 어느 단계를 다시 실행하는지 설명할 수 있다.
- 강제 동기 레이아웃(forced synchronous layout)이 발생하는 코드 패턴을 식별하고 layout thrashing을 피하는 방식으로 고칠 수 있다.
- transform/opacity 기반 애니메이션과 width/height/top/left 기반 애니메이션의 비용 차이를 렌더링 파이프라인 관점에서 설명할 수 있다.
- `will-change`와 레이어 승격이 언제 이득이고 언제 메모리·래스터 비용으로 되돌아오는지 판단할 수 있다.
- Chrome DevTools Performance, Rendering, Layers 관련 도구로 렌더링 병목을 관찰할 수 있다.

## 배경: 왜 이것이 존재하는가

Phase 1에서는 HTML이 DOM으로, CSS가 캐스케이드와 레이아웃 알고리즘으로 이어지는 모델을 세웠다. Phase 3에서는 JavaScript가 DOM을 바꿀 수 있고, DOM 조작은 비용을 가진다는 것을 다뤘다. Phase 5에서는 React 리렌더가 실제 DOM 반영과 분리된 계산이라는 점을 봤다.

Phase 8에서는 이 지식이 하나의 질문으로 모인다.

```text
이 변경은 다음 프레임을 만들기 위해 브라우저에 어떤 일을 다시 시키는가?
```

브라우저는 사용자가 스크롤하고 입력하고 애니메이션을 보는 동안 계속 프레임을 만든다. 60Hz 디스플레이에서는 한 프레임 간격이 약 16.6ms다. 실제로는 브라우저 내부 작업과 OS 스케줄링 비용도 있으므로 애플리케이션 코드가 쓸 수 있는 예산은 더 작다. 모바일 기기나 CPU가 느린 환경에서는 같은 코드가 더 쉽게 예산을 넘긴다.

백엔드 개발자가 느린 API를 볼 때 DB 쿼리, 캐시, 네트워크, 직렬화 중 어디가 병목인지 나누어 보듯, 프론트엔드 렌더링도 단계별로 나누어 봐야 한다. "DOM 조작이 느리다"는 말은 너무 넓다. 어떤 DOM 조작은 스타일만 다시 계산한다. 어떤 조작은 전체 레이아웃을 다시 계산한다. 어떤 조작은 페인트 없이 합성 단계에서 끝난다. 이 차이를 알아야 계측 결과를 보고 올바른 조치를 선택할 수 있다.

## 핵심 개념

### 픽셀 파이프라인은 변경을 화면으로 커밋하는 단계다

브라우저가 화면의 픽셀을 만들 때 거치는 대표적인 파이프라인은 다음과 같다.

```text
JavaScript
  → Style
  → Layout
  → Paint
  → Composite
```

항상 모든 단계가 실행되는 것은 아니다. 어떤 CSS 속성을 바꿨는지, DOM 구조가 어떻게 바뀌었는지, 브라우저가 어떤 최적화를 선택했는지에 따라 건너뛸 수 있는 단계가 달라진다.

| 변경 종류 | 필요한 대표 단계 | 예시 | 비용의 성격 |
|---|---|---|---|
| 레이아웃 속성 변경 | style → layout → paint → composite | `width`, `height`, `top`, `left`, `display`, 폰트 크기 | 주변 요소의 위치와 크기까지 다시 계산할 수 있다 |
| 페인트 속성 변경 | style → paint → composite | `color`, `background`, `box-shadow`, `border-radius` | 기하 정보는 유지되지만 픽셀을 다시 그린다 |
| 합성 가능한 변경 | style → composite | `transform`, `opacity` | 이미 그려진 레이어를 이동·합성할 수 있으면 가장 싸다 |

이 표는 판단의 출발점이지 절대 규칙이 아니다. 예를 들어 `transform`은 일반적으로 레이아웃을 바꾸지 않지만, 레이어가 어떻게 구성되는지와 요소 크기, 필터, 클리핑, 브라우저 휴리스틱에 따라 비용이 달라질 수 있다. 그래도 실무 판단에서는 "기하를 바꾸는가, 픽셀을 다시 그려야 하는가, 이미 그린 표면을 합성만 하면 되는가"라는 세 질문이 가장 유용하다.

### 스타일 계산은 어떤 규칙이 어떤 요소에 적용되는지 다시 판정한다

스타일 계산(style calculation 또는 style recalculation)은 CSS 규칙과 DOM 요소를 다시 매칭하고, 캐스케이드·상속·초기값을 거쳐 computed value를 만드는 단계다. Phase 1-3에서 본 캐스케이드가 런타임에서 다시 실행되는 지점이다.

```html
<!doctype html>
<meta charset="utf-8" />
<style>
  .item {
    padding: 8px;
    color: black;
  }

  .selected .item {
    color: crimson;
  }
</style>

<button id="toggle">toggle</button>
<ul id="list">
  <li class="item">A</li>
  <li class="item">B</li>
  <li class="item">C</li>
</ul>

<script>
  const list = document.querySelector("#list");
  document.querySelector("#toggle").addEventListener("click", () => {
    // 클래스 하나를 바꾸지만, 브라우저는 관련 selector가 어떤 요소에 영향을 주는지 다시 판정해야 한다.
    list.classList.toggle("selected");
  });
</script>
```

이 예제는 레이아웃을 바꾸지 않는다. `color`만 바뀌므로 레이아웃 단계는 건너뛰고 페인트와 합성이 필요할 가능성이 높다. 하지만 스타일 계산은 필요하다. selector가 복잡하고 DOM이 크며 변경이 자주 일어나면 스타일 계산 자체가 병목이 될 수 있다.

DevTools Performance 패널에서 긴 `Recalculate Style` 이벤트가 보이면 다음을 의심한다.

- 한 번의 상호작용에서 많은 요소의 class/style을 바꾸고 있는가?
- DOM 범위가 너무 넓은 상위 요소에 상태 class를 붙이고 있는가?
- 복잡한 selector가 대규모 DOM에서 자주 다시 평가되는가?
- CSS-in-JS나 런타임 스타일 주입이 렌더 경로에 얹혀 있는가?

CSS selector 성능을 대부분의 프로젝트에서 먼저 최적화할 필요는 없다. 하지만 trace에서 `Recalculate Style`이 실제로 길게 보인다면 selector stats나 변경 범위를 확인해야 한다.

### 레이아웃은 기하 정보를 계산한다

레이아웃(layout)은 각 박스의 위치와 크기를 계산한다. CSS는 한 요소의 크기가 부모, 형제, 자식, viewport, font metrics에 영향을 받는 모델이다. 그래서 어떤 요소 하나의 기하 변경이 주변 요소까지 전파될 수 있다.

다음 예제는 `width`를 바꿔 레이아웃을 매 프레임 다시 계산하게 만든다.

```html
<!doctype html>
<meta charset="utf-8" />
<style>
  #bar {
    width: 40px;
    height: 40px;
    background: royalblue;
  }
</style>

<button id="run">run</button>
<div id="bar"></div>

<script>
  const bar = document.querySelector("#bar");

  document.querySelector("#run").addEventListener("click", () => {
    let frame = 0;

    function tick() {
      frame += 1;
      // width는 다음 요소 배치에 영향을 줄 수 있으므로 layout을 다시 요구한다.
      bar.style.width = `${40 + frame * 4}px`;

      if (frame < 80) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  });
</script>
```

같은 시각 효과를 `transform`으로 바꾸면 레이아웃을 피할 수 있다.

```html
<!doctype html>
<meta charset="utf-8" />
<style>
  #bar {
    width: 40px;
    height: 40px;
    background: royalblue;
    transform-origin: left center;
  }
</style>

<button id="run">run</button>
<div id="bar"></div>

<script>
  const bar = document.querySelector("#bar");

  document.querySelector("#run").addEventListener("click", () => {
    let frame = 0;

    function tick() {
      frame += 1;
      // transform은 요소의 layout box를 바꾸지 않는다. 합성 단계에서 처리될 가능성이 높다.
      bar.style.transform = `scaleX(${1 + frame * 0.1})`;

      if (frame < 80) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  });
</script>
```

두 예제를 Performance 패널로 녹화하면 첫 번째는 Layout과 Paint가 반복적으로 보이고, 두 번째는 브라우저가 레이어를 적절히 구성한 경우 Composite 중심으로 끝날 수 있다. 이 차이가 "애니메이션에는 transform/opacity를 우선하라"는 규칙의 실제 근거다.

### 강제 동기 레이아웃은 읽기와 쓰기 순서에서 나온다

브라우저는 성능을 위해 스타일·레이아웃 계산을 지연하고 묶어서 처리하려 한다. 그런데 JavaScript가 레이아웃 정보가 필요한 값을 읽으면, 브라우저는 최신 값을 반환해야 한다. 이미 DOM/CSS를 쓴 뒤라면 미뤄 둔 계산을 즉시 끝내야 한다.

```html
<!doctype html>
<meta charset="utf-8" />
<style>
  .row {
    width: 100px;
    padding: 4px;
    margin: 2px;
    background: #e7eefc;
  }
</style>

<button id="bad">bad</button>
<button id="good">good</button>
<div id="root"></div>

<script>
  const root = document.querySelector("#root");

  for (let i = 0; i < 800; i += 1) {
    const row = document.createElement("div");
    row.className = "row";
    row.textContent = `row ${i}`;
    root.append(row);
  }

  const rows = [...document.querySelectorAll(".row")];

  document.querySelector("#bad").addEventListener("click", () => {
    console.time("bad");

    for (const row of rows) {
      row.style.width = "240px";
      // 쓰기 직후 읽기: 최신 layout width가 필요하므로 브라우저가 계산을 당겨서 수행한다.
      const width = row.offsetWidth;
      row.textContent = `width ${width}`;
    }

    console.timeEnd("bad");
  });

  document.querySelector("#good").addEventListener("click", () => {
    console.time("good");

    // 읽기를 먼저 모은다.
    const widths = rows.map((row) => row.offsetWidth);

    // 쓰기는 나중에 모은다.
    rows.forEach((row, index) => {
      row.style.width = "240px";
      row.textContent = `previous width ${widths[index]}`;
    });

    console.timeEnd("good");
  });
</script>
```

`offsetWidth`, `offsetHeight`, `clientWidth`, `scrollHeight`, `getBoundingClientRect()` 같은 값은 레이아웃 정보를 요구한다. DOM 쓰기 후 이런 값을 읽는 패턴은 강제 동기 레이아웃을 만든다. 루프 안에서 쓰기와 읽기를 반복하면 layout thrashing이 된다.

핵심은 "레이아웃 값을 읽지 말라"가 아니다. 읽기와 쓰기를 배치(batch)하라는 것이다.

```text
나쁜 순서: write → read → write → read → write → read
좋은 순서: read → read → read → write → write → write
```

React에서도 같은 원리가 적용된다. 렌더 중 DOM을 직접 읽을 수는 없지만, `useLayoutEffect`에서 DOM을 읽고 즉시 상태를 갱신하면 페인트 전 동기 작업이 길어질 수 있다. 측정이 필요한 경우에도 읽기 범위를 좁히고, 반복적인 쓰기와 분리해야 한다.

### 페인트는 픽셀을 다시 그리는 비용이다

페인트(paint)는 레이아웃 결과를 바탕으로 텍스트, 색, 이미지, 그림자, 테두리 같은 시각 요소를 그리는 단계다. 레이아웃이 필요 없는 속성도 페인트를 요구할 수 있다.

```html
<!doctype html>
<meta charset="utf-8" />
<style>
  #card {
    width: 240px;
    padding: 24px;
    margin: 24px;
    background: white;
    box-shadow: 0 12px 40px rgb(0 0 0 / 20%);
  }

  #card.active {
    box-shadow: 0 24px 80px rgb(0 0 0 / 35%);
  }
</style>

<button id="toggle">toggle shadow</button>
<article id="card">shadow paint cost</article>

<script>
  const card = document.querySelector("#card");
  document.querySelector("#toggle").addEventListener("click", () => {
    // 위치와 크기는 유지되지만 그림자를 다시 그려야 한다.
    card.classList.toggle("active");
  });
</script>
```

`box-shadow`, `filter`, 큰 배경 이미지, 복잡한 border 효과는 레이아웃보다 페인트에서 비싸질 수 있다. 특히 스크롤 중 고정 요소나 큰 그림자가 자주 다시 그려지면 jank가 생긴다. DevTools Rendering 탭의 paint flashing을 켜면 어떤 영역이 다시 그려지는지 볼 수 있다.

페인트 비용은 "보기에 화려한가"보다 "얼마나 넓은 영역을 얼마나 자주 다시 그리는가"에 더 가깝다. 작은 버튼의 색 변경은 대개 문제 되지 않는다. viewport 대부분을 덮는 반투명 fixed overlay, 큰 blur, 반복되는 box-shadow는 다른 문제다.

### 합성은 이미 그린 표면을 조합한다

합성(compositing)은 여러 레이어를 올바른 순서로 합쳐 최종 화면을 만드는 단계다. 어떤 요소가 별도 레이어에 있으면, 브라우저는 그 요소의 픽셀을 다시 그리지 않고 레이어를 이동하거나 투명도를 바꿔 화면을 갱신할 수 있다.

```html
<!doctype html>
<meta charset="utf-8" />
<style>
  #panel {
    width: 160px;
    height: 80px;
    background: seagreen;
    color: white;
    display: grid;
    place-items: center;
    transition: transform 200ms ease, opacity 200ms ease;
  }

  #panel.open {
    transform: translateX(120px);
    opacity: 0.7;
  }
</style>

<button id="toggle">toggle</button>
<div id="panel">panel</div>

<script>
  const panel = document.querySelector("#panel");
  document.querySelector("#toggle").addEventListener("click", () => {
    panel.classList.toggle("open");
  });
</script>
```

`transform`과 `opacity`는 레이아웃을 바꾸지 않는다. 브라우저가 요소를 적절한 레이어로 승격하면 페인트도 피할 수 있다. 이 때문에 스크롤·드래그·전환 애니메이션은 가능한 한 transform/opacity로 표현한다.

하지만 레이어는 공짜가 아니다.

- 레이어마다 메모리가 필요하다.
- 큰 레이어는 rasterization 비용이 크다.
- 레이어가 너무 많으면 합성 자체가 복잡해진다.
- 레이어 승격은 브라우저 휴리스틱에 의존하며, 모든 브라우저에서 같은 결과를 보장하지 않는다.

따라서 "합성만 하면 빠르다"는 절반만 맞다. 정확한 문장은 "반복 애니메이션에서는 레이아웃과 페인트를 피하고 합성으로 끝낼 수 있는 속성이 유리하지만, 레이어 수와 크기를 관리해야 한다"다.

### `will-change`는 최적화 요청이지 성능 보증이 아니다

`will-change`는 브라우저에 "이 속성이 곧 바뀔 가능성이 있다"고 알려 최적화를 미리 준비하게 하는 힌트다.

```css
.dragging {
  will-change: transform;
}
```

문제는 이 힌트를 상시 적용할 때 생긴다.

```css
/* 나쁜 예: 페이지의 많은 카드가 항상 별도 최적화 후보가 된다. */
.card {
  will-change: transform;
}
```

더 안전한 방식은 실제 변화 직전에 켜고, 끝난 뒤 끄는 것이다.

```html
<!doctype html>
<meta charset="utf-8" />
<style>
  #box {
    width: 80px;
    height: 80px;
    background: slateblue;
    transition: transform 180ms ease;
  }

  #box.move {
    transform: translateX(160px);
  }
</style>

<button id="move">move</button>
<div id="box"></div>

<script>
  const box = document.querySelector("#box");

  document.querySelector("#move").addEventListener("click", () => {
    // 변화 직전에만 힌트를 준다. 브라우저가 준비할 시간을 아주 조금 확보한다.
    box.style.willChange = "transform";
    requestAnimationFrame(() => {
      box.classList.toggle("move");
    });
  });

  box.addEventListener("transitionend", () => {
    // 레이어와 관련 최적화를 오래 붙잡지 않도록 되돌린다.
    box.style.willChange = "auto";
  });
</script>
```

`will-change`를 붙였다고 반드시 빨라지지 않는다. 이미 브라우저가 적절히 최적화하고 있을 수도 있고, 힌트가 오히려 메모리와 합성 비용을 늘릴 수도 있다. MDN도 `will-change`를 기존 성능 문제를 다루기 위한 마지막 수단에 가깝게 사용하라고 경고한다. 성능 문제가 trace로 확인되지 않았다면 먼저 코드와 레이아웃 구조를 고치는 편이 낫다.

## 실무 관점

### 렌더링 병목은 trace에서 단계 이름으로 찾는다

Chrome DevTools에서 기본 관찰 절차는 다음이다.

1. Performance 패널을 연다.
2. CPU throttling을 필요에 맞게 설정한다. 저사양 모바일 문제를 보고 싶다면 slowdown을 적용한다.
3. Record를 누르고 문제 상호작용을 수행한다.
4. Main track에서 긴 task를 찾는다.
5. task 안의 `Recalculate Style`, `Layout`, `Paint`, `Composite Layers`, JavaScript call stack을 확인한다.
6. 변경 후 같은 조건으로 다시 녹화해 비교한다.

증상과 의심 계층을 연결하면 다음과 같다.

| trace 증상 | 우선 의심 | 대표 조치 |
|---|---|---|
| 긴 `Recalculate Style` | 너무 넓은 class 변경, 복잡한 selector, 런타임 스타일 주입 | 변경 범위 축소, selector 단순화, 스타일 생성 위치 이동 |
| 반복 `Layout` | width/height/top/left 변경, DOM read/write 교차 | transform 사용, read/write batch, DOM 측정 횟수 축소 |
| 큰 `Paint` | 넓은 영역의 색·그림자·필터·배경 재그리기 | repaint 영역 축소, 효과 단순화, 레이어 전략 검토 |
| 합성 레이어 과다 | 과도한 `will-change`, 3D transform 남용 | 힌트 제거, 애니메이션 중에만 레이어 유지 |
| 긴 JavaScript task | 동기 계산, 큰 배열 처리, third-party script | 작업 분할, idle/background 처리, 코드 로딩 지연 |

성능 최적화는 "좋아 보이는 기법을 추가하는 일"이 아니다. trace에서 단계와 원인을 확인하고, 해당 단계의 일을 줄이는 것이다.

### 속성 선택은 원하는 시각 효과와 비용을 함께 본다

| 목표 | 선호 접근 | 피해야 할 접근 | 경계 조건 |
|---|---|---|---|
| 이동 애니메이션 | `transform: translate(...)` | `left`, `top`, `margin` 반복 변경 | 실제 문서 흐름이 바뀌어야 하면 transform만으로는 의미가 맞지 않는다 |
| 크기 변화처럼 보이는 효과 | `transform: scale(...)` | `width`, `height` 반복 변경 | 주변 요소가 밀려야 하는 accordion은 layout 변경이 필요하다 |
| fade in/out | `opacity` | `visibility`와 layout 변경 조합 | opacity 0 요소는 여전히 hit testing과 접근성 고려가 필요하다 |
| 목록 삽입/삭제 | 레이아웃 변경을 인정하고 범위 축소 | 전체 목록 강제 측정 | virtualization 또는 점진 렌더링이 필요할 수 있다 |
| 드래그 | transform + pointer event 최적화 | 매 move마다 레이아웃 읽기 | drop target 계산은 별도 전략으로 batch 처리한다 |

모든 것을 transform으로 바꾸는 것이 정답은 아니다. 레이아웃이 실제 의미인 UI가 있다. accordion이 열리며 아래 콘텐츠를 밀어야 한다면 layout은 필요한 비용이다. 이때 목표는 layout을 없애는 것이 아니라 영향을 받는 DOM 범위와 빈도를 줄이는 것이다.

### React 성능 문제와 브라우저 렌더링 문제를 구분한다

React Profiler에서 리렌더가 많다고 해서 반드시 브라우저 Layout이 많지는 않다. React 렌더는 JavaScript 계산이고, 실제 DOM 변경이 없으면 브라우저 파이프라인 비용은 제한적일 수 있다. 반대로 React 리렌더는 적어도, 하나의 DOM 변경이 큰 레이아웃·페인트를 만들 수 있다.

| 관찰 도구 | 보는 계층 | 질문 |
|---|---|---|
| React DevTools Profiler | 컴포넌트 렌더와 커밋 | 어떤 컴포넌트가 왜 렌더되었는가? |
| Chrome Performance | JS, style, layout, paint, composite | 브라우저가 프레임을 만들기 위해 무엇을 오래 했는가? |
| Rendering paint flashing | repaint 영역 | 어떤 화면 영역이 다시 그려지는가? |
| Layers | 합성 레이어 구성 | 레이어가 너무 많거나 큰가? |

Phase 5-5의 최적화는 React 렌더 전파를 줄이는 문제다. 이 문서의 최적화는 브라우저가 픽셀을 만드는 일을 줄이는 문제다. 실무에서는 둘을 함께 본다.

## 더 깊이

### 레이아웃 무효화는 부분 계산을 목표로 하지만 전파될 수 있다

브라우저는 모든 변경마다 전체 문서를 처음부터 레이아웃하지 않으려 한다. 변경된 요소와 영향을 받을 수 있는 조상을 dirty 상태로 표시하고, 필요한 부분만 다시 계산하려 한다. 하지만 CSS 레이아웃은 상호 의존적이다.

- 부모의 width가 바뀌면 자식의 line wrapping이 바뀔 수 있다.
- font가 바뀌면 텍스트 metrics가 바뀌고 박스 높이가 달라질 수 있다.
- grid/flex container의 한 item 크기가 다른 item 배치에 영향을 줄 수 있다.
- viewport 크기와 media/container query가 스타일과 레이아웃을 동시에 바꿀 수 있다.

이 때문에 "작은 요소 하나만 바꿨다"는 개발자 감각과 브라우저의 재계산 범위가 일치하지 않을 수 있다. CSS containment(`contain`)이나 content visibility 같은 기능은 브라우저에 영향 범위 경계를 더 명확히 알려 주는 도구지만, 레이아웃·접근성·스크롤 동작에 의미 변화가 생길 수 있으므로 별도 검토가 필요하다.

### compositor-only는 렌더링 의미를 바꾸지 않을 때 가장 강하다

compositor-only 애니메이션은 layout과 paint를 피하는 데 강하다. 하지만 이 접근은 시각적 표현만 움직인다. 문서 흐름의 실제 위치는 그대로다.

예를 들어 `transform: translateX(100px)`를 적용한 요소는 시각적으로 오른쪽에 보이지만, 원래 layout box는 이동하지 않는다. 주변 요소는 밀리지 않는다. `getBoundingClientRect()`는 transform이 반영된 렌더링 크기와 위치를 반환하지만, `offsetWidth`는 layout width를 반환한다. hit testing, focus ring, 스크롤 영역, 접근성 순서까지 함께 검토해야 한다.

즉 compositor-only는 "움직여 보이면 된다"는 UI에 적합하다. 문서 흐름 자체가 바뀌어야 하는 UI에서는 layout 비용을 받아들이고 영향을 통제해야 한다.

### frame budget은 평균보다 최악 구간이 중요하다

사용자는 평균 프레임 시간이 아니라 끊기는 순간을 느낀다. 100개의 프레임 중 95개가 빠르고 5개가 80ms를 넘으면 사용자는 jank를 본다. 이 점은 Phase 8-3의 Core Web Vitals와 연결된다. INP도 평균 입력 지연이 아니라 사용자가 겪은 긴 상호작용 지연을 더 중요하게 본다.

그래서 렌더링 성능 리포트에는 평균보다 다음 증거가 더 유용하다.

- 가장 긴 task의 원인
- 특정 상호작용에서 반복되는 Layout/Paint 횟수
- LCP 후보 리소스가 그려지기 전의 render-blocking 작업
- 입력 후 다음 paint까지 걸린 시간
- 저사양 CPU throttle에서 악화되는 단계

## 정리

- 브라우저 렌더링은 JavaScript, style, layout, paint, composite 단계로 나누어 볼 수 있으며, 변경 종류에 따라 필요한 단계가 달라진다.
- 기하를 바꾸는 속성은 layout을, 픽셀 표현을 바꾸는 속성은 paint를, transform/opacity 같은 속성은 조건이 맞으면 composite 중심 경로를 탄다.
- 강제 동기 레이아웃은 DOM/CSS 쓰기 후 레이아웃 값을 즉시 읽을 때 발생하며, read/write batch로 줄일 수 있다.
- `will-change`와 레이어 승격은 메모리와 합성 비용을 만들 수 있으므로 trace로 확인한 병목에 제한적으로 사용한다.
- React Profiler는 컴포넌트 렌더 계층을, Chrome Performance는 브라우저 픽셀 파이프라인 계층을 보여 주므로 둘을 구분해 해석해야 한다.

## 확인 문제

1. 다음 코드는 왜 스크롤 중 jank를 만들 가능성이 높은가? 어떤 순서로 바꾸는 것이 좋은가?

```js
for (const item of items) {
  item.style.height = "120px";
  const rect = item.getBoundingClientRect();
  item.style.transform = `translateX(${rect.width / 10}px)`;
}
```

<details>
<summary>정답과 해설</summary>

`height`를 쓰고 곧바로 `getBoundingClientRect()`를 읽는다. 브라우저는 최신 레이아웃 값을 반환해야 하므로 미뤄 둔 레이아웃 계산을 루프 안에서 반복적으로 수행할 수 있다. 먼저 필요한 rect를 모두 읽고, 그 다음 height와 transform 쓰기를 모으는 방식으로 바꾸는 것이 낫다. 단, height 변경 후의 width가 필요하다면 레이아웃 비용 자체는 필요하므로 측정 범위와 변경 범위를 줄여야 한다.

</details>

2. `left: 100px` 애니메이션을 `transform: translateX(100px)`로 바꾸면 항상 올바른가?

<details>
<summary>정답과 해설</summary>

항상 올바르지 않다. `transform`은 요소의 layout box를 바꾸지 않고 시각적 표현을 이동한다. 주변 요소가 밀려야 하거나 문서 흐름 자체가 바뀌어야 하는 UI에서는 의미가 달라진다. 단순 이동, 드래그, transition처럼 시각적 위치만 바뀌면 되는 경우에는 layout과 paint를 피할 가능성이 있어 유리하다.

</details>

3. 팀원이 모든 카드에 `.card { will-change: transform; }`을 추가했다. 어떤 근거로 검토해야 하는가?

<details>
<summary>정답과 해설</summary>

`will-change`는 최적화 보증이 아니라 힌트이며, 많은 요소에 상시 적용하면 메모리 사용과 레이어 관리 비용을 늘릴 수 있다. 먼저 Performance/Layers 도구로 실제 병목이 transform 애니메이션 준비 비용인지 확인해야 한다. 문제가 특정 상호작용에만 있다면 변화 직전에 `will-change`를 켜고 transition/animation이 끝난 뒤 제거하는 방식이 더 안전하다.

</details>

4. React Profiler에서 어떤 컴포넌트가 자주 렌더되지만 Chrome Performance trace에는 Layout/Paint가 거의 없다. 이것은 어떤 뜻인가?

<details>
<summary>정답과 해설</summary>

React 렌더라는 JavaScript 계산은 자주 일어나지만 실제 DOM 변경이나 브라우저 렌더링 파이프라인 비용은 크지 않을 수 있다는 뜻이다. 이 경우 브라우저 layout/paint 최적화보다 React 렌더 전파와 JavaScript 계산 비용을 먼저 봐야 한다. 반대로 DOM 변경 하나가 큰 Layout/Paint를 만들 수도 있으므로 두 도구의 계층을 구분해야 한다.

</details>

## 참고 자료

- [Rendering performance](https://web.dev/articles/rendering-performance) — JavaScript, style, layout, paint, composite로 이어지는 픽셀 파이프라인과 프레임 예산을 설명한다.
- [Chrome DevTools Performance features reference](https://developer.chrome.com/docs/devtools/performance/reference) — Performance 패널에서 CPU throttling, CSS selector stats, paint instrumentation 등 렌더링 병목을 관찰하는 기능을 확인할 수 있다.
- [CSS `will-change` property](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change) — `will-change`의 목적, 사용 시 주의점, 과도한 사용의 비용을 확인할 수 있다.
- [Determining the dimensions of elements](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Object_Model/Determining_the_dimensions_of_elements) — `offsetWidth`, `clientWidth`, `scrollWidth`, `getBoundingClientRect()`가 어떤 박스 정보를 반환하는지 비교한다.
- [CSS Containment Module](https://drafts.csswg.org/css-contain/) — containment가 브라우저의 스타일·레이아웃·페인트 영향 범위를 제한하는 표준 모델을 정의한다.
