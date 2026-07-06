# 3-8. 네트워크 API — fetch의 설계와 브라우저 정책

> 한 줄 요약: fetch가 404에서 reject하지 않고 body를 한 번만 읽게 하는 설계의 근거를 이해하고, "코드는 맞는데 안 되는" 브라우저 정책 실패까지 포함한 에러 처리 계층과 취소 가능한 요청 흐름을 설계할 수 있다.

*이 문서의 예제는 브라우저 전용이다. (Node 18+에도 fetch가 있지만 CORS·쿠키·캐시 등 브라우저 정책 부분은 브라우저에서만 재현된다.)*

## 학습 목표

- XHR → fetch 전환이 바꾼 것(이벤트 → Promise, Request/Response 객체 모델)과 Fetch Standard의 위상을 설명할 수 있다.
- Response.body가 스트림이라서 body를 한 번만 읽을 수 있는 이유와 clone()의 용도·비용을 설명할 수 있다.
- 네트워크 에러(reject)와 HTTP 에러(resolve + !ok)를 구분하는 3계층 에러 처리를 구현할 수 있다.
- cache·credentials 모드로 브라우저의 HTTP 캐시·쿠키 정책을 코드에서 제어할 수 있고, CORS가 왜 존재하는지(SOP) 개요 수준에서 설명할 수 있다.
- AbortSignal로 이전 요청을 취소해 검색 자동완성의 응답 역전을 방지할 수 있다(과제 B의 핵심).

## 배경: 왜 이것이 존재하는가

서버에서 쓰던 HTTP 클라이언트(OkHttp, requests, HttpClient)의 실패 모델은 단순하다 — 코드가 실패의 전부다. 연결이 안 되거나, 타임아웃이거나, 내가 URL을 잘못 썼거나. 브라우저의 fetch는 다른 종류의 클라이언트다. **코드 밖에 정책 계층이 있다.** 같은 요청이 CORS 정책으로 차단되고, 쿠키가 credentials 모드 때문에 안 실리고, 캐시가 응답을 가로채 서버에 도달조차 안 하고, HTTPS 페이지라서 HTTP 요청이 거부된다(mixed content). "코드는 맞는데 안 된다"는 프론트엔드 네트워킹 디버깅의 기본 형태이고, 이 정책 목록이 곧 디버깅 지도다.

fetch 이전의 XMLHttpRequest는 2000년대 초 Outlook Web Access를 위해 만들어진 이벤트 기반 API였다. `onreadystatechange`로 상태 전이를 구독하고, 요청·응답이 XHR 객체 하나에 뭉쳐 있으며, 취소·스트리밍·캐시 제어의 표현력이 부족했다. fetch(2015~)는 세 가지를 바꿨다: ① 이벤트 → **Promise**([3-6](./06-promises-and-async.md)의 합성 가능성을 그대로 얻는다) ② 뭉친 객체 → **Request/Response라는 명시적 값** — 요청과 응답이 각각 만들고 전달하고 검사할 수 있는 일급 객체다 ③ 임시 API → **Fetch Standard라는 단일 정의**. 마지막이 위상의 핵심이다: Fetch Standard는 fetch() 함수의 스펙이 아니라 **브라우저의 모든 리소스 로딩**(img·script 태그, CSS, 워커, CORS와 preflight 절차 전부)이 따르는 알고리즘의 정의이고, fetch()는 그 알고리즘을 JS에 노출한 창구다. `<img>`가 이미지를 받는 것과 코드의 fetch()가 같은 스펙 절차를 탄다.

이 문서는 [3-6](./06-promises-and-async.md)의 Promise/AbortSignal과 Phase 2의 HTTP 의미론을 전제한다. [2-1](../phase-2/01-http-semantics.md)이 예고한 "fetch는 404에서 reject하지 않는다"의 상세가 여기서 이행된다. CORS는 존재 이유(SOP)와 개요까지만 다루고 헤더별 협상은 Phase 7-2로, HTTP 캐싱 모델 자체는 [2-2](../phase-2/02-http-caching.md)로, 쿠키 의미론은 [2-3](../phase-2/03-cookies-and-state.md)으로 위임한다. WebSocket/SSE(양방향·서버 푸시 채널)와 서비스 워커는 존재만 언급한다.

