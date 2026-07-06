# 8-5. 렌더링 전략

> 한 줄 요약: 이 문서를 읽고 나면 CSR, SSR, SSG, ISR, 스트리밍 SSR이 계산 위치와 캐시 가능성, TTFB, LCP, INP, 하이드레이션 비용을 어떻게 교환하는지 판단할 수 있다.

이 문서는 web.dev의 Rendering on the Web 문서와 React 19.2의 hydration·streaming server rendering 문서를 기준으로 한다. Next.js 같은 프레임워크의 구체 API는 [8-6 Next.js와 RSC](./06-nextjs-and-rsc.md)에서 다루고, 이 문서에서는 렌더링 전략을 선택하는 공통 비용 모델에 집중한다.

## 학습 목표

- CSR, SSR, SSG, ISR을 HTML 생성 시점, 데이터 신선도, 캐시 가능성, 클라이언트 JavaScript 비용으로 비교할 수 있다.
- 하이드레이션(hydration)이 서버 HTML을 인터랙티브한 React 앱으로 전환하는 과정이며, LCP 개선과 INP 악화가 동시에 생길 수 있음을 설명할 수 있다.
- 스트리밍 SSR과 Suspense 경계가 TTFB 이후의 HTML 전달과 렌더링 지연을 어떻게 줄이는지 설명할 수 있다.
- 페이지 특성에 따라 렌더링 전략을 섞는 하이브리드 접근을 설계할 수 있다.
- 렌더링 전략 ADR에서 TTFB, LCP, INP, JS 번들, 캐시 무효화, 개인화 요구를 비교 축으로 삼을 수 있다.

## 배경: 왜 이것이 존재하는가

초기 웹은 서버가 HTML을 만들고 브라우저가 표시하는 구조였다. SPA가 보편화되면서 많은 렌더링 로직이 클라이언트로 이동했다. CSR은 배포와 상태 전환을 단순하게 만들었지만, 초기 HTML이 빈 shell에 가까워지고 JavaScript 다운로드·실행 전에는 주요 콘텐츠가 보이지 않는 문제가 커졌다.

그 뒤 프레임워크들은 다시 서버 렌더링을 도입했다. 그러나 이것은 단순한 회귀가 아니다. 현대 렌더링 전략은 다음 질문의 조합이다.

```text
HTML은 언제 만들어지는가?       빌드 시점, 요청 시점, 클라이언트 시점
데이터는 얼마나 신선해야 하는가?  정적, 주기적 갱신, 요청별 개인화
상호작용은 어디서 시작되는가?    서버 HTML, hydration, client state
캐시는 어디에 둘 수 있는가?      CDN, 서버, route, data, browser
```

렌더링 전략은 "SSR이 빠르다" 같은 단일 문장으로 고를 수 없다. SSR은 HTML을 빨리 보여 줄 수 있지만 서버 계산과 TTFB를 늘릴 수 있다. CSR은 서버를 단순하게 만들지만 클라이언트 CPU와 네트워크에 비용을 보낸다. SSG는 캐시에 강하지만 개인화와 실시간성이 어렵다. ISR은 정적 캐시와 신선도 사이에 타협점을 만들지만 stale content와 재검증 복잡도를 만든다.

이 문서는 렌더링 전략을 **계산을 어디로 옮기는가**의 문제로 다룬다.

## 핵심 개념

### 렌더링 전략은 HTML 생성 시점으로 먼저 나눈다

| 전략 | HTML 생성 시점 | 데이터 신선도 | 캐시 가능성 | 클라이언트 JS 필요 |
|---|---|---|---|---|
| CSR | 브라우저 실행 시점 | 클라이언트 fetch 기준 | HTML shell은 캐시 쉬움 | 높음 |
| SSR | 요청 시점 | 요청마다 최신·개인화 가능 | 응답별로 달라져 제한적 | hydration이 필요하면 높음 |
| SSG | 빌드 시점 | 빌드 당시 데이터 | CDN 캐시 매우 강함 | 상호작용 부분만 필요 |
| ISR | 빌드 또는 재검증 시점 | TTL/trigger 기준 | CDN/서버 캐시 강함 | 상호작용 부분만 필요 |
| Streaming SSR | 요청 중 chunk 단위 | 요청 기준 | 경계별 캐시와 조합 가능 | hydration 경계에 따라 다름 |

