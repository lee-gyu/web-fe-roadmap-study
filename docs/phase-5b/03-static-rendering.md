# 5b-3. Static Rendering

> 한 줄 요약: 정적 렌더링은 요청 전에 data snapshot을 HTML·관련 payload라는 배포 artifact로 고정해 request compute를 없애는 대신, 신선도와 route cardinality 비용을 build·release로 옮긴다.

이 문서는 2026년 7월 11일에 확인한 React 19 계열의 `react-dom/static` 안정 API를 기준으로 한다. 특정 framework의 static/dynamic 자동 판정은 [8-6 Next.js와 RSC](../phase-8/06-nextjs-and-rsc.md)로 넘긴다.

## 학습 목표

- build data snapshot부터 route enumeration, prerender, CDN 전달까지의 타임라인을 설명할 수 있다.
- SSG와 `renderToStaticMarkup`을 HTML 생성 시점·상호작용 계약으로 구분할 수 있다.
- route 수와 data dependency가 build lead time·실패 범위·rollback에 미치는 비용을 분석할 수 있다.
- 공통 static 본문과 client/request-time 개인화 영역을 권한·layout·waterfall 기준으로 분리할 수 있다.
- production artifact와 원본 data version을 사용해 요청 시 application render가 없음을 검증할 수 있다.

## 배경: 왜 이것이 존재하는가

법률 문서, 제품 설명, 기술 글처럼 한 번 게시한 뒤 많은 사용자가 같은 내용을 읽는 route를 요청마다 다시 렌더할 이유는 적다. data 변경 빈도보다 요청 빈도가 훨씬 높다면 계산을 build로 한 번 당기고 결과를 정적 file로 배포할 수 있다. 이를 정적 렌더링(static rendering) 또는 SSG(Static Site Generation)라 부른다.

정적 렌더링의 강점은 단지 평균 TTFB가 작다는 데 있지 않다.

- origin application process가 없어도 CDN/object storage가 응답할 수 있다.
- 동일 bytes를 많은 사용자에게 공유해 cache hit ratio를 높인다.
- request마다 DB·React가 실행되지 않아 capacity와 장애면이 작다.
- content artifact와 application code를 한 release로 rollback할 수 있다.

대신 data는 build 시점의 snapshot이다. 잘못된 가격을 고쳤어도 새 artifact가 생성·배포되기 전까지 응답은 바뀌지 않는다. 정적 렌더링은 신선도 문제를 제거한 것이 아니라 publish pipeline으로 이동시킨다.

## 핵심 개념

### build와 request의 시간선을 분리한다

```text
build
  → content/data snapshot 읽기(version 41)
  → route 목록 계산
  → route별 React prerender
  → HTML + CSS + client JS + optional payload 생성
  → immutable artifact 배포

request
  → CDN/browser cache lookup
  → artifact hit
  → first byte / HTML parse and paint
  → 필요한 client JavaScript download
  → interactive 영역 hydration
```

request path에는 application data read와 React server render가 없다. 그렇다고 page 전체가 상호작용 없는 HTML이라는 뜻은 아니다. build에서 만든 HTML 안에 client component의 bootstrap module을 포함하면 browser는 그 영역을 hydrate할 수 있다.

### React static API는 artifact 생성의 한 계층이다

현재 React는 Web Stream용 `prerender`, Node stream용 `prerenderToNodeStream`을 `react-dom/static`에서 제공한다. 다음은 Web Stream 결과를 build artifact로 소비하는 최소 구조다.

```tsx
// build-page.tsx — route 탐색과 file writer는 build tool의 책임이다.
import { prerender } from "react-dom/static";
import { ProductPage } from "./ProductPage";

export async function buildProductPage(product: Product) {
  const { prelude } = await prerender(<ProductPage product={product} />, {
    bootstrapModules: ["/assets/client.js"],
  });

  return new Response(prelude, {
    headers: { "content-type": "text/html; charset=utf-8" },
  }).text();
}
```

