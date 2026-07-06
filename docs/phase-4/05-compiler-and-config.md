# 4-5. 컴파일러와 설정

> 한 줄 요약: tsc가 타입 검사와 트랜스파일이라는 독립된 두 작업의 결합체임을 이해하면, esbuild가 검사를 하지 않는 이유부터 tsconfig의 각 옵션이 어느 작업을 조정하는지, "값은 되는데 타입을 못 찾는" 증상의 원인까지 판단할 수 있다.

이 문서는 TypeScript 5.9 기준이다. [4-1](./01-type-system-foundations.md)의 타입 소거와 [3-9](../phase-3/09-modules.md)의 모듈 해석·이중 생태계를 전제한다.

## 학습 목표

- tsc 파이프라인(스캐너→파서→바인더→체커→이미터)에서 검사와 방출이 분리되어 있음을 설명하고, esbuild류 도구가 검사를 생략하는 구조적 이유를 설명할 수 있다.
- isolatedModules가 강제하는 "파일 단위 변환 가능 문법"의 제약이 어디서 오는지 설명할 수 있다.
- strict 계열 옵션 각각이 무엇을 검사에 추가하는지 근거와 함께 판단하고, 신규/기존 프로젝트의 기준선을 세울 수 있다.
- 선언 파일(.d.ts)의 역할과 모듈 보강을 이해하고, "값은 임포트되는데 타입 에러"인 증상을 moduleResolution 관점에서 진단할 수 있다.

## 배경: 왜 이것이 존재하는가

Java 개발자에게 컴파일러는 하나의 몸이다 — javac는 타입을 검사하고, 통과하면 바이트코드를 낸다. 검사 없는 산출물이란 없다. TS 생태계는 다르게 굴러간다: Vite로 개발하면 코드는 esbuild가 변환하는데 **타입 검사는 아무도 하지 않는다**(에디터가 보여줄 뿐이다). CI에서 `tsc --noEmit`이 따로 돈다. "컴파일은 됐는데 타입 에러가 있는" 상태가 일상적으로 성립한다.

이 분리는 우연히 생긴 관행이 아니라 두 작업의 본질 차이에서 온다.

- **트랜스파일**(타입 구문 제거 + 문법 하향)은 [4-1](./01-type-system-foundations.md)의 소거 원칙 덕분에 원리적으로 **파일 하나만 보고** 할 수 있는 구문 변환이다. 다른 파일을 알 필요가 없으니 파일별로 병렬화되고, Go로 짠 esbuild는 이 작업을 tsc보다 수십 배 빠르게 한다.
- **타입 검사**는 정반대로 **전체 프로그램 분석**이다. `import { User } from "./user"`의 User가 무엇인지 알려면 그 파일을(그리고 그 파일의 의존을) 읽고 심볼을 해석해야 한다. 할당 가능성 판정([4-1](./01-type-system-foundations.md))은 이 전역 심볼 그래프 위에서 돈다.

빠르게 할 수 있는 작업과 느릴 수밖에 없는 작업이 한 몸에 묶여 있을 이유가 없다 — 생태계는 둘을 쪼갰고, 그 쪼개진 틈에서 이 문서가 다루는 개념들(isolatedModules, noEmit, 검사 전용 CI)이 나왔다. tsconfig의 수십 개 옵션도 이 구도 위에서 읽으면 두 무더기로 정리된다: **검사기를 조정하는 옵션**(strict 계열)과 **방출·해석을 조정하는 옵션**(target, module, moduleResolution).

## 핵심 개념

### tsc 파이프라인: 검사와 방출은 독립이다

tsc의 내부는 다섯 단계로 요약된다.

```text
소스 텍스트
  → 스캐너(scanner)     : 토큰화
  → 파서(parser)        : AST 생성 — 구문 오류는 여기서
  → 바인더(binder)      : 식별자를 심볼로 연결, 스코프 구성
  → 체커(checker)       : 할당 가능성 판정, 추론 — 타입 에러는 전부 여기서
  → 이미터(emitter)     : 타입 구문을 제거한 JS + .d.ts + 소스맵 방출
```

