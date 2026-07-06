# 6-2. 번들러

> 한 줄 요약: 이 문서를 읽고 나면 번들러가 모듈 그래프에서 무엇을 계산하는지, 트리 셰이킹과 코드 분할이 어떤 조건에서 성립하는지, Vite가 개발과 빌드에서 다른 전략을 쓰는 이유를 설명할 수 있다.

이 문서는 Vite 8.1 문서, Rollup 4 계열의 트리 셰이킹 모델, 그리고 [3-9 모듈](../phase-3/09-modules.md)에서 세운 ESM 정적 그래프를 기준으로 한다. Vite는 과거 `esbuild` 개발 변환 + Rollup 프로덕션 빌드라는 이중 구조로 알려졌고, 2026년 현재 문서는 Rolldown/Oxc 기반의 단일 도구 체인으로 수렴하는 방향을 설명한다. 이 장에서는 구현 이름보다 오래 가는 모델, 즉 **개발은 온디맨드 ESM, 배포는 최적화된 번들**이라는 분리를 중심에 둔다.

## 학습 목표

- 브라우저가 ESM을 지원하는 시대에도 번들러가 필요한 이유를 요청 폭포, 변환, 최적화 관점에서 설명할 수 있다.
- 번들러가 엔트리에서 모듈 그래프를 구성하고, 정적 import와 동적 import를 다르게 처리하는 방식을 설명할 수 있다.
- 트리 셰이킹(tree shaking)이 ESM의 정적 구조와 side effect 판정 위에서만 안전하게 성립한다는 점을 판단할 수 있다.
- Vite의 개발 서버, dependency pre-bundling, HMR, 프로덕션 빌드가 각각 최적화하는 비용을 구분할 수 있다.
- 번들 분석 결과를 보고 "중복 의존성", "트리 셰이킹 실패", "청크 워터폴" 중 어느 계층의 문제인지 진단할 수 있다.

## 배경: 왜 이것이 존재하는가

초기 브라우저에서 JavaScript 파일은 `<script>` 태그 순서로 전역에 붙었다. 모듈 시스템이 없었고, 파일 수가 늘어날수록 요청 수와 전역 오염이 함께 늘었다. CommonJS는 Node의 로컬 디스크에서는 잘 맞았지만 브라우저에서는 `require()`의 동기 로딩이 성립하지 않았다. 그래서 bundler가 등장했다. 여러 파일을 미리 읽어 하나 또는 소수의 파일로 합치고, 브라우저가 이해하지 못하는 module specifier와 문법을 변환했다.

[3-9](../phase-3/09-modules.md)에서 본 것처럼 브라우저는 이제 `<script type="module">`을 지원한다. 그렇다면 번들러는 사라져야 하는가? 절반만 맞다. 개발 중에는 네이티브 ESM을 그대로 서빙할 수 있다. 하지만 배포에서는 여전히 문제가 남는다.

- npm 패키지는 bare specifier(`"react"`)와 CJS/UMD 포맷을 포함한다. 브라우저가 직접 해석하지 못한다.
- `tsx`, JSX, 최신 문법, CSS import, asset import는 브라우저 런타임 전에 변환되어야 한다.
- 파일 수백 개가 계층적으로 import되면 HTTP/2에서도 그래프 깊이만큼 요청 폭포가 생긴다.
- 사용하지 않는 export와 dead code는 빌드 시점에 제거해야 다운로드 비용이 줄어든다.
- 동적 import를 기준으로 청크를 나눠 첫 화면 비용과 이후 이동 비용을 조절해야 한다.

즉 번들러는 "ESM이 없어서 필요한 도구"에서 "ESM 그래프를 최적화해 배포 가능한 산출물로 계산하는 도구"로 위치가 바뀌었다. C/C++의 링커가 object file을 결합하고 안 쓰는 심볼을 제거하듯, JS 번들러는 모듈 그래프를 읽고 런타임 비용이 낮은 파일 그래프로 다시 쓴다.

