# 8-3. 웹 성능

> 한 줄 요약: 이 문서를 읽고 나면 Core Web Vitals를 사용자 경험 지표로 해석하고, LCP·CLS·INP 병목을 네트워크·렌더링·JavaScript 계층으로 나누어 개선 우선순위를 정할 수 있다.

이 문서는 web.dev의 Web Vitals 문서와 Chrome DevTools, Lighthouse, Chrome UX Report(CrUX)를 기준으로 한다. 2026년 7월 집필 시점의 안정 Core Web Vitals는 LCP, INP, CLS다. 권장 기준은 field data의 75번째 백분위수(p75)를 모바일과 데스크톱으로 나누어 판단하며, LCP는 2.5초 이하, INP는 200ms 이하, CLS는 0.1 이하를 좋은 상태로 본다. 지표 정의와 도구 지원은 시간이 지나며 바뀔 수 있으므로, 실제 문서 집필·개정 시점에는 공식 문서를 다시 확인해야 한다.

## 학습 목표

- lab data와 field data의 차이를 설명하고, Lighthouse 점수와 실제 사용자 지표를 혼동하지 않을 수 있다.
- LCP, CLS, INP가 각각 로딩, 시각 안정성, 입력 응답성을 어떤 방식으로 근사하는지 설명할 수 있다.
- LCP를 TTFB, resource load delay, resource load duration, element render delay로 나누어 병목을 찾을 수 있다.
- CLS와 INP를 렌더링 파이프라인, 레이아웃 안정성, long task 관점에서 진단할 수 있다.
- 성능 개선을 기준선 수집, 가설, 단일 변경, 재측정, 부작용 기록의 루프로 수행할 수 있다.

## 배경: 왜 이것이 존재하는가

프론트엔드 성능은 오래전부터 "빠르게 로드되는가"의 문제로 다뤄졌다. 그러나 `load` 이벤트나 `DOMContentLoaded`는 사용자가 실제로 무엇을 봤는지, 화면이 갑자기 밀렸는지, 클릭 후 반응이 느렸는지를 제대로 설명하지 못한다. SPA와 대형 JavaScript 앱에서는 문서 로드가 끝난 뒤에도 사용자는 긴 hydration, route chunk 로딩, third-party script, 렌더링 jank를 경험한다.

Core Web Vitals는 이 복잡한 경험을 세 축으로 줄인다.

```text
로딩: 주요 콘텐츠가 언제 보이는가?             → LCP
시각 안정성: 보이는 요소가 예상 밖으로 밀리는가? → CLS
응답성: 입력 후 다음 paint까지 오래 걸리는가?    → INP
```

이 지표들은 완벽한 진실이 아니다. 하지만 실무에서 유용한 공통 언어다. 백엔드에서 p95 latency, error rate, saturation을 보듯, 프론트엔드는 사용자 경험을 field metric으로 본다. 중요한 것은 점수 자체가 아니라 **지표가 가리키는 계층을 찾아 조치를 연결하는 능력**이다.

Phase 8-1은 브라우저가 style/layout/paint/composite를 수행하는 비용을 다뤘고, [8-2](./02-network-deep-dive.md)는 리소스 발견, 우선순위, 캐시를 다뤘다. 이 문서는 그 두 계층을 사용자 경험 지표와 연결한다.

## 핵심 개념

### lab data와 field data는 서로 다른 질문에 답한다

성능 측정은 크게 두 범주로 나뉜다.

| 구분 | 대표 도구 | 답하는 질문 | 한계 |
|---|---|---|---|
| lab data | Lighthouse, DevTools Performance, WebPageTest | 통제된 조건에서 왜 느린가? | 실제 사용자 기기·네트워크·상호작용 분포를 대표하지 못한다 |
| field data | CrUX, RUM, `web-vitals` 수집 | 실제 사용자는 무엇을 경험하는가? | 원인 분석에 필요한 trace가 부족할 수 있다 |