이 표의 핵심은 "어디가 빠른가"가 아니라 "어디에 비용을 냈는가"다. 같은 화면도 요구사항에 따라 다른 전략이 맞는다.

```text
마케팅 랜딩: 자주 안 바뀌고 모두에게 같음 → SSG
상품 상세: 대부분 같지만 재고/가격은 갱신 필요 → ISR + 일부 동적 데이터
사용자 대시보드: 개인화와 권한이 강함 → SSR 또는 서버 컴포넌트 기반 동적 렌더링
드로잉 툴: 초기 SEO보다 긴 상호작용이 중요 → CSR 중심
뉴스 홈: 최신성은 필요하지만 초 단위 실시간은 아님 → ISR 또는 edge cache SSR
```

### CSR은 서버를 단순하게 만들고 클라이언트에 비용을 보낸다

CSR(Client-Side Rendering)은 서버가 대개 HTML shell과 JavaScript 번들을 제공하고, 브라우저가 데이터를 가져와 DOM을 만든다.

```html
<!doctype html>
<meta charset="utf-8" />
<div id="root"></div>
<script type="module" src="/src/App.jsx"></script>
```

장점:

- 정적 호스팅과 CDN 배포가 쉽다.
- 로그인 후 복잡한 상태 전환과 클라이언트 라우팅이 자연스럽다.
- 서버 렌더링 인프라가 필요 없다.
- 같은 app shell을 캐시하면 재방문이 빠를 수 있다.

비용:

- 첫 HTML에 주요 콘텐츠가 없을 수 있다.
- JavaScript 다운로드·파싱·실행이 LCP와 INP를 압박한다.
- API waterfall이 생기기 쉽다.
- crawler와 link preview가 빈 shell을 볼 수 있다.
- 저사양 모바일에서 hydration보다도 더 늦게 첫 콘텐츠가 나올 수 있다.

CSR이 맞는 조건은 "초기 콘텐츠보다 상호작용 앱 자체가 핵심"인 경우다. 예를 들어 내부 운영 도구, 에디터, 캔버스 앱, 로그인 뒤 대시보드처럼 SEO와 공유 가능한 HTML보다 세션 중 상호작용이 중요한 앱은 CSR이 여전히 합리적이다.

그러나 공개 콘텐츠 페이지를 CSR로만 만들면 LCP resource load delay가 구조적으로 커질 수 있다. HTML이 콘텐츠를 설명하지 않기 때문에 브라우저는 JavaScript를 실행해야 LCP 후보를 발견한다.

### SSR은 HTML을 요청 시점에 만들고 hydration 비용을 남긴다

SSR(Server-Side Rendering)은 요청마다 서버가 React tree를 HTML로 렌더링해 보낸다. 브라우저는 HTML을 즉시 파싱하고 화면에 그릴 수 있다.

```text
request
  → 서버에서 데이터 조회
  → React tree를 HTML로 렌더링
  → HTML 응답
  → 브라우저 parse/paint
  → JS 다운로드
  → hydrateRoot로 이벤트와 상태 연결
```

장점:

- 첫 HTML에 주요 콘텐츠가 있어 FCP/LCP에 유리할 수 있다.
- SEO, link preview, no-JS fallback이 좋아진다.
- 요청별 personalization이 가능하다.
- 클라이언트에서 초기 data fetching waterfall을 줄일 수 있다.

비용:

- 서버 렌더링 시간이 TTFB에 들어간다.
- 트래픽이 많으면 서버 CPU와 메모리 비용이 커진다.
- 같은 UI를 서버와 클라이언트에서 모두 실행하는 중복 비용이 생긴다.
- hydration 전에는 화면이 보여도 상호작용하지 못하는 구간이 있다.
- 서버와 클라이언트 초기 렌더 결과가 다르면 hydration mismatch가 생긴다.

React의 `hydrateRoot`는 서버에서 만든 HTML에 React를 붙여 이벤트와 상태 관리를 이어받게 한다. 이때 React는 서버 HTML과 클라이언트 첫 렌더 결과가 같다고 기대한다. `Date.now()`, `Math.random()`, `window` 조건 분기, locale 차이, 서버와 클라이언트 데이터 차이는 mismatch를 만들 수 있다.

