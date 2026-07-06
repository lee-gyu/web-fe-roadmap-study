# 10-4. 면접 준비

> 한 줄 요약: Phase 0~9에서 배운 동작 모델과 프로젝트 ADR을 바탕으로 기술 면접, 코드 리뷰형 면접, 프론트엔드 시스템 설계 질문에 근거 있게 답할 수 있다.

## 학습 목표

- 기술 질문에 표면 답변, 동작 모델, 설계 배경, 트레이드오프, 경계 조건, 검증 방법 순서로 답할 수 있다.
- Phase 0~9의 핵심 개념을 면접 질문 형태로 재구성하고 꼬리 질문에 대비할 수 있다.
- 프론트엔드 시스템 설계 질문에서 요구사항, 렌더링 전략, 데이터 흐름, 상태 소유권, 접근성, 성능, 보안, 배포를 순서 있게 좁힐 수 있다.
- 코드 리뷰형 면접에서 race condition, stale closure, 리렌더 비용, 타입 구멍, 접근성 누락, 보안 sink를 찾을 수 있다.
- 자신의 ADR과 포트폴리오 선택을 반박 가능하게 방어하고, 결정을 바꿀 조건을 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

경력직 프론트엔드 면접은 정의를 외운 사람보다 복잡한 제약에서 판단을 설명할 수 있는 사람을 찾는다. "이벤트 루프가 무엇인가"라는 질문도 단순 정의가 목적이 아니다. 비동기 작업, 렌더링, microtask, user interaction이 섞일 때 어떤 코드가 왜 멈추거나 늦어지는지 설명할 수 있는지를 본다. "SSR과 CSR의 차이"도 용어 암기가 아니라 TTFB, hydration, 캐시 가능성, 개인화, 서버 비용을 상황에 맞게 비교할 수 있는지를 본다.

면접 답변은 설계 리뷰와 비슷하다. 전제를 확인하고, 동작 모델을 세우고, 선택지를 비교하고, 실패 조건과 검증 방법을 말한다. Phase 10의 프로젝트 산출물은 이 답변의 근거가 된다. 자신이 쓴 ADR, 성능 로그, 코드 리뷰 기록, README의 한계를 면접 답변과 연결하면 추상 지식이 실제 판단으로 바뀐다.

## 핵심 개념

### 원리 기반 답변은 여섯 층으로 압축한다

기술 질문에 대한 답변은 다음 구조를 기본값으로 둔다.

```text
1. 표면 답변: 한 문장으로 결론을 말한다.
2. 동작 모델: 내부에서 어떤 단계가 일어나는지 설명한다.
3. 설계 배경: 왜 그런 추상화나 규칙이 생겼는지 말한다.
4. 트레이드오프: 얻는 것과 포기하는 것을 비교한다.
5. 경계 조건: 언제 이 설명이나 선택이 무너지는지 말한다.
6. 검증 방법: DevTools, 테스트, 스펙, 로그로 어떻게 확인할지 말한다.
```

예를 들어 "React에서 key가 왜 중요한가"라는 질문에 이렇게 답할 수 있다.

```md
표면 답변:
key는 같은 부모 아래의 children을 재조정할 때 React가 이전 fiber와 다음 element를 대응시키는 힌트다.

동작 모델:
React는 렌더 단계에서 새 element tree를 만들고 이전 tree와 비교한다.
같은 type과 key를 가진 항목은 같은 개념의 UI로 보고 상태를 보존할 수 있고,
key가 바뀌면 기존 항목을 버리고 새로 mount하는 쪽으로 간다.

설계 배경:
일반적인 tree diff는 비싸므로 React는 type과 key를 기준으로 O(n)에 가까운 휴리스틱을 사용한다.

트레이드오프:
안정적인 id를 key로 쓰면 reorder에서 상태가 보존된다.
index key는 정적 목록에서는 단순하지만 삽입·삭제·정렬이 있으면 잘못된 상태 보존을 만들 수 있다.

경계 조건:
key는 전역 id가 아니라 같은 부모의 sibling 사이에서만 의미가 있다.
또한 key가 있다고 DOM 이동 비용이 사라지는 것은 아니다.

검증 방법:
입력 값을 가진 목록을 reorder하는 예제를 만들고 React DevTools Profiler와 화면 상태 보존을 확인한다.
```

이 답변은 길어 보이지만 면접에서는 1~2분으로 압축할 수 있다. 꼬리 질문이 들어오면 각 층을 더 깊게 펼친다.