핵심 사실: **체커와 이미터는 서로를 필요로 하지 않는다.** 이미터는 타입 판정 결과를 (거의) 쓰지 않고 타입 구문을 지우며, 체커는 산출물을 만들지 않는다. 그래서 tsc는 기본값으로 **타입 에러가 있어도 JS를 방출한다** — javac 감각으로는 기이하지만, "동작하던 JS에 타입을 점진적으로 얹는" 마이그레이션 시나리오에서는 에러가 남아 있어도 실행해 볼 수 있어야 하기 때문이다(막고 싶으면 `noEmitOnError`).

이 독립성이 두 반쪽짜리 실행 모드를 가능하게 한다.

```bash
tsc --noEmit    # 체커만: 검사하고 아무것도 만들지 않는다 — CI의 타입 게이트
# esbuild, swc  # 이미터만: 검사 없이 변환한다 — 빌드의 속도 담당
```

Vite 기반 프로젝트의 표준 구성이 정확히 이 분업이다: 개발 서버와 프로덕션 빌드는 esbuild/Rollup이 변환만 하고, 타입 검사는 에디터(tsserver — 같은 체커를 쓰는 언어 서버)가 실시간으로, CI가 `tsc --noEmit`으로 수행한다. 검사와 빌드가 **병렬**이 되므로 빌드 시간에서 타입 검사가 사라진다. 트레이드오프도 분명하다: 빌드 성공이 타입 안전을 의미하지 않게 되므로, CI의 검사 단계가 빠지면 타입 에러가 그대로 배포된다 — 분업 구성에서 `tsc --noEmit`은 선택이 아니라 필수 게이트다.

### isolatedModules: 파일 단위 변환이 강제하는 문법 부분집합

트랜스파일이 "파일 하나만 보고" 가능하다고 했지만, 정확히는 **거의** 그렇다. TS 문법 중 몇 개는 다른 파일의 타입 정보를 알아야 올바르게 변환할 수 있고, 파일 단위 도구에서는 원리적으로 깨진다.

**re-export가 대표 사례다.**

```ts
// user.ts
export interface User { id: number }
export const DEFAULT_USER = { id: 0 };

// index.ts
export { User, DEFAULT_USER } from "./user";
// 파일 단위 변환기의 딜레마: User가 타입인지 값인지 이 파일만 봐서는 알 수 없다
// - 타입이면 이 줄에서 지워야 하고(런타임에 없으니까)
// - 값이면 남겨야 한다
// tsc는 user.ts의 심볼을 알아서 올바르게 처리하지만, esbuild는 알 수 없다
```

**const enum이 다른 사례다.** [4-2](./02-type-design.md)에서 본 대로 const enum은 사용처에 값을 인라인하는데, 그 값은 enum이 선언된 **다른 파일**에 있다. 파일 단위 변환기는 인라인할 값을 모른다.

`isolatedModules: true`는 이 문제의 해법이다 — 새 동작을 켜는 것이 아니라, **파일 단위로 변환할 수 없는 문법을 tsc가 에러로 잡아 주는** 검사 옵션이다. esbuild/SWC로 빌드하는 프로젝트라면 사실상 필수이고, Vite는 이를 전제한다.

같은 문제의 문법적 해법이 type-only import/export다.

```ts
// ✅ 타입임을 구문에 명시 — 파일 단위 변환기도 지울 수 있다
import type { User } from "./user";
export type { User } from "./user";

// 값과 타입 혼합 시 인라인 표기
import { type User, DEFAULT_USER } from "./user";
```

`verbatimModuleSyntax`(TS 5.0)는 이를 강제 규약으로 끌어올린 옵션이다: **type 표시가 없는 import는 지우지 않고 그대로 방출한다**는 단순 규칙으로, "이 import가 지워질까 남을까"를 파일만 보고 판정할 수 있게 만든다. 타입만 임포트하면서 type 표시를 빠뜨리면 에러가 난다. 신규 프로젝트에서 켜는 것을 권장하는 이유는 이 단순함이다 — 사람과 도구가 같은 규칙으로 판단하게 된다.

### strict 계열: 각 옵션이 검사에 추가하는 것

