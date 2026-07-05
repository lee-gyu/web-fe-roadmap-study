# 1-4. CSS 레이아웃

> 한 줄 요약: 정규 흐름이라는 기본 배치 모델을 이해하고, Flexbox와 Grid 중 무엇으로 어떤 레이아웃을 짤지 판단하며, position과 z-index 문제를 쌓임 맥락으로 진단할 수 있다.

## 학습 목표

- 정규 흐름(normal flow)에서 블록/인라인 요소가 배치되는 규칙과 마진 겹침 현상을 설명할 수 있다.
- Flexbox의 축 모델과 `flex-grow/shrink/basis`의 공간 분배 방식을 설명할 수 있다.
- Grid로 2차원 레이아웃을 정의하고, Flexbox와 Grid의 선택 기준을 판단할 수 있다.
- `position` 각 값의 동작과 쌓임 맥락(stacking context)을 이해하고 z-index 문제를 진단할 수 있다.

## 배경: 왜 이것이 존재하는가

모바일 개발자는 ConstraintLayout이나 오토레이아웃 제약으로, 데스크톱 GUI 경험자는 절대 좌표나 레이아웃 매니저로 화면을 배치해 왔다. 웹의 출발점은 이들과 근본적으로 다르다. 웹은 **문서**에서 출발했고, 기본 배치 모델은 "글이 위에서 아래로, 좌에서 우로 흐른다"는 정규 흐름(normal flow)이다. 콘텐츠 양도, 화면 크기도, 글꼴도 미리 알 수 없다는 전제 위에서, 요소들은 좌표가 아니라 **흐름 속의 순서**로 배치된다.

역사적으로 이 문서용 모델 위에 애플리케이션 UI를 얹는 과정은 고통스러웠다. 잡지처럼 다단 배치를 하려고 `float`(원래 텍스트 옆에 이미지를 띄우는 기능)를 남용하고, `<table>`로 격자를 흉내 내던 시대가 있었다. Flexbox(1차원 배치, 2010년대 초)와 Grid(2차원 배치, 2017년~)는 이 우회로를 없애기 위해 **처음부터 레이아웃을 목적으로 설계된** 최초의 CSS 시스템이다. 오늘날 float 레이아웃을 새로 짤 이유는 없다.

그럼에도 정규 흐름을 먼저 배우는 이유는, Flexbox/Grid가 정규 흐름을 **대체**하는 것이 아니라 컨테이너 내부에서만 다른 배치 규칙을 켜는 것이기 때문이다. 페이지의 뼈대는 여전히 정규 흐름이고, 마진 겹침 같은 흐름의 규칙을 모르면 "Grid를 썼는데도 이상한" 문제를 진단할 수 없다.

## 핵심 개념

### 정규 흐름: display의 바깥쪽 의미

정규 흐름에서 요소의 배치는 `display` 값이 결정한다. 이 프로퍼티에는 두 가지 의미가 겹쳐 있다 — **바깥쪽**(자신이 흐름에서 어떻게 놓이는가)과 **안쪽**(자식을 어떻게 배치하는가). 현대 스펙은 이를 `display: block flex`처럼 두 값으로 명시할 수 있게 했고, 우리가 쓰는 한 단어 값들은 그 축약이다.

- `block` — 새 줄에서 시작하고 가용 너비를 채운다. `width`/`height`/상하 마진이 모두 동작한다. (`div`, `p`, `h1` 등의 기본값)
- `inline` — 텍스트처럼 줄 속에 흐른다. **`width`/`height`가 무시되고 상하 마진이 적용되지 않는다.** (`span`, `a` 등의 기본값) — 인라인 요소에 크기를 주려다 실패하는 것이 흐름 관련 첫 번째 고전 함정이다.
- `inline-block` — 줄 속에 흐르되 크기와 마진은 블록처럼 동작한다.
- `flex`, `grid` — 자신은 블록으로 놓이되, **자식들의 배치 규칙을 교체**한다.

### 마진 겹침: 흐름의 가장 큰 함정

정규 흐름의 블록들 사이에서 **세로 마진은 더해지지 않고 겹쳐진다**(margin collapsing). 큰 쪽 하나만 남는다.