SSR은 LCP를 개선했지만 INP를 악화시킬 수 있다. 사용자는 화면을 빨리 보지만, 클라이언트 JS가 다운로드·실행되고 hydration이 끝나기 전에는 버튼이 눌리지 않거나 늦게 반응할 수 있다. 이것이 "보이는 것"과 "상호작용 가능한 것"의 차이다.

### SSG는 HTML을 빌드 시점에 만들고 캐시를 극대화한다

SSG(Static Site Generation)는 가능한 URL의 HTML을 빌드 때 미리 만든다. 배포 산출물은 정적 파일이다.

```text
build
  → 데이터 조회
  → /, /blog/a, /blog/b HTML 생성
  → CDN 배포

request
  → CDN edge에서 HTML 반환
```

장점:

- TTFB가 안정적으로 낮다.
- CDN 캐시와 잘 맞는다.
- 서버 렌더링 런타임 장애면이 작다.
- 콘텐츠 중심 페이지와 문서 사이트에 좋다.

비용:

- 데이터는 빌드 시점 기준이다.
- URL 수가 많으면 빌드 시간이 길어진다.
- 개인화가 어렵다.
- 자주 바뀌는 데이터에는 재배포 또는 별도 client fetch가 필요하다.

SSG는 "정적"이라는 말 때문에 낮게 평가되기도 하지만, 공개 콘텐츠 페이지에는 강력한 기본값이다. 문서, 블로그, 마케팅 페이지, 제품 소개, 정책 페이지처럼 많은 사용자가 같은 HTML을 보는 화면은 SSG가 캐시와 운영 단순성에서 유리하다.

### ISR은 정적 캐시와 데이터 신선도 사이의 타협이다

ISR(Incremental Static Regeneration)은 정적 HTML을 캐시하되, 일정 시간이나 특정 이벤트 뒤에 다시 생성한다. 프레임워크마다 구현은 다르지만 모델은 같다.

```text
첫 요청 또는 빌드
  → HTML 생성 후 캐시

다음 요청
  → 캐시 HTML 반환

재검증 조건 충족
  → 백그라운드 또는 요청 경로에서 새 HTML 생성
  → 캐시 교체
```

장점:

- 대부분의 요청은 정적 캐시처럼 빠르다.
- 데이터가 완전히 고정되지 않아도 된다.
- 대규모 URL을 모두 빌드하지 않아도 된다.

비용:

- stale content를 허용해야 한다.
- 재검증 중 사용자에게 어떤 버전을 보여 줄지 정책이 필요하다.
- 캐시 무효화와 tag/path 설계가 복잡해진다.
- 요청별 개인화에는 제한적이다.

ISR은 상품 상세, 블로그, 뉴스, 문서처럼 "몇 초~몇 분 늦어도 되지만 매번 서버 렌더링하기는 아까운" 페이지에 잘 맞는다. 재고 수량이나 사용자별 가격처럼 stale 허용이 어려운 데이터는 별도 동적 API나 서버 렌더링 경계로 분리해야 한다.

### 하이드레이션은 HTML을 앱으로 전환하는 비용이다

하이드레이션(hydration)은 서버가 보낸 HTML을 버리지 않고, 클라이언트 React가 같은 tree를 렌더해 이벤트 핸들러와 상태를 연결하는 과정이다.

```text
서버 HTML: <button>Buy</button>
클라이언트 JS: function Button() { return <button onClick={buy}>Buy</button>; }
hydration: 기존 DOM을 재사용하고 click handler를 연결
```

이 과정은 "공짜 상호작용"이 아니다.

- 컴포넌트 코드가 클라이언트로 전송되어야 한다.
- React가 클라이언트에서 첫 렌더를 수행해야 한다.
- 서버 HTML과 결과가 일치해야 한다.
- 이벤트 핸들러와 상태가 연결되어야 한다.
- 큰 tree일수록 main thread를 점유할 수 있다.

SSR + hydration의 함정은 사용자가 화면을 보고 "준비됐다"고 느끼는 순간과 실제 이벤트가 처리 가능한 순간이 다를 수 있다는 점이다. 이 격차가 크면 LCP는 좋고 INP는 나쁜 페이지가 된다.

하이드레이션 비용을 줄이는 방향:

