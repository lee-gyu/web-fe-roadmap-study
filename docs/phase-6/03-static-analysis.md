# 6-3. 정적 분석

> 한 줄 요약: 이 문서를 읽고 나면 ESLint·Prettier·타입 검사기가 각각 어떤 구문/타입 정보를 읽고 무엇을 구조적으로 못 보는지 구분해, 프로젝트의 정적 검증 계층을 설계할 수 있다.

이 문서는 ESLint 9 계열의 flat config, typescript-eslint 8 계열의 typed linting, Prettier stable 문서를 기준으로 한다. TypeScript 자체의 검사 모델은 [4-5 컴파일러와 설정](../phase-4/05-compiler-and-config.md)을 전제한다.

## 학습 목표

- ESLint 규칙이 소스 텍스트를 AST로 파싱한 뒤 visitor로 노드를 검사하는 방식을 설명할 수 있다.
- 린터(linter), 포매터(formatter), 타입 검사기(type checker)가 각각 맡아야 하는 문제와 경계를 판단할 수 있다.
- 타입 인지(type-aware) 린트가 왜 느려지는지 TypeScript의 전체 프로그램 분석 비용으로 설명할 수 있다.
- ESLint flat config의 배열 기반 설정 모델이 어떤 파일에 어떤 규칙을 적용하는지 추적할 수 있다.
- 정적 분석에서 잡을 문제, 타입에서 잡을 문제, 테스트로 넘길 문제를 분업할 수 있다.

## 배경: 왜 이것이 존재하는가

정적 분석은 "실행하지 않고 코드를 읽는" 도구다. 서버 개발자의 경험으로 치면 Checkstyle, SpotBugs, Error Prone, SonarQube, Kotlin compiler warning이 섞여 있는 영역이다. 프론트엔드에서는 이 영역이 더 잘게 나뉜다. ESLint는 JavaScript/TypeScript 문법과 일부 의미 패턴을 보고, Prettier는 코드를 다시 출력해 formatting 논쟁을 없애며, TypeScript는 전체 프로그램의 타입 관계를 분석한다.

이 분리는 역사적 우연이 아니라 입력 데이터의 차이에서 온다.

- 포매터는 소스 텍스트와 AST만 있으면 된다. 목표는 의미를 바꾸지 않고 일관된 출력으로 재인쇄하는 것이다.
- 일반 린트 규칙은 보통 파일 하나의 AST와 scope 정보만 있으면 된다. 목표는 버그 가능성이 높은 패턴을 찾는 것이다.
- 타입 검사는 import 그래프 전체와 선언 파일을 읽어야 한다. 목표는 값이 실행되기 전 타입 관계가 성립하는지 판정하는 것이다.

경력 개발자가 흔히 빠지는 함정은 이 셋을 하나의 "품질 도구"로 뭉뚱그리는 것이다. 그러면 formatting 규칙이 ESLint와 Prettier에서 충돌하고, 타입 정보가 필요한 규칙을 전 파일에 켜 CI가 갑자기 느려지고, 테스트가 잡아야 할 사용자 흐름을 lint로 잡으려 한다. 이 장의 목표는 정적 검증 도구를 **어떤 입력에서 어떤 산출물을 계산하는 함수**로 나눠 보는 것이다.

## 핵심 개념

### ESLint 규칙은 AST visitor다

ESLint의 기본 파이프라인은 컴파일러 프론트엔드와 같다.

```text
소스 텍스트
  → parser(Espree 또는 @typescript-eslint/parser)
  → AST(Abstract Syntax Tree)
  → scope/code path 분석
  → rule visitor 실행
  → report/fix 산출
```

다음 코드를 분석한다고 하자.

```js
const value = 1;
console.log(value);
```

AST에는 `VariableDeclaration`, `Identifier`, `Literal`, `CallExpression`, `MemberExpression` 같은 노드가 생긴다. 규칙은 "모든 Identifier를 볼 때" 또는 "CallExpression을 빠져나올 때" 같은 visitor를 등록한다. ESLint 공식 커스텀 규칙의 기본 구조도 이 모델 그대로다.

```js
// no-debug-log.js
export default {
  meta: {
    type: "problem",
    docs: {
      description: "debug logger를 배포 코드에 남기지 않는다",
    },
    schema: [],
    messages: {
      noDebug: "debug.log 호출은 배포 코드에 남기지 않는다.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;

        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "debug" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "log"
        ) {
          context.report({ node, messageId: "noDebug" });
        }
      },
    };
  },
};
```

