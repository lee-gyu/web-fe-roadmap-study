# 6-1. 패키지 관리

> 한 줄 요약: 이 문서를 읽고 나면 `pnpm install`이 버전 범위, lockfile, `node_modules` 레이아웃을 어떤 순서로 계산하는지 설명하고, 유령 의존성·중복 설치·peer 충돌을 계층별로 진단할 수 있다.

이 문서는 이 저장소의 기준인 Node.js 24.14 이상, pnpm 11.10.0을 기준으로 한다. npm의 `package.json` 필드 의미는 npm CLI 11 문서를 함께 기준으로 삼는다.

## 학습 목표

- `package.json`의 semver 범위와 lockfile이 각각 "의도"와 "결정"을 담당한다는 점을 설명할 수 있다.
- 다이아몬드 의존성에서 같은 패키지의 여러 버전이 공존하는 이유를 Node의 모듈 해석 모델로 설명할 수 있다.
- npm/Yarn Classic의 평탄화(hoisting)가 유령 의존성을 만드는 구조와 pnpm의 링크 구조가 이를 줄이는 방식을 설명할 수 있다.
- `peerDependencies`가 "호스트가 제공하는 단일 인스턴스"라는 계약을 표현한다는 점을 React 사례로 판단할 수 있다.
- 설치 문제를 semver 범위, lockfile, hoisting, peer 해석 중 어느 계층에서 난 것인지 분류할 수 있다.

## 배경: 왜 이것이 존재하는가

Java의 Maven/Gradle이나 Go modules를 써 온 개발자에게 JS 패키지 관리는 낯설다. Maven은 기본적으로 하나의 classpath 안에서 한 artifact의 버전을 하나로 수렴시킨다. Go modules의 MVS(minimal version selection)도 모듈 그래프 전체에서 한 버전을 선택한다. 반면 JS 생태계는 **같은 패키지의 여러 버전이 동시에 설치되고, 각 모듈이 자기 위치에서 보이는 버전을 읽는 모델**을 택했다.

이 선택은 브라우저와 Node의 역사에서 왔다. npm 패키지는 중앙 빌드 시스템 안의 artifact라기보다, 런타임에서 `require()`나 `import`가 해석할 파일 트리다. 패키지 A는 lodash 4를, 패키지 B는 lodash 3을 요구할 수 있고, 둘을 억지로 하나로 합치면 한쪽이 깨진다. 그래서 npm은 충돌을 전역 실패로 만들기보다 **중첩된 `node_modules`로 공존**시키는 쪽을 택했다.

대가는 명확하다. 디스크에 같은 패키지가 여러 벌 생길 수 있고, 어떤 패키지가 왜 보이는지 경로에 따라 달라진다. `package.json`에 선언하지 않은 패키지가 우연히 import되는 유령 의존성(phantom dependency)도 여기서 생긴다. Phase 6-1의 목적은 설치 명령을 외우는 것이 아니라, 설치를 **입력 그래프에서 디스크 레이아웃을 계산하는 함수**로 보는 것이다.

이 장은 [3-9 모듈](../phase-3/09-modules.md)의 bare specifier와 Node식 패키지 해석, [4-5 컴파일러와 설정](../phase-4/05-compiler-and-config.md)의 `moduleResolution`을 전제한다. 번들러가 이 의존성 그래프를 어떻게 산출물로 바꾸는지는 [6-2](./02-bundlers.md)에서 이어받는다.

## 핵심 개념

### `package.json`은 의도이고 lockfile은 결정이다

`package.json`의 dependency 항목은 정확한 파일 목록이 아니다. 패키지 이름과 **버전 범위(version range)** 를 적는다.

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "date-fns": "~4.1.0",
    "zod": "4.0.0"
  },
  "devDependencies": {
    "vite": "^8.1.0",
    "vitest": "^4.1.0"
  }
}
```

`^19.0.0`은 "호환 가능한 19.x 최신"이라는 범위이고, `~4.1.0`은 "대략 4.1.x"라는 더 좁은 범위다. 정확한 버전을 쓰면 갱신 드리프트는 줄지만 보안·버그 수정 업데이트를 직접 올려야 한다. 범위를 쓰면 업데이트가 쉬워지지만, **같은 `package.json`이 시간에 따라 다른 실제 버전으로 해석될 수 있다.**

그래서 lockfile이 필요하다. 설치기는 다음 순서로 계산한다.

```text
package.json의 의도
  → registry 메타데이터 조회
  → semver 범위를 만족하는 버전 선택
  → 각 패키지의 하위 dependency 반복 해석
  → peer 충족 여부 계산
  → 디스크에 놓을 실제 패키지 그래프 결정
  → pnpm-lock.yaml에 결정 결과 고정
