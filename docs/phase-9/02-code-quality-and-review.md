# 9-2. 코드 품질과 리뷰

> 한 줄 요약: 코드 리뷰를 포맷·취향 검사가 아니라 정합성, 상태 경계, 렌더링 비용, 접근성, 보안, 변경 용이성을 검증하는 위험 탐지 과정으로 수행할 수 있다.

## 학습 목표

- 프론트엔드 코드 품질을 동작 정합성, 타입 경계, 상태 소유권, 접근성, 성능, 보안, 변경 용이성의 축으로 평가할 수 있다.
- PR 본문과 diff를 요구사항, ADR, 측정 증거와 연결해 리뷰 가능한 단위로 만들 수 있다.
- React 렌더링 전파, 서버 상태 캐시, 네트워크 요청, 접근성 트리, 보안 입력 경로를 리뷰에서 확인할 수 있다.
- feature-based 구조, layer-based 구조, 서버/클라이언트 컴포넌트 경계의 트레이드오프를 판단할 수 있다.
- 리팩터링을 public behavior 보존과 계측 가능한 개선으로 진행할 수 있다.

## 배경: 왜 이것이 존재하는가

컴파일러, 타입 검사기, 린터, 테스트 러너는 많은 결함을 줄인다. 하지만 사용자가 보는 문제는 도구 하나의 경계 안에서만 생기지 않는다. 타입은 맞지만 loading 상태가 없어 사용자는 빈 화면을 보고, lint는 통과했지만 버튼이 `div`라 키보드로 누를 수 없으며, 테스트는 통과했지만 서버 상태 캐시가 무효화되지 않아 오래된 데이터가 보인다. 코드 리뷰는 이 사이의 경계를 사람이 읽는 과정이다.

백엔드 리뷰에서 트랜잭션 경계, idempotency, 장애 복구, API 호환성을 보듯 프론트엔드 리뷰는 렌더링 비용, 접근성 트리, 브라우저 저장소, 캐시 무효화, 사용자 입력 지연, 보안 sink를 본다. "이름이 마음에 든다"보다 "이 변경이 어떤 실패 상태를 새로 만들거나 가릴 수 있는가"가 더 중요한 질문이다.

[9-1](./01-project-guide.md)에서 프로젝트 요구사항과 ADR을 먼저 만든 이유도 여기에 있다. 리뷰는 취향의 충돌을 줄이고 위험을 찾으려면 기준 문서가 필요하다. PR은 코드 조각이 아니라 요구사항, 결정, 검증 결과, 남은 리스크를 담은 변경 패키지다.

## 핵심 개념

### 품질은 읽기 쉬움보다 넓은 모델이다

읽기 쉬운 코드는 중요하지만 품질의 일부일 뿐이다. 프론트엔드 코드 품질은 다음 축을 함께 본다.

| 축 | 리뷰 질문 | 대표 증거 |
|---|---|---|
| 동작 정합성 | 요구사항의 성공·실패 상태를 모두 처리하는가 | 테스트, 수동 검증 절차, 스크린샷 |
| 타입 경계 | 외부 입력이 신뢰 가능한 도메인 타입으로 좁혀지는가 | schema validation, `unknown` 처리, exhaustiveness |
| 상태 소유권 | UI 상태, 서버 상태, URL 상태가 섞이지 않았는가 | state 위치, cache key, URL query |
| 렌더링 비용 | 변경이 불필요한 리렌더나 큰 bundle을 만드는가 | React Profiler, bundle analyzer |
| 접근성 | 이름·역할·상태와 키보드 흐름이 맞는가 | Accessibility tree, keyboard trace, axe/Lighthouse |
| 보안 | 신뢰하지 않은 입력이 위험한 sink로 들어가는가 | sanitizer, CSP, cookie 속성, secret scan |
| 변경 용이성 | 다음 요구사항이 들어왔을 때 변경 범위가 예측 가능한가 | 모듈 경계, 테스트 범위, ADR |

이 모델은 리뷰 대화를 바꾼다. "이 함수가 길다"는 취향에 가깝다. "이 함수가 API 응답 파싱, 캐시 갱신, toast 표시, route 이동을 모두 수행해 실패 상태 테스트가 어렵다"는 품질 주장이다. 같은 리팩터링 제안이라도 근거가 동작과 변경 비용에 연결되어야 한다.