Lighthouse는 개발 중 회귀를 잡고 병목 후보를 찾는 데 유용하다. 하지만 Lighthouse 점수는 단일 실행 조건에 민감하다. CPU 성능, 네트워크, 브라우저 extension, A/B test, 광고 응답, 서버 상태에 따라 흔들린다. Lighthouse 성능 점수 하나를 OKR처럼 다루면 잘못된 최적화를 하기 쉽다.

실제 사용자 품질 판단은 field data가 중심이다. CrUX는 실제 Chrome 사용자의 익명 집계 데이터이고, PageSpeed Insights와 Search Console에서 볼 수 있다. 다만 CrUX는 트래픽이 충분한 URL이나 origin에만 자세한 데이터를 제공한다. 제품이 자체 RUM(Real User Monitoring)을 넣으면 더 세밀한 route, 사용자 segment, 배포 버전별 분석이 가능하다.

실무 루프는 보통 이렇다.

```text
field data로 문제가 실제인지 확인
  → lab에서 비슷한 조건 재현
  → trace와 waterfall로 병목 찾기
  → 변경
  → lab 재측정
  → field data로 회귀 여부 확인
```

### Core Web Vitals는 p75 사용자 경험을 본다

Core Web Vitals는 평균보다 p75를 기준으로 삼는다. 평균은 일부 빠른 기기와 좋은 네트워크가 느린 사용자를 가릴 수 있다. p75는 "대부분의 사용자에게 충분히 좋은가"를 묻는다.

| 지표 | 좋은 기준 | 사용자 경험 | 대표 원인 계층 |
|---|---:|---|---|
| LCP | 2.5s 이하 | 주요 콘텐츠가 빨리 보이는가 | TTFB, render-blocking CSS/JS, LCP resource 발견·우선순위·크기, hydration |
| CLS | 0.1 이하 | 화면이 예상 밖으로 밀리지 않는가 | 이미지/광고/폰트/삽입 콘텐츠의 공간 예약 실패, late style |
| INP | 200ms 이하 | 입력 후 다음 paint가 빠른가 | long task, 무거운 event handler, layout thrashing, 렌더링 지연 |

각 지표는 추상적인 UX를 하나의 수치로 근사한다. 수치가 나쁘다고 곧장 특정 해결책이 나오지는 않는다. LCP가 나쁘면 이미지 압축만 할 것이 아니라 TTFB, 리소스 발견, priority, 렌더링 지연을 나눠야 한다. INP가 나쁘면 React memo를 붙이기 전에 입력 처리 task가 어디서 길어지는지 봐야 한다.

### LCP는 주요 콘텐츠가 렌더된 시점이다

LCP(Largest Contentful Paint)는 viewport 안에서 가장 큰 주요 콘텐츠 후보가 렌더된 시점을 측정한다. 후보에는 `<img>`, SVG 안의 `<image>`, poster가 있는 `<video>`, CSS `url()` 배경 이미지, 텍스트 block 등이 포함된다. 브라우저는 placeholder나 화면 전체를 덮는 background처럼 "주요 콘텐츠"로 보기 어려운 요소를 제외하기 위한 휴리스틱도 사용한다.

LCP 최적화에서 가장 유용한 모델은 네 구간 분해다.

| 구간 | 의미 | 나쁘게 만드는 원인 |
|---|---|---|
| TTFB | navigation 시작부터 HTML 첫 바이트까지 | 서버 처리, redirect, CDN miss, 먼 origin, 캐시 불가 |
| Resource load delay | TTFB 이후 LCP 리소스 요청 시작까지 | CSS background, JS 삽입 이미지, 낮은 발견성, 낮은 priority |
| Resource load duration | LCP 리소스 다운로드 시간 | 큰 이미지, 느린 네트워크, 압축 미흡, CDN miss |
| Element render delay | 리소스 완료 후 화면에 그려질 때까지 | render-blocking CSS/JS, main thread long task, hydration, font block |

같은 4초 LCP라도 병목은 전혀 다를 수 있다.

