# 1-6. CSS 심화

> 한 줄 요약: 커스텀 프로퍼티로 테마 체계를 설계하고, 성능을 해치지 않는 애니메이션을 판단하며, 캐스케이드 레이어와 중첩으로 규모가 커진 CSS를 구조화할 수 있다.

## 학습 목표

- 커스텀 프로퍼티가 전처리기 변수와 어떻게 다른지 설명하고, 테마 전환 패턴을 구현할 수 있다.
- `:hover`/`:focus-visible`/`:has()` 등 의사 클래스와 의사 요소를 상황에 맞게 활용할 수 있다.
- transform/opacity 애니메이션이 저렴한 이유를 렌더링 비용 관점에서 설명하고, 애니메이션 프로퍼티를 선택할 수 있다.
- 캐스케이드 레이어(`@layer`)로 명시도 경쟁을 구조적으로 해결할 수 있다.

## 배경: 왜 이것이 존재하는가

[1-3](./03-css-basics.md)~[1-5](./05-responsive-design.md)까지의 CSS는 "한 페이지를 올바르게 만드는" 도구였다. 이 문서의 주제는 두 가지 다른 종류의 문제다.

첫째는 **규모**다. CSS는 전역 네임스페이스 하나에 모든 규칙이 쌓이는 언어다. 파일이 수십 개, 작성자가 여러 명이 되면 명시도 충돌·중복·죽은 코드가 누적된다. 모듈 시스템과 스코프에 익숙한 개발자에게 이것은 언어 결함으로 보이고, 실제로 업계는 이를 명명 규칙(BEM), 전처리기(Sass), 빌드 도구(CSS Modules)로 우회해 왔다. 그런데 지난 몇 년 사이 CSS 자체가 그 우회로의 상당 부분을 흡수했다 — 변수(커스텀 프로퍼티), 중첩(nesting), 우선순위 격리(`@layer`)가 이제 네이티브다. 무엇이 언어로 들어왔고 무엇이 여전히 도구의 몫인지 아는 것이 현대 CSS 역량이다.

둘째는 **움직임과 비용**이다. 상태 변화를 애니메이션으로 표현하는 것은 UI 품질의 문제지만, 어떤 프로퍼티를 움직이느냐에 따라 브라우저가 치르는 비용이 수십 배 차이 난다. 이 판단 기준은 렌더링 파이프라인에서 나오며, 여기서 세운 원칙은 Phase 7-1에서 파이프라인 전체를 다룰 때 완성된다.

## 핵심 개념

### 커스텀 프로퍼티: 변수가 아니라 상속되는 값

문법은 단순하다. `--`로 선언하고 `var()`로 읽는다.

```css
:root {
  --color-primary: #2563eb;
  --spacing-unit: 8px;
}
.button {
  background: var(--color-primary);
  padding: var(--spacing-unit) calc(var(--spacing-unit) * 2);
}
```

Sass 변수를 써 본 사람이라면 "이미 있던 것"으로 보이지만, 결정적 차이가 있다. **전처리기 변수는 빌드 타임에 값으로 치환되어 사라지고, 커스텀 프로퍼티는 런타임에 살아 있다.** 이 차이에서 세 가지 능력이 나온다.

1. **캐스케이드와 상속을 탄다.** 커스텀 프로퍼티는 일반 프로퍼티처럼 선택자로 덮어쓸 수 있고 자손에게 상속된다. 즉 "이 서브트리 안에서만 다른 값"이 가능하다.
2. **미디어 쿼리·상태에 반응한다.** 빌드 타임 변수로는 불가능한, 조건에 따른 값 교체가 한 곳에서 끝난다.
3. **JavaScript와 통신한다.** `el.style.setProperty('--x', value)`로 쓰고 `getComputedStyle`로 읽는다. JS가 계산한 값(스크롤 위치, 마우스 좌표)을 CSS로 넘기는 표준 통로다.

이 능력의 대표 활용이 테마 전환이다:

