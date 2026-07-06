# 5-7. 라우팅과 코드 분할

> 한 줄 요약: 이 문서를 읽고 나면 SPA 라우팅이 History API 위에서 성립하는 메커니즘과 React Router의 매칭 모델을 설명하고, lazy/Suspense로 라우트 단위 코드 분할을 설계하며 그 워터폴 비용까지 관리할 수 있다.

이 문서는 React 19, React Router 7(라이브러리 모드) 기준이다.

## 학습 목표

- History API(pushState/popstate)의 정확한 동작과 SPA 라우팅이 이 두 조각으로 조립되는 방식을 설명할 수 있다.
- "새로고침하면 404"가 나는 이유를 서버 라우팅과의 관계로 설명하고 배포 설정으로 해결할 수 있다.
- React Router의 선언적 매칭(중첩 라우트, Outlet)을 "URL을 상태로 보는" 렌더링 모델의 적용으로 설명할 수 있다.
- lazy/Suspense의 동작(팩토리 호출 시점, fallback, 캐시)을 설명하고, 라우트 단위 분할의 청크 워터폴을 프리로딩으로 완화할 수 있다.

## 배경: 왜 이것이 존재하는가

전통적 웹에서 URL 변경은 문서 교체다: 링크 클릭 → 요청 → 새 HTML → 전체 파싱·실행. 페이지마다 앱 전체가 다시 부팅되고, 화면 간에 살아 있는 상태(스크롤, 입력, 연결)는 소멸한다. SPA는 이 결합을 끊는다 — 문서는 한 번만 로드하고, 이후의 "페이지 이동"은 **URL 갱신 + 화면 상태 전환**으로 대체한다.

그런데 URL을 포기할 수는 없다. URL은 웹의 계약이다: 공유하면 같은 화면이 열리고, 새로고침해도 그 자리이고, 뒤로 가기가 동작한다. [5-6](./06-state-architecture.md)에서 "새로고침·공유·뒤로가기를 견뎌야 하는 상태는 URL에"라고 한 그 저장소다. SPA 라우팅의 문제 설정은 따라서: **문서를 다시 로드하지 않으면서 URL 계약을 지키는 것**이고, 브라우저가 이를 위해 제공하는 원시 연산이 History API다.

백엔드 라우터와의 차이를 미리 짚어 둘 가치가 있다. 서버 라우팅은 무상태 매칭이다 — 요청이 오면 테이블에서 핸들러를 찾아 실행하고 끝난다. SPA 라우팅은 **전이(transition)를 다룬다** — 이전 화면이 살아 있는 채로 다음 화면으로 옮겨 가며, 떠나는 화면의 정리(구독 해제 — [5-4](./04-effects.md)의 클린업), 유지할 상태(레이아웃), 파괴할 상태([5-2](./02-rendering-and-reconciliation.md)의 재조정 판정)가 전부 걸려 있다. 라우터는 URL 매처가 아니라 화면 상태 머신에 가깝다.

## 핵심 개념

### History API — 두 개의 원시 연산

SPA 라우팅의 전부는 브라우저 API 두 조각이다.

**① `history.pushState(state, '', url)`** — 주소창의 URL을 바꾸고 세션 히스토리에 항목을 쌓는다. **문서를 로드하지 않는다.** 서버로 아무것도 보내지 않는다.

**② `popstate` 이벤트** — 사용자가 뒤로/앞으로 가기로 히스토리를 **이동할 때** 발생한다.

가장 흔한 오해가 "URL이 바뀌면 popstate가 온다"인데, 실측으로 정리하면:

```js
window.addEventListener('popstate', (e) => {
  console.log('popstate, state =', JSON.stringify(e.state));
});

history.pushState({ page: 1 }, '', '/products');
console.log(location.pathname);
// 출력: /products
// (popstate 로그 없음 — pushState는 popstate를 발생시키지 않는다)

history.pushState({ page: 2 }, '', '/products/42');
history.back();
// 출력: popstate, state = {"page":1}   ← 이동으로 도착한 항목의 state가 실려 온다
```

즉 신호는 비대칭이다: **앱이 일으킨 이동(pushState)은 앱이 이미 알고, 사용자가 일으킨 이동(뒤로가기)만 이벤트로 통지된다.** 이 비대칭 위에 라우터의 최소 구조가 선다.