이 장은 [4-5 컴파일러와 설정](../phase-4/05-compiler-and-config.md)의 "변환과 타입 검사는 분리된다", [5-7 라우팅과 코드 분할](../phase-5/07-routing-and-code-splitting.md)의 "동적 import는 청크 경계가 된다"를 이어받는다.

## 핵심 개념

### 번들러는 모듈 그래프를 계산한다

가장 작은 번들러의 입력은 entry file이다.

```js
// src/main.js
import { formatPrice } from "./money.js";
import { render } from "./view.js";

render(formatPrice(12000));
```

번들러는 `main.js`를 파싱해 정적 import를 찾고, 각 specifier를 실제 파일 또는 패키지 entry로 해석한다. 이 과정을 재귀하면 그래프가 생긴다.

```text
main.js
├─ money.js
└─ view.js
   └─ dom.js
```

이 그래프의 중요한 성질은 **실행 전에 구성된다**는 점이다. ESM의 import/export가 구문이기 때문에 가능하다. 그래서 번들러는 다음 질문에 답할 수 있다.

- 어떤 파일이 최종 산출물에 도달 가능한가.
- 어떤 export가 실제로 읽히는가.
- 어떤 모듈은 평가해야 하지만 export는 필요 없는가.
- 어떤 import가 동적 import라 별도 청크 경계가 되는가.

동적 import는 그래프에 다른 표시를 만든다.

```js
// src/router.js
export async function openAdmin() {
  const mod = await import("./admin.js");
  mod.renderAdmin();
}
```

정적 import는 entry chunk에 들어간다. 동적 import는 Promise를 반환하는 런타임 경계이므로, 번들러는 `admin.js`와 그 의존성을 별도 chunk로 뺄 수 있다. [5-7](../phase-5/07-routing-and-code-splitting.md)의 `lazy(() => import("./AdminPage"))`가 실제 네트워크 요청으로 보이는 이유가 이것이다.

관찰은 `vite build` 뒤 산출물을 보는 것으로 충분하다.

```sh
pnpm vite build
find dist/assets -maxdepth 1 -type f | sort
```

동적 import가 있으면 `index-*.js` 외에 route 또는 vendor 성격의 별도 `*.js` 파일이 생긴다. 파일명 해시는 [6-5](./05-ci-and-deployment.md)의 캐시 무효화에서 다시 다룬다.

### 트리 셰이킹은 "안 쓰는 코드 삭제"가 아니라 안전성 판정이다

다음 모듈을 보자.

```js
// math.js
export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}

// main.js
import { add } from "./math.js";
console.log(add(1, 2));
```

`multiply`는 import되지 않는다. 번들러는 이를 제거할 수 있다. 이것이 트리 셰이킹이다. 하지만 실제 문제는 "참조되지 않는다"보다 어렵다. 모듈은 평가 자체가 side effect를 가질 수 있다.

```js
// polyfill.js
Array.prototype.first = function () {
  return this[0];
};

// main.js
import "./polyfill.js";
```

`polyfill.js`는 export가 하나도 없지만 제거하면 프로그램 의미가 바뀐다. 따라서 번들러는 두 종류의 정보를 함께 본다.

```text
1. 정적 그래프: 어떤 export가 참조되는가
2. side effect 판정: 참조되지 않은 모듈 평가를 생략해도 되는가
```

ESM은 1번을 준다. 2번은 정적 분석과 선언의 조합이다. Rollup에는 `treeshake.moduleSideEffects` 같은 옵션이 있고, 라이브러리는 package.json의 `"sideEffects": false` 또는 파일 목록으로 "이 패키지는 import 평가 자체가 부수 효과를 만들지 않는다"는 힌트를 제공할 수 있다. 함수 호출 단위에는 `/*#__PURE__*/` 주석이 쓰인다.

