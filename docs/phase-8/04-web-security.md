# 8-4. 웹 보안

> 한 줄 요약: 이 문서를 읽고 나면 브라우저의 origin·site·쿠키·스크립트 실행 모델을 기준으로 XSS, CSRF, 토큰 저장, CSP 방어를 계층별로 설계할 수 있다.

이 문서는 MDN의 Same-Origin Policy, Secure Contexts, Set-Cookie, CSP, Trusted Types 문서와 OWASP의 XSS/CSRF 자료, React 공식 문서를 기준으로 한다. 보안 설정의 기본값과 브라우저 정책은 시간이 지나며 바뀔 수 있으므로, 실제 서비스에 적용할 때는 대상 브라우저와 프레임워크 버전을 공식 문서로 다시 확인해야 한다.

## 학습 목표

- origin, site, secure context가 서로 다른 보안 경계임을 설명할 수 있다.
- XSS가 어떤 injection sink에서 성립하는지 설명하고, escaping, sanitization, CSP, Trusted Types의 역할을 구분할 수 있다.
- CSRF가 쿠키의 자동 첨부라는 ambient authority에서 출발한다는 점을 설명하고, SameSite, CSRF token, custom header 방어를 비교할 수 있다.
- JWT와 세션, localStorage와 httpOnly cookie를 같은 축으로 섞지 않고 저장 위치·폐기·공격면 관점에서 판단할 수 있다.
- React의 기본 escaping과 `dangerouslySetInnerHTML`의 경계 조건을 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

브라우저는 적대적인 실행 환경이다. 사용자는 같은 브라우저에서 은행, 사내 시스템, 개인 메일, 공격자가 만든 페이지를 동시에 연다. 브라우저는 이 문서들이 서로의 데이터와 권한을 마음대로 읽지 못하게 origin 단위로 격리한다. 그러나 완전히 격리하면 웹은 동작하지 않는다. 이미지는 다른 origin에서 가져와야 하고, CDN의 script를 실행해야 하며, API 서버는 프론트엔드와 다른 origin일 수 있다. 쿠키는 요청마다 자동으로 붙고, form은 cross-site로 제출될 수 있다.

웹 보안은 이 긴장 위에 있다.

```text
격리해야 한다: 다른 사이트의 비밀을 읽으면 안 된다.
연결해야 한다: 리소스와 API는 여러 origin을 건넌다.
자동화된다: 브라우저는 쿠키, redirect, form, script 실행을 자동 처리한다.
```

Phase 2-3에서는 쿠키와 상태를, [8-2](./02-network-deep-dive.md)에서는 CORS와 브라우저 네트워크 모델을 다뤘다. 이 문서는 그 위에 공격과 방어를 얹는다. 핵심은 "어떤 헤더를 붙이면 안전하다"가 아니라 **공격이 성립하는 조건과 방어가 끊는 지점을 정확히 분리하는 것**이다.

## 핵심 개념

### origin과 site는 같은 말이 아니다

origin은 scheme, host, port의 조합이다.

```text
https://app.example.com:443
  scheme: https
  host: app.example.com
  port: 443
```

다음 URL들은 origin 관점에서 다르다.

| URL | `https://app.example.com`과 비교 | 이유 |
|---|---|---|
| `https://app.example.com/settings` | same-origin | path만 다르다 |
| `http://app.example.com` | cross-origin | scheme이 다르다 |
| `https://api.example.com` | cross-origin | host가 다르다 |
| `https://app.example.com:8443` | cross-origin | port가 다르다 |

site는 쿠키의 SameSite 판단에서 더 중요하게 쓰이는 개념이다. 대략 등록 가능 도메인(eTLD+1)과 scheme을 기준으로 본다. `app.example.com`과 `api.example.com`은 origin은 다르지만 같은 site일 수 있다. 이 차이 때문에 CORS와 SameSite 쿠키가 서로 다른 결론을 낼 수 있다.

