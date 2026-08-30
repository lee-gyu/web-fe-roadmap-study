# 10a-1. 관측 가능성 멘탈 모델

> 한 줄 요약: 이 문서를 읽고 나면 프로덕션에서 무슨 일이 일어났는지 사후에 질문할 수 있도록 신호를 설계하고, 클라이언트가 신뢰할 수 없는 리포터라는 제약 아래에서 무엇을 증거로 삼을지 판단할 수 있다.

이 문서는 W3C Performance Timeline, Reporting API, Trace Context와 WHATWG HTML의 오류 이벤트 정의를 1차 자료로 삼는다. 2026년 8월 집필 시점 기준이며, Reporting API는 2026년 3월 Baseline newly available로 편입됐지만 보고 유형별 지원은 여전히 갈린다. Long Animation Frames는 아직 Baseline이 아니다. 브라우저 지원은 사용 시점에 다시 확인해야 한다.

## 학습 목표

- 모니터링과 관측 가능성을 "사전 정의된 질문"과 "사후 질의 가능성"으로 구분하고, 어느 쪽이 부족한지 판단할 수 있다.
- 메트릭·이벤트·트레이스·세션이 각각 답할 수 있는 질문과 답할 수 없는 질문을 구분할 수 있다.
- 브라우저가 제공하는 계측 표면(`PerformanceObserver`, 오류 이벤트, Reporting API)과 전송 수단(`sendBeacon`, `keepalive`)을 목적에 맞게 고를 수 있다.
- 브라우저의 사건과 서버 로그를 잇는 상관관계 식별자를 설계하고, 그 비용(preflight, 헤더 노출)을 설명할 수 있다.
- 클라이언트 텔레메트리가 구조적으로 놓치는 영역을 지목하고, 카디널리티·샘플링·개인정보 관점에서 수집 범위를 제한할 수 있다.

## 배경: 왜 이것이 존재하는가

[Phase 8](../phase-8/03-web-performance.md)의 성능 계측은 개발자가 통제하는 환경에서 이뤄진다. DevTools를 열고, 네트워크를 스로틀링하고, trace를 찍는다. [Phase 10](../phase-10/01-project-guide.md)은 프로젝트를 배포하는 지점까지 다룬다. 그 사이에 비어 있는 것이 **배포 이후의 피드백 루프**다.

배포된 코드는 우리가 열어 볼 수 없는 환경에서 실행된다. 5년 된 Android 기기, 지하철 안의 불안정한 셀룰러, 사내 프록시, DOM을 재작성하는 번역 확장, 스크립트를 차단하는 프라이버시 확장. 이 환경에서 발생한 결함은 "어떻게 하셨나요?"라는 재현 요청으로 거의 회수되지 않는다. 사용자는 절차를 기억하지 못하고, 대부분은 신고 대신 이탈한다.

전통적인 모니터링은 이 문제를 부분적으로만 푼다. 모니터링은 **질문을 미리 정해 두고** 그 답을 계속 재는 활동이다. "5xx 비율이 1%를 넘는가", "LCP p75가 2.5초를 넘는가". 이 질문들은 유용하지만, 실제 장애는 대개 미리 정해 두지 않은 조합에서 나온다. "iOS 17.4의 Safari에서, 특정 A/B 분기에 있고, 결제 route에 진입한 사용자만" 같은 조합이다.

관측 가능성(observability)은 여기서 갈린다. 원래 제어 이론의 용어로, **외부에서 관측 가능한 출력만으로 시스템 내부 상태를 추론할 수 있는가**를 뜻한다. 소프트웨어에서는 실무적으로 이렇게 번역된다.

> 새로 배포하지 않고도, 지금까지 수집된 데이터에 새로운 질문을 던져 답을 얻을 수 있는가?

대시보드 개수는 이 질문의 답이 아니다. 판정 기준은 **컨텍스트가 충분히 고차원으로 보존되어 있는가**다. 릴리스, route, 브라우저 버전, 기기 등급, 네트워크 종류, 기능 플래그 분기, 세션 ID가 붙어 있는 이벤트라면 사후에 어떤 조합으로도 잘라 볼 수 있다. 숫자 하나만 집계해 두었다면 그 숫자에 대한 질문밖에 할 수 없다.

프론트엔드에서 이 문제는 한 겹 더 꼬인다. 서버는 자기 프로세스 안에서 완결적으로 자신을 관측하지만, **브라우저 계측은 관측 대상이 관측자를 호스팅한다.** 관측 코드가 메인 스레드를 점유하면 그 자체가 INP를 악화시키고, 관측 대상이 크래시하면 관측도 함께 죽는다. 이 자기참조적 제약이 프론트엔드 관측 설계의 출발점이다.