## 핵심 개념

### Request/Response — 메시지가 값이 되었다

[2-1](../phase-2/01-http-semantics.md)에서 HTTP 메시지를 "메서드 + URI + 헤더 + 바디"의 추상 구조로 정의했다. fetch의 객체 모델은 그 추상 구조를 그대로 JS 값으로 만든 것이다.

```js
const request = new Request("https://api.example.com/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "milk" }),
});

const response = await fetch(request);
// response: { status, statusText, ok, headers, body, url, type, ... }
const data = await response.json();
```

메시지가 값이라는 것의 실질적 이득은 **가로채기 계층**이 성립한다는 것이다. 요청을 받아 검사·수정·대체 응답 반환을 하는 미들웨어(인증 헤더 주입 래퍼, 서비스 워커의 오프라인 응답)가 전부 "Request를 받아 Response를 돌려주는 함수"라는 하나의 형태로 수렴한다 — 서버 미들웨어(Express, 서블릿 필터)와 같은 구조가 클라이언트에 생긴 것이다.

### Response.body는 스트림이다 — 한 번만 읽는 이유

fetch의 가장 자주 부딪히는 함정부터 재현한다.

```js
const res = await fetch("/api/items");
const data = await res.json();
const text = await res.text(); // TypeError: body stream already read
```

원인은 설계에 있다. `Response.body`는 버퍼가 아니라 **ReadableStream**이다 — 네트워크에서 도착하는 바이트 청크의 흐름이고, 읽는 행위가 곧 소비다. 스트림은 되감을 수 없으므로 **한 번만 소비된다**. `json()`/`text()`/`blob()` 같은 편의 메서드는 "스트림을 끝까지 소비해 누적한 뒤 변환"하는 함수라서, 한 번 호출하면 스트림이 잠기고(locked) 두 번째 호출은 실패한다.

왜 버퍼가 아니라 스트림인가. 버퍼 모델(XHR의 responseText)은 응답 전체가 도착해야 접근 가능하고, 1GB 응답이면 1GB 메모리다. 스트림 모델은 **도착하는 대로 처리**를 가능하게 한다 — 메모리는 청크 하나 크기이고, 첫 바이트 도착 시점부터 작업할 수 있다. 진행률 표시가 대표 사례다.

```js
const res = await fetch("/large-file.zip");
const total = Number(res.headers.get("Content-Length")); // 없을 수도 있다(청크 전송)
const reader = res.body.getReader();
let received = 0;
const chunks = [];

while (true) {
  const { done, value } = await reader.read(); // 청크(Uint8Array) 단위 도착
  if (done) break;
  chunks.push(value);
  received += value.length;
  updateProgress(received / total); // 다운로드 중에 UI 갱신 — 버퍼 모델에선 불가능
}
```

두 갈래로 읽어야 할 때(예: JSON 파싱 + 원문 로깅)를 위해 `clone()`이 있다. clone은 스트림을 **tee(분기)** 해 두 Response가 같은 바이트 흐름을 각자 소비하게 한다. 비용을 명시해야 한다: 두 갈래의 소비 속도가 다르면 빠른 쪽이 읽은 데이터를 느린 쪽이 아직 안 읽었으므로 **그만큼 버퍼링된다** — 한쪽을 소비하지 않고 방치하면 응답 전체가 메모리에 잡힌다. clone은 "정말 두 번 읽어야 하는" 지점(캐싱 미들웨어가 저장본과 반환본을 나눌 때 등)에만 쓰고, 단순히 "나중에 또 읽을지 몰라서" 쓰지 않는다.

