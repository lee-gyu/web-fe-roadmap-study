# 5-5. 성능 모델

> 한 줄 요약: 이 문서를 읽고 나면 리렌더의 실제 비용 구조를 계산하고, memo/useMemo/useCallback의 편익이 성립하는 조건과 무너지는 조건을 판별하며, React DevTools Profiler로 진단-조치-재계측 루프를 돌릴 수 있다.

이 문서는 React 19 기준이다.

## 학습 목표

- "리렌더 = 성능 문제"라는 통념을 해체하고, 성능 문제가 되는 조건(전파 범위 × 서브트리 무게)을 계산할 수 있다.
- memo/useMemo/useCallback 각각의 정확한 동작과 셋의 관계를 설명하고, 메모이제이션이 무효화되는 조합을 코드에서 찾아낼 수 있다.
- 구조적 해법(상태 내리기, children 패턴)을 메모이제이션보다 먼저 검토하는 판단 순서를 적용할 수 있다.
- React DevTools Profiler로 커밋을 계측해 "무엇이 왜 렌더되었는가"를 추적하고, 개선 전/후를 수치로 비교할 수 있다.

## 배경: 왜 이것이 존재하는가

[5-2](./02-rendering-and-reconciliation.md)의 전파 규칙 — 부모가 렌더하면 자식도 렌더한다 — 을 배운 개발자의 자연스러운 반응은 "그럼 막아야 하는 것 아닌가"이고, 그 반응이 코드베이스 전체에 `memo`와 `useCallback`을 살포하는 관행을 낳았다. 이 관행은 두 번 틀렸다. 첫째, 대부분의 리렌더는 문제가 아니다 — 렌더는 계산이고, 변경이 없으면 커밋할 것도 없다. 둘째, 메모이제이션은 공짜가 아니다 — 비교 비용과 메모리를 항상 지불하는데, 조건이 하나라도 어긋나면 편익은 0이 된다.

백엔드 경험으로 옮기면 정확히 **캐시 도입 판단**이다. 느린 쿼리를 만났을 때 순서는 캐시가 아니라 쿼리 개선(인덱스, 조인 구조)이고, 캐시는 히트율을 측정할 수 있고 무효화 규칙이 명확할 때만 넣는다. 히트율 낮은 캐시는 순손실이다 — 조회마다 캐시 확인 비용을 내고 결국 미스로 원본까지 간다. React의 메모이제이션이 정확히 이 구조이고, 이 문서는 "히트율"에 해당하는 조건(props 참조 안정성)과 "쿼리 개선"에 해당하는 구조적 해법을 순서대로 세운다.

전제 하나를 명시하고 시작한다: **이 문서의 모든 판단은 계측을 전제로 한다.** "느린 것 같아서"는 조치의 근거가 아니다 — 근거는 Profiler의 커밋 기록이다.

## 핵심 개념

### 리렌더의 실제 비용 구조

상태 갱신 한 번의 비용을 분해하면:

```
비용 = Σ(전파 범위 안 컴포넌트의 함수 실행 + 요소 생성) + diff + 변경분의 커밋
```

- **함수 실행 + 요소 생성**: 대부분의 컴포넌트에서 마이크로초 단위다. JSX가 만드는 것은 플레인 객체([5-1](./01-react-mental-model.md))이고, 객체 할당은 싸다.
- **diff**: O(n) 휴리스틱([5-2](./02-rendering-and-reconciliation.md))으로, 전파 범위에 비례한다.
- **커밋**: 실제 DOM 변경 + 그에 따른 스타일·레이아웃·페인트. **여기가 비싸다** — 하지만 diff가 "변경 없음"으로 걸러낸 부분은 커밋되지 않는다.

따라서 "불필요한 리렌더"(결과가 같은데 렌더가 도는 것)의 비용은 앞의 두 항뿐이다. 컴포넌트 수십 개짜리 전파라면 측정조차 어려운 수준이고, 문제가 되는 것은 **곱이 커질 때**다: 갱신 빈도가 높고(타이핑, 스크롤 연동, 실시간 데이터) × 전파 범위가 넓고(트리 최상단의 상태) × 서브트리가 무겁다(수백 행 목록, 무거운 계산). 이 곱 구조가 진단의 틀이다 — 셋 중 어느 인수를 줄일 것인가가 조치의 선택지가 된다.

