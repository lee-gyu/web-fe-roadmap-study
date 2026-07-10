# 5b-5. Progressive Hydration

> 한 줄 요약: progressive hydration은 서버 HTML의 활성화를 영역과 trigger로 나눠 초기 JavaScript·main-thread 비용을 뒤로 미루지만, 그 영역의 첫 사용 지연과 비활성 상태의 접근성 계약을 새로 만든다.

이 문서는 2026년 7월 11일에 확인한 React 19 계열의 `hydrateRoot`·Suspense 문서와 Web API를 기준으로 한다. React core에는 visibility·idle·interaction별로 임의 subtree를 hydrate하는 공개 API가 없다. 해당 trigger는 framework/island integration 책임이며, React의 built-in selective hydration은 [5b-8](./08-selective-hydration.md)에서 별도로 다룬다.

## 학습 목표

- server HTML completeness, JavaScript chunk boundary, hydration scheduling을 서로 다른 축으로 설명할 수 있다.
- immediate·visibility·idle·intent·interaction activation이 초기 비용과 first-use latency를 어떻게 교환하는지 판단할 수 있다.
- server HTML을 지연 hydrate하는 방식과 client-only mount를 콘텐츠·layout·접근성 계약으로 구분할 수 있다.
- 비활성 UI의 link·form·focus·keyboard 동작을 progressive enhancement 관점에서 설계할 수 있다.
- 초기 bytes·main-thread work·첫 처리된 입력을 함께 측정해 영역별 activation 전략을 선택할 수 있다.

## 배경: 왜 이것이 존재하는가

SSR은 HTML을 일찍 보여 주지만 interactive tree 전체의 code와 hydration이 한꺼번에 필요하면 browser의 초기 main thread가 길게 점유된다. 화면 아래 리뷰 chart, 열지 않을 chat, 무거운 추천 carousel까지 첫 화면의 navigation과 구매 form과 같은 우선순위로 활성화할 이유는 없다.

progressive hydration은 “모든 HTML을 지금 앱으로 만든다”를 영역별 질문으로 나눈다.

- 이 영역은 HTML만으로 지금 읽을 수 있어야 하는가?
- 첫 화면에서 즉시 조작될 가능성이 있는가?
- code를 언제 요청하고 hydration을 언제 시작할 것인가?
- 활성화 전 입력이 오면 native 동작, 대기, 재시도 중 무엇을 보장하는가?

초기 비용을 줄이는 대신 사용자가 처음 영역을 쓸 때 code load와 hydration을 지불할 수 있다. 따라서 lazy initialization처럼 총비용을 삭제하는 전략이 아니라 실제 사용 확률과 urgency에 맞춰 시점을 옮기는 전략이다.

## 핵심 개념

### progressive hydration은 여러 기법을 묶는 상위 분류다

| 기법 | activation 단위·시점 | 누가 주로 제공하는가 | 핵심 차이 |
|---|---|---|---|
| immediate hydration | root 전체를 즉시 연결 | React `hydrateRoot` | 단순하지만 초기 work가 큼 |
| trigger-based islands | 독립 root를 visibility/idle/interaction에 연결 | framework/island integration | root·manifest·event 계약 필요 |
| selective hydration | Suspense boundary의 준비 상태와 입력 priority로 순서를 조정 | React renderer + framework | application이 subtree마다 직접 호출하지 않음 |
| resumability 계열 | server 실행 상태를 직렬화해 재실행을 줄임 | 해당 framework | React hydration과 다른 runtime model |
| client-only lazy mount | HTML 없이 필요할 때 처음 mount | React + application/framework | server HTML 보존이 아님 |

뒤의 기법이 앞의 기법보다 항상 우월하지 않다. 작은 form 하나인 page는 immediate hydration이 가장 단순할 수 있다. 많은 독립 widget이 있는 content page는 island trigger가 맞을 수 있다. React streaming SSR app은 Suspense 기반 selective hydration을 활용할 수 있다.

### HTML, code, activation은 세 개의 독립 상태다

리뷰 widget 하나도 다음 상태를 거친다.

```text
HTML lane:       missing ───────▶ fallback HTML ───────▶ complete HTML
code lane:       undiscovered ──▶ requested ───────────▶ evaluated
activation lane: inactive ──────▶ scheduled/hydrating ─▶ active
```