### 네트워크 에러 vs HTTP 에러 — reject의 정확한 경계

[2-1](../phase-2/01-http-semantics.md)에서 예고한 지점이다. fetch의 Promise가 reject되는 것은 **전송 실패뿐**이다: DNS 실패·연결 불가, CORS 차단, mixed content 차단, AbortSignal에 의한 중단. 404든 500이든 **HTTP 응답이 도착했다면 resolve**다 — `response.ok`(status 200~299)가 false일 뿐.

이것은 태만이 아니라 [2-1](../phase-2/01-http-semantics.md)에서 세운 **전송과 의미론의 분리**를 그대로 반영한 API 설계다. fetch의 관할은 전송이다 — 메시지를 보내고 응답 메시지를 받아오는 것. 404가 "실패"인지는 의미론, 즉 애플리케이션의 판단이다(존재 확인 요청이라면 404는 정상 결과다). HTTP 클라이언트 라이브러리들이 이 지점에서 갈린다: axios는 4xx/5xx를 reject하는 편의를 택했고(그래서 "404 응답 바디를 읽으려면 catch에서"라는 별도 규약이 생긴다), fetch는 분리를 유지했다.

이 설계가 강제하는 것이 **3계층 에러 처리**다. 계층마다 원인·표현·대응이 다르므로 뭉개지 않는다.

```js
async function apiGet(url, { signal } = {}) {
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;      // ① 취소 — 에러가 아니다, 그대로 전파 (3-6)
    throw new NetworkError("서버에 연결할 수 없습니다", { cause: e }); // ② 전송 실패 — 오프라인/CORS/DNS
  }
  if (!res.ok) {                                // ③ HTTP 에러 — 응답은 도착했다
    throw new HttpError(res.status, await res.json().catch(() => null));
    // 에러 응답에도 바디(에러 코드, 메시지)가 있다 — 도착했으므로 읽을 수 있다
  }
  return res.json();
}
```

②와 ③의 사용자 표현이 달라야 하는 이유: 전송 실패는 "네트워크를 확인하세요"(재시도 버튼이 유효)이고, HTTP 에러는 서버가 준 의미론(401이면 재로그인, 404면 없음 표시, 5xx면 잠시 후 재시도 — [2-1](../phase-2/01-http-semantics.md)의 상태 코드 계약)을 따라야 한다. 과제 B의 완성 기준(오프라인 전환 시 구분된 에러 UI)이 이 계층화를 검증한다.

### 브라우저 정책과의 결합 — 코드 밖의 거부자들

fetch의 옵션들은 대부분 "브라우저의 기존 정책 계층을 코드에서 제어하는 손잡이"다.

**cache 모드 — [2-2](../phase-2/02-http-caching.md)의 HTTP 캐시를 요청 단위로 제어한다.**

| 모드 | 의미 | 쓰는 상황 |
|------|------|----------|
| `default` | 표준 캐시 절차(신선하면 캐시, 아니면 조건부 요청) | 평상시 |
| `no-store` | 캐시를 읽지도 쓰지도 않음 | 항상 최신이어야 하는 폴링 |
| `no-cache` | 캐시가 있어도 서버 재검증 후 사용 | 강제 새로고침 류 |
| `reload` | 캐시 무시하고 받되, 받은 것은 저장 | 캐시 갱신 목적 |
| `force-cache` | 만료됐어도 캐시 우선 | 오프라인 우선 UI |

**credentials 모드 — [2-3](../phase-2/03-cookies-and-state.md)의 쿠키가 실리는 조건.** `same-origin`(기본값 — 동일 출처에만 쿠키 전송), `include`(교차 출처에도 전송 — 서버가 CORS로 명시 허용해야 하고 SameSite 정책의 제약도 받는다), `omit`(전송 안 함). "로컬에선 되는데 스테이징에서 세션이 끊긴다"의 단골 원인이 교차 출처 API + 기본값 조합이다 — 쿠키가 안 실리는 것이 코드가 아니라 모드의 결과다.