## 핵심 개념

### 클라이언트는 신뢰할 수 없는 리포터다

다른 모든 설계 판단이 이 전제에서 나오므로 먼저 세운다. 서버 로그는 우리 인프라가 기록하지만, 클라이언트 텔레메트리는 **관측 대상 자신이 자발적으로 보내 주는 진술**이다. 진술은 다음 이유로 도달하지 않거나 왜곡된다.

| 실패 방식 | 구체적 상황 | 관측되는 결과 |
|---|---|---|
| 생존 편향 | 번들이 404, JS 파싱 오류, 초기 스크립트 예외 | 아무 신호도 오지 않는다. 오류율이 오히려 **떨어져** 보인다 |
| 차단 | 광고 차단기·프라이버시 확장이 수집 도메인을 차단 | 특정 사용자 집단이 통째로 표본에서 사라진다 |
| 소실 | 전송 직전에 네트워크 단절, 탭 강제 종료, OS의 앱 종료 | 세션 끝부분의 이벤트가 사라진다 |
| 오염 | 확장 프로그램이 주입한 스크립트, 봇, 번역 확장의 DOM 재작성 | 우리 코드가 만들지 않은 오류가 이슈 목록 상위를 차지한다 |
| 조작 | 페이로드는 사용자가 임의로 만들 수 있다 | 클라이언트 신고를 권한 판단이나 과금 근거로 쓸 수 없다 |

가장 위험한 것은 첫 줄이다. **완전히 실패한 사용자는 실패를 보고할 수 없다.** 배포 후 "오류 건수가 줄었다"가 좋은 소식이 아닐 수 있다는 뜻이다. 앱이 아예 부팅되지 않으면 오류 건수도, 세션 수도, 페이지뷰도 함께 줄어든다.

이 공백은 클라이언트 안에서 메울 수 없다. 다른 관측점이 필요하다.

```text
클라이언트 텔레메트리   실행에 성공한 사용자의 경험
CDN/서버 접근 로그      요청은 도달했는가 (분모의 하한선)
합성 모니터링           통제된 조건에서 핵심 플로우가 살아 있는가
인라인 부트 가드        번들 로드 실패 자체를 HTML에서 보고
```

마지막 항목은 프론트엔드 고유의 방어다. 메인 번들이 실행되기 전에 HTML `<head>`의 인라인 스크립트로 최소한의 오류 핸들러를 걸어 두면, 번들이 죽어도 그 사실만은 보고할 수 있다.

```html
<!-- 문서 head 최상단. 번들·SDK가 로드되기 전에 등록된다. -->
<script>
  window.__bootErrors = [];
  addEventListener('error', function (e) {
    // 리소스 로드 실패는 target으로 구분된다 (아래 절에서 설명)
    window.__bootErrors.push({
      kind: e.target && e.target !== window ? 'resource' : 'runtime',
      src: (e.target && (e.target.src || e.target.href)) || e.filename,
      message: e.message,
    });
  }, true);

  // 부팅이 끝났어야 할 시점에도 앱이 살아나지 않았다면 그 사실을 보고한다
  setTimeout(function () {
    if (window.__appBooted || window.__bootErrors.length === 0) return;
    navigator.sendBeacon('/telemetry/boot-failure', JSON.stringify({
      release: '__RELEASE__',
      errors: window.__bootErrors,
      ua: navigator.userAgent,
    }));
  }, 10000);
</script>
```

`__appBooted`는 애플리케이션이 마운트에 성공했을 때 스스로 세우는 플래그다(React라면 루트 렌더 직후). 이 플래그가 없으면 부팅 실패와 정상 동작을 구분할 수 없다.

이 코드는 수집 SDK를 대체하지 않는다. SDK가 로드되지 못한 구간만 덮는다. 관찰 방법: 배포 자산 중 메인 청크의 이름을 임시로 잘못된 값으로 바꾸고 페이지를 열면, DevTools Network 패널에 `boot-failure` 비콘이 나가는 것을 볼 수 있다.

### 네 가지 신호는 서로 다른 질문에 답한다

서버 관측에서 익숙한 세 신호에 프론트엔드는 하나를 더한다.

