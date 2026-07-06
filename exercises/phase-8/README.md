# Phase 8 실습 과제 — 성능 개선 리포트와 Next.js 렌더링 전략 검증

Phase 8 문서 학습과 병행하는 실습 과제다. [학습 기획](../../plan/phase8.md)의 3주 배분과 연동되며, 완성 기준(Definition of Done)을 체크리스트로 명시한다.

이 Phase의 실습은 **계측 → 개선 → 보안 점검 → 렌더링 전략 적용**이다. Lighthouse 점수나 프레임워크 기능 사용 여부가 아니라, 브라우저가 실제로 어디에서 시간을 쓰고 어떤 신뢰 경계를 넘는지 관찰한 뒤 선택의 근거를 남기는 것이 목표다.

대상 프로젝트는 Phase 6까지 발전시킨 React + TypeScript SPA다. 별도 프로젝트를 사용해도 되지만, 라우팅, 서버 데이터 요청, 이미지/폰트/스크립트 자산, 배포 URL이 있어야 렌더링·네트워크·성능 관찰 지점이 충분히 나온다.

공통 제약:

- 모든 성능 판단은 측정 환경을 함께 기록한다. 최소한 commit hash, 배포 URL 또는 로컬 URL, 브라우저와 버전, viewport, network/CPU throttling, cache 활성 여부를 남긴다.
- 최적화는 한 번에 하나의 가설만 검증한다. 여러 조치를 동시에 넣어 지표가 좋아졌다면 어떤 조치가 효과를 냈는지 설명할 수 없다.
- 기준선은 tag나 branch로 보존한다. 예: `phase8-baseline`, `phase8-after-lcp-image`.
- XSS/CSRF 실험은 로컬 실습 서버나 본인이 소유한 프로젝트에서만 수행한다. 공개 서비스에 공격 페이로드를 보내지 않는다.
- Next.js 미니 프로젝트는 App Router 기준으로 작성하고, 사용한 React/Next.js 버전을 `package.json`과 README에 명시한다.

## 1주차 — 렌더링 파이프라인과 네트워크 워터폴 관찰

[8-1](../../docs/phase-8/01-browser-rendering.md), [8-2](../../docs/phase-8/02-network-deep-dive.md)와 병행한다.

### 실험 A. 렌더링 trace와 layout thrashing

- [ ] 대표 화면 1개와 상호작용 1개를 정하고 Chrome DevTools Performance trace를 저장했다.
- [ ] trace에서 long task, style recalculation, layout, paint, composite 이벤트 중 하나 이상을 찾아 병목 후보로 설명했다.
- [ ] DOM 쓰기 직후 레이아웃 값을 읽는 코드를 만들어 forced synchronous layout을 재현했다.
- [ ] DOM 읽기와 쓰기를 분리하거나 requestAnimationFrame 경계로 옮겨 전/후 trace를 비교했다.
- [ ] Rendering 패널의 paint flashing 또는 layout shift regions를 사용해 실제로 다시 그려지는 영역을 확인했다.
- [ ] `will-change`, transform/opacity 애니메이션, 레이어 증가 중 하나를 점검하고, 합성 비용을 줄이는 대신 생긴 메모리/래스터 비용을 기록했다.

layout thrashing은 앱 내부에서 재현해도 되고, 다음처럼 독립 HTML로 만들어도 된다. 중요한 것은 "느리다"가 아니라 Performance trace에서 레이아웃이 반복 계산되는 증거를 남기는 것이다.

```html
<!doctype html>
<meta charset="utf-8" />
<button id="bad">bad</button>
<button id="good">good</button>
<ul id="list"></ul>
<script>
  const list = document.querySelector("#list");

  document.querySelector("#bad").addEventListener("click", () => {
    for (let i = 0; i < 1000; i += 1) {
      const item = document.createElement("li");
      item.textContent = `item ${i}`;
      list.append(item);

      // 쓰기 직후 읽기가 반복되면 브라우저가 미뤄 둔 레이아웃을 즉시 확정해야 한다.
      list.getBoundingClientRect();
    }
  });

  document.querySelector("#good").addEventListener("click", () => {
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < 1000; i += 1) {
      const item = document.createElement("li");
      item.textContent = `item ${i}`;
      fragment.append(item);
    }

    list.append(fragment);

    requestAnimationFrame(() => {
      // 프레임 경계에서 한 번만 읽어 레이아웃 확정 횟수를 줄인다.
      console.log(list.getBoundingClientRect().height);
    });
  });
</script>
```

### 실험 B. 리소스 발견 시점과 우선순위

