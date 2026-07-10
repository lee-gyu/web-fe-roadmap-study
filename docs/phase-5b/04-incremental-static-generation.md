# 5b-4. Incremental Static Generation

> 한 줄 요약: ISR은 정적 결과를 배포 뒤 필요할 때 생성·교체하는 read-model cache이며, invalidation을 새 결과 생성·전역 전파 완료와 구분해야 안전하게 운영할 수 있다.

ROADMAP의 제목은 Patterns.dev를 따라 Incremental Static Generation으로 유지한다. 다만 업계에서 ISR은 보통 Incremental Static **Regeneration**을 뜻하며, 이 문서도 이미 생성된 결과의 재생성을 포함한다. 이 기능은 React core API가 아니라 framework·hosting 계층의 정책이다.

이 문서는 2026년 7월 11일에 확인한 HTTP caching 표준과 Next.js 16 Cache Components 문서를 현재 framework 사례로 사용한다. Cache Components를 켜지 않은 previous model과 API를 한 예제 안에서 섞지 않는다.

## 학습 목표

- on-demand route generation과 기존 entry의 revalidation을 별도 기능으로 설명할 수 있다.
- cache entry를 missing·generating·fresh·stale·revalidating·error 상태로 모델링할 수 있다.
- time/path/tag invalidation을 data ownership과 stale 허용 범위에 맞게 선택할 수 있다.
- data cache, rendered route cache, CDN, browser/client router cache의 갱신 시점을 구분할 수 있다.
- regeneration 실패·동시 miss·전파 지연을 content version과 log로 검증할 수 있다.

## 배경: 왜 이것이 존재하는가

정적 렌더링은 request compute가 없고 cache에 강하지만 source가 바뀔 때 새 build가 필요하다. 모든 상품 URL을 미리 만들기 어렵거나, 글 발행 뒤 전체 site를 다시 배포하기에 route가 너무 많다면 build와 publish lead time이 freshness 요구를 넘는다.

ISR은 두 문제를 다룬다.

1. build에 없던 route를 첫 요청이나 명시적 작업에서 생성해 cache에 넣는다.
2. 이미 생성된 static result가 낡았을 때 time/event 조건으로 새 result를 만들어 교체한다.

대부분의 request는 static hit처럼 빠르게 처리하고, 생성 작업은 일부 request나 background worker가 부담한다. 이 모델은 materialized view와 닮았다. 원본 write가 성공한 시점과 read projection이 새 version을 보여 주는 시점 사이에 지연과 실패가 존재한다.

## 핵심 개념

### 생성과 재검증은 같은 상태 머신의 다른 진입점이다

일반 모델은 다음과 같다. 정확히 어떤 request가 기다리는지는 framework·hosting 계약으로 확인해야 한다.

```text
                first/on-demand generation
missing ───────▶ generating ───────────────▶ fresh(v41)
   │                 │ failure                    │ TTL/event
   └─ 404/error ◀────┘                            ▼
                                                  stale(v41)
                                                      │ request/invalidation
                                                      ▼
                                               revalidating(v41)
                                                 │           │
                                          success v42     failure
                                                 │           │
                                                 ▼           ▼
                                            fresh(v42)  stale(v41) or error
```

질문은 “ISR인가?”가 아니라 상태별 사용자 경험이다.

- missing에서 첫 request가 generation을 기다리는가, fallback을 받는가?
- stale entry가 있으면 즉시 v41을 주고 background refresh하는가?
- stale 허용 시간이 끝나면 새 결과를 기다리는가?
- regeneration 실패 때 v41을 계속 제공하는가, error를 내는가?
- 같은 key의 동시 request를 하나의 generation으로 합치는가?

이 계약 없이 “5분마다 갱신”이라고만 쓰면 5분 직후 사용자가 어느 version을 보는지 알 수 없다.

### HTTP SWR와 framework ISR은 계층을 공유할 수 있지만 동일하지 않다

HTTP `stale-while-revalidate`는 cache가 stale response를 일정 시간 제공하면서 비동기 validation을 수행할 수 있게 하는 response directive다. framework ISR은 data를 다시 읽고 React 결과와 관련 payload를 새 cache entry로 생성하는 application/platform 기능이다.

```text
HTTP cache: stored response를 validation/reuse
framework cache: data/function/route result를 다시 계산해 교체
```

framework가 HTTP header와 CDN을 사용해 구현할 수는 있지만, tag invalidation·route generation·RSC payload 일관성은 RFC가 제공하지 않는다. 반대로 framework cache를 invalidate했다고 외부 CDN의 복사본이 즉시 사라지는 것도 아니다.

