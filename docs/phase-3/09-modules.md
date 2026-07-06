# 3-9. 모듈 — 정적 그래프와 라이브 바인딩

> 한 줄 요약: ESM이 동적 편의(조건부 require)를 버리고 정적 구문을 택한 트레이드오프가 무엇을 가능하게 했는지(파스 타임 그래프, 라이브 바인딩, 트리 셰이킹의 전제) 설명할 수 있고, CJS/ESM의 순환 의존이 서로 다르게 실패하는 이유를 진단할 수 있다.

## 학습 목표

- CommonJS(런타임 객체 전달)와 ESM(파스 타임 구문)의 모델 차이를 설명하고, 동기 로딩이 서버에서만 성립하는 이유를 말할 수 있다.
- ESM의 라이브 바인딩(값 복사가 아니라 바인딩 연결)을 실험으로 검증할 수 있다.
- 같은 순환 의존이 CJS에서는 undefined로, ESM에서는 ReferenceError로 나타나는 메커니즘을 3단계 처리 모델로 설명할 수 있다.
- `<script type="module">`의 암묵 defer·CORS 적용과 bare specifier가 브라우저에서 실패하는 이유(번들러가 해 주던 일)를 설명할 수 있다.
- 트리 셰이킹이 성립하는 전제(정적 구문 + 사이드 이펙트 판정)를 말할 수 있다.

## 배경: 왜 이것이 존재하는가

JS는 20년 가까이 모듈 없는 언어였다. 모든 `<script>`가 전역 스코프를 공유했고, "모듈"은 컨벤션이었다 — [3-2](./02-closures-and-functions.md)에서 본 IIFE 패턴이 스코프를, `window.MyLib = ...`가 export를, 스크립트 태그의 **작성 순서**가 의존 관계를 담당했다. 순서가 틀리면 undefined, 이름이 겹치면 덮어쓰기. 이 상태에서 두 갈래의 해법이 자랐다: 서버(Node)의 CommonJS는 동기 require로, 브라우저 진영은 비동기 로딩(AMD)과 빌드 타임 결합(번들러)으로. ES2015의 ESM은 이 분열을 언어 차원에서 통일하려는 답이다.

경력자의 기존 모델과 비교하면 위치가 선명해진다. Java의 import는 컴파일 타임 심볼 해석이다 — 실행 전에 참조가 전부 검증되고, 로딩 순서는 개발자 관심사가 아니다. Python의 import는 런타임 문장이다 — 실행 도중에 파일을 찾아 실행하며, 조건부 import가 자연스럽다. **CommonJS는 Python 쪽(런타임 함수 호출)이고, ESM은 그 중간이다: 그래프 구성은 정적(파스 타임), 평가는 런타임.** 이 위치 선정이 이 문서의 주제다 — 정적 분석 가능성을 얻기 위해 동적 편의를 포기한 트레이드오프. 같은 트레이드오프가 Phase 4(런타임 유연성 vs 정적 타입)와 Phase 6(트리 셰이킹, 번들 분석)에서 반복되므로, 여기가 그 주제의 첫 등장이다.

이 문서는 [3-1](./01-execution-model.md)의 환경 레코드·TDZ와 [3-6](./06-promises-and-async.md)의 Promise(top-level await)를 전제한다. 번들러가 이 그래프로 실제로 무엇을 하는지는 Phase 6-2로, AMD/UMD 등 역사적 포맷은 "CJS와 ESM을 오가는 호환 래퍼였다" 한 문장으로 위임한다.

## 핵심 개념

### CommonJS — 런타임의 객체 전달

CJS의 모델은 언어 기능이 아니라 **함수와 객체의 관례**다. `require`는 파일을 실행하고 그 파일이 `module.exports`에 담아 둔 **객체 참조**를 돌려주는 동기 함수이고, 한 번 실행된 모듈은 캐싱되어 두 번째 require부터는 같은 객체를 즉시 받는다.