```js
// 최소 SPA 라우터의 골격 — 모든 라우팅 라이브러리의 공통 코어
function navigate(url) {
  history.pushState(null, '', url);
  render(location.pathname);          // ① 앱 주도 이동: 직접 렌더 트리거
}
window.addEventListener('popstate', () => {
  render(location.pathname);          // ② 사용자 주도 이동: 이벤트로 렌더 트리거
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (a && !e.metaKey && !e.ctrlKey) {  // 새 탭 의도는 브라우저에 맡긴다
    e.preventDefault();                  // 문서 로드를 막고
    navigate(a.getAttribute('href'));    // 상태 전환으로 대체
  }
}); // 이벤트 위임 — 3-7의 패턴
```

`pushState`의 첫 인자 `state`는 히스토리 항목에 붙는 직렬화 가능한 짐칸이다 — 뒤로 가기로 돌아왔을 때 복원할 부가 정보(스크롤 위치 등)를 실어 두는 용도로, 라우터들이 내부적으로 쓴다.

### 새로고침 404 — 두 라우터의 관할 충돌

`pushState`로 `/products/42`까지 갔다가 새로고침하면, 브라우저는 서버에 `GET /products/42`를 보낸다. 서버에는 그 경로가 없다 — 라우팅은 지금까지 클라이언트 JS 안에서만 존재했다. 정적 호스팅이라면 404다.

이것은 버그가 아니라 SPA 모델의 정의적 귀결이다: URL 공간의 소유자가 둘(서버, 클라이언트)이 되었고, 서버 쪽에 "모르는 경로는 전부 `index.html`을 줘라"는 위임 설정(SPA fallback)이 필요하다. 그러면 어느 URL로 진입하든 앱이 부팅된 뒤 클라이언트 라우터가 `location.pathname`을 읽어 올바른 화면을 그린다. 모든 정적 호스트·CDN에 이 설정이 있고(Netlify `_redirects`, nginx `try_files $uri /index.html`), Vite 데브 서버는 기본 내장이라 **개발 중에는 절대 재현되지 않는 배포 사고**라는 점이 함정이다. 이 fallback이 캐싱·CDN과 얽히는 지점은 6-5에서 다룬다.

### React Router — URL을 상태로 보는 모델

위 골격에서 남는 일은 `render(pathname)` — URL을 화면으로 변환하는 규칙이다. React Router는 이를 선언으로 만든다:

```jsx
import { createBrowserRouter, RouterProvider, Outlet, Link, useParams } from 'react-router';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,            // 공통 레이아웃
    children: [                     // 중첩: URL 세그먼트 = 트리 계층
      { index: true, element: <Home /> },
      { path: 'products', element: <ProductList /> },
      { path: 'products/:id', element: <ProductDetail /> }, // :id → useParams()
    ],
  },
]);

function Layout() {
  return (
    <div>
      <nav><Link to="/products">상품</Link></nav>
      <Outlet /> {/* 매칭된 자식 라우트의 요소가 이 자리에 */}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
```

동작을 [5-1](./01-react-mental-model.md)의 모델로 환원하면: 라우터는 URL이라는 외부 상태를 구독하고(popstate + 자체 navigate), URL이 바뀌면 라우트 테이블을 매칭해 **요소 트리를 계산**한다. `/products/42`는 `<Layout>` 안의 `<Outlet>` 자리에 `<ProductDetail>`이 들어간 트리가 되고, 이 새 트리가 이전 트리와 재조정된다 — `Layout`은 같은 위치·같은 타입이므로 인스턴스가 유지되고(내비게이션의 열림 상태, 스크롤이 살아남는 이유), `Outlet` 자리의 타입이 바뀐 부분만 언마운트/마운트된다. **라우팅은 특별한 기능이 아니라 "URL도 상태다"의 적용이고, 화면 전환의 규칙은 전부 [5-2](./02-rendering-and-reconciliation.md)의 재조정 규칙 그대로다.** `ProductDetail`에서 `/products/42 → /products/43` 이동 시 상태가 유지되는 것(같은 타입), 리셋하고 싶으면 key를 쓰는 것까지 동일하다.

`Link`는 위 골격의 클릭 가로채기(preventDefault + navigate)를 캡슐화한 것이고, `useParams`·`useSearchParams`는 URL 조각의 구독 훅이다 — [5-6](./06-state-architecture.md)의 "URL 저장소"를 읽고 쓰는 통로.