```

`package.json`은 사람이 읽는 의도이고, `pnpm-lock.yaml`은 설치기가 계산한 결정이다. CI에서 `pnpm install --frozen-lockfile`을 쓰는 이유가 여기에 있다. lockfile과 `package.json`이 어긋나면 "새로운 결정을 계산해도 되는가"를 사람에게 묻는 대신 실패시킨다. 재현 가능한 설치는 lockfile에서 시작한다.

관찰은 간단하다.

```sh
pnpm install --lockfile-only
pnpm list --depth 0
pnpm why react
```

`pnpm list`는 현재 프로젝트가 직접 보는 패키지이고, `pnpm why`는 특정 패키지가 그래프에 들어온 경로를 보여 준다. Maven의 `dependency:tree`를 읽던 감각과 거의 같다. 단, JS에서는 같은 이름의 여러 버전이 별도 노드로 존재할 수 있다는 차이를 계속 의식해야 한다.

### 다이아몬드 의존성과 여러 버전 공존

다음 그래프를 보자.

```text
app
├─ chart-widget ── lodash@^4.17.0
└─ legacy-grid ─── lodash@^3.10.0
```

Maven식 단일 classpath라면 lodash 버전을 하나로 골라야 한다. JS의 중첩 모델은 다르게 답한다.

```text
app/node_modules/chart-widget/node_modules/lodash   → 4.17.x
app/node_modules/legacy-grid/node_modules/lodash    → 3.10.x
```

각 패키지 내부에서 `import "lodash"`를 하면 Node의 해석 알고리즘은 **그 파일이 있는 디렉터리에서 위로 올라가며 `node_modules/lodash`를 찾는다.** 따라서 chart-widget은 4.x를 보고, legacy-grid는 3.x를 본다. 충돌을 해결한 것이 아니라 **충돌을 공간으로 분리**한 것이다.

이 설계는 호환성에 강하다. 오래된 패키지를 억지로 새 lodash에 맞추지 않아도 된다. 대신 번들에는 같은 라이브러리가 여러 벌 들어갈 수 있다. 패키지 관리 계층에서는 정당한 공존이지만, 브라우저 번들 계층에서는 다운로드·파싱 비용이 된다. 그래서 [6-2](./02-bundlers.md)의 번들 분석에서 "왜 lodash가 두 벌 들어왔는가"를 볼 때는 먼저 `pnpm why lodash`로 **설치 그래프에서 이미 두 버전인지** 확인해야 한다.

### 평탄화와 유령 의존성

npm 3 이후의 `node_modules`는 중복을 줄이기 위해 많은 패키지를 루트 쪽으로 끌어올린다. 이를 hoisting이라고 한다.

```text
app
├─ node_modules
│  ├─ app-dep
│  └─ left-pad       ← app-dep의 하위 의존성이 루트로 올라옴
└─ package.json      ← left-pad 직접 선언 없음
```

문제는 앱 코드에서도 다음 import가 동작할 수 있다는 점이다.

```js
// ❌ package.json에 선언하지 않았는데 우연히 동작한다
import leftPad from "left-pad";

console.log(leftPad("7", 3, "0"));
```

이 코드는 현재는 동작한다. 하지만 `left-pad`는 app의 계약이 아니다. app-dep가 다음 버전에서 의존성을 제거하거나, 설치기의 hoisting 결과가 달라지거나, 패키지 매니저를 바꾸면 즉시 깨진다. 이것이 유령 의존성이다. "돌아가는데 위험한" 이유는 런타임이 아니라 **선언과 실제 import 사이의 계약 불일치**에 있다.

탐지 방법은 두 겹이다.

```sh
pnpm list --depth 0
pnpm why left-pad
```

직접 import하는 모든 패키지는 `dependencies` 또는 `devDependencies`에 있어야 한다. 더 엄격하게는 ESLint의 `import/no-extraneous-dependencies` 같은 규칙으로 import와 manifest를 대조한다. pnpm은 기본 구조 자체가 이 문제를 줄인다.

### pnpm의 링크 구조

pnpm은 `node_modules`를 평평한 복사본 더미로 만들지 않는다. 패키지 파일은 content-addressable store에 한 번 저장되고, 프로젝트의 `node_modules/.pnpm`에는 그 파일로 향하는 hard link가 놓인다. 그 위에 symbolic link로 의존성 그래프가 조립된다.

단순화하면 이런 모양이다.

```text
node_modules
├─ react -> .pnpm/react@19.2.1/node_modules/react
└─ .pnpm
   ├─ react@19.2.1/node_modules/react -> <store>
   └─ react-dom@19.2.1_react@19.2.1/node_modules
      ├─ react-dom -> <store>
      └─ react -> ../../react@19.2.1/node_modules/react