이 규칙은 런타임에서 `debug.log`가 실제로 어떤 함수인지는 모른다. 오직 AST 모양을 본다. 그래서 빠르고, 그래서 한계가 있다. 다음 코드는 같은 의미일 수 있지만 규칙은 놓친다.

```js
const logger = debug;
logger.log("still debug");
```

이 한계를 결함으로만 보면 안 된다. 파일 단위 AST 규칙의 장점은 속도와 명확성이다. "프로젝트 전역에서 이 값이 실제로 무엇인가"를 보려면 타입 검사 또는 데이터 흐름 분석이 필요하고 비용이 급격히 오른다.

AST는 직접 관찰할 수 있다. ESLint Code Explorer나 AST Explorer에 코드를 붙여 넣고, 규칙이 실제로 볼 노드 이름을 확인한다. "왜 이 규칙이 이 코드를 못 잡지?"의 첫 답은 보통 AST 모양에 있다.

### 린터와 포매터는 다른 문제를 푼다

Prettier 문서가 정리하듯, linter 규칙은 크게 formatting rules와 code-quality rules로 나뉜다. Prettier는 첫 번째 범주를 거의 통째로 가져간다. 즉 Prettier의 역할은 "어떤 줄바꿈과 공백이 좋은가"를 매번 판단하지 않게, 프로그램을 일관된 스타일로 다시 출력하는 것이다.

```js
// 입력
const result={name:"Ada",items:[1,2,3].map((value)=>value*2)}

// Prettier 출력
const result = { name: "Ada", items: [1, 2, 3].map((value) => value * 2) };
```

반면 ESLint가 맡아야 할 것은 의미와 버그 가능성이다.

```js
// ❌ 의미 문제: Promise를 만들었지만 기다리지 않는다
async function saveUser(user) {
  api.save(user);
  showToast("saved");
}

// ✅ 의도를 명시한다
async function saveUser(user) {
  await api.save(user);
  showToast("saved");
}
```

formatting을 ESLint로도 처리할 수는 있다. 하지만 두 도구가 같은 줄바꿈을 서로 고치기 시작하면 "저장할 때마다 다시 바뀌는" 충돌이 생긴다. 실무의 기본값은 다음이다.

```text
Prettier: formatting 전담
ESLint: bug 가능성, 안전성, 팀 규칙 전담
eslint-config-prettier: ESLint의 formatting 충돌 규칙 끄기
```

즉 `eslint --fix`와 `prettier --write`가 둘 다 코드를 고칠 수 있어도, 고치는 문제 영역은 달라야 한다.

### 타입 인지 린트는 TypeScript 체커를 빌린다

다음 두 코드는 AST만 보면 비슷하다.

```ts
declare const maybePromise: Promise<string> | string;

maybePromise.trim();
```

`trim()`이 안전한지 알려면 `maybePromise`의 타입을 알아야 한다. 타입은 이 파일의 AST만으로 결정되지 않는다. import, 선언 파일, 제네릭 추론, union narrowing을 모두 알아야 한다. typescript-eslint의 type-aware 규칙은 TypeScript의 type checking API를 호출해 이 정보를 얻는다.

그래서 비용이 달라진다.

```text
일반 ESLint 규칙
  파일 파싱 → AST visitor

타입 인지 ESLint 규칙
  tsconfig 탐색 → TypeScript program/service 구성 → 타입 정보 조회 → AST visitor
```

[4-5](../phase-4/05-compiler-and-config.md)에서 본 것처럼 타입 검사는 전체 프로그램 분석이다. typescript-eslint 문서도 typed linting이 "더 깊은 통찰"을 주는 대신 TypeScript가 프로젝트를 분석해야 하므로 느리다고 설명한다. 따라서 다음 기준이 필요하다.

- `no-unused-vars`, `eqeqeq`, `no-constant-binary-expression`처럼 구문·scope만으로 충분한 것은 일반 규칙으로 둔다.
- `no-floating-promises`, `no-unsafe-assignment`, `await-thenable`처럼 타입 없이는 오탐·미탐이 큰 규칙만 typed lint로 둔다.
- typed lint는 전체 repo에 무조건 켜기보다 `src/**/*.{ts,tsx}`처럼 실제 앱 코드부터 켠다.
- CI에서는 lint와 `tsc --noEmit` 시간을 따로 측정해 병목을 나눈다.

