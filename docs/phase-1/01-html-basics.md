# 1-1. HTML 기초

> 한 줄 요약: 브라우저의 HTML 파싱 모델과 콘텐츠 모델을 이해하고, 폼을 포함한 문서를 스펙에 맞게 구조화할 수 있다.

## 학습 목표

- HTML 파서가 잘못된 마크업을 만났을 때 무슨 일이 일어나는지 설명할 수 있다.
- 콘텐츠 모델(content model)을 근거로 요소 중첩의 유효성을 판단할 수 있다.
- 폼 제출 시 브라우저가 만들어 보내는 데이터의 구조를 설명하고, 내장 검증을 활용할 수 있다.
- HTML 속성(attribute)과 DOM 프로퍼티(property)의 차이를 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

XML을 다뤄 본 개발자라면 잘 안다. 태그 하나만 닫지 않아도 파서는 문서 전체를 거부한다. HTML은 정반대다. 어떤 엉망인 마크업을 넣어도 브라우저는 **반드시 무언가를 렌더링한다**. 이것은 우연이 아니라 설계다. 웹 초기의 손으로 쓴 문서들이 대부분 문법적으로 불완전했고, "깨진 페이지를 보여주는 브라우저"는 시장에서 살아남지 못했기 때문이다.

그 결과 HTML5 스펙은 올바른 문법뿐 아니라 **잘못된 마크업을 복구하는 절차까지 표준화**했다. 모든 브라우저가 같은 오류를 같은 방식으로 복구한다는 뜻이다. 이 관용(forgiving) 덕분에 웹은 성장했지만, 개발자에게는 함정이 된다. 문법 오류가 에러로 드러나지 않고 **예상과 다른 DOM 구조**로 조용히 나타나기 때문이다. CSS가 이상하게 적용되거나 JavaScript 셀렉터가 빈 결과를 돌려줄 때, 원인이 마크업 단계에 있는 경우가 많다.

이 문서는 태그 백과사전이 아니다. 태그 각각의 용법은 MDN이 가장 정확하다. 여기서는 브라우저가 HTML을 해석하는 **모델**을 세운다. 웹의 전체 동작 흐름은 [Phase 0-1](../phase-0/01-how-the-web-works.md)을 전제한다.

## 핵심 개념

### 파서는 문서를 거부하지 않는다 — 대신 고쳐 쓴다

브라우저의 HTML 파서는 바이트 스트림을 토큰화하고, 토큰으로 DOM 트리를 만든다. 이때 스펙이 정한 오류 복구 규칙이 개입한다. 대표적인 예:

```html
<!-- 작성한 마크업 -->
<p>첫 문단
  <div>박스</div>
</p>

<!-- 브라우저가 실제로 만드는 DOM -->
<p>첫 문단</p>
<div>박스</div>
<p></p>
```

`<p>`는 흐름 콘텐츠 중 일부만 담을 수 있는데 `<div>`는 그 대상이 아니다. 파서는 `<div>` 시작 태그를 만나는 순간 열려 있던 `<p>`를 **강제로 닫는다**. 마지막의 `</p>`는 짝이 없으므로 빈 `<p>`가 하나 더 생긴다. 화면상으로는 비슷해 보여도, `p > div` 셀렉터는 영원히 아무것도 찾지 못하고, `p:first-child` 같은 구조 의존 스타일은 엉뚱하게 적용된다.

`<table>` 내부에 직접 쓴 텍스트가 테이블 **바깥으로** 끌어올려지는 것(foster parenting), `<li>`가 다음 `<li>`를 만나면 자동으로 닫히는 것도 같은 부류다. 핵심은 이것이다: **내가 쓴 마크업과 브라우저가 만든 DOM은 다를 수 있다.** 의심되면 DevTools의 Elements 패널에서 실제 DOM을 확인한다. Elements 패널이 보여주는 것은 소스 코드가 아니라 파싱 결과다.

### 문서의 뼈대

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>문서 제목</title>
</head>
<body>
  <!-- 보이는 콘텐츠 -->