- 정말 상호작용이 필요한 컴포넌트만 클라이언트 JS를 보낸다.
- route와 component 단위로 코드를 분할한다.
- 서버에서만 렌더 가능한 콘텐츠는 클라이언트 번들에서 제외한다.
- Suspense와 streaming으로 느린 데이터 경계를 분리한다.
- below-the-fold 상호작용은 늦게 로드한다.

React Server Components와 islands 계열 접근은 모두 이 문제를 다른 방식으로 줄이려는 시도다. RSC는 8-6에서 다룬다.

### 스트리밍 SSR은 HTML을 준비된 경계부터 보낸다

전통적인 SSR은 서버가 전체 HTML을 만들 때까지 응답을 기다릴 수 있다.

```text
데이터 A 대기
데이터 B 대기
전체 HTML 생성
응답 시작
```

스트리밍 SSR은 준비된 부분부터 HTML chunk를 보낸다.

```text
shell HTML 생성 → 즉시 flush
데이터 A 완료 → A 영역 HTML flush
데이터 B 완료 → B 영역 HTML flush
```

React의 streaming server rendering API는 Suspense 경계와 함께 느린 부분을 분리할 수 있다.

```jsx
import { Suspense } from "react";

export default function Page() {
  return (
    <main>
      <Hero />
      <Suspense fallback={<RelatedSkeleton />}>
        <RelatedProducts />
      </Suspense>
    </main>
  );
}
```

사용자는 shell과 Hero를 먼저 볼 수 있고, RelatedProducts는 데이터가 준비되면 이어서 나타난다. 이 전략은 TTFB 이후 첫 paint와 LCP를 개선할 수 있다. 하지만 fallback과 실제 콘텐츠의 크기가 크게 다르면 CLS가 생길 수 있고, 경계가 너무 많으면 데이터·HTML·JS 조각이 복잡해진다.

스트리밍은 "느린 것을 숨긴다"가 아니다. 중요한 콘텐츠와 덜 중요한 콘텐츠의 경계를 명시해, 먼저 보낼 수 있는 것을 먼저 보내는 전략이다.

## 실무 관점

### 페이지 단위로 전략을 섞는다

하나의 애플리케이션 전체에 CSR 또는 SSR 하나만 고르는 시대는 지났다. 같은 제품 안에서도 페이지별로 다르게 고른다.

| 화면 | 추천 전략 | 이유 | 경계 조건 |
|---|---|---|---|
| 마케팅 랜딩 | SSG | 모두에게 같은 콘텐츠, CDN 캐시 극대화 | 실시간 캠페인 상태는 별도 API |
| 블로그/문서 | SSG 또는 ISR | SEO와 공유가 중요, 업데이트 빈도 낮음 | 댓글·조회수는 client island |
| 상품 목록 | ISR + client filter | 캐시 가능한 목록과 클라이언트 상호작용 분리 | 개인화 가격이면 SSR 필요 |
| 상품 상세 | ISR 또는 SSR | SEO/LCP 중요, 일부 데이터 신선도 필요 | 재고·권한별 가격 분리 |
| 사용자 대시보드 | SSR 또는 CSR | 개인화·권한·로그인 상태 강함 | SEO보다 보안·데이터 신선도 |
| 편집기/캔버스 | CSR | 상호작용 앱 자체가 핵심 | 초기 shell과 lazy loading 관리 |

전략 선택은 URL 전체보다 영역 단위로 더 잘게 나뉠 수 있다. 페이지 shell은 서버에서 만들고, 검색 필터는 클라이언트 컴포넌트로 두며, 추천 영역은 스트리밍 경계로 늦게 보낼 수 있다.

### 렌더링 전략 ADR은 지표와 운영 비용을 같이 적는다

ADR 예시 항목:

| 항목 | 질문 |
|---|---|
| 사용자 경험 | LCP가 중요한가, INP가 중요한가, no-JS 접근성이 필요한가 |
| 데이터 | 빌드 시점, 요청 시점, 사용자별 데이터 중 무엇인가 |
| 캐시 | CDN에서 얼마나 오래 재사용할 수 있는가 |
| 서버 비용 | 요청마다 렌더링해도 되는 트래픽인가 |
| 클라이언트 비용 | hydration JS가 얼마나 큰가 |
| 보안 | 비밀 값과 권한 검증이 어디서 필요한가 |
| 운영 | 재검증 실패, 배포 rollback, cache purge 절차가 있는가 |

