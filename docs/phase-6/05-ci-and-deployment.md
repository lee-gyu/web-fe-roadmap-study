# 6-5. CI와 배포

> 한 줄 요약: 이 문서를 읽고 나면 커밋에서 정적 사이트 배포까지의 파이프라인을 설치·검사·테스트·빌드·아티팩트·CDN 캐시 계층으로 나누어 설계하고, 배포 후 옛 화면이 뜨는 문제를 캐시 모델로 진단할 수 있다.

이 문서는 GitHub Actions와 GitHub Pages, Vite/VitePress 정적 배포, 그리고 [2-2 HTTP 캐싱](../phase-2/02-http-caching.md)의 캐시 모델을 기준으로 한다. 이 저장소의 실제 배포 workflow는 `.github/workflows/deploy-pages.yml`에 있으며, Node 24.14.0과 pnpm 11.10.0으로 VitePress 문서를 빌드해 Pages artifact로 배포한다.

## 학습 목표

- CI 파이프라인을 설치, 정적 검증, 테스트, 빌드, 배포 아티팩트 단계로 나누고 각 단계의 실패 의미를 설명할 수 있다.
- pnpm store와 lockfile 기반 캐싱이 어떤 입력이 바뀔 때 무효화되어야 하는지 판단할 수 있다.
- GitHub Pages 배포가 build artifact를 업로드하고 별도 deploy job에서 게시하는 모델임을 설명할 수 있다.
- content hash 파일명, HTML 재검증, immutable asset 캐시가 함께 정적 사이트 배포의 원자성을 만드는 방식을 설명할 수 있다.
- SPA fallback과 캐시 헤더가 어긋날 때 새로고침 404 또는 옛 화면 문제가 왜 생기는지 진단할 수 있다.

## 배경: 왜 이것이 존재하는가

CI/CD 자체는 프론트엔드 고유의 개념이 아니다. Jenkins, GitLab CI, GitHub Actions, Buildkite 모두 "변경이 들어오면 같은 절차를 깨끗한 환경에서 재현한다"는 목표를 가진다. 프론트엔드에서 고유한 것은 파이프라인의 산출물과 캐시 모델이다.

백엔드 배포는 보통 서버 프로세스 또는 컨테이너를 새 버전으로 교체한다. 프론트엔드 정적 사이트 배포는 다르다. 산출물은 `index.html`, `assets/index-<hash>.js`, `assets/style-<hash>.css`, 이미지 파일 같은 정적 파일이다. 이 파일들은 CDN edge에 퍼지고, 브라우저 HTTP 캐시에 남는다. 따라서 "배포했다"는 말은 단순히 파일을 올렸다는 뜻이 아니라 **HTML이 새 해시 asset을 가리키게 하고, CDN과 브라우저가 그 전환을 올바르게 관찰하게 했다**는 뜻이다.

Phase 6의 앞 문서들이 계산한 결과가 여기서 모두 실행된다.

- [6-1](./01-package-management.md): lockfile을 기준으로 동일한 의존성 그래프를 설치한다.
- [6-2](./02-bundlers.md): 모듈 그래프를 content hash가 붙은 정적 파일 그래프로 빌드한다.
- [6-3](./03-static-analysis.md): formatting/lint/typecheck로 실행 전 결함을 막는다.
- [6-4](./04-testing-strategy.md): 사용자 계약을 테스트로 검증한다.

CI는 이 도구들을 나열하는 YAML이 아니라, 각 계층의 계산 결과를 신뢰 가능한 순서로 묶는 파이프라인이다.

## 핵심 개념

### CI는 깨끗한 환경에서 같은 결정을 재현한다

로컬 개발 환경은 오염되어 있다. `node_modules`가 오래됐을 수 있고, 전역 도구가 끼어 있을 수 있으며, lockfile과 다른 패키지가 우연히 남아 있을 수 있다. CI runner는 매 실행마다 깨끗한 VM 또는 container에서 시작한다. 그래서 CI의 첫 질문은 다음이다.