```html
<style>
  .a { margin-bottom: 30px; }
  .b { margin-top: 20px; }
  /* 두 상자 사이 간격: 50px가 아니라 30px (큰 쪽 승) */
</style>
<div class="a">위</div>
<div class="b">아래</div>
```

이것은 버그가 아니라 문서 조판을 위한 설계다 — 문단마다 위아래 마진이 있어도 문단 사이가 두 배로 벌어지지 않게 하려는 것이다. 하지만 UI 작업에서는 함정이 된다. 특히 **부모와 첫/마지막 자식 사이의 겹침**이 당황스럽다:

```html
<style>
  .parent { background: #eee; }
  .child  { margin-top: 40px; }
  /* 자식의 마진이 부모 밖으로 새어나가 부모 전체가 40px 내려간다.
     부모 안쪽에 여백이 생기는 것이 아니다 */
</style>
<div class="parent">
  <div class="child">자식</div>
</div>
```

부모에 border, padding, 혹은 새로운 서식 컨텍스트가 있으면 겹침이 차단된다. 그리고 결정적으로 — **flex/grid 컨테이너의 자식 사이에서는 마진 겹침이 아예 일어나지 않는다.** 현대 레이아웃에서 겹침을 만날 일이 줄어든 이유다. 진단 시에는 DevTools에서 요소를 선택하면 마진 영역이 주황색으로 시각화되므로, 여백이 어느 상자 소속인지 눈으로 확인할 수 있다.

여백 설계의 실무 관행도 함께 알아 두자: 요소 간 간격은 개별 마진 대신 부모의 `gap`(flex/grid)으로 관리하면 겹침·방향 문제에서 해방된다.

### Flexbox: 1차원 공간 분배기

Flexbox의 멘탈 모델은 "**한 줄(주축)을 따라 아이템을 배치하고 남거나 모자란 공간을 규칙에 따라 분배한다**"이다.

```css
.toolbar {
  display: flex;
  flex-direction: row;        /* 주축 방향. row(기본)/column */
  justify-content: space-between; /* 주축 방향 정렬·분배 */
  align-items: center;        /* 교차축 방향 정렬 */
  gap: 8px;                   /* 아이템 간 간격 */
}
```

축이 핵심 개념이다. `justify-*`는 항상 **주축**, `align-*`은 항상 **교차축**을 다룬다. `flex-direction: column`으로 바꾸면 justify가 세로 정렬이 된다 — "justify=가로, align=세로"로 외우면 방향 전환 시 무너진다.

공간 분배는 아이템 쪽의 세 프로퍼티가 결정한다:

- `flex-basis` — 분배 전의 기준 크기 (기본 `auto` = 콘텐츠 크기)
- `flex-grow` — 남는 공간을 나눠 갖는 비율 (기본 0 = 안 커짐)
- `flex-shrink` — 모자란 공간을 부담하는 비율 (기본 **1 = 줄어듦**)

```css
.search-bar { display: flex; gap: 8px; }
.search-bar input  { flex: 1; }    /* grow:1 shrink:1 basis:0 — 남는 공간 독식 */
.search-bar button { flex: none; } /* 콘텐츠 크기 고정. 축소도 거부 */
```

`flex: 1`은 `flex: 1 1 0`의 축약으로, basis를 0으로 두고 전체 공간을 grow 비율로만 나눈다. 아이템 둘에 각각 `flex: 2`와 `flex: 1`을 주면 2:1로 나뉜다. 반대로 기본값의 함정도 있다 — **shrink 기본값이 1**이라 컨테이너가 좁아지면 아이템이 말없이 찌그러진다. 로고나 아이콘이 눌려 보인다면 `flex-shrink: 0`이 처방이다.

shrink에는 반대 방향의 함정도 있다. 아이템이 줄어들다 멈추는 바닥이 있는데, flex 아이템의 `min-width` 기본값이 `0`이 아니라 **`auto`(콘텐츠의 최소 크기)** 이기 때문이다. 아이템 안에 긴 단어나 `white-space: nowrap` 텍스트가 있으면 그 폭 이하로는 절대 줄지 않아 컨테이너를 뚫고 나간다. "flex 안에서 `text-overflow: ellipsis`가 안 먹는다"는 고전 문제의 정체가 이것이다 — 말줄임이 일어나려면 먼저 상자가 좁아져야 하는데 `min-width: auto`가 좁아짐 자체를 거부한다. 처방은 해당 아이템에 `min-width: 0`(또는 `overflow: hidden`)을 줘서 바닥을 제거하는 것이다.