</body>
</html>
```

각 줄에는 이유가 있다.

- `<!DOCTYPE html>` — 문서 타입 선언이 아니라 사실상 **렌더링 모드 스위치**다. 이것이 없으면 브라우저는 쿼크 모드(quirks mode)로 렌더링하는데, 1990년대 브라우저의 버그(박스 모델 계산 등)를 재현하는 호환 모드다. 반드시 첫 줄에 넣는다.
- `lang="ko"` — 스크린 리더의 발음 엔진 선택, 번역 제안, 폰트 선택에 쓰인다. [1-7 접근성](./07-accessibility.md)과 직결된다.
- `<meta charset="UTF-8">` — 인코딩 스니핑을 막는다. HTTP 헤더로도 지정할 수 있지만 파일 단독으로 열리는 경우를 위해 문서에도 넣는다.
- viewport 메타 태그 — 모바일 렌더링의 전제 조건. 이유는 [1-5 반응형 디자인](./05-responsive-design.md)에서 다룬다.

### 콘텐츠 모델: 중첩 규칙의 근거

"이 태그 안에 저 태그를 넣어도 되는가"는 감이 아니라 스펙의 **콘텐츠 카테고리(content categories)** 로 판단한다. HTML5는 요소를 메타데이터/플로우(flow)/섹셔닝(sectioning)/헤딩(heading)/프레이징(phrasing)/임베디드(embedded)/인터랙티브(interactive) 콘텐츠로 분류하고, 각 요소가 "무엇을 담을 수 있는지"를 카테고리로 정의한다.

실무에서 자주 걸리는 규칙 두 가지:

- **`<p>`와 인라인 계열 요소(`<span>`, `<a>` 등)는 프레이징 콘텐츠만 담는다.** `<p>` 안에 `<ul>`을 넣으면 위에서 본 강제 닫힘이 일어난다.
- **인터랙티브 콘텐츠는 인터랙티브 콘텐츠를 담을 수 없다.** `<button>` 안의 `<a>`, `<a>` 안의 `<button>`은 모두 불허다. 클릭이 어디로 전달돼야 하는지 모호해지기 때문이다. 접근성 트리에서도 역할이 충돌한다.

```html
<!-- ❌ 인터랙티브 중첩 — 클릭 대상이 모호하고, 파서/보조기술 동작이 갈린다 -->
<a href="/product/1">
  <button>장바구니 담기</button>
</a>

<!-- ✅ 이동이면 링크, 동작이면 버튼. 하나만 선택한다 -->
<a href="/product/1">상품 보기</a>
<button type="button">장바구니 담기</button>
```

`<a>`와 `<button>`의 선택 기준은 단순하다. **URL이 바뀌면 링크, 페이지 안에서 무언가를 실행하면 버튼**이다. 이 구분은 [1-2 시맨틱 HTML](./02-semantic-html.md)에서 다루는 "기계가 읽는 의미"의 출발점이기도 하다.

### 폼: 브라우저에 내장된 데이터 전송 계층

백엔드에서 `application/x-www-form-urlencoded`나 `multipart/form-data` 요청을 받아 봤다면, 그 데이터를 만들어 보내는 쪽이 바로 `<form>`이다. JavaScript가 한 줄도 없어도 폼은 완결된 전송 메커니즘이다.

```html
<form action="/signup" method="post">
  <label for="email">이메일</label>
  <input type="email" id="email" name="email" required>

  <label for="pw">비밀번호</label>
  <input type="password" id="pw" name="password" minlength="8" required>

  <button type="submit">가입</button>