### invalidation, regeneration, propagation은 세 사건이다

```text
CMS publish v42
  → tag/path invalidation accepted
  → old entry is stale/expired
  → next/background job reads v42
  → route HTML/payload generated
  → origin cache replaced
  → CDN POPs observe/purge/expire
  → browser/client router sees v42
```

CMS가 200 response를 받았다는 사실은 마지막 단계의 완료 증거가 아니다. correctness가 중요한 publish flow에는 event ID, content version, affected keys, generation result, POP/browser observation을 연결한다.

### time, path, tag는 서로 다른 소유권을 표현한다

| 방식 | 잘 맞는 조건 | 실패하기 쉬운 조건 |
|---|---|---|
| time-based | 변경 사건을 받을 수 없고 일정 stale을 허용 | 변경 직후 반드시 보여야 함 |
| path-based | 한 URL이 독립 data를 소유 | 같은 data가 목록·상세·홈에 중복됨 |
| tag/data-key | 여러 route가 같은 entity/query에 의존 | tag가 너무 넓거나 누락됨 |
| immediate expiry | read-your-own-writes가 필요 | 대량 동시 regeneration·stampede |

URL graph와 data dependency graph는 같지 않다. `product:42`가 `/products/42`, `/products`, `/sale`, sitemap에 나타난다면 상세 path 하나만 invalidate해서는 projection이 찢어진다. 반대로 모든 글 변경에 `all-content`를 invalidate하면 correctness는 단순해 보이지만 재생성 폭주와 hit ratio 하락을 만든다.

tag는 domain event와 cache entry 사이의 explicit dependency다. query filter·locale·tenant까지 key 일부인지 ADR에 기록한다.

### 현재 Next.js 예제는 Cache Components 모델을 고정한다

다음 조각은 Next.js 16에서 `cacheComponents: true`를 켠 현재 모델의 예시다. 독립 실행 React 예제가 아니라 framework adapter이며, 실제 배포는 self-host/managed cache topology를 별도로 확인해야 한다.

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
};

export default nextConfig;
```

```tsx
// app/products/data.ts
import { cacheLife, cacheTag } from "next/cache";

export async function getProduct(id: string) {
  "use cache";
  cacheTag(`product:${id}`);
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });

  return productRepository.findById(id);
}
```

```ts
// app/products/actions.ts
"use server";

import { revalidateTag, updateTag } from "next/cache";

export async function publishProduct(id: string, input: unknown) {
  const actor = await requireEditor();
  const command = parseProductInput(input);
  await productRepository.update(actor, id, command);

  // CMS 전체 사용자에게 약간 stale한 결과를 허용한다면 SWR 방식이다.
  revalidateTag(`product:${id}`, "max");
}

export async function updateMyDraft(id: string, input: unknown) {
  await updateAuthorizedDraft(id, input);

  // mutation 직후 작성자에게 새 결과가 필요한 read-your-own-writes 경로다.
  updateTag(`product:${id}`);
}
```

공식 문서에서 `revalidateTag(..., "max")`는 stale-while-revalidate semantics를, `updateTag`는 Server Action 안의 즉시 expiry를 설명한다. 이 이름을 다른 framework의 일반 보장으로 옮기지 않는다. Cache Components를 끈 previous model은 fetch cache와 route segment 설정이 다르므로 별도 실험으로 취급한다.

### cache topology를 한 상자로 그리지 않는다

```text
source DB/CMS
   │
   ▼
framework data/function cache
   │
   ▼
rendered route HTML/RSC cache
   │
   ▼
external CDN POP
   │
   ▼
