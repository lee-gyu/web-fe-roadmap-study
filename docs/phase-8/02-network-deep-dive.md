# 8-2. 네트워크 심화

> 한 줄 요약: 이 문서를 읽고 나면 브라우저가 리소스를 발견하고 우선순위를 정하고 CORS·캐시·리소스 힌트를 적용하는 흐름을 Network 워터폴로 진단할 수 있다.

이 문서는 Fetch Standard의 CORS 모델, MDN의 CORS·resource hint 문서, Chrome DevTools Network 패널과 Fetch Priority 문서를 기준으로 한다. 요청 우선순위와 preload scanner의 세부 동작은 브라우저 구현에 따라 다를 수 있으므로, 표준이 정한 보안·HTTP 의미론과 Chromium DevTools에서 관찰되는 우선순위 표시를 구분해 읽어야 한다.

## 학습 목표

- 브라우저가 navigation request, subresource request, script-initiated fetch를 서로 다른 맥락으로 처리하는 이유를 설명할 수 있다.
- CORS가 same-origin policy를 우회하는 "서버 opt-in 기반 응답 읽기 권한"임을 설명하고, simple request와 preflight request의 차이를 재현할 수 있다.
- `preload`, `preconnect`, `dns-prefetch`, `fetchpriority`, lazy loading이 각각 발견 시점, 연결 준비, fetch 우선순위 중 무엇을 바꾸는지 판단할 수 있다.
- 브라우저 캐시, 공유 캐시, CDN 캐시의 차이와 `Cache-Control`, `Vary`, cache status header를 해석할 수 있다.
- DevTools Network 패널에서 initiator, priority, timing, connection, response header를 읽어 리소스 병목을 진단할 수 있다.

## 배경: 왜 이것이 존재하는가

Phase 2에서는 HTTP 의미론, 캐싱, TLS를 프로토콜 관점에서 다뤘다. Phase 3-8에서는 `fetch()`가 HTTP 캐시와 CORS를 통과해 응답 스트림을 제공하는 API라는 점을 봤다. Phase 6-5에서는 정적 배포와 CDN 캐시 무효화를 다뤘다.

이 문서는 같은 네트워크를 **브라우저 실행 환경**에서 다시 본다. 브라우저는 단순한 HTTP 클라이언트가 아니다. HTML 파서는 문서를 읽으며 CSS, script, image, font를 발견한다. preload scanner는 파서보다 앞서 일부 리소스를 추측해 요청한다. 렌더링 엔진은 CSS와 font를 첫 페인트의 전제 조건으로 본다. 보안 모델은 어떤 응답을 JavaScript가 읽을 수 있는지 제한한다. 캐시 계층은 응답을 재사용할지 재검증할지 결정한다.

그래서 프론트엔드의 네트워크 최적화는 "요청 수를 줄인다"보다 더 정교하다.

```text
리소스는 언제 발견되는가?
연결은 준비되어 있는가?
다른 리소스와 경쟁할 때 우선순위가 맞는가?
응답은 읽을 수 있는가?
캐시는 어떤 key로 재사용되는가?
```

이 질문에 답해야 LCP 이미지가 늦게 뜨는 이유, 폰트가 render blocking이 되는 이유, preflight가 API 호출마다 붙는 이유, 배포 후 특정 사용자에게 옛 JS가 남는 이유를 계층별로 나눠 볼 수 있다.

## 핵심 개념

### 브라우저 요청은 시작 맥락이 다르다

브라우저의 요청은 크게 세 갈래로 볼 수 있다.

| 요청 종류 | 시작점 | 예시 | 주요 제약 |
|---|---|---|---|
| navigation request | 주소창, 링크 클릭, form 제출, History navigation | HTML 문서 요청 | 문서 응답을 browsing context에 로드한다 |
| subresource request | HTML/CSS 파서와 렌더링 엔진 | CSS, JS, image, font, iframe | 리소스 종류별 우선순위와 차단 규칙이 있다 |
| script-initiated request | JavaScript API | `fetch()`, XHR, dynamic import | CORS, credentials, body stream, cache mode의 영향을 받는다 |

