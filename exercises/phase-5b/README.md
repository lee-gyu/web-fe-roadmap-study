# Phase 5b 실습 과제 — 렌더링 전략 비교, 전달·활성화 경계, RSC 분할, 영역별 ADR

Phase 5b 문서 학습과 병행하는 실습이다. [학습 기획](../../plan/phase5b.md)의 네 산출물을 하나의 통제된 fixture에서 검증한다.

이 과제의 목표는 프레임워크 기능을 많이 쓰는 것이 아니다. **같은 페이지를 여러 렌더링 전략으로 구성하고, 계산 위치·전달 산출물·캐시 상태·활성화 시점의 차이를 증거로 비교하는 것**이다. 어떤 영역에 CSR 또는 완전 static을 유지하기로 한 결정도 근거가 있으면 유효한 결과다.

## 공통 제약과 산출물

- framework는 실험 도구일 뿐 학습 목표가 아니다. 한 framework가 모든 전략을 지원하면 setup 비용을 줄이기 위해 사용할 수 있다. 이 경우 version, feature flag, runtime, hosting/cache topology를 고정하고 기록한다.
- Next.js를 선택하면 Cache Components 활성 여부를 먼저 고정하고, current 모델과 previous 모델의 API·문서를 한 실험 안에서 섞지 않는다. App Router 기능 전수 학습과 실제 프로젝트 통합은 [Phase 8 실습](../phase-8/README.md)의 범위다.
- 모든 성능·캐시·스트리밍·hydration 결과는 **production build**에서 수집한다. development 서버의 double render, cache bypass, source map 비용을 결과에 섞지 않는다.
- 실패 실험은 로컬 또는 소유한 test environment에서만 수행하고 public service·shared production cache를 오염시키지 않는다.
- 실제로 실행한 typecheck·test·build 명령과 결과, 실행하지 못한 검증을 report에 남긴다.

권장 구조는 다음과 같다. 현재 프로젝트 구조에 맞게 이름은 바꿀 수 있지만 책임 경계는 보존한다.

```text
phase-5b-lab/
├─ shared/
│  ├─ domain/              # 상품/콘텐츠 model과 semantic HTML 계약
│  ├─ controlled-data/     # version·latency·failure controller
│  └─ instrumentation/     # timeline marker, Server-Timing, log
├─ variants/
│  ├─ csr/
│  ├─ ssr/
│  ├─ static/
│  ├─ isr/
│  ├─ streaming/
│  └─ rsc/
├─ tests/
│  ├─ rendering-contract/  # variant 간 동일 동작 계약
│  ├─ cache-timeline/      # ISR 상태 전이 시나리오
│  ├─ streaming-errors/    # shell 전후 오류·abort
│  └─ server-client-boundary/  # 직렬화·Server Function 경계
├─ evidence/
│  ├─ html/                # View Source·curl 원문
│  ├─ headers/             # response/cache header
│  ├─ traces/              # Performance recording
│  ├─ waterfalls/          # Network 기록
│  ├─ build-output/        # route·chunk manifest
│  └─ logs/                # request/render/cache log
├─ reports/
│  ├─ rendering-matrix.md
│  ├─ cache-state-machine.md
│  ├─ hydration-timeline.md
│  └─ rsc-boundary.md
└─ adr/
   └─ 001-rendering-strategy.md
```

## 공통 비교 fixture

상품 상세 또는 콘텐츠 상세 페이지 하나를 사용한다. 모든 구현은 같은 semantic HTML, 데이터 shape, 오류 상태, 사용자 동작 계약을 유지하고, 전략상 의도된 차이는 명시한다.

| 영역 | 데이터/상호작용 성격 | 실험에 필요한 이유 |
|---|---|---|
| 제목·본문/상품 설명 | 공개, 변경 빈도 낮음, 검색·link preview 중요 | static/SSR/RSC의 초기 HTML과 bundle 차이 비교 |
| 가격·재고/게시 상태 | 변경 빈도 높음, stale 허용 범위 명시 필요 | SSR/ISR의 freshness와 invalidation 비교 |
| 리뷰·댓글 | 느린 data source, 오류 가능 | buffered/streaming SSR과 Suspense reveal 비교 |
| 개인화 추천/로그인 인사 | 사용자별, shared cache 부적합 | client slice와 request-time rendering 경계 비교 |
| 장바구니/좋아요/검색 입력 | 즉시 상호작용, browser state 필요 | hydration·Client Component·selective priority 비교 |

