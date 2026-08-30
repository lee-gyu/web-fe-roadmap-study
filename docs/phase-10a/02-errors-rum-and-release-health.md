# 10a-2. 오류·RUM·릴리스 건강도

> 한 줄 요약: 이 문서를 읽고 나면 실제 사용자에게 발생한 오류와 성능 저하를 해석 가능한 신호로 만들고, 그 신호를 릴리스와 연결해 "이번 배포를 되돌려야 하는가"를 근거로 판정할 수 있다.

이 문서는 [10a-1](./01-observability-mental-model.md)에서 세운 신호 모델과 상관관계 식별자를 전제로 한다. Core Web Vitals의 정의·기준값·subpart 분해는 [8-3](../phase-8/03-web-performance.md)에서 다뤘으므로 반복하지 않고, 여기서는 그 지표를 **실사용자 분포와 릴리스 차원**으로 보는 관점에 집중한다. React 예제는 React 19 기준이며, `web-vitals`는 v5를 기준으로 한다. SLO 알림 구성은 Google SRE Workbook의 multiwindow multi-burn-rate 방식을 따른다.

## 학습 목표

- 오류가 발생할 수 있는 경로를 모두 열거하고, 각 경로가 전역 핸들러에 도달하는지 검증할 수 있다.
- 릴리스 식별과 source map 파이프라인을 설계해 minify된 스택 트레이스를 원본 위치로 복원할 수 있다.
- 오류 그룹화가 과도하게 분할되거나 병합되는 조건을 진단하고 fingerprint를 교정할 수 있다.
- Core Web Vitals를 route·기기·릴리스 차원의 분포로 해석하고, attribution 정보로 조치 계층을 고를 수 있다.
- 사용자 영향 기반 SLI와 에러 버짓 소진율 알림을 설계하고, 클라이언트 측정의 편향을 명시할 수 있다.

## 배경: 왜 이것이 존재하는가

오류 추적 SDK를 붙이는 것은 30분이면 끝난다. 그런데 3개월 뒤 대부분의 팀에서 관측되는 상태는 비슷하다. 이슈 목록에 수천 개의 항목이 쌓여 있고, 상위 항목은 확장 프로그램이 만든 오류이며, 스택 트레이스는 `main.a3f9.js:1:28471`이고, 알림 채널은 음소거되어 있다.

문제는 도구가 아니라 **신호를 판정 가능한 형태로 만드는 과정**이 빠진 것이다. 그 과정은 네 단계다.

```text
1. 도달   오류가 실제로 핸들러까지 오는가        → 삼켜진 오류, cross-origin 익명화
2. 해석   스택이 우리 코드의 어느 줄인가          → 릴리스 식별, source map
3. 집약   같은 결함의 이벤트가 하나로 묶이는가    → fingerprint, 잡음 분리
4. 판정   지금 조치해야 하는가                    → 사용자 영향 기반 SLI, 에러 버짓
```

각 단계가 빠지면 다음 단계가 무의미해진다. 도달하지 않은 오류는 해석할 수 없고, 해석되지 않은 스택은 집약해도 쓸모없고, 집약되지 않은 이벤트로는 영향도를 계산할 수 없다.

성능도 같은 구조다. field에서 LCP가 나쁘다는 사실 자체는 조치가 아니다. **어떤 route의, 어떤 기기 등급에서, 어떤 릴리스 이후로, LCP의 어느 구간이 늘었는가**까지 좁혀져야 조치 계층이 정해진다.

마지막 단계인 판정이 릴리스와 연결되는 지점이 이 문서의 종착점이다. 프론트엔드 배포는 되돌리기가 상대적으로 쉬운 편이지만, **되돌려야 하는지 판단할 근거**가 없으면 그 이점을 쓸 수 없다.

## 핵심 개념

### 오류는 여러 경로로 발생하고, 기본값은 새는 쪽이다

"전역 핸들러를 등록했으니 다 잡힌다"는 대부분 사실이 아니다. 경로별로 확인해야 한다.

| 발생 경로 | 전역 `error` 핸들러 | 비고 |
|---|---|---|
| 동기 코드의 예외 | 도달 | 기본 경로 |
| `setTimeout`/이벤트 핸들러 안의 예외 | 도달 | 각 태스크의 최상위로 전파된다 |
| `async` 함수의 예외 (await 하지 않음) | **미도달** | `unhandledrejection`으로 온다 |
| `.catch()`가 붙은 Promise 거부 | **미도달** | 처리된 것으로 간주된다 |
| `try/catch`로 잡아 대체 UI 표시 | **미도달** | `reportError()`로 승격해야 한다 |
| `<script>`/`<img>` 로드 실패 | 캡처 단계에서만 | 버블링하지 않는다 |
| React 렌더 중 예외 | **미도달** | React가 잡아 error boundary로 보낸다 |
| Web Worker 내부 예외 | **미도달** | worker 스코프에서 별도 등록 필요 |
| cross-origin 스크립트의 예외 | 도달하나 익명화 | 다음 절에서 설명 |