HTML 안에 같은 URL이 있더라도 어떤 맥락에서 요청되었는지에 따라 브라우저의 판단이 달라진다.

```html
<!-- subresource request: 이미지로 표시할 수 있다. -->
<img src="https://cdn.example.com/photo.jpg" alt="" />

<script type="module">
  // script-initiated request: 응답 본문을 JS가 읽으려면 CORS 허용이 필요하다.
  const response = await fetch("https://cdn.example.com/photo.jpg");
  const blob = await response.blob();
  console.log(blob.size);
</script>
```

이미지는 cross-origin이어도 표시될 수 있다. 그러나 JavaScript가 그 응답 본문을 읽으려면 서버가 CORS 헤더로 허용해야 한다. 같은 네트워크 요청처럼 보여도 "화면에 임베드할 수 있는가"와 "스크립트가 바이트를 읽을 수 있는가"는 다른 권한이다.

폰트도 별도 규칙을 가진다. cross-origin font는 CORS 확인이 필요하다. canvas에 cross-origin 이미지를 그린 뒤 픽셀을 읽는 것도 응답 읽기와 연결된다. 브라우저 보안 모델은 단순히 "요청을 보낼 수 있는가"가 아니라 "응답으로 무엇을 할 수 있는가"를 나눈다.

### 리소스 발견 시점이 워터폴의 시작을 결정한다

브라우저는 HTML을 순서대로 파싱한다. 파서가 `<link rel="stylesheet">`, `<script>`, `<img>`를 만나면 리소스 요청 후보가 생긴다. 하지만 모든 리소스가 같은 시점에 발견되는 것은 아니다.

```html
<!doctype html>
<meta charset="utf-8" />
<link rel="stylesheet" href="/app.css" />

<main class="hero">
  <h1>Product</h1>
</main>
```

```css
.hero {
  background-image: url("/hero.avif");
}
```

`/app.css`는 HTML 파서가 발견한다. 하지만 `/hero.avif`는 CSS 파일을 다운로드하고 파싱해야 발견된다. LCP 후보가 CSS background image라면 이미지 요청이 HTML 안의 `<img>`보다 늦게 시작될 수 있다. 이때 `preload`는 "이 리소스를 빨리 발견하라"는 선언으로 쓸 수 있다.

```html
<link rel="preload" as="image" href="/hero.avif" fetchpriority="high" />
<link rel="stylesheet" href="/app.css" />
```

`preload`는 단순한 우선순위 힌트가 아니다. 브라우저에게 특정 리소스 fetch를 명시적으로 시작하게 하는 선언이다. `as` 속성은 리소스 종류를 알려 올바른 우선순위, CORS 모드, Content Security Policy 적용, 캐시 재사용에 영향을 준다. `as`가 틀리거나 나중에 실제 사용과 맞지 않으면 중복 요청이나 재사용 실패가 생길 수 있다.

`preload`가 필요한 대표 사례:

- CSS 안에서 늦게 발견되는 LCP background image
- font 파일
- 동적 import 청크 중 초기 화면에 필수인 파일
- script가 실행된 뒤에야 URL을 알 수 있는 핵심 리소스

반대로 HTML에서 곧바로 발견되는 일반 이미지와 script를 무조건 preload하면 네트워크 경쟁만 심해질 수 있다.

### CORS는 응답 읽기를 서버가 opt-in하는 모델이다

Same-origin policy는 다른 origin의 응답을 JavaScript가 마음대로 읽지 못하게 막는다. origin은 scheme, host, port의 조합이다.

```text
https://app.example.com:443
  scheme: https
  host: app.example.com
  port: 443
```