complete HTML이 이미 보여도 code가 요청되지 않았을 수 있다. code가 browser cache에 있어도 main thread가 바빠 hydration이 끝나지 않을 수 있다. “화면에 있다”를 interactive의 proxy로 사용하면 첫 click 유실을 놓친다.

영역 상태는 사용자가 이해할 수 있게 표현한다.

```text
server-visible + native-operable
  → 향상 code가 없어도 link/form 핵심 동작 가능

server-visible + not-yet-enhanced
  → 비필수 animation/chart control은 준비 상태를 명확히 표시

client-only placeholder
  → 콘텐츠 자체가 없고 mount 뒤 처음 나타남
```

### trigger는 서로 다른 비용 교환이다

| trigger | 이점 | first-use 위험 | 적합 후보 |
|---|---|---|---|
| immediate | 입력 지연이 가장 예측 가능 | 초기 bytes/work가 집중됨 | header nav, 검색, 구매 form |
| visibility | 화면에 오기 전에 준비 가능 | 빠른 scroll에서 늦을 수 있음 | below-the-fold review/chart |
| idle | critical task 뒤 background 준비 | idle이 늦거나 전혀 없을 수 있음 | 낮은 urgency widget |
| hover/focus/pointer intent | 사용 의도와 가까움 | touch/keyboard 경로가 다름 | menu, detail popover |
| first interaction | 사용하지 않으면 비용 없음 | 첫 click에 code+hydration latency | chat, rare configurator |

hover만 trigger로 두면 keyboard focus와 touch를 놓친다. visibility threshold가 너무 늦으면 scroll 뒤 skeleton이 보이고, 너무 이르면 사실상 immediate loading이 된다. `requestIdleCallback` 같은 API의 지원·deadline과 framework fallback도 확인해야 한다.

### React core 밖의 activation adapter를 공개 계약으로 만든다

다음은 framework가 제공한다고 가정한 **의사 인터페이스**다. 독립 React API가 아니며 그대로 실행하는 예제가 아니다.

```tsx
// framework adapter가 server HTML, client manifest, root identity를 연결한다고 가정한다.
<DeferredHydration
  strategy="visible"
  fallback={<ReviewsStaticMarkup reviews={reviews} />}
>
  <InteractiveReviews reviews={reviews} />
</DeferredHydration>
```

adapter가 소유해야 할 계약은 이름보다 크다.

- server와 client가 동일한 root identity와 initial props를 사용한다.
- code URL과 props가 XSS-safe하게 직렬화된다.
- 여러 root의 `useId` prefix가 충돌하지 않는다.
- activation 전 발생한 event·focus·form value 처리 정책이 있다.
- navigation/unmount 때 observer, import, pending work를 취소한다.
- code load/hydration 실패를 읽을 수 있는 fallback으로 복구한다.

직접 `IntersectionObserver`를 붙여 임의 DOM subtree에 `hydrateRoot`를 호출한다고 이 계약이 자동으로 성립하지 않는다. server render도 처음부터 독립 roots와 asset manifest를 생성하도록 설계되어야 한다. 가능하면 검증된 framework integration을 사용한다.

### 관찰용 visibility trigger는 code 요청 시점을 드러낸다

다음 helper는 visibility event를 관찰하는 일반 Web API 예제다. hydration을 수행하지 않고 `activate` callback을 호출할 뿐이다.

```ts
export function activateWhenVisible(
  element: Element,
  activate: () => void,
): () => void {
  if (!("IntersectionObserver" in window)) {
    activate();
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        activate();
      }
    },
    { rootMargin: "200px" },
  );

  observer.observe(element);
  return () => observer.disconnect();
}
```

production adapter는 callback 안에서 framework의 supported activation primitive를 사용한다. fallback으로 immediate activation을 선택한 이유는 API 미지원 환경에서 기능이 영구히 비활성으로 남는 것보다 비용을 먼저 지불하는 편이 안전하기 때문이다.

### delayed hydration과 client-only mount는 다른 결과를 준다

| 비교 | delayed hydration | client-only mount |
|---|---|---|
| 최초 HTML | 실제 콘텐츠/controls 가능 | placeholder 또는 없음 |
| JavaScript 전 읽기 | 가능하도록 설계 가능 | 불가능 |
| layout 안정성 | 같은 geometry면 유리 | placeholder 크기 계약 필요 |
| server/client 동일성 | hydration 계약 필요 | 새 DOM mount이므로 불필요 |
| server 비용 | HTML render 비용 있음 | 해당 widget render 없음 |
| 적합 영역 | 리뷰·navigation·form 향상 | canvas, browser-only SDK, rare modal |