React 애플리케이션에서 가장 큰 구멍은 렌더 중 예외다. React는 이를 잡아 자체 경계로 보내므로 `window.onerror`에 오지 않는다. React 19는 루트 옵션으로 이 세 경로를 모두 노출한다.

```jsx
import { createRoot } from 'react-dom/client';

const root = createRoot(container, {
  // error boundary가 잡은 오류. 사용자에게는 대체 UI가 보였지만 결함은 존재한다.
  onCaughtError: (error, errorInfo) => {
    report(error, { handled: true, componentStack: errorInfo.componentStack });
  },
  // 어떤 경계도 잡지 못해 트리 전체가 언마운트된 오류. 가장 심각하다.
  onUncaughtError: (error, errorInfo) => {
    report(error, { handled: false, fatal: true, componentStack: errorInfo.componentStack });
  },
  // React가 스스로 복구한 오류. hydration mismatch가 대표적이다.
  onRecoverableError: (error, errorInfo) => {
    report(error, { handled: true, recoverable: true, componentStack: errorInfo.componentStack });
  },
});
```

`onRecoverableError`는 특히 유용하다. hydration mismatch는 사용자에게 보이지 않게 클라이언트 렌더로 복구되지만, 그 복구 자체가 성능 비용이고 서버·클라이언트 렌더 불일치라는 결함의 증상이다. 이 신호가 없으면 [SSR 경계](../phase-5b/02-server-side-rendering.md)의 문제를 영영 모른다.

`componentStack`을 함께 보내는 것도 중요하다. minify된 JavaScript 스택만으로는 "어느 컴포넌트에서"가 드러나지 않는 경우가 많다.

**검증 방법**: 각 경로마다 의도적 오류를 하나씩 심고, 실제로 수집 엔드포인트에 도달하는지 확인한다. 코드 리뷰로는 이 표를 채울 수 없다.

```js
// 개발 환경 전용 진단 라우트. 각 버튼이 서로 다른 경로를 유발한다.
const triggers = {
  sync: () => { throw new Error('sync-throw'); },
  async: async () => { throw new Error('async-throw'); },   // unhandledrejection
  swallowed: () => { try { throw new Error('swallowed'); } catch (e) { reportError(e); } },
  resource: () => { const s = document.createElement('script'); s.src = '/missing.js'; document.head.append(s); },
  render: () => { setShouldThrowInRender(true); },          // onCaughtError / onUncaughtError
};
```

### `Script error.`는 CORS 정책의 결과다

cross-origin에서 로드된 스크립트가 던진 오류는 메시지·파일명·줄 번호가 제거되고 `"Script error."`만 남는다. 이것은 버그가 아니라 의도된 격리다. 오류 메시지에 다른 오리진의 내용이 담길 수 있어서, 그대로 노출하면 스크립트 실행을 통한 정보 유출 경로가 된다.

CDN에서 번들을 서빙하는 구성에서는 이 문제가 기본값으로 발생한다. 해결에는 **양쪽 모두**가 필요하다.

```html
<!-- 클라이언트: CORS 모드로 요청한다고 선언 -->
<script src="https://cdn.example.com/app.a3f9.js" crossorigin="anonymous"></script>
```

```http
# 서버/CDN: 해당 오리진에 응답 공유를 허용
Access-Control-Allow-Origin: https://app.example.com
```

한쪽만 하면 효과가 없다. `crossorigin`만 붙이고 CORS 헤더가 없으면 스크립트 로드 자체가 실패하고, 헤더만 있고 `crossorigin`이 없으면 여전히 익명화된다.

번들러가 생성하는 태그에도 적용해야 한다. Vite는 `build.modulePreload`와 `<script type="module">` 태그에 기본적으로 `crossorigin`을 붙이지만, 수동으로 삽입하는 서드파티 스크립트나 동적 `import()`로 생성되는 태그는 별도 확인이 필요하다.

**관찰 방법**: 이슈 목록에서 `Script error.`가 상위에 있고 스택이 비어 있다면 이 설정이 빠진 것이다. 수정 후 같은 오류가 실제 메시지와 함께 나타나기 시작하면, 오류가 늘어난 것이 아니라 **이제야 보이기 시작한 것**이다.

### 스택 트레이스 복원: 릴리스 식별이 먼저다

`main.a3f9.js:1:28471`을 `src/features/checkout/usePayment.ts:87:12`로 되돌리는 것은 source map의 일이다. 그런데 실무에서 실패하는 지점은 대개 source map 자체가 아니라 **어떤 빌드의 map인지 모른다**는 데 있다.

파이프라인은 세 조각이다.