```

직접 의존성만 루트 `node_modules`에 보이고, 하위 의존성은 그 패키지가 해석할 수 있는 위치에만 보인다. 그래서 다음 원칙이 구조적으로 강해진다.

```text
프로젝트가 import할 수 있는 것 = 프로젝트가 선언한 것
패키지가 import할 수 있는 것 = 그 패키지가 선언한 것
```

pnpm도 생태계 호환성을 위해 일부 hoisting을 기본으로 수행한다. 오래된 패키지 중에는 자기 dependency를 선언하지 않고 우연히 상위에서 찾는 코드가 있기 때문이다. 하지만 기본 철학은 npm/Yarn Classic의 완전 평탄화보다 엄격하다. 설치가 "더 까다롭게" 실패할 때가 있는데, 대개 그 실패는 실제 계약 누락을 일찍 보여 준다.

직접 열어 보면 모델이 선명해진다.

```sh
pnpm install
find node_modules/.pnpm -maxdepth 2 -type d | head
ls -l node_modules | head
pnpm store path
```

성능 이점도 여기서 나온다. 같은 버전의 패키지를 100개 프로젝트가 쓰면, npm식 복사는 100벌의 파일을 만든다. pnpm은 store에 한 번 저장하고 각 프로젝트에는 링크를 만든다. 설치 속도 주장은 감각으로 두지 말고 `pnpm install --reporter append-only`의 단계별 로그, CI 캐시 히트 여부, runner의 cold/warm install 시간을 기록해 비교한다.

### `peerDependencies`는 호스트 인스턴스 계약이다

일반 dependency는 "내가 실행되려면 이 패키지가 내 곁에 필요하다"는 뜻이다. peer dependency는 다르다. "나는 이 호스트 패키지와 함께 실행되어야 하고, 호스트의 인스턴스를 소비자와 공유해야 한다"는 뜻이다.

React 플러그인이나 컴포넌트 라이브러리가 대표 사례다.

```json
{
  "name": "my-design-system",
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

라이브러리가 React를 일반 dependency로 품고 배포하면 앱의 React와 라이브러리 내부 React가 두 벌이 될 수 있다. Hook은 한 React 인스턴스가 관리하는 dispatcher와 연결되어 있으므로, 두 인스턴스가 섞이면 "Invalid hook call" 같은 증상이 난다. peer dependency는 "React는 앱이 제공하고, 나는 그 버전 범위와 호환된다"는 계약을 package manager에 표현한다.

peer 충돌은 단순한 설치 경고가 아니다. 런타임 싱글턴을 공유해야 하는 패키지의 계약 충돌이다. 해결도 `--legacy-peer-deps` 같은 억제가 아니라 다음 중 하나여야 한다.

- 호스트 패키지 버전을 peer 범위에 맞춘다.
- 플러그인/라이브러리를 호스트 버전과 호환되는 버전으로 올린다.
- 실제로 peer 범위가 과도하게 좁은 경우에만 overrides나 packageExtensions로 근거를 남긴다.

## 실무 관점

### 선택지의 트레이드오프

| 선택 | 얻는 것 | 포기하는 것 | 무너지는 조건 |
|---|---|---|---|
| 느슨한 semver 범위(`^`) | 보안·버그 수정 반영이 쉽다 | lockfile 갱신 시 예기치 않은 동작 변화 | 라이브러리가 semver를 잘 지키지 않을 때 |
| 정확한 버전 고정 | drift가 적다 | 업데이트 비용, 보안 패치 누락 위험 | 수동 갱신 주기가 길어질 때 |
| npm/Yarn Classic 평탄화 | 중복 감소, 레거시 호환 | 유령 의존성, hoisting 결과 의존 | 선언 누락이 많은 코드베이스 |
| pnpm의 비평탄 구조 | 선언 누락 조기 발견, 디스크 절약 | symlink에 약한 도구와 충돌 가능 | 오래된 빌드 도구가 realpath를 잘못 처리할 때 |
| peer dependency | 싱글턴 호스트 공유 | 소비자 설치 제약 증가 | peer 범위를 과도하게 좁게 잡을 때 |

### 증상에서 계층으로 내려가기

| 증상 | 먼저 볼 계층 | 확인 명령/관찰 |
|---|---|---|
| 로컬은 되는데 CI 설치가 실패한다 | lockfile 재현성 | `pnpm install --frozen-lockfile`, lockfile 변경 여부 |
| import한 패키지가 package.json에 없다 | 유령 의존성 | `pnpm list --depth 0`, ESLint extraneous dependency 규칙 |
| 같은 라이브러리가 번들에 두 벌 들어간다 | 설치 그래프 중복 | `pnpm why <pkg>`, lockfile에서 버전 수 확인 |
| React Hook 오류가 난다 | peer/싱글턴 충돌 | `pnpm why react`, `react`와 `react-dom` 버전·경로 비교 |
| pnpm에서만 설치 또는 빌드가 깨진다 | undeclared dependency 또는 symlink 가정 | 실패 패키지의 package.json, `nodeLinker=hoisted` 임시 검증 |

### `dependencies`와 `devDependencies`의 실무 경계

브라우저 앱에서는 최종 번들에 들어가는 패키지와 개발 도구 패키지가 섞여 보이기 쉽다. 기준은 단순하다.

- 앱 런타임 코드에서 import하는 것은 `dependencies`다. React, 라우터, 상태 라이브러리, 날짜 포매터가 여기에 해당한다.
- 빌드·테스트·린트에서만 실행되는 것은 `devDependencies`다. Vite, Vitest, ESLint, Prettier, TypeScript가 여기에 해당한다.
- 라이브러리를 배포한다면 소비자가 직접 제공해야 하는 호스트는 `peerDependencies`다. React 기반 컴포넌트 라이브러리의 React가 대표적이다.

Vite 앱은 번들러가 `devDependencies`에 있는 플러그인을 빌드 시 실행할 수 있다. 그렇다고 그 플러그인이 브라우저 런타임 dependency가 되는 것은 아니다. "어느 프로세스에서 실행되는가"를 기준으로 분류한다.

## 더 깊이

### Node 해석 알고리즘과 symlink

Node의 CommonJS/ESM 해석은 specifier를 URL 또는 파일 경로로 바꾸는 과정이다. bare specifier(`"react"`)는 현재 파일에서 시작해 상위 디렉터리의 `node_modules`를 탐색한다. pnpm의 구조가 Node와 호환되는 이유는 이 탐색 규칙과 realpath 처리 위에 symlink를 배치하기 때문이다.

이 구현 세부에 의존한 코드를 작성해서는 안 된다. 예를 들어 `node_modules/.pnpm/...` 내부 경로를 직접 import하면 lockfile, peer 조합, pnpm 버전에 따라 깨질 수 있다. 패키지 경계는 `package.json`의 name과 exports가 정의하는 공개 인터페이스다. 내부 파일 import는 패키지 작성자가 허용한 subpath exports가 있을 때만 안전하다.

### Lockfile은 그래프의 스냅샷이다

lockfile을 "설치 속도 캐시"로 오해하면 충돌 시 지워 버리는 습관이 생긴다. lockfile은 캐시가 아니라 결정 결과다. 같은 `package.json`에서 새 결정을 계산하면 버전·peer 배치·dedupe 결과가 바뀔 수 있다. lockfile 삭제는 "의존성 그래프 전체를 다시 풀겠다"는 큰 변경이다.

리뷰에서 lockfile diff를 읽을 때는 세 가지를 본다.

- 직접 dependency 변경과 대응되는가.
- 같은 패키지의 버전 수가 늘었는가 줄었는가.
- peer suffix가 바뀌어 React/Vite/TypeScript 같은 호스트 조합이 달라졌는가.

lockfile diff가 크다고 나쁜 것은 아니다. 나쁜 것은 어떤 입력 변경이 그 큰 diff를 만들었는지 설명할 수 없는 상태다.

### Overrides는 응급 처치이지 설계 원칙이 아니다

`overrides`는 하위 의존성의 버전을 강제로 바꾸는 도구다. 보안 취약점 패치나 깨진 배포 우회에는 유용하다. 하지만 호환성 검증을 package manager 밖으로 밀어내는 선택이다. 하위 패키지가 실제로 그 버전과 호환되는지는 semver 범위가 아니라 사람이 책임져야 한다.

따라서 overrides를 쓰면 이유와 제거 조건을 남긴다.

```json
{
  "pnpm": {
    "overrides": {
      "some-transitive-lib": "2.3.4"
    }
  }
}
```

```md
<!-- 예: CVE-XXXX 패치. upstream package-a가 some-transitive-lib ^2.3.4를 허용하면 제거한다. -->
```

## 정리

- `package.json`은 사람이 선언한 버전 범위와 dependency 의도이고, lockfile은 설치기가 계산한 실제 그래프 결정이다.
- JS 패키지 관리는 같은 패키지의 여러 버전 공존을 허용한다. 호환성은 얻지만, 중복 설치와 번들 비용을 감수한다.
- 평탄화는 중복을 줄이지만 유령 의존성을 만든다. pnpm은 content-addressable store와 symlink 구조로 직접 선언한 것만 루트에서 보이게 해 계약 누락을 드러낸다.
- `peerDependencies`는 플러그인과 호스트가 런타임 인스턴스를 공유해야 한다는 계약이다. React 같은 싱글턴 계층에서는 설치 경고가 곧 런타임 위험이다.
- 설치 문제는 semver 범위, lockfile 재현성, hoisting, peer 해석 중 어느 계층의 문제인지 먼저 분류한다.

## 확인 문제

**Q1.** 앱 코드에서 `import clsx from "clsx"`가 동작한다. 그런데 `package.json`에는 `clsx`가 없고, `pnpm why clsx`를 보니 UI 라이브러리의 하위 의존성으로 들어와 있다. 이 코드는 왜 위험하며, 어떤 수정이 맞는가?

<details>
<summary>정답과 해설</summary>

유령 의존성이다. 현재 설치 레이아웃에서 UI 라이브러리의 하위 의존성이 우연히 앱에서 보이는 것뿐이고, 앱은 `clsx`를 직접 계약으로 선언하지 않았다. UI 라이브러리가 `clsx`를 제거하거나 버전을 바꾸거나 package manager의 hoisting 결과가 달라지면 앱 import가 깨진다. 앱 코드가 직접 import한다면 `dependencies`에 `clsx`를 추가한다. "어차피 하위에 있으니 그냥 둔다"는 것은 현재 디스크 레이아웃을 API로 착각한 것이다.
</details>

**Q2.** `pnpm why lodash`가 `lodash@3.10.1`과 `lodash@4.17.21` 두 버전을 보여 준다. 팀원이 "중복이니 lockfile을 지우고 다시 설치하자"고 한다. 먼저 확인해야 할 것은 무엇인가?

<details>
<summary>정답과 해설</summary>

중복이 항상 오류는 아니다. 먼저 각 버전을 요구하는 패키지와 semver 범위를 확인한다. 하나는 legacy 패키지가 `^3`을 요구하고, 다른 하나는 최신 패키지가 `^4`를 요구한다면 두 버전 공존은 설치 그래프의 정당한 결과다. lockfile 삭제는 같은 입력에서 새 결정을 계산하게 할 뿐이고, 호환되지 않는 범위를 하나로 합쳐 주지 않는다. 해결하려면 legacy 패키지를 업데이트하거나 대체해 lodash 4 범위로 수렴시켜야 한다. 이후 번들 비용은 6-2의 번들 분석으로 확인한다.
</details>

**Q3.** 컴포넌트 라이브러리를 만들면서 `react`를 `dependencies`에 넣어 배포했다. 소비 앱에서 "Invalid hook call"이 난다. 패키지 관리 관점에서 원인과 수정 방향을 설명하라.

<details>
<summary>정답과 해설</summary>

React가 앱과 라이브러리 내부에 두 인스턴스로 설치되었을 가능성이 높다. Hook dispatcher와 reconciler는 같은 React 인스턴스를 전제로 하므로, 컴포넌트 라이브러리가 자기 React를 품으면 앱의 React와 섞여 런타임 계약이 깨진다. 라이브러리의 `react`와 `react-dom`은 `peerDependencies`로 선언하고, 개발·테스트를 위해 같은 범위를 `devDependencies`에도 둔다. 소비 앱이 peer 범위를 만족하는 React를 제공해야 한다.
</details>

## 참고 자료

- [pnpm — Symlinked `node_modules` structure](https://pnpm.io/symlinked-node-modules-structure) — pnpm의 `.pnpm` 디렉터리, hard link, symlink 그래프가 Node 해석과 맞물리는 방식을 설명한다.
- [pnpm — Motivation](https://pnpm.io/motivation) — content-addressable store, 설치 단계, non-flat `node_modules`의 설계 배경을 확인할 수 있다.
- [npm Docs — package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) — dependency version range, `peerDependencies`, `overrides`의 공식 의미를 확인할 수 있다.
- [Node.js Docs — Modules](https://nodejs.org/api/modules.html) — CommonJS 기준의 `node_modules` 탐색과 패키지 해석 규칙을 확인할 수 있다.