</form>
```

동작 모델을 정리하면:

- 제출 시 브라우저는 `name` 속성이 있는 컨트롤만 모아 `name=value` 쌍을 만든다. **`name`이 없는 입력은 서버에 전송되지 않는다.** (`id`는 문서 내 참조용이지 전송과 무관하다 — 백엔드 출신이 가장 자주 혼동하는 지점.)
- `method="get"`이면 쿼리 스트링으로, `post`면 요청 본문으로 인코딩된다. 파일 업로드는 `enctype="multipart/form-data"`가 필요하다.
- `<form>` 내부의 `<button>`은 **기본 타입이 `submit`**이다. 폼 안에 놓인 "취소" 버튼이 폼을 제출해 버리는 사고는 `type="button"`을 빠뜨려서 생긴다.
- 제출 전에 브라우저가 내장 검증을 수행한다. `required`, `type="email"`, `minlength`, `pattern` 등이 실패하면 제출이 중단되고 브라우저 기본 UI로 오류가 표시된다. 검증 상태는 CSS `:valid`/`:invalid` 의사 클래스로도 노출된다.

input의 `type`은 검증 규칙뿐 아니라 **모바일 가상 키보드 종류**(숫자 패드, 이메일 자판)와 보조기술의 안내 방식까지 결정한다. `type="text"` 하나로 모든 것을 만들고 JS로 검증을 재구현하는 것은, 이미 있는 계층을 버리고 다시 짓는 일이다. SPA에서는 fetch로 제출을 대체하더라도(Phase 2에서 다룬다) 마크업 계층의 검증·시맨틱은 그대로 유지하는 것이 기본기다.

`<label>`은 장식이 아니다. `for`↔`id` 연결(또는 중첩)로 컨트롤과 결합되면 라벨 클릭이 입력으로 포커스를 옮기고, 스크린 리더가 입력의 이름을 읽을 수 있게 된다.

### 속성과 프로퍼티는 다른 것이다

HTML의 속성(attribute)은 마크업에 적힌 **문자열**이고, DOM 프로퍼티(property)는 파싱 결과로 만들어진 객체의 **필드**다. 초기값은 속성에서 오지만, 이후 둘은 따로 논다.

```html
<input id="agree" type="checkbox" checked>
<script>
  const el = document.getElementById('agree');
  el.checked = false; // 사용자가 체크를 해제한 것과 같은 상태 변경

  // 프로퍼티는 현재 상태, 속성은 마크업에 적힌 초기값
  console.log(el.checked);              // 출력: false
  console.log(el.getAttribute('checked')); // 출력: "" (속성은 여전히 존재)
</script>
```

`value`도 같다. `getAttribute('value')`는 초기값을, `el.value`는 사용자가 타이핑한 현재값을 돌려준다. 지금은 "속성 = 초기 설정, 프로퍼티 = 살아있는 상태"라는 구분만 세워 두면 된다. DOM 조작은 Phase 2-7에서 본격적으로 다루고, React의 제어 컴포넌트(Phase 4-3)에서 이 구분이 다시 핵심이 된다.

## 실무 관점

- **"돌아가니까 맞다"는 성립하지 않는다.** 파서가 복구해 준 마크업은 브라우저 간에는 동일해도, CSS 구조 셀렉터·접근성 트리·SEO 파싱에서 다르게 취급될 수 있다. [W3C validator](https://validator.w3.org/nu/)를 CI 수준까지는 아니어도 습관적으로 돌려볼 가치가 있다.
- **div 기본값 습관.** 경력자가 프론트엔드에 처음 오면 레이아웃 전부를 `<div>`로 짜는 경향이 있다. 동작은 하지만 다음 문서(시맨틱)에서 다루듯 기계 소비자에게는 의미가 전혀 전달되지 않는 문서가 된다.
- **폼을 JS 이벤트 수집기로만 쓰는 안티패턴.** `<form>` 없이 `<div>` + `<input>` + 클릭 핸들러로 만든 "폼"은 Enter 키 제출, 내장 검증, 비밀번호 관리자 연동, 접근성이 전부 사라진다. fetch로 보내더라도 `<form>`의 `submit` 이벤트를 가로채는 방식이 표준이다.
- **DevTools로 검증하는 습관.** Elements 패널에서 실제 DOM 구조를 열어 내가 쓴 마크업과 비교한다. 특히 테이블·리스트·중첩 폼 근처에서 마크업과 DOM이 어긋나 있는지 확인하는 것이 레이아웃 디버깅의 첫 단계다.

## 정리

- HTML 파서는 오류를 거부하지 않고 표준화된 규칙으로 복구한다. 따라서 **작성한 마크업과 생성된 DOM은 다를 수 있고**, 디버깅은 DOM을 기준으로 한다.
- `<!DOCTYPE html>`은 쿼크 모드를 끄는 렌더링 스위치다.
- 요소 중첩의 유효성은 콘텐츠 카테고리로 판단한다. 특히 `<p>`의 내용 제한과 인터랙티브 요소 중첩 금지가 실무에서 자주 걸린다.
- `<form>`은 name 기반 데이터 수집, 인코딩, 내장 검증까지 갖춘 전송 계층이다. `name` 없는 입력은 전송되지 않고, 폼 안 `<button>`의 기본 타입은 `submit`이다.
- 속성은 마크업의 초기값, 프로퍼티는 DOM 객체의 현재 상태다.

## 확인 문제

**1.** 다음 마크업에서 CSS 규칙 `ul li { color: red; }`는 동작하지만 `p ul { margin: 0; }`은 아무 효과가 없다. 이유를 설명하라.

```html
<p>목록:
  <ul><li>항목</li></ul>