browser HTTP cache ── client router cache
```

한 계층을 purge해도 아래 계층이 stale response를 갖고 있을 수 있다. Next.js 공식 CDN caching 가이드도 server의 on-demand revalidation이 별도 CDN copy를 자동 invalidate하지 않는 topology가 있음을 경고한다. managed hosting의 coordinated cache를 self-hosted multi-instance의 기본 보장으로 일반화하지 않는다.

multi-instance에서는 각 process의 memory cache만 invalidate하면 instance마다 다른 version을 제공한다. shared cache handler, durable tag index, deployment-wide message가 필요한지 platform 문서와 실제 log로 확인한다.

### 네 기본 전략을 같은 열로 비교한다

전략 이름보다 동일한 route의 cold request, warm cache, content change를 같은 조건에서 비교한다.

| 비교 축 | CSR | request-time SSR | SSG | ISR |
|---|---|---|---|---|
| HTML/data 생성 시점 | browser mount 뒤 data read | request server가 data read·render | build snapshot으로 prerender | build·first miss·재검증 때 생성 |
| cold/warm TTFB | static shell은 안정적, 내용과 별개 | data/render/cold start 포함 | CDN artifact hit이면 안정적 | hit은 정적과 유사, miss/expired는 생성 계약에 따름 |
| 핵심 HTML 존재 | JS·data 뒤 DOM에 생김 | 최초 response에 포함 가능 | artifact에 포함 | cached/generated artifact에 포함 |
| client JS/data waterfall | mount와 client fetch가 흔함 | hydration code, 초기 data는 snapshot 가능 | interactive 영역 code, 동적 slice fetch | SSG와 유사, freshness slice는 별도일 수 있음 |
| 활성화 | `createRoot`로 처음 mount | server DOM을 hydrate | interactive 영역 hydrate 또는 JS 없음 | interactive 영역 hydrate 또는 JS 없음 |
| 개인화/shared cache | shell 공유, API/query는 사용자별 | request input과 shared cache key 충돌 주의 | 공통 본문 + private slice | 공통 cached result + private slice |
| 신선도/무효화 | API/query cache 정책 | 요청 data 또는 response cache 정책 | rebuild·deploy가 갱신 | TTL/event invalidation + regeneration + propagation |
| 주 운영 비용 | client bytes·CPU, API, asset version | server capacity·latency·snapshot 재현 | build cardinality·atomic release | cache state·stampede·실패·다계층 전파 |
| 대표 실패 결과 | blank/skeleton/client error | slow TTFB/error HTML/hydration gap | 오래된 artifact/build failure | stale/first-miss delay/regeneration error |
| 적합 조건 | 인증·긴 세션·상호작용 중심 | 요청별 첫 화면·개인화·초기 HTML | 공통·저변경·유한 route | read-heavy·bounded staleness·큰 route 집합 |

이 표는 page 전체에 하나의 전략을 강제하지 않는다. 공통 설명은 SSG/ISR, 사용자 인사는 client/private SSR, 구매 시점 가격은 권위 server validation처럼 영역별로 섞을 수 있다. HTML 도착 뒤 활성화 순서는 [5b-5](./05-progressive-hydration.md)부터 별도 축으로 확장한다.

### 오래된 결과가 안전하지 않은 data에는 맞지 않는다

ISR의 stale-while-revalidate가 좋은 대상은 blog, catalog, docs처럼 bounded staleness를 허용하는 read-heavy content다. 다음 data는 별도 동적/권위 경계를 검토한다.

- 결제 직전 가격과 재고
- 사용자별 권한과 계정 상태
- 법적 동의 철회처럼 즉시 반영해야 하는 상태
- 보안 incident banner처럼 늦으면 피해가 생기는 정보

static 본문에 최신 재고 API를 조합할 수는 있다. 사용자가 의사결정하는 순간에는 권위 data를 다시 검증하고 stale HTML 값을 command input으로 신뢰하지 않는다.

## 실무 관점

### 실패 모드는 cache hit 뒤에 숨어 있다

- **stale-if-error 의존**: source 장애 때 오래된 문서는 남지만 장애가 오래 숨는다.
- **stampede**: 인기 key expiry 직후 여러 worker가 같은 generation을 시작한다.
- **long-tail first miss**: 드문 route는 첫 사용자가 build latency를 지불한다.
- **poisoned entry**: 일시적 권한/locale 오류 결과가 shared key에 저장된다.
- **partial invalidation**: 상세는 v42, 목록은 v41로 보인다.
- **rollback mismatch**: 이전 code가 새 payload/cache schema를 읽지 못한다.

deduplication lock, generation timeout, last-known-good retention, versioned cache namespace, deploy rollback/purge 절차가 필요한지 결정한다. framework가 일부를 제공해도 관측과 ownership은 제품 책임이다.

### 관찰 실험

monotonic `contentVersion`과 deterministic failure를 제공하는 local fixture를 사용한다.

| 요청 | 사전 상태 | 조작 | 기대 관찰 |
|---|---|---|---|
| 1 | missing | v41 요청 | 기다림/fallback 뒤 v41 생성 |
| 2 | fresh v41 | 없음 | generation log 없이 v41 hit |
| 3 | stale v41 | clock 전진 | v41 즉시 또는 blocking refresh — 계약 기록 |
| 4 | revalidation | source v42 | 최종 cache가 v42로 교체 |
| 5 | stale v42 | source failure | stale 유지 또는 error — 계약 기록 |
| 6 | invalidation | 관련/무관 tag | 관련 route만 version 변화 |

각 요청에 `requestId`, cache key, state before/after, served version, generated version, source read, response/cache header를 남긴다. 요청을 최소 세 번 반복하고 concurrent request를 보내 generation count가 하나로 합쳐지는지 확인한다. 외부 CDN이 없었다면 origin cache까지만 검증했다고 명시한다.

### 선택 체크리스트

- 허용 가능한 stale window와 absolute expiry는 얼마인가?
- missing·stale·expired 상태에서 어느 request가 기다리는가?
- regeneration 실패 때 stale을 보여도 안전한가?
- path가 아니라 실제 data ownership을 나타내는 tag/key는 무엇인가?
- locale·tenant·권한·query가 key에 포함되는가?
- origin, rendered route, CDN, browser/router cache 중 invalidation 범위는 어디까지인가?
- 동시 miss dedupe, timeout, last-known-good, rollback을 누가 소유하는가?
- publish 성공과 projection 반영을 어떤 version/log로 연결하는가?
- stale이 허용되지 않는 영역을 dynamic validation으로 분리했는가?

## 정리

- ISR은 build에 없던 route의 on-demand generation과 기존 static result의 regeneration을 포함하는 framework/platform 전략이다.
- cache 상태를 missing, fresh, stale, revalidating, error로 나눠 어떤 request가 무엇을 받는지 명시해야 한다.
- invalidation은 새 결과 생성이나 CDN/browser 전파 완료가 아니며 세 사건을 version으로 추적한다.
- time/path/tag 방식은 update event와 data dependency graph에 따라 선택한다.
- stale content, generation failure, stampede, multi-layer cache 불일치는 ISR이 지불하는 운영 비용이다.

## 확인 문제

**Q1.** CMS webhook에서 `revalidateTag`가 성공했는데 일부 사용자는 10분 동안 이전 글을 봤다. webhook 성공만으로 최신 반영을 증명할 수 없는 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

tag invalidation은 entry를 stale/expired로 만드는 사건일 뿐, regeneration과 외부 CDN·browser/router cache 전파 완료가 아닐 수 있다. origin generation log와 served content version, CDN cache age/header, browser navigation 상태를 계층별로 확인한다.
</details>

**Q2.** 상품 변경 때 `/products/42`만 path invalidation했더니 `/sale`에는 이전 가격이 남았다. 어떤 key 설계가 필요한가?

<details>
<summary>정답과 해설</summary>

URL graph와 product data dependency가 일치하지 않는다. 두 route의 조회 결과를 `product:42` 또는 관련 query tag에 연결하고 mutation event가 그 dependency를 invalidate하게 한다. sale 목록 전체를 매번 지울지 entity별 dependency를 유지할지는 cardinality와 correctness 비용으로 판단한다.
</details>

**Q3.** 결제 화면의 가격을 ISR로 5분 cache하면 hit가 빨라진다. 이 선택이 위험한 경계와 안전한 조합은 무엇인가?

<details>
<summary>정답과 해설</summary>

사용자가 보는 가격이 stale해 결제 command와 불일치할 수 있다. catalog 설명은 ISR로 유지하되 결제 직전 권위 server가 가격·재고를 다시 검증하고, UI는 변경을 명확히 알려야 한다. 사용자별 할인이나 권한 data는 shared ISR key에서 분리한다.
</details>

## 참고 자료

- [Next.js — Revalidating](https://nextjs.org/docs/app/getting-started/revalidating) — Next.js 16 Cache Components의 `cacheLife`, `revalidateTag`, `updateTag`, `revalidatePath` 현재 의미를 확인한다. (2026-07-11 확인)
- [Next.js — Cache Components](https://nextjs.org/docs/app/getting-started/partial-prerendering) — `cacheComponents: true`, `use cache`, cache key와 prerender 조합을 확인한다. (2026-07-11 확인)
- [Next.js — Caching without Cache Components](https://nextjs.org/docs/app/guides/caching-without-cache-components) — current model과 섞지 말아야 할 previous caching model을 구분한다. (2026-07-11 확인)
- [Next.js — CDN Caching](https://nextjs.org/docs/app/guides/cdn-caching) — server cache invalidation과 외부 CDN copy의 TTL이 분리될 수 있음을 확인한다. (2026-07-11 확인)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111) — fresh/stale, validation, stale response의 표준 조건을 확인한다. (2026-07-11 확인)
- [RFC 5861 — HTTP Cache-Control Extensions for Stale Content](https://www.rfc-editor.org/rfc/rfc5861) — HTTP `stale-while-revalidate`와 `stale-if-error` directive를 확인한다. (2026-07-11 확인)
- [Patterns.dev — Incremental Static Generation](https://www.patterns.dev/react/incremental-static-rendering/) — incremental static pattern의 문제 지형을 위한 2차 자료다. (2026-07-11 확인)