```text
① 빌드 시점: 릴리스 식별자를 코드에 주입한다 (보통 Git SHA)
② 빌드 시점: source map을 생성하되 공개 배포하지 않고 오류 추적 시스템에 업로드한다
③ 런타임:   오류 이벤트에 릴리스 식별자를 실어 보낸다 → 업로드된 map과 매칭
```

```js
// vite.config.ts — 개념 예시. 옵션 이름은 사용 중인 번들러 문서로 확인한다.
export default defineConfig({
  define: {
    // 런타임에서 읽을 릴리스 식별자를 빌드 시점에 상수로 박는다
    __RELEASE__: JSON.stringify(process.env.GIT_SHA),
  },
  build: {
    // 'hidden': .map 파일은 생성하되 번들 끝의 sourceMappingURL 주석은 넣지 않는다
    sourcemap: 'hidden',
  },
});
```

`sourcemap: true`와 `'hidden'`의 차이가 핵심이다. `true`는 번들 끝에 `//# sourceMappingURL=main.a3f9.js.map` 주석을 남기므로, 누구나 원본 소스를 내려받을 수 있다. `'hidden'`은 map 파일을 만들되 주석을 넣지 않아, **업로드한 쪽만** 매핑을 가진다. CI에서 업로드 후 배포 디렉터리에서 `.map` 파일을 삭제하는 단계까지 포함해야 완결된다.

주석 없이 어떻게 매칭하는가? 전통적으로는 `릴리스 식별자 + 파일 경로` 조합을 키로 쓴다. 이 방식은 배포 경로가 바뀌거나 같은 파일명이 여러 배포에 걸치면 어긋난다. 이 취약성을 없애기 위해 TC39 source map 작업(ecma426)에서 **Debug ID** 제안이 진행 중이다. 번들러가 빌드마다 UUID를 생성해 번들과 map 양쪽에 심어 두면, 릴리스 식별자 없이도 파일과 map이 1:1로 매칭된다. 일부 번들러가 이미 지원하지만 표준화 진행 중이므로, 도입 시점에 각 도구의 문서를 확인해야 한다.

**검증 방법**: 프로덕션 빌드에서 의도적으로 오류를 발생시키고, 오류 추적 시스템에서 원본 파일·줄·함수명이 보이는지 확인한다. 배포 자산을 `curl`로 받아 `sourceMappingURL` 문자열이 없는지도 함께 확인한다.

```bash
curl -s https://cdn.example.com/assets/main.a3f9.js | tail -c 200 | grep -c sourceMappingURL  # 0이어야 한다
curl -sI https://cdn.example.com/assets/main.a3f9.js.map | head -1                            # 404여야 한다
```

### 오류 그룹화: 같은 결함을 하나로 묶기

프로덕션에서 결함 하나는 수천 개의 이벤트를 만든다. 이를 이슈 하나로 묶는 것이 fingerprinting이고, 대개 **정규화된 메시지 + 스택 상위 프레임**을 해시해 만든다. 이 규칙이 어긋나는 방향은 두 가지다.

**과도한 분할 — 같은 결함이 수백 개 이슈로 흩어진다**

| 원인 | 증상 | 교정 |
|---|---|---|
| 메시지에 가변값이 섞임 | `Failed to load order 8f2c-...`가 주문 수만큼 이슈 생성 | 메시지 템플릿과 변수를 분리한다. 변수는 컨텍스트 속성으로 |
| 릴리스마다 스택 프레임이 바뀜 | 배포할 때마다 "새 이슈"로 나타난다 | fingerprint를 파일 경로+함수명 기준으로 정규화 |
| 익명 함수와 인라인 스크립트 | `<anonymous>:1:1`이 스택 상단 | 함수에 이름을 주거나 상위 프레임까지 포함 |
| 사용자 입력이 메시지에 포함 | 검색어마다 별도 이슈 | 입력값을 메시지에서 제거 |

**과도한 병합 — 서로 다른 원인이 한 이슈로 묶인다**

`TypeError: Cannot read properties of undefined`처럼 흔한 메시지가 여러 모듈에서 발생하면, 스택 정규화가 지나칠 때 하나로 합쳐진다. 증상은 "이슈 하나에 서로 다른 route와 브라우저가 섞여 있고, 고쳐도 건수가 줄지 않는다"이다. 이때는 fingerprint에 route나 상위 프레임을 추가해 분리한다.

실무 요령은 **상위 5개 이슈를 직접 열어 보는 것**이다. 이슈 안의 이벤트 샘플이 서로 같은 원인인지, 이슈 목록에 비슷한 제목이 반복되는지 눈으로 확인하면 두 방향의 오류를 대부분 잡아낸다.

### 잡음은 지우지 말고 분리한다

이슈 목록의 상당 부분은 우리가 고칠 수 없는 것이다.