flat config 예시는 다음 모양이 된다.

```js
// eslint.config.js
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["dist/**", "coverage/**"],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    extends: [js.configs.recommended],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      tseslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
]);
```

여기서 중요한 것은 설정 문법보다 적용 범위다. `files`가 typed lint 비용의 경계다. 테스트 파일, 설정 파일, 스크립트 파일까지 같은 타입 프로그램에 억지로 넣으면 tsconfig inclusion 오류와 검사 시간이 함께 늘어난다.

### Flat config는 설정 병합을 데이터로 만든다

ESLint의 flat config는 `eslint.config.js`가 배열을 export하는 모델이다. 각 객체는 `files`, `ignores`, `languageOptions`, `plugins`, `rules`를 가진다. ESLint는 lint 대상 파일에 대해 배열을 위에서 아래로 훑고, 해당 파일에 매칭되는 객체들을 적용한다.

```js
export default [
  { ignores: ["dist/**"] },
  {
    files: ["src/**/*.js"],
    rules: { "no-console": "warn" },
  },
  {
    files: ["src/**/*.test.js"],
    rules: { "no-console": "off" },
  },
];
```

`src/app.js`에는 `no-console: warn`이 적용된다. `src/app.test.js`에는 뒤 객체가 같은 규칙을 덮어 `off`가 된다. 이 모델은 예전 `.eslintrc`의 디렉터리 계층 상속보다 명시적이다. 설정도 코드이므로 plugin import, 조건 분기, 공유 배열 조합이 가능하다.

디버깅은 추측으로 하지 않는다.

```sh
pnpm eslint --inspect-config src/app.tsx
pnpm eslint src --debug
```

어떤 config object가 적용되었는지 보고, 느린 규칙은 ESLint의 timing 옵션이나 CI job 시간을 분리해 관찰한다.

### 자동 수정은 작은 변환기다

ESLint rule은 문제를 report할 뿐 아니라 fix를 제공할 수 있다.

```js
context.report({
  node,
  message: "var 대신 const를 사용한다.",
  fix(fixer) {
    return fixer.replaceTextRange([node.start, node.start + 3], "const");
  },
});
```

fix는 AST를 다시 생성하는 것이 아니라 source text range를 고치는 작은 patch다. 그래서 fix는 보수적이어야 한다. 의미가 바뀔 가능성이 있으면 suggestion으로 내려야 한다. Prettier가 전체 프로그램을 다시 출력하는 것과 ESLint fixer가 특정 range를 고치는 것은 다른 계산이다.

## 실무 관점

### 무엇을 어디서 잡을 것인가

| 문제 | 적합한 계층 | 이유 |
|---|---|---|
| 공백, 줄바꿈, quote 스타일 | Prettier | 의미보다 출력 형식의 문제이고 전체 재출력이 안정적이다 |
| 미사용 변수, unreachable code | ESLint 일반 규칙 | AST와 scope 정보로 빠르게 잡을 수 있다 |
| floating promise, unsafe any | 타입 인지 ESLint | 타입 정보 없이는 정확도가 낮다 |
| null 가능성, 제네릭 제약 오류 | TypeScript | 언어의 타입 관계 판정 자체다 |
| 버튼 클릭 후 화면 변화 | 테스트 | 정적 도구는 사용자 상호작용 결과를 실행하지 않는다 |
| API 응답 계약 | 타입 + 런타임 검증 + 테스트 | 외부 입력은 타입만으로 보장되지 않는다 |

정적 분석은 실행 전 비용으로 버그를 줄인다. 그러나 런타임에서만 드러나는 상태 전이, 네트워크 실패, 브라우저 이벤트 순서는 테스트 계층으로 넘겨야 한다. "ESLint 규칙으로 막을 수 없나?"라는 질문은 대개 "실행하지 않고 알 수 있는가?"로 바꾸면 답이 나온다.

### CI 파이프라인에서 분리해야 하는 이유

한 job에서 `pnpm lint && pnpm typecheck && pnpm test`를 순서대로 돌리면 실패는 간단하지만 병목이 흐려진다. Phase 6-5에서는 이를 파이프라인으로 설계하겠지만, 정적 분석 관점의 원칙은 다음이다.