### PR은 리뷰어가 위험을 재현할 수 있게 만든다

좋은 PR 본문은 diff를 읽기 전에 리뷰어의 탐색 경로를 만든다.

```md
## 문제
검색 결과에서 rate limit 응답이 일반 오류로 표시되어 사용자가 재시도 시점을 알 수 없었다.

## 변경
- 검색 API 응답을 `SearchResult | SearchRateLimited | SearchFailure`로 분리했다.
- rate limit 상태는 `Retry-After` 헤더를 읽어 별도 안내를 보여 준다.
- 검색 버튼은 pending 중 중복 제출을 막는다.

## 관련 문서
- 요구사항: `docs/requirements.md#검색-실패-상태`
- ADR-002: 서버 상태 캐시 정책

## 검증
- `pnpm typecheck`
- `pnpm test SearchForm`
- MSW로 429 응답을 재현하고 스크린샷 첨부
- 키보드로 검색 입력 → 실패 안내 → 재시도 버튼 이동 확인

## 남은 리스크
- 외부 API가 `Retry-After`를 생략하면 기본 30초를 사용한다.
```

이 본문은 리뷰어에게 무엇을 봐야 하는지 알려 준다. 타입 경계, 실패 상태, 접근성 흐름, 관련 ADR, 남은 리스크가 드러난다. 반대로 "검색 오류 처리 추가"만 쓰면 리뷰어는 diff 전체에서 의도를 추론해야 한다.

### 동작 리뷰는 happy path보다 경계 조건을 먼저 본다

프론트엔드 버그는 성공 경로보다 경계 조건에서 자주 드러난다.

| 경계 조건 | 리뷰 질문 |
|---|---|
| loading | 사용자가 이전 데이터와 새 요청 상태를 구분할 수 있는가 |
| empty | 빈 결과가 오류처럼 보이지 않는가 |
| failure | 네트워크 오류, HTTP 오류, 권한 오류, rate limit을 구분하는가 |
| retry | 재시도가 중복 요청과 race condition을 만들지 않는가 |
| permission | UI 숨김과 서버 권한 검사가 혼동되지 않는가 |
| stale data | mutation 뒤 캐시가 무효화되거나 갱신되는가 |
| slow device | 입력 handler와 렌더링이 INP를 악화시키지 않는가 |

다음 예시는 검색 요청 race condition을 만든다.

```tsx
import { useEffect, useState } from "react";

type Product = { id: string; name: string };