### 계측이 먼저 — React DevTools Profiler

React DevTools의 Profiler 탭은 **커밋 단위**로 기록한다(리렌더의 자연 단위가 커밋이므로). 절차:

1. 설정에서 "Record why each component rendered while profiling"을 켠다.
2. 녹화 시작 → 문제의 상호작용 수행(예: 검색창 타이핑) → 정지.
3. 커밋 막대(우상단)에서 오래 걸린 커밋을 고른다 — 막대 높이가 커밋 시간이다.
4. flame chart에서 색이 칠해진(렌더된) 컴포넌트를 본다. 각 컴포넌트를 클릭하면 "왜 렌더되었는가"(부모 렌더 / props 변경 — 어떤 prop인지 / 훅 상태 변경)가 나온다.
5. 회색(렌더 안 됨)과 칠해진 부분의 경계가 전파의 경계다 — 의도한 경계와 다르면 그 지점이 조치 대상이다.

진단 질문은 두 개다: **이 커밋은 정말 느린가**(수 ms짜리 커밋을 최적화하는 것은 시간 낭비), **느리다면 어느 인수 때문인가**(빈도인가, 범위인가, 무게인가). 조치 후에는 같은 상호작용을 다시 녹화해 전/후를 커밋 시간으로 비교한다 — 이 루프가 Phase 5 실습 과제의 리포트 형식이다.

### 구조적 해법 — 메모이제이션 이전의 두 수단

전파 범위를 줄이는 가장 싼 방법은 비교(memo)가 아니라 **애초에 전파가 닿지 않는 구조**다. [5-2](./02-rendering-and-reconciliation.md)에서 유도한 두 수단:

**① 상태 내리기(colocation).** 상태를 그것을 쓰는 최소 범위로 내린다.

```jsx
// ❌ 검색어 상태가 페이지 전체를 리렌더시킨다
function Page() {
  const [query, setQuery] = useState('');
  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <HeavyTable />   {/* 타이핑마다 렌더 */}
      <HeavySidebar /> {/* 타이핑마다 렌더 */}
    </>
  );
}

// ✅ 상태를 쓰는 범위로 내리면 전파도 그 안에 갇힌다
function Page() {
  return (
    <>
      <SearchBox />    {/* query 상태는 이 안에만 */}
      <HeavyTable />
      <HeavySidebar />
    </>
  );
}
```

**② children 패턴.** 상태를 내릴 수 없을 때(무거운 트리가 상태 보유 컴포넌트의 시각적 내부에 있어야 할 때), 무거운 부분을 children으로 받으면 같은 요소 참조가 유지되어 전파가 멈춘다.

```jsx
// ✅ Shell이 스크롤 상태로 아무리 리렌더돼도 children은 같은 참조 → 건너뜀
function ScrollShell({ children }) {
  const [scrolled, setScrolled] = useState(false);
  // ... 스크롤 상태에 따른 헤더 스타일 등
  return <div className={scrolled ? 'shadow' : ''}>{children}</div>;
}
// 사용: <ScrollShell><HeavyContent /></ScrollShell>
```

둘 다 비교 비용이 없고, 무효화될 조건도 없다 — 캐시가 아니라 쿼리 개선이다. Profiler에서 넓은 전파를 발견하면 항상 이 둘을 먼저 검토한다.

### 메모이제이션 3종 — 정확한 동작과 상호 의존

구조로 못 끊는 전파에 쓰는 도구가 메모이제이션이다. 셋의 역할이 다르다:

| 도구 | 캐시하는 것 | 생략하는 것 | 비교 방식 |
|---|---|---|---|
| `memo(Component)` | 직전 렌더 결과 | 컴포넌트의 렌더 | props 각 필드의 `Object.is` (얕은 비교) |
| `useMemo(fn, deps)` | 계산된 값 | 계산의 재실행 | deps 각 원소의 `Object.is` |
| `useCallback(fn, deps)` | 함수 참조 자체 | (생략 없음 — 참조 유지가 목적) | deps 각 원소의 `Object.is` |