### Phase별 질문은 "왜"와 "언제 무너지는가"로 바꾼다

각 Phase의 지식을 면접 질문으로 바꾸면 다음과 같다.

| Phase | 핵심 질문 | 꼬리 질문 |
|---|---|---|
| 0 웹 플랫폼 | 주소창 입력 후 화면이 그려지기까지 어떤 계층을 거치는가 | 어느 단계가 느릴 때 DevTools 어디를 보는가 |
| 1 HTML/CSS | 작성한 HTML과 DOM이 달라질 수 있는 이유는 무엇인가 | 접근성 트리는 DOM과 어떻게 다를 수 있는가 |
| 2 HTTP | `GET`의 안전성과 멱등성이 캐시·재시도와 어떻게 연결되는가 | `POST`를 캐시하거나 재시도하면 어떤 조건이 필요한가 |
| 3 JavaScript | microtask가 rendering과 user input에 어떤 영향을 주는가 | 긴 microtask chain이 왜 문제인가 |
| 4 TypeScript | 구조적 타입 시스템이 편리한 대신 어떤 구멍을 만드는가 | `any`, type assertion, 외부 JSON 경계는 어떻게 다루는가 |
| 5 React | 렌더 단계와 커밋 단계가 분리된 이유는 무엇인가 | effect가 데이터 fetching에 항상 좋은 위치가 아닌 이유는 무엇인가 |
| 6 도구 | Vite 개발 서버와 production build의 파이프라인은 왜 다른가 | esbuild가 타입 검사를 하지 않는 것이 어떤 비용을 줄이는가 |
| 7 Git | rebase와 merge는 커밋 그래프를 어떻게 다르게 바꾸는가 | 공개 이력 재작성의 위험은 ref 관점에서 무엇인가 |
| 8 심화 | LCP가 나쁠 때 원인을 어떻게 네 구간으로 나누는가 | SSR이 LCP를 항상 개선하지 않는 이유는 무엇인가 |
| 9 설계 패턴 | 패턴 적용이 간접층을 정당화하는 조건은 무엇인가 | 언제 단순 함수나 명시적 분기가 더 나은가 |
| 10 프로젝트 | ADR은 왜 정답 문서가 아니라 변경 이력인가 | 어떤 조건에서 기존 결정을 바꿀 것인가 |

질문 목록을 많이 외우는 것보다 각 질문을 6층 답변 구조로 정리하는 편이 낫다. 답변이 막히는 층이 있으면 해당 Phase 문서로 돌아간다. 예를 들어 동작 모델은 말할 수 있지만 경계 조건을 말하지 못한다면 실무 판단으로 아직 연결되지 않은 것이다.

### 프론트엔드 시스템 설계는 제약을 좁히는 순서가 중요하다

시스템 설계형 질문은 "인스타그램을 만들어 보라"처럼 넓게 시작한다. 바로 라이브러리 이름을 말하면 위험하다. 먼저 요구사항을 좁힌다.

```text
1. 사용자와 핵심 작업
2. 기능 요구사항과 제외 범위
3. 비기능 요구사항: 성능, 접근성, 보안, 호환성, 운영
4. 렌더링 전략: CSR/SSR/SSG/ISR/RSC
5. 데이터 모델과 API 경계
6. 서버 상태 캐시와 mutation 전략
7. 클라이언트 상태와 URL 상태 소유권
8. 컴포넌트·route·서버/클라이언트 경계
9. 접근성 흐름
10. 성능 예산과 관찰 방법
11. 보안 위협 모델
12. 테스트·배포·관측 전략
```

예시 질문: "검색과 필터가 있는 상품 목록 페이지를 설계하라."

답변 초안:

```md
먼저 요구사항을 확인한다.
검색 결과 URL이 공유되어야 하는지, SEO가 중요한지, 데이터가 사용자별로 달라지는지,
필터 변경 시 즉시 반영해야 하는지, 결과 수가 어느 정도인지가 렌더링과 상태 설계를 바꾼다.

공개 상품 목록이고 검색 결과의 첫 화면 노출이 중요하다면 SSR 또는 RSC 기반 서버 데이터 접근을 고려한다.
하지만 필터 조합이 매우 많고 사용자별 가격이 달라 캐시 가능성이 낮다면 CSR + 서버 상태 캐시가 단순할 수 있다.

검색어와 필터는 URL 상태로 둔다. 그래야 공유, reload, 뒤로 가기가 재현된다.
상품 데이터는 서버 상태이므로 cache key를 `['products', query, filters]`처럼 구성하고,
장바구니 mutation 뒤에는 관련 count 또는 상품 상태만 무효화한다.

접근성은 검색 form, 필터 group, 결과 count, loading 상태, 빈 결과를 명시한다.
성능은 LCP 후보가 상품 이미지인지 텍스트인지 확인하고, 이미지 크기·우선순위·pagination 또는 virtualization을 본다.
보안은 검색어가 HTML sink로 들어가지 않는지, API 권한과 rate limit을 서버에서 강제하는지 확인한다.
```