`strict: true`는 개별 옵션 묶음의 스위치다. 전부 켜는 것이 신규 프로젝트의 기준선이라는 결론은 널리 합의되어 있지만, **각각이 무엇을 근거로 존재하는지** 알아야 기존 코드베이스에서 단계적으로 켜는 순서를 판단할 수 있다. 주요 옵션의 근거:

**strictNullChecks — null 추적을 켜는 스위치.** 꺼진 세계에서는 null과 undefined가 모든 타입에 할당 가능하다 — 즉 `string` 타입이 실제로는 `string | null | undefined`를 의미하고, 타입 시스템 전체가 null에 대해 거짓말을 한다. 켜면 null 가능성이 타입에 명시되고([4-1](./01-type-system-foundations.md)의 `Element | null`), 좁히기로만 해소된다. "10억 달러짜리 실수"(null 참조)의 정적 방어가 이 옵션 하나에 달려 있으므로, 단계 도입 시 가장 먼저 켤 가치가 있고 가장 많은 에러를 낸다.

**noImplicitAny — 추론 실패의 침묵을 금지.** 추론이 타입을 결정할 수 없을 때(주석 없는 매개변수 등) 조용히 any로 두는 대신 에러를 낸다. [4-1](./01-type-system-foundations.md)에서 본 any의 전염성을 생각하면, 이것이 꺼진 코드베이스의 타입 커버리지는 표시된 것보다 훨씬 낮다.

**strictFunctionTypes — 함수 매개변수의 반공변 검사.** [4-3](./03-generics-and-variance.md)에서 다룬 그 옵션이다. 메서드 축약 표기는 예외로 남는다는 것까지가 세트.

**noUncheckedIndexedAccess — 인덱스 접근의 정직화.** strict 묶음에 **포함되지 않는** 추가 옵션. `arr[i]`와 `record[key]`의 타입에 `| undefined`를 붙인다 — 배열 인덱스가 범위 안이라는 보장은 어디에도 없으므로 이것이 정직한 타입이지만, 기존 코드에 에러를 대량으로 만들기 때문에 strict에서 빠졌다. 신규 프로젝트라면 켤 가치가 있고, 켜면 `arr[0]!` 같은 단언 대신 `arr.at(0)` 스타일의 명시적 undefined 처리가 관례가 된다.

왜 strict가 기본값이 아닌가 — 하위 호환이다. tsconfig 없이 시작한 코드, 옛 버전에서 온 코드가 새 tsc에서 갑자기 에러가 되는 것을 피하는 선택이고, `tsc --init`이 만들어 주는 설정에는 strict가 켜져 있다. 즉 "기본값 아님"은 권장이 아니라 역사다.

### 선언 파일: 타입 정보의 배포 형식

소거 때문에 npm 패키지의 JS에는 타입이 없다. 타입 정보는 별도 파일 — **선언 파일(.d.ts)** — 로 배포된다. 구현 없이 시그니처만 담은 파일로, tsc가 `declaration: true`로 방출하거나 손으로 작성한다.

```ts
// dist/index.d.ts — 구현이 없는 "타입 전용 헤더"
export declare function debounce<F extends (...args: never[]) => void>(
  fn: F,
  ms: number
): (...args: Parameters<F>) => void;
```

C/C++의 헤더 파일과 정확히 같은 위상이다: 컴파일된 산출물(.js)과 그 산출물의 인터페이스 서술(.d.ts)이 분리되어 있고, 소비자의 체커는 서술만 읽는다. `declare` 키워드가 "구현은 다른 곳에 존재한다"는 표시다.

체커가 패키지의 타입을 찾는 경로는 순서가 있다: ① 패키지 package.json의 `types`/`exports`의 types 조건 ② 패키지에 동봉된 .d.ts ③ `@types/<패키지명>` — DefinitelyTyped 저장소에서 커뮤니티가 관리하는 타입 정의다. 라이브러리 본체와 @types의 버전이 어긋나는 것이 ③ 경로의 고질적 위험으로, "라이브러리는 업데이트했는데 타입은 옛날 것"인 상태는 소거 세계에서 컴파일도 실행도 막지 않고 조용히 거짓말만 한다.

라이브러리의 타입이 틀렸거나 부족할 때의 공식 통로가 **모듈 보강(module augmentation)** — [4-2](./02-type-design.md)의 선언 병합을 모듈 경계 너머로 적용하는 것이다.