핵심은 셋의 **의존 관계**다. memo의 얕은 비교는 참조형 prop이 하나라도 매 렌더 새로 만들어지면 항상 실패한다 — 그리고 렌더는 함수 재실행이므로([5-1](./01-react-mental-model.md)) 렌더 중 만든 객체·배열·함수·JSX는 전부 매번 새 참조다. 실측:

```jsx
const Row = memo(function Row({ label, onSelect }) {
  console.log('Row render:', label);
  return <li onClick={onSelect}>{label}</li>;
});

// ① 원시 props만: 부모 리렌더에도 Row 렌더 없음 — memo 동작 ✅
<Row label="고정" />

// ② 인라인 함수 prop: 매 렌더 새 참조 → memo 무력화 ❌
<Row label="고정" onSelect={() => select(id)} />
// 실측: 부모 렌더마다 "Row render: 고정" 다시 찍힘

// ③ useCallback으로 참조 고정 → memo 복원 ✅
const onSelect = useCallback(() => select(id), [id]);
<Row label="고정" onSelect={onSelect} />
// 실측: 부모 리렌더에도 Row 렌더 없음
```

즉 **useCallback/useMemo의 주 용도는 memo(또는 의존성 배열)의 보조**다. 받는 쪽에 memo가 없거나 다른 prop이 이미 매번 새 참조라면, useCallback은 캐시 관리 비용만 내는 장식이다. 이 의존 구조를 모르고 셋을 따로 뿌리는 것이 "메모이제이션했는데 효과가 없다"의 주 원인이다.

useMemo의 두 번째 용도는 받는 쪽과 무관하게 **계산 자체가 비쌀 때**다(수만 행 정렬·집계). 기준이 필요하면 계산을 `console.time`이나 Performance 패널로 재 보라 — 1ms 미만의 계산을 useMemo로 감싸는 것은 캐시 확인 비용이 계산 비용과 맞먹는 지점이다.

### 메모이제이션이 역효과인 경우

메모이제이션의 비용은 셋이다: 매 렌더의 비교 비용, 직전 값을 붙드는 메모리(GC 지연 — [3-10](../phase-3/10-memory-and-storage.md)), 그리고 가장 비싼 **코드의 복잡도**(의존성 배열 관리, 참조 안정성이라는 비국소적 계약 — prop 하나 추가가 먼 컴포넌트의 memo를 조용히 무력화한다).

편익이 0이 되는 조합의 체크리스트:

- memo 컴포넌트에 매 렌더 새 참조인 prop이 하나라도 있다(인라인 객체/함수/JSX children).
- props가 사실상 매번 실제로 바뀐다(예: 타이핑 중인 `value`) — 히트율 0인 캐시.
- 컴포넌트가 워낙 싸서 렌더 비용 ≈ 비교 비용이다.
- useMemo/useCallback의 deps가 매 렌더 바뀐다(deps에 렌더마다 새로 만드는 객체).

이 상태의 메모이제이션은 "비용만 내는 캐시"이므로 제거가 개선이다. 반대로 편익이 성립하는 전형은: 갱신 빈도 높은 상태 옆의 무거운 서브트리 + 원시값(또는 참조 고정된) props — 예컨대 타이핑마다 리렌더되는 폼 옆의 500행 테이블에 memo 하나.

### React Compiler — 이 판단의 자동화

이 문서의 memo/useCallback 판단이 기계적이라고 느꼈다면 맞다 — 그래서 React 팀은 이를 컴파일러로 자동화했다. React Compiler(React 19와 함께 정식화된 빌드 타임 도구)는 컴포넌트 코드를 분석해 렌더 간 보존 가능한 값(요소, 객체, 함수)을 자동으로 캐시하는 코드를 생성한다. 수동 memo/useMemo/useCallback의 대부분이 불필요해지는 방향이다.

단, 컴파일러가 대체하는 것은 **메모이제이션 판단**이지 이 문서 전체가 아니다. 상태의 위치(내리기), 트리 구조(children), 상태 분류([5-6](./06-state-architecture.md)) 같은 구조 설계는 여전히 사람의 일이고, 컴파일러의 분석은 컴포넌트가 규칙(순수성, 훅 규칙)을 지킬 때만 안전하다 — [5-1](./01-react-mental-model.md)의 전제가 다시 등장한다. 계측-진단 루프도 그대로 남는다: 컴파일러가 있어도 "왜 느린가"는 Profiler가 답한다.