```text
이 저장소만 보고 같은 의존성 그래프와 같은 산출물을 만들 수 있는가?
```

pnpm 프로젝트의 기본 설치 단계는 다음이다.

```yaml
- uses: pnpm/action-setup@v4
  with:
    version: 11.10.0

- uses: actions/setup-node@v6
  with:
    node-version: 24.14.0
    cache: pnpm

- run: pnpm install --frozen-lockfile
```

`--frozen-lockfile`은 `package.json`과 `pnpm-lock.yaml`이 맞지 않으면 새 결정을 계산하지 않고 실패한다. 이 실패는 귀찮은 설치 문제가 아니라 "저장소가 재현 가능한 상태가 아니다"라는 정확한 신호다.

이 저장소의 실제 Pages workflow도 같은 구조다.

```yaml
name: Deploy VitePress site to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with:
          version: 11.10.0
      - uses: actions/setup-node@v6
        with:
          node-version: 24.14.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm docs:build
      - uses: actions/upload-pages-artifact@v5
        with:
          path: docs/.vitepress/dist

  deploy:
    needs: build
    steps:
      - uses: actions/deploy-pages@v5
```

학습 프로젝트에서는 여기에 lint/typecheck/test 게이트가 추가된다.

### 게이트 순서는 빠른 실패와 원인 분리를 기준으로 한다

프론트엔드 프로젝트의 전형적인 CI 단계는 다음과 같다.

```text
checkout
  → setup toolchain
  → install --frozen-lockfile
  → format check
  → lint
  → typecheck
  → test
  → build
  → upload artifact
  → deploy
```

format check를 앞에 두는 이유는 빠르고 deterministic하기 때문이다. lint와 typecheck는 실행 전 결함을 잡는다. test는 런타임 계약을 검증한다. build는 실제 배포 산출물이 만들어지는지 확인한다. deploy는 main branch 또는 승인된 environment에서만 실행한다.

GitHub Actions에서는 독립 게이트를 병렬 job으로 나눌 수 있다.

```yaml
jobs:
  quality:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        command:
          - pnpm format:check
          - pnpm lint
          - pnpm typecheck
          - pnpm test -- --run
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with:
          version: 11.10.0
      - uses: actions/setup-node@v6
        with:
          node-version: 24.14.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: ${{ matrix.command }}

  build:
    needs: quality
    runs-on: ubuntu-latest
    steps:
      # 같은 setup/install 후 build
      - run: pnpm build
```

`fail-fast: false`는 하나의 게이트가 실패해도 다른 게이트 결과를 계속 얻기 위한 선택이다. PR 작성자는 format 실패와 test 실패를 한 번에 볼 수 있다. 반대로 매우 비싼 matrix에서는 빠른 실패가 나을 수 있다. 선택 기준은 feedback 완성도와 runner 비용의 트레이드오프다.

### 캐시는 산출물이 아니라 계산 중간물을 재사용한다

GitHub Actions cache는 key로 저장된 디렉터리를 복원한다. `actions/setup-node`의 `cache: pnpm`은 pnpm store 캐싱을 최소 설정으로 켜 준다. [6-1](./01-package-management.md)에서 본 것처럼 pnpm store는 content-addressable store라 캐시 친화적이다. 같은 패키지 파일은 같은 내용 주소를 가진다.

캐시의 핵심은 key다.

```text
cache key ≈ OS + package manager + lockfile hash
```

lockfile이 바뀌면 설치 그래프가 바뀌었을 수 있으므로 새 cache key가 필요하다. lockfile이 같으면 store를 재사용해 네트워크 fetch를 줄인다. cache는 `node_modules` 자체보다 pnpm store를 대상으로 하는 편이 안정적이다. `node_modules`는 symlink와 OS별 경로, Node/pnpm 버전의 영향을 더 받는다.

캐시 문제도 계층별로 읽는다.