- formatting check는 가장 빠르게 실패시킨다.
- 일반 lint와 typed lint 시간을 분리해 병목 규칙을 찾는다.
- `tsc --noEmit`은 타입의 최종 게이트로 남긴다. typed lint가 타입 검사를 일부 쓰더라도 TypeScript 전체 검사를 대체하지 않는다.
- test는 정적 검증을 통과한 뒤 실행해도 되지만, CI 시간이 길면 병렬화한다.

### 흔한 안티패턴

| 안티패턴 | 문제 | 수정 |
|---|---|---|
| ESLint formatting 규칙과 Prettier를 동시에 켠다 | 저장 때마다 충돌하거나 CI가 스타일로 소모된다 | `eslint-config-prettier`로 formatting 규칙을 끈다 |
| typed lint를 모든 파일에 켠다 | 설정 파일·테스트 fixture까지 TS program에 넣어 느려진다 | `files` 범위를 좁히고 별도 tsconfig를 둔다 |
| `eslint-disable`을 문제 해결로 쓴다 | 규칙 실패의 근거가 사라진다 | 한 줄 disable에는 이유를 남기고 unused disable을 CI에서 에러로 |
| 타입 에러를 ESLint 경고로만 둔다 | 배포 게이트가 약해진다 | `tsc --noEmit`을 별도 필수 단계로 |
| 테스트가 깨지는 코드를 lint rule로 막으려 한다 | 정적 도구가 실행 상태를 모른다 | 사용자 계약은 RTL/Vitest 테스트로 |

## 더 깊이

### Parser 선택은 AST 방언 선택이다

ESLint 기본 parser인 Espree는 ESTree 형식의 JavaScript AST를 만든다. TypeScript 문법은 기본 JavaScript 문법이 아니므로 `@typescript-eslint/parser`가 TypeScript 코드를 ESTree 호환 AST로 변환한다. 이때 TypeScript 고유 노드가 추가된다. 규칙 작성자가 `TSTypeAnnotation`, `TSAsExpression` 같은 노드를 보게 되는 이유다.

이 변환 계층 때문에 "ESLint 규칙이 TypeScript 코드를 볼 수 있다"와 "TypeScript 타입을 안다"는 다른 말이다. parser만 바꾸면 TS 문법을 파싱할 수 있지만, 타입 정보는 `parserOptions.projectService`나 `project`를 통해 TypeScript program에 연결해야 얻는다.

### Scope와 code path 분석

ESLint는 AST만 순회하지 않는다. 변수 선언과 참조를 연결하는 scope 분석, 분기와 return 흐름을 보는 code path 분석도 제공한다. `no-unused-vars`는 scope 분석이 있어야 가능하고, `array-callback-return` 같은 규칙은 callback이 모든 경로에서 값을 반환하는지 code path를 본다.

하지만 이 분석은 여전히 JavaScript 구문 수준이다. 다음 함수의 실제 값 범위는 정적 구문만으로 알 수 없다.

```js
function getMode() {
  return localStorage.getItem("mode");
}
```

외부 저장소, 네트워크, DOM 상태는 정적 분석의 바깥이다. 정적 분석 도구가 "언제 무너지는가"를 아는 것이 과한 규칙 설계를 막는다.

### 규칙은 팀의 설계 결정을 자동화하는 마지막 단계다

커스텀 규칙을 너무 빨리 만들면 도구가 설계 토론을 대체한다. 좋은 순서는 반대다.

```text
반복되는 버그 관찰
  → 코드 리뷰 기준으로 문장화
  → 기존 규칙으로 표현 가능한지 확인
  → 불가능하고 효과가 충분할 때 커스텀 규칙화
```

예를 들어 "서버 상태를 Zustand에 복사하지 않는다"는 [5-8](../phase-5/08-server-state.md)의 설계 원칙이다. 이것을 바로 AST 규칙으로 만들면 오탐이 많을 수 있다. 먼저 Query hook 결과를 `useState` 초기값으로 복사하는 단골 패턴이 반복되는지 보고, 그 좁은 패턴만 자동화하는 것이 낫다.

## 정리

- ESLint 규칙은 AST와 scope/code path 정보를 순회하는 visitor다. 실행하지 않고 빠르게 보는 대신 런타임 의미를 전부 알지는 못한다.
- Prettier는 formatting을 맡고, ESLint는 code quality와 버그 가능성 패턴을 맡는다. 두 도구가 같은 스타일 규칙을 고치게 두지 않는다.
- 타입 인지 린트는 TypeScript 체커를 빌리므로 강력하지만 느리다. 전체 프로그램 분석 비용을 인정하고 적용 범위를 설계한다.
- flat config는 파일 패턴별 config object 배열이다. 정적 분석의 비용과 정책 경계는 `files`와 tsconfig inclusion에서 결정된다.
- 정적 분석, 타입 검사, 테스트는 서로 대체재가 아니라 다른 입력을 읽는 계층이다. 실행하지 않고 알 수 없는 것은 테스트로 넘긴다.