</p>
```

<details>
<summary>정답과 해설</summary>

`<p>`는 프레이징 콘텐츠만 담을 수 있으므로, 파서는 `<ul>` 시작 태그를 만나는 순간 `<p>`를 강제로 닫는다. 생성된 DOM에서 `<ul>`은 `<p>`의 자식이 아니라 **형제**다. 따라서 자손 셀렉터 `p ul`은 아무것도 매칭하지 않는다. `ul li`는 부모-자식 관계가 유지되므로 정상 동작한다.
</details>

**2.** 로그인 폼에서 이메일을 입력하고 제출했는데 서버 로그에 비밀번호만 찍힌다. 마크업에서 가장 먼저 의심할 것은?

```html
<form action="/login" method="post">
  <input type="email" id="email" required>
  <input type="password" name="password" required>
  <button>로그인</button>
</form>
```

<details>
<summary>정답과 해설</summary>

이메일 입력에 `name` 속성이 없다. 브라우저는 제출 시 `name`이 있는 컨트롤만 직렬화하므로 이메일 값은 아예 전송되지 않는다. `id`는 문서 내 참조(label 연결, JS 접근)용일 뿐 전송과 무관하다. `name="email"`을 추가해야 한다.
</details>

**3.** 체크박스의 `el.getAttribute('checked')`가 `null`인데 `el.checked`는 `true`다. 어떤 상황인가?

<details>
<summary>정답과 해설</summary>

마크업에는 `checked` 속성이 없었고(초기 상태 미체크), 이후 사용자가 클릭했거나 JS가 `el.checked = true`로 프로퍼티를 변경한 상황이다. 속성은 마크업에 적힌 초기값을 반영할 뿐 프로퍼티 변경을 따라가지 않으므로 둘이 어긋날 수 있다.
</details>

## 참고 자료

- [HTML Living Standard — Content models](https://html.spec.whatwg.org/multipage/dom.html#content-models) — 콘텐츠 카테고리의 원 정의. 요소별 허용 콘텐츠를 확인하는 1차 자료.
- [HTML Living Standard — Parsing: An introduction to error handling](https://html.spec.whatwg.org/multipage/parsing.html#an-introduction-to-error-handling-and-strange-cases-in-the-parser) — 파서 오류 복구 규칙이 실제로 표준화되어 있음을 보여주는 스펙 본문.
- [MDN — HTML elements reference](https://developer.mozilla.org/ko/docs/Web/HTML/Element) — 개별 태그의 용법·허용 콘텐츠·브라우저 지원을 찾을 때의 기본 레퍼런스.
- [MDN — Client-side form validation](https://developer.mozilla.org/ko/docs/Learn/Forms/Form_validation) — 내장 검증 속성과 Constraint Validation API 정리.
- [Nu Html Checker](https://validator.w3.org/nu/) — 마크업 유효성 검사기. 파서 복구에 의존하고 있는 지점을 찾아 준다.