```js
// counter.cjs
let count = 0;
module.exports = {
  count, // 이 시점 값(0)이 프로퍼티로 복사된다
  increment() { count += 1; },
  getCount() { return count; },
};

// main.cjs
const counter = require("./counter.cjs"); // 동기 — 이 줄에서 파일 실행이 끝난다
counter.increment();
console.log(counter.count);      // 출력: 0 — export 시점에 복사된 값
console.log(counter.getCount()); // 출력: 1 — 클로저는 현재 값을 본다 (3-2)
```

`counter.count`가 0인 것이 CJS 모델의 핵심 단면이다: export되는 것은 **값이 담긴 일반 객체**이고, 원시 값 프로퍼티는 담는 순간의 복사다. 이후 모듈 내부 변수와는 남남이다.

이 모델의 강점은 전부 "런타임 함수 호출"이라는 데서 나온다 — 조건부 require, 계산된 경로(`require(basePath + name)`), try/catch로 감싼 선택적 의존성이 전부 그냥 된다. 약점도 같은 곳에서 나온다: 무엇을 import하는지 **실행해 보기 전엔 모른다**(정적 분석 불가), 그리고 require가 **동기**다. 동기 로딩은 서버에서 성립한다 — 모듈은 로컬 디스크에 있고, 로딩은 프로세스 시작 시 한 번이다. 브라우저에서는 성립하지 않는다 — 모듈이 네트워크 건너에 있으므로 동기 로딩은 요청 왕복마다 메인 스레드를 세우는 것이다([3-5](./05-event-loop.md)의 run-to-completion 위에서 이는 화면 정지다). CJS를 브라우저에 가져오려면 누군가 미리 파일들을 하나로 합쳐야 했고, 그것이 번들러가 필수 도구가 된 역사적 이유다.

### ESM — 구문이라서 가능한 것들

ESM의 import/export는 함수가 아니라 **구문(syntax)** 이다. 문의 최상위에만 올 수 있고, specifier는 문자열 리터럴이어야 하며, 조건문 안에 넣을 수 없다. 이 제약이 사는 곳이 핵심이다: **코드를 실행하지 않고 파싱만으로** 각 모듈이 무엇을 내보내고 무엇을 가져오는지 확정할 수 있다 — 모듈 그래프가 파스 타임에 선다.

스펙의 처리 모델은 3단계다.

1. **구성(Construction)** — 진입 모듈을 파싱해 import 선언을 수집하고, 참조된 모듈을 가져와 재귀한다. 그래프 전체가 확정된다. (브라우저에서는 이 단계가 네트워크 요청 — 그래서 비동기다.)
2. **인스턴스화(Instantiation)** — 각 모듈에 module Environment Record([3-1](./01-execution-model.md)의 5종 중 하나)를 만들고, 모든 export 바인딩을 등록하며, import를 상대 모듈의 export 바인딩에 **연결**한다. 아직 아무 코드도 실행되지 않았다 — let/const export는 미초기화(TDZ) 상태로 등록된다.
3. **평가(Evaluation)** — 그래프의 의존성 후위 순서(깊은 것부터)로 모듈 본문을 실행한다. 각 모듈은 한 번만 평가된다.

인스턴스화 단계의 "연결"이 ESM의 두 번째 정체성인 **라이브 바인딩**을 만든다. import되는 것은 값의 복사가 아니라 **원본 모듈 바인딩에 대한 읽기 전용 뷰**다. 관찰 실험:

```js
// counter.mjs
export let count = 0;
export function increment() { count += 1; }

// main.mjs
import { count, increment } from "./counter.mjs";
console.log(count); // 출력: 0
increment();
console.log(count); // 출력: 1 — CJS라면 0이었다! 바인딩이 연결되어 있다
count = 5;          // TypeError: Assignment to constant variable —
                    // import 바인딩은 읽기 전용. 쓰기 권한은 원본 모듈에만 있다
```

CJS 실험과 정확히 대칭이다: CJS의 `counter.count`는 export 순간의 값 복사라 0에 머물렀고, ESM의 `count`는 모듈 환경 레코드의 바인딩을 그대로 보므로 1이 된다. 구현 관점에서 module ER의 import 바인딩은 "다른 환경 레코드의 바인딩을 가리키는 간접 참조(indirect binding)"로 정의되어 있다 — [3-1](./01-execution-model.md)에서 module ER을 별도 종류로 뒀던 이유가 이것이다.