```css
/* ❌ nowrap 텍스트가 min-width: auto 바닥이 되어 컨테이너를 뚫는다 */
.item { flex: 1; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }

/* ✅ 바닥을 제거해야 shrink → 말줄임이 작동한다 */
.item { flex: 1; min-width: 0; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
```

### Grid: 2차원 트랙 시스템

Flexbox가 "아이템들이 한 줄을 협상"한다면, Grid는 "**컨테이너가 먼저 행·열 격자를 선언하고 아이템을 그 칸에 배치**"한다. 제어의 주체가 다르다 — Flexbox는 콘텐츠 주도, Grid는 레이아웃 주도다.

```css
.layout {
  display: grid;
  grid-template-columns: 240px 1fr;   /* 고정 사이드바 + 나머지 전부 */
  grid-template-rows: auto 1fr auto;  /* 헤더 / 본문(남는 높이) / 푸터 */
  gap: 16px;
  min-height: 100dvh;
}
.layout > header { grid-column: 1 / -1; } /* 1번 선부터 마지막 선까지 = 전체 폭 */
.layout > footer { grid-column: 1 / -1; }
```

- `fr` 단위는 "남는 공간의 비율 분배"로, Flexbox의 grow에 해당하는 Grid의 어휘다.
- 아이템 배치는 셀 번호가 아니라 **그리드 라인 번호**(1부터, 끝에서부터는 -1)로 지정한다.
- 선언한 격자를 벗어나는 아이템은 암시적(implicit) 트랙이 자동 생성되어 수용된다. "행을 2개만 선언했는데 5개가 생기는" 현상은 오류가 아니라 이 동작이다.

Grid의 대표 관용구 하나는 외워 둘 가치가 있다 — 미디어 쿼리 없는 반응형 카드 그리드:

```css
.cards {
  display: grid;
  /* 250px 이상을 보장하면서 들어갈 수 있는 만큼 열을 만들고, 남는 폭은 늘려 채운다 */
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
}
```

### Flexbox vs Grid 선택 기준

| 관점 | Flexbox | Grid |
|------|---------|------|
| 차원 | 1차원 (한 줄, 줄바꿈은 독립적인 줄들) | 2차원 (행과 열이 정렬됨) |
| 제어 주체 | 콘텐츠가 크기를 주도 | 컨테이너가 격자를 주도 |
| 적합한 곳 | 툴바, 내비게이션, 버튼 그룹, 카드 내부 정렬 | 페이지 골격, 카드 그리드, 폼 레이아웃 |
| 판단 질문 | "아이템들을 한 방향으로 정렬·분배하는가?" | "행과 열이 서로 맞아야 하는가?" |

둘은 경쟁이 아니라 중첩 관계다. 전형적인 페이지는 **골격은 Grid, 각 구획 내부의 정렬은 Flexbox**로 짠다. `flex-wrap`으로 줄바꿈한 Flexbox는 줄끼리 열이 정렬되지 않는다는 것이 Grid와의 결정적 차이다 — 줄 간 열 맞춤이 필요해지는 순간이 Grid로 갈아탈 신호다.

### position: 흐름에서 꺼내기

`position`은 요소를 정규 흐름의 규칙에서 벗어나게 하는 장치다.