```css
:root {
  --bg: #ffffff;
  --text: #1a1a1a;
}
/* 시스템 다크 모드 기본값 + 사용자가 명시 선택하면 data 속성이 우선 */
@media (prefers-color-scheme: dark) {
  :root { --bg: #111318; --text: #e8e8e8; }
}
:root[data-theme="dark"]  { --bg: #111318; --text: #e8e8e8; }
:root[data-theme="light"] { --bg: #ffffff; --text: #1a1a1a; }

body { background: var(--bg); color: var(--text); }
```

컴포넌트들은 `var(--bg)`만 참조하므로 테마 전환은 루트의 변수 재정의 하나로 끝난다. Sass 변수였다면 테마 수만큼 CSS를 중복 생성해야 했을 일이다. 설계 관행도 여기서 나온다 — 색·간격·글꼴 크기 같은 **디자인 토큰(design token)을 커스텀 프로퍼티로 한 곳에 선언**하고, 컴포넌트 CSS는 토큰만 참조한다.

`var()`의 두 번째 인자는 폴백이다: `var(--accent, #2563eb)`. 존재하지 않을 수 있는 값(외부에서 주입되는 테마 등)에 안전판을 둘 때 쓴다.

기본형 커스텀 프로퍼티의 한계도 알아 둔다: **타입이 없다.** 엔진 입장에서 `--x`의 값은 의미를 모르는 토큰 문자열일 뿐이어서, 두 값 사이를 보간할 수 없고 따라서 커스텀 프로퍼티 자체를 트랜지션할 수 없다. `@property`로 등록하면 문법(타입)·상속 여부·초기값이 생기고, 타입이 생기는 순간 보간(애니메이션)이 가능해진다:

```css
@property --progress {
  syntax: "<percentage>";   /* 이제 엔진이 "이 값은 퍼센트"임을 안다 */
  inherits: false;
  initial-value: 0%;
}
.gauge {
  background: conic-gradient(var(--color-primary) var(--progress), #e5e7eb 0);
  transition: --progress 0.4s ease-out;  /* 등록했으므로 보간 가능 */
}
```

그라디언트 각도·색상처럼 "프로퍼티 통째로는 보간이 안 되지만 그 안의 값 하나는 움직이고 싶은" 경우의 표준 해법이다. `@property`는 2024년에 모든 주요 브라우저가 지원하게 되어 Baseline에 진입했다(2026년 기준 Newly available — 구형 브라우저 비중이 남아 있다면 장식적 용도로 한정한다).

### 의사 클래스 실전: 상태와 관계

[1-3](./03-css-basics.md)에서 의사 클래스의 문법을 봤다. 실전에서 판단이 필요한 지점들:

**`:focus` vs `:focus-visible`.** 포커스 표시(outline)를 없애면 키보드 사용자가 길을 잃는다([1-7](./07-accessibility.md)의 핵심 주제). 그런데 마우스 클릭에도 outline이 번쩍이는 것이 싫어서 `outline: none`을 넣는 사고가 반복되어 왔다. `:focus-visible`이 그 딜레마의 해답이다 — 브라우저가 "키보드 등 포커스 표시가 필요한 입력"이라고 판단할 때만 매칭된다.

```css
/* ❌ 키보드 사용자의 포커스 표시까지 제거 */
button:focus { outline: none; }

/* ✅ 마우스 클릭엔 안 보이고, 키보드 탐색엔 보인다 */
button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
```

**`:has()` — 관계를 조건으로.** 오랫동안 CSS 선택자는 아래 방향(자손)으로만 흘렀다. `:has()`는 "무엇을 포함한/뒤따르는 요소"를 선택하게 해 준다. "부모 선택자"로 불리지만 실제로는 관계 조건 전반을 다룬다.

```css
/* 이미지가 든 카드만 레이아웃 변경 — 예전엔 JS로 클래스를 붙여야 했던 일 */
.card:has(img) { grid-template-rows: 160px auto; }

/* 검증 실패한 필수 입력을 가진 폼 그룹의 라벨을 붉게 */
.field:has(input:invalid:not(:focus)) label { color: #dc2626; }
```