| 신호 | 형태 | 답할 수 있는 질문 | 답할 수 없는 질문 | 비용 특성 |
|---|---|---|---|---|
| 메트릭 | 시간축 위의 집계 수치 | "언제부터 나빠졌는가", "지금 정상 범위인가" | "누구에게, 왜" | 저렴. 단 태그 조합 수(카디널리티)에 비례해 급증 |
| 이벤트·로그 | 개별 사건 + 컨텍스트 | "이 사용자에게 정확히 무엇이 일어났는가" | "전체 중 몇 %인가"(샘플링 시) | 비쌈. 보존 기간과 볼륨이 비용 |
| 트레이스 | 한 작업이 계층을 가로지른 인과 경로 | "지연이 어느 구간에서 생겼는가" | "이 구간이 원래 얼마나 걸렸는가"(기준선 없음) | 중간. 전파 비용과 저장 비용 |
| 세션·여정 | 한 사용자의 시간순 행동 + replay | "오류 직전에 무엇을 했는가" | "전체 사용자 분포" | 매우 비쌈. 개인정보 위험 최대 |

실무에서 이 넷은 **탐지 → 국소화 → 이해**의 순서로 쓰인다. 메트릭이 "이상이 있다"를 알리고, 트레이스와 차원 분해가 "어디"를 좁히고, 개별 이벤트와 세션이 "왜"를 설명한다. 반대로 쓰면 비용이 폭발한다. 모든 사용자의 세션 replay를 켜 두고 그 안에서 이상을 찾으려는 접근이 전형적인 실패다.

핵심은 **한 신호로 다른 신호의 역할을 대신할 수 없다**는 점이다. 오류 이벤트를 아무리 많이 모아도 "정상 대비 몇 배인가"는 분모가 되는 메트릭 없이는 답할 수 없다. 반대로 오류율 그래프만 있으면 "무엇이 잘못됐는가"를 영원히 알 수 없다.

### 브라우저가 제공하는 계측 표면

상용 SDK는 마법을 부리지 않는다. 아래 표준 표면을 묶어서 전송해 줄 뿐이다. 무엇을 쓸 수 있고 무엇이 빠지는지 알아야 SDK가 잡지 못한 신호를 스스로 보완할 수 있다.

**성능 — `PerformanceObserver`**

```js
// 각 entry type이 답하는 질문이 다르다. buffered로 관찰 이전 항목까지 받는다.
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(entry.entryType, entry.name, entry.startTime, entry.duration);
  }
});

observer.observe({ type: 'navigation', buffered: true });  // TTFB, DOM 처리 구간
observer.observe({ type: 'resource', buffered: true });    // 자산별 로드 타이밍
observer.observe({ type: 'largest-contentful-paint', buffered: true });
observer.observe({ type: 'layout-shift', buffered: true });
observer.observe({ type: 'event', durationThreshold: 40 }); // 상호작용 지연
observer.observe({ type: 'longtask', buffered: true });
```

`buffered: true`는 중요하다. 관측 코드가 lazy chunk에 있으면 등록 시점 이전의 `navigation`, `paint`, `largest-contentful-paint` 항목을 놓치는데, 이 옵션이 버퍼에 남아 있던 항목을 재생해 준다. 관찰 방법: DevTools 콘솔에 위 코드를 붙여 넣고 새로고침하면 각 entry가 순서대로 출력된다.

`long-animation-frame`(LoAF)은 여기서 한 단계 더 나아가 **어떤 스크립트가 프레임을 막았는지**를 `scripts` 배열로 알려 준다. INP 원인 추적에 결정적이지만 아직 Baseline이 아니므로, 지원되지 않는 브라우저에서는 `longtask`로 대체하고 귀속 정보 없이 지속 시간만 얻는다는 사실을 지표 해석에 반영해야 한다.

**오류 — DOM 이벤트**

```js
// 1) 런타임 예외
addEventListener('error', (event) => {
  // 리소스 로드 실패는 버블링하지 않는다. 캡처 단계에서만 잡히고 event.target이 요소다.
  if (event.target && event.target !== window) {
    report({ kind: 'resource', url: event.target.src || event.target.href });
    return;
  }
  report({ kind: 'runtime', message: event.message, error: event.error });
}, true); // ← 캡처 단계 등록이 없으면 리소스 실패를 통째로 놓친다

// 2) 처리되지 않은 Promise 거부
addEventListener('unhandledrejection', (event) => {
  report({ kind: 'rejection', reason: event.reason });
});

// 3) 스스로 만든 예외를 전역 핸들러로 보내기 (throw 하지 않고)
//    catch 블록에서 삼킨 오류를 관측 대상으로 승격시킬 때 쓴다
try {
  riskyOperation();
} catch (error) {
  showFallbackUI();
  reportError(error); // 전역 error 이벤트로 전달된다
}
```

세 번째의 `reportError()`가 실무에서 자주 빠진다. `try/catch`로 잡아 사용자에게 대체 UI를 보여 준 오류는 **어디에도 나타나지 않는다.** 사용자 경험을 위해 삼킨 오류일수록 관측은 더 필요하다.