`prerender`는 Suspense-enabled data가 준비될 때까지 기다려 완성된 static HTML을 만든다. 점진적으로 사용자에게 stream하기 위한 API가 아니다. request 중 준비된 shell부터 보내려면 [5b-6 Streaming SSR](./06-streaming-server-side-rendering.md)의 server API를 사용한다.

production framework는 다음 작업도 함께 소유한다.

- route parameter를 열거하고 output path를 충돌 없이 만든다.
- hashed CSS/JavaScript asset manifest를 HTML에 연결한다.
- server/client initial props를 안전하게 직렬화한다.
- not-found, redirect, metadata, error route를 artifact로 표현한다.
- content hash와 cache header를 배포 topology에 맞춘다.

따라서 React API 하나를 호출했다고 SSG system이 완성되는 것은 아니다.

### SSG와 `renderToStaticMarkup`은 이름의 “static”만 같다

| 구분 | SSG/static rendering 전략 | `renderToStaticMarkup` API |
|---|---|---|
| 핵심 질문 | 언제 route artifact를 생성·배포하는가 | React tree를 어떤 HTML 문자열로 바꾸는가 |
| 실행 시점 | 보통 build | build 또는 server utility 어느 때나 가능 |
| hydration | bootstrap을 포함하면 가능 | output은 hydrate할 수 없는 non-interactive HTML |
| 대표 용도 | 문서·페이지 배포 | email, 완전 정적 fragment |
| cache/release | 필수 설계 대상 | API 자체는 결정하지 않음 |

정적 생성된 페이지에도 장바구니 button과 client JavaScript가 있을 수 있다. 반대로 request마다 `renderToStaticMarkup`을 호출하면 output은 non-interactive지만 전략은 request-time rendering이다. API 이름이 계산 시점과 배포 방식을 대신 결정하지 않는다.

### artifact는 data version을 포함한 materialized snapshot이다

build가 content version 41을 읽었다면 HTML, RSC payload, search index, image metadata가 모두 같은 version을 가리키는지 확인해야 한다.

```text
source version 41
  ├─ /products/a/index.html  (41)
  ├─ /products/b/index.html  (41)
  ├─ route payload           (41)
  └─ search index            (41)
```

build 중 source가 42로 바뀌어 일부 route만 새 값을 읽으면 release 내부가 찢어진다. 가능한 대안은 immutable content revision을 입력으로 고정하거나, snapshot/transaction을 사용하거나, build 시작 시 version을 pin하는 것이다. artifact에 `data-version`과 build commit을 기록하면 응답이 어느 snapshot인지 관찰할 수 있다.

### route cardinality가 커지면 request 비용이 build 비용으로 돌아온다

route 수를 `N`, route 하나의 평균 data/render 시간을 `R`이라 하면 단순 직렬 build는 대략 `N × R`에 비례한다. 실제 build는 병렬화·공통 data cache로 줄일 수 있지만 다음 경계에서 급격히 무너진다.

- 사용자 생성 URL이 사실상 무한하다.
- 모든 locale·tenant·filter 조합을 route로 전개한다.
- CMS/DB가 build fan-out 요청을 감당하지 못한다.
- route 하나의 실패가 전체 atomic release를 막는다.
- 작은 content 수정에도 모든 route를 다시 만든다.

이때 선택지는 일부 long-tail route를 request-time으로 돌리거나, on-demand generation/재생성을 사용하거나, build graph를 증분화하는 것이다. [5b-4 ISR](./04-incremental-static-generation.md)은 그중 배포 이후 static result를 생성·갱신하는 모델을 다룬다.

### static 본문과 동적 slice를 조합할 수 있다

상품 route를 page 약어 하나로 부르지 않고 영역별로 본다.