이 답변은 아직 구현 세부가 적다. 하지만 면접관이 "SEO가 필요 없다면?", "결과가 10만 개라면?", "필터가 URL에 너무 길어지면?"이라고 물었을 때 선택을 바꿀 기준이 있다.

### 코드 리뷰형 면접은 실행 순서와 경계를 찾는다

다음 코드를 보자.

```tsx
import { useEffect, useState } from "react";

type Article = {
  id: string;
  title: string;
  bodyHtml: string;
};

export function ArticleList({ query }: { query: string }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/articles?q=${query}`)
      .then((response) => response.json() as Promise<Article[]>)
      .then(setArticles);
  }, [query]);

  const selected = articles.find((article) => article.id === selectedId);

  return (
    <section>
      <h2>Articles</h2>
      <div>
        {articles.map((article, index) => (
          <div key={index} onClick={() => setSelectedId(article.id)}>
            {article.title}
          </div>
        ))}
      </div>
      {selected ? (
        <article dangerouslySetInnerHTML={{ __html: selected.bodyHtml }} />
      ) : null}
    </section>
  );
}
```

면접에서 찾아야 할 위험은 여러 층에 있다.

| 위험 | 설명 | 수정 방향 |
|---|---|---|
| URL encoding 누락 | `query`가 그대로 URL에 들어간다 | `URLSearchParams` 또는 `encodeURIComponent` 사용 |
| 요청 race | 이전 요청이 늦게 끝나 최신 결과를 덮을 수 있다 | `AbortController` 또는 서버 상태 캐시 사용 |
| HTTP 오류 처리 없음 | 500 응답도 JSON으로 읽으려 한다 | `response.ok` 확인과 오류 상태 분리 |
| 타입 단언 | 외부 JSON을 `Article[]`로 믿는다 | runtime validation 또는 parser 추가 |
| index key | 정렬·삽입 시 선택 상태가 잘못 보존될 수 있다 | 안정적인 `article.id` 사용 |
| 접근성 누락 | clickable `div`는 button/list semantics가 없다 | `button`, `ul/li`, keyboard 동작 사용 |
| XSS sink | `bodyHtml`을 sanitizer 없이 삽입한다 | sanitizer allowlist, Trusted Types, raw HTML 경계 축소 |
| loading/empty/failure 없음 | 사용자 상태가 불명확하다 | 상태 모델을 명시한다 |

중요한 것은 모든 문제를 한꺼번에 고치는 코드를 외우는 것이 아니다. 어떤 계층의 문제인지 분리하고, 우선순위를 설명하는 것이다. 예를 들어 외부 HTML을 사용자에게 보여 주는 제품이라면 XSS sink가 최우선이다. 내부 admin 도구라도 접근성·race·오류 상태는 여전히 사용자 품질 문제다.

### 포트폴리오 방어는 선택하지 않은 대안을 설명하는 과정이다

면접관은 좋은 선택만 묻지 않는다. 오히려 "왜 Redux를 쓰지 않았는가", "왜 Next.js를 썼는가", "왜 e2e 테스트가 적은가"처럼 선택하지 않은 대안을 묻는다. 이때 답변은 방어적 변명이 아니라 조건부 판단이어야 한다.

```md
이 프로젝트에서는 서버 상태가 대부분이고 클라이언트 전역 상태는 dialog와 draft 정도였기 때문에 Redux를 쓰지 않았다.
검색 결과와 상세 데이터는 query cache가 stale time과 invalidation을 관리했고,
URL 상태는 search params로 두었다.