- 확장 프로그램이 주입한 스크립트(`chrome-extension://`, `moz-extension://` 프레임)
- 봇·크롤러·자동화 도구
- 사용자가 페이지를 떠나며 취소한 요청(`AbortError`)
- 오프라인·터널 진입으로 인한 `TypeError: Failed to fetch`
- `ResizeObserver loop completed with undelivered notifications`처럼 대부분 무해한 경고

이들을 완전히 버리지 말고 **별도 버킷으로 옮긴다.** 이유가 있다. `Failed to fetch`의 절대량은 평소에 노이즈지만, 그 비율이 급증하면 CDN 장애나 CORS 설정 사고의 첫 신호다. 확장 프로그램 오류도 특정 확장의 업데이트가 우리 페이지를 깨뜨리는 사건을 알려 준다.

```js
// 필터가 아니라 분류다. 버킷을 나누고 각 버킷의 추이를 별도로 본다.
function classify(event) {
  const frames = event.stack?.frames ?? [];
  if (frames.some((f) => f.filename?.startsWith('chrome-extension://'))) return 'extension';
  if (event.name === 'AbortError') return 'user-cancelled';
  if (isKnownNetworkFailure(event)) return 'network';
  return 'application';
}
```

알림은 `application` 버킷에만 건다. 나머지는 대시보드에서 추이만 본다.

### RUM: 지표는 분포이며, 차원 없이는 조치할 수 없다

field 성능 수집은 `web-vitals`로 시작하는 것이 가장 실용적이다. bfcache 복원과 `visibilitychange` flush 같은 까다로운 처리가 이미 들어 있고, 다른 도구와 값이 비교 가능해진다.

```js
import { onLCP, onINP, onCLS, onTTFB } from 'web-vitals/attribution';

function send(metric) {
  queue.push({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,          // 'good' | 'needs-improvement' | 'poor'
    navigationType: metric.navigationType, // bfcache 복원 여부 구분에 필요
    attribution: metric.attribution, // 원인 귀속 정보
    // 차원: 이것이 없으면 조치 대상을 특정할 수 없다
    release: __RELEASE__,
    route: getRoutePattern(),        // '/orders/:id' — 실제 URL이 아니다
    deviceMemory: navigator.deviceMemory,
    connection: navigator.connection?.effectiveType,
  });
}

onLCP(send);
onINP(send);
onCLS(send);
onTTFB(send);
```

`web-vitals/attribution` 빌드는 표준 빌드보다 약간 크지만(brotli 기준 1.5KB 내외) 진단 가치가 크게 다르다. LCP는 어떤 요소가 후보였는지와 TTFB·load delay·load duration·render delay의 구간 분해를, INP는 어떤 요소의 어떤 이벤트였는지와 input/processing/presentation 구간을 알려 준다. 이 정보 없이는 "LCP p75가 3.4초"라는 사실에서 조치로 넘어갈 수 없다.

**차원 설계에서 가장 중요한 것은 route 정규화**다. 실제 URL을 그대로 쓰면 카디널리티가 폭발하고([10a-1](./01-observability-mental-model.md)), 동시에 같은 화면의 데이터가 흩어져 p75를 계산할 표본이 모이지 않는다.

분포로 봐야 하는 이유는 실제 사례에서 분명해진다.

```text
전체 LCP p75 = 2.4초  (기준 통과)

route 분해:
  /              1.6초   (트래픽 70%)
  /search        2.1초   (트래픽 22%)
  /orders/:id    6.8초   (트래픽  8%)   ← 전체 p75에 거의 묻힌다

기기 분해 (/orders/:id):
  고사양          3.1초
  저사양          9.4초                 ← 실제 문제의 위치
```

전체 지표만 보면 "기준을 통과했다"로 끝난다. 정작 매출과 직결되는 주문 상세 화면의 저사양 기기 사용자는 10초를 기다리고 있다. **전체 지표는 개선 대상을 찾는 데 거의 쓸모가 없다.**

### 사용자 영향 기반 SLI와 SLO

알림을 오류 건수에 걸면 트래픽이 늘 때마다 울리고, 트래픽이 줄면 진짜 장애를 놓친다. 판정 기준은 비율이어야 하며, 그 비율은 사용자 영향을 표현해야 한다.

SLI의 형식은 단순하다.

```text
SLI = 좋은 이벤트 수 / 유효한 이벤트 수
```

프론트엔드에서 쓸 만한 후보와 각각의 함정은 다음과 같다.

| SLI 후보 | 분자 / 분모 | 편향과 주의 |
|---|---|---|
| 핵심 플로우 성공률 | 완료 이벤트 / 시작 이벤트 | 가장 사업 가치에 가깝다. 사용자가 자발적으로 이탈한 경우와 실패를 구분해야 한다 |
| 무오류 세션율 | fatal 오류 없는 세션 / 전체 세션 | 완전히 죽은 세션은 분모에도 없다. 하한선으로만 해석한다 |
| route별 LCP 임계 통과율 | LCP ≤ 2.5s인 방문 / 측정된 방문 | 지표를 못 재는 브라우저를 분모에서 빼야 한다([10a-1](./01-observability-mental-model.md)) |
| 클라이언트 관점 API 성공률 | 2xx 응답 / 시도한 요청 | **서버 5xx 비율과 다르다.** 그 차이가 네트워크·CORS·타임아웃을 드러낸다 |