## 실무 관점

### 성능 작업의 판단 순서

1. **계측**: Profiler로 문제 커밋을 특정한다. 사용자가 못 느끼는 것은 문제가 아니다(상호작용 응답 100ms 안팎이 체감 기준 — 정확한 지표는 7-3의 INP).
2. **원인 분해**: 빈도 × 범위 × 무게 중 어느 인수인가.
3. **구조 검토**: 상태 내리기, children 패턴, 상태 분류 재검토([5-6](./06-state-architecture.md)) — 비용 없는 해법 먼저.
4. **메모이제이션**: 구조로 못 끊는 지점에, 참조 안정성 계약을 지킬 수 있을 때만.
5. **재계측**: 같은 시나리오의 전/후 커밋 시간 비교. 개선이 없으면 되돌린다.

이 순서를 건너뛰고 4번부터 하는 것이 안티패턴의 정체다: 계측 없이(1 생략) 원인 모른 채(2 생략) 구조는 그대로 두고(3 생략) 전부 감싼다.

### "일단 다 감싸면 손해는 없지 않나"에 대한 답

손해가 있다. 측정 가능한 손해(비교·메모리)는 작지만, 코드 손해가 크다: 의존성 배열이 늘어나며 stale 버그 표면이 넓어지고([5-4](./04-effects.md)), "이 useCallback을 지워도 되는가"를 아무도 판단 못 하는 코드가 되고, 참조 안정성이 필요한 곳과 아닌 곳의 구분이 사라져 정말 필요한 memo가 리팩터링에서 조용히 깨져도 알아채지 못한다. 캐시는 무효화 규칙을 아는 사람이 있을 때만 자산이다.

### 목록이 무거울 때 — 메모이제이션의 한계선

1,000행 테이블에서 행마다 memo를 붙여도, 전부 화면에 있으면 최초 렌더와 커밋(DOM 1,000행)은 그대로 비싸다. 이 지점은 리렌더 최적화의 문제가 아니라 **DOM 양의 문제**이고, 해법은 보이는 부분만 렌더하는 가상화(windowing — react-window 등)다. Profiler에서 "렌더는 빠른데 커밋이 느리다"거나 최초 마운트 자체가 느리면 이 경계를 의심한다.

## 더 깊이

### memo는 힌트다 — bailout의 실제 조건

`memo`가 렌더를 생략하는 것은 보장이 아니다. React는 props가 얕게 같아도 컴포넌트 자신의 상태·context가 바뀌면 렌더하고, 반대로 memo 없이도 같은 요소 참조면 건너뛴다([5-2](./02-rendering-and-reconciliation.md)의 children 패턴이 그 경로다). 구현 수준에서 재조정은 각 Fiber에서 "이전과 같은 props 참조인가, 갱신이 예약돼 있는가" 등을 보고 bailout(서브트리 건너뛰기)을 결정하며, memo는 그 판정에 "얕은 비교 통과도 같음으로 쳐라"를 추가하는 래퍼 타입이다. 시맨틱 보장은 "결과가 같다"이지 "렌더 횟수가 정확히 줄어든다"가 아니므로, React는 필요하면(디버깅, 내부 사정) 메모된 컴포넌트도 렌더할 수 있다고 문서화한다 — 렌더 횟수에 의존하는 코드를 쓰면 안 되는 또 하나의 이유다.

### useMemo의 캐시는 슬롯 하나다

`useMemo`는 LRU 캐시가 아니라 **직전 값 하나**만 기억한다(훅 슬롯 — [5-3](./03-state-and-batching.md) — 에 [deps, value] 한 쌍). deps가 A → B → A로 오가면 매번 재계산이다. 또한 React는 메모이제이션을 시맨틱 보장이 아니라 성능 힌트로 취급하므로, 이론상 캐시를 버릴 수 있다(공식 문서 명시). 따라서 useMemo는 "정확성을 위한 도구"(한 번만 실행돼야 하는 부수 효과 등)로 쓰면 안 된다 — 그 용도는 useEffect나 useRef의 일이다.

