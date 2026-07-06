# Phase 9 실습 과제 — JavaScript와 React 패턴 리팩터링

Phase 9 문서 학습과 병행하는 설계 패턴 실습이다. 이 Phase의 목표는 패턴 이름을 많이 적용하는 것이 아니라, 반복되는 설계 문제를 식별하고 패턴 적용 여부를 근거 있게 판단하는 것이다. React 예제는 함수 컴포넌트만 사용한다.

최종 산출물은 다음 네 묶음이다.

- JavaScript/TypeScript 패턴 후보 분석표
- 패턴 적용 또는 배제 리팩터링 기록
- React 함수 컴포넌트 패턴 샘플
- 패턴 선택 ADR과 검증 로그

## 1주차 — JavaScript 설계 패턴

[9-1 패턴을 설계 어휘로 읽기](../../docs/phase-9/01-patterns-as-design-vocabulary.md), [9-2 생성·구성 패턴](../../docs/phase-9/02-creational-and-composition-patterns.md), [9-3 행위 패턴](../../docs/phase-9/03-behavioral-patterns.md), [9-4 구조·경계 패턴](../../docs/phase-9/04-structural-and-boundary-patterns.md)와 병행한다.

### 과제 A. 패턴 후보 분석

기존 JavaScript/TypeScript 코드 하나를 고른다. Phase 3 바닐라 JS 앱, Phase 5 React 앱의 비 UI 로직, 또는 별도 미니 프로젝트를 사용할 수 있다.

- [ ] 반복되는 조건 분기, 외부 API 경계, 전역 상태, 이벤트 전달, 옵션 객체, 비동기 retry/queue 중 최소 5개의 패턴 후보를 찾았다.
- [ ] 각 후보의 변경 축을 설명했다.
- [ ] 각 후보에 적용 가능한 패턴과 적용하지 않을 이유를 함께 기록했다.
- [ ] 테스트 가능성, 디버깅 가능성, 런타임 비용, 타입 표현 가능성 중 최소 2개 기준으로 후보를 평가했다.

### 과제 B. JavaScript 패턴 리팩터링

최소 3개 패턴에 대해 적용 또는 배제를 결정한다.

권장 조합:

- 생성·구성: factory, builder, module, singleton, dependency injection 중 1개 이상
- 행위: strategy, command, observer/pub-sub, state, iterator/generator 중 1개 이상
- 구조·경계: adapter, facade, proxy, decorator, middleware/chain 중 1개 이상

각 결정에는 다음을 포함한다.

- [ ] 변경 전 코드의 문제
- [ ] 선택한 패턴 또는 패턴을 쓰지 않기로 한 이유
- [ ] 변경 후 코드
- [ ] 선택하지 않은 대안
- [ ] 테스트 또는 실행 로그
- [ ] 새로 생긴 비용과 재검토 조건

## 2주차 — React 함수 컴포넌트 패턴

[9-5 React 컴포넌트 합성 패턴](../../docs/phase-9/05-react-composition-patterns.md), [9-6 React 로직 재사용과 상태 패턴](../../docs/phase-9/06-react-logic-and-state-patterns.md)와 병행한다.

### 과제 C. 컴포넌트 패턴 샘플 제작

함수 컴포넌트만 사용해 작은 UI 샘플을 만든다. 예시: Tabs, Accordion, Dialog, Combobox, DataTable filter panel, Wizard.

- [ ] class component, legacy lifecycle, mixin을 사용하지 않았다.
- [ ] children-as-slot 또는 compound component 패턴을 포함했다.
- [ ] controlled 또는 uncontrolled 방식 중 하나를 지원했다.
- [ ] 선택하지 않은 상태 소유권 방식이 더 적합해지는 조건을 기록했다.
- [ ] custom hook, reducer + context, provider boundary, external store adapter 중 1개 이상을 사용했다.
- [ ] 접근성 role/name/keyboard 흐름을 컴포넌트 계약에 포함했다.

### 과제 D. 비용 검증

React 패턴은 사용성만으로 평가하지 않고 비용을 관찰한다.

- [ ] React DevTools Profiler, console trace, 테스트 로그 중 하나로 리렌더 범위를 확인했다.
- [ ] context를 사용했다면 provider 분할 또는 memoization이 필요한지 판단했다.
- [ ] controlled API를 제공했다면 호출자가 상태를 소유할 때의 edge case를 테스트했다.
- [ ] uncontrolled API를 제공했다면 초기값 변경, reset, form submit 같은 edge case를 테스트했다.
- [ ] custom hook이 로직 재사용인지 상태 공유인지 구분해 설명했다.

### 과제 E. 패턴 선택 ADR

최소 3개의 ADR을 작성한다. "패턴을 쓰지 않기로 한 결정"도 ADR로 인정한다.

각 ADR은 다음 항목을 포함한다.

- [ ] 문제와 맥락
- [ ] 후보 패턴
- [ ] 결정
- [ ] 선택하지 않은 대안
- [ ] 검증 방법
- [ ] 결과와 비용
- [ ] 재검토 조건

## 산출물 형식 예시

```text
project/
  docs/
    pattern-candidates.md
    adr/
      001-api-adapter.md
      002-search-strategy.md
      003-tabs-compound-component.md
    measurements/
      profiler-tabs-context.md
      reducer-state-transition-test.md
  src/
    patterns/
      apiAdapter.ts
      searchStrategy.ts
    components/
      Tabs/
        Tabs.tsx
        Tabs.test.tsx
```

## 완성 기준

- [ ] JavaScript/TypeScript 코드에서 패턴 후보 5개 이상을 분석했다.
- [ ] 최소 3개 패턴에 대해 적용 또는 배제 결정을 기록했다.
- [ ] 각 결정에 선택하지 않은 대안과 재검토 조건이 있다.
- [ ] React 함수 컴포넌트만 사용한 패턴 샘플이 있다.
- [ ] compound component 또는 children-as-slot 패턴을 사용했다.
- [ ] controlled/uncontrolled 상태 소유권 판단을 기록했다.
- [ ] custom hook, reducer + context, provider boundary, external store adapter 중 1개 이상을 사용했다.
- [ ] 리렌더 범위, 테스트 결과, 실행 로그 중 하나 이상의 검증 증거가 있다.
- [ ] 패턴 적용 후 코드가 더 단순해진 지점과 더 복잡해진 지점을 모두 설명했다.

## 진행 팁

- 패턴 적용 수를 목표로 삼지 않는다. 좋은 결정은 때로 "그냥 함수로 둔다"이다.
- 패턴 이름은 결과에 붙인다. 먼저 변경 축과 실패 조건을 찾는다.
- React 합성 패턴은 API가 예뻐 보이는지보다 리렌더 범위와 접근성 계약이 유지되는지로 평가한다.
- TypeScript 타입이 너무 복잡해지면 설계 비용으로 기록한다. 타입 체조가 패턴의 성공을 보장하지 않는다.