- [ ] DevTools Network 패널에서 HTML, CSS, JS, font, image, fetch 요청의 initiator와 priority를 기록했다.
- [ ] LCP 후보 리소스가 어떤 요청이며, HTML 파서·preload scanner·JavaScript 중 무엇에 의해 발견되는지 설명했다.
- [ ] `preload`, `preconnect`, `dns-prefetch`, `fetchpriority`, lazy loading 중 프로젝트에 맞는 조치 1~2개를 골라 전/후 waterfall을 비교했다.
- [ ] render-blocking CSS 또는 초기 JS chunk가 첫 화면을 막는 경로를 initiator chain으로 추적했다.
- [ ] 정적 배포 응답의 `Cache-Control`, `Vary`, CDN cache status header가 있으면 browser cache와 shared cache 관점으로 구분해 해석했다.
- [ ] `curl -I <url>` 또는 Network response headers로 HTML과 hash asset의 캐시 정책이 다른지 확인했다.

### 실험 C. CORS simple request와 preflight

- [ ] 서로 다른 origin의 로컬 서버 2개를 만들거나 테스트 API를 사용해 simple request와 preflight request를 각각 재현했다.
- [ ] preflight가 발생한 조건을 메서드, 요청 헤더, Content-Type, credentials 사용 여부로 나눠 설명했다.
- [ ] `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, `Access-Control-Max-Age`가 브라우저의 읽기 권한과 preflight cache에 어떻게 영향을 주는지 기록했다.
- [ ] CORS가 인증·인가가 아니라 브라우저의 교차 출처 읽기 권한 모델이라는 점을 프로젝트 맥락에서 정리했다.

## 2주차 — Core Web Vitals 개선과 보안 점검

[8-3](../../docs/phase-8/03-web-performance.md), [8-4](../../docs/phase-8/04-web-security.md)와 병행한다.

### 실험 D. Core Web Vitals 기준선과 개선 루프

- [ ] Lighthouse, DevTools Performance, WebPageTest 중 하나 이상의 lab 도구로 기준선을 잡았다.
- [ ] 가능하면 `web-vitals` 라이브러리나 RUM 도구로 field-like 측정 코드를 추가하고, lab data와 field data의 차이를 기록했다.
- [ ] LCP, CLS, INP 중 최소 2개를 개선 대상으로 정했다. INP를 직접 얻기 어렵다면 lab 환경에서는 TBT와 long task를 보조 지표로 사용한다.
- [ ] 각 지표마다 원인 가설, 관찰 증거, 적용 조치, 재측정 결과, 부작용을 표로 남겼다.
- [ ] 동일 조건에서 3회 이상 측정하고 중앙값 또는 대표값을 사용했다.
- [ ] 효과가 없거나 부작용이 더 큰 조치는 되돌리고, 되돌린 이유를 기록했다.

개선 후보는 프로젝트 병목에 맞게 선택한다.

| 병목 후보 | 관찰 증거 | 가능한 조치 | 무너지는 조건 |
|---|---|---|---|
| LCP 이미지 발견 지연 | waterfall에서 이미지 요청이 늦게 시작 | HTML에서 직접 발견되게 수정, `preload`, `fetchpriority` | preload 남용으로 다른 중요 리소스가 밀림 |
| 이미지 전송 비용 | transfer size가 크고 decode 시간이 김 | 포맷/크기 조정, responsive image | 과도한 변환 파이프라인과 캐시 조합 증가 |
| CLS | layout shift regions, 이미지/광고/폰트 교체 | width/height, aspect-ratio, font metric 조정 | 예약 공간이 실제 콘텐츠와 맞지 않음 |
| INP/TBT | long task, input delay | 작업 분할, 필요 시 Web Worker, third-party 지연 | 작업 분할이 전체 완료 시간이나 복잡도를 늘림 |
| 초기 JS 과다 | coverage/visualizer에서 미사용 코드 큼 | route split, 동적 import, 의존성 교체 | route 이동 시 추가 waterfall 생성 |
| 폰트 지연 | text render delay, font request 늦음 | `font-display`, subset, preload | FOIT/FOUT와 브랜드 요구의 충돌 |

### 실험 E. 보안 경계 점검

- [ ] 프로젝트의 origin, site, third-party script, 쿠키, storage 사용 지점을 표로 정리했다.
- [ ] 사용자 입력이 HTML, 속성, URL, Markdown, `dangerouslySetInnerHTML`, DOM API로 들어가는 경로를 점검했다.
- [ ] XSS가 성립하려면 어떤 입력 경로와 sink가 필요하고, 현재 어떤 계층이 막고 있는지 설명했다.
- [ ] CSP 적용 가능성을 점검했다. inline script가 있다면 nonce/hash 또는 제거 전략을 기록했다.
- [ ] 쿠키를 쓰는 mutating request가 있다면 SameSite, CSRF token, custom header + preflight 중 어떤 방어가 필요한지 판단했다.
- [ ] 토큰 저장 위치(localStorage, sessionStorage, memory, httpOnly cookie)를 XSS, CSRF, 새로고침 UX, 폐기/회전 비용으로 비교했다.
- [ ] 보안 개선이 성능 개선과 충돌하는 지점을 기록했다. 예: third-party script 지연, inline script 제거, CSP nonce 적용, 인증 요청 캐시 금지.

## 3주차 — 렌더링 전략 ADR과 Next.js App Router 미니 프로젝트

[8-5](../../docs/phase-8/05-rendering-strategies.md), [8-6](../../docs/phase-8/06-nextjs-and-rsc.md)와 병행한다.

### 실험 F. CSR/SSR/SSG/ISR/RSC 렌더링 전략 비교

상품 목록/상세, 문서 검색, 블로그/뉴스 목록, 대시보드 요약처럼 정적 데이터와 동적 데이터가 섞인 화면을 고른다. 같은 요구사항을 기존 CSR SPA와 Next.js App Router 미니 프로젝트 관점으로 비교한다.

- [ ] 화면별 데이터 신선도, 개인화 여부, 캐시 가능성, 상호작용 밀도, SEO 필요성을 정의했다.
- [ ] CSR, SSR, SSG, ISR, RSC가 계산을 빌드·요청 서버·캐시·클라이언트 중 어디로 옮기는지 비교했다.
- [ ] TTFB, LCP, JS bundle size, hydration 비용, cache invalidation, 운영 복잡도를 비교 축으로 ADR을 작성했다.
- [ ] 선택하지 않은 전략이 더 나아지는 조건을 최소 2개 이상 기록했다.

### 실험 G. Next.js App Router + RSC 구현

- [ ] App Router의 route segment를 2개 이상 만들었다. 예: `/products`, `/products/[id]`.
- [ ] `layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx` 경계를 사용했다.
- [ ] 서버 컴포넌트에서 데이터를 가져오고, 브라우저 API나 이벤트 핸들러가 필요한 부분만 클라이언트 컴포넌트로 분리했다.
- [ ] `use client` 경계가 번들 경계와 실행 환경을 어떻게 바꾸는지 README에 설명했다.
- [ ] `fetch` cache, `revalidate`, dynamic/static rendering 판정 중 프로젝트에 해당하는 캐시 전략을 명시했다.
- [ ] 클라이언트 상호작용 1개 이상을 구현했다. 예: 필터 UI, 장바구니 버튼, 북마크 토글, 검색 입력.
- [ ] 서버/클라이언트 컴포넌트 경계를 의도적으로 한 번 잘못 나눠 보고, 번들 증가·직렬화 오류·브라우저 API 접근 오류·상호작용 지연 중 어떤 문제가 생기는지 기록했다.
- [ ] `pnpm build` 결과와 Network/Performance 관찰로 기존 CSR 화면과 Next.js 화면의 차이를 비교했다.

## 산출물

### 1. 렌더링·네트워크 관찰 노트

각 관찰 항목마다 다음 형식을 사용한다.

````md
## 관찰 이름

### 측정 환경
- commit:
- URL:
- 브라우저:
- viewport:
- network/CPU 조건:
- cache 조건:

### 기준선
- trace/waterfall 파일:
- 주요 이벤트 또는 요청:
- 병목 후보:

### 해석
- 브라우저가 수행한 단계:
- 병목이 발생한 계층:
- 사람이 개입할 수 있는 지점:

### 변경
```sh
실행한 명령 또는 변경한 파일
```

### 결과
- 전/후 수치:
- 전/후 trace 또는 waterfall 차이:
- 부작용:
````

### 2. Core Web Vitals 개선 리포트

| 지표 | 기준선 | 원인 가설 | 관찰 증거 | 조치 | 개선 후 | 부작용/보류 |
|---|---:|---|---|---|---:|---|
| LCP | | | | | | |
| CLS | | | | | | |
| INP/TBT | | | | | | |

보고서에는 다음 질문의 답이 들어 있어야 한다.

- 이 지표는 어떤 사용자 경험을 근사하는가.
- 병목은 리소스 발견, 전송, 렌더링, JavaScript 실행, 레이아웃 안정성 중 어디에 있었는가.
- 적용한 조치는 어떤 비용을 다른 계층으로 옮겼는가.
- 실제 사용자 지표가 있다면 lab 결과와 같은 방향인가, 다르다면 왜 다른가.

### 3. 보안 점검 표

| 항목 | 현재 상태 | 공격 성공 조건 | 방어 계층 | 검증 증거 | 남은 리스크 |
|---|---|---|---|---|---|
| XSS 입력 경로 | | | | | |
| CSP | | | | | |
| 쿠키 속성 | | | | | |
| CSRF | | | | | |
| 토큰 저장 위치 | | | | | |
| third-party script | | | | | |

### 4. 렌더링 전략 ADR

````md
# ADR: <화면 또는 기능> 렌더링 전략

## 상태
Accepted / Rejected / Superseded

## 맥락
- 데이터 신선도:
- 개인화:
- SEO:
- 캐시 가능성:
- 상호작용 밀도:

## 선택
- 선택한 전략:
- 서버/클라이언트 컴포넌트 경계:
- 캐시/revalidate 전략:

## 대안 비교
| 전략 | 장점 | 비용 | 더 적합해지는 조건 |
|---|---|---|---|
| CSR | | | |
| SSR | | | |
| SSG/ISR | | | |
| RSC | | | |

## 결과
- TTFB/LCP:
- JS bundle/hydration:
- 운영 복잡도:
- 남은 위험:
````

### 5. Next.js 미니 프로젝트 README

미니 프로젝트의 README에는 다음을 포함한다.

- 사용한 React/Next.js 버전과 실행 명령
- route segment 구조
- server component와 client component 분리 기준
- 데이터 fetch와 cache/revalidate 전략
- 기존 CSR 화면과 비교한 성능·번들·하이드레이션 관찰
- 의도적으로 잘못 나눈 경계와 그 결과

## 완성 기준 (Definition of Done)

- [ ] DevTools Performance trace로 style/layout/paint/composite 또는 long task 병목을 하나 이상 설명했다.
- [ ] DOM 읽기/쓰기 순서 때문에 발생하는 forced synchronous layout을 재현하고 개선 전/후를 비교했다.
- [ ] Network waterfall에서 LCP 후보 리소스와 주요 JS/CSS/font/image 요청의 발견 시점·우선순위를 분석했다.
- [ ] CORS simple request와 preflight를 재현하고 preflight 발생 조건을 설명했다.
- [ ] Core Web Vitals 기준선과 개선 후 수치를 비교했다. LCP/CLS/INP 중 2개 이상을 다뤘다.
- [ ] 성능 개선마다 원인-조치-효과-부작용을 기록했다.
- [ ] XSS 입력 경로, CSP, 쿠키 속성, CSRF, 토큰 저장 위치를 포함한 보안 점검 표를 완성했다.
- [ ] CSR/SSR/SSG/ISR/RSC 렌더링 전략 비교 ADR을 작성했다.
- [ ] Next.js App Router + RSC 미니 프로젝트를 완성했다. server/client component, loading/error boundary, cache/revalidate 전략이 포함되어 있다.
- [ ] 기존 CSR 화면과 Next.js 화면을 TTFB, LCP, JS bundle, hydration, 캐시 전략 중 3개 이상으로 비교했다.

## 진행 팁

- trace, waterfall, Lighthouse 결과는 파일명에 날짜·commit·조건을 넣어 보관한다. 예: `2026-07-07-baseline-mobile-4g.trace.json`.
- Lighthouse 점수 하나로 결론을 내리지 않는다. 점수는 증상 요약이고, 원인은 trace와 waterfall에서 찾아야 한다.
- 성능 개선 커밋은 작게 나눈다. "이미지 크기 조정", "LCP preload", "폰트 display 전략"이 한 커밋에 들어가면 효과를 분리하기 어렵다.
- 보안 헤더는 가능하면 Report-Only로 먼저 검증한다. CSP를 바로 강제하면 정상 스크립트까지 막아 원인 파악이 어려워질 수 있다.
- `use client`는 가능한 아래로 내린다. 경계를 위로 올릴수록 브라우저 번들과 하이드레이션 대상이 커진다.
- RSC에서 "서버에서 실행된다"는 사실만 보지 말고, 어떤 값이 직렬화 경계를 넘는지 확인한다. 함수, 클래스 인스턴스, 브라우저 객체가 넘어가려는 순간 설계 경계가 잘못 잡힌 것이다.