- `relative` — 흐름상 자리는 유지한 채 시각적으로만 이동. 실용적 용도는 대부분 **absolute 자식의 기준점** 역할이다.
- `absolute` — **흐름에서 완전히 제거**되고(자리를 차지하지 않음), 가장 가까운 `position`이 지정된(static이 아닌) 조상을 기준으로 배치된다. 기준 조상이 없으면 문서 전체 기준.
- `fixed` — 뷰포트 기준 고정. 스크롤해도 그 자리. 단 예외가 있다 — 조상에 `transform`, `filter`, `will-change` 등이 있으면 **그 조상이 기준(containing block)이 되어** 뷰포트 고정이 깨진다. "fixed 헤더가 어느 날 스크롤을 따라오지 않는다"면 조상에 새로 추가된 transform부터 의심한다.
- `sticky` — relative처럼 흐르다가, 스크롤이 지정 지점(`top: 0` 등)에 닿으면 fixed처럼 붙는다. 조상에 `overflow: hidden`이 있으면 동작하지 않는 것이 유명한 함정이다.

```css
.card { position: relative; }        /* 배지의 좌표계 원점 선언 */
.card .badge {
  position: absolute;
  top: 8px; right: 8px;              /* 카드의 우상단 기준 */
}
```

absolute는 "요소를 좌표로 놓는" 도구라서 타 플랫폼 출신에게 가장 익숙해 보이지만, 흐름에서 제거된 요소는 부모의 크기에 기여하지 않고 다른 콘텐츠와 상호작용하지 않는다. **레이아웃 골격을 absolute로 짜는 것은 안티패턴**이고, 배지·툴팁·닫기 버튼처럼 "다른 콘텐츠 위에 겹쳐 얹는 장식"이 올바른 용도다.

### 쌓임 맥락: z-index가 안 먹히는 이유

겹쳐진 요소의 위아래는 `z-index`로 정한다 — 여기까지는 알려진 대로다. 문제는 `z-index: 9999`를 줘도 다른 요소 밑에 깔리는 상황이다. 원인은 거의 항상 **쌓임 맥락(stacking context)** 이다.

쌓임 맥락은 z축 비교의 격리 단위다. `position` + `z-index` 조합, `opacity < 1`, `transform`, `filter` 등이 요소에 새 쌓임 맥락을 만든다. 규칙은 하나다: **z-index는 같은 쌓임 맥락 안에서만 비교된다.** 부모가 만든 맥락 안에 갇힌 자식은, 내부 z-index가 아무리 커도 **부모끼리의 순위**를 벗어날 수 없다.

```html
<style>
  .modal { position: relative; z-index: 1; }
  .modal .dialog { position: absolute; z-index: 99999; }
  .toast { position: relative; z-index: 2; }
  /* dialog의 99999는 .modal 맥락 내부 값일 뿐.
     바깥 세계에서 이 서브트리 전체의 순위는 1이므로 toast(2)가 항상 위에 온다 */
</style>
<div class="modal"><div class="dialog">모달</div></div>
<div class="toast">토스트</div>
```

디렉터리 경로에 비유하면 정확하다 — z-index는 파일명이고 쌓임 맥락은 디렉터리다. 다른 디렉터리의 파일끼리는 파일명이 아니라 디렉터리 순서로 비교된다. 진단은 z-index 값 키우기가 아니라 "어느 조상이 맥락을 만들었나"를 찾는 것이고, 크롬 DevTools의 Layers 패널이나 Elements > Computed의 z-index 추적으로 확인할 수 있다. 해법은 대개 구조 조정이며, 모달처럼 모든 것 위에 떠야 하는 요소를 body 직속으로 옮기는 패턴(React의 Portal이 하는 일, Phase 4)이 여기서 나온다.

## 실무 관점

- **첫 진단 질문은 "이 요소는 지금 어떤 배치 모델 안에 있나"다.** 정규 흐름인가, flex 아이템인가, grid 아이템인가, 흐름에서 빠진 상태인가. 같은 프로퍼티도 모델에 따라 다르게 동작한다(예: flex 아이템에는 `float`이 무시되고, `margin: auto`가 정렬 도구가 된다).
- **고정 높이를 선언하는 습관을 버린다.** 서버 사이드나 모바일 출신이 자주 만드는 버그가 `height: 400px` 류의 고정 높이 + 콘텐츠 넘침이다. 웹에서 높이는 원칙적으로 콘텐츠가 결정하게 두고, 필요하면 `min-height`로 하한만 잡는다.
- **`overflow`는 양날의 검이다.** 넘침을 자르는 용도로 넣은 `overflow: hidden`이 sticky를 죽이고, 그림자·툴팁을 자르고, 마진 겹침 동작을 바꾼다. 넣을 때는 부수효과를 인지하고 넣는다.
- **가운데 정렬 치트시트**: 컨테이너에 `display: flex; justify-content: center; align-items: center;` 혹은 `display: grid; place-items: center;`. "가로세로 중앙 정렬"이 어려웠던 시대는 끝났다 — 이 두 줄이 답이 아닌 상황이라면 대개 컨테이너 높이가 확보되지 않은 것이다.
- 브라우저 지원: Flexbox와 Grid 모두 오래전에 Baseline Widely available이다. `gap`의 Flexbox 지원(2021~)까지 포함해 호환성 걱정 없이 기본 도구로 쓴다.