라우트에는 `loader`를 붙일 수 있다 — 매칭 시점(렌더 전)에 실행되는 데이터 함수다. [5-4](./04-effects.md)에서 본 이펙트 페칭의 구조적 문제(렌더 완료를 기다렸다가 요청 시작 → 계층마다 워터폴)를 라우터 계층에서 푸는 접근으로, 매칭된 모든 라우트의 loader가 **병렬로** 실행된 뒤 렌더된다(fetch-then-render). 서버 상태 캐싱과의 결합은 [5-8](./08-server-state.md)에서 정리한다.

### lazy와 Suspense — 분할 지점을 트리에 통합하기

SPA의 남은 비용 문제: 번들 하나에 모든 페이지가 들어 있으면, 첫 화면을 보기 위해 관리자 페이지 코드까지 다운로드한다. [3-9](../phase-3/09-modules.md)의 동적 `import()`가 분할 지점을 만들지만(번들러가 별도 청크로 — 구현은 6-2), `import()`는 Promise를 반환한다 — "아직 코드가 없는 컴포넌트"를 렌더 트리에 어떻게 세우는가가 React 쪽 문제이고, `lazy` + `Suspense`가 그 답이다.

```jsx
import { lazy, Suspense } from 'react';

const AdminPage = lazy(() => import('./AdminPage')); // 팩토리를 등록할 뿐, 아직 로드 안 함

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>{/* ... <AdminPage />가 매칭될 때 비로소 로딩 시작 */}</Routes>
    </Suspense>
  );
}
```

동작을 실측으로 고정하면:

```
lazy(factory) 호출 시점:        팩토리 호출 0회 — 등록만 된다
<AdminPage /> 최초 렌더 시도:   팩토리 호출 1회 — 로딩 시작, 트리는 fallback 표시
로딩 완료:                     재렌더 — 실제 컴포넌트 표시
언마운트 후 재방문:             팩토리 호출 여전히 1회 — 모듈은 캐시된다
```

메커니즘은 Suspense 프로토콜이다: lazy 컴포넌트는 모듈이 없으면 렌더 중에 **Promise를 던진다**(throw). React는 이를 예외가 아니라 "이 서브트리는 아직 준비 안 됨" 신호로 받아, 가장 가까운 `<Suspense>` 경계까지 올라가 fallback을 대신 렌더하고, Promise가 이행되면 그 지점부터 재렌더한다. 렌더가 순수 계산이고 폐기·재시도 가능하다는 전제([5-2](./02-rendering-and-reconciliation.md))가 여기서도 일한다 — 던져진 렌더는 그냥 버려지는 렌더다. 이 프로토콜은 코드 로딩 전용이 아니라 "비동기 준비물 일반"의 통로이고(데이터 Suspense — [5-8](./08-server-state.md)의 `useSuspenseQuery`, 7-5의 스트리밍 SSR), lazy는 그 첫 적용 사례다.

Suspense 경계의 배치는 UX 설계다: 경계가 앱 최상단 하나면 어느 페이지 전환이든 화면 전체가 스피너가 되고, 라우트별로 두면 레이아웃(헤더, 내비게이션)은 유지된 채 콘텐츠 영역만 fallback이 된다. 후자가 기본값이다.

### 라우트 단위 분할과 워터폴

왜 분할 경계가 라우트인가: **사용자의 이동 경계와 코드의 필요 경계가 일치하는 지점**이기 때문이다. 페이지 안의 컴포넌트 단위 분할은 렌더 도중 fallback이 파편적으로 튀고 요청 수만 늘리기 쉽다. 라우트 단위는 "이 URL에 온 사람에게 필요한 코드"라는 자연스러운 묶음이고, React Router 7은 이를 라우트 정의의 `lazy` 옵션으로 1급 지원한다(`{ path: 'admin', lazy: () => import('./admin') }` — 컴포넌트뿐 아니라 loader까지 함께 지연 로드).

비용도 정직하게: 분할은 **순차 의존을 만든다**. 이동 → 청크 요청 → 다운로드·파싱 → 렌더 → (loader가 있으면) 데이터 요청… 이 네트워크 왕복이 이동할 때마다 사용자 체감 지연으로 들어온다. 완화는 프리로딩이다 — "필요해질 확률이 높아진 시점"에 미리 당긴다:

```jsx
// 의도 신호 기반 프리로드: hover/focus 시점에 import()를 미리 발사해 둔다
// (import()는 캐시되므로 실제 렌더 시점에는 이미 도착해 있다)
const preloadAdmin = () => import('./AdminPage');
<Link to="/admin" onMouseEnter={preloadAdmin} onFocus={preloadAdmin}>관리자</Link>
```

전략의 스펙트럼: 뷰포트 진입 시(링크가 보이면), 의도 신호 시(hover — 클릭보다 수백 ms 앞선다), 유휴 시간에 전부(requestIdleCallback) — 공격적일수록 체감 지연은 줄고 낭비 대역폭은 는다. 측정은 DevTools Network 패널에서 이동 시나리오를 녹화해 청크 요청이 클릭 전에 완료되는지 확인하는 것으로 한다.

## 실무 관점

### 라우팅 설계 체크리스트

- **URL이 화면 상태의 원본인가**: 상세 페이지 id, 필터, 페이지 번호가 컴포넌트 상태에만 있으면 공유·새로고침 계약이 깨진다. "이 화면을 URL로 보내면 같은 게 열리는가"를 설계 시점에 검증한다.
- **레이아웃은 중첩 라우트로**: 페이지 컴포넌트마다 `<Layout>`을 감싸는 방식은 이동마다 Layout이 재마운트될 위험(위치·타입 판정)과 중복을 만든다. 공통 껍데기는 부모 라우트 + Outlet으로 — 재조정이 인스턴스를 유지해 준다.
- **이동의 종류 구분**: 목록 → 상세는 push, 검색 필터 변경은 replace(`navigate(url, { replace: true })`) — 필터 조작 열 번이 뒤로가기 열 번이 되면 안 된다. 히스토리 스택은 사용자의 "의미 있는 위치" 목록으로 유지한다.
- **404·에러의 자리**: 매칭 실패 라우트(`path: '*'`)와 라우트 errorElement를 처음부터 설계에 포함한다. SPA는 서버가 404를 못 주므로(전부 200 + index.html) 클라이언트가 그 역할을 대신해야 한다.

### 전환 체감의 두 함정

- **스크롤 복원**: 문서 로드가 없으므로 브라우저의 자동 스크롤 복원이 동작하지 않는 경우를 라우터가 보정해야 한다 — React Router의 `<ScrollRestoration />`이 pushState의 state 짐칸에 위치를 실어 복원한다. 빠뜨리면 "뒤로 갔더니 목록 맨 위" UX가 된다.
- **포커스와 알림**: 문서 로드는 스크린 리더에 "새 페이지"를 알리지만 pushState는 아무것도 알리지 않는다. 라우트 전환 시 제목 갱신(`document.title`)과 포커스 이동(콘텐츠 영역이나 h1로)을 라우터 계층에서 처리하는 것이 접근성 기본기다.

### 분할 단위의 판단

| 분할 대상 | 판단 | 근거 |
|---|---|---|
| 라우트(페이지) | 기본값으로 분할 | 이동 경계 = 필요 경계, fallback UX가 자연스러움 |
| 무겁고 조건부인 컴포넌트(차트, 에디터, 모달) | 선별 분할 | 초기 경로에서 뺄 실익이 크고 필요 시점이 명확 |
| 자잘한 공용 컴포넌트 | 분할하지 않음 | 요청 수 증가 + fallback 파편화가 이득을 상회 |
| 첫 화면(초기 라우트) | 분할하지 않음 | 어차피 즉시 필요 — 분할하면 왕복만 하나 는다 |

효과 검증은 번들 분석(청크 구성이 실제로 나뉘었는가 — 6-2의 도구)과 Network 패널(초기 로드에서 뭐가 빠졌는가)로 한다.

## 더 깊이

### 해시 라우팅 — History API 이전의 우회

History API(HTML5) 이전의 SPA는 `location.hash`(`/#/products`)를 썼다: 해시 변경은 문서를 로드하지 않고 `hashchange` 이벤트를 주므로 같은 조립이 가능했고, 해시는 서버로 전송되지 않으므로 새로고침 404 문제도 없다(서버는 항상 `/`만 본다). 대가는 URL의 의미론 — 해시는 본래 문서 내 위치(fragment)라 SEO·서버 로그·리다이렉트에서 이류 시민이다. 오늘날 해시 라우팅은 "서버 설정을 만질 수 없는 정적 호스팅"이라는 좁은 조건의 도구로 남아 있다. 새로고침 404의 해법이 왜 '서버 설정'인지를 반대편에서 보여주는 사례다.