```text
사례 A: TTFB 1.8s + 이미지 다운로드 0.4s
  → 서버·CDN·HTML 캐시가 우선이다.

사례 B: TTFB 0.2s + resource load delay 1.6s
  → LCP 리소스 발견 시점과 priority가 우선이다.

사례 C: 이미지 다운로드 1.8s
  → 이미지 포맷, 크기, CDN, responsive image가 우선이다.

사례 D: 리소스 완료 후 render delay 1.5s
  → JavaScript, CSS, hydration, main thread 작업이 우선이다.
```

LCP 이미지가 HTML에 `<img>`로 직접 있고 `srcset`/`sizes`가 맞으며 `fetchpriority="high"`가 붙어도, main thread가 긴 JS task로 막혀 있으면 render delay가 길 수 있다. 반대로 이미지를 AVIF로 줄여도, 리소스 완료 후 JS가 화면을 숨기고 있으면 LCP는 개선되지 않는다.

LCP 관찰 절차:

1. PageSpeed Insights 또는 CrUX로 field LCP가 실제 문제인지 확인한다.
2. DevTools Performance에서 trace를 찍고 LCP marker와 element를 확인한다.
3. Network 워터폴에서 HTML과 LCP 리소스를 찾는다.
4. 네 구간 중 어떤 구간이 큰지 기록한다.
5. 한 구간에만 조치를 적용하고 재측정한다.

### CLS는 예상 밖의 위치 변화를 누적한다

CLS(Cumulative Layout Shift)는 사용자가 예상하지 못한 layout shift의 가장 큰 burst를 측정한다. shift score는 영향 범위(impact fraction)와 이동 거리(distance fraction)를 곱해 계산한다.

```text
layout shift score = impact fraction × distance fraction
```

중요한 것은 "새 요소가 생겼다"가 아니라 **기존에 보이던 요소의 시작 위치가 프레임 사이에서 바뀌었는가**다. API 응답으로 리스트 아래에 새 항목이 추가되어 아래 콘텐츠를 밀면 shift가 생길 수 있다. 반대로 사용자가 버튼을 눌러 accordion을 열었고 즉시 공간이 생기는 것은 사용자가 예상한 변화로 간주될 수 있다.

대표 원인:

- 이미지와 video에 `width`/`height` 또는 `aspect-ratio`가 없어 로드 후 공간이 생김
- 광고, embed, iframe의 공간을 예약하지 않음
- 웹 폰트 교체로 텍스트 metrics가 바뀜
- late CSS가 초기 레이아웃을 바꿈
- 클라이언트 렌더링 후 skeleton과 실제 콘텐츠 높이가 크게 다름

나쁜 예:

```html
<!-- 이미지 높이를 예약하지 않아 로드 후 아래 콘텐츠를 밀 수 있다. -->
<img src="/product.jpg" alt="Product" />
<p>상품 설명...</p>
```

좋은 예:

```html
<!-- intrinsic ratio를 제공해 이미지 로드 전에도 공간을 예약한다. -->
<img src="/product.jpg" width="1200" height="800" alt="Product" />
<p>상품 설명...</p>
```

CSS로도 공간을 예약할 수 있다.

```css
.media {
  aspect-ratio: 3 / 2;
  width: 100%;
  object-fit: cover;
}
```

CLS는 lab에서 낮게 나와도 field에서 높을 수 있다. 광고, 개인화, 느린 API, 폰트 캐시 상태처럼 실제 사용자 조건에서만 생기는 shift가 있기 때문이다. 그래서 CLS는 RUM으로 `layout-shift` 원인을 수집하거나 DevTools의 layout shift region을 함께 봐야 한다.

### INP는 입력 전체 수명에서 가장 느린 상호작용을 본다

INP(Interaction to Next Paint)는 사용자의 click, tap, key press 같은 상호작용이 시작된 뒤 브라우저가 다음 paint를 할 수 있을 때까지의 지연을 측정한다. First Input Delay(FID)가 첫 입력의 input delay만 보던 것과 달리, INP는 페이지 생명주기 전체의 상호작용을 본다.

INP는 보통 세 부분으로 나눠 생각한다.