마지막 항목이 프론트엔드 SLI의 고유 가치다. 서버가 "가용성 99.99%"를 보고하는 동안 클라이언트에서는 5%의 요청이 실패하고 있을 수 있다. 그 5%는 서버에 도달조차 못한 요청이므로 서버 지표에 존재하지 않는다.

**분모가 항상 과소 추정된다**는 사실은 SLI 문서에 명시해야 한다. 이것을 적어 두지 않으면 나중에 "우리 지표는 99.9%인데 왜 문의가 들어오는가"라는 혼란이 반복된다.

SLO는 목표값과 기간이다. 예를 들어 "결제 플로우 성공률 28일 기준 99.5%". 여기서 **에러 버짓**은 `1 - SLO = 0.5%`이고, 알림은 이 버짓을 얼마나 빨리 소진하는가(burn rate)에 건다. burn rate 1은 기간 끝에 정확히 버짓을 다 쓰는 속도다.

| 심각도 | 긴 창 | 짧은 창 | burn rate | 소진되는 버짓 |
|---|---|---|---|---|
| 즉시 호출 | 1시간 | 5분 | 14.4 | 2% |
| 즉시 호출 | 6시간 | 30분 | 6 | 5% |
| 티켓 | 3일 | 6시간 | 1 | 10% |

짧은 창을 함께 두는 이유는 **지금도 타고 있는가**를 확인하기 위해서다. 긴 창만 쓰면 이미 끝난 사건 때문에 알림이 몇 시간씩 계속 울린다. 두 창이 동시에 임계를 넘을 때만 발화시키면, 상황이 정상화되고 몇 분 내에 알림도 해제된다.

이 표는 SRE Workbook이 99.9% SLO를 예시로 제시한 출발점이다. 트래픽이 적은 서비스에서는 짧은 창의 표본이 부족해 오탐이 생기므로 창을 늘리거나 최소 이벤트 수 조건을 함께 건다.

**알림은 원인이 아니라 영향에 건다.** "번들 크기가 늘었다", "특정 오류가 100건 발생했다"는 대시보드에서 볼 것이지 사람을 깨울 것이 아니다. 깨울 가치가 있는 것은 "핵심 플로우 성공률이 버짓을 14배 속도로 소진 중"뿐이다.

### 릴리스 건강도: 되돌릴지 언제 판정하는가

프론트엔드 배포에는 서버와 다른 성질이 있다. **구 버전이 즉시 사라지지 않는다.** 열어 둔 탭은 며칠씩 옛 번들을 실행하고, CDN 캐시와 브라우저 캐시가 교체를 지연시킨다. 그래서 릴리스별 지표는 배포 직후 다음과 같이 움직인다.

```text
배포 직후 10분:  새 릴리스 세션 수 200      → 오류율 2.5% (표본 부족, 변동 큼)
배포 후 1시간:   새 릴리스 세션 수 12,000   → 오류율 0.8% (판정 가능)
배포 후 6시간:   새 릴리스 세션 수 90,000   → 오류율 0.7% (안정)
```

배포 직후 10분의 2.5%로 롤백을 결정하면 오탐이 잦다. 판정 규칙은 **채택률(adoption)과 최소 표본 수를 조건에 넣어** 세운다.

```text
롤백 판정 조건 (예시)
  - 새 릴리스 세션 수 ≥ 5,000  AND
  - 새 릴리스 fatal 오류율 ≥ 이전 릴리스 × 2  AND
  - 해당 오류가 이전 릴리스에서 관측되지 않음(regression)
  → 자동 알림, 사람이 롤백 판단
```

배포 때마다 반복해서 나타나는 프론트엔드 고유의 신호가 하나 더 있다.

**`ChunkLoadError` (동적 import 실패)**는 구조적으로 발생한다. 사용자가 구 버전 HTML을 열어 둔 상태에서 새 배포가 일어나면, 구 HTML이 참조하는 청크 파일명(`chunk-a3f9.js`)이 서버에서 사라진다. 그 뒤 사용자가 lazy route로 이동하면 404가 나고 `import()`가 거부된다.

- **정상 범위**: 배포 직후 잠깐 증가했다가 감소하는 패턴. 배포마다 반복된다.
- **이상 신호**: 배포와 무관한 시점의 급증(CDN 설정 사고, 자산 배포 누락), 또는 배포 후 몇 시간이 지나도 줄지 않는 경우.
- **완화**: 이전 릴리스의 자산을 일정 기간 함께 서빙한다(가장 효과적이다). 그리고 청크 로드 실패를 감지하면 한 번 새로고침해 최신 HTML을 받도록 한다.