무거운 chart를 client-only로 바꾸고 이를 progressive hydration 개선이라 부르면 HTML completeness와 접근성 계약이 달라진 사실을 숨긴다. 두 variant를 별도 이름과 증거로 비교한다.

### progressive enhancement가 활성화 전 UX를 지탱한다

핵심 control은 가능한 경우 browser 기본 동작을 가진다.

```tsx
export function SearchForm({ initialQuery }: { initialQuery: string }) {
  return (
    <form action="/search" method="get">
      <label>
        검색어
        <input name="q" defaultValue={initialQuery} />
      </label>
      <button type="submit">검색</button>
    </form>
  );
}
```

hydration 뒤 client router가 제출을 가로채더라도 전에는 실제 GET navigation이 작동한다. activation 전에 input한 value를 hydration이 덮어쓰지 않는지, focus가 유지되는지 production build에서 검증한다. server와 client의 `defaultValue`가 다르거나 subtree를 버리고 mount하면 사용자의 입력이 사라질 수 있다.

다음 항목도 공개 UX 계약이다.

- tab order에 보이는 control은 실제로 작동하거나 준비 중임을 알린다.
- `aria-disabled`만 붙이고 click을 조용히 버리지 않는다.
- live region이 hydration chunk마다 과도하게 반복 낭독하지 않는다.
- fallback과 실제 content의 크기를 맞춰 layout shift를 줄인다.
- interaction activation이면 첫 event의 처리·재시도 정책을 정한다.

### 초기 최적화가 total bytes를 늘릴 수 있다

여러 island는 각 entry wrapper, manifest, runtime bookkeeping을 추가할 수 있다. shared dependency가 chunk마다 중복되거나 작은 request가 늘기도 한다. 영역을 잘게 쪼갤수록 무조건 좋은 것이 아니다.

```text
큰 root 하나
  → 초기 work 집중, shared runtime 단순

작은 root 여러 개
  → priority 제어 가능, wrapper/manifest/request/상태 동기화 증가
```

여러 island가 동일 cart state를 가져야 하면 cross-root store와 event protocol까지 필요하다. 상태 결합이 강한 영역은 한 activation unit이 더 단순하다.

## 실무 관점

### 영역을 urgency와 독립성으로 분류한다

| 영역 | 표시 urgency | interaction urgency | 독립성 | 기본 후보 |
|---|---:|---:|---:|---|
| global navigation | 높음 | 높음 | 낮음 | immediate/selective |
| 상품 설명 | 높음 | 낮음 | 높음 | server/static HTML, JS 없음 가능 |
| 리뷰 filter | 중간 | 중간 | 높음 | visibility |
| chat launcher | 낮음 | 낮음~의도 시 높음 | 높음 | intent/interaction |
| checkout form | 높음 | 높음 | 낮음 | immediate + native fallback |

“below the fold”만으로 delay를 결정하지 않는다. screen reader의 문서 순서, deep link anchor, keyboard tab, 사용자의 빠른 scroll도 고려한다.

### activation 실패와 navigation 취소를 상태로 둔다

```text
inactive
  → trigger
  → loading-code
  → hydrating
  → active

loading-code/hydrating
  ├─ navigation → cancelled/cleanup
  └─ error      → server HTML 유지 + retry/fallback
```

server HTML이 이미 읽을 수 있다면 activation error 때문에 내용을 제거하지 않는다. 다만 interactive인 것처럼 보이는 control을 그대로 두는 것도 위험하므로 영역별 disabled/retry/native action을 선택한다.

### 관찰 실험

동일 SSR HTML의 무거운 리뷰 widget을 세 variant로 만든다.

1. `immediate`: initial bootstrap에서 바로 code를 요청하고 활성화한다.
2. `visible`: viewport 200px 전에 framework activation을 시작한다.
3. `interaction`: 명시적 “리뷰 필터 사용” control에서 시작한다.

production build, 같은 browser/viewport/network/CPU에서 다음 marker를 기록한다.