## 더 깊이

마진 겹침을 차단하는 조건들의 공통 원리는 **블록 서식 컨텍스트(Block Formatting Context, BFC)** 다. BFC는 정규 흐름의 격리 단위로, 새 BFC 안의 마진은 바깥과 상호작용하지 않는다. `overflow: hidden`이 겹침을 막는 이유도, float를 감싸는 고전 기법(clearfix)이 동작한 이유도 BFC 생성이다. 현대 CSS는 이 용도로 부수효과 없는 전용 값 `display: flow-root`를 제공한다. BFC를 깊이 팔 일은 줄었지만, "격리 컨텍스트"라는 발상은 쌓임 맥락, 컨테이너 쿼리의 격리(containment)로 반복해서 나타나는 CSS의 핵심 설계 패턴이다.

position 요소의 좌표 기준을 스펙은 **containing block**이라는 하나의 개념으로 통일해 정의한다. `static`/`relative`의 containing block은 가장 가까운 블록 조상의 콘텐츠 박스, `absolute`는 가장 가까운 positioned 조상의 **패딩 박스**, `fixed`는 뷰포트다. 본문에서 본 transform 예외는 이 정의에 있다 — `transform`(과 `filter`, `will-change: transform` 등)은 해당 요소를 absolute와 fixed **모두의** containing block으로 만든다. 이는 transform이 서브트리를 독립된 렌더링 단위로 다루기 위한 제약으로, 쌓임 맥락 생성과 같은 뿌리에서 나온다. z-index 미스터리와 fixed 미스터리의 범인이 자주 같은(transform) 이유다.

## 정리

- 웹의 기본 배치는 정규 흐름이고, Flexbox/Grid는 컨테이너 내부의 배치 규칙만 교체한다. `display`에는 바깥쪽/안쪽 두 의미가 있다.
- 정규 흐름에서 세로 마진은 겹쳐지며 부모 밖으로 새어나갈 수 있다. flex/grid 내부에서는 겹침이 없고, 간격은 `gap`으로 관리하는 것이 현대적 관행이다.
- Flexbox는 주축/교차축 기반 1차원 공간 분배(`flex-grow/shrink/basis`), Grid는 트랙 선언 기반 2차원 배치(`fr`, `minmax`, 라인 번호). 골격은 Grid, 내부 정렬은 Flexbox로 중첩해 쓴다.
- `absolute`는 요소를 흐름에서 제거하고 가장 가까운 positioned 조상 기준으로 배치한다. 겹쳐 얹는 장식용이지 골격용이 아니다.
- z-index는 같은 쌓임 맥락 안에서만 비교된다. 9999가 안 먹히면 값이 아니라 맥락 구조를 진단한다.

## 확인 문제

**1.** `.sidebar`(회색 배경) 안의 첫 자식 `.widget`에 `margin-top: 24px`를 줬더니 위젯 위에 여백이 생기는 대신 사이드바 전체가 24px 아래로 밀렸다. 원인과 세 가지 이상의 해결책을 제시하라.

<details>
<summary>정답과 해설</summary>

부모-첫 자식 간 마진 겹침이다. 부모에 border/padding이 없으면 자식의 top 마진이 부모의 top 마진과 겹쳐 부모 바깥으로 새어나간다. 해결책: (1) 부모에 `padding-top`을 줘서 여백을 부모 소속으로 만든다(의도에 가장 부합). (2) 부모를 `display: flex; flex-direction: column`(또는 grid)으로 만들면 겹침 자체가 사라진다 — 이때 `gap`으로 간격을 옮기면 더 깔끔하다. (3) 부모에 `display: flow-root`로 새 BFC를 만든다. (4) 부모에 border를 준다(부수효과 있음).
</details>