### 갱신 빈도 자체를 낮추는 축 — transition과 deferred value

빈도 × 범위 × 무게에서 이 문서는 범위·무게를 다뤘지만, 빈도 축의 도구도 있다. `startTransition`/`useDeferredValue`는 갱신을 낮은 우선순위로 표시해, 급한 갱신(타이핑 반영)을 먼저 커밋하고 무거운 갱신(결과 목록)은 밀린 렌더로 처리한다 — 밀린 렌더 중 새 입력이 오면 폐기하고 다시 시작하므로([5-2](./02-rendering-and-reconciliation.md)의 동시성 렌더링) 사실상 렌더 수준의 디바운스가 된다. 총 작업량을 줄이지는 않고 **체감 응답성**을 사는 도구라는 점에서 메모이제이션과 직교하며, "타이핑이 버벅인다"류 문제에서 memo보다 먼저 검토할 가치가 있다.

## 정리

- 리렌더 비용 = 빈도 × 전파 범위 × 서브트리 무게의 곱 구조다. 대부분의 리렌더는 싸고, 커밋은 diff가 걸러낸다 — 문제는 곱이 커지는 지점에만 있고, 그 판정은 Profiler 계측으로 한다.
- 전파를 끊는 1순위는 구조다: 상태 내리기(colocation)와 children 패턴은 비교 비용도 무효화 조건도 없다.
- memo는 props 얕은 비교로 렌더를 생략하고, useMemo/useCallback은 참조를 고정해 memo와 의존성 배열을 보조한다 — 매 렌더 새 참조인 prop 하나가 이 전부를 무력화한다.
- 메모이제이션의 비용은 비교·메모리보다 코드 복잡도(참조 안정성이라는 비국소적 계약)가 크다. 히트율이 성립할 때만 도입하고, 효과 없는 것은 제거가 개선이다.
- React Compiler는 메모이제이션 판단을 자동화하지만, 구조 설계(상태 위치, 트리 구성)와 계측-진단 루프는 남는다.

## 확인 문제

**Q1.** 다음 코드는 `Row`를 memo로 감쌌는데 Profiler를 보니 타이핑마다 1,000개 행이 전부 렌더된다. 무력화 지점 **두 곳**을 찾고 수정하라. 그리고 수정보다 더 나은 구조적 해법이 있는지 검토하라.

```jsx
function ProductPage({ products }) {
  const [query, setQuery] = useState('');
  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <ul>
        {products.map(p => (
          <Row key={p.id} product={{ ...p, currency: 'KRW' }} onBuy={() => buy(p.id)} />
        ))}
      </ul>
    </div>
  );
}
```

<details>
<summary>정답과 해설</summary>

무력화 지점: ① <code v-pre>product={{ ...p, currency: 'KRW' }}</code> — 매 렌더 새 객체라 얕은 비교가 항상 실패한다. ② `onBuy={() => buy(p.id)}` — 매 렌더 새 함수. 둘 중 하나만 있어도 memo는 무효다.

지점 수정: currency를 밖으로 빼서 `product={p}`(products 배열의 원소는 참조가 안정적이라는 전제)로 넘기고 `currency="KRW"`는 원시값 prop으로 분리. `onBuy`는 `p.id`만 넘기고(`onBuy={buy}` + Row 내부에서 `onBuy(product.id)` 호출) 함수 자체는 모듈 수준이나 useCallback으로 고정한다.

더 나은 구조: 이 리렌더의 원인은 `query` 상태가 목록과 같은 컴포넌트에 있다는 것이다. 검색어가 목록 필터링에 쓰이지 않는다면 `<SearchBox />`로 상태를 내리면 memo 없이도 목록에 전파가 안 닿는다. 필터링에 쓰인다면 전파는 정당하므로, 그때는 `useDeferredValue(query)`로 목록 갱신의 우선순위를 낮추는 것과 행 memo(참조 안정화 포함)가 조합 대상이다. 어느 쪽이든 조치 후 Profiler로 재계측해 확인한다.
</details>

**Q2.** 동료가 "우리 팀 컨벤션으로 모든 컴포넌트를 memo로, 모든 함수를 useCallback으로 감싸자. 손해 볼 것 없지 않냐"고 제안한다. 이 문서의 근거로 반론을 구성하라. 단, React Compiler 도입 검토라는 대안도 포함하라.