```ts
// types/express.d.ts — 미들웨어가 주입하는 프로퍼티를 Request 타입에 추가
import "express";

declare module "express" {
  interface Request {
    userId?: string; // 기존 Request와 병합된다
  }
}
```

전역을 보강하려면 `declare global`을 쓴다. 강력한 만큼 프로젝트 전역에 소리 없이 적용되므로, 보강 파일은 한 디렉터리에 모으고 "왜 이 보강이 필요한가"를 주석으로 남기는 것이 관례다.

### 모듈 해석: 값의 세계와 타입의 세계는 따로 해석된다

[3-9](../phase-3/09-modules.md)에서 본 Node의 이중 생태계(CJS/ESM, 조건부 exports)는 타입 해석에서 한 번 더 반복된다. `moduleResolution` 옵션이 체커의 해석 전략을 정한다.

| 값 | 해석 방식 | 쓰는 곳 |
|---|---|---|
| `bundler` | exports 필드를 읽되, 확장자 강제·CJS/ESM 구분에 관대 — "번들러가 처리해 줄 것"을 전제 | Vite/webpack 등 번들러 기반 앱 (권장) |
| `nodenext` | Node의 실제 규칙 그대로 — 상대 경로에 확장자 필수, package.json `type`에 따라 CJS/ESM 판정, exports 조건 엄격 적용 | Node로 직접 실행되는 코드, 라이브러리 |
| `node10` (구 `node`) | exports 필드를 아예 모르는 옛 알고리즘 | 레거시 — 신규 사용 금지 |

진단 관점에서 중요한 것은 이것이다: **번들러/Node가 값을 찾는 경로와 tsc가 타입을 찾는 경로는 별개의 구현**이므로, 둘이 다른 결론을 낼 수 있다. "임포트하면 값은 동작하는데 타입 에러가 난다(TS2307: Cannot find module, 또는 이상한 타입)"는 증상의 전형적 원인들:

- moduleResolution이 `node10`이라 패키지의 `exports` 필드를 못 읽는다 — 최신 패키지가 exports로만 진입점을 노출하면 타입을 못 찾는다.
- 패키지의 exports에 `types` 조건이 빠졌거나 잘못된 파일을 가리킨다 — 값 조건(`import`/`require`)만 있고 타입 조건이 없는 배포 실수.
- CJS/ESM 분기와 타입 분기가 어긋난다 — [3-9](../phase-3/09-modules.md)의 dual package hazard의 타입판: 값은 ESM 빌드를 받는데 타입은 CJS용 .d.ts를 받아 기본 내보내기 모양이 달라지는 경우.

진단 도구는 `tsc --traceResolution`(해석 과정 전체 로그)과, 패키지 배포 쪽을 검사한다면 Are the Types Wrong(`attw`) CLI다. "타입이 이상하다"를 추측이 아니라 해석 로그로 확인할 수 있다.

## 실무 관점

### tsconfig 기준선: 무엇부터 정하는가

수십 개 옵션 중 프로젝트 성격을 결정하는 것은 소수다. 신규 프로젝트의 판단 순서:

1. **실행 환경 → `target`, `lib`**: 방출할 문법 수준. 번들러가 하향을 담당하면 target은 최신에 가깝게 두고 검사용 의미만 남는다.
2. **모듈 소비자 → `module` + `moduleResolution`**: 번들러 기반 앱이면 `"module": "esnext"` + `"moduleResolution": "bundler"`, Node 직접 실행·라이브러리면 둘 다 `"nodenext"`.
3. **검사 강도 → `strict: true`** + 여력이 되면 `noUncheckedIndexedAccess`. 여기서 깎는 것은 부채다.
4. **도구 분업 전제 → `isolatedModules`, `verbatimModuleSyntax`**: esbuild류가 빌드에 끼면 필수.
5. **산출물 → 앱이면 `noEmit: true`**(번들러가 방출 담당), 라이브러리면 `declaration: true`.