라이브 바인딩은 마니악한 세부가 아니라 순환 의존이 동작하는 근거이자, 상태를 export하는 모듈("현재 로그인 사용자" 같은)이 재수출 없이 갱신을 전파하는 메커니즘이다.

### 순환 의존 — 두 모델이 다르게 실패한다

순환 의존은 피하는 것이 정답이지만, 큰 코드베이스에서 우발적으로 생기며 **두 시스템의 증상이 달라** 진단 지식이 필요하다.

**CJS의 순환**: require는 실행 도중의 함수 호출이므로, A 실행 중에 B를 require하고 B가 다시 A를 require하면 — 무한 루프 대신 캐시가 개입한다: B는 **그 시점까지 채워진 A의 module.exports**(부분 완성 객체)를 받는다.

```js
// a.cjs
exports.early = "A의 앞부분";
const b = require("./b.cjs");     // 여기서 B로 제어가 넘어간다
exports.late = "A의 뒷부분";       // B가 끝난 뒤에야 실행된다

// b.cjs
const a = require("./a.cjs");     // A는 실행 중 — 부분 완성 exports를 받는다
console.log(a.early); // 출력: A의 앞부분
console.log(a.late);  // 출력: undefined — 조용히! 아직 안 채워졌다
```

증상이 **조용한 undefined**라는 것이 CJS 순환의 악명이다 — 에러 없이 이상한 값이 흘러 다니다 멀리서 터진다.

**ESM의 순환**: 그래프가 실행 전에 확정되고 바인딩이 미리 등록되므로 구조가 다르다. B가 평가될 때 A의 export 바인딩은 **존재한다** — 단, A가 아직 평가되지 않았다면 미초기화(TDZ) 상태다.

```js
// a.mjs
import { fromB } from "./b.mjs";
export const fromA = "A의 값";

// b.mjs
import { fromA } from "./a.mjs";
console.log(fromA); // ReferenceError: Cannot access 'fromA' before initialization
export const fromB = "B의 값";
```

같은 순환이 ESM에서는 **즉시, 정확한 지점에서 ReferenceError**다 — [3-1](./01-execution-model.md)의 TDZ가 모듈 규모에서 재등장한 것이다. 조기 실패가 침묵보다 낫다는 점에서 개선이고, 함수 선언 export(등록 시점에 값까지 있음)를 통하면 순환 참여자끼리도 서로를 호출할 수 있다 — 평가 시점이 아니라 호출 시점에 바인딩이 읽히기 때문이다(라이브 바인딩의 효용).

**top-level await**(ES2022)는 평가 단계의 규칙을 확장한다: 모듈 최상위의 await는 그 모듈의 평가를 비동기로 만들고, **그 모듈을 import하는 모든 모듈의 평가가 함께 대기**한다 — 그래프 단위의 대기다. 설정 파일 로딩 같은 초기화에 유용하지만, 깊은 곳의 top-level await 하나가 앱 전체의 기동을 잡는다는 비용을 의식해야 한다.

### 브라우저의 ESM — 번들러가 해 주던 일의 정체

`<script type="module">`은 일반 스크립트와 처리 규약이 다르다.

- **암묵 defer** — 모듈 스크립트는 HTML 파싱을 막지 않고, 파싱 완료 후 문서 순서대로 실행된다([1-1](../phase-1/01-html-basics.md)의 스크립트 로딩 모델). 그래프 구성이 네트워크 작업이므로 동기 실행 자체가 불가능하다는 구조적 귀결이다.
- **자동 strict mode** — 모듈 본문은 선언 없이 strict다([3-1](./01-execution-model.md)의 "실무 코드는 사실상 전부 strict"의 근거).
- **CORS 적용** — 일반 `<script src>`는 교차 출처를 자유로 가져오지만(레거시 관용), 모듈은 CORS 검사를 받는다([3-8](./08-network-apis.md)). CDN에서 모듈을 로드하려면 서버의 CORS 헤더가 필요하다.
- **모듈 스코프** — 최상위 선언이 전역을 오염시키지 않는다. IIFE 패턴([3-2](./02-closures-and-functions.md))이 하던 일이 언어 기본값이 됐다.