`:has()`는 모든 주요 브라우저에서 지원되며 Baseline Widely available(2026년 기준)이다. 단, 강력한 만큼 매칭 비용이 상대적으로 비싼 선택자이므로 `*:has(...)`처럼 범위 없이 쓰는 것은 피한다.

**의사 요소 `::before`/`::after`.** DOM에 없는 장식용 상자를 CSS만으로 추가한다(`content` 필수). 아이콘·배지·구분선 같은 **순수 장식**이 용도다. 접근성 트리 관점에서 `content`의 텍스트는 읽히므로, 의미 있는 콘텐츠를 여기에 넣는 것은 안티패턴이다.

### 트랜지션과 애니메이션: 무엇을 움직일 것인가

두 도구의 역할 구분부터. **트랜지션**은 "프로퍼티 값이 바뀔 때 그 사이를 보간하라"는 선언이고(상태 A→B), **애니메이션**(`@keyframes`)은 트리거 없이 자체 타임라인을 갖는 시퀀스다(반복, 다단계).

```css
.button {
  transition: transform 0.15s ease-out, background-color 0.15s ease-out;
}
.button:hover { transform: translateY(-2px); }

@keyframes pulse {
  50% { opacity: 0.4; }
}
.loading-dot { animation: pulse 1.2s ease-in-out infinite; }
```

여기까지는 문법이다. 중요한 것은 **비용 모델**이다. 브라우저가 프레임을 그리는 작업은 크게 레이아웃(기하 계산) → 페인트(픽셀 채우기) → 합성(compositing, 이미 그려진 레이어를 GPU에서 조립) 단계로 나뉜다. 어떤 프로퍼티를 움직이느냐가 어느 단계부터 다시 해야 하는지를 결정한다:

- `width`, `height`, `top`, `margin` … — **레이아웃부터 전부 다시.** 주변 요소까지 연쇄 재계산된다. 가장 비싸다.
- `background-color`, `box-shadow` … — 레이아웃은 넘어가지만 **페인트부터 다시.**
- `transform`, `opacity` — **합성만 다시.** 이미 그려진 레이어의 위치·투명도만 GPU에서 바꾼다. 메인 스레드가 JS로 바빠도 부드럽게 돌아갈 수 있는 유일한 부류다.

그래서 애니메이션의 제1원칙: **가능한 한 transform과 opacity로만 움직인다.** 위치 이동은 `left`가 아니라 `translate`로, 크기 변화는 `width`가 아니라 `scale`로 표현한다.

```css
/* ❌ 매 프레임 레이아웃 재계산 — 주변 요소까지 흔들린다 */
.panel { left: -300px; transition: left 0.3s; }
.panel.open { left: 0; }

/* ✅ 합성 단계만 — 레이아웃은 한 번도 다시 계산되지 않는다 */
.panel { transform: translateX(-100%); transition: transform 0.3s; }
.panel.open { transform: translateX(0); }
```

이 원칙의 근거인 렌더링 파이프라인 전체(리플로우/리페인트, 레이어 승격의 비용)는 Phase 7-1에서 다룬다. 지금은 "transform/opacity = 저렴, 기하 프로퍼티 = 비쌈"이라는 판단 기준을 확립하는 것이 목표다. 검증하고 싶다면 DevTools Performance 패널로 애니메이션 중의 프레임을 녹화해 Layout/Paint 항목이 매 프레임 나타나는지 보면 된다.

접근성 규칙 하나가 이 주제에 붙는다. 전정 기관 장애가 있는 사용자에게 큰 움직임은 실제 어지럼을 유발하므로, OS의 "동작 줄이기" 설정을 존중한다:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 캐스케이드 레이어와 중첩: 규모의 도구

**`@layer`** 는 [1-3](./03-css-basics.md)에서 예고한 명시도 경쟁의 구조적 해법이다. 규칙들을 이름 붙은 레이어에 담고 레이어 간 우선순위를 **선언 한 줄로** 고정한다:

```css
/* 우선순위를 먼저 선언: 뒤에 올수록 강함 */
@layer reset, vendor, components, utilities;

@layer reset { * { box-sizing: border-box; } }
@layer vendor { /* 외부 라이브러리 CSS를 @import ... layer(vendor)로 격리 */ }
@layer components { .button { background: var(--color-primary); } }
@layer utilities { .hidden { display: none; } }
```