| 판단 | 경계 | 대표 기능 |
|---|---|---|
| origin | scheme + host + port | DOM 접근, Web Storage, CORS |
| site | scheme + registrable domain | SameSite cookie, CSRF 맥락 |
| secure context | HTTPS 또는 신뢰 가능한 로컬 맥락 | 강한 권한 API, Service Worker, 일부 최신 API |

보안 설계에서 이 셋을 섞으면 위험하다. "같은 도메인 계열"이라는 말은 너무 부정확하다. API가 cross-origin인지, 쿠키가 same-site로 붙는지, API가 secure context를 요구하는지는 따로 판단해야 한다.

### same-origin policy는 읽기를 막고, 쓰기와 임베드는 별도 문제다

Same-origin policy(SOP)는 한 origin의 문서나 스크립트가 다른 origin의 리소스와 상호작용하는 방식을 제한한다. 실무적으로는 cross-origin interaction을 세 범주로 나눠 보는 것이 유용하다.

| 범주 | 기본 경향 | 예시 | 방어 포인트 |
|---|---|---|---|
| write | 대체로 허용 | link 이동, form 제출, redirect | CSRF token, SameSite, method 의미론 |
| embed | 대체로 허용 | `<img>`, `<script src>`, `<iframe>` | CORP, CSP, X-Frame-Options/frame-ancestors |
| read | 대체로 차단 | `fetch()` 응답 본문 읽기, iframe DOM 읽기 | CORS, SOP |

CORS는 cross-origin read를 서버가 허용하는 프로토콜이다. CSRF는 cross-origin write가 가능한 구조와 쿠키 자동 첨부를 이용한다. XSS는 같은 origin 안에서 공격자 코드가 실행되도록 만드는 문제다.

```text
CORS: 다른 origin 응답을 이 스크립트가 읽어도 되는가?
CSRF: 다른 site가 사용자의 권한으로 상태 변경 요청을 보내게 할 수 있는가?
XSS: 이 origin에서 공격자 스크립트가 실행되는가?
```

세 문제는 겹치지만 대체재가 아니다. CORS를 닫아도 CSRF가 가능할 수 있고, SameSite를 설정해도 XSS가 있으면 같은 origin의 스크립트가 직접 요청을 보낼 수 있다.

### XSS는 신뢰하지 않은 데이터를 실행 가능한 문맥에 넣을 때 생긴다

XSS(Cross-Site Scripting)는 공격자가 넣은 데이터가 브라우저에서 실행 가능한 코드로 해석될 때 성립한다. HTML 문서 안에는 여러 문맥이 있다.

| 문맥 | 위험 예 | 필요한 방어 |
|---|---|---|
| HTML text | `<div>${userInput}</div>` | HTML escaping |
| HTML attribute | `<img alt="${userInput}">` | attribute escaping, quote 처리 |
| URL attribute | `<a href="${userInput}">` | URL scheme allowlist |
| JavaScript string | `<script>const x = "${userInput}"</script>` | JS string escaping 또는 데이터 script 분리 |
| DOM sink | `element.innerHTML = userInput` | sanitization, Trusted Types |

나쁜 예:

```html
<!doctype html>
<meta charset="utf-8" />
<label>
  Comment
  <input id="comment" />
</label>
<button id="preview">preview</button>
<div id="output"></div>

<script>
  const input = document.querySelector("#comment");
  const output = document.querySelector("#output");

  document.querySelector("#preview").addEventListener("click", () => {
    // 신뢰하지 않은 문자열을 HTML로 해석하는 injection sink에 넣는다.
    output.innerHTML = input.value;
  });
</script>
```

사용자가 다음 값을 입력하면 이벤트 handler attribute가 실행될 수 있다.

```html
<img src="x" onerror="alert(document.domain)">
```

좋은 예:

```html
<!doctype html>
<meta charset="utf-8" />
<label>
  Comment
  <input id="comment" />
</label>
<button id="preview">preview</button>
<div id="output"></div>

<script>
  const input = document.querySelector("#comment");
  const output = document.querySelector("#output");

  document.querySelector("#preview").addEventListener("click", () => {
    // 텍스트로 삽입하면 브라우저가 HTML로 해석하지 않는다.
    output.textContent = input.value;
  });
</script>
```