기존 코드베이스의 strict 도입은 반대로 증분 전략이 필요하다: 옵션을 하나씩 켜고(`noImplicitAny` → `strictNullChecks` 순서가 일반적), 에러가 너무 많으면 파일 단위 `// @ts-expect-error` 대신 **디렉터리 단위로 tsconfig를 나눠**(project references 또는 별도 검사 설정) 새 코드부터 엄격하게 가져가는 쪽이 유지된다. 한 번에 켜고 수백 개 에러를 `!`로 진압하는 것은 켜지 않은 것보다 나쁘다 — 거짓 안전이 생기기 때문이다.

### "컴파일은 되는데"의 함정 목록

검사/방출 분리 구도에서 생기는 실무 증상들을 모아 두면 디버깅 지도가 된다.

| 증상 | 원인 | 확인 방법 |
|---|---|---|
| 빌드는 성공, 배포 후 타입 관련 버그 | CI에 `tsc --noEmit` 게이트가 없다 | CI 파이프라인에 검사 단계 존재 여부 |
| 에디터는 에러인데 빌드는 통과 | 에디터와 빌드가 다른 tsconfig/TS 버전을 본다 | VS Code "Select TypeScript Version", tsconfig 상속 경로 |
| 특정 import만 빌드에서 깨짐 | isolatedModules 미설정 상태의 타입 re-export / const enum | `isolatedModules` 켜고 tsc로 에러 위치 확인 |
| 값은 되는데 타입을 못 찾음 | moduleResolution 불일치, exports의 types 조건 문제 | `tsc --traceResolution`, `attw` |
| 라이브러리 업데이트 후 타입만 이상 | @types 버전 불일치 | 패키지 동봉 타입인지 @types인지, 버전 대조 |

### 검사 시간이 문제가 될 때

전체 프로그램 분석이라는 본질 때문에 검사 시간은 코드베이스와 함께 자란다. 계측이 먼저다 — [4-4](./04-type-level-programming.md)의 `--extendedDiagnostics`/`--generateTrace` 절차가 그대로 적용되고, 타입 수준 병목이 아니라면 구조적 수단이 있다: `incremental`(이전 검사 결과를 .tsbuildinfo에 캐시), project references(모노레포를 검사 단위로 분할해 변경된 프로젝트만 재검사 — Gradle 멀티모듈 증분 빌드와 같은 구도), 그리고 `skipLibCheck`(의존성 .d.ts 간 정합성 검사 생략 — 대부분의 프로젝트에서 켜는 실용 타협이지만, @types 충돌을 침묵시킨다는 비용은 인지하고 켠다).

## 더 깊이

### 이미터가 체커를 아주 조금 필요로 하는 지점

"검사와 방출은 독립"의 정확한 경계가 isolatedModules 절의 사례들이다 — 타입 전용 import 제거와 const enum 인라인은 이미터가 체커의 심볼 정보를 참조하는 지점이었고, 그래서 파일 단위 도구에서 깨졌다. `verbatimModuleSyntax`는 이 관점에서 다시 읽을 수 있다: 이미터의 체커 의존을 **문법 규약으로 제거**해서 분리를 완성하는 옵션이다. Go로 재작성 중인 네이티브 포트(tsgo — `@typescript/native-preview`로 공개된 차기 버전의 기반)와 Node 24의 타입 스트리핑(`node file.ts` 직접 실행 — 타입 구문을 공백으로 치환할 뿐 검사하지 않는다)도 같은 방향의 생태계 수렴이다: 변환은 어디서나 즉시, 검사는 명시적 단계로.

### .d.ts는 신뢰의 경계다

선언 파일은 구현과 분리되어 있으므로 **구현과 어긋날 수 있다** — 검사기는 .d.ts를 검증 없이 믿는다. 손으로 쓴 .d.ts나 @types가 실제 JS 동작과 다르면, 프로젝트 전체가 strict여도 그 경계에서 타입은 거짓이 된다. 함의는 두 가지다. 소비자로서: 이상한 런타임 동작을 만나면 라이브러리 타입 정의 자체를 의심 목록에 올린다(node_modules의 .d.ts를 직접 열어 본다). 배포자로서: .d.ts를 손으로 쓰지 말고 구현(.ts)에서 `declaration: true`로 생성한다 — 생성된 선언은 구현과 어긋날 수 없다.

### tsserver: 에디터의 TS는 별도 프로세스다