다만 undo/redo, 복잡한 optimistic update, 여러 feature가 공유하는 편집 세션이 생기면
외부 store를 재검토한다. 그 경우에도 서버 상태를 store에 복제하지 않고,
클라이언트 UI 상태와 편집 draft를 중심으로 둘 것이다.
```

이 답변은 "Redux가 나쁘다"가 아니다. 이 프로젝트의 상태 모델에서 비용이 이득보다 컸다고 말한다. 그리고 결정이 바뀌는 조건을 제시한다.

### 모르는 질문은 추측으로 메우지 않는다

경력직 면접에서 모르는 것을 인정하는 능력도 중요하다. 좋은 답변은 다음 구조를 가진다.

```md
정확한 스펙 조항은 지금 기억나지 않는다.
제가 이해한 모델은 A이고, 그래서 B처럼 동작할 것이라고 예상한다.
다만 이 부분은 브라우저 구현 차이가 있을 수 있으므로
WHATWG HTML spec과 MDN compatibility, Chrome/Firefox에서 작은 재현 예제로 확인하겠다.
```

모르는 것을 모른다고 말하되, 확인할 1차 자료와 실험 방법을 제시한다. 추측을 사실처럼 말하는 것이 더 위험하다. Phase 0~9에서 스펙과 DevTools를 기준으로 설명한 이유가 여기에 있다.

## 실무 관점

### 답변 길이는 질문의 신호에 맞춘다

면접 답변은 길수록 좋은 것이 아니다. 처음에는 30초 결론을 주고, 면접관의 반응에 따라 깊이를 조절한다.

| 상황 | 답변 전략 |
|---|---|
| 기본 개념 확인 | 표면 답변 + 동작 모델 한 단계 |
| 꼬리 질문 | 경계 조건 또는 설계 배경을 확장 |
| 시스템 설계 | 요구사항 질문으로 시작하고 선택지를 표처럼 비교 |
| 코드 리뷰 | 위험을 심각도 순으로 말하고 재현 방법을 덧붙임 |
| 프로젝트 방어 | 당시 제약, 선택하지 않은 대안, 재검토 조건을 말함 |

답변이 너무 넓어지면 면접관이 원하는 신호를 놓친다. "이 부분은 렌더링 비용과 보안 경계 두 축이 있는데, 먼저 렌더링부터 보겠다"처럼 범위를 선언하면 대화가 정리된다.

### 시스템 설계 답변은 다이어그램보다 상태와 경계가 먼저다

화이트보드나 공유 문서에 다이어그램을 그릴 때도 먼저 경계를 나눈다.

```text
Browser
  - URL state: query, filters, page
  - UI state: open dialog, selected tab
  - Server state cache: products, facets, cart count

Server/API
  - search endpoint
  - auth/session boundary
  - rate limit

External
  - product DB/search index
  - image CDN