HTML을 정말 허용해야 한다면 escaping만으로 부족하다. Markdown, WYSIWYG, CMS처럼 일부 HTML을 받아야 하는 경우에는 허용할 element와 attribute를 정하고 나머지를 제거하는 sanitization이 필요하다. 이때도 sanitizer 라이브러리와 정책을 신뢰 경계로 다뤄야 한다.

### React는 기본적으로 텍스트를 escape하지만 raw HTML은 개발자 책임이다

React는 JSX의 문자열 값을 DOM text로 넣을 때 기본적으로 escape한다.

```jsx
export function Comment({ body }) {
  return <p>{body}</p>;
}
```

`body`가 `<img src=x onerror=alert(1)>`이어도 React는 이것을 HTML로 실행하지 않고 텍스트로 넣는다. 이것이 React의 중요한 기본 방어다.

하지만 다음 코드는 다르다.

```jsx
export function Article({ html }) {
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
```

`dangerouslySetInnerHTML`은 이름 그대로 DOM의 `innerHTML` 계열 sink를 사용한다. React 공식 문서도 신뢰하지 않은 HTML을 넣으면 XSS 취약점이 생긴다고 경고한다. 이 API가 필요한 경우에는 다음 규칙이 필요하다.

- raw HTML 생성 지점을 좁힌다.
- sanitizer를 통과한 값만 `dangerouslySetInnerHTML`에 전달한다.
- sanitizer 정책을 테스트한다.
- CSP와 Trusted Types를 추가 방어층으로 둔다.
- 사용자가 작성한 HTML을 다른 사용자에게 보여 주는 stored XSS 경로를 특히 조심한다.

React가 XSS를 "해결한다"가 아니라, 기본 렌더링 경로에서 안전한 sink를 선택해 준다고 이해해야 한다.

### CSP는 실행 가능한 리소스의 출처와 형태를 제한한다

CSP(Content Security Policy)는 브라우저에게 이 문서에서 어떤 리소스와 실행 형태를 허용할지 알려 주는 정책이다.

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  object-src 'none';
  base-uri 'none';
```

이 정책은 같은 origin의 기본 리소스만 허용하고, plugin 계열 object와 `<base>`를 막는다. 하지만 실무적인 XSS 방어에서는 단순 allowlist CSP보다 nonce 또는 hash 기반 strict CSP가 더 강한 방향으로 권장된다.

nonce 기반 예:

```http
Content-Security-Policy:
  script-src 'nonce-random-per-response';
  object-src 'none';
  base-uri 'none';
```

```html
<script nonce="random-per-response" src="/app.js"></script>
```

서버는 응답마다 예측 불가능한 nonce를 생성하고, CSP header와 허용할 script tag에 같은 값을 넣는다. 공격자가 HTML을 주입하더라도 nonce를 알 수 없으면 새 inline script를 실행하기 어렵다.

주의할 점:

- nonce는 응답마다 새로 만들어야 한다.
- `'unsafe-inline'`은 CSP의 핵심 효과를 크게 약화한다.
- third-party script가 동적으로 다른 script를 삽입하면 `strict-dynamic` 같은 선택지가 필요하지만, 신뢰 전파 비용이 생긴다.
- CSP는 취약한 sink를 고치는 대체재가 아니다. 성공한 XSS의 피해를 줄이는 방어층이다.
- 먼저 `Content-Security-Policy-Report-Only`로 관찰한 뒤 점진적으로 강제하는 전략이 현실적이다.

### Trusted Types는 DOM XSS sink를 중앙에서 통제한다

Trusted Types는 `innerHTML`, `document.write()`, script URL 같은 injection sink에 임의 문자열을 바로 넣지 못하게 하고, 정의한 policy를 통과한 값만 넣도록 강제하는 브라우저 API다.

개념적 형태:

```js
const policy = trustedTypes.createPolicy("app-html", {
  createHTML(input) {
    return sanitizeHtml(input);
  },
});