<details>
<summary>정답과 해설</summary>

반론의 골자: ① 편익이 조건부다 — memo는 모든 props가 참조 안정일 때만 동작하는데, 전면 적용 코드베이스에서 그 계약을 전 컴포넌트에 유지하는 것은 비현실적이고, 계약이 깨진 memo는 비교 비용만 내는 장식이다. ② 비용은 무조건부다 — 렌더마다의 얕은 비교, 직전 props/값의 메모리 유지, 그리고 의존성 배열 관리라는 코드 복잡도(stale closure 버그 표면 확대)는 히트 여부와 무관하게 지불한다. ③ 신호가 사라진다 — 전부 감싸면 "여기는 참조 안정성이 정말 필요한 지점"이라는 정보가 코드에서 사라져, 리팩터링이 진짜 필요한 memo를 조용히 깨도 아무도 모른다. ④ 진짜 병목은 못 잡는다 — 넓은 전파의 원인이 상태 위치라면 구조를 고쳐야 하고, DOM 양이라면 가상화가 필요하다. 전면 메모이제이션은 계측-진단을 대체하지 못한다.

대안: 그 컨벤션이 원하는 것("메모이제이션 판단을 사람이 안 하기")은 React Compiler의 목적 그 자체다. 수동 전면 적용 대신 컴파일러 도입을 검토하면, 분석 기반 자동 캐싱을 얻으면서 코드는 규칙(순수성)만 지키면 된다. 도입 여부와 무관하게 Profiler 계측 루프는 유지한다.
</details>

**Q3.** Profiler로 녹화했더니 어떤 상호작용의 커밋이 180ms다. flame chart에서 렌더된 컴포넌트들의 자체 렌더 시간 합은 12ms뿐이다. 나머지 시간은 어디서 나온 것이며, 이 경우 memo를 추가하는 조치가 왜 효과가 없겠는가? 다음 진단 단계를 제시하라.

<details>
<summary>정답과 해설</summary>

Profiler의 컴포넌트 시간은 렌더 단계(함수 실행 + diff)의 시간이다. 커밋 180ms 중 렌더 12ms라면 나머지 ~168ms는 커밋 쪽 — 실제 DOM 변경과 그것이 유발한 브라우저 작업(스타일 재계산, 레이아웃, 페인트), 그리고 커밋에 동기로 묶인 useLayoutEffect나 커밋 직후 이펙트의 동기 작업이다. memo는 렌더 단계를 생략하는 도구이므로 12ms 쪽을 줄일 뿐, 168ms에는 손대지 못한다.

다음 단계: Chrome DevTools Performance 패널로 같은 상호작용을 녹화해 커밋 이후 구간을 분해한다 — 대량 DOM 삽입/삭제(→ 가상화 검토), 강제 동기 레이아웃(레이아웃 계측이 보라색 경고로 표시 — useLayoutEffect나 이펙트의 측정-쓰기 교차 확인, 7-1에서 심화), 비싼 CSS(대면적 페인트) 중 무엇인지 특정한 뒤 그 계층의 조치를 택한다. React 계측(Profiler)과 브라우저 계측(Performance)을 구분해 쓰는 것이 이 진단의 핵심이다.
</details>

## 참고 자료

- [react.dev — memo](https://react.dev/reference/react/memo) / [useMemo](https://react.dev/reference/react/useMemo) / [useCallback](https://react.dev/reference/react/useCallback) — 세 API의 정확한 시맨틱과 "성능 힌트일 뿐"이라는 보장 범위. 각 문서의 "Should you add memo everywhere?" 절이 이 문서 실무 관점의 1차 자료.
- [react.dev — React Compiler](https://react.dev/learn/react-compiler) — 자동 메모이제이션의 동작 조건과 한계.
- [React DevTools Profiler 가이드](https://react.dev/learn/react-developer-tools) — Profiler 설치와 기본 사용법.
- [react.dev — useDeferredValue](https://react.dev/reference/react/useDeferredValue) / [startTransition](https://react.dev/reference/react/startTransition) — 빈도 축(우선순위)의 도구.