그런데 npm 생태계의 코드를 그대로 브라우저에 넣으면 즉시 실패하는 지점이 있다:

```js
import { format } from "date-fns";
// 브라우저: TypeError — "date-fns"는 상대 경로도 URL도 아니다
```

`"date-fns"` 같은 **bare specifier**(경로 없는 패키지 이름)를 해석하는 규칙이 브라우저에는 없다 — 그것은 Node의 규칙(node_modules 탐색)이었고, 번들러가 빌드 타임에 그 해석을 대신 수행해 실제 경로로 치환해 주고 있었다. "번들러 없이는 import가 안 되던" 경험의 정체가 이 **specifier 해석의 부재**다. 표준 답은 **import maps**다 — 해석 규칙을 페이지가 선언한다:

```html
<script type="importmap">
  { "imports": { "date-fns": "https://esm.sh/date-fns@4" } }
</script>
<script type="module">
  import { format } from "date-fns"; // 이제 매핑을 따라 해석된다
</script>
```

이로써 브라우저 ESM은 자립 가능해졌지만, 번들러가 사라지는 것은 아니다 — 모듈 수백 개의 개별 요청 비용(HTTP/2로 완화되지만 여전히 그래프 깊이만큼의 왕복 — [2-4](../phase-2/04-http-versions.md)), 압축, 트리 셰이킹은 빌드 타임 작업으로 남는다(Phase 6-2).

### Node의 이중 생태계 — 소비자 관점의 최소 지식

Node는 CJS로 15년을 산 뒤 ESM을 들였으므로 두 시스템이 공존한다. 라이브러리 **소비자**로서 겪는 증상 중심으로 요약한다.

- 파일의 모듈 종류는 확장자(`.mjs`/`.cjs`)나 가장 가까운 package.json의 `"type": "module"` 필드가 정한다. "ESM 파일에서 require가 안 된다", "CJS 파일에서 import 구문이 SyntaxError다"의 원인은 대부분 이 판정이다.
- 방향성이 비대칭이다: ESM은 CJS를 import할 수 있지만(default export로 뭉쳐서), CJS가 ESM을 require하는 것은 오랫동안 불가였다(ESM 평가가 비동기일 수 있으므로 — 최근 Node가 top-level await 없는 그래프에 한해 `require(esm)`을 허용하기 시작했다).
- 패키지는 package.json의 **조건부 exports**(`"exports": { "import": "./esm/index.js", "require": "./cjs/index.js" }`)로 두 포맷을 함께 배포할 수 있다. 이때 두 사본이 **각자 평가**되어 모듈 내부 상태(싱글턴, 캐시)가 두 벌 생기는 것이 **dual package hazard**다 — "같은 라이브러리인데 instanceof가 false", "설정을 넣었는데 다른 쪽이 못 본다"는 증상으로 나타난다.

패키지 배포 설정법 자체는 이 커리큘럼의 범위 밖이다 — 증상을 알아보는 것까지가 목표다.

### 트리 셰이킹 — 성립 전제까지만

정적 그래프의 대표적 배당이 트리 셰이킹(사용되지 않는 export 제거)이다. 성립 전제를 정확히 두 개로 정리한다.

1. **정적 구문** — "무엇이 import되는가"가 실행 없이 확정되어야 한다. ESM은 파스 타임에 이것을 주지만, CJS의 `require(someVar)`나 `module.exports[key] = ...`는 실행해야 아는 정보라 정적 제거가 원리적으로 불가능하다. 라이브러리들이 ESM 배포에 목을 매는 실질적 이유.
2. **사이드 이펙트 판정** — import했지만 참조하지 않는 모듈을 지워도 되는가는 별개 문제다. 모듈 평가가 부수 효과(전역 등록, 폴리필, CSS 주입)를 가질 수 있기 때문이다. 구문만으로는 판정 불가라서 선언(package.json의 `"sideEffects": false`)과 정적 분석의 조합으로 근사한다.