**정책 위반·개입 — Reporting API**

브라우저 스스로가 보고하는 신호도 있다. CSP 위반, 폐기 예정 API 사용, 브라우저의 개입(intervention), 렌더러 크래시가 여기 속한다.

```http
Reporting-Endpoints: default="https://example.com/reports", csp="https://example.com/csp-reports"
Content-Security-Policy-Report-Only: script-src 'self'; report-to csp
```

```js
// 브라우저 내부에서 같은 보고를 관찰할 수도 있다
new ReportingObserver((reports) => {
  for (const report of reports) {
    console.log(report.type, report.body);
  }
}, { types: ['deprecation', 'intervention'], buffered: true }).observe();
```

이 신호의 가치는 **아직 장애가 아닌 것을 미리 알려 준다**는 데 있다. deprecation 보고는 다음 브라우저 버전에서 깨질 코드를 가리키고, CSP report-only 위반은 정책을 강제로 바꿨을 때 무엇이 깨질지 미리 보여 준다. 구형 `Report-To` 헤더는 Reporting API에서 빠졌으므로 `Reporting-Endpoints`를 쓴다.

### 전송: 언제, 어떻게 내보내는가

수집한 신호를 언제 보낼지가 데이터 손실의 대부분을 결정한다. 페이지가 사라지는 순간에 남은 버퍼를 비워야 하는데, 이 시점을 잡는 것이 까다롭다.

```js
const queue = [];

function flush() {
  if (queue.length === 0) return;
  const payload = JSON.stringify(queue.splice(0));
  // 큐잉 성공 여부만 반환한다. 도달을 보장하지 않는다.
  if (!navigator.sendBeacon('/telemetry', payload)) {
    // 64KiB 한도 초과 등으로 큐잉 실패 시 대체 경로
    fetch('/telemetry', { method: 'POST', body: payload, keepalive: true });
  }
}

// 모바일에서 신뢰할 수 있는 유일한 시점에 가깝다
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
addEventListener('pagehide', flush); // visibilitychange를 놓치는 경로의 보완
```

`beforeunload`와 `unload`를 쓰지 않는 이유는 두 가지다. 첫째, 모바일에서는 사용자가 앱을 전환하거나 OS가 탭을 정리할 때 이 이벤트가 발화하지 않는 경우가 많다. 둘째, `unload` 핸들러가 있으면 브라우저가 페이지를 bfcache에 넣지 못해 **뒤로 가기 성능을 우리 손으로 망가뜨린다.**

`sendBeacon`은 항상 `POST`이며 응답을 읽을 수 없고, 페이로드 한도는 대략 64KiB다. 반환값 `true`는 "큐에 넣었다"일 뿐 "도달했다"가 아니다. 응답이 필요하거나 다른 메서드를 써야 하면 `fetch(..., { keepalive: true })`를 쓴다.

bfcache는 세션 모델도 흔든다. 뒤로 가기로 복원된 페이지는 스크립트가 다시 실행되지 않으므로, 복원을 별도의 페이지 방문으로 취급할지 결정해야 한다.

```js
addEventListener('pageshow', (event) => {
  if (event.persisted) {
    // bfcache에서 복원됨. 성능 지표는 초기화하고 새 방문으로 계산하는 것이 일반적이다.
    startNewPageVisit();
  }
});
```

`web-vitals` 라이브러리(현재 v5)는 이 처리를 내장한다. bfcache 복원 후에는 새 ID의 지표 객체를 만들어 별개의 방문으로 보고하고, `visibilityState`가 `hidden`이 될 때 값을 확정해 내보낸다. 직접 구현할 때도 같은 규칙을 따라야 다른 도구의 수치와 비교할 수 있다.

### 상관관계: 브라우저의 사건과 서버의 로그를 잇기

"결제가 실패했다"는 클라이언트 오류를 받았을 때, 서버 로그의 어느 줄이 같은 사건인지 찾을 수 없다면 진단은 추측이 된다. 식별자는 세 층으로 설계한다.

| 식별자 | 수명 | 목적 | 주의 |
|---|---|---|---|
| 릴리스 ID | 빌드 단위 | 배포와 신호를 연결. source map 매칭 키 | 빌드 시 주입해야 한다. 런타임에 만들면 의미가 없다 |
| 세션 ID | 탭·방문 단위 | 오류 앞뒤의 행동을 잇는다 | 사용자 식별자가 아니다. bfcache·탭 복원 시 정책을 정해야 한다 |
| 요청/트레이스 ID | 요청 단위 | 클라이언트 요청과 서버 처리를 연결 | 전파 비용이 있다 (아래) |