```js
// factory.js
export function makeLogger(name) {
  return {
    log(message) {
      console.log(`[${name}] ${message}`);
    },
  };
}

// main.js
import { makeLogger } from "./factory.js";

const logger = /*#__PURE__*/ makeLogger("debug");
console.log("app started");
```

`logger`를 읽지 않는다면 `makeLogger("debug")` 호출도 제거될 수 있다. `/*#__PURE__*/`는 "이 호출의 반환값을 쓰지 않으면 호출 자체도 지워도 된다"는 힌트다. 잘못 붙이면 필요한 side effect까지 사라진다. 이 주석은 성능 주술이 아니라 의미 보증이다.

CJS는 트리 셰이킹이 어렵다.

```js
// cjs-lib.cjs
const name = process.env.FEATURE;
module.exports[name] = function () {};
```

어떤 export가 존재하는지 실행 전에는 알 수 없다. 번들러가 CJS를 부분적으로 분석해 최적화할 수는 있지만, ESM만큼 안전한 제거는 원리적으로 어렵다. "라이브러리를 하나 import했는데 통째로 들어온다"는 증상은 CJS 포맷, 배럴 파일, side effect 선언 누락 중 하나로 내려가 확인한다.

### 배럴 파일은 그래프를 넓힌다

배럴(barrel) 파일은 import 경로를 짧게 만든다.

```js
// components/index.js
export * from "./Button.js";
export * from "./Modal.js";
export * from "./Chart.js";

// app.js
import { Button } from "./components/index.js";
```

문제는 `Button` 하나를 가져와도 번들러가 `index.js`를 통해 `Modal`, `Chart`까지 스캔해야 한다는 점이다. 스캔이 곧 포함은 아니다. ESM + side effect 없음이 명확하면 제거된다. 그러나 배럴이 CSS import, 전역 등록, CJS 재수출을 섞으면 side effect 판정이 보수적으로 변하고, 결과적으로 큰 모듈이 따라 들어올 수 있다.

따라서 배럴은 "트리 셰이킹이 안 된다"가 아니라 **트리 셰이킹이 증명해야 할 경로를 넓힌다**고 이해하는 것이 정확하다. 번들 분석에서 배럴이 의심되면 직접 경로 import로 바꿔 비교한다.

```js
// 비교 실험
import { Button } from "./components/index.js";
// vs
import { Button } from "./components/Button.js";
```

산출물 크기 변화는 `dist/assets/*.js` 크기와 visualizer로 확인한다. 성능 주장은 반드시 이런 전후 비교로 남긴다.

### Vite 개발 서버는 번들하지 않고 필요한 것만 변환한다

전통적인 webpack dev server는 앱 전체를 먼저 번들한 뒤 브라우저에 준다. 앱이 커질수록 첫 시작과 갱신이 느려진다. Vite의 원래 아이디어는 이 비용을 둘로 나누는 것이다.

```text
의존성: 거의 변하지 않음 → 한 번 pre-bundle하고 강하게 캐시
소스 코드: 자주 변함 → 브라우저 요청 시점에 파일 단위로 변환
```

브라우저는 native ESM으로 `/src/main.tsx`, `/src/App.tsx` 같은 파일을 요청한다. Vite는 요청받은 파일을 즉시 변환해 돌려준다. 첫 화면에 필요 없는 route 파일은 아직 변환하지 않는다. 그래서 dev server startup이 앱 크기에 덜 민감하다.

하지만 의존성은 다르다. React, lodash-es 같은 패키지는 내부 파일이 많거나 CJS/UMD로 배포될 수 있다. Vite는 development에서 dependency pre-bundling을 수행해 CJS/UMD를 ESM으로 바꾸고, 많은 내부 파일을 하나의 모듈로 묶어 브라우저 요청 수를 줄인다. 2026년 Vite 8 문서는 이 pre-bundling이 Rolldown 기반으로 수행된다고 설명한다. 과거 Vite 2~7의 설명에서 자주 보던 esbuild도 같은 역할, 즉 빠른 dependency 변환을 맡았다.