| 구간 | 의미 | 대표 원인 |
|---|---|---|
| input delay | 입력이 들어온 뒤 handler가 시작되기까지 | main thread가 이전 long task로 막힘 |
| processing duration | event handler가 실행되는 시간 | 무거운 동기 계산, 큰 상태 갱신, DOM read/write 반복 |
| presentation delay | handler 후 다음 paint까지 | style/layout/paint 비용, rendering pipeline 지연 |

다음 코드는 INP를 악화시키는 전형적인 패턴이다.

```html
<!doctype html>
<meta charset="utf-8" />
<button id="calculate">calculate</button>
<p id="status">idle</p>

<script>
  const status = document.querySelector("#status");

  document.querySelector("#calculate").addEventListener("click", () => {
    const startedAt = performance.now();

    // 입력 handler 안에서 긴 동기 계산을 수행하면 다음 paint가 밀린다.
    while (performance.now() - startedAt < 250) {
      Math.sqrt(Math.random());
    }

    status.textContent = "done";
  });
</script>
```

사용자는 버튼을 눌렀지만, 브라우저는 handler의 동기 계산이 끝나고 렌더링까지 완료해야 다음 화면을 보여 줄 수 있다. 개선 방향은 작업을 줄이거나, 쪼개거나, 우선순위를 낮추거나, Web Worker로 옮기는 것이다.

```html
<!doctype html>
<meta charset="utf-8" />
<button id="calculate">calculate</button>
<p id="status">idle</p>

<script>
  const status = document.querySelector("#status");

  function runChunk(deadlineMs) {
    const startedAt = performance.now();

    while (performance.now() - startedAt < deadlineMs) {
      Math.sqrt(Math.random());
    }
  }

  document.querySelector("#calculate").addEventListener("click", () => {
    // 먼저 사용자에게 반응을 보여 준다.
    status.textContent = "working";

    // 긴 일을 여러 task로 나눠 입력과 paint가 끼어들 여지를 만든다.
    let remaining = 10;
    const step = () => {
      runChunk(12);
      remaining -= 1;

      if (remaining > 0) {
        setTimeout(step, 0);
      } else {
        status.textContent = "done";
      }
    };

    setTimeout(step, 0);
  });
</script>
```

이 예제는 단순화를 위해 `setTimeout`을 사용했다. 실제 프로젝트에서는 작업의 성격에 따라 `scheduler.postTask`, `requestIdleCallback`, Web Worker, 서버 계산, virtualization, optimistic UI 등 선택지가 달라진다. 중요한 것은 입력 handler가 사용자 반응과 무관한 긴 일을 독점하지 않게 만드는 것이다.

### 보조 지표는 원인 추적에 쓴다

Core Web Vitals만으로 원인이 바로 나오지 않을 때 보조 지표를 함께 본다.

| 보조 지표 | 주로 돕는 지표 | 의미 |
|---|---|---|
| TTFB | LCP | HTML 첫 바이트가 늦은지 확인한다 |
| FCP | LCP | 첫 콘텐츠 paint까지 render-blocking이 있는지 본다 |
| TBT | INP | lab에서 main thread blocking을 근사한다 |
| Speed Index | 로딩 체감 | viewport가 시각적으로 채워지는 속도를 본다 |
| bundle size/coverage | LCP/INP | 불필요한 JS 다운로드와 실행 비용을 본다 |

Lighthouse는 lab에서 INP를 직접 측정하기 어렵기 때문에 TBT를 proxy로 쓴다. TBT가 좋아졌다고 field INP가 반드시 좋아지는 것은 아니지만, main thread blocking을 줄이는 조치는 INP 개선 가능성이 크다.

### `web-vitals`로 field-like 측정을 수집한다

프로덕션에서 자체 RUM을 만들 때는 `web-vitals` 라이브러리를 사용할 수 있다.

```js
import { onCLS, onINP, onLCP } from "web-vitals";

function reportMetric(metric) {
  const payload = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
    url: location.pathname,
    buildId: window.__BUILD_ID__,
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/rum", payload);
    return;
  }

  fetch("/rum", {
    method: "POST",
    body: payload,
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

onLCP(reportMetric);
onCLS(reportMetric);
onINP(reportMetric);
```