**클라이언트 → 서버 방향**은 W3C Trace Context를 따른다. `traceparent` 헤더는 `버전(2자리)-trace-id(32자리)-parent-id(16자리)-flags(2자리)` 형식의 hex 문자열이다.

```js
// 예: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
const traceparent = `00-${traceId}-${spanId}-01`;
await fetch('/api/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json', traceparent },
  body: JSON.stringify(order),
});
```

여기에 실제 비용이 붙는다. `traceparent`는 [단순 요청(simple request)](../phase-8/02-network-deep-dive.md)의 허용 헤더가 아니므로, **cross-origin 요청에 이 헤더를 붙이는 순간 preflight `OPTIONS`가 하나 더 생긴다.** 서버는 `Access-Control-Allow-Headers`에 `traceparent`를 허용해야 하고, 브라우저는 요청마다 왕복을 한 번 더 한다. 같은 오리진 API에서는 무료지만, 별도 API 도메인을 쓰는 구조에서는 지연 비용을 계산하고 도입해야 한다. 완화책은 preflight 응답에 `Access-Control-Max-Age`를 충분히 주어 캐시시키는 것이다.

**서버 → 클라이언트 방향**도 필요하다. 서버가 자기 request ID를 응답에 돌려주면 클라이언트 오류 리포트에 그대로 실을 수 있다.

```http
Server-Timing: traceparent;desc="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", db;dur=42
Timing-Allow-Origin: https://app.example.com
```

```js
// PerformanceResourceTiming에서 읽는다
const [entry] = performance.getEntriesByName(url);
const traceHeader = entry?.serverTiming?.find((t) => t.name === 'traceparent')?.description;
```

`Server-Timing`을 cross-origin에서 읽으려면 서버가 `Timing-Allow-Origin`을 함께 줘야 한다. 이 헤더가 없으면 값이 조용히 비어 있을 뿐 오류가 나지 않으므로, 실제로 값이 채워지는지 반드시 확인해야 한다.

## 실무 관점

### 카디널리티가 비용을 결정한다

메트릭이 저렴한 이유는 값을 미리 집계하기 때문이다. 그런데 태그를 붙이면 저장 단위가 **태그 조합의 수만큼 곱해진다.** 이것이 관측 비용이 예고 없이 폭발하는 가장 흔한 경로다.

```text
route(20) × 브라우저(6) × 기기등급(3) × 릴리스(활성 4)   = 1,440 시계열   → 문제없다
위 조합 × 사용자 ID(50,000)                              = 7,200만 시계열 → 청구서 사고
```

규칙은 단순하다. **낮은 카디널리티 차원은 메트릭의 태그로, 높은 카디널리티 차원은 이벤트의 속성으로 둔다.** 사용자 ID, 세션 ID, 요청 ID는 절대 메트릭 태그가 아니다.

가장 흔한 사고는 URL 경로를 그대로 태그로 쓰는 것이다. `/orders/8f2c-...`처럼 ID가 박힌 경로는 사용자 수만큼 시계열을 만든다. 라우트 패턴(`/orders/:id`)으로 정규화한 뒤 태그로 써야 한다.

### 샘플링은 무엇을 포기하는지 알고 정한다

전수 수집은 대개 필요하지도, 감당 가능하지도 않다. 배분의 기본형은 다음과 같다.

| 신호 | 일반적 표본율 | 근거 |
|---|---|---|
| 오류 이벤트 | 100% | 희소하다. 놓치면 존재 자체를 모른다 |
| CWV·RUM | 10~100% | 분포 추정이 목적. 표본으로 충분하다 |
| 트레이스 | 1~10% + 오류/느린 요청 100% | 정상 트레이스는 대부분 중복 정보다 |
| 세션 replay | 1% 미만 + 오류 세션 우선 | 비용과 개인정보 위험이 가장 크다 |

샘플링 방식도 구분해야 한다. **head-based**는 요청 시작 시점에 동전을 던지므로 구현이 단순하고 분산 환경에서 일관되지만, 흥미로운 요청(느리거나 실패한)이 표본에서 빠질 수 있다. **tail-based**는 결과를 보고 남길지 정하므로 이상값을 놓치지 않지만, 모든 데이터를 일단 수집기까지 보내야 해서 전송 비용이 든다.

표본율은 통계적 한계로 되돌아온다. 표본율 1%로 수집한 데이터에서 하루 이벤트 200건인 route의 p75를 논하는 것은 무의미하다. 대시보드에 표본 수(n)를 함께 표시하지 않으면, 트래픽이 적은 페이지의 노이즈를 회귀로 오인하게 된다.