element.innerHTML = policy.createHTML(markdownHtml);
```

CSP로 강제할 수 있다.

```http
Content-Security-Policy:
  require-trusted-types-for 'script';
  trusted-types app-html;
```

Trusted Types는 sanitizer가 아니다. sanitizer를 어디서 어떤 정책으로 호출하는지를 강제하는 경계다. sanitizer 정책이 약하면 Trusted Types도 약하다. 다만 대형 앱에서 DOM XSS sink가 흩어져 있을 때 "raw string을 sink에 넣는 코드"를 구조적으로 줄이는 데 강하다.

### CSRF는 브라우저가 권한을 자동으로 붙이는 데서 시작한다

CSRF(Cross-Site Request Forgery)는 사용자가 로그인한 사이트에 대해, 공격자 페이지가 사용자의 브라우저로 원치 않는 상태 변경 요청을 보내게 하는 공격이다. 핵심은 쿠키가 요청에 자동으로 붙는다는 점이다.

취약한 조건:

```text
사용자는 https://bank.example 에 로그인해 쿠키를 가진다.
공격자는 https://evil.example 페이지를 보여 준다.
evil.example이 bank.example으로 form POST를 보낸다.
브라우저는 bank.example 쿠키를 자동으로 붙인다.
서버가 추가 검증 없이 상태를 바꾼다.
```

공격 예:

```html
<form action="https://bank.example/transfer" method="post">
  <input type="hidden" name="to" value="attacker" />
  <input type="hidden" name="amount" value="100000" />
</form>
<script>
  document.querySelector("form").submit();