핵심 규칙: **레이어 간 비교에서는 명시도를 보지 않는다.** utilities 레이어의 `(0,1,0)` 선택자가 components 레이어의 `(1,2,3)` 선택자를 이긴다. "라이브러리 CSS가 명시도 높은 선택자를 써서 못 덮어쓰는" 고전 문제가, 라이브러리를 낮은 레이어에 담는 것으로 끝난다. 레이어 없는(unlayered) 스타일은 모든 레이어보다 우선한다는 점도 기억해 둔다. `@layer`는 Baseline Widely available이다.

**CSS 중첩(nesting)** 은 Sass의 대표 기능이 네이티브로 들어온 것이다:

```css
.card {
  padding: 16px;

  & .title { font-weight: 600; }
  &:hover { transform: translateY(-2px); }

  @media (min-width: 640px) { padding: 24px; }  /* 미디어 쿼리도 중첩 가능 */
}
```

미디어 쿼리를 컴포넌트 규칙 안에 함께 두는 것이 특히 유용하다 — 한 컴포넌트의 모든 상태가 한 블록에 모인다. 단, Sass 시절의 교훈은 그대로 유효하다. **중첩을 깊게 쓰면 결과 선택자의 명시도가 올라가고 구조에 결합된다.** 2단을 넘기지 않는 것이 통용되는 가이드다. 네이티브 중첩도 Baseline이다(2026년 기준 Widely available).

이 도구들 이전 시대의 대표 우회로가 **BEM**(Block__Element--Modifier) 명명 규칙이다 — 모든 선택자를 클래스 1개로 유지해 명시도를 평평하게 만들고, 이름에 구조를 인코딩하는 방식이다. 새 프로젝트에서 BEM을 도입할 필요는 줄었지만, 기존 코드베이스에서 여전히 만나게 되고 "명시도를 평평하게, 스코프를 이름으로"라는 문제의식 자체는 `@layer`·CSS Modules·Tailwind(Phase 5-9)로 이어지는 같은 계보다.

## 실무 관점

- **토큰과 컴포넌트의 2계층 변수 설계.** `--blue-500` 같은 원시 값과 `--color-primary` 같은 의미 값을 분리하고, 컴포넌트는 의미 값만 참조한다. 리브랜딩·다크 모드가 의미 계층의 재매핑만으로 끝난다.
- **커스텀 프로퍼티의 조용한 실패.** 오타로 존재하지 않는 변수를 참조하면 에러 없이 프로퍼티가 무시되거나 상속값으로 대체된다(잘못된 값이 되면 unset처럼 동작). "값이 안 먹는데 에러도 없다"면 DevTools Computed 탭에서 변수의 해석 결과를 확인한다.
- **애니메이션은 200ms 안팎의 절제가 기본.** UI 트랜지션은 100~300ms 범위가 통상적이다. 느린 애니메이션은 고급스러움이 아니라 반복 사용 시의 지연이다. `transition: all`은 의도치 않은 프로퍼티(layout 계열 포함)까지 보간하므로 움직일 프로퍼티를 명시한다.
- **`@layer` 도입은 프로젝트 초기가 적기다.** 기존 무질서한 코드베이스에 레이어를 소급 적용하는 것은 unlayered 스타일이 항상 이긴다는 규칙 때문에 까다롭다. 새 프로젝트라면 reset/vendor/components/utilities 골격을 첫날 잡는 것이 이후의 명시도 전쟁을 예방한다.
- **DevTools 팁**: Elements 패널에서 커스텀 프로퍼티 값 위에 마우스를 올리면 해석된 값이 보이고, Styles 패널은 규칙이 속한 레이어를 `@layer` 뱃지로 표시한다. 애니메이션 디버깅에는 Animations 패널(재생 속도 조절, 타임라인 스크럽)이 있다.

## 더 깊이