에디터의 타입 에러·자동완성·리팩터링은 tsc가 아니라 tsserver — 같은 체커를 감싼 장수 명령 프로세스 — 가 제공한다. 파일 변경마다 전체를 재검사하는 대신 의존 그래프의 영향 범위만 갱신하는 증분 모델이라, "에디터는 통과인데 tsc는 에러"(또는 반대)가 stale 상태로 일시 발생할 수 있다 — TS 버전 불일치 다음으로 흔한 원인이 이 캐시다(VS Code의 "Restart TS Server"가 해결하는 것). [4-4](./04-type-level-programming.md)의 타입 성능 문제가 "에디터 반응성"으로 체감되는 것도 키 입력마다 이 프로세스의 체커가 돌기 때문이다.

## 정리

- tsc는 파일 단위 구문 변환(트랜스파일)과 전체 프로그램 분석(타입 검사)의 결합체이고, 둘은 독립이다. esbuild류는 앞 반쪽만 빠르게 수행하며, 그래서 `tsc --noEmit`이 CI의 필수 게이트가 된다.
- 파일 단위 변환이 원리적으로 불가능한 문법(타입 re-export, const enum)이 있고, isolatedModules가 그것을 에러로 잡는다. `import type`/`verbatimModuleSyntax`는 지울 것을 구문으로 표시해 이 문제를 제거한다.
- strict는 옵션 묶음이다: strictNullChecks가 null 추적을, noImplicitAny가 추론 실패의 침묵을, strictFunctionTypes가 반공변 검사를 담당한다. 기본값이 아닌 것은 하위 호환의 역사이며, 신규 프로젝트의 기준선은 strict 전체 + noUncheckedIndexedAccess 고려다.
- 타입 정보는 .d.ts로 배포되고(C 헤더의 위상), 체커는 그것을 검증 없이 믿는다. 부족한 타입은 모듈 보강으로 채우되, 값의 해석과 타입의 해석은 별개 구현이라 어긋날 수 있다 — moduleResolution과 `--traceResolution`이 진단 도구다.
- 검사 시간은 계측 후 대응한다: incremental, project references, (비용을 인지한) skipLibCheck.

## 확인 문제

**Q1.** 팀이 webpack + babel-loader에서 Vite로 이전한 뒤, 전에 없던 두 종류의 문제가 생겼다: ① 어떤 파일의 `export { Config } from "./config"`가 런타임 에러를 낸다. ② 타입 에러가 있는 코드가 프로덕션에 배포됐다. 각각의 원인과 대책을 설명하라.

<details>
<summary>정답과 해설</summary>

① `Config`가 타입(interface 등)인 경우다. 파일 단위 변환기(esbuild)는 이 re-export가 타입인지 값인지 알 수 없어 값 재수출 코드를 남기고, 런타임에 존재하지 않는 심볼을 내보내려다 실패한다(babel도 같은 부류지만 설정에 따라 증상이 달랐을 수 있다). 대책: `isolatedModules`를 켜서 이런 문법을 컴파일 에러로 잡고, `export type { Config }`로 고친다. `verbatimModuleSyntax`를 켜면 규약으로 강제된다.

② Vite의 빌드는 타입 검사를 하지 않는다 — 검사(전체 프로그램 분석)와 변환(파일 단위)의 분리가 Vite의 속도의 원천이고, 검사는 에디터와 별도 프로세스의 몫이다. webpack 시절 ts-loader가 검사를 겸했다면 이 게이트가 이전 과정에서 사라진 것이다. 대책: CI에 `tsc --noEmit` 단계를 추가한다(또는 로컬 개발 중 병렬 검사를 원하면 vite-plugin-checker류). 분업 구성에서 이 게이트는 선택이 아니다.

</details>

**Q2.** `strictNullChecks`가 꺼진 오래된 코드베이스에서 "우리는 타입을 다 붙였으니 안전하다"는 주장이 나왔다. 이 주장의 문제를 설명하고, 이 옵션을 켤 때 에러가 대량으로 나오는 이유와 도입 전략을 제시하라.

<details>
<summary>정답과 해설</summary>