| 영역 | 요구 | 가능한 배치 | 주의할 비용 |
|---|---|---|---|
| 이름·설명·이미지 | 공개, 변경 낮음 | static HTML | publish 뒤 stale |
| 가격·재고 | 변경 높음 | 짧은 cache/SSR/client fetch | 일관성·layout shift |
| 로그인 인사 | 사용자별 | request boundary/client fetch | shared cache 누출 |
| 장바구니 button | 즉시 interaction | client component | JS·hydration |
| 리뷰 | 느리고 독립 | static snapshot 또는 stream | freshness·오류 격리 |

client-fetched slice는 정적 본문을 유지하지만 request waterfall과 loading UI를 만든다. 가격 공간을 예약하지 않으면 layout shift가 생기고, HTML에 임시 가격을 넣으면 사용자에게 오래된 값이 의사결정 근거로 보일 수 있다. stale을 허용할 수 없는 값은 “나중에 client가 고친다”보다 처음부터 명확한 loading/availability 상태로 분리한다.

권한 data를 static artifact에 포함해서는 안 된다. build environment가 읽을 수 있다는 것과 모든 사용자에게 배포해도 된다는 것은 전혀 다른 조건이다.

### HTTP cache와 immutable deployment를 구분한다

hashed asset은 내용이 바뀌면 URL도 바뀌므로 장기 immutable cache에 적합하다. `/products/a` HTML은 같은 URL의 내용이 새 release에서 바뀔 수 있으므로 짧은 freshness, validation, atomic routing 같은 별도 정책이 필요하다.

```text
/assets/app.a1b2.js  → content-addressed, long immutable cache
/products/a         → stable URL, release switching/validation 필요
```

CDN hit이 빠르다는 사실만으로 최신 release가 모든 POP에 반영되었다고 단정할 수 없다. 배포 전환·purge·browser cache의 범위는 hosting platform의 공식 계약과 response header로 확인한다.

## 실무 관점

### 정적 렌더링이 강한 조건

- 많은 사용자가 같은 공개 representation을 읽는다.
- publish cadence가 request cadence보다 훨씬 느리다.
- route 집합을 유한하게 계산하거나 중요 route만 미리 만들 수 있다.
- stale 허용 시간이 release lead time보다 길다.
- origin 장애 중에도 기존 읽기 경험을 유지할 가치가 있다.

문서, 마케팅, 블로그, 정책, 제품 설명이 대표적이다. 요청별 권한·초 단위 가격·무한 검색 조합을 route artifact로 모두 만들려 하면 model이 무너진다.

### build 성공은 content correctness까지 의미해야 한다

HTML file이 생성되었다는 것만으로 완료하지 않는다.

- route별 source version과 locale을 기록한다.
- 깨진 internal link와 metadata를 검증한다.
- client bootstrap이 참조하는 hashed asset이 같은 release에 있는지 확인한다.
- partial upload가 노출되지 않도록 atomic publish/rollback을 사용한다.
- source outage 때 이전 artifact를 유지할지 release를 실패시킬지 정한다.

### 관찰 실험

content version을 `41 → 42`로 바꿀 수 있는 fixture를 사용한다.

1. version 41로 production build하고 route HTML·asset manifest·build log를 보존한다.
2. static server를 시작한 뒤 application render log가 request마다 늘지 않는지 확인한다.
3. source를 42로 바꾸되 rebuild하지 않고 같은 URL을 요청한다.
4. HTML과 화면이 계속 41인지 확인한다.
5. rebuild·atomic deploy 후 HTML, optional payload, 화면이 함께 42로 바뀌는지 확인한다.
6. JavaScript를 비활성화해 static 본문과 client-only 개인화 영역의 차이를 기록한다.
7. Network에서 document, JS, client data request의 cache header와 initiator를 분리한다.

이 실험은 “정적이면 자동으로 최신”이라는 오해를 제거한다. version 42가 rebuild 전에 보였다면 client fetch, service worker, CDN rewrite 같은 다른 계층이 개입했는지 찾는다.

### 선택 체크리스트