동적 `import()`(함수형 — 이것은 구문이 아니라 표현식이고 Promise를 반환한다)는 정적 그래프의 의도된 탈출구다: 코드 분할 지점(라우트 단위 lazy 로딩)을 표시하며, specifier가 리터럴이면 번들러가 분할 청크로 처리할 수 있다. 실제 구현 — 번들러가 그래프를 어떻게 합치고 나누는가 — 은 Phase 6-2에서 다룬다.

## 실무 관점

**순환 의존은 증상이 아니라 설계 신호로 읽는다.** "ReferenceError가 나니 import 순서를 바꿔서 해결"은 다음 리팩터링 때 재발한다. 순환의 실제 의미는 두 모듈이 하나의 책임을 나눠 갖고 있다는 것 — 공통 부분을 셋째 모듈로 내리거나(A→C←B), 한쪽이 다른 쪽을 값으로 받게(의존성 주입) 바꾸는 것이 수리다. 탐지는 눈보다 도구가 정확하다: `madge --circular src/` 또는 ESLint `import/no-cycle`을 CI에 두면 우발적 순환이 병합 전에 잡힌다.

**export 스타일의 실무 트레이드오프.** named export(`export const f`)는 이름이 그래프 분석의 단위이므로 트리 셰이킹·자동 import·일괄 리네임에 유리하고, default export는 소비자마다 다른 이름을 붙일 수 있어(`import Foo from` / `import Bar from` — 같은 것) 코드베이스 검색성이 떨어진다. "named를 기본으로, default는 모듈 = 개념 하나가 명확할 때(React 컴포넌트 파일 관례)만"이 통용되는 절충이다. 한 가지 함정: `export * from`으로 만든 배럴(barrel) 파일은 편리하지만 그래프를 넓혀서, 사이드 이펙트 판정이 불가능한 의존성이 하나라도 섞이면 배럴 경유 import 전체가 트리 셰이킹에서 빠질 수 있다 — 번들 분석(Phase 6-2)에서 배럴이 단골 용의자인 이유다.

**모듈 스코프는 암묵적 싱글턴이다.** 모듈은 그래프에서 한 번만 평가되므로 최상위의 `const cache = new Map()`은 앱 전역에서 하나다 — 의도적으로 쓰면 가장 싼 싱글턴 패턴이고([3-2](./02-closures-and-functions.md) 모듈 패턴의 계승), 무의식적으로 쓰면 테스트 간 상태 오염(모듈 캐시 리셋이 필요해지는)과 dual package hazard의 재료가 된다. "이 최상위 상태는 정말 프로세스 전역이어야 하는가"를 export 설계 시점에 묻는다.

## 더 깊이

**"CJS는 값 복사, ESM은 라이브 바인딩"의 정확한 경계.** CJS에서도 `module.exports` **객체 자체**는 참조 공유이므로, `exports.count`를 모듈 내부에서 계속 `exports.count += 1`로 갱신하면 소비자도 변화를 본다 — 복사되는 것은 "지역 변수 → 프로퍼티" 담는 순간뿐이다. 혼란의 실제 원인은 모델이 아니라 관례다(지역 변수를 담아 export하는 코드가 많았다). 반대로 ESM의 라이브 바인딩도 객체 내용의 변경 가능성과는 무관하다 — `export const config = {}`의 config 프로퍼티를 소비자가 바꾸는 것은 막지 않는다(바인딩이 읽기 전용이지 값이 동결되는 게 아니다).