```jsx
// lazy import 실패 시 1회만 새로고침한다. 무한 새로고침 루프를 반드시 막는다.
const RETRY_KEY = 'chunk-reload';

const OrderDetail = lazy(() =>
  import('./OrderDetail').catch((error) => {
    report(error, { kind: 'chunk-load' });
    if (!sessionStorage.getItem(RETRY_KEY)) {
      sessionStorage.setItem(RETRY_KEY, '1');
      location.reload();
    }
    throw error; // 재시도했는데도 실패하면 error boundary가 처리한다
  }),
);
```

이 처리를 넣더라도 **오류 보고는 그대로 유지해야 한다.** 새로고침으로 사용자 경험이 복구되더라도, 발생 빈도는 배포·캐시 설정의 건강도를 보여 주는 지표다.

## 실무 관점

### 배포 직후에 봐야 할 것과 보지 말아야 할 것

| 본다 | 이유 |
|---|---|
| 새 릴리스에서만 나타난 오류(regression) | 배포와의 인과가 가장 명확하다 |
| fatal 오류율(릴리스별, 세션 기준) | 사용자 영향의 직접 지표 |
| 핵심 플로우 성공률 | 조용한 실패를 잡는 유일한 신호 |
| 청크 404 비율 | 자산 배포 누락을 즉시 드러낸다 |
| 새 릴리스의 CWV p75 (표본이 충분해진 뒤) | 성능 회귀는 오류보다 늦게 드러난다 |

| 보지 않는다 | 이유 |
|---|---|
| 절대 오류 건수 | 트래픽에 비례한다. 배포와 무관한 변동에 반응하게 된다 |
| 배포 후 5분간의 비율 지표 | 표본이 부족해 변동이 크다 |
| Lighthouse 점수 | lab 지표다. 릴리스 판정 근거가 아니다 |
| 전체 평균 LCP | 회귀가 특정 route에 국한되면 묻힌다 |

### 안티패턴

- **source map 없이 오류 추적만 켜기** — 스택을 읽을 수 없으니 이슈가 쌓이기만 하고 아무도 열지 않는다. 릴리스 식별과 map 업로드는 SDK 설치와 같은 작업 단위로 취급한다.
- **`.map` 파일을 공개 배포** — `sourceMappingURL` 주석이 남아 있으면 원본 소스가 그대로 노출된다. 배포 자산에서 확인하는 절차를 CI에 넣는다.
- **모든 이슈에 알림 걸기** — 알림 피로가 탐지 능력을 실제로 파괴한다. 알림은 SLI 기반으로 소수만 남기고, 나머지는 대시보드에서 본다.
- **오류율만 보고 성능 회귀를 놓침** — 성능 저하는 오류를 만들지 않는다. 릴리스 차원의 CWV 비교가 없으면 몇 주 뒤에야 발견한다.
- **오류를 잡아 대체 UI만 표시** — 사용자 경험은 나아지지만 결함이 관측에서 사라진다. `reportError()`나 `onCaughtError`로 반드시 승격시킨다.
- **취소된 요청을 실패로 집계** — 사용자가 페이지를 떠나며 발생한 `AbortError`가 API 성공률 SLI를 깎아, 진짜 장애의 신호를 덮는다.

## 더 깊이

**세션 기준과 사용자 기준은 다른 것을 말한다**

"무오류 세션율 99%"와 "무오류 사용자율 99%"는 전혀 다른 값이다. 한 사용자가 하루에 20세션을 만들면, 세션 기준 1% 실패는 사용자 기준으로 거의 20%에 가까워질 수 있다. 어느 쪽이 맞는가는 질문에 달렸다.

- **세션 기준**: "얼마나 자주 깨지는가" — 릴리스 간 비교와 회귀 탐지에 적합하다.
- **사용자 기준**: "몇 명이 영향을 받았는가" — 장애 보고와 우선순위 결정에 적합하다.

장애 리포트에는 사용자 기준 추정치를 쓰되, 그 추정이 텔레메트리 표본율과 도달 실패를 반영한 하한선이라는 점을 명시한다.

**SLI에 어떤 이벤트를 "유효"로 넣을 것인가**

분모 정의가 SLI의 절반이다. 결제 성공률에서 다음을 분모에 넣을지 각각 결정해야 한다.

- 사용자가 결제 직전에 스스로 취소한 세션 → 보통 제외(우리 실패가 아니다)
- 카드사 거절로 실패한 결제 → 보통 제외하되 별도 지표로 추적
- 네트워크 단절로 요청이 나가지 못한 경우 → **포함**(사용자에게는 실패다)
- 봇 트래픽 → 제외