**CORS — 존재 이유까지만.** 브라우저에는 동일 출처 정책(Same-Origin Policy)이 있다: 출처(스킴+호스트+포트)가 다른 문서의 데이터에 스크립트가 접근하는 것을 차단한다. 이것이 없다면 사용자가 로그인해 둔 은행 사이트의 데이터를 아무 악성 페이지의 fetch가 (사용자의 쿠키를 업고) 읽어갈 수 있다 — SOP는 웹 보안의 기반 계층이다. CORS(Cross-Origin Resource Sharing)는 이 차단을 **서버의 명시적 동의로 선택적으로 여는** 프로토콜이다: 단순 요청(GET/POST + 안전한 헤더 조합)은 일단 보내고 응답의 `Access-Control-Allow-Origin`으로 접근 허용 여부를 판정하며, 그 밖의 요청(커스텀 헤더, PUT/DELETE 등)은 본 요청 전에 OPTIONS **preflight**로 서버의 동의를 먼저 묻는다. 기억할 프레임: **CORS 에러는 서버가 아니라 브라우저가 응답 접근을 차단한 것**이고(Network 패널에는 응답이 보이는데 코드에는 TypeError로 오는 이유), 협상 헤더의 상세와 preflight 조건·캐싱은 Phase 7-2에서 다룬다.

**페이지 이탈 시 전송 — 존재와 용도만.** 페이지가 닫힐 때 분석 데이터를 보내는 요청은 일반 fetch로는 유실된다(페이지 소멸과 함께 요청도 중단). `fetch(url, { keepalive: true })` 또는 `navigator.sendBeacon(url, data)`이 페이지 수명과 독립적으로 전송을 보장하는 통로다(크기 제한 있음).

### 취소와 타임아웃 — 응답 역전을 끊는다

[3-6](./06-promises-and-async.md)의 AbortSignal이 fetch에서 실전이 된다. 검색 자동완성의 고전적 race condition을 보자: "ab"의 응답이 "abc"의 응답보다 **늦게** 도착하면, 마지막 렌더가 "ab"의 결과가 된다 — 타이핑은 앞으로 갔는데 화면은 뒤로 가는 응답 역전이다. 근본 원인은 요청들이 독립적으로 날아가고 완료 순서가 발신 순서와 무관하다는 것. 해법은 **새 요청을 보낼 때 이전 요청을 취소**하는 것이다.

```js
function createSearcher() {
  let controller = null; // 클로저에 은닉된 "진행 중 요청" 상태 (3-2)

  return async function search(query) {
    controller?.abort();               // 이전 요청 취소 — 응답 역전의 원천 차단
    controller = new AbortController();
    const { signal } = controller;

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
      if (!res.ok) throw new HttpError(res.status);
      const results = await res.json();
      if (signal.aborted) return;      // json 파싱 중 다음 타이핑이 온 경계까지 방어
      render(results);
    } catch (e) {
      if (e.name === "AbortError") return; // 취소는 실패가 아니다 (3-6)
      renderError(e);
    }
  };
}
const search = createSearcher();
input.addEventListener("input", debounce((e) => search(e.target.value), 300)); // 3-2의 디바운스와 결합
```

디바운스(발사 횟수를 줄인다)와 취소(발사된 것의 역전을 막는다)는 보완재이지 대체재가 아니다 — 디바운스만으로는 300ms 간격을 넘겨 발사된 두 요청의 역전을 못 막는다. 완성 기준은 DevTools Network 패널이다: 빠르게 타이핑할 때 이전 요청들이 **(canceled)** 상태로 표시되어야 한다(과제 B의 검증 항목).