| 증상 | 원인 후보 | 확인 |
|---|---|---|
| cache hit인데 설치가 느리다 | store는 복원됐지만 link 단계가 오래 걸림 | pnpm install 로그의 fetch/link 단계 |
| lockfile 바꿨는데 이전 dependency가 보인다 | 잘못된 cache key 또는 `node_modules` 캐시 | key에 lockfile hash 포함 여부 |
| fork PR에서 cache save가 안 된다 | 보안상 read-only cache scope | Actions 로그의 cache warning |
| cache가 커져 오히려 느리다 | 너무 넓은 path 캐싱 | cache size, restore time, eviction 확인 |

캐시는 빌드 정합성의 근거가 아니다. 캐시를 지워도 같은 결과가 나와야 한다. 캐시는 속도 최적화일 뿐이고, 정합성의 근거는 lockfile과 build script다.

### 배포는 artifact 전환이다

정적 배포에서 build job과 deploy job을 분리하는 이유는 책임이 다르기 때문이다.

```text
build job
  소스 + lockfile + 환경 변수
  → 정적 파일 디렉터리(dist)
  → artifact 업로드

deploy job
  검증된 artifact
  → hosting provider에 게시
  → deployment URL 산출
```

GitHub Pages의 `upload-pages-artifact`와 `deploy-pages`는 이 모델을 그대로 드러낸다. deploy job은 source checkout을 다시 빌드하지 않는다. build job이 만든 artifact를 게시한다. 이 구조는 "검증한 산출물과 배포한 산출물이 같다"는 속성을 만든다.

preview deployment도 같은 모델의 확장이다. PR이나 branch마다 고유 artifact를 만들고, 고유 URL에 매핑한다. Netlify, Vercel, Cloudflare Pages 같은 정적 호스트는 branch/PR preview를 기본 제공한다. 가치는 단순한 보기 링크가 아니다.

- 리뷰어가 실제 navigation, network, responsive UI를 확인한다.
- QA가 main 배포 전 artifact를 테스트한다.
- product/디자인 피드백이 code review 밖에서 가능해진다.
- artifact URL이 commit과 연결되어 회귀 추적이 쉬워진다.

단, preview에도 보안 경계가 있다. fork PR의 secret 접근, 외부 기여자의 arbitrary build script, cache poisoning을 분리해야 한다. public repo에서는 low-trust trigger가 어떤 권한을 갖는지 특히 조심한다.

### content hash는 캐시 무효화를 URL 문제로 바꾼다

Vite/VitePress 빌드는 asset 파일명에 content hash를 붙인다.

```text
dist/
├─ index.html
└─ assets/
   ├─ index-BT8x9a.js
   └─ style-DY2k3c.css
```

소스가 바뀌어 JS 내용이 바뀌면 파일명도 바뀐다.

```text
assets/index-BT8x9a.js  →  assets/index-Q4v1kz.js
```

이것은 캐시 무효화 문제를 "같은 URL의 내용이 바뀌었다"에서 "새 내용은 새 URL이다"로 바꾼다. 그러면 캐시 정책을 파일 종류별로 나눌 수 있다.

| 파일 | 권장 캐시 | 이유 |
|---|---|---|
| `index.html` | `Cache-Control: no-cache` | 매 방문 재검증해 새 asset URL을 발견해야 한다 |
| `assets/*-<hash>.js` | `Cache-Control: public, max-age=31536000, immutable` | 내용이 바뀌면 URL이 바뀌므로 장기 캐시 가능 |
| 이미지/font hash 파일 | immutable 장기 캐시 | JS/CSS와 같은 논리 |
| API 응답 | 도메인별 재검증 | 정적 asset과 다른 수명 모델 |

`no-cache`는 "캐시하지 말라"가 아니라 "사용 전 서버에 재검증하라"는 의미다. [2-2](../phase-2/02-http-caching.md)의 재검증 모델이 여기서 실전 적용된다. HTML은 항상 최신 pointer 역할을 해야 하고, hash asset은 한 번 받으면 오래 둬도 된다.

이 조합이 정적 배포의 원자성을 만든다.