CORS(Cross-Origin Resource Sharing)는 서버가 HTTP 헤더로 "이 origin의 스크립트가 응답을 읽어도 된다"고 표시하는 프로토콜이다.

```http
Access-Control-Allow-Origin: https://app.example.com
```

중요한 점은 CORS가 요청 자체를 항상 막는 것은 아니라는 점이다. 브라우저는 많은 cross-origin 요청을 보낼 수 있다. CORS 실패는 대개 **응답을 JavaScript에 노출하지 않는 것**으로 나타난다. 서버 로그에는 요청이 찍혔는데 브라우저 콘솔에는 CORS 에러가 날 수 있는 이유가 이것이다.

다음 예제는 두 origin을 로컬에서 만든다. 파일 이름을 `cors-demo.mjs`로 저장하고 실행한다.

```js
import { createServer } from "node:http";

const api = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "http://localhost:3000",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-demo",
      "Access-Control-Max-Age": "60",
    });
    response.end();
    return;
  }

  if (request.url === "/public") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "http://localhost:3000",
    });
    response.end(JSON.stringify({ ok: true, type: "cors allowed" }));
    return;
  }

  if (request.url === "/blocked") {
    response.writeHead(200, {
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify({ ok: true, type: "no cors header" }));
    return;
  }

  response.writeHead(404);
  response.end();
});

api.listen(4000, () => {
  console.log("API: http://localhost:4000");
});

const app = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <meta charset="utf-8" />
    <button id="allowed">allowed GET</button>
    <button id="blocked">blocked GET</button>
    <button id="preflight">preflight POST</button>
    <pre id="log"></pre>
    <script type="module">
      const log = document.querySelector("#log");
      const write = (message) => {
        log.textContent += message + "\\n";
      };

      document.querySelector("#allowed").addEventListener("click", async () => {
        const response = await fetch("http://localhost:4000/public");
        write(await response.text());
      });

      document.querySelector("#blocked").addEventListener("click", async () => {
        try {
          const response = await fetch("http://localhost:4000/blocked");
          write(await response.text());
        } catch (error) {
          write("blocked: " + error.message);
        }
      });

      document.querySelector("#preflight").addEventListener("click", async () => {
        const response = await fetch("http://localhost:4000/public", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Demo": "phase8"
          },
          body: JSON.stringify({ hello: "cors" })
        });
        write(await response.text());
      });
    </script>`);
});

app.listen(3000, () => {
  console.log("APP: http://localhost:3000");
});
```

```sh
node cors-demo.mjs
```

브라우저에서 `http://localhost:3000`을 열고 Network 패널을 켠다.

- `allowed GET`: API가 `Access-Control-Allow-Origin`을 보내므로 응답을 읽을 수 있다.
- `blocked GET`: 요청은 서버에 도착하지만, 응답에 CORS 허용 헤더가 없어 JavaScript가 읽지 못한다.
- `preflight POST`: `Content-Type: application/json`과 `X-Demo` 헤더 때문에 실제 POST 전에 `OPTIONS` preflight가 먼저 보인다.

### simple request는 preflight 없이 보내지만 응답 공유는 여전히 필요하다

MDN은 역사적 이유로 preflight를 발생시키지 않는 요청을 simple request라고 설명한다. Fetch Standard 자체는 이 용어를 중심 모델로 쓰지 않지만, 실무에서는 여전히 유용한 분류다.

대표 조건은 다음과 같다.

| 조건 | simple request에 가까운 값 |
|---|---|
| method | `GET`, `HEAD`, `POST` |
| 수동 설정 header | CORS-safelisted request header만 |
| `Content-Type` | `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` |
| body stream | `ReadableStream` 사용 없음 |

`POST`라고 해서 항상 preflight가 발생하는 것은 아니다.

```js
await fetch("https://api.example.com/form", {
  method: "POST",
  headers: {
    "Content-Type": "text/plain",
  },
  body: "hello",
});
```