export function ProductSearch({ query }: { query: string }) {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    fetch(`/api/products?q=${encodeURIComponent(query)}`)
      .then((response) => response.json() as Promise<Product[]>)
      .then((data) => {
        // 늦게 끝난 이전 요청이 최신 검색 결과를 덮어쓸 수 있다.
        setProducts(data);
      });
  }, [query]);

  return (
    <ul>
      {products.map((product) => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}
```

개선 예시는 이전 요청을 취소한다.

```tsx
import { useEffect, useState } from "react";

type Product = { id: string; name: string };

export function ProductSearch({ query }: { query: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => {
    const controller = new AbortController();

    async function search() {
      setStatus("loading");

      try {
        const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Search failed: ${response.status}`);
        }

        setProducts((await response.json()) as Product[]);
        setStatus("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setStatus("error");
      }
    }

    search();

    return () => {
      controller.abort();
    };
  }, [query]);

  if (status === "loading") {
    return <p aria-live="polite">검색 중이다.</p>;
  }

  if (status === "error") {
    return <p role="alert">검색에 실패했다.</p>;
  }

  return (
    <ul>
      {products.map((product) => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}
```

리뷰에서 볼 지점은 "AbortController를 썼는가"만이 아니다. 취소된 요청이 오류 UI를 띄우지 않는지, loading이 접근성 트리에 전달되는지, 빈 결과와 실패가 구분되는지까지 본다.

### 타입 경계는 외부 입력이 내부 모델로 들어오는 문이다

TypeScript 타입은 런타임 데이터를 자동으로 검증하지 않는다. API 응답, URL query, localStorage, `postMessage`, form data는 외부 입력이다. 리뷰에서는 이 값이 어느 지점에서 검증되고 내부 도메인 타입으로 좁혀지는지 확인한다.

나쁜 예:

```ts
type User = {
  id: string;
  role: "admin" | "member";
};

export async function loadUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);

  // 타입 단언은 런타임 검증이 아니다. 서버 응답이 바뀌어도 컴파일러는 모른다.
  return response.json() as Promise<User>;
}
```

좋은 예:

```ts
type User = {
  id: string;
  role: "admin" | "member";
};

function parseUser(value: unknown): User {
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "role" in value &&
    typeof value.id === "string" &&
    (value.role === "admin" || value.role === "member")
  ) {
    return { id: value.id, role: value.role };
  }

  throw new Error("Invalid user response");
}

export async function loadUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);

  if (!response.ok) {
    throw new Error(`Failed to load user: ${response.status}`);
  }

  return parseUser(await response.json());
}
```

프로젝트 규모가 커지면 Zod, Valibot 같은 schema library를 사용할 수 있다. 그러나 리뷰 질문은 라이브러리 이름이 아니다. "신뢰 경계가 어디이고, 실패한 입력은 어떤 사용자 상태로 이어지는가"가 핵심이다.

### 상태 소유권은 데이터 정합성을 결정한다

프론트엔드 상태는 최소 세 종류로 나눠야 한다.

| 상태 | 소유자 | 예 | 리뷰 포인트 |
|---|---|---|---|
| 서버 상태 | 서버와 캐시 계층 | 상품, 사용자, 권한, 검색 결과 | stale time, cache key, invalidation |
| URL 상태 | 브라우저 history | 검색어, 필터, pagination | 공유 가능성, 뒤로 가기, 초기화 |
| UI 상태 | 현재 화면 인스턴스 | dialog open, hover, form draft | 불필요한 전역화, reset 조건 |

서버 상태를 전역 store에 복제하면 두 소스가 생긴다. mutation 뒤 서버 캐시와 store 중 하나만 갱신되어 오래된 UI가 남기 쉽다. 반대로 URL 상태를 지역 상태로만 두면 공유 URL과 뒤로 가기가 깨진다. 리뷰에서는 "이 상태의 진짜 소유자는 누구인가"를 먼저 묻는다.

```tsx
// 검색어는 공유 가능해야 하므로 URL 상태로 둔다.
const [searchParams, setSearchParams] = useSearchParams();
const query = searchParams.get("q") ?? "";

function submit(nextQuery: string) {
  setSearchParams({ q: nextQuery });
}
```

```tsx
// dialog open 여부는 화면 인스턴스의 UI 상태다.
const [isOpen, setIsOpen] = useState(false);
```

이 구분은 아키텍처 문서보다 리뷰에서 더 자주 드러난다. 상태 위치가 잘못되면 컴포넌트 구조, 테스트, URL, 캐시 무효화가 모두 흔들린다.

### 접근성 리뷰는 DOM 모양이 아니라 접근성 트리를 본다

접근성 리뷰는 "ARIA를 붙였는가"가 아니다. 사용자가 보조 기술과 키보드로 같은 작업을 수행할 수 있는지 확인한다.

나쁜 예:

```tsx
export function DeleteAction({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="danger" onClick={onDelete}>
      삭제
    </div>
  );
}
```

좋은 예:

```tsx
export function DeleteAction({ onDelete }: { onDelete: () => void }) {
  return (
    <button type="button" className="danger" onClick={onDelete}>
      삭제
    </button>
  );
}
```

첫 코드는 클릭 이벤트는 있지만 키보드 activation, button role, disabled semantics, focus behavior를 직접 구현해야 한다. 두 번째 코드는 브라우저의 native control이 이미 제공하는 동작 모델을 사용한다. 리뷰에서는 다음을 확인한다.

- interactive element가 키보드로 focus 가능한가
- 접근 가능한 이름(accessible name)이 시각적 label과 일치하는가
- 오류와 loading 상태가 `role="alert"` 또는 `aria-live` 등으로 적절히 전달되는가
- modal, popover, menu 같은 composite widget의 focus 이동과 escape 동작이 정의되어 있는가
- 색 대비와 hover-only 정보가 사용자를 배제하지 않는가

자동 도구는 시작점이다. Lighthouse나 axe가 잡는 문제는 중요하지만, 키보드 작업 완주와 실제 접근성 트리 확인을 대체하지 못한다.

### 보안 리뷰는 입력 경로와 sink를 추적한다

웹 보안 리뷰는 "이 화면에 로그인 기능이 있는가"보다 넓다. 신뢰하지 않은 입력이 실행 가능한 문맥으로 들어가는지, 비밀 값이 클라이언트 번들에 들어가는지, 쿠키와 CORS가 의도한 경계로 동작하는지 본다.

나쁜 예:

```tsx
export function MarkdownPreview({ html }: { html: string }) {
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
```

좋은 예:

```tsx
import DOMPurify from "dompurify";

export function MarkdownPreview({ rawHtml }: { rawHtml: string }) {
  const sanitized = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
  });

  return <article dangerouslySetInnerHTML={{ __html: sanitized }} />;
}
```

이 예시도 끝이 아니다. 리뷰에서는 sanitizer 정책, 허용 attribute, URL scheme, stored XSS 경로, CSP, Trusted Types 적용 가능성을 함께 본다. 보안 리뷰는 한 줄 수정으로 닫히지 않는 경우가 많으므로 관련 ADR이나 위험 로그로 이어져야 한다.

### 아키텍처 경계는 변경 비용을 조절한다

폴더 구조는 미학이 아니라 의존성 방향을 표현한다. 대표 선택지는 다음과 같다.

| 구조 | 장점 | 비용 | 맞는 상황 |
|---|---|---|---|
| layer-based | `components`, `hooks`, `api`처럼 기술 계층이 명확하다 | 기능 하나를 이해하려면 여러 폴더를 오간다 | 작은 앱, 공통 UI가 중심인 앱 |
| feature-based | 기능별 응집도가 높고 삭제·이동이 쉽다 | 공통 코드 추출 기준이 흔들릴 수 있다 | 여러 도메인 기능이 병렬로 커지는 앱 |
| hybrid | 공통 기반은 layer, 도메인은 feature로 나눈다 | 경계 규칙을 문서화하지 않으면 혼합물이 된다 | 대부분의 중간 규모 앱 |

예시:

```text
src/
  app/
  shared/
    ui/
    lib/
  features/
    search/
      api/
      components/
      model/
    watchlist/
      api/
      components/
      model/
```

리뷰에서 중요한 질문은 "이 파일이 어디에 있으면 예쁜가"가 아니다. "검색 기능을 제거하거나 서버 API를 바꿀 때 변경 범위가 예측 가능한가", "feature 내부 코드가 다른 feature의 내부 모델을 import하지 않는가", "shared로 올라간 코드가 실제로 두 군데 이상에서 같은 의미로 쓰이는가"를 본다.

Next.js App Router나 React Server Components를 쓰면 서버/클라이언트 경계도 아키텍처의 일부가 된다. `"use client"`가 붙은 파일은 import graph를 클라이언트 번들로 끌어들일 수 있으므로 리뷰에서 의존성 방향을 봐야 한다.

## 실무 관점

### 리뷰 코멘트는 위험, 근거, 제안으로 쓴다

리뷰 코멘트는 짧아도 구조가 있어야 한다.

```md
이 `useEffect`는 `query` 변경 시 이전 요청을 취소하지 않아서,
느린 응답이 최신 결과를 덮어쓸 수 있다.
`AbortController`를 사용하거나 서버 상태 캐시 라이브러리의 query cancellation에 맡기는 편이 좋다.
재현은 Network throttling을 Slow 3G로 두고 `a` → `ab`를 빠르게 입력하면 된다.
```

이 코멘트는 위험, 근거, 대안, 재현 방법을 담는다. 반대로 "여기 useEffect 이상한데요"는 리뷰어의 느낌만 남는다. 좋은 리뷰는 작성자를 설득하는 문장이 아니라 위험을 같이 확인하는 문장이다.

### 품질 gate는 빠른 것부터 배치한다

CI gate는 신뢰와 속도의 균형이다.

```yaml
name: quality

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with:
          version: 11.10.0
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test -- --run
      - run: pnpm build
```

실제 프로젝트에서는 `typecheck`, `lint`, unit/component test, build, e2e smoke, accessibility check, bundle budget, security scan을 단계적으로 둔다. 모든 검사를 모든 PR에서 돌리면 느려질 수 있다. 느린 e2e는 핵심 플로우 smoke만 PR에서 돌리고, 전체 회귀는 nightly나 main merge 뒤에 돌리는 식으로 조절한다.

| gate | 빨리 잡는 위험 | 경계 조건 |
|---|---|---|
| typecheck | 타입 경계 파손, API 계약 변경 | 런타임 검증은 별도 필요 |
| lint | 위험 패턴, hook 규칙 위반 | 과한 규칙은 noise가 된다 |
| unit/component test | 도메인 로직, UI 동작 회귀 | 구현 상세에 묶이면 리팩터링을 막는다 |
| e2e smoke | 주요 사용자 플로우 통합 실패 | flaky하면 gate 신뢰를 잃는다 |
| accessibility check | 명확한 a11y 위반 | 키보드 흐름과 보조 기술 차이는 수동 확인 필요 |
| performance budget | bundle·Lighthouse 회귀 | lab 조건이 실제 사용자를 대표하지 않을 수 있다 |

### 리팩터링은 동작 보존 증거가 있어야 한다

리팩터링(refactoring)은 외부 동작을 보존하면서 내부 구조를 바꾸는 작업이다. "더 깔끔해졌다"는 충분한 증거가 아니다.

리팩터링 PR에는 다음이 필요하다.

```md
## 변경 전 문제
- 검색 form이 URL 갱신, API 호출, analytics, toast를 모두 담당한다.
- 실패 상태 테스트가 form 내부 구현에 강하게 묶여 있다.

## 보존해야 할 동작
- Enter로 검색하면 URL query가 갱신된다.
- 빈 검색어는 제출되지 않는다.
- API 실패 시 기존 결과는 유지하고 오류 안내를 보여 준다.

## 변경
- URL 상태 갱신은 `useSearchQuery`로 분리했다.
- API 호출은 서버 상태 cache hook으로 이동했다.
- analytics는 submit event subscriber로 분리했다.

## 검증
- 기존 component test 통과
- 검색 수동 플로우 영상 첨부
- React Profiler에서 submit 후 commit 수 5 → 3
```

characterization test는 리팩터링 전에 현재 동작을 고정하는 테스트다. 레거시 코드가 이상해 보여도 사용자가 의존하는 동작일 수 있다. 먼저 현재 동작을 관찰 가능한 테스트로 고정한 뒤 구조를 바꾼다.

## 더 깊이

### 정적 분석과 런타임 관찰은 서로 다른 실패를 잡는다

TypeScript와 ESLint는 실행 전 구조를 본다. React Profiler, Chrome DevTools Performance, Network, Accessibility panel은 실행 중 결과를 본다. 코드 리뷰는 둘을 연결한다.

```text
정적 분석: 이 코드가 규칙과 타입 모델을 만족하는가?
런타임 관찰: 이 코드가 실제 브라우저에서 어떤 비용과 사용자 상태를 만드는가?
```

예를 들어 `useMemo`를 추가하면 lint와 typecheck는 통과한다. 하지만 React Profiler에서 commit 시간이 줄지 않거나 dependency 계산 비용이 더 커지면 품질 개선이 아니다. 반대로 bundle analyzer에서 큰 의존성이 route chunk에 들어간 것을 보면 코드 자체는 맞아도 사용자 비용이 증가한 것이다.

### flaky gate는 없는 gate보다 더 나쁠 수 있다

가끔 실패하는 테스트는 팀의 행동을 바꾼다. 처음에는 재실행하고, 나중에는 무시하고, 결국 required check를 우회하려 한다. flaky gate는 결함 탐지 장치가 아니라 배포 마찰이 된다.

완화 방법은 다음과 같다.

- 네트워크와 시간을 mock하거나 제어한다.
- e2e는 사용자에게 중요한 smoke flow로 줄인다.
- retry는 원인 분석 없이 숫자만 늘리지 않는다.
- 실패 시 screenshot, video, trace를 artifact로 남긴다.
- flaky로 판정된 테스트는 issue를 만들고 quarantine하거나 즉시 수정한다.

품질 gate도 제품 코드처럼 유지보수 대상이다. 느리고 믿을 수 없는 gate는 리뷰 품질을 높이지 못한다.

## 정리

- 코드 품질은 스타일보다 동작 정합성, 상태 소유권, 접근성, 성능, 보안, 변경 용이성을 포함하는 위험 모델이다.
- PR은 diff가 아니라 요구사항, ADR, 검증 결과, 남은 리스크를 담은 변경 패키지다.
- 리뷰는 happy path보다 loading, empty, failure, permission, stale data, slow device 같은 경계 조건을 먼저 본다.
- 아키텍처 경계는 폴더 이름이 아니라 의존성 방향과 변경 범위를 조절하는 규칙이다.
- 리팩터링은 public behavior 보존 증거와 계측 가능한 개선 없이는 취향 변경에 머문다.

## 확인 문제

### 1. 다음 리뷰 코멘트는 왜 약한가?

```md
이 컴포넌트가 좀 복잡해 보여서 hook으로 빼면 좋을 것 같습니다.
```

<details>
<summary>정답과 해설</summary>

위험과 근거가 없다. 어떤 동작이 검증하기 어려운지, 어떤 상태 소유권이 섞였는지, 어떤 변경 비용이 커지는지 설명하지 않으므로 취향처럼 들린다. "이 컴포넌트가 URL 상태와 서버 요청과 toast를 함께 처리해 실패 상태 테스트가 어렵다. URL query 갱신을 hook으로 분리하면 API 실패 테스트를 독립적으로 작성할 수 있다"처럼 위험과 제안을 연결해야 한다.

</details>

### 2. 서버 상태를 전역 store에 복제할 때 생기는 대표 위험은 무엇인가?

<details>
<summary>정답과 해설</summary>

서버와 클라이언트 store라는 두 소스가 생겨 정합성이 깨질 수 있다. mutation 뒤 서버 상태 캐시는 무효화되었지만 store는 갱신되지 않거나, 반대로 store만 낙관적으로 바뀌고 서버 실패 rollback이 빠질 수 있다. 서버 상태는 cache key, stale time, invalidation 정책을 가진 서버 상태 캐시 계층에서 관리하고, UI 상태와 URL 상태와 분리하는 편이 안전하다.

</details>

### 3. 리팩터링 PR에서 "테스트 통과" 외에 어떤 증거가 있으면 좋은가?

<details>
<summary>정답과 해설</summary>

변경 전 문제, 보존해야 할 public behavior, 변경 단위, 수동 검증 흐름, 성능 리팩터링이면 전후 trace나 Profiler 결과, 접근성 변경이면 키보드 흐름과 접근성 트리 확인 기록이 필요하다. 리팩터링의 목적이 변경 비용 감소라면 다음 요구사항이 들어왔을 때 변경 범위가 어떻게 줄었는지도 설명할 수 있어야 한다.

</details>

## 참고 자료

- [React — Render and Commit](https://react.dev/learn/render-and-commit): React 렌더링이 trigger, render, commit 단계로 나뉘는 모델을 리뷰 기준으로 삼을 수 있다.
- [React — Responding to Events](https://react.dev/learn/responding-to-events): 이벤트 handler, 전파, 기본 동작 방지, native element 사용의 접근성 함의를 확인할 수 있다.
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components): 서버/클라이언트 컴포넌트 경계가 모듈 그래프와 번들에 미치는 영향을 확인할 수 있다.
- [Chrome DevTools — Performance panel](https://developer.chrome.com/docs/devtools/performance/overview): 렌더링 비용과 Core Web Vitals를 trace로 확인하는 절차를 제공한다.
- [GitHub Docs — Building and testing Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs): Node.js 프로젝트의 CI gate를 GitHub Actions로 구성하는 기준을 확인할 수 있다.
- [MDN — Understanding WCAG](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG): 접근성 리뷰 기준을 WCAG 원칙과 연결할 수 있다.