### 개인정보는 "안 보내기"로 설계한다

클라이언트 텔레메트리는 사용자의 화면 안에 있는 모든 것에 접근할 수 있다. 그래서 기본값이 위험하다.

- **URL과 쿼리 문자열**: 검색어, 이메일, 초대 토큰, 리셋 토큰이 흔히 들어 있다. 수집 전에 쿼리를 제거하거나 허용 목록만 남긴다.
- **오류 컨텍스트**: 예외 메시지에 API 응답 본문이나 폼 입력값이 문자열로 붙는 경우가 많다. `error.message`를 그대로 보내기 전에 스크러빙 규칙을 통과시킨다.
- **요청 헤더**: `Authorization`, 쿠키는 어떤 이유로도 텔레메트리에 실리면 안 된다.
- **세션 replay**: 기본 마스킹을 켜고, 입력 필드·결제·개인정보 영역은 명시적으로 차단한다. "나중에 마스킹하겠다"는 이미 수집된 데이터를 되돌리지 못한다.
- **식별자**: 사용자 ID는 원본 대신 가명(pseudonymous) ID를 쓴다. 지원 문의 대응을 위해 역추적이 필요하면 매핑을 별도 시스템에 두고 접근을 통제한다.

검증 방법은 코드 리뷰가 아니라 **실제 페이로드 확인**이다. DevTools Network 패널에서 텔레메트리 요청을 골라 payload를 직접 읽어 보면, 의도하지 않은 필드가 실려 나가는 것을 대개 즉시 발견한다.

### 관측 코드 자체가 성능 비용이다

RUM SDK는 메인 스레드에서 돈다. 다음이 실제로 관측되는 부작용이다.

- SDK 번들이 크리티컬 패스에 있으면 LCP를 늦춘다. 동기 스크립트로 넣지 말고, 초기 오류 캡처만 인라인 가드로 남기고 본체는 지연 로드한다.
- 전송이 상호작용 처리와 같은 태스크에서 일어나면 INP에 잡힌다. 이벤트는 큐에 쌓고 idle 시점이나 `visibilitychange`에 묶어 보낸다.
- `PerformanceObserver` 콜백에서 무거운 가공을 하면 그 자체가 long task가 된다. 콜백에서는 필요한 필드만 복사하고 가공은 뒤로 미룬다.
- 세션 replay는 DOM 변경을 지속적으로 직렬화한다. 목록 가상화나 애니메이션이 많은 화면에서 체감 가능한 비용이 된다.

측정 방법은 단순하다. SDK를 끈 빌드와 켠 빌드에서 같은 조건으로 INP와 LCP를 비교한다. "관측 도구가 지표를 악화시킨다"는 가설을 실제로 확인하지 않고 도입하면, 나중에 성능 회귀 진단에서 자기 자신을 용의자 목록에 올리지 못한다.

### 안티패턴

- **"일단 다 수집하고 나중에 본다"** — 비용, 카디널리티, 개인정보 위험이 모두 최대가 되는 선택이다. 답하고 싶은 질문을 먼저 적고, 그 질문에 필요한 신호만 남긴다.
- **SDK 설치를 관측 설계로 착각** — 릴리스 식별, 차원 설계, 샘플링 정책, 알림 기준이 없으면 SDK는 읽히지 않는 이슈 목록만 쌓는다.
- **평균 지표** — 평균 LCP는 빠른 사용자가 느린 사용자를 가린다. 분포와 백분위수로 본다([8-3](../phase-8/03-web-performance.md)).
- **차원 없는 신호** — 릴리스와 route가 붙지 않은 오류는 배포와 연결할 수 없어 진단이 시작되지 않는다.
- **콘솔 로그를 관측으로 취급** — 사용자 브라우저의 콘솔은 우리에게 도달하지 않는다.

## 더 깊이

**OpenTelemetry를 브라우저에 도입할 때의 판단**

OpenTelemetry는 벤더 중립 계측 표준으로 브라우저용 SDK(`@opentelemetry/sdk-trace-web`)도 제공한다. 장점은 백엔드와 같은 데이터 모델·전파 형식을 쓰므로 트레이스가 클라이언트에서 서버까지 하나로 이어진다는 점이다.

비용도 분명하다. 번들 크기가 눈에 띄게 늘고, 자동 계측이 모든 fetch에 헤더를 붙이면서 cross-origin preflight를 늘리며, 브라우저 텔레메트리 수집 엔드포인트를 직접 운영해야 한다(수집기를 공개 인터넷에 노출하는 문제 포함). 소규모 팀이라면 "모든 요청을 추적"이 아니라 **핵심 플로우(결제, 로그인, 검색) 몇 개만 수동 계측**하는 편이 비용 대비 효과가 크다.