반대로 `GET`이라도 개발자가 safelist 밖의 header를 붙이면 preflight가 발생할 수 있다.

```js
await fetch("https://api.example.com/data", {
  headers: {
    "X-Trace-Id": crypto.randomUUID(),
  },
});
```

preflight는 서버에 실제 요청을 보내기 전에 "이 method와 header를 허용하는가"를 묻는 `OPTIONS` 요청이다.

```http
OPTIONS /data HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: GET
Access-Control-Request-Headers: x-trace-id
```

서버가 허용하면 다음과 같이 응답한다.

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET
Access-Control-Allow-Headers: x-trace-id
Access-Control-Max-Age: 600
```

`Access-Control-Max-Age`는 preflight 결과를 일정 시간 캐시하게 한다. API 호출마다 preflight가 붙어 지연이 커진다면, 무작정 CORS를 끄는 것이 아니라 method/header 설계와 preflight cache를 함께 봐야 한다.

### credentials가 들어가면 wildcard가 충분하지 않다

쿠키나 HTTP 인증 정보를 cross-origin 요청에 포함하려면 클라이언트와 서버가 모두 opt-in해야 한다.

```js
await fetch("https://api.example.com/me", {
  credentials: "include",
});
```

서버 응답:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

credentialed request에는 `Access-Control-Allow-Origin: *`를 사용할 수 없다. 특정 origin을 반환해야 한다. 또한 origin별 응답이 달라질 수 있으므로 공유 캐시를 통과한다면 `Vary: Origin`이 중요하다. 이것을 빼면 한 origin에 허용된 응답이 다른 origin에 캐시로 재사용되는 위험이 생길 수 있다.

CORS는 인증이 아니다. `Access-Control-Allow-Origin`은 "브라우저가 이 응답을 해당 origin의 스크립트에 노출해도 되는가"를 정한다. 서버는 여전히 세션, 토큰, 권한, CSRF 방어를 별도로 검증해야 한다. 이 주제는 [8-4 웹 보안](./04-web-security.md)에서 더 다룬다.

### 리소스 힌트는 서로 다른 병목을 건드린다

resource hint는 브라우저의 네트워크 스케줄러에 정보를 주는 도구다. 같은 "미리"라는 단어로 묶이지만 각자 건드리는 지점이 다르다.

| 도구 | 바꾸는 것 | 예시 | 경계 조건 |
|---|---|---|---|
| `dns-prefetch` | DNS 조회를 미리 한다 | `<link rel="dns-prefetch" href="//cdn.example.com">` | 연결 자체는 열지 않는다 |
| `preconnect` | DNS, TCP, TLS handshake를 미리 시작한다 | `<link rel="preconnect" href="https://cdn.example.com">` | 중요한 origin 몇 개에만 써야 한다 |
| `preload` | 특정 리소스를 일찍 발견해 fetch한다 | `<link rel="preload" as="font" href="/font.woff2" crossorigin>` | 잘못 쓰면 중복 요청과 경쟁을 만든다 |
| `modulepreload` | ESM module graph 일부를 미리 fetch/parse한다 | `<link rel="modulepreload" href="/src/main.js">` | 번들러가 생성하는 graph와 맞아야 한다 |
| `fetchpriority` | fetch 상대 우선순위를 힌트로 준다 | `<img src="/hero.avif" fetchpriority="high">` | 발견 시점을 앞당기지는 않는다 |
| `loading="lazy"` | offscreen image/iframe 요청을 늦춘다 | `<img src="/below.avif" loading="lazy">` | LCP 후보에 쓰면 늦어진다 |

LCP 이미지가 CSS background라 늦게 발견되는 문제라면 `fetchpriority="high"`만으로는 부족하다. 먼저 발견 시점을 앞당겨야 하므로 `preload`가 필요하다. 반대로 HTML 안의 hero `<img>`가 이미 일찍 발견되지만 다른 이미지와 경쟁해 우선순위가 낮다면 `fetchpriority="high"`가 더 직접적일 수 있다.

```html
<!-- CSS background LCP: 발견 시점과 우선순위를 함께 다룬다. -->
<link rel="preload" as="image" href="/hero.avif" fetchpriority="high" />