실제 운영에서는 route, device class, connection type, release version, experiment bucket, authentication state 같은 차원을 함께 수집해야 원인을 좁힐 수 있다. 단, 성능 수집도 개인정보·동의·샘플링 정책의 영향을 받는다. URL에 민감한 query가 있다면 그대로 보내지 않는다.

## 실무 관점

### 개선 전략은 지표와 계층을 맞춰 고른다

| 조치 | 주로 개선하는 지표 | 비용 | 무너지는 조건 |
|---|---|---|---|
| 이미지 크기·포맷 최적화 | LCP | 인코딩 파이프라인, 품질 검증 | render delay가 병목이면 효과가 작다 |
| LCP 이미지 preload/fetchpriority | LCP | 잘못 쓰면 경쟁 증가 | 이미 일찍 발견되고 priority가 높으면 효과가 작다 |
| CSS/JS render blocking 축소 | LCP, INP | 코드 분할·critical CSS 설계 필요 | 분할이 과하면 request waterfall이 늘 수 있다 |
| reserved space/aspect-ratio | CLS | 레이아웃 설계 필요 | 콘텐츠 높이가 예측 불가하면 skeleton 전략 필요 |
| font-display와 폰트 metric 조정 | CLS, LCP | 브랜드 폰트 품질과 trade-off | fallback 차이가 크면 오히려 shift가 보일 수 있다 |
| long task 분할 | INP | 상태 일관성·취소 처리 복잡도 | 총 작업량이 너무 크면 worker/server 이동 필요 |
| third-party script 지연·격리 | LCP, INP | 기능·광고·분석 요구와 충돌 | business requirement가 성능보다 우선할 수 있다 |

성능 조치는 대부분 비용을 다른 곳으로 옮긴다. 이미지 압축은 품질과 처리 파이프라인을 건드린다. 코드 분할은 초기 JS를 줄이지만 route 전환 waterfall을 만들 수 있다. SSR은 LCP를 개선할 수 있지만 TTFB와 서버 비용을 늘릴 수 있다. 그래서 모든 조치는 전후 수치와 부작용을 함께 기록해야 한다.

### 성능 리포트는 원인-조치-효과가 있어야 한다

좋은 성능 리포트의 최소 구조:

| 항목 | 예시 |
|---|---|
| 기준선 | 모바일 p75 LCP 3.4s, CLS 0.05, INP 180ms |
| 재현 조건 | Moto G Power 수준 CPU throttle, 4G throttling, cold cache |
| 병목 증거 | LCP image가 CSS 파싱 후 1.2s에 발견됨 |
| 조치 | `<link rel="preload" as="image" href="/hero.avif" fetchpriority="high">` 추가 |
| 결과 | lab LCP 3.1s → 2.5s, field p75은 다음 배포 후 확인 필요 |
| 부작용 | 초기 bandwidth 경쟁 증가 가능성. below-fold image lazy loading도 함께 확인 |

나쁜 리포트:

```text
Lighthouse 72점에서 96점으로 개선.
```

이 문장은 무엇이 느렸고 무엇을 고쳤는지 설명하지 못한다. 점수는 결과 요약으로만 쓴다.

### 성능 budget은 회귀 방지 장치다

한 번 개선한 성능은 쉽게 다시 나빠진다. 새 UI, 분석 스크립트, 이미지, 폰트, A/B test가 누적되기 때문이다. CI와 PR에서 확인할 수 있는 budget을 두면 회귀를 빨리 발견할 수 있다.

예시 budget:

- 초기 JS gzip 180KB 이하
- route chunk 80KB 이하
- LCP image 150KB 이하
- third-party script 총 blocking time 100ms 이하
- Lighthouse CI mobile LCP 3.0s 이하

budget은 절대 진리가 아니라 팀의 협상 기준이다. 제품 요구로 budget을 넘길 수는 있다. 대신 "얼마나 넘겼고 어떤 사용자 경험 비용을 감수하는가"를 PR과 ADR에 남겨야 한다.