### Navigation API — popstate 모델의 후계

History API의 조립식 라우팅에는 구조적 구멍이 있다: 이동을 **가로채는** 표준 방법이 없고(클릭 위임은 앱이 만든 링크만 잡는다), 이동이 "완료되는" 시점 개념이 없어 전환 애니메이션·미저장 데이터 경고가 전부 우회 구현이다. Navigation API(`navigation.addEventListener('intercept', ...)`)는 이동 자체를 1급 이벤트로 만들어 가로채기·지연·취소를 표준화한다 — Chromium 계열은 구현했지만 전 브라우저 Baseline은 아직이라(2026년 기준 Safari 미완), 라우터들은 여전히 History API 기반이다. 방향으로 알아 둘 가치가 있다.

### Suspense 프로토콜의 정체 — "던져진 Promise"

lazy가 쓰는 "렌더 중 Promise throw"는 공개 프로토콜이 아니라 React 내부 관례였고, 데이터 라이브러리들이 이를 역공학해 쓰면서 사실상 표준이 되었다. React 19의 `use(promise)`가 이를 공식 API로 정리한 것이다 — 렌더 중 `use`에 미이행 Promise를 주면 같은 Suspense 동작이 일어난다. 주의점도 같은 원리에서 나온다: 렌더는 재시도되므로 **렌더 중 만든 Promise를 그대로 use에 주면 재시도마다 새 요청**이 된다. Promise는 렌더 밖(캐시, loader, 라이브러리)에서 만들어져 안정적으로 재사용돼야 하고, 그 캐시 계층이 바로 [5-8](./08-server-state.md)의 주제다.

## 정리

- SPA 라우팅 = `pushState`(URL 갱신, 문서 로드 없음, popstate 미발생) + `popstate`(사용자의 히스토리 이동 통지) + 클릭 가로채기. 신호가 비대칭이므로 앱 주도 이동은 직접, 사용자 주도 이동은 이벤트로 렌더를 트리거한다.
- 새로고침 404는 URL 공간의 소유자가 둘이 된 귀결이다 — 서버에 SPA fallback(모르는 경로 → index.html)을 설정하고, 개발 서버에는 내장이라 배포에서만 터진다는 점을 기억한다.
- React Router는 "URL도 상태"의 적용이다: URL 구독 → 라우트 매칭 → 요소 트리 계산 → 재조정. 중첩 라우트/Outlet의 상태 유지와 파괴는 전부 5-2의 위치·타입·key 규칙으로 설명된다.
- lazy는 등록, 최초 렌더 시도가 로딩 시작이다 — 미준비 서브트리는 Promise를 던져 가장 가까운 Suspense 경계가 fallback을 렌더한다. 경계 배치가 전환 UX를 결정한다.
- 분할의 기본 단위는 라우트(이동 경계 = 필요 경계)이고, 대가인 이동 시 왕복은 의도 신호 기반 프리로딩으로 완화한다.

## 확인 문제

**Q1.** 직접 만든 미니 라우터에서 `navigate()` 함수가 `history.pushState(null, '', url)`만 호출하고 끝난다. 링크 클릭 시 주소창은 바뀌는데 화면이 안 바뀌고, 뒤로 가기를 하면 그제야 화면이 바뀐다. 두 증상을 각각 설명하라.

<details>
<summary>정답과 해설</summary>

증상 1(클릭 시 화면 불변): `pushState`는 URL과 히스토리 스택만 바꾸고 **popstate를 발생시키지 않으며** 렌더와 무관하다. 앱 주도 이동은 앱이 직접 렌더를 트리거해야 하는데(`render(location.pathname)` 호출 누락) 그 조각이 빠졌다. 증상 2(뒤로 가기에서 화면 변경): 뒤로 가기는 사용자 주도 히스토리 이동이므로 popstate가 발생하고, 등록해 둔 popstate 리스너가 렌더를 트리거한다 — 이동의 비대칭(앱이 일으킨 이동은 앱이 알고, 사용자가 일으킨 이동만 이벤트로 온다)이 두 증상의 공통 원인이다. 수정: navigate에서 pushState 후 렌더 함수를 직접 호출한다.
</details>