타임아웃은 fetch에 내장 옵션이 없고 signal 조합으로 표현한다: `AbortSignal.timeout(5000)`(단독), 사용자 취소와 함께라면 `AbortSignal.any([userSignal, AbortSignal.timeout(5000)])`([3-6](./06-promises-and-async.md)). 서버 클라이언트들이 타임아웃을 1급 옵션으로 두는 것과 달리 fetch가 signal 하나로 통일한 것은, 취소 사유(사용자·시간·화면 전환)가 무엇이든 전파 채널은 하나여야 조합이 성립하기 때문이다.

## 실무 관점

**"코드는 맞는데 안 되는" 실패 모드의 점검 순서.** 서버 개발 경험의 직관("내 코드 아니면 서버 문제")에 없는 제3의 용의자 — 브라우저 정책 — 를 점검 목록에 넣는다.

| 증상 | 용의자 | 확인 방법 |
|------|--------|----------|
| TypeError: Failed to fetch, 서버 로그에는 요청 도착 | CORS (응답 접근 차단) | 콘솔의 CORS 메시지, Network 패널에 응답은 존재 |
| TypeError인데 서버 로그에도 없음 | 오프라인/DNS/mixed content | Network 패널 상태, https 페이지에서 http URL인지 |
| 401인데 로그인은 되어 있음 | credentials 모드/SameSite로 쿠키 미전송 | Network 패널 요청 헤더에 Cookie가 있는지 |
| 항상 옛 데이터 | HTTP 캐시 적중 | Network 패널 Size 열의 "(disk cache)", cache 모드 조정 |
| OPTIONS 요청이 먼저 나감 | preflight (커스텀 헤더 등) | 정상이다 — 실패하면 본 요청 없이 CORS 에러 |

**공용 fetch 래퍼는 초기에 한 번 세운다.** base URL, 인증 헤더, 3계층 에러 분류, signal 전파, JSON 직렬화를 매 호출부에 흩뿌리면 에러 처리 품질이 호출부마다 달라진다. 위 `apiGet` 형태의 래퍼 하나로 수렴시키는 것이 관례이고, 재시도(멱등 요청만 — [2-1](../phase-2/01-http-semantics.md)의 메서드 속성이 재시도 안전성의 근거)와 동시 요청 제한([3-6](./06-promises-and-async.md)의 풀)도 이 계층에 얹는다.

**XHR이 아직 남아 있는 자리.** 업로드 진행률(request body의 progress 이벤트)은 fetch가 오랫동안 못 하던 것이다 — ReadableStream body(duplex 옵션)로 가능해지고 있지만 지원 폭을 확인해야 한다(Baseline 미도달). 레거시 코드베이스의 XHR을 만나면 "왜 대체되었는가"(합성 불가한 이벤트 모델)와 함께 "무엇 때문에 남았는가"(업로드 진행률, 혹은 그냥 미이전)를 구분해 읽는다.

## 더 깊이

**Fetch Standard의 구조 — fetch()는 빙산의 일각이다.** 스펙 문서는 크게 세 부분이다: Fetching(리소스 로딩 알고리즘 전체 — 리다이렉트 추적, CORS 판정, 캐시 상호작용, 서비스 워커 경유), HTTP 확장(preflight의 정확한 절차), 그리고 마지막에 fetch() API. `<script>` 태그의 로딩도, CSS의 `url()`도 같은 Fetching 알고리즘의 다른 진입점이다. 이 단일화 덕에 "이미지는 되는데 fetch는 왜 CORS에 걸리나" 같은 질문에 스펙 기반 답이 존재한다 — 리소스 종류마다 mode(no-cors/cors)와 destination이 다르게 설정된 같은 절차다. `Response.type`(basic/cors/opaque)이 그 판정 결과의 노출이고, no-cors 요청의 opaque 응답은 상태 코드도 바디도 코드에서 읽을 수 없다.