핵심은 도구 이름이 아니라 전략이다.

| 대상 | 개발 전략 | 이유 |
|---|---|---|
| app source | 온디맨드 ESM 변환 | 자주 바뀌므로 전체 재번들을 피한다 |
| dependencies | pre-bundle + HTTP cache | 거의 안 바뀌고 파일 수가 많으므로 한 번 묶는다 |
| production | 최적화된 번들 | 요청 폭포, dead code, 해시 캐싱을 해결한다 |

Vite가 타입 검사를 하지 않는 이유도 여기에 맞물린다. [4-5](../phase-4/05-compiler-and-config.md)에서 본 것처럼 타입 검사는 전체 프로그램 분석이고, 파일 단위 온디맨드 변환과 맞지 않는다. 그래서 Vite는 변환만 하고 `tsc --noEmit`은 별도 프로세스나 CI가 맡는다.

### HMR은 그래프에서 교체 경계를 찾는 작업이다

Hot Module Replacement(HMR)는 파일 변경 시 전체 페이지를 reload하지 않고 바뀐 모듈과 그 수용자만 교체한다. 최소 모델은 이렇다.

```js
// counter.js
export let count = 0;
export function increment() {
  count += 1;
}

if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    console.log("counter module updated", newModule.count);
  });
}
```

모듈이 `import.meta.hot.accept()`를 호출하면 "나는 내 변경을 받아 처리할 수 있다"는 HMR boundary가 된다. 파일이 바뀌면 Vite는 모듈 그래프에서 변경 모듈을 찾고, 위로 올라가며 accept boundary를 찾는다. 경계를 찾으면 해당 모듈만 다시 import하고 콜백을 실행한다. 경계가 없으면 더 위로 전파하고, 끝까지 없으면 full reload가 된다.

React Fast Refresh는 이 프로토콜을 React 컴포넌트 경계에 맞춘 구현이다. 컴포넌트 파일을 갱신할 때 가능한 경우 컴포넌트 상태를 유지한다. 이것은 [5-2](../phase-5/02-rendering-and-reconciliation.md)의 재조정과 다른 계층이다. React 렌더링은 UI 트리 안의 인스턴스 유지 규칙이고, HMR은 모듈 그래프에서 변경된 코드 객체를 교체하는 개발 서버 프로토콜이다. 두 계층이 협력해 "코드는 바뀌었는데 입력 상태는 남아 있는" 경험을 만든다.

### 프로덕션 빌드는 배포 파일 그래프를 다시 쓴다

`vite build`는 개발 서버와 다른 질문에 답한다.

```text
개발: 지금 브라우저가 요청한 한 파일을 빨리 변환해 달라
빌드: 배포할 전체 파일 그래프를 가장 낮은 런타임 비용으로 만들어 달라
```

프로덕션 빌드에서 번들러는 다음을 수행한다.

- entry HTML과 JS에서 시작해 전체 그래프를 수집한다.
- 정적 import는 entry/vendor chunk로 합치고, 동적 import는 별도 chunk로 나눈다.
- 사용하지 않는 export와 dead code를 제거한다.
- CSS와 asset reference를 추적해 파일명에 content hash를 붙인다.
- `index.html`이 새 해시 파일을 가리키도록 다시 쓴다.

`manualChunks` 같은 설정은 이 계산에 사람이 힌트를 주는 것이다. 설정은 목적이 아니라 그래프 계산의 보정이다. 무작정 vendor chunk를 하나로 묶으면 첫 로드는 좋아질 수 있지만, 한 페이지에서만 쓰는 무거운 라이브러리까지 초기 chunk에 들어갈 수 있다. 반대로 너무 잘게 쪼개면 요청 수와 청크 워터폴이 늘어난다.