**Q2.** `/products?category=shoes&page=3`에서 카테고리 필터를 바꿀 때마다 `navigate()`(기본 push)로 URL을 갱신했다. QA에서 "필터를 다섯 번 바꾼 뒤 뒤로 가기를 누르면 이전 페이지가 아니라 직전 필터로 간다"는 리포트와 "필터 결과 화면을 동료에게 URL로 공유하면 잘 열린다"는 확인이 함께 왔다. 이 설계에서 잘한 점과 고칠 점을 URL 상태 모델로 설명하라.

<details>
<summary>정답과 해설</summary>

잘한 점: 필터를 컴포넌트 상태가 아니라 URL 쿼리 파라미터에 둔 것 — 공유·새로고침에서 같은 화면이 재현되는 것은 "새로고침·공유를 견뎌야 하는 상태는 URL에"(5-6)를 지킨 결과다.

고칠 점: 히스토리 스택 의미론. push는 "사용자의 의미 있는 위치"를 쌓는 연산인데, 필터 조작마다 push하면 스택이 필터 변경 로그가 되어 뒤로 가기가 "이전 페이지"라는 사용자 기대와 어긋난다. 같은 화면 안의 상태 정련(필터, 정렬, 검색어 타이핑)은 `navigate(url, { replace: true })`로 현재 항목을 교체한다 — URL 계약(공유·새로고침)은 그대로 유지되면서 스택은 페이지 단위로 남는다. 기준: "뒤로 가기로 돌아갈 가치가 있는 위치인가"가 push/replace의 판단선이다.
</details>

**Q3.** 라우트 단위 lazy 분할을 적용했더니 Lighthouse의 초기 로드 점수는 올랐는데, 사용자 리서치에서 "메뉴를 누르면 한 박자 늦게 열린다"는 불만이 늘었다. 무엇을 얻고 무엇을 지불한 것인지 설명하고, 지불을 줄이는 조치 두 가지와 각각의 검증 방법을 제시하라.

<details>
<summary>정답과 해설</summary>

얻은 것: 초기 번들에서 다른 라우트의 코드가 빠져 첫 화면까지의 다운로드·파싱이 줄었다(Lighthouse 개선). 지불한 것: 분할은 이동 시점에 순차 의존(클릭 → 청크 요청 → 다운로드·파싱 → 렌더)을 만들므로, 이동마다 네트워크 왕복이 체감 지연으로 들어왔다 — 총 비용이 준 게 아니라 지불 시점이 "처음 한 번"에서 "이동할 때마다"로 옮겨진 것이다.

조치: ① 의도 신호 프리로딩 — `Link`의 hover/focus에서 해당 라우트의 `import()`를 미리 발사한다. hover에서 클릭까지 수백 ms의 선행 시간이 왕복을 흡수한다. 검증: DevTools Network 패널에서 hover 시점에 청크 요청이 시작되고 클릭 시점엔 완료(캐시 적중)되는지 녹화로 확인. ② Suspense 경계를 라우트 콘텐츠 영역으로 좁혀 레이아웃(헤더·내비)은 유지시키고, 남는 지연은 fallback을 스피너 대신 스켈레톤으로 — 지연의 크기가 아니라 체감을 줄인다. 추가로 로딩이 빠른 경우(수십 ms)의 fallback 깜빡임은 transition 기반 내비게이션(이전 화면 유지)으로 없앨 수 있다. 검증: Performance 패널로 클릭→콘텐츠 표시 구간을 전/후 비교.
</details>

## 참고 자료

- [WHATWG HTML — Session history and navigation](https://html.spec.whatwg.org/multipage/nav-history-apis.html) — pushState/popstate의 규범적 동작. popstate 발생 조건의 1차 자료.
- [MDN — Working with the History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API) — History API 실무 정리.
- [React Router 공식 문서](https://reactrouter.com/) — 라이브러리 모드의 라우트 정의, loader, lazy 옵션. 이 문서의 React Router 7 기준 근거.
- [react.dev — lazy](https://react.dev/reference/react/lazy) / [Suspense](https://react.dev/reference/react/Suspense) — 팩토리 호출 시점, fallback 동작, 경계 배치의 공식 문서.
- [MDN — Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API) — popstate 모델의 후계 표준. 지원 현황 확인용.