**Baseline과 폴백 설계**

계측 API는 지원 편차가 크다. `layout-shift`, `longtask`, `long-animation-frame`, Reporting API의 일부 보고 유형은 브라우저별로 갈린다. 이때 중요한 것은 코드가 죽지 않는 것보다 **지표가 왜곡되지 않는 것**이다.

```js
// 지원 여부를 지표 해석에 반영한다
const supported = PerformanceObserver.supportedEntryTypes ?? [];
const canMeasureCLS = supported.includes('layout-shift');
// 수집 이벤트에 이 플래그를 함께 보내야, 대시보드에서 "CLS가 좋다"와
// "CLS를 잴 수 없는 브라우저였다"를 구분할 수 있다
```

CLS를 지원하지 않는 브라우저를 분모에서 제외하지 않으면, Safari 비중이 높은 서비스에서 CLS가 실제보다 좋아 보이는 착시가 생긴다.

## 정리

- 모니터링은 미리 정한 질문에 답하고, 관측 가능성은 새 질문을 사후에 던질 수 있는 성질이다. 판정 기준은 컨텍스트가 고차원으로 보존되는가다.
- 클라이언트는 신뢰할 수 없는 리포터다. 완전히 실패한 사용자는 실패를 보고하지 못하므로, CDN 로그·합성 모니터링·인라인 부트 가드로 공백을 메운다.
- 메트릭·이벤트·트레이스·세션은 탐지·국소화·이해의 서로 다른 단계를 맡으며 서로를 대체하지 못한다.
- 상용 SDK의 실체는 `PerformanceObserver`, 전역 오류 이벤트, Reporting API이며, `try/catch`로 삼킨 오류는 `reportError()`로 승격시켜야 관측된다.
- 전송은 `sendBeacon`과 `visibilitychange` 조합이 기본이고, `unload`는 bfcache를 깨므로 쓰지 않는다.
- 상관관계는 릴리스·세션·요청의 세 층으로 설계하며, cross-origin에 `traceparent`를 붙이면 preflight 비용이 발생한다.
- 카디널리티는 메트릭 비용을, 샘플링은 통계적 신뢰도를, 스크러빙은 개인정보 위험을 결정한다. 셋 다 수집 전에 정해야 한다.

## 확인 문제

1. 새 버전을 배포한 뒤 오류 대시보드의 오류 건수가 평소의 40%로 줄었다. 팀은 "안정성이 개선됐다"고 판단했다. 이 판단을 검증하려면 무엇을 먼저 확인해야 하는가?

<details>
<summary>정답과 해설</summary>

건수가 아니라 **분모**를 먼저 봐야 한다. 세션 수, 페이지뷰, 텔레메트리 수신 클라이언트 수가 함께 줄었다면 오류가 줄어든 것이 아니라 앱이 부팅되지 않아 아무도 보고하지 못하는 상태일 수 있다. 생존 편향의 전형적인 형태다.

교차 확인 수단은 클라이언트 밖에 있다. CDN·서버 접근 로그에서 요청 수와 자산 200/404 비율을 보고, 합성 모니터링으로 핵심 플로우가 실제로 완주되는지 확인하고, 인라인 부트 가드에서 오는 boot-failure 신호를 본다. 오류율은 반드시 세션 수 같은 분모 위의 비율로 봐야 하며, 배포 직후에는 릴리스별 채택률이 낮아 비율도 불안정하다는 점을 함께 고려한다.

</details>

2. 팀이 오류 이벤트에 `userId`를 태그로 붙여 "사용자별 오류율" 메트릭을 만들려 한다. 이 설계의 문제는 무엇이며 대안은 무엇인가?

<details>
<summary>정답과 해설</summary>

카디널리티 폭발이다. 메트릭은 태그 조합마다 시계열을 하나씩 만들기 때문에, 사용자 수가 곧 시계열 수가 된다. 여기에 route·브라우저·릴리스 태그가 곱해지면 저장 비용과 질의 시간이 감당 불가능해지고, 대부분의 메트릭 백엔드는 카디널리티 한도에 걸려 데이터를 버리기 시작한다.

대안은 신호를 나누는 것이다. 사용자 ID는 **이벤트의 속성**으로 두어 개별 사건을 조회할 때 쓰고, 메트릭은 route·릴리스·브라우저처럼 낮은 카디널리티 차원으로만 집계한다. "영향받은 고유 사용자 수"가 필요하면 태그가 아니라 이벤트 저장소 쪽에서 distinct count로 계산하거나, HyperLogLog 같은 근사 카디널리티 집계를 쓴다. 덧붙여 사용자 ID는 원본 대신 가명 ID를 써야 한다.