이 결정은 SLO 문서에 적어 둔다. 적지 않으면 6개월 뒤 다른 사람이 다르게 계산해 지표가 조용히 바뀐다.

## 정리

- 오류는 여러 경로로 발생하고 상당수가 기본적으로 전역 핸들러에 도달하지 않는다. 경로별로 실제 도달을 검증해야 한다.
- React 19의 `onCaughtError`/`onUncaughtError`/`onRecoverableError`로 렌더 경계의 오류와 hydration 복구를 관측한다.
- `Script error.`는 CORS 격리의 결과이며, `crossorigin` 속성과 `Access-Control-Allow-Origin`이 **양쪽 모두** 필요하다.
- 스택 복원은 릴리스 식별자 주입 + hidden source map 업로드 + 배포 자산에서 map 제거의 세 단계로 완결된다.
- 오류 그룹화는 과분할과 과병합 양방향으로 실패하며, 상위 이슈를 직접 열어 보는 것이 가장 빠른 진단이다.
- 잡음은 삭제하지 말고 버킷을 나눈다. 잡음의 비율 급증은 그 자체로 장애 신호다.
- CWV는 route·기기·릴리스 차원의 분포로 봐야 조치 대상이 드러난다. 전체 p75는 문제를 숨긴다.
- 알림은 원인이 아니라 사용자 영향 SLI의 에러 버짓 소진율에 걸고, 긴 창과 짧은 창을 함께 쓴다.
- 릴리스 판정에는 채택률과 최소 표본 수 조건이 필요하며, 청크 404는 구조적으로 발생하므로 정상 패턴과 이상 급증을 구분한다.

## 확인 문제

1. 오류 추적 도구를 도입하고 CORS·`crossorigin` 설정을 고친 다음 주에, 주간 오류 건수가 3배로 늘었다. 릴리스에는 기능 변경이 없었다. 무엇이 일어났고 어떻게 확인하는가?

<details>
<summary>정답과 해설</summary>

오류가 늘어난 것이 아니라 **이전에 익명화되어 하나로 뭉쳐 있던 오류가 보이기 시작한 것**일 가능성이 높다. cross-origin 스크립트의 오류는 `Script error.` 하나로만 보고되므로, 실제로는 수십 개의 서로 다른 결함이 단일 이슈에 묻혀 있었다.

확인 방법은 두 가지다. ① 설정 변경 전후로 `Script error.` 이슈의 건수가 급감하고 새 이슈들이 그만큼 생겼는지 본다. 총량이 비슷하게 이동했다면 노출 증가다. ② 세션 수 대비 오류율(비율)을 비교한다. 건수가 늘었어도 비율이 그대로면 관측 범위가 넓어진 것이지 품질이 나빠진 것이 아니다.

이 사례가 알림을 절대 건수에 걸면 안 되는 이유이기도 하다.

</details>

2. 결제 API의 서버 측 가용성은 99.99%인데, 클라이언트에서 측정한 결제 API 성공률은 96%다. 이 4%의 간극이 가리키는 원인 후보를 나열하고, 각각을 어떻게 구분하는가?

<details>
<summary>정답과 해설</summary>

서버에 **도달하지 못했거나 응답이 클라이언트에 닿지 못한** 요청이다. 서버 지표에는 존재하지 않으므로 클라이언트 신호로만 보인다. 후보와 구분 방법:

- **네트워크 단절·불안정**: `TypeError: Failed to fetch`. 네트워크 타입(`effectiveType`)과 지역 차원으로 분해하면 특정 통신 환경에 몰려 있는지 보인다.
- **CORS 설정 오류**: 역시 `Failed to fetch`로 나타나지만 특정 브라우저나 특정 엔드포인트에 집중되고, preflight `OPTIONS`가 실패한다. Network 패널이나 CDN 로그의 `OPTIONS` 응답 코드로 구분한다.
- **클라이언트 타임아웃**: 서버는 200으로 응답했지만 클라이언트가 먼저 끊었다. 서버의 응답 시간 분포와 클라이언트 타임아웃 설정을 비교한다.
- **사용자 취소**: `AbortError`. 페이지 이탈과 함께 발생하며, 애초에 실패로 집계하면 안 된다.
- **CDN·프록시 계층**: 서버 앞단에서 반환된 5xx는 애플리케이션 서버 지표에 안 잡힌다. 엣지 로그를 봐야 한다.
- **중간 네트워크 장비**: 사내 프록시나 보안 소프트웨어가 요청을 차단. 특정 조직 IP·시간대에 집중된다.

구분의 출발점은 오류 종류(`AbortError` / `Failed to fetch` / 타임아웃 / HTTP 상태)와 차원 분해(네트워크·지역·브라우저·엔드포인트)다. 그리고 `AbortError`는 SLI 분모에서 빼야 나머지 신호가 드러난다.

</details>