<!-- HTML img LCP: 이미 발견된다면 priority hint만으로 충분할 수 있다. -->
<img src="/hero.avif" alt="Product screenshot" fetchpriority="high" />
```

`preconnect`도 비용이 있다. 많은 third-party origin에 동시에 preconnect를 걸면 실제로 필요한 연결과 경쟁하고 소켓·TLS 리소스를 낭비한다. 정확한 URL은 모르지만 곧 필요한 핵심 origin에만 쓰고, 나머지는 `dns-prefetch` 정도로 낮춘다.

### 캐시는 key와 계층을 함께 봐야 한다

Phase 2-2에서 HTTP 캐싱의 신선도와 재검증을 다뤘다. 브라우저 네트워크 진단에서는 캐시가 어디에 있는지까지 봐야 한다.

| 계층 | 위치 | 대표 신호 | 주의점 |
|---|---|---|---|
| memory cache | 현재 브라우저 프로세스 메모리 | DevTools Size에 memory cache | 탭/프로세스 수명에 묶인다 |
| disk cache | 브라우저 디스크 캐시 | disk cache | 사용자별, 브라우저별 상태다 |
| service worker cache | 사이트가 제어하는 Cache Storage | Application 패널 | HTTP 캐시와 별도 정책이다 |
| shared cache/CDN | 프록시, CDN edge | `Age`, `X-Cache`, `CF-Cache-Status` 등 | cache key와 `Vary`가 중요하다 |
| origin cache | 서버 내부 | `Server-Timing`, custom header | 브라우저에서는 간접 신호만 보인다 |

`Cache-Control`은 신선도와 재검증을 지시하고, `Vary`는 요청 header 중 어떤 값이 cache key에 참여하는지 알려 준다.

```http
Cache-Control: public, max-age=31536000, immutable
```

content hash가 붙은 정적 asset에는 장기 캐시가 잘 맞는다.

```http
Cache-Control: no-cache
```

HTML 문서에는 재검증이 필요하다. HTML이 새 asset URL을 가리키는 포인터이기 때문이다.

```http
Vary: Accept-Encoding, Origin
```

응답이 `Origin`에 따라 달라진다면 `Vary: Origin`이 필요할 수 있다. 그러나 `Vary`를 과도하게 늘리면 cache key가 쪼개져 hit ratio가 낮아진다. 캐시는 "저장한다"가 아니라 "어떤 요청을 같은 것으로 볼 것인가"의 문제다.

## 실무 관점

### Network 워터폴은 발견, 대기, 전송, 실행을 분리해서 읽는다

DevTools Network 패널에서 한 요청의 전체 시간이 길어도 원인은 다를 수 있다.

| 관찰 지점 | 의미 | 대표 원인 |
|---|---|---|
| Initiator | 누가 요청을 시작했는가 | HTML parser, CSS, script, preload, fetch |
| Queueing/Stalled | 요청이 대기한 시간 | 우선순위 경쟁, connection limit, service worker, disk cache |
| DNS/TCP/TLS | 연결 준비 | 새 origin, preconnect 없음, handshake 비용 |
| Request/TTFB | 서버 첫 바이트까지 | 서버 처리, CDN miss, origin 거리 |
| Content Download | 본문 전송 | 파일 크기, bandwidth, compression |
| Priority | 브라우저 우선순위 | 리소스 종류, 위치, `fetchpriority`, preload |

LCP 이미지가 늦다면 다음 순서로 본다.

1. 이미지가 HTML에서 직접 발견되는가, CSS/JS 뒤에 숨어 있는가?
2. 요청 priority가 낮게 시작하는가?
3. 같은 시점에 큰 JS/CSS/font가 bandwidth를 차지하는가?
4. connection setup이 늦는가?
5. CDN cache miss 또는 origin TTFB가 긴가?
6. 다운로드 후 decode/rendering이 늦는가?

8-3의 Core Web Vitals 문서에서는 이 워터폴을 LCP/INP/CLS 지표와 연결한다.

### CORS 에러는 서버 로그와 브라우저 관찰을 함께 본다

CORS 문제를 디버깅할 때 흔한 오해는 "서버가 요청을 못 받았다"다. 실제로는 서버가 응답했지만 브라우저가 응답을 스크립트에 노출하지 않았을 수 있다.

점검 순서:

- Network 패널에 실제 요청이 있는가?
- preflight `OPTIONS`가 먼저 실패했는가, actual request 응답 노출이 실패했는가?
- 응답에 `Access-Control-Allow-Origin`이 있는가?
- credentialed request인데 wildcard를 쓰고 있지 않은가?
- custom header 때문에 preflight가 발생했는가?
- CDN이나 reverse proxy가 CORS header를 누락하거나 캐시하고 있지 않은가?
- origin별 응답인데 `Vary: Origin`이 빠져 있지 않은가?

프론트엔드에서 `mode: "no-cors"`를 붙이는 것은 대부분 해법이 아니다. `no-cors` 요청은 opaque response를 만들며 JavaScript가 본문과 대부분의 header를 읽지 못한다. "에러가 사라졌다"가 아니라 "읽을 수 없는 응답을 받았다"에 가깝다.

### 리소스 힌트는 최소한의 경쟁 조정이어야 한다

리소스 힌트를 적용할 때는 한 번에 하나의 가설만 검증한다.

| 문제 | 우선 후보 | 측정 |
|---|---|---|
| CSS background LCP가 늦게 발견됨 | `preload as=image` | 요청 시작 시간이 앞당겨졌는가 |
| third-party API의 TTFB 앞 handshake가 김 | `preconnect` | DNS/TCP/TLS 구간이 줄었는가 |
| 첫 화면 hero image priority가 낮음 | `fetchpriority="high"` | Priority와 LCP가 개선되었는가 |
| 아래쪽 이미지가 bandwidth를 차지함 | `loading="lazy"` | 초기 워터폴 경쟁이 줄었는가 |
| font가 늦게 발견됨 | `preload as=font crossorigin` | font 요청 시작과 layout shift가 개선되었는가 |

`preload`를 많이 추가하면 모든 것이 빨라지는 것이 아니라, 모든 것이 서로 더 빨리 경쟁한다. critical resource를 고르는 일이 먼저다.

### CDN 캐시는 성능 기능이면서 일관성 위험이다

CDN은 사용자 가까운 edge에서 응답을 주기 때문에 TTFB를 줄일 수 있다. 하지만 캐시 key와 무효화 정책이 틀리면 사용자마다 다른 버전을 보거나 private 응답이 공유될 수 있다.

| 상황 | 좋은 접근 | 위험한 접근 |
|---|---|---|
| hash asset | 장기 immutable 캐시 | 같은 URL의 파일 내용을 덮어쓰기 |
| HTML | 짧은 max-age 또는 no-cache | 장기 캐시로 새 asset URL 발견 지연 |
| API public 목록 | 짧은 TTL + stale-while-revalidate | 사용자별 권한 응답을 public 캐시 |
| origin별 CORS 응답 | `Vary: Origin` 검토 | origin별 ACAO를 CDN이 섞어 재사용 |
| AB test/personalization | 명시적 cache key 설계 | 쿠키 전체를 Vary해 hit ratio 붕괴 |

프론트엔드 네트워크 분석에서는 CDN header를 읽는 습관이 필요하다. `Age`, `Via`, `Server-Timing`, vendor별 cache status header는 "느린 것이 origin인가 edge인가 브라우저인가"를 나누는 단서다.

## 더 깊이

### preload scanner는 HTML 파서의 한계를 보완하지만 완전한 실행기는 아니다

HTML 파서는 script를 만나면 실행 순서 보장을 위해 파싱을 멈출 수 있다. 브라우저는 이 지연을 줄이기 위해 preload scanner를 사용한다. preload scanner는 아직 메인 파서가 도달하지 않은 HTML에서 명확한 리소스 URL을 찾아 미리 요청할 수 있다.

하지만 preload scanner는 JavaScript를 실행하지 않는다. CSS를 완전히 해석해서 모든 background image를 알 수도 없다. 따라서 다음 리소스는 늦게 발견되기 쉽다.

- CSS 안의 `background-image`
- JavaScript 실행 후 만들어지는 `fetch()` URL
- 조건부 import나 dynamic import
- client-side router 전환 후 필요한 route chunk
- 사용자 상호작용 후 삽입되는 image/script

이런 리소스가 초기 사용자 경험의 핵심이면 preload, modulepreload, route prefetch 같은 명시적 전략이 필요할 수 있다. 단, 아직 필요하지 않은 리소스까지 앞당기면 현재 화면의 critical path를 방해한다.

### HTTP/2와 HTTP/3에서도 우선순위는 단순하지 않다

HTTP/1.1에서는 connection 수 제한과 head-of-line blocking 때문에 요청 수 자체가 큰 문제였다. HTTP/2와 HTTP/3는 multiplexing으로 이 문제를 크게 줄였다. 그렇다고 우선순위 문제가 사라진 것은 아니다. bandwidth와 서버 처리량은 여전히 유한하고, 브라우저·CDN·origin이 priority signal을 모두 같은 방식으로 처리하지도 않는다.

`fetchpriority`는 힌트다. 브라우저는 이를 내부 스케줄링에 반영할 수 있지만, CDN이나 서버까지 항상 같은 우선순위로 재조정한다고 보장할 수 없다. 그래서 priority 최적화는 반드시 Network 패널과 실제 성능 지표로 확인해야 한다.

### CORS와 CSRF는 같은 cross-origin 상황을 다르게 본다

CORS는 다른 origin의 응답을 JavaScript가 읽을 수 있는지의 문제다. CSRF는 브라우저가 사용자의 쿠키를 자동으로 붙여 cross-site 요청을 보낼 수 있다는 문제다.

```text
CORS: 공격자 스크립트가 응답을 읽을 수 있는가?
CSRF: 공격자 페이지가 사용자의 권한으로 상태 변경 요청을 보낼 수 있는가?
```

preflight가 발생한다고 해서 CSRF가 자동으로 해결되는 것은 아니다. SameSite 쿠키, CSRF token, custom header, CORS 설정은 함께 설계해야 한다. 이 구분을 놓치면 "CORS를 막았으니 안전하다"거나 "CORS를 열었으니 인증이 된다" 같은 잘못된 결론으로 이어진다.

## 정리

- 브라우저 요청은 navigation, subresource, script-initiated fetch처럼 시작 맥락이 다르고, 각 맥락마다 보안·우선순위·차단 규칙이 달라진다.
- CORS는 요청 전송 자체보다 응답을 JavaScript에 노출할지 결정하는 서버 opt-in 모델이다.
- preflight는 method/header/content-type 등이 simple request 범위를 벗어날 때 실제 요청 전에 허용 여부를 확인하는 `OPTIONS` 요청이다.
- `preload`, `preconnect`, `dns-prefetch`, `fetchpriority`, lazy loading은 각각 발견 시점, 연결 준비, 우선순위, 지연 로딩을 다루므로 문제에 맞게 골라야 한다.
- 캐시는 계층과 key가 중요하며, `Cache-Control`, `Vary`, CDN cache status header를 함께 읽어야 한다.

## 확인 문제

1. 서버 로그에는 `GET /blocked`가 200으로 찍혔는데 브라우저의 `fetch()`는 CORS 에러를 낸다. 이 상황은 어떻게 설명할 수 있는가?

<details>
<summary>정답과 해설</summary>

CORS는 요청이 서버에 도착하는지보다 응답을 JavaScript에 노출할 수 있는지를 결정한다. 서버가 200 응답을 보냈더라도 `Access-Control-Allow-Origin`이 없거나 현재 origin과 맞지 않으면 브라우저는 응답 본문을 스크립트에 제공하지 않는다. 서버 로그와 브라우저 콘솔/Network 패널을 함께 봐야 한다.

</details>

2. CSS background image가 LCP 후보인데 요청 시작이 늦다. `fetchpriority="high"`만으로 충분하지 않을 수 있는 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

`fetchpriority`는 이미 발견된 리소스의 상대 우선순위에 영향을 주는 힌트다. CSS background image는 HTML 파서가 바로 발견하지 못하고 CSS 다운로드·파싱 뒤에 발견될 수 있다. 발견 시점 자체가 늦다면 `preload as=image`로 먼저 발견시키고, 필요한 경우 `fetchpriority="high"`를 함께 사용해야 한다.

</details>

3. API 요청에 `X-Trace-Id` header를 붙인 뒤 호출마다 `OPTIONS`가 보이기 시작했다. 무슨 일이 일어난 것인가?

<details>
<summary>정답과 해설</summary>

수동 설정 header가 CORS-safelisted request header 범위를 벗어나 preflight 대상이 된 것이다. 브라우저는 실제 요청 전에 `OPTIONS` 요청으로 서버가 `X-Trace-Id` header와 해당 method를 허용하는지 확인한다. 서버는 `Access-Control-Allow-Headers`와 `Access-Control-Max-Age`를 적절히 응답해야 하며, 필요 없는 custom header라면 제거하는 것도 선택지다.

</details>

4. CDN이 origin별로 다른 `Access-Control-Allow-Origin` 값을 캐시한다. 어떤 header를 검토해야 하며, 과도하게 쓰면 어떤 비용이 생기는가?

<details>
<summary>정답과 해설</summary>

`Vary: Origin`을 검토해야 한다. 응답이 `Origin` 요청 header에 따라 달라진다면 캐시 key에도 Origin이 들어가야 안전하다. 다만 `Vary`가 늘어날수록 cache key가 쪼개져 hit ratio가 낮아질 수 있다. 안전성과 캐시 효율의 트레이드오프를 함께 봐야 한다.

</details>

## 참고 자료

- [Fetch Standard](https://fetch.spec.whatwg.org/) — 브라우저 fetch, CORS protocol, request/response 처리 모델을 정의하는 표준이다.
- [MDN: Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) — simple request, preflight, CORS header와 credentials 처리 방식을 예제와 함께 확인할 수 있다.
- [MDN: `rel="preload"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload) — preload의 `as` 속성과 리소스 발견 시점 최적화 방식을 확인할 수 있다.
- [MDN: `rel="preconnect"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preconnect) — DNS/TCP/TLS handshake를 미리 시작하는 힌트와 과도한 사용의 비용을 설명한다.
- [MDN: `HTMLImageElement.fetchPriority`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/fetchPriority) — image fetch priority 속성과 Baseline 상태를 확인할 수 있다.
- [web.dev: Optimize resource loading with the Fetch Priority API](https://web.dev/articles/fetch-priority) — Chrome의 리소스 우선순위 모델과 `fetchpriority` 적용 사례를 설명한다.
- [Chrome DevTools Network features reference](https://developer.chrome.com/docs/devtools/network/reference) — Network 패널의 timing, initiator, priority, throttling 등 분석 기능을 확인할 수 있다.
- [MDN: Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) — HTTP 캐시 신선도와 재검증 지시어를 확인할 수 있다.
- [MDN: Vary](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary) — 요청 header에 따라 cache key가 달라지는 방식을 확인할 수 있다.