```text
1. 새 hash asset 파일들을 업로드한다.
2. index.html을 새 hash asset을 가리키게 바꾼다.
3. 브라우저는 HTML을 재검증하고 새 URL을 발견한다.
4. 새 URL은 캐시에 없으므로 새 asset을 받는다.
5. 오래된 asset은 기존 HTML을 가진 탭을 위해 남아 있어도 된다.
```

문제는 보통 이 계약이 깨질 때 생긴다.

### SPA fallback과 HTML 캐시는 함께 설계해야 한다

[5-7](../phase-5/07-routing-and-code-splitting.md)에서 본 것처럼 SPA에서 `/products/42` 새로고침이 동작하려면 서버가 모르는 경로에 `index.html`을 반환해야 한다. 이를 SPA fallback이라고 한다.

```nginx
try_files $uri /index.html;
```

정적 호스트에서는 rewrites 설정으로 같은 일을 한다.

```json
{
  "hosting": {
    "public": "dist",
    "rewrites": [
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```

이 fallback 응답도 HTML이다. 따라서 asset처럼 immutable 장기 캐시하면 안 된다. `/products/42`로 받은 `index.html`이 오래 캐시되면, 사용자는 새 배포 후에도 옛 JS hash를 계속 가리키는 HTML을 받는다. "배포했는데 옛 화면이 뜬다"의 흔한 원인이다.

정리하면 SPA fallback의 캐시 정책은 root `index.html`과 같아야 한다. 모르는 route가 어떤 path로 들어와도, 그 응답은 "현재 앱 shell pointer"이기 때문이다.

## 실무 관점

### 파이프라인 설계표

| 단계 | 입력 | 산출물 | 실패 의미 | 관찰 지표 |
|---|---|---|---|---|
| install | `package.json`, lockfile | `node_modules`, store link | 재현 불가, lockfile 불일치 | install time, cache hit |
| format | source text | 통과/실패 | 출력 규칙 불일치 | 실패 파일 수 |
| lint | AST/scope/type 일부 | report | 정적 규칙 위반 | 일반/typed lint 시간 |
| typecheck | TS program | 통과/실패 | 타입 계약 위반 | `tsc --extendedDiagnostics` |
| test | module graph + DOM/env | test result | 사용자/로직 계약 위반 | 실패 test, duration |
| build | source + env | dist artifact | 배포 파일 생성 실패 | bundle size, chunk graph |
| deploy | artifact | URL | 게시 실패 | deployment status, cache headers |

이 표를 프로젝트별로 채우면 "CI가 느리다"라는 불만이 "typed lint가 70초", "install link 단계가 40초", "test worker startup이 30초"처럼 대응 가능한 문제로 바뀐다.

### 프론트 배포 사고 대응표

| 증상 | 의심 계층 | 확인 방법 | 대응 |
|---|---|---|---|
| 새로고침하면 404 | SPA fallback 없음 | 직접 `/route` URL 요청 | rewrite/fallback 설정 |
| 배포 후 일부 사용자가 옛 화면 | HTML 또는 fallback 장기 캐시 | DevTools Network의 `index.html` cache header | HTML `no-cache` |
| 새 HTML이 옛 JS를 가리켜 404 | 이전 asset 삭제가 너무 빠름 | HTML 안의 script src와 asset 존재 확인 | rolling window 동안 old assets 유지 |
| CSS/JS가 업데이트되지 않음 | hash 없는 asset 장기 캐시 | 파일명 hash 여부, cache header | content hash 활성화 |
| CI는 통과, 런타임 env만 깨짐 | build-time env 주입 누락 | artifact의 env string, Pages settings | 환경별 build 변수 검증 |
| fork PR에서 배포 secret 노출 위험 | trigger 권한 설계 문제 | workflow event, permissions | preview 권한 제한, environment protection |

### 배포 전후 검증

배포 검증은 "workflow 초록색"에서 끝나지 않는다. 정적 사이트는 HTTP 응답이 계약이다.

```sh
curl -I https://example.com/
curl -I https://example.com/assets/index-Q4v1kz.js
```

확인할 것:

- HTML 응답이 `no-cache` 또는 짧은 재검증 정책인지.
- hash asset이 긴 `max-age`와 `immutable`을 가지는지.
- SPA route(`/products/42`)가 200과 HTML을 반환하는지.
- asset MIME type이 올바른지.
- service worker가 있다면 별도 캐시가 HTML 정책을 덮어쓰지 않는지.

GitHub Pages는 헤더 제어가 제한적이므로, 세밀한 캐시 정책이 필요하면 Cloudflare Pages, Netlify, Vercel 같은 호스트나 CDN 앞단 설정을 검토한다. 이 선택은 "무료 Pages로 충분한 문서 사이트인가"와 "캐시·redirect·header를 제품 요구사항으로 제어해야 하는가"의 차이다.

## 더 깊이

### CI의 병렬화는 의존성 그래프 설계다

job 병렬화는 단순히 YAML을 나누는 일이 아니다. 어떤 job이 어떤 산출물을 신뢰하는가를 정하는 일이다.

```text
install
├─ lint
├─ typecheck
├─ test
└─ build
    └─ deploy
```

GitHub Actions는 job 간 파일 시스템을 공유하지 않는다. 각 job은 새 runner에서 시작하므로 install을 반복하거나, dependency cache와 artifact를 사용해야 한다. "한 job에서 install 한 번만 하고 다 돌리기"는 설치 중복이 없지만 병렬성이 낮다. "여러 job에서 각각 install"은 cache가 잘 맞으면 전체 wall-clock time이 줄지만 runner minutes를 더 쓴다.

선택은 팀의 feedback 목표로 한다.

- PR feedback을 3분 안에 받고 싶으면 병렬 job이 유리하다.
- 오픈소스에서 runner 비용이 민감하면 직렬 job이 나을 수 있다.
- deploy는 반드시 모든 gate 뒤에 둔다.

### 환경 변수는 빌드 입력이다

Vite 앱에서 `import.meta.env.VITE_API_URL` 같은 값은 대개 build time에 문자열로 주입된다. 따라서 같은 commit이라도 env가 다르면 artifact가 다르다. CI에서 build artifact를 만든 뒤 deploy job이 env를 바꿔도 이미 늦다. 환경별 artifact가 필요하면 환경별로 build해야 한다.

```text
commit + lockfile + build env → artifact
```

이 식을 명시하면 "staging artifact를 production에 그대로 올릴 수 있는가"라는 질문에도 답이 나온다. API URL 같은 build-time 값이 다르면 그대로 올릴 수 없다. runtime config를 별도 JSON으로 로드하는 설계를 택하면 artifact를 재사용할 수 있지만, 초기 요청과 캐시 정책이라는 비용을 새로 갖는다.

### Service Worker는 또 하나의 캐시 계층이다

PWA나 Workbox를 쓰면 브라우저 HTTP 캐시 위에 service worker cache가 생긴다. 그러면 content hash + HTML no-cache 모델만으로 충분하지 않을 수 있다. service worker가 옛 `index.html`을 cache-first로 돌려주면 배포 전환이 막힌다.

service worker가 있는 앱의 배포 진단 순서:

```text
1. DevTools Application > Service Workers에서 active worker 확인
2. Cache Storage에 index.html 또는 old asset이 있는지 확인
3. updatefound/skipWaiting/clientsClaim 전략 확인
4. HTML은 network-first 또는 stale-while-revalidate인지 확인
```

Phase 8의 브라우저·네트워크 심화에서 service worker와 성능 캐시를 더 깊게 다룬다. 여기서는 service worker가 있으면 "캐시 계층이 하나 더 있다"는 사실을 진단표에 추가하면 된다.

## 정리

- CI의 첫 책임은 깨끗한 환경에서 lockfile 기반 의존성 그래프와 산출물을 재현하는 것이다. `--frozen-lockfile` 실패는 재현성 실패다.
- format, lint, typecheck, test, build는 서로 다른 입력을 읽는 게이트다. 빠른 실패와 원인 분리를 기준으로 순서와 병렬화를 설계한다.
- cache는 속도 최적화일 뿐 정합성의 근거가 아니다. pnpm store cache key는 OS, package manager, lockfile hash를 중심으로 설계한다.
- 정적 배포는 build artifact를 hosting provider에 게시하는 전환이다. 검증한 artifact와 배포한 artifact가 같아야 한다.
- content hash asset은 immutable 장기 캐시, HTML과 SPA fallback은 재검증 캐시가 기본 조합이다. 옛 화면 문제는 대부분 이 계약의 파손에서 시작한다.