```text
document_first_byte
reviews_html_inserted
reviews_code_requested
reviews_code_evaluated
reviews_hydration_start
reviews_hydration_end
reviews_first_intent
reviews_first_action_handled
```

initial JS resource/bytes, script task, first-use latency를 최소 세 번 비교한다. JavaScript 비활성화·느린 chunk·빠른 scroll·keyboard focus에서 HTML, form/link, focus/value가 유지되는지도 확인한다. client-only variant는 별도 열로 두어 HTML·layout 차이를 숨기지 않는다.

### 선택 체크리스트

- 영역의 HTML은 JavaScript 전에 읽거나 조작할 필요가 있는가?
- 첫 화면 표시 urgency와 interaction urgency가 같은가?
- activation unit이 data/state/error 면에서 독립적인가?
- visibility, keyboard focus, touch, deep link trigger를 모두 고려했는가?
- 첫 event를 처리·재생·재시도하는 framework 보장을 확인했는가?
- server HTML과 client-only placeholder를 같은 variant로 부르지 않았는가?
- 초기 JS/work 감소와 first-use latency·total requests를 함께 측정했는가?
- activation 실패·navigation 취소 뒤 HTML·focus·form value가 보존되는가?
- React core, framework adapter, browser API의 책임을 문서에서 분리했는가?

## 정리

- progressive hydration은 hydration을 여러 activation unit과 trigger로 나누는 상위 전략 계열이다.
- complete HTML, client code 준비, hydration 완료는 서로 다른 상태다.
- visibility·idle·intent·interaction trigger는 초기 비용을 first-use latency와 상태 복잡도로 교환한다.
- React core에는 임의 subtree의 trigger-based hydration API가 없으므로 framework/island integration의 root·manifest·event 계약을 확인한다.
- 비활성 상태의 native link/form, keyboard, focus, value, fallback geometry가 성능 전략의 일부다.

## 확인 문제

**Q1.** 리뷰 HTML은 이미 보이는데 filter button의 첫 click이 아무 반응 없이 사라졌다. 어떤 세 상태를 분리해 진단해야 하는가?

<details>
<summary>정답과 해설</summary>

리뷰 HTML의 도착/완성, client code의 요청·평가, hydration/activation 완료를 분리한다. interaction trigger adapter가 첫 event를 보존·재시도하는지 공식 계약을 확인하고, 보장이 없으면 명시적 activation control이나 native form fallback으로 첫 입력 유실을 막는다.
</details>

**Q2.** chart를 server HTML에서 제거하고 viewport 진입 때 `createRoot`로 mount했다. 왜 이를 delayed hydration과 같은 개선으로 기록하면 안 되는가?

<details>
<summary>정답과 해설</summary>

hydration은 기존 server HTML을 연결하지만 client-only mount는 콘텐츠 DOM을 그때 처음 만든다. no-JS 읽기, 검색, layout, server cost, mismatch 계약이 모두 달라진다. 두 variant의 HTML completeness와 first-use 결과를 별도 비교해야 한다.
</details>

**Q3.** 모든 widget을 작은 island로 나누면 항상 initial performance가 좋아지는가?

<details>
<summary>정답과 해설</summary>

아니다. entry wrapper·manifest·request·shared dependency 중복과 cross-root state 동기화가 늘 수 있다. interaction urgency와 독립성이 실제로 다른 영역만 분리하고 initial work, total bytes/requests, first-use latency, 운영 복잡도를 함께 측정한다.
</details>

## 참고 자료

- [React — `hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot) — server HTML 연결과 동일성·오류 계약을 확인한다. (2026-07-11 확인)
- [React — `<Suspense>`](https://react.dev/reference/react/Suspense) — streaming server rendering과 selective hydration이 Suspense에 통합된 현재 범위를 확인한다. (2026-07-11 확인)
- [MDN — Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) — viewport 교차를 관찰하는 browser API와 비동기 모델을 확인한다. (2026-07-11 확인)
- [MDN — Progressive enhancement](https://developer.mozilla.org/en-US/docs/Glossary/Progressive_Enhancement) — 기본 HTML 기능 위에 향상을 추가하는 설계 원칙을 확인한다. (2026-07-11 확인)
- [Patterns.dev — Progressive Hydration](https://www.patterns.dev/react/progressive-hydration/) — activation 전략의 문제 지형을 위한 2차 자료다. (2026-07-11 확인)