## 실무 관점

### 증상에서 계층으로 내려가기

| 증상 | 의심 계층 | 확인 방법 |
|---|---|---|
| `import { debounce } from "lodash"`만 했는데 lodash가 크게 들어간다 | 패키지 포맷 또는 import 경로 | ESM entry 여부, `lodash-es`, visualizer 비교 |
| 직접 쓰지 않은 차트 라이브러리가 초기 chunk에 들어간다 | 배럴 파일 또는 side effect | 직접 경로 import 비교, `"sideEffects"` 확인 |
| 같은 라이브러리가 두 번 보인다 | 패키지 설치 그래프 | `pnpm why <pkg>`, [6-1](./01-package-management.md)의 중복 버전 확인 |
| 라우트 분할 뒤 이동이 느리다 | 청크 워터폴 | Network 패널에서 클릭 후 chunk 요청 순서 확인 |
| HMR이 자꾸 full reload로 떨어진다 | HMR boundary | 변경 파일이 accept 가능한 boundary인지, React Fast Refresh 제약 확인 |
| 빌드는 되는데 타입 에러가 배포된다 | 타입 검사 게이트 누락 | CI의 `tsc --noEmit` 존재 여부 |

### 분할 단위의 트레이드오프

| 분할 방식 | 얻는 것 | 포기하는 것 | 무너지는 조건 |
|---|---|---|---|
| 큰 entry chunk | 요청 수가 적고 이동이 빠르다 | 첫 로드 다운로드·파싱이 크다 | 첫 화면에 필요 없는 기능이 많을 때 |
| 라우트 단위 chunk | 첫 로드 비용이 줄고 경계가 명확하다 | 이동 시 chunk 요청이 생긴다 | 사용자가 자주 오가는 핵심 라우트를 과하게 분리할 때 |
| 컴포넌트 단위 세분화 | 무거운 선택 기능을 늦출 수 있다 | fallback 파편화, 요청 폭포 | 작은 공용 컴포넌트까지 쪼갤 때 |
| vendor chunk 고정 | 브라우저 장기 캐시에 유리하다 | 변경 영향이 커질 수 있다 | vendor가 너무 커져 모든 페이지의 초기 비용이 될 때 |

측정은 세 도구를 함께 쓴다.

- 번들 분석: 어떤 모듈이 어느 chunk에 들어갔는가.
- Network 패널: 실제 사용자 흐름에서 어떤 순서로 요청되는가.
- Performance 패널: 다운로드 뒤 파싱·컴파일·실행이 얼마나 걸리는가.

파일 크기만 보면 gzip/brotli 이후 전송 비용은 알 수 있지만, 큰 JS의 파싱·실행 비용은 놓친다. 모바일 저사양 기기에서는 전송보다 main thread 실행이 병목일 수 있다.

### import 스타일의 실무 기준

```js
// ❌ 패키지가 CJS 또는 side-effect-heavy entry라면 통째 포함될 수 있다
import _ from "lodash";

// ✅ ESM entry가 있고 named export가 분리되어 있으면 제거 가능성이 높다
import { debounce } from "lodash-es";

// ✅ 패키지가 subpath export를 안정적으로 제공한다면 직접 경로도 선택지다
import debounce from "lodash/debounce.js";
```

항상 두 번째가 정답은 아니다. 패키지가 subpath exports를 공식으로 보장하지 않으면 내부 경로 import는 깨질 수 있다. 기준은 "이 import 경로가 패키지의 공개 API인가"와 "번들 분석에서 실제로 줄었는가"다.

## 더 깊이

### Chunk 그래프는 모듈 그래프와 다르다

모듈 그래프는 파일 단위 그래프다. chunk 그래프는 배포 파일 단위 그래프다. 번들러는 많은 모듈을 하나의 chunk로 합치고, 동적 import와 공통 dependency를 기준으로 chunk 간 edge를 만든다.