결정 예:

```text
상품 상세 페이지는 ISR을 기본으로 한다.

근거:
- SEO와 LCP가 중요하므로 HTML에 상품명, 이미지, 설명을 포함한다.
- 상품 정보는 5분 stale을 허용할 수 있다.
- 재고와 사용자별 할인은 stale 허용이 어렵기 때문에 클라이언트 fetch 또는 동적 서버 경계로 분리한다.
- CSR은 LCP resource discovery가 늦고, SSR은 트래픽 대비 서버 비용이 크다.

재검토 조건:
- 가격이 사용자별로 강하게 달라진다.
- 재고 정확성이 법적/결제 문제로 이어진다.
- p75 LCP가 ISR에서도 목표를 넘는다.
```

### SEO는 렌더링 전략의 한 축일 뿐이다

서버 HTML은 crawler와 link preview에 유리하다. 하지만 SEO 때문에 모든 것을 SSR로 만들 필요는 없다. SSG도 완전한 HTML을 제공한다. 반대로 개인화 대시보드는 SEO가 거의 의미 없고, 보안과 상호작용이 중요하다.

SEO 판단에서도 질문을 나눈다.

- crawler가 초기 HTML에서 핵심 콘텐츠를 볼 수 있는가?
- canonical URL과 metadata가 서버 응답에 있는가?
- Open Graph 이미지와 제목이 공유 시점에 안정적인가?
- 콘텐츠가 사용자별로 달라 검색 노출 대상이 아닌가?
- JavaScript 실행에 의존해도 대상 crawler가 처리 가능한가?

SEO는 SSR을 자동 선택하게 만드는 키워드가 아니라, HTML 생성 시점과 metadata 제공 방식을 결정하는 요구사항이다.

## 더 깊이

### "보이는 HTML"과 "상호작용 가능한 앱"은 다른 완료 조건이다

SSR은 사용자가 볼 수 있는 HTML을 빨리 준다. 그러나 이벤트 핸들러가 연결되고 상태가 준비되기 전까지는 앱이 완전히 준비된 것이 아니다. 이 시간 차이는 다음 문제를 만든다.

- 사용자가 버튼을 눌렀지만 반응이 없다.
- hydration이 끝난 뒤 UI가 바뀌어 신뢰가 깨진다.
- mismatch 복구 때문에 main thread가 더 바빠진다.
- 서버 HTML에 있던 상태와 클라이언트 cache 상태가 다르다.

이 문제는 "SSR이 나쁘다"가 아니라 "SSR 이후의 클라이언트 작업이 전략의 일부다"라는 뜻이다. LCP만 보고 SSR 도입을 성공으로 판단하면 안 된다.

### static과 dynamic은 이분법이 아니라 cache key 문제다

정적 페이지처럼 보여도 일부 데이터는 동적일 수 있다. 동적 페이지처럼 보여도 대부분의 HTML은 캐시 가능할 수 있다.

```text
상품 상세:
  제품명, 설명, 이미지      → 캐시 가능
  추천 상품                 → 짧은 TTL
  장바구니 수량             → 사용자별 동적
  로그인 사용자 할인 가격   → 사용자별 동적
```

렌더링 전략은 페이지 전체가 아니라 데이터 조각의 cache key와 freshness를 봐야 한다. 프레임워크가 segment, boundary, component 단위 캐시를 제공하는 이유가 여기에 있다.

### progressive enhancement는 여전히 렌더링 전략의 기준점이다

인터랙션이 많은 앱이라도 핵심 읽기 경험과 form 제출이 JavaScript 없이 어느 정도 가능한지 검토할 가치가 있다. progressive enhancement는 과거의 유산이 아니라 장애와 성능의 fallback 전략이다.

- HTML 링크는 JS 라우터가 실패해도 이동한다.
- form은 서버 action 또는 route handler로 제출할 수 있다.
- 서버 HTML은 crawler와 preview가 이해한다.
- 클라이언트 JS는 향상된 상호작용을 붙인다.

모든 UI를 no-JS로 만들 수는 없다. 그러나 구매, 로그인, 검색, 문서 읽기 같은 핵심 경로에서 progressive enhancement를 고려하면 hydration 실패와 느린 네트워크에 더 강한 앱이 된다.