## 더 깊이

### LCP 최적화는 delay를 줄이는 문제다

web.dev의 LCP 분해에서 `resource load delay`와 `element render delay`는 가능한 한 0에 가까워야 하는 구간이다. 이 두 구간은 네트워크 자체가 느려서 생기는 시간이 아니라, 브라우저가 리소스를 늦게 발견하거나 화면에 늦게 반영해서 생기는 시간이다.

```text
HTML 도착
  ├─ CSS 다운로드
  ├─ JS 다운로드/실행
  └─ LCP 이미지 발견 지연
       └─ 이미지 다운로드
            └─ JS hydration 후 표시
```

이미지 파일 크기를 줄이는 것은 resource load duration을 줄인다. 하지만 resource load delay와 element render delay가 크면 전체 LCP는 거의 줄지 않을 수 있다. 따라서 LCP 리포트에는 "이미지를 줄였다"보다 "어느 subpart가 줄었는가"가 필요하다.

### CLS는 페이지 로드 이후에도 계속 발생할 수 있다

CLS는 초기 로딩 중에만 생기는 문제가 아니다. SPA에서 route 전환 후 광고가 삽입되거나, infinite scroll에서 위쪽 콘텐츠가 재정렬되거나, lazy component가 실제 높이를 늦게 알게 되면 페이지 생명주기 중간에도 shift가 생긴다.

lab 도구가 초기 로드만 측정하면 이런 문제를 놓칠 수 있다. field RUM에서 CLS가 높고 lab에서 낮다면 다음을 의심한다.

- 광고·추천·댓글 등 third-party 또는 개인화 콘텐츠
- 로그인 사용자에게만 보이는 banner
- route 전환 후 lazy loaded widget
- slow API에서 skeleton과 실제 콘텐츠 높이 차이
- web font cache miss

### INP는 "빠른 handler"보다 "빠른 다음 paint"다

event handler 자체가 짧아도 INP가 나쁠 수 있다. handler가 class를 바꾸고 종료했지만, 그 결과 style/layout/paint가 오래 걸리면 presentation delay가 길어진다. 반대로 handler가 약간 길어도 사용자가 즉시 feedback을 보고 긴 작업이 뒤로 밀리면 체감은 좋아질 수 있다.

따라서 INP 개선은 세 축을 함께 본다.

- input delay: main thread를 long task로 점유하지 않는다.
- processing duration: event handler 안의 동기 작업을 줄인다.
- presentation delay: handler 결과가 비싼 layout/paint를 만들지 않게 한다.

React 앱에서는 큰 상태 갱신이 세 축을 모두 건드릴 수 있다. 상태 갱신 자체는 JavaScript 작업이고, 커밋은 DOM 변경이며, DOM 변경은 style/layout/paint를 만든다. React Profiler와 Chrome Performance trace를 함께 봐야 하는 이유다.

## 정리

- Core Web Vitals는 LCP, INP, CLS로 로딩·응답성·시각 안정성을 측정하며, p75 field data를 중심으로 판단한다.
- Lighthouse와 DevTools는 원인 분석에 강하고, CrUX와 RUM은 실제 사용자 경험 판단에 강하다.
- LCP는 TTFB, resource load delay, resource load duration, element render delay로 나누어야 올바른 조치를 고를 수 있다.
- CLS는 이미지·광고·폰트·동적 콘텐츠의 공간 예약 실패에서 자주 발생하며, lab보다 field에서 더 크게 나타날 수 있다.
- INP는 event handler 시간뿐 아니라 input delay와 presentation delay까지 포함하므로 JavaScript와 렌더링 파이프라인을 함께 봐야 한다.

## 확인 문제

1. Lighthouse에서 LCP가 나빠서 hero 이미지를 AVIF로 바꿨지만 LCP가 거의 줄지 않았다. 어떤 가능성을 먼저 확인해야 하는가?

<details>
<summary>정답과 해설</summary>