### 제어 가능한 data source

구현 전에 다음 기능을 갖춘 controller를 만든다. 이것이 모든 과제의 재현성 기반이다.

- [ ] monotonic content version과 update timestamp를 제공한다.
- [ ] 영역별 고정 latency(예: fast/medium/slow)와 manual gate를 제공한다.
- [ ] 특정 요청 번호·영역의 deterministic failure를 주입할 수 있다.
- [ ] request log와 render log, cache key·hit/miss/stale 상태를 남긴다.
- [ ] time-based revalidation을 재현할 fake clock 또는 짧고 명시적인 test window를 제공한다.

### 공통 계측 marker

모든 variant는 같은 이름의 timeline marker를 사용한다. 해당 없는 단계는 N/A로 두고 억지로 채우지 않는다.

```text
build/data snapshot
  → request
  → route/data cache lookup
  → server render or cached response
  → first byte / shell
  → remaining HTML or RSC chunks
  → HTML parse and paint
  → JavaScript download / parse / execute
  → hydration scheduled / completed
  → first handled interaction
  → data mutation / invalidation / revalidation
```

## 과제 A — CSR·SSR·SSG·ISR 공통 비교 (1주차, 5b-1~4 병행)

관련 문서: [5b-1 CSR](../../docs/phase-5b/01-client-side-rendering.md), [5b-2 SSR](../../docs/phase-5b/02-server-side-rendering.md), [5b-3 Static Rendering](../../docs/phase-5b/03-static-rendering.md), [5b-4 ISR](../../docs/phase-5b/04-incremental-static-generation.md)

### 요구사항

- [ ] 같은 route와 사용자 동작을 CSR, request-time SSR, build-time static, incremental/on-demand static variant로 구성한다.
- [ ] 네 variant가 같은 데이터를 언제 읽고 어떤 HTML·JavaScript·data request를 전달하는지 공통 타임라인에 표시한다.
- [ ] cold request, warm cache, 콘텐츠 변경 직후, revalidation 성공, revalidation 실패를 구분해 기록한다. 적용되지 않는 시나리오는 N/A 이유를 쓴다.
- [ ] document HTML, response/cache header, request log, build output, client bundle/route chunk, data version을 `evidence/`에 보존한다.
- [ ] ISR variant는 cache entry를 `missing → generating → fresh → stale → revalidating → fresh/error`로 관찰하고, 어떤 요청이 기다리고 어떤 요청이 stale 결과를 받는지 framework 계약과 함께 기록한다.

### 비교표

`reports/rendering-matrix.md`에 다음 10개 축을 채운다.

| 비교 축 | CSR | SSR | SSG | ISR | 해석 |
|---|---|---|---|---|---|
| HTML/데이터 생성 시점 | | | | | build/request/browser 중 어디인가 |
| cold/warm TTFB | | | | | cache와 server work는 무엇인가 |
| 핵심 콘텐츠가 HTML에 존재하는 시점 | | | | | JavaScript 전에도 읽을 수 있는가 |
| client JavaScript와 data waterfall | | | | | 어떤 코드·요청이 critical path인가 |
| hydration/mount 대상 | | | | | 전체/일부/없음 중 무엇인가 |
| 개인화와 shared cache | | | | | cache key가 사용자 데이터를 섞지 않는가 |
| 데이터 신선도·무효화 | | | | | stale window와 갱신 trigger는 무엇인가 |
| build/server/CDN 운영 비용 | | | | | 비용이 어느 계층으로 이동했는가 |
| 실패 시 사용자에게 보이는 결과 | | | | | blank/error/stale/fallback 중 무엇인가 |
| 적합·부적합 조건 | | | | | 어떤 요구사항에서 결론이 바뀌는가 |

ISR의 캐시 상태 전이는 `reports/cache-state-machine.md`에 별도로 기록한다. invalidation, regeneration, propagation을 서로 다른 사건으로 추적하고, 외부 CDN을 검증하지 못했다면 origin cache까지만 검증했다고 명시한다.