</script>
```

CSRF 방어는 여러 계층을 조합한다.

| 방어 | 막는 지점 | 장점 | 경계 조건 |
|---|---|---|---|
| SameSite cookie | cross-site 요청에 쿠키 첨부 제한 | 브라우저 기본 정책으로 강함 | same-site subdomain 공격, 오래된 브라우저, `None` 필요 상황 |
| CSRF token | 공격자가 알 수 없는 값을 요구 | 서버에서 명시적 검증 가능 | token 발급·저장·검증 구현 필요 |
| custom header + preflight | 단순 form 제출로 만들 수 없는 요청 요구 | SPA API에 적용하기 쉬움 | CORS 설정이 느슨하면 약해짐 |
| Origin/Referer 검증 | 요청 출처 확인 | 추가 방어층 | 누락·프록시·privacy 정책 고려 필요 |
| idempotent method 설계 | GET으로 상태 변경 금지 | HTTP 의미론과 일치 | 기존 API 변경 비용 |

SameSite는 중요한 기본 방어지만 전부가 아니다. 특히 인증 cookie가 cross-site SSO, 외부 결제, embed 흐름 때문에 `SameSite=None; Secure`를 필요로 할 수 있다. 이 경우 CSRF token과 Origin 검증 같은 별도 방어가 더 중요해진다.

### 토큰 저장 위치는 XSS와 CSRF의 교환이다

토큰 저장 논쟁은 흔히 "JWT냐 세션이냐"와 "localStorage냐 cookie냐"가 섞여 버린다. 분리해서 봐야 한다.

| 축 | 선택지 | 핵심 질문 |
|---|---|---|
| 서버 상태 | 세션, JWT, opaque token | 서버가 즉시 폐기·회전·조회할 수 있는가? |
| 브라우저 저장 위치 | memory, localStorage, sessionStorage, httpOnly cookie | XSS와 CSRF 중 어떤 공격면이 커지는가? |
| 전송 방식 | Authorization header, cookie | 브라우저가 자동으로 붙이는가, 앱 코드가 붙이는가? |

저장 위치 비교:

| 위치 | 장점 | 주요 위험 | 적합한 조건 |
|---|---|---|---|
| memory | 새로고침 시 사라져 XSS 지속성 감소 | 새로고침 UX, tab 간 공유 어려움 | 짧은 access token + refresh 흐름 |
| localStorage | 구현과 유지가 쉽다 | XSS가 토큰을 읽어 외부로 보낼 수 있다 | 민감도 낮거나 별도 강한 XSS 방어가 있는 경우 |
| sessionStorage | tab 단위 격리 | XSS가 읽을 수 있다 | tab 수명에 묶인 임시 상태 |
| httpOnly cookie | JavaScript가 읽을 수 없다 | CSRF와 자동 첨부 관리 필요 | 서버 세션, BFF, SameSite/CSRF 방어가 있는 구조 |

httpOnly cookie는 XSS가 토큰 문자열을 훔치는 것을 막지만, XSS가 같은 origin에서 API 요청을 보내는 것은 막지 못한다. localStorage는 CSRF에는 덜 노출될 수 있지만, XSS가 있으면 토큰 탈취가 쉽다. 따라서 "어디가 항상 안전한가"가 아니라 위협 모델과 방어 조합을 봐야 한다.

## 실무 관점

### 보안 방어는 공격 성공 조건을 끊는 방식으로 설계한다

| 공격 | 성공 조건 | 1차 방어 | 추가 방어 |
|---|---|---|---|
| reflected XSS | 요청 입력이 HTML/JS 문맥에 escape 없이 반영 | context-aware escaping | CSP, Trusted Types |
| stored XSS | 저장된 사용자 입력이 다른 사용자에게 실행 | 저장 전/출력 전 sanitization, safe sink | CSP, review, content moderation |
| DOM XSS | 클라이언트 데이터가 injection sink로 이동 | safe DOM API, Trusted Types | CSP, lint, sink audit |
| CSRF | 쿠키 자동 첨부 + 상태 변경 + token 없음 | SameSite, CSRF token | Origin 검증, custom header |
| 토큰 탈취 | XSS가 token 저장소에 접근 | httpOnly cookie 또는 memory | CSP, refresh token rotation |

방어층은 서로 겹치게 둔다. escaping이 실패해도 CSP가 피해를 줄이고, CSP가 구멍나도 Trusted Types가 sink를 막고, SameSite가 우회되어도 CSRF token이 막는 구조가 좋다.

### CSP는 배포 파이프라인과 함께 설계한다

CSP는 코드만 바꾸는 문제가 아니다. 빌드가 생성하는 script, style, inline runtime, analytics, tag manager, CDN host가 모두 정책에 들어간다.

도입 순서:

1. 현재 리소스 로딩 목록을 DevTools Network와 CSP report-only로 수집한다.
2. `object-src 'none'`, `base-uri 'none'`, `frame-ancestors`처럼 영향이 명확한 정책부터 검토한다.
3. inline script를 제거하거나 nonce/hash 기반으로 정리한다.
4. third-party script의 소유권과 필요성을 검토한다.
5. `Content-Security-Policy-Report-Only`로 위반 보고를 관찰한다.
6. 실제 `Content-Security-Policy`로 강제한다.

정적 사이트는 nonce보다 hash 기반 CSP가 맞을 수 있다. SSR은 응답마다 nonce를 생성하기 쉽다. CSR만 있는 정적 호스팅에서는 meta CSP로 일부 정책을 적용할 수 있지만, 모든 CSP 기능을 지원하지 않으므로 header 설정 가능 여부를 먼저 본다.

### 인증 전략은 운영 요구와 함께 판단한다

JWT는 서버 조회 없이 검증할 수 있어 확장성이 좋아 보이지만, 즉시 폐기와 권한 변경 반영이 어렵다. 세션은 서버 상태가 필요하지만 폐기와 회전이 쉽다. opaque token은 introspection 서버가 필요할 수 있다.

| 요구 | 더 유리한 방향 | 이유 |
|---|---|---|
| 즉시 로그아웃·권한 회수 | 서버 세션 또는 짧은 JWT + refresh 회전 | 서버가 현재 유효성을 통제해야 한다 |
| 여러 API 서버의 독립 검증 | JWT | 공개키 검증으로 중앙 조회를 줄일 수 있다 |
| 브라우저 앱 + same-site BFF | httpOnly cookie + CSRF 방어 | 토큰을 JS에 노출하지 않는다 |
| third-party API 직접 호출 | Authorization header token | cookie origin/site 제약을 피한다 |
| 높은 XSS 위험 | httpOnly cookie, CSP, Trusted Types | token 문자열 탈취를 줄인다 |

토큰 형식과 저장 위치는 함께 결정하지만 같은 문제가 아니다. "JWT를 cookie에 저장한다", "opaque access token을 memory에 둔다"처럼 조합은 다양하다.

## 더 깊이

### XSS는 CSP를 우회하는 형태로 진화한다

단순한 `<script>alert(1)</script>`만 막으면 XSS가 사라지는 것이 아니다. 공격자는 HTML attribute, SVG, URL scheme, template injection, DOM clobbering, third-party script 공급망, JSONP, postMessage 오용 같은 경로를 찾는다. CSP allowlist에 신뢰한 CDN이 JSONP나 script gadget을 제공하면 XSS 방어가 약해질 수 있다.

그래서 CSP를 allowlist 나열로만 접근하면 유지가 어렵다. nonce/hash 기반 strict CSP가 권장되는 이유는 "어느 도메인을 믿을 것인가"보다 "이 응답에서 서버가 명시적으로 허용한 script만 실행한다"는 모델에 가깝기 때문이다.

### 쿠키의 Domain과 Path는 보안 경계가 아니다

쿠키의 `Domain`과 `Path`는 전송 범위를 줄이는 속성이지만, 강한 보안 경계로 보면 안 된다. 같은 site의 하위 도메인이 공격당하면 넓은 `Domain=.example.com` 쿠키가 함께 노출되거나 요청에 붙을 수 있다. `Path`는 요청 URL 매칭에 쓰이지만, 같은 origin의 스크립트 접근을 강하게 격리하는 경계가 아니다.

민감한 쿠키에는 다음을 기본으로 검토한다.

```http
Set-Cookie: session=...; Secure; HttpOnly; SameSite=Lax; Path=/
```

cross-site 전송이 꼭 필요하면:

```http
Set-Cookie: session=...; Secure; HttpOnly; SameSite=None; Path=/
```

`SameSite=None`에는 `Secure`가 필요하다. 이 선택은 CSRF 공격면을 넓힐 수 있으므로 별도 token 검증이 필요하다.

### 브라우저 보안 헤더는 기능별 경계가 다르다

| 헤더 | 주 목적 | 대체하지 못하는 것 |
|---|---|---|
| `Content-Security-Policy` | script/resource 실행 제한, clickjacking 방어, Trusted Types 강제 | 입력 검증과 escaping |
| `Set-Cookie` 속성 | 쿠키 전송·노출 범위 제어 | 서버 권한 검증 |
| `Cross-Origin-Resource-Policy` | 다른 origin이 리소스를 embed/read하는 방식 제한 | CORS 허용 정책 |
| `Referrer-Policy` | referrer 정보 노출 제어 | 인증/인가 |
| `Strict-Transport-Security` | HTTPS 강제 | XSS/CSRF |
| `Permissions-Policy` | 강력한 브라우저 기능 사용 제한 | 데이터 접근 권한 설계 |

보안 헤더는 체크리스트가 아니라 경계 설계다. 어떤 헤더가 어떤 공격 성공 조건을 끊는지 설명할 수 있어야 한다.

## 정리

- origin은 scheme/host/port 경계이고, site는 SameSite 쿠키 판단에 쓰이는 경계이며, secure context는 강한 브라우저 API 사용 조건이다.
- CORS는 cross-origin 응답 읽기 권한이고, CSRF는 쿠키 자동 첨부를 이용한 상태 변경 요청 문제이며, XSS는 같은 origin에서 공격자 코드가 실행되는 문제다.
- XSS 방어는 safe sink, context-aware escaping, sanitization, CSP, Trusted Types를 계층적으로 조합한다.
- CSRF 방어는 SameSite cookie, CSRF token, Origin 검증, custom header와 HTTP method 의미론을 함께 설계한다.
- 토큰 저장 위치에는 정답이 없고, XSS·CSRF·폐기·회전·운영 요구의 트레이드오프가 있다.

## 확인 문제

1. `Access-Control-Allow-Origin`을 제거하면 CSRF도 막히는가?

<details>
<summary>정답과 해설</summary>

아니다. CORS는 주로 JavaScript가 cross-origin 응답을 읽을 수 있는지를 제어한다. CSRF는 공격자 페이지가 사용자의 브라우저로 상태 변경 요청을 보내고 쿠키가 자동으로 붙는 문제다. 응답을 읽지 못해도 상태 변경은 성공할 수 있다. CSRF는 SameSite, CSRF token, Origin 검증 등으로 별도 방어해야 한다.

</details>

2. React에서 `<p>{userInput}</p>`는 안전한데 `dangerouslySetInnerHTML`은 왜 위험한가?

<details>
<summary>정답과 해설</summary>

JSX의 텍스트 삽입은 React가 값을 escape해서 HTML로 실행하지 않는다. 반면 `dangerouslySetInnerHTML`은 문자열을 HTML로 해석하는 sink를 사용한다. 신뢰하지 않은 입력이 들어가면 `<img onerror=...>` 같은 payload가 실행될 수 있다. raw HTML이 필요하다면 sanitizer, CSP, Trusted Types 같은 방어층이 필요하다.

</details>

3. 인증 토큰을 httpOnly cookie로 옮기면 XSS 문제가 사라지는가?

<details>
<summary>정답과 해설</summary>

토큰 문자열을 JavaScript가 직접 읽어 탈취하는 위험은 줄어든다. 그러나 XSS가 같은 origin에서 실행되면 공격자는 사용자 권한으로 API 요청을 보낼 수 있다. httpOnly cookie는 XSS 방어가 아니라 피해 범위를 줄이는 방어층이다. safe sink, CSP, Trusted Types, 입력 처리 방어는 여전히 필요하다.

</details>

4. `SameSite=None; Secure`가 필요한 로그인 흐름을 만들었다. 추가로 무엇을 검토해야 하는가?

<details>
<summary>정답과 해설</summary>

`SameSite=None`은 cross-site 요청에도 쿠키를 보낼 수 있게 하므로 CSRF 공격면이 넓어진다. 상태 변경 요청에는 CSRF token, Origin/Referer 검증, custom header 기반 preflight, GET으로 상태 변경 금지 같은 방어를 검토해야 한다. 또한 쿠키에 `HttpOnly`, `Secure`, 적절한 `Path`와 좁은 `Domain`을 설정한다.

</details>

## 참고 자료

- [MDN: Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy) — origin 정의와 cross-origin write/embed/read의 차이를 설명한다.
- [MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) — HTTPS 등 신뢰 가능한 맥락에서만 허용되는 브라우저 기능의 기준을 설명한다.
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) — `Secure`, `HttpOnly`, `SameSite`, `Domain`, `Path` 속성의 의미를 확인할 수 있다.
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) — CSP의 fetch directive, nonce/hash, strict CSP, report-only 배포 전략을 설명한다.
- [MDN: Trusted Types API](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API) — DOM XSS sink를 정책 객체로 통제하는 모델을 설명한다.
- [OWASP: Cross Site Scripting](https://owasp.org/www-community/attacks/xss/) — XSS의 공격 조건과 stored/reflected/DOM XSS 분류를 확인할 수 있다.
- [OWASP: Cross Site Request Forgery](https://owasp.org/www-community/attacks/csrf) — CSRF의 공격 모델과 방어 자료로 이어지는 공식 설명이다.
- [React: Dangerously setting the inner HTML](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html) — React에서 raw HTML 삽입이 왜 위험한지와 API 사용 경계를 설명한다.