**모듈 그래프의 스펙상 실체.** 각 모듈은 Module Record(Cyclic Module Record → Source Text Module Record)로 표현되고, 3단계는 각각 ParseModule / module.Link() / module.Evaluate()에 대응한다. Link가 실패하면(존재하지 않는 export를 import) **아무 코드도 실행되기 전에** 에러가 난다 — CJS라면 런타임 어딘가에서 undefined였을 오류가 기동 시점의 명시적 실패가 되는 것, 이것이 "정적 구조"의 가장 실감나는 배당이다. Evaluate의 순환 처리(방문 중 노드 표시, 강결합 컴포넌트 단위 완료)는 스펙 §16.2.1.5에 그래프 알고리즘으로 정의되어 있다.

**import.meta와 모듈 단위 컨텍스트.** 모듈에는 CJS의 `__dirname`/`__filename`이 없다(전역이 아니라 모듈 스코프의 주입 변수였고, ESM은 그 관행을 잇지 않았다). 대신 `import.meta.url`(모듈 자신의 URL)이 표준이고, `new URL("./asset.png", import.meta.url)`로 모듈 상대 자원 경로를 만드는 것이 관용구다 — 번들러들도 이 패턴을 정적 분석해 자산을 추적한다.

## 정리

- CJS는 런타임 함수(require)가 exports 객체를 전달하는 모델 — 동적 편의(조건부·계산된 경로)를 주지만 정적 분석이 불가능하고, 동기 로딩이라 브라우저에서 성립하지 않는다(번들러 필수 시대의 원인).
- ESM은 구문이라서 실행 전에 그래프가 확정된다(구성→인스턴스화→평가). import는 값 복사가 아니라 원본 바인딩에 대한 읽기 전용 라이브 바인딩이다.
- 같은 순환 의존이 CJS에서는 부분 완성 exports의 **조용한 undefined**, ESM에서는 미초기화 바인딩의 **즉각적 ReferenceError**(모듈 규모의 TDZ)가 된다. 근본 수리는 순서 조정이 아니라 책임 분리다.
- 브라우저 모듈은 암묵 defer·strict·CORS 적용이며, bare specifier 해석은 원래 번들러가 대신하던 Node 규칙이다 — 표준 대체가 import maps. top-level await는 그래프 단위로 평가를 대기시킨다.
- 트리 셰이킹의 전제는 정적 구문 + 사이드 이펙트 판정이다 — ESM이 전자를, `"sideEffects"` 선언이 후자를 제공하며, 구현은 6-2에서 다룬다.

## 확인 문제

**Q1.** 같은 로직을 CJS와 ESM으로 작성했다. 각각의 출력과 그 이유를 두 모델(객체 전달 vs 바인딩 연결)로 설명하라.

```js
// [CJS] flag.cjs                      // [ESM] flag.mjs
let enabled = false;                   // export let enabled = false;
module.exports = {                     // export function turnOn() {
  enabled,                             //   enabled = true;
  turnOn() { enabled = true; },        // }
};

// [CJS] main.cjs                      // [ESM] main.mjs
const f = require("./flag.cjs");       // import { enabled, turnOn } from "./flag.mjs";
f.turnOn();                            // turnOn();
console.log(f.enabled);                // console.log(enabled);
```

<details>
<summary>정답과 해설</summary>

CJS: **false**. `module.exports = { enabled, ... }`에서 enabled는 그 순간의 값(false)이 프로퍼티로 복사된다. turnOn이 바꾸는 것은 모듈 내부의 지역 변수이고, exports 객체의 프로퍼티와는 이미 남남이다.

ESM: **true**. import된 enabled는 flag.mjs의 module Environment Record에 있는 바인딩에 대한 간접 참조다. turnOn이 원본 바인딩을 바꾸면 소비자의 읽기가 그 현재 값을 본다 — 라이브 바인딩.

CJS에서 같은 효과를 내려면 getter를 export하거나(`getEnabled()`), exports 객체의 프로퍼티를 직접 갱신해야(`exports.enabled = true`) 한다. 이 차이가 "상태를 export하는 모듈"의 설계를 두 시스템에서 다르게 만든다.
</details>

**Q2.** ESM 프로젝트에서 다음 에러가 기동 시점에 났다: `ReferenceError: Cannot access 'API_BASE' before initialization` (config.js를 가리킨다). config.js는 api.js를 import하고, api.js도 config.js를 import한다. ① 왜 SyntaxError나 undefined가 아니라 이 에러인지 3단계 처리 모델로 설명하고, ② 순서를 바꾸지 않는 구조적 수리를 제안하라.