```text
모듈 그래프
main -> router -> AdminPage -> chart
main -> Home

청크 그래프
index.js -> admin.js
index.js -> vendor-chart.js
admin.js -> vendor-chart.js
```

공통 청크 추출은 중복 다운로드를 줄이지만, 새 의존성을 만들 수 있다. `admin.js` 하나면 끝날 이동이 `admin.js`와 `vendor-chart.js` 두 요청이 될 수 있다. HTTP/2/3에서는 병렬 요청이 가능하지만, import graph가 순차로 발견되면 폭포가 된다. 그래서 라우터의 preload, `<link rel="modulepreload">`, hover/focus 기반 prefetch가 실무 도구가 된다.

### Side effect 판정은 보수적일수록 크고 공격적일수록 위험하다

Rollup의 트리 셰이킹 옵션은 side effect에 대해 얼마나 공격적으로 가정할지를 조절한다. `moduleSideEffects: false`는 "사용한 export가 없으면 모듈 평가도 생략해도 된다"는 강한 가정이다. 폴리필, CSS import, 전역 등록, custom element 등록 같은 코드는 이 가정과 맞지 않는다.

```js
// side-effect-only module
import "./register-custom-elements.js";
```

이런 파일을 패키지의 `"sideEffects": false` 아래에 두면 제거될 수 있다. 따라서 라이브러리 작성자는 side effect가 있는 파일을 명시적으로 예외 처리해야 한다. 앱 작성자는 큰 번들보다 더 나쁜 것이 **작지만 의미가 깨진 번들**이라는 점을 기억해야 한다.

### 개발 서버 성능과 프로덕션 성능은 다른 지표다

Vite가 빠른 dev server를 제공한다고 해서 프로덕션 번들이 자동으로 작다는 뜻은 아니다. 개발 서버는 "요청받은 파일을 빨리 변환"하는 문제이고, 프로덕션은 "전체 그래프를 최적화"하는 문제다. 반대로 프로덕션 번들 최적화를 극단적으로 밀어붙이면 build 시간이 길어지고 HMR 경험과 무관한 복잡도가 늘 수 있다.

도구 선택은 따라서 다음 질문으로 한다.

- 개발자가 매 저장마다 기다리는 시간은 어디서 생기는가.
- 배포 산출물의 병목은 전송, 파싱, 실행, 캐시 중 무엇인가.
- 설정 복잡도가 팀의 변경 속도를 얼마나 늦추는가.

## 정리

- 번들러는 entry에서 import를 따라 모듈 그래프를 만들고, 그 그래프를 배포 가능한 chunk 그래프로 다시 계산한다.
- 브라우저 ESM 이후에도 번들러는 bare specifier, CJS 호환, 문법 변환, 트리 셰이킹, 코드 분할, content hash 때문에 필요하다.
- 트리 셰이킹은 ESM 정적 구조와 side effect 판정이 함께 있어야 안전하다. CJS, 배럴 파일, 잘못된 side effect 선언은 대표적인 실패 지점이다.
- Vite의 핵심 전략은 개발에서는 native ESM + dependency pre-bundling + HMR로 대기 시간을 줄이고, 프로덕션에서는 최적화된 번들로 요청·캐시·dead code 문제를 해결하는 것이다.
- 번들 문제는 설치 그래프, import 경로, side effect 판정, chunk 경계 중 어느 계층인지 먼저 분류하고, visualizer와 Network/Performance 패널로 검증한다.

## 확인 문제

**Q1.** `import { Button } from "@acme/ui"`만 했는데 번들 분석에서 `DatePicker`, `Chart`, `Modal`까지 같은 chunk에 들어왔다. 가능한 원인을 세 가지 이상 제시하고, 어떤 순서로 확인할지 설명하라.

<details>
<summary>정답과 해설</summary>