**스트림은 배압(backpressure)까지 포함한 모델이다.** ReadableStream은 소비자가 읽는 속도로 생산을 조절한다 — reader.read()를 천천히 호출하면 내부 큐가 차고, 브라우저는 TCP 수신 윈도우를 통해 서버의 전송 속도까지 늦춘다. "다운로드를 UI 처리 속도에 맞춘다"가 네트워크 계층까지 관통하는 것이다. 반대 방향(업로드 스트리밍)과 TransformStream을 이용한 중간 변환(압축 해제, NDJSON 파싱)은 Streams Standard의 영역이다.

**요청은 어디서 실행되는가.** fetch를 호출하는 것은 JS(렌더러의 메인 스레드)지만, 실제 네트워킹은 브라우저의 네트워크 프로세스가 수행한다([0-1](../phase-0/01-how-the-web-works.md)의 멀티 프로세스 구조). 그래서 long task로 메인 스레드가 막혀 있어도 다운로드 자체는 진행된다 — 막히는 것은 응답을 소비하는 콜백(태스크로 큐잉)이다. "요청이 느리다"의 계측에서 네트워크 시간(Network 패널의 Timing)과 콜백 대기 시간(Performance 패널)을 분리해야 하는 이유다.

## 정리

- fetch는 Fetch Standard(브라우저의 모든 리소스 로딩의 단일 정의)의 JS 창구이고, Request/Response라는 일급 메시지 객체 + Promise로 XHR의 이벤트 모델을 대체했다.
- Response.body는 ReadableStream이다 — 되감을 수 없으므로 한 번만 소비되며("body used already"의 원인), json()/text()는 스트림 소진 함수다. 두 갈래가 필요하면 clone()이지만 느린 쪽만큼 버퍼링되는 비용이 있다.
- reject는 전송 실패(연결 불가·CORS 차단·중단)뿐이고 4xx/5xx는 resolve다 — 전송과 의미론의 분리. 에러 처리는 취소/전송 실패/HTTP 에러의 3계층으로 나눈다.
- cache·credentials 모드는 브라우저의 캐시·쿠키 정책을 요청 단위로 제어하는 손잡이이고, CORS는 SOP를 서버 동의로 여는 프로토콜이다 — 차단의 주체는 브라우저이며 상세 협상은 7-2에서 다룬다.
- 연속 요청의 응답 역전은 디바운스가 아니라 취소(이전 요청 abort)가 막는다. 타임아웃·사용자 취소·화면 전환은 전부 AbortSignal 하나의 채널로 조합한다.

## 확인 문제

**Q1.** 다음 로깅 미들웨어를 배포하자 "body stream already read" 에러가 API 전역에서 터졌다. 원인과 두 가지 수정 방향(각각의 비용 포함)을 답하라.

```js
async function fetchWithLogging(url, options) {
  const res = await fetch(url, options);
  logger.debug(await res.text()); // 응답 원문 로깅
  return res; // 호출부는 res.json()을 호출한다
}
```

<details>
<summary>정답과 해설</summary>

`res.text()`가 body 스트림을 소진했으므로, 호출부의 `res.json()`은 이미 잠긴 스트림을 다시 읽으려다 실패한다. 스트림은 버퍼가 아니라 1회 소비 자원이다.

수정 ①: `const clone = res.clone(); logger.debug(await clone.text()); return res;` — clone이 스트림을 tee해 두 갈래를 만든다. 비용: 두 갈래의 소비 시점 차이만큼 버퍼링된다. 여기서는 로깅이 즉시 전체를 읽으므로 사실상 응답 전체가 메모리에 복제되는 셈이다 — 큰 응답에서 부담.

수정 ②: 한 번만 읽고 양쪽에 나눠 준다 — `const text = await res.text(); logger.debug(text); return JSON.parse(text);` (반환 계약을 Response가 아니라 파싱된 값으로 변경). 비용: 래퍼의 반환 타입이 바뀌고, 스트리밍 소비(진행률 등)가 불가능해진다. 로깅이 디버그 전용이라면 "debug 레벨일 때만 clone"하는 조건부가 실무적 절충이다.
</details>