## 과제 B — Buffered/Streaming SSR과 progressive/selective hydration 비교 (2주차, 5b-5·6·8 병행)

관련 문서: [5b-5 Progressive Hydration](../../docs/phase-5b/05-progressive-hydration.md), [5b-6 Streaming SSR](../../docs/phase-5b/06-streaming-server-side-rendering.md), [5b-8 Selective Hydration](../../docs/phase-5b/08-selective-hydration.md)

### 스트리밍 전달

- [ ] 리뷰·댓글 영역을 manual gate로 지연시켜 buffered SSR(`onAllReady`)에서는 전체 응답을 막고, streaming variant(`onShellReady`)에서는 shell과 다른 영역이 먼저 도착하게 한다.
- [ ] `curl --no-buffer -D -`와 browser Network timing으로 header·shell·boundary chunk의 실제 도착 시각을 기록한다.
- [ ] shell 전 오류, shell 후 영역 오류, timeout/abort, client disconnect를 재현하고 HTTP status·server log·fallback·다른 영역의 상호작용 가능 여부를 표로 남긴다.
- [ ] buffering이 있는 reverse proxy와 직접 origin을 비교하거나, 환경상 불가능하면 어떤 계층이 검증되지 않았는지 명시한다.

### 활성화 경계

- [ ] server shell start, first byte, boundary chunk, browser insert, client code load, hydration start/end, click handled marker를 서로 다른 이름으로 기록한다.
- [ ] 비핵심 widget 하나를 immediate/visibility/interaction activation으로 비교하되, server HTML을 유지한 delayed hydration과 client-only mount를 별도 variant로 분리한다.
- [ ] JavaScript 비활성화와 느린 chunk 조건에서 링크·폼·focus order·fallback 공간이 유지되는지 확인한다.
- [ ] 두 Suspense boundary의 code/data delay를 서로 바꾸고, 사용자가 늦은 boundary를 먼저 클릭해 hydration 우선순위와 event/focus/value 보존을 관찰한다. 관찰 결과를 React/framework의 공식 보장 범위와 구분해 기록한다.
- [ ] 큰 단일 boundary와 여러 작은 boundary의 chunk 수, fallback 변화, 오류 격리, first interaction latency 차이를 비교한다. 더 작은 경계가 항상 승리한다는 결론을 금지한다.

결과는 `reports/hydration-timeline.md`에 남긴다.

## 과제 C — RSC와 Server/Client Component 경계 (2주차, 5b-7 병행)

관련 문서: [5b-7 React Server Components](../../docs/phase-5b/07-react-server-components.md)

- [ ] 제목·본문·리뷰 목록처럼 표시 중심인 영역을 Server Component로, 장바구니·좋아요처럼 state/event/browser API가 필요한 leaf를 Client Component로 구성한다.
- [ ] client-heavy baseline과 server-first variant의 client module 목록/JavaScript bytes, RSC response, server render/data log를 전후 비교한다. bytes는 raw/minified/compressed 중 무엇인지 명시한다.
- [ ] markdown renderer·formatter 같은 무거운 표시 의존성을 client/server에 각각 두어 client bytes 감소와 server compute·payload 증가를 함께 기록한다.
- [ ] Client Component가 Server Component 결과를 children/slot으로 받는 합성과, 잘못된 direct import의 실패를 비교한다.
- [ ] 함수/class instance/browser object를 경계 props로 넘기는 직렬화 실패를 로컬 fixture에서 재현하고 공개 가능한 DTO로 수정한다.
- [ ] 검증·인가가 없는 Server Function 반례를 만들어 unauthorized request가 거절되도록 수정하고, secret canary가 HTML·RSC payload·client bundle에 없는지 검사한다.

결과는 `reports/rsc-boundary.md`에 남긴다.

## 과제 D — 영역별 렌더링 전략 ADR (2주차 종합)

관련 문서: Phase 5b 전체, 특히 [5b-8의 영역별 책임 지도](../../docs/phase-5b/08-selective-hydration.md)

`adr/001-rendering-strategy.md`에 다음을 포함한다.