<details>
<summary>정답과 해설</summary>

① 인스턴스화 단계에서 두 모듈의 export 바인딩은 모두 **등록**되고 서로 연결되므로 "존재하지 않는 이름" 오류(Link 실패)는 아니다. 평가 단계에서 순환의 한쪽(api.js)이 먼저 실행되는데, 그 시점에 config.js는 아직 평가 전이라 `API_BASE`(const) 바인딩이 미초기화 상태다 — 미초기화 바인딩 접근은 [3-1](./01-execution-model.md)의 TDZ 규칙 그대로 ReferenceError다. CJS였다면 부분 완성 exports의 undefined로 조용히 지나갔을 상황이 ESM에서는 정확한 지점의 조기 실패가 된다.

② 순환 자체를 제거한다: config가 api를 필요로 하는 부분(예: 설정 검증에 API 호출)과 api가 config를 필요로 하는 부분(base URL)은 책임이 얽힌 것이므로 — 상수·순수 데이터를 셋째 모듈(constants.js)로 내려 양쪽이 그것만 의존하게 하거나, api를 팩토리(`createApi(config)`)로 바꿔 config 쪽에서 값을 주입한다. `madge --circular`나 `import/no-cycle` 린트를 CI에 추가해 재발을 막는다.
</details>

**Q3.** 번들 크기를 줄이려고 lodash 전체 import를 개별 import로 바꿨는데(`import { debounce } from "lodash"` → 그대로), 번들 분석 결과 lodash 전체가 여전히 포함되어 있다. 반면 `lodash-es`로 바꾸니 debounce 관련 코드만 남았다. 두 결과의 차이를 트리 셰이킹의 성립 전제로 설명하라.

<details>
<summary>정답과 해설</summary>

named import 구문을 썼다는 것만으로는 부족하다 — 트리 셰이킹은 **대상 모듈이 정적으로 분석 가능해야** 성립한다. `lodash` 패키지는 CJS로 배포된다: 내부가 `module.exports` 객체 조립이므로, "debounce만 쓴다"는 정보로 나머지를 제거하는 것이 정적으로 불가능하다(exports 객체의 어느 프로퍼티가 어떤 코드에 대응하는지, 조립 과정에 부수 효과가 없는지 실행 없이 판정할 수 없다). 번들러는 CJS import를 만나면 모듈 전체를 포함하는 쪽으로 보수적으로 판단한다.

`lodash-es`는 같은 코드의 ESM 배포다: 함수마다 개별 모듈 + named export + package.json의 사이드 이펙트 없음 선언. 두 전제(정적 구문, 사이드 이펙트 판정)가 모두 충족되어 미사용 export 제거가 성립한다. 교훈: 트리 셰이킹은 소비자의 import 스타일이 아니라 **공급자의 배포 포맷**이 1차 결정 요인이다 — 의존성을 고를 때 ESM 배포 여부를 보는 실질적 이유. (구현 수준의 상세는 Phase 6-2에서 다룬다.)
</details>

## 참고 자료

- [ECMA-262 — Modules (§16.2)](https://tc39.es/ecma262/#sec-modules) — Module Record, Link/Evaluate, 순환 처리 알고리즘의 원문.
- [WHATWG HTML — Module scripts](https://html.spec.whatwg.org/multipage/webappapis.html#module-script) — `<script type="module">`의 로딩·CORS·specifier 해석 규칙.
- [WHATWG HTML — Import maps](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps) — bare specifier 해석의 표준 정의.
- [Node.js — ECMAScript modules](https://nodejs.org/api/esm.html) — .mjs/.cjs 판정, CJS 상호운용, 조건부 exports의 공식 문서.
- [Node.js — Dual package hazard](https://nodejs.org/api/packages.html#dual-package-hazard) — 이중 배포가 만드는 상태 이중화의 공식 설명.