- 모든 사용자에게 같은 HTML이어도 되는 영역은 무엇인가?
- 허용 stale window가 build+deploy lead time보다 긴가?
- route 수와 locale/tenant 조합이 build budget 안에 있는가?
- build가 읽는 data revision을 하나로 고정할 수 있는가?
- HTML·payload·asset·index가 atomic release로 전환되는가?
- 동적 slice가 권한 data를 static artifact에 누출하지 않는가?
- client fetch가 추가하는 waterfall·layout shift·오류 상태를 설계했는가?
- long-tail route만 SSR/ISR로 넘기는 편이 더 단순한가?
- rollback 시 content와 code가 함께 호환되는가?

## 정리

- 정적 렌더링은 React/data 계산을 request 전 build로 옮겨 HTML·payload를 배포 artifact로 만든다.
- 정적으로 만든 HTML도 client code를 포함해 hydrate할 수 있으며, `renderToStaticMarkup`의 non-interactive output과는 다른 개념이다.
- 빠른 cache hit와 낮은 request compute의 대가는 snapshot 신선도, build cardinality, publish·rollback 책임이다.
- page 전체를 고정하지 않고 static 본문과 개인화·고신선도·interaction slice를 조합할 수 있다.
- correctness는 source version, artifact 묶음, cache header, atomic deployment 증거로 검증한다.

## 확인 문제

**Q1.** 정적으로 생성한 상품 페이지에 React 장바구니 button이 있다. “정적 페이지이므로 hydration이 없다”는 설명이 왜 틀렸는가?

<details>
<summary>정답과 해설</summary>

정적은 HTML 생성 시점을 뜻한다. build artifact에 client bootstrap과 해당 component code가 포함되면 browser는 기존 HTML을 hydrate한다. non-interactive `renderToStaticMarkup`과 SSG 전략을 구분해야 한다.
</details>

**Q2.** CMS 글 하나를 고칠 때 50만 route 전체 build가 필요해 release가 수 시간 걸린다. 어떤 경계가 무너졌고 대안은 무엇인가?

<details>
<summary>정답과 해설</summary>

route cardinality와 작은 변경의 invalidation 범위가 static full-build budget을 넘었다. 변경 graph에 따른 증분 build, 중요 route만 prerender하고 long-tail은 on-demand 생성, ISR, request-time render를 비교한다. 단, 새 전략의 first miss와 stale/failure 계약도 함께 소유해야 한다.
</details>

**Q3.** 공개 본문은 static이고 사용자 할인 가격만 client에서 가져오려 한다. 보안과 UX에서 확인할 것은 무엇인가?

<details>
<summary>정답과 해설</summary>

할인 가격과 credential이 static HTML/build log에 포함되지 않아야 하고 API가 server-side authorization을 다시 수행해야 한다. UI에는 가격 공간과 loading/error 상태를 두고 오래된 공통 가격을 확정 가격처럼 보이지 않게 한다. client fetch waterfall이 요구 latency를 만족하지 않으면 request-time private boundary를 검토한다.
</details>

## 참고 자료

- [React — Static React DOM APIs](https://react.dev/reference/react-dom/static) — Web/Node static API와 experimental resume 계열의 상태를 구분한다. (2026-07-11 확인)
- [React — `prerender`](https://react.dev/reference/react-dom/static/prerender) — static HTML 생성, Suspense data 대기, hydration bootstrap 계약을 확인한다. (2026-07-11 확인)
- [React — `renderToStaticMarkup`](https://react.dev/reference/react-dom/server/renderToStaticMarkup) — hydrate할 수 없는 HTML output의 제한과 email 같은 용도를 확인한다. (2026-07-11 확인)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111) — freshness, validation, shared cache 동작을 확인한다. (2026-07-11 확인)
- [Patterns.dev — Static Rendering](https://www.patterns.dev/react/static-rendering/) — static rendering의 문제 지형과 장단점을 위한 2차 자료다. (2026-07-11 확인)