## 확인 문제

**Q1.** PR에서 `package.json`만 바꾸고 `pnpm-lock.yaml`을 갱신하지 않았다. CI의 `pnpm install --frozen-lockfile`이 실패했다. 이 실패를 "설치가 까다롭다"가 아니라 재현성 모델로 설명하라.

<details>
<summary>정답과 해설</summary>

`package.json`은 의도이고 lockfile은 설치기가 계산한 실제 결정이다. 의도가 바뀌었는데 결정 파일이 갱신되지 않았으므로, CI가 새 결정을 암묵적으로 계산하면 로컬과 다른 그래프가 생길 수 있다. `--frozen-lockfile`은 이런 상태를 실패시켜 "저장소만 보고 같은 의존성 그래프를 재현할 수 없다"고 알려 준다. 해결은 로컬에서 pnpm install로 lockfile을 갱신하고 diff를 리뷰하는 것이다.
</details>

**Q2.** 배포 후 일부 사용자가 계속 옛 화면을 본다. Network 패널을 보니 `/dashboard` 문서 응답이 `Cache-Control: public, max-age=31536000, immutable`이다. 왜 문제가 생겼고 어떻게 고치는가?

<details>
<summary>정답과 해설</summary>

`/dashboard`는 SPA fallback으로 반환된 `index.html`이다. HTML은 현재 asset hash를 가리키는 pointer이므로 매 방문 재검증되어야 한다. 그런데 hash asset처럼 immutable 장기 캐시가 붙어 브라우저가 옛 HTML을 계속 사용하고, 그 HTML은 옛 JS/CSS URL을 가리킨다. 해결은 root `index.html`뿐 아니라 모든 SPA fallback HTML 응답에 `no-cache` 또는 짧은 재검증 정책을 적용하고, hash가 붙은 asset에만 immutable 장기 캐시를 적용하는 것이다.
</details>

**Q3.** CI 시간을 줄이려고 `node_modules` 전체를 cache path로 넣었다. 처음엔 빨라졌지만 Node/pnpm 버전을 올린 뒤 이상한 모듈 해석 문제가 생겼다. 어떤 캐시 계층을 잘못 잡았는가?

<details>
<summary>정답과 해설</summary>

`node_modules`는 설치기의 산출 레이아웃이며 symlink, platform, Node/pnpm 버전, install 옵션의 영향을 받는다. 이를 통째로 캐싱하면 오래된 레이아웃이 새 도구 체인과 섞일 수 있다. pnpm에서는 content-addressable store를 캐시하고, 각 CI run에서 `pnpm install --frozen-lockfile`이 현재 환경에 맞는 link 구조를 재계산하게 두는 편이 안전하다. 캐시 key에는 lockfile hash와 도구 버전/OS가 반영되어야 한다.
</details>

## 참고 자료

- [GitHub Actions — Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) — cache key, hit/miss, setup actions, 보안 제한을 확인할 수 있다.
- [Vite — Deploying a Static Site](https://vite.dev/guide/static-deploy.html) — GitHub Pages, Netlify, Vercel, Cloudflare Pages 등 정적 배포 흐름과 preview deployment 모델을 확인할 수 있다.
- [Vite — Building for Production](https://vite.dev/guide/build.html) — Vite production bundle의 entry, browser target, static hosting 전제를 확인할 수 있다.
- [HTTP 캐싱](../phase-2/02-http-caching.md) — `no-cache`, 재검증, content hash asset 캐싱의 선행 모델이다.
- [라우팅과 코드 분할](../phase-5/07-routing-and-code-splitting.md) — SPA fallback과 route 단위 chunk가 배포 캐시와 만나는 전제다.