이미지 파일 크기는 resource load duration을 줄이는 조치다. LCP가 개선되지 않았다면 resource load delay나 element render delay가 병목일 수 있다. CSS background라 늦게 발견되는지, priority가 낮은지, 이미지 다운로드 후 JavaScript/hydration/render-blocking 작업 때문에 표시가 늦는지 LCP subpart와 워터폴을 확인해야 한다.

</details>

2. lab CLS는 0.02인데 field CLS p75가 0.18이다. 왜 이런 차이가 생길 수 있는가?

<details>
<summary>정답과 해설</summary>

lab은 통제된 초기 로드 조건만 보는 경우가 많다. 실제 사용자에게는 광고, 개인화 banner, 로그인 상태, 느린 API, 폰트 캐시 miss, route 전환 후 lazy widget 같은 조건이 생긴다. field CLS가 높다면 실제 사용자 조건에서 발생하는 shift 원인을 RUM이나 DevTools layout shift 도구로 찾아야 한다.

</details>

3. INP가 나쁜 페이지에서 event handler 시간을 줄였는데 개선이 작다. 어떤 구간을 추가로 봐야 하는가?

<details>
<summary>정답과 해설</summary>

INP는 input delay, processing duration, presentation delay를 포함한다. handler 시간이 줄어도 main thread가 이전 long task로 막혀 input delay가 길거나, handler 이후 style/layout/paint가 오래 걸려 presentation delay가 길면 INP가 계속 나쁠 수 있다. Chrome Performance trace에서 interaction 이후 다음 paint까지의 전체 구간을 봐야 한다.

</details>

4. 성능 리포트에 "Lighthouse 점수 95 달성"만 적혀 있다. 왜 부족한가?

<details>
<summary>정답과 해설</summary>

Lighthouse 점수는 lab 조건의 종합 점수일 뿐이다. 어떤 사용자 경험 지표가 문제였는지, 어떤 병목 증거가 있었는지, 어떤 조치가 어떤 subpart를 줄였는지, field data에서 실제 개선이 확인되었는지 알 수 없다. 좋은 리포트에는 기준선, 재현 조건, 원인 가설, 조치, 전후 수치, 부작용이 있어야 한다.

</details>

## 참고 자료

- [web.dev: Web Vitals](https://web.dev/articles/vitals) — Core Web Vitals의 현재 지표, 기준값, field/lab 측정 도구를 설명한다.
- [web.dev: Largest Contentful Paint](https://web.dev/articles/lcp) — LCP의 정의, 후보 요소, 측정 기준을 확인할 수 있다.
- [web.dev: Optimize Largest Contentful Paint](https://web.dev/articles/optimize-lcp) — LCP를 TTFB, resource load delay, resource load duration, element render delay로 분해하는 방법을 설명한다.
- [web.dev: Cumulative Layout Shift](https://web.dev/articles/cls) — CLS의 session window, impact fraction, distance fraction 계산 모델을 설명한다.
- [web.dev: Interaction to Next Paint](https://web.dev/articles/inp) — INP가 입력 전체 수명과 다음 paint까지의 시간을 어떻게 측정하는지 설명한다.
- [web.dev: Optimize Interaction to Next Paint](https://web.dev/articles/optimize-inp) — long task, event handler, rendering delay 관점의 INP 개선 방향을 다룬다.
- [web.dev: Optimize Cumulative Layout Shift](https://web.dev/articles/optimize-cls) — 이미지·광고·폰트·동적 콘텐츠가 만드는 layout shift 개선 전략을 설명한다.
- [Chrome DevTools Performance panel](https://developer.chrome.com/docs/devtools/performance/overview) — trace로 long task, LCP, layout shift, rendering work를 분석하는 도구다.
- [Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring) — Lighthouse 성능 점수의 가중치와 변동성을 설명한다.
- [Chrome UX Report](https://developer.chrome.com/docs/crux) — 실제 Chrome 사용자의 Core Web Vitals 집계 데이터인 CrUX의 범위와 도구를 설명한다.
- [web-vitals](https://github.com/GoogleChrome/web-vitals) — LCP, INP, CLS를 JavaScript로 수집하기 위한 공식 라이브러리다.