## 확인 문제

**Q1.** 팀이 `@typescript-eslint/no-floating-promises`를 켰더니 CI lint 시간이 20초에서 2분으로 늘었다. 왜 이 규칙은 일반 ESLint 규칙보다 비싸며, 어떤 방식으로 비용을 줄일 수 있는가?

<details>
<summary>정답과 해설</summary>

`no-floating-promises`는 어떤 표현식이 Promise인지 알아야 한다. 이는 AST 모양만으로 알 수 없고 TypeScript의 타입 정보가 필요하다. typescript-eslint는 tsconfig를 찾고 TypeScript program/service를 구성해 타입 checking API를 호출한다. 즉 파일 단위 visitor에서 전체 프로그램 분석이 붙은 것이다. 비용을 줄이려면 typed lint 적용 범위를 `src/**/*.{ts,tsx}`처럼 좁히고, 테스트 fixture나 빌드 스크립트는 별도 config로 분리한다. typed 규칙은 꼭 필요한 것만 켜고, CI에서는 lint job과 `tsc --noEmit` job 시간을 따로 관찰한다.
</details>

**Q2.** `eslint --fix`와 `prettier --write`를 모두 실행하면 같은 파일이 계속 바뀐다. 이 증상의 계층 원인은 무엇이고 어떻게 해결하는가?

<details>
<summary>정답과 해설</summary>

ESLint의 formatting 규칙과 Prettier가 같은 출력 형식을 서로 다르게 고치고 있다. 두 도구가 같은 문제를 해결하고 있으므로 fix loop가 생긴다. 해결은 formatting을 Prettier에 전담시키고, ESLint에서 formatting 관련 규칙을 끄는 것이다. 일반적으로 `eslint-config-prettier`를 마지막에 적용해 충돌 규칙을 비활성화한다. ESLint는 bug 가능성, 안전성, 팀 규칙에 집중한다.
</details>

**Q3.** 접근성 정책상 모든 버튼에 접근 가능한 이름이 있어야 한다. 팀원이 ESLint 커스텀 규칙으로 `<button />`을 잡자고 한다. 이 규칙이 잡을 수 있는 것과 못 잡는 것을 구분하고, 테스트 계층과 어떻게 나눌지 설명하라.

<details>
<summary>정답과 해설</summary>

AST 규칙은 JSX에서 `<button />`, `<button>{icon}</button>`처럼 명백히 텍스트나 aria-label이 없는 패턴을 잡을 수 있다. 그러나 조건부 렌더링, 컴포넌트 래핑, props로 전달되는 label, i18n 함수 결과, 실제 접근성 트리의 이름 계산은 정적 AST만으로 정확히 알기 어렵다. 따라서 좁고 오탐이 적은 금지 패턴은 ESLint로 잡고, 실제 사용자 계약은 React Testing Library의 `getByRole("button", { name: ... })` 테스트나 접근성 검사로 확인한다. 정적 분석은 빠른 방어선이고, 접근성 트리 결과는 실행 계층의 검증이다.
</details>

## 참고 자료

- [ESLint — Configuration Files](https://eslint.org/docs/latest/use/configure/configuration-files) — flat config 파일명, config object 배열, `files`/`ignores` 적용 모델을 확인할 수 있다.
- [ESLint — Custom Rules](https://eslint.org/docs/latest/extend/custom-rules) — rule의 `create()` 함수가 AST visitor를 반환하는 구조와 `context.report`/fixer 모델을 설명한다.
- [typescript-eslint — Linting with Type Information](https://typescript-eslint.io/getting-started/typed-linting/) — typed linting이 TypeScript type checking API를 사용하며 성능 비용을 가진다는 점을 확인할 수 있다.
- [Prettier — Prettier vs. Linters](https://prettier.io/docs/comparison) — formatting rules와 code-quality rules의 분리를 설명한다.
- [TypeScript 컴파일러와 설정](../phase-4/05-compiler-and-config.md) — 타입 검사가 전체 프로그램 분석이라는 이 저장소의 선행 설명이다.