가능한 원인은 ① `@acme/ui` entry가 모든 컴포넌트를 import하는 배럴이고 side effect 판정이 보수적으로 되어 있는 경우, ② 컴포넌트 파일들이 CSS import나 전역 등록 같은 side effect를 갖는 경우, ③ 패키지가 CJS로 배포되어 named export 단위 제거가 어렵거나, ④ `Button`이 실제로 공통 theme/registry를 통해 다른 컴포넌트를 참조하는 경우다. 확인 순서는 먼저 visualizer에서 경로를 보고, `@acme/ui/Button` 같은 공식 subpath import가 있는지 비교 빌드한다. package.json의 `module`/`exports`/`sideEffects`를 확인하고, 패키지 포맷이 CJS인지 ESM인지 본다. 그래도 남으면 실제 소스에서 side-effect-only import와 전역 registry를 확인한다.
</details>

**Q2.** 라우트 단위 `lazy(() => import("./AdminPage"))`를 적용했더니 초기 JS 크기는 줄었지만, `/admin` 진입 시 `admin.js`를 받은 뒤 `chart.js`를 다시 요청하는 폭포가 생겼다. 이 현상을 chunk 그래프로 설명하고 완화책을 제시하라.

<details>
<summary>정답과 해설</summary>

동적 import가 `admin.js` chunk를 만들었고, `AdminPage` 내부에서 무거운 chart 모듈이 별도 공통 또는 async chunk로 분리되었다. 브라우저가 `chart.js` 필요성을 `admin.js`를 파싱한 뒤 알게 되면 요청이 순차화되어 청크 워터폴이 생긴다. 완화책은 라우터나 링크 hover/focus 시점에 admin route와 관련 dependency를 preload/prefetch하는 것, 번들러의 chunk 전략을 조정해 admin과 chart를 같은 async chunk로 묶는 것, 또는 chart가 첫 렌더에 필요 없다면 화면 내부에서 더 늦게 로드하도록 UX를 바꾸는 것이다. 검증은 Network 패널에서 클릭 전후 요청 시작 시점과 waterfall을 비교한다.
</details>

**Q3.** 팀원이 `"sideEffects": false`를 package.json에 추가하자 번들 크기는 줄었지만 custom element가 등록되지 않는다. 무슨 일이 일어났는가?

<details>
<summary>정답과 해설</summary>

`"sideEffects": false`는 사용한 export가 없는 모듈 평가를 생략해도 된다는 강한 힌트다. custom element 등록 파일은 export가 없어도 `customElements.define(...)`이라는 side effect 때문에 반드시 평가되어야 한다. 번들러가 이 파일을 제거해 등록이 사라진 것이다. 해결은 전체 패키지를 side-effect-free로 선언하지 않거나, side effect가 있는 파일을 예외 목록에 둔다. 크기 감소가 의미 보존보다 우선될 수 없다.
</details>

## 참고 자료

- [Vite — Why Vite](https://vite.dev/guide/why.html) — native ESM 기반 개발 서버, dependency pre-bundling, Rolldown/Oxc 수렴 방향을 설명한다.
- [Vite — Dependency Pre-Bundling](https://vite.dev/guide/dep-pre-bundling.html) — CJS/UMD 변환과 다수 내부 모듈을 묶는 개발 모드 pre-bundling의 이유를 확인할 수 있다.
- [Vite — Features](https://vite.dev/guide/features.html) — HMR, TypeScript transpile-only, bare import rewriting 등 개발 서버 기능의 공식 설명이다.
- [Rollup — Treeshake Options](https://rollupjs.org/configuration-options/#treeshake) — `moduleSideEffects`, pure annotation, property read side effect 등 트리 셰이킹 안전성 옵션을 확인할 수 있다.
- [ECMAScript Modules](../phase-3/09-modules.md) — 이 저장소의 ESM 정적 그래프와 라이브 바인딩 설명. 번들러 모델의 전제다.