문제: strictNullChecks가 꺼진 세계에서 null/undefined는 모든 타입에 할당 가능하다. `function f(name: string)`의 name에 null이 그대로 들어올 수 있으므로, 표기된 모든 타입이 실제로는 `| null | undefined`를 숨기고 있다 — 타입을 "다 붙였다"는 것이 null 안전과 무관하다. 런타임 TypeError의 최대 원천(null 참조)에 대해 시스템 전체가 침묵하는 상태다.

에러가 대량인 이유: 옵션을 켜는 순간 지금까지 숨겨졌던 null 흐름 전부 — `querySelector`의 반환, 옵셔널 프로퍼티 접근, 초기화 전 필드 — 가 한꺼번에 검사 대상이 되기 때문이다. 이 에러들은 새 버그가 아니라 **원래 있던 위험의 목록**이다.

도입 전략: 한 번에 켜고 `!`로 진압하는 것은 금물(거짓 안전). ① 새 코드/새 디렉터리부터 별도 tsconfig(또는 project references)로 켜서 경계를 만들고, ② 기존 코드는 모듈 단위로 옮기며, ③ 남은 에러는 `@ts-expect-error` + 사유 주석으로 명시적 부채로 만든다(나중에 해소되면 해당 주석이 오히려 에러가 되어 자동 청소된다).

</details>

**Q3.** 어떤 패키지를 임포트하자 런타임에는 정상 동작하는데 tsc가 TS2307(Cannot find module)을 낸다. 원인 후보를 좁혀 가는 진단 절차를 제시하라.

<details>
<summary>정답과 해설</summary>

전제: 값(번들러/Node)과 타입(tsc)의 모듈 해석은 별개 구현이므로, 한쪽만 성공하는 상태가 성립한다. 절차:

1. **자기 설정 확인**: tsconfig의 `moduleResolution`이 무엇인가. `node10`이면 패키지의 `exports` 필드를 읽지 못한다 — 최신 패키지가 exports로만 진입점을 노출하면 값은 되고(번들러는 exports를 읽으므로) 타입만 못 찾는 정확히 이 증상이 난다. 번들러 기반이면 `bundler`로 옮긴다.
2. **패키지 쪽 확인**: node_modules에서 해당 패키지의 package.json을 열어 `exports`에 `types` 조건이 있는지, 가리키는 .d.ts가 실재하는지 본다. 값 조건만 있고 types가 빠진 배포 실수라면 패키지 이슈이고, 임시로 모듈 보강(`declare module "pkg"`)으로 막을 수 있다.
3. **동봉 타입이 없다면**: `@types/<pkg>` 존재 여부를 확인하고 버전을 본체와 대조한다.
4. **해석 로그로 확정**: `tsc --traceResolution | grep <pkg>`로 체커가 어떤 경로를 시도하고 어디서 포기했는지 직접 본다. 패키지 배포 상태 자체를 검증하려면 `attw`(Are the Types Wrong)를 돌린다.

핵심은 순서다 — 추측으로 exports를 고치기 전에, 해석 로그가 "누가 어디서 못 찾았는가"를 사실로 알려 준다.

</details>

## 참고 자료

- [TypeScript Handbook — tsconfig Reference](https://www.typescriptlang.org/tsconfig/) — 전 옵션의 공식 레퍼런스. strict 묶음에 포함되는 옵션 목록 확인.
- [TypeScript Handbook — Modules Reference: Theory](https://www.typescriptlang.org/docs/handbook/modules/theory.html) — 값 해석과 타입 해석의 관계, moduleResolution 선택 기준의 공식 서술. 이 문서 모듈 절의 1차 자료.
- [TypeScript Wiki — Architectural Overview](https://github.com/microsoft/TypeScript/wiki/Architectural-Overview) — 스캐너→파서→바인더→체커→이미터 파이프라인의 공식 설명.
- [esbuild — TypeScript Caveats](https://esbuild.github.io/content-types/#typescript-caveats) — 파일 단위 변환이 지원할 수 없는 TS 기능 목록을 도구 저자가 직접 정리한 문서.
- [Are the Types Wrong? (attw)](https://arethetypeswrong.github.io/) — 패키지의 값/타입 해석 불일치(dual package hazard 포함)를 검사하는 도구.
- [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) — @types 패키지의 원천 저장소. 타입 정의가 의심될 때 이력을 확인하는 곳.