```

이 경계가 있으면 이후 질문에 답하기 쉽다. "필터를 바꾸면 무엇이 invalidation되는가", "뒤로 가기는 어떤 상태를 복원하는가", "API key는 어디에 있는가", "이미지 CDN이 느리면 LCP에서 어디가 늘어나는가"가 경계 위에서 설명된다.

## 더 깊이

### 면접 답변은 압축된 ADR이다

좋은 답변은 작은 ADR과 닮았다.

```text
맥락: 어떤 문제와 제약인가
선택지: 어떤 대안이 있는가
결정: 이 상황에서는 무엇을 고르는가
결과: 무엇을 얻고 무엇을 포기하는가
재검토 조건: 언제 결정을 바꾸는가
검증: 어떤 증거로 확인하는가
```

따라서 프로젝트 준비와 면접 준비를 분리하지 않는다. 자신이 작성한 ADR마다 다음 질문을 붙인다.

- 이 결정을 30초로 설명하면 무엇인가
- 면접관이 반대 선택지를 주장하면 어떻게 답할 것인가
- 어떤 조건에서 이 결정을 바꿀 것인가
- 이 결정의 효과를 어떤 trace, test, PR 기록으로 보여 줄 것인가

ADR을 방어할 수 없다면 프로젝트를 다시 봐야 한다. 반대로 ADR을 잘 방어할 수 있으면 면접 질문은 실제 경험으로 돌아온다.

### 답변의 정확성은 신뢰 경계를 지키는 데서 나온다

기술 면접에서 자주 생기는 문제는 표준이 보장하는 동작과 구현 세부를 섞는 것이다. 예를 들어 "V8은 hidden class를 사용하므로 객체 속성 순서를 이렇게 최적화해야 한다"처럼 구현 세부에 의존한 조언은 위험하다. 표준이 보장하는 동작, 브라우저별 구현 차이, 현재 프로젝트에서 관찰한 결과를 구분해야 한다.

```md
스펙 수준에서는 JavaScript 객체 property 접근의 의미가 정의되어 있다.
hidden class는 V8의 최적화 구현 세부이므로 코드의 correctness를 거기에 의존하면 안 된다.
성능 문제가 의심되면 Chrome DevTools Performance와 engine trace를 통해 확인할 수 있지만,
일반 애플리케이션 코드에서는 데이터 구조와 렌더링 비용을 먼저 봐야 한다.
```

이런 구분이 경력자의 신뢰를 만든다.

## 정리

- 면접 답변은 표면 답변, 동작 모델, 설계 배경, 트레이드오프, 경계 조건, 검증 방법의 여섯 층으로 압축한다.
- Phase별 지식은 정의 암기가 아니라 "왜 그렇게 동작하는가"와 "언제 무너지는가" 질문으로 바꿔야 한다.
- 프론트엔드 시스템 설계는 요구사항과 비기능 제약을 먼저 좁힌 뒤 렌더링, 데이터, 상태, 접근성, 성능, 보안, 배포로 내려간다.
- 코드 리뷰형 면접은 실행 순서, 신뢰 경계, 상태 소유권, 접근성 트리, 보안 sink를 심각도 순으로 찾는다.
- 포트폴리오 방어는 선택하지 않은 대안이 더 나아지는 조건까지 설명하는 과정이다.

## 확인 문제

### 1. "SSR이 CSR보다 성능이 좋다"라는 답변의 문제는 무엇인가?

<details>
<summary>정답과 해설</summary>

조건이 빠진 단정이다. SSR은 초기 HTML을 더 빨리 제공할 수 있지만 TTFB, 서버 비용, 캐시 가능성, hydration 비용, 사용자별 개인화에 따라 성능 결과가 달라진다. 좋은 답변은 "초기 콘텐츠 노출과 SEO가 중요하고 HTML 캐시가 가능하면 SSR이 LCP에 유리할 수 있다. 그러나 hydration이 길거나 개인화 때문에 캐시가 어렵다면 CSR이나 정적 렌더링이 더 단순할 수 있다. DevTools에서 TTFB, LCP resource delay, hydration long task를 나눠 확인한다"처럼 조건과 검증 방법을 포함한다.

</details>

### 2. 코드 리뷰형 면접에서 `dangerouslySetInnerHTML`을 발견하면 어떤 순서로 질문하겠는가?

<details>
<summary>정답과 해설</summary>

먼저 HTML의 출처가 신뢰 가능한지 묻는다. 사용자 입력이나 외부 CMS라면 sanitizer allowlist가 있는지, URL scheme과 event handler attribute가 제거되는지, stored XSS 경로가 있는지 확인한다. raw HTML sink가 한 컴포넌트로 제한되어 있는지, CSP나 Trusted Types 같은 추가 방어층이 있는지도 본다. 단순히 "쓰면 안 된다"가 아니라 입력 경로, sink, 방어층, 검증 방법을 추적해야 한다.

</details>

### 3. 자신의 프로젝트에서 Zustand를 쓰지 않은 이유를 어떻게 답하겠는가?

<details>
<summary>정답과 해설</summary>

상태 모델을 기준으로 답해야 한다. 예를 들어 "서버 데이터는 TanStack Query가 소유하고, 검색어와 필터는 URL 상태로 두었으며, 클라이언트 UI 상태는 화면 지역 상태로 충분했다. 공유 편집 draft, undo/redo, 여러 feature가 동시에 갱신하는 클라이언트 상태가 생기면 외부 store를 재검토한다"처럼 선택하지 않은 대안이 더 나아지는 조건을 포함한다.

</details>

## 참고 자료

- [React — Render and Commit](https://react.dev/learn/render-and-commit): React 렌더링 질문의 동작 모델을 정리할 때 기준이 된다.
- [React — State as a Snapshot](https://react.dev/learn/state-as-a-snapshot): stale closure와 상태 스냅샷 질문에 답할 때 참고할 수 있다.
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html): 타입 시스템 질문을 공식 용어로 정리할 때 출발점으로 삼을 수 있다.
- [MDN — Populating the page: how browsers work](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work): 브라우저 파이프라인과 렌더링 질문을 설명할 때 참고할 수 있다.
- [Chrome DevTools — Performance panel](https://developer.chrome.com/docs/devtools/performance/overview): 성능 답변을 관찰 방법과 연결하는 데 쓴다.
- [OWASP Top 10](https://owasp.org/www-project-top-ten/): 보안 질문에서 대표 위험 범주를 빠르게 정리하는 데 쓴다.