**"조용한 실패"의 정확한 메커니즘.** [1-3](./03-css-basics.md)에서 CSS 파서는 이해 못 하는 선언을 파스 타임에 버린다고 했다. 그런데 `var()`가 든 선언은 **파스 타임에 검증할 수 없다** — 변수의 값은 캐스케이드가 끝나야 알 수 있기 때문이다. 그래서 `var()` 치환은 계산값(computed value) 단계에 일어나고, 치환 결과가 프로퍼티에 무효하면 스펙은 이를 IACVT(invalid at computed-value time)라 부르며 특별하게 처리한다: 선언을 버리는 것이 아니라 **그 프로퍼티를 unset처럼**(상속되는 프로퍼티는 부모값, 아니면 초기값) 만든다. 함정은 여기다 — 파스 타임에 버려졌다면 캐스케이드의 차순위 선언(폴백으로 먼저 써 둔 값)이 살아남았겠지만, IACVT는 캐스케이드가 이미 끝난 뒤라 **차순위 선언도 구제하지 못한다.** `color: red; color: var(--typo);`에서 결과는 red가 아니라 상속된 색이 된다. 커스텀 프로퍼티의 오타가 일반 오타보다 더 멀리 전파되는 이유이고, 진단 위치가 DevTools Computed 탭인 이유다.

**상속되는 것은 토큰이 아니라 계산값이다.** 커스텀 프로퍼티도 [1-3](./03-css-basics.md)의 상속 규칙을 그대로 따른다 — 자손은 부모 시점에 계산이 끝난 값을 물려받는다. 그래서 `--size: 2em` 같은 상대 단위를 토큰째 물려받아 "쓰이는 곳 기준으로 재해석"되기를 기대하면 어긋난다(등록되지 않은 프로퍼티는 토큰째 상속되지만, `em`의 해석은 `var()`가 치환되는 지점의 font-size 기준이다). 토큰 체계를 설계할 때 상대 단위 변수의 해석 지점을 의식해야 하는 근거다.

**합성의 대가는 메모리다.** transform/opacity 애니메이션이 저렴한 것은 해당 서브트리가 별도 컴포지터 레이어로 승격되어 GPU에서 조립되기 때문인데, 레이어는 곧 GPU 메모리의 비트맵이다. 요소마다 `will-change: transform`을 뿌려 강제 승격하면 메모리와 레이어 관리 비용이 애니메이션 이득을 잠식한다 — `will-change`는 실제로 곧 움직일 요소에, 가능하면 움직이기 직전에만 부여하는 힌트다. 레이어 구성은 DevTools의 Layers 패널에서 직접 확인할 수 있고, 파이프라인 전체의 비용 모델은 Phase 7-1에서 완성한다.

## 정리

- 커스텀 프로퍼티는 빌드 타임에 사라지는 전처리기 변수와 달리 런타임에 살아 있어, 캐스케이드/미디어 쿼리/JS와 상호작용한다. 테마와 디자인 토큰의 표준 구현 수단이다.
- 포커스 스타일은 `:focus-visible`로, 관계 조건 선택은 `:has()`로 — 예전에 JS가 필요했던 상태 표현이 CSS로 내려왔다.
- 애니메이션 비용은 프로퍼티가 결정한다. transform/opacity는 합성만 다시 하므로 저렴하고, 기하 프로퍼티는 레이아웃부터 다시 하므로 비싸다. `prefers-reduced-motion`을 존중한다.
- `@layer`는 명시도가 아니라 레이어 순서로 우선순위를 정하는 구조적 도구다. 네이티브 중첩은 편리하되 2단 이내로 절제한다.
- BEM 등 명명 규칙은 이 도구들이 없던 시대의 우회로였고, 문제의식("명시도를 평평하게")은 현대 도구로 계승됐다.

## 확인 문제

**1.** 다크 모드를 Sass 변수(`$bg`, `$text`)로 구현하려던 동료가 벽에 부딪혔다. 커스텀 프로퍼티로는 되고 Sass 변수로는 안 되는 근본적 이유는?

<details>
<summary>정답과 해설</summary>