3. 배포 5분 뒤 "새 릴리스 오류율이 이전 릴리스의 3배"라는 알림이 울렸다. 즉시 롤백해야 하는가?

<details>
<summary>정답과 해설</summary>

바로 롤백하기 전에 표본 수를 봐야 한다. 배포 직후에는 새 릴리스의 세션이 수백 건 수준이라 비율이 크게 흔들린다. 오류 20건과 5건의 차이가 "3배"로 표시될 수 있다.

확인 순서는 이렇다. ① 새 릴리스의 세션 수(분모)가 판정 가능한 규모인가. ② 그 오류가 이전 릴리스에도 존재했는가(regression인가, 원래 있던 오류가 표본 때문에 도드라진 것인가). ③ fatal인가, 대체 UI로 복구되는가. ④ 영향받은 고유 사용자 수와 route는 무엇인가.

동시에 **롤백은 되돌리기 쉬운 조치라는 점**도 판단에 넣어야 한다. fatal 오류가 핵심 플로우에서 명확히 새 릴리스에만 나타난다면, 표본이 더 쌓이기를 기다리는 것보다 되돌리고 분석하는 편이 낫다. 판정 규칙을 사전에 문서화해 두면(최소 세션 수 + regression 여부 + 심각도) 이 논쟁을 매번 반복하지 않는다.

</details>

4. 어떤 팀의 SLI가 "무오류 세션율 99.7%"인데, 고객 문의는 계속 들어온다. 지표와 현실이 어긋나는 구조적 이유를 두 가지 이상 설명하라.

<details>
<summary>정답과 해설</summary>

첫째, **분모가 과소 추정된다.** 앱이 아예 부팅되지 않은 사용자는 세션을 만들지도, 오류를 보고하지도 못한다. 이들은 분자에도 분모에도 없으므로 지표가 좋아 보인다. 광고 차단기로 수집 엔드포인트가 막힌 사용자도 마찬가지다. 이 지표는 항상 **낙관적 하한선**으로 읽어야 한다.

둘째, **오류가 나지 않는 실패가 있다.** 버튼이 반응하지 않고, 데이터가 비어 보이고, 응답이 30초 걸리는 경험은 예외를 던지지 않는다. 무오류 세션율은 이런 실패를 전혀 세지 않는다. 그래서 핵심 플로우 완료율이나 응답성 지표(INP)를 SLI로 함께 둬야 한다.

셋째, **세션 기준과 사용자 기준의 차이**다. 세션 기준 0.3% 실패도, 한 사용자가 하루 여러 세션을 만들면 훨씬 많은 사람이 한 번 이상 겪는다.

조치는 SLI를 사용자 영향에 더 가까운 것(핵심 플로우 완료율)으로 보완하고, 클라이언트 밖의 관측점(CDN 로그, 합성 모니터링)으로 도달 실패를 교차 확인하고, SLI 문서에 편향을 명시하는 것이다.

</details>

## 참고 자료

- [React: createRoot](https://react.dev/reference/react-dom/client/createRoot) — `onCaughtError`, `onUncaughtError`, `onRecoverableError`의 발화 조건과 인자를 정의한다.
- [MDN: Window error event](https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event) — 런타임 오류와 리소스 로드 실패의 구분, cross-origin 익명화 조건을 설명한다.
- [MDN: crossorigin attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/crossorigin) — `Script error.`를 없애기 위해 필요한 클라이언트 측 설정이다.
- [MDN: unhandledrejection event](https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event) — 처리되지 않은 Promise 거부가 어떻게 관측되는지 설명한다.
- [Vite: build.sourcemap](https://vite.dev/config/build-options.html#build-sourcemap) — `'hidden'` 옵션이 `sourceMappingURL` 주석을 생략하는 동작을 확인한다.
- [TC39 ecma426: Debug ID proposal](https://github.com/tc39/ecma426/blob/main/proposals/debug-id.md) — 번들과 source map을 릴리스 식별자 없이 매칭하는 제안의 현재 상태를 확인한다.
- [GoogleChrome/web-vitals](https://github.com/GoogleChrome/web-vitals) — `onLCP`/`onINP`/`onCLS` API와 attribution 빌드가 제공하는 귀속 정보를 확인한다.
- [web.dev: Debug performance in the field](https://web.dev/articles/debug-performance-in-the-field) — attribution 데이터를 실제 진단에 쓰는 절차를 설명한다.
- [Google SRE Workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) — multiwindow multi-burn-rate 알림의 burn rate·창 크기 조합과 근거를 제시한다.
- [Google SRE Workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/) — SLI를 `좋은 이벤트 / 유효한 이벤트`로 정의하는 형식과 분모 설계를 다룬다.
- [web.dev: Vitals field measurement best practices](https://web.dev/articles/vitals-field-measurement-best-practices) — field 지표 수집 시 표본·차원·전송 설계의 주의점을 정리한다.