- [ ] 페이지 전체에 하나의 약어를 붙이지 않고 공통 fixture의 다섯 영역마다 rendering, data, cache, activation owner를 정한다.
- [ ] decision driver에 discoverability, personalization, freshness, interaction urgency, device/network, server capacity, build cardinality, hosting/cache topology, failure tolerance를 포함한다.
- [ ] 선택한 조합뿐 아니라 제외한 대안이 더 나아지는 조건을 기록한다.
- [ ] 관측할 production signal, 재검토 trigger, migration/rollback 경로를 기록한다.
- [ ] React core 보장과 framework/platform 기능을 표에서 분리한다. 예: Suspense/`hydrateRoot`와 tag invalidation/CDN purge를 같은 제품 기능으로 쓰지 않는다.

## 측정 프로토콜

모든 과제의 정량 결과에 공통 적용한다.

- production build를 사용하고 development-only 비용을 결과에 섞지 않는다.
- 각 결과에 commit, React/framework/runtime 버전, feature flag, route, browser, viewport, network/CPU 조건, cache cold/warm, data delay/version을 기록한다.
- 동일 조건을 최소 3회 실행하고 대표값과 변동 범위를 남긴다. 작은 차이를 유의미한 개선으로 단정하지 않는다.
- TTFB·FCP·LCP·INP는 정의에 맞는 도구로 수집한다. INP를 얻지 못한 짧은 lab session에서는 click-to-handler marker·long task를 보조 증거로 쓰되 이를 INP라고 부르지 않는다. field metric 심화는 [8-3 웹 성능](../../docs/phase-8/03-web-performance.md)의 범위다.
- Server-Timing 또는 사용자 정의 performance mark를 사용하면 browser metric과 server/data/cache 사건의 상관관계를 추적할 수 있게 이름을 고정한다.
- bundle bytes는 raw/minified/compressed 중 무엇인지, HTML/RSC/JSON/JS 중 어떤 resource인지 함께 기록한다.

## 통합 완성 기준 (Definition of Done)

- [ ] CSR·SSR·SSG·ISR variant가 동일 semantic HTML·데이터 shape·사용자 동작 계약을 만족하거나, 전략상 의도된 차이를 명시했다.
- [ ] 네 기본 전략의 build/request/cache/browser 계산 위치와 HTML·JS·data 전달 순서를 공통 타임라인과 10개 비교 축으로 설명했다.
- [ ] cold/warm cache, 콘텐츠 변경, revalidation 성공·실패의 cache state와 content version 증거를 기록했다.
- [ ] buffered/streaming SSR에서 shell·느린 boundary·오류·abort의 도착 순서와 status/fallback 차이를 재현했다.
- [ ] HTML 도착, client code 도착, hydration, 첫 처리된 상호작용을 별도 marker로 관찰했다.
- [ ] progressive/selective hydration의 포함 관계와 immediate/visibility/interaction activation의 초기 비용·첫 사용 지연을 비교했다.
- [ ] Server/Client Component 경계가 client bundle·RSC payload·server work에 미친 영향을 전후 증거로 설명했다.
- [ ] serialization 실패와 Server Function의 untrusted input·인가 경계를 안전한 로컬 fixture에서 검증했다.
- [ ] 모든 성능 결과에 production build, 버전, cache/data/network/CPU 조건과 반복 측정 범위를 기록했다.
- [ ] ADR이 페이지 영역별 선택, 대안, freshness·failure 계약, 관측 지표, 재검토·철회 조건을 포함한다.

## 제출 전 자가 검토

- 전략 이름을 지우고 봐도 각 variant가 어느 시점에 무엇을 계산하고 무엇을 전달하는지 설명되는가?
- "빠르다", "현대적이다" 같은 말에 HTML 원문·header·waterfall·trace·bundle·log 증거가 붙어 있는가?
- invalidation을 새 결과 생성·전역 전파 완료와 혼동한 서술이 없는가?
- HTML이 보이는 시점과 상호작용이 처리되는 시점을 같은 사건으로 쓴 곳이 없는가?
- React core의 보장과 framework/hosting의 기능을 구분해 기록했는가?
- 검증하지 못한 계층(외부 CDN, proxy buffering 등)을 검증한 것처럼 쓰지 않았는가?