</details>

3. API 도메인이 `api.example.com`으로 분리된 SPA에 트레이스 전파를 도입했더니, 배포 후 상호작용 지연이 전반적으로 늘었다는 field 신호가 왔다. 어떤 원인을 의심하고 어떻게 확인·완화하는가?

<details>
<summary>정답과 해설</summary>

`traceparent`는 CORS 단순 요청의 허용 헤더가 아니므로, cross-origin 요청마다 preflight `OPTIONS`가 추가된다. 이전에 단순 요청이었던 GET 호출까지 왕복이 두 번으로 늘어 네트워크 지연이 두 배가 될 수 있다.

확인 방법은 DevTools Network 패널에서 API 요청 앞에 `OPTIONS`가 붙는지 보는 것이다. 배포 전후의 요청 수 차이나 리소스 타이밍 분포 비교로도 드러난다.

완화책은 세 가지다. ① preflight 응답에 `Access-Control-Max-Age`를 충분히 주어 브라우저가 결과를 캐시하게 한다(브라우저별 상한이 있다). ② 전파 대상을 핵심 플로우 요청으로 제한한다. ③ 가능하다면 API를 같은 오리진 경로로 프록시해 cross-origin 자체를 없앤다. 트레이스의 가치와 왕복 비용을 route별로 비교해 결정한다.

</details>

4. 어떤 팀이 "관측 가능성을 갖췄다"는 근거로 대시보드 30개를 제시했다. 이 근거가 왜 불충분한지, 무엇으로 판정해야 하는지 설명하라.

<details>
<summary>정답과 해설</summary>

대시보드는 **이미 던지기로 정한 질문**의 답만 보여 준다. 즉 모니터링의 산출물이다. 관측 가능성의 판정 기준은 "예상하지 못한 질문을 새 배포 없이 던질 수 있는가"다.

판정 방법은 실제 질문을 던져 보는 것이다. "지난 릴리스에서, iOS Safari 사용자 중, 특정 기능 플래그가 켜진 세션의 결제 route INP p75는?" 같은 조합을 지금 데이터로 답할 수 있는지 확인한다. 답하려면 이벤트에 릴리스·브라우저·플래그 분기·route 차원이 보존되어 있어야 하고, 임의 조합으로 자를 수 있는 질의 수단이 있어야 한다. 답할 수 없다면 부족한 것은 대시보드가 아니라 **차원 설계**다.

</details>

## 참고 자료

- [MDN: Performance Timeline / PerformanceObserver](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver) — entry type 목록과 `buffered` 옵션의 동작을 확인할 수 있다.
- [MDN: PerformanceLongAnimationFrameTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming) — LoAF가 노출하는 `blockingDuration`, `scripts` 필드와 현재 지원 상태를 확인한다.
- [MDN: Reporting API](https://developer.mozilla.org/en-US/docs/Web/API/Reporting_API) — `Reporting-Endpoints` 헤더, `ReportingObserver`, 보고 유형과 `Report-To`가 빠진 경위를 설명한다.
- [MDN: Navigator.sendBeacon()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon) — 반환값의 의미, 페이로드 한도, `visibilitychange` 권장 이유를 다룬다.
- [MDN: Window error event](https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event) — 런타임 오류와 리소스 로드 실패가 어떻게 구분되는지 확인한다.
- [MDN: reportError()](https://developer.mozilla.org/en-US/docs/Web/API/Window/reportError) — 잡은 예외를 전역 오류 핸들러로 보내는 표준 방법이다.
- [W3C: Trace Context](https://www.w3.org/TR/trace-context/) — `traceparent`/`tracestate`의 정확한 형식과 필드 길이를 정의한다.
- [MDN: Server-Timing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing) — 서버가 타이밍·식별자를 브라우저로 되돌려 주는 방법과 `Timing-Allow-Origin` 제약을 설명한다.
- [web.dev: Back/forward cache](https://web.dev/articles/bfcache) — `unload` 핸들러가 bfcache를 막는 이유와 `pageshow`의 `persisted` 처리를 다룬다.
- [GoogleChrome/web-vitals](https://github.com/GoogleChrome/web-vitals) — bfcache 복원과 `visibilitychange` flush를 라이브러리가 어떻게 처리하는지 구현으로 확인할 수 있다.
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/) — 브라우저 계측 SDK의 구성 요소와 전파기(propagator) 설정을 확인한다.