## 정리

- 렌더링 전략은 HTML을 빌드·요청·클라이언트 중 언제 만들지와, 데이터를 얼마나 신선하게 유지해야 하는지의 조합이다.
- CSR은 서버와 배포를 단순하게 만들지만 초기 콘텐츠와 클라이언트 CPU 비용을 브라우저에 보낸다.
- SSR은 초기 HTML과 SEO에 유리할 수 있지만 TTFB, 서버 비용, hydration 비용을 만든다.
- SSG와 ISR은 캐시 가능성이 높은 콘텐츠에 강하지만 개인화와 실시간성에서 경계가 있다.
- 하이드레이션과 스트리밍은 LCP와 INP를 동시에 고려해야 하며, 보이는 시점과 상호작용 가능한 시점을 분리해서 측정해야 한다.

## 확인 문제

1. 공개 상품 상세 페이지에서 CSR만 사용하면 LCP 관점에서 어떤 구조적 불리함이 생기는가?

<details>
<summary>정답과 해설</summary>

초기 HTML에 상품명, 주요 이미지, 설명이 없고 JavaScript 실행 후에야 콘텐츠와 LCP 후보 리소스가 발견될 수 있다. 따라서 resource load delay와 element render delay가 커지기 쉽다. SEO와 link preview도 불리할 수 있다. 상품 데이터가 캐시 가능하다면 SSG/ISR/SSR을 검토하는 것이 자연스럽다.

</details>

2. SSR을 도입했는데 LCP는 좋아졌지만 사용자가 버튼을 눌러도 반응이 늦다. 어떤 비용을 놓친 것인가?

<details>
<summary>정답과 해설</summary>

하이드레이션과 클라이언트 JavaScript 실행 비용을 놓친 것이다. SSR은 HTML을 먼저 보여 주지만, 이벤트 핸들러와 상태가 연결되기 전에는 앱이 완전히 상호작용 가능하지 않다. INP, TBT, hydration trace, JavaScript 번들 크기를 함께 봐야 한다.

</details>

3. SSG가 적합한 페이지와 SSR이 적합한 페이지를 가르는 핵심 질문은 무엇인가?

<details>
<summary>정답과 해설</summary>

요청마다 달라지는 데이터나 권한이 필요한가, stale content를 허용할 수 있는가, 가능한 URL을 미리 만들 수 있는가가 핵심이다. 모두에게 같은 콘텐츠이고 업데이트 빈도가 낮으면 SSG가 유리하다. 요청별 개인화, 인증, 실시간성이 강하면 SSR 또는 동적 서버 경계가 필요하다.

</details>

4. ISR을 선택할 때 반드시 문서화해야 하는 운영 조건은 무엇인가?

<details>
<summary>정답과 해설</summary>

stale 허용 시간, 재검증 트리거, 재검증 실패 시 보여 줄 버전, cache purge 절차, 개인화 데이터 분리 기준을 문서화해야 한다. ISR은 정적 캐시와 신선도 사이의 타협이므로, 어떤 데이터가 얼마나 오래 낡아도 되는지 합의가 필요하다.

</details>

## 참고 자료

- [web.dev: Rendering on the Web](https://web.dev/articles/rendering-on-the-web) — CSR, SSR, static rendering, hydration, streaming의 성능 trade-off를 비교한다.
- [React: hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot) — 서버가 만든 HTML에 React를 연결하는 hydration API와 mismatch 주의점을 설명한다.
- [React: renderToPipeableStream](https://react.dev/reference/react-dom/server/renderToPipeableStream) — React의 Node.js streaming server rendering API를 설명한다.
- [React: renderToReadableStream](https://react.dev/reference/react-dom/server/renderToReadableStream) — Web Streams 기반 streaming server rendering API를 설명한다.
- [Next.js: Rendering Philosophy](https://nextjs.org/docs/app/guides/rendering-philosophy) — Next.js가 렌더링 전략을 어떻게 조합하는지 확인할 수 있다.
- [Next.js: ISR guide](https://nextjs.org/docs/app/guides/isr) — Next.js에서 정적 생성과 재검증을 조합하는 ISR 모델을 확인할 수 있다.