Sass 변수는 빌드 타임에 값으로 치환되어 결과 CSS에는 존재하지 않는다. 다크 모드는 런타임 조건(`prefers-color-scheme` 또는 사용자 토글)에 따라 값이 바뀌어야 하는데, 이미 치환이 끝난 CSS는 바뀔 수 없다 — Sass로 하려면 테마별 CSS를 통째로 두 벌 생성해 교체해야 한다. 커스텀 프로퍼티는 런타임에 캐스케이드로 해석되므로 `:root`의 변수 재정의 하나로 모든 참조 지점이 함께 바뀐다.
</details>

**2.** 사이드 패널 열림 애니메이션을 `width: 0 → 300px` 트랜지션으로 구현했더니 저사양 기기에서 뚝뚝 끊긴다. 왜 끊기는지 렌더링 단계로 설명하고, 대안을 제시하라.

<details>
<summary>정답과 해설</summary>

`width`는 기하 프로퍼티라서 매 프레임 레이아웃 재계산을 유발하고, 패널 옆의 콘텐츠까지 연쇄적으로 재배치·리페인트된다. 메인 스레드에서 매 프레임 이 작업이 16.7ms(60fps 기준) 안에 끝나지 못하면 프레임이 드롭된다. 대안: `transform: translateX(-100%) → translateX(0)`으로 화면 밖에서 밀어 넣는 방식으로 바꾸면 합성 단계만 다시 수행하므로 GPU에서 부드럽게 처리된다. 옆 콘텐츠가 함께 밀려야 하는 요구라면 그 비용은 본질적이므로, 그때는 애니메이션 자체를 재검토한다.
</details>

**3.** `@layer components, utilities;` 선언 아래에서 `@layer components`의 `#app .btn.primary { color: blue }`와 `@layer utilities`의 `.text-red { color: red }`가 같은 요소에 매칭됐다. 최종 색과 이유는? 레이어가 없었다면?

<details>
<summary>정답과 해설</summary>

**red**다. 두 선언이 서로 다른 레이어에 속하므로 명시도 비교 없이 레이어 순서로 판정하고, 뒤에 선언된 utilities가 이긴다. 레이어가 없었다면 명시도 비교로 `#app .btn.primary (1,2,0)`가 `.text-red (0,1,0)`를 압도해 **blue**가 됐을 것이다 — 유틸리티 클래스가 컴포넌트 스타일을 덮으려면 명시도 전쟁(`!important` 등)이 필요했던 이 상황이 `@layer`가 해결하는 대표 사례다.
</details>

## 참고 자료

- [MDN — CSS 사용자 지정 속성(변수) 사용하기](https://developer.mozilla.org/ko/docs/Web/CSS/Using_CSS_custom_properties) — 커스텀 프로퍼티의 상속·폴백·JS 연동 정리.
- [MDN — @property](https://developer.mozilla.org/en-US/docs/Web/CSS/@property) — 등록 커스텀 프로퍼티의 syntax/inherits/initial-value와 보간 동작.
- [CSS Custom Properties Level 1 — invalid at computed-value time](https://www.w3.org/TR/css-variables-1/#invalid-variables) — IACVT 처리 규칙의 원 스펙.
- [MDN — :has()](https://developer.mozilla.org/ko/docs/Web/CSS/:has) / [:focus-visible](https://developer.mozilla.org/ko/docs/Web/CSS/:focus-visible) — 각 의사 클래스의 정확한 매칭 규칙과 브라우저 지원.
- [MDN — @layer](https://developer.mozilla.org/ko/docs/Web/CSS/@layer) — 레이어 순서 규칙, unlayered 스타일과의 관계.
- [MDN — CSS nesting](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_nesting) — 네이티브 중첩 문법과 Sass와의 차이점.
- [web.dev — Why are some animations slow?](https://web.dev/articles/animations-overview) — 렌더링 단계별 애니메이션 비용의 시각적 설명. Phase 7-1의 예습으로도 적합.
- [MDN — prefers-reduced-motion](https://developer.mozilla.org/ko/docs/Web/CSS/@media/prefers-reduced-motion) — 동작 줄이기 미디어 특성의 사용법과 접근성 근거.