**2.** `display: flex`인 헤더에서 로고 이미지가 화면이 좁아질 때 찌그러진다. 원인이 되는 **기본값**은 무엇이고 어떻게 고치는가?

<details>
<summary>정답과 해설</summary>

`flex-shrink`의 기본값이 1이라서, 컨테이너 공간이 부족하면 모든 아이템이 부족분을 나눠 부담하며 줄어든다. 로고에 `flex-shrink: 0`(또는 `flex: none`)을 주면 축소를 거부한다. 대신 다른 아이템(예: 검색창)이 축소를 전담하도록 설계한다.
</details>

**3.** 드롭다운 메뉴에 `z-index: 10000`을 줬는데도 아래쪽 배너(z-index: 10) 밑에 깔린다. 드롭다운의 조상 중 하나에 `transform: translateZ(0)`이 있다. 무슨 일이 일어난 것이고, 올바른 해결 방향은?

<details>
<summary>정답과 해설</summary>

`transform`은 z-index 없이도 새 쌓임 맥락을 만든다. 드롭다운은 그 조상이 만든 맥락에 갇혀 있고, 바깥 세계에서 이 서브트리의 순위는 그 조상의 순위(auto/0 수준)로 결정되므로 배너(10)에게 진다. 내부의 10000은 맥락 안에서만 유효하다. 해결: z-index를 더 키우는 것은 무의미하다. (1) 조상의 transform을 제거하거나, (2) 드롭다운을 그 맥락 밖(body 직속)으로 옮겨 렌더링한다 — 프레임워크에서 Portal 패턴을 쓰는 이유다.
</details>

**4.** flex 행의 한 아이템 안에서 파일명을 한 줄 말줄임(`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`)하려는데, 말줄임 대신 아이템이 컨테이너를 뚫고 나가 레이아웃 전체가 밀린다. `flex-shrink`는 기본값 그대로다. 왜 shrink가 동작하지 않는가?

<details>
<summary>정답과 해설</summary>

flex 아이템의 `min-width` 기본값은 `0`이 아니라 `auto` — 콘텐츠의 최소 크기다. `white-space: nowrap`인 텍스트의 최소 크기는 줄바꿈 없는 전체 폭이므로, shrink가 1이어도 그 폭 이하로는 줄어들 수 없다. 상자가 좁아지지 않으니 말줄임이 일어날 조건 자체가 성립하지 않는다. 해당 아이템에 `min-width: 0`을 줘 바닥을 제거하면 shrink가 정상 동작하고 말줄임이 나타난다.
</details>

## 참고 자료

- [MDN — 일반 대열(Normal Flow)](https://developer.mozilla.org/ko/docs/Learn/CSS/CSS_layout/Normal_Flow) — 정규 흐름과 서식 컨텍스트의 기초 정리.
- [MDN — Mastering margin collapsing](https://developer.mozilla.org/ko/docs/Web/CSS/CSS_box_model/Mastering_margin_collapsing) — 마진 겹침의 발생·차단 조건 전체 목록.
- [CSS Flexible Box Layout Module Level 1 (W3C)](https://www.w3.org/TR/css-flexbox-1/) — flex 공간 분배 알고리즘의 원 스펙.
- [MDN — CSS 그리드 레이아웃](https://developer.mozilla.org/ko/docs/Web/CSS/CSS_grid_layout) — 트랙, 라인, 암시적 그리드 등 Grid 전체 가이드.
- [MDN — Stacking context](https://developer.mozilla.org/ko/docs/Web/CSS/CSS_positioned_layout/Stacking_context) — 쌓임 맥락 생성 조건의 전체 목록. z-index 디버깅 시 대조표로 사용.
- [Flexbox Froggy](https://flexboxfroggy.com/#ko) / [Grid Garden](https://cssgridgarden.com/#ko) — 축·트랙 감각을 익히는 연습 게임. 30분 투자 가치가 있다.