**Q2.** 배포 후 "저장 버튼이 가끔 안 먹힌다"는 제보가 왔다. 코드는 아래와 같고, 콘솔에는 아무 에러도 없다. 이 코드가 놓치는 실패 모드를 전부 나열하고 고쳐라.

```js
async function save(item) {
  try {
    await fetch("/api/items", { method: "POST", body: JSON.stringify(item) });
    showToast("저장되었습니다");
  } catch {
    showToast("네트워크 오류");
  }
}
```

<details>
<summary>정답과 해설</summary>

놓치는 실패 모드: ① **HTTP 에러 전부** — 400(검증 실패), 401(세션 만료), 500이 와도 fetch는 resolve하므로 "저장되었습니다"가 뜬다. 이것이 "가끔 안 먹히는데 에러가 없다"의 정체다. `res.ok` 검사가 없다. ② Content-Type 헤더 미지정 — body가 text/plain으로 가서 서버 파서가 400을 줄 수 있다(그리고 ①에 의해 은폐된다). ③ 넓은 catch가 AbortError까지 "네트워크 오류"로 표시한다(이 코드엔 signal이 없지만 래퍼가 생기면 문제가 된다).

수정:

```js
async function save(item) {
  try {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      showToast(detail?.message ?? `저장 실패 (${res.status})`);
      return;
    }
    showToast("저장되었습니다");
  } catch (e) {
    if (e.name === "AbortError") return;
    showToast("서버에 연결할 수 없습니다");
  }
}
```

"resolve = 성공"이라는 서버 클라이언트의 직관을 fetch에 이식한 것이 근본 원인이다 — fetch에서 성공 판정은 항상 `res.ok`다.
</details>

**Q3.** 검색 자동완성에 디바운스(300ms)를 적용했는데도 QA가 "빠르게 지웠다 다시 치면 이전 검색어 결과가 나온다"를 재현했다. 디바운스가 왜 이것을 못 막는지 설명하고, Network 패널에서 수정 전/후에 각각 무엇이 관찰되어야 하는지 답하라.

<details>
<summary>정답과 해설</summary>

디바운스는 **발사 횟수**를 줄일 뿐이다. 300ms 이상 간격을 두고 타이핑이 이어지면 요청이 여러 개 발사되고, 완료 순서는 발신 순서와 무관하다(응답 크기·서버 처리 시간·연결 상태에 따라 뒤바뀐다). "지웠다 다시 치기"는 정확히 300ms를 넘기기 쉬운 조작이라 두 요청이 모두 발사되고, 첫 요청(이전 검색어)이 늦게 도착하면 마지막 render가 그것으로 덮인다 — 응답 역전이다.

수정은 새 요청 발사 시 이전 요청의 AbortController.abort() 호출(+ AbortError 무시 처리). 관찰 기준 — 수정 전: Network 패널에 두 요청 모두 200으로 완료되고, 타이밍에 따라 이전 요청의 응답이 나중에 도착하는 워터폴이 보인다. 수정 후: 새 요청이 발사되는 순간 이전 요청의 Status가 **(canceled)** 로 표시된다. 이 "(canceled)"의 존재가 과제 B의 완성 기준이다. 추가 방어로 render 직전 `signal.aborted` 재확인을 두면 파싱 도중의 역전까지 막는다.
</details>

## 참고 자료

- [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/) — 리소스 로딩 알고리즘 전체와 fetch() API. CORS 판정 절차의 원문이 여기 있다.
- [WHATWG Streams Standard](https://streams.spec.whatwg.org/) — ReadableStream의 잠금·tee·배압 모델.
- [MDN — Using the Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) — 옵션별(cache, credentials, signal) 실용 정리.
- [MDN — Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) — SOP와 CORS 개요. 헤더 상세는 Phase 7-2에서 이 문서로 돌아온다.
- [web.dev — sendBeacon / keepalive로 페이지 이탈 시 데이터 보내기](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon) — 이탈 시 전송 보장의 공식 레퍼런스.
