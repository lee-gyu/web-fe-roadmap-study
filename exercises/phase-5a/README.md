# Phase 5a 실습 과제 — React 패턴 비교, Headless UI, Streaming AI UI, Stack ADR

Phase 5a 문서 학습과 병행하는 실습이다. [학습 기획](../../plan/phase5a.md)의 네 산출물을 하나의 작은 React 19 + TypeScript strict 프로젝트에서 검증한다.

이 과제의 목표는 패턴을 많이 적용하는 것이 아니다. **같은 사용자 동작을 여러 구조로 구현하고, 데이터 흐름·상태 소유권·타입·tree·접근성·운영 비용을 증거로 비교하는 것**이다. 구현하지 않거나 제거한 패턴도 근거가 있으면 유효한 결과다.

## 공통 제약과 산출물

- Phase 5 SPA의 feature 또는 별도 Vite fixture를 사용한다.
- React 19.x + TypeScript strict를 사용하고 명시적 `any`와 근거 없는 type assertion을 남기지 않는다.
- 패턴 비교 구현은 같은 사용자 동작 contract test를 재사용한다.
- 성능 결론은 React DevTools Profiler 또는 render trace의 전후 기록으로 뒷받침한다.
- AI provider와 외부 network를 사용하지 않는다. 고정 script의 mock transport만 사용한다.
- 실제로 실행한 typecheck·test·build 명령과 결과, 실행하지 못한 검증을 report에 남긴다.

권장 구조는 다음과 같다. 현재 프로젝트 구조에 맞게 이름은 바꿀 수 있지만 책임 경계는 보존한다.

```text
phase-5a-lab/
├─ src/
│  ├─ comparisons/
│  │  ├─ feature-contract.ts
│  │  ├─ withFeature.tsx
│  │  ├─ useFeature.ts
│  │  └─ FeatureView.tsx
│  ├─ components/
│  │  └─ Tabs/
│  └─ ai/
│     ├─ model.ts
│     ├─ mockTransport.ts
│     ├─ useConversation.ts
│     └─ components/
├─ tests/
│  ├─ feature-contract.test.tsx
│  ├─ tabs.test.tsx
│  └─ conversation.test.tsx
├─ reports/
│  ├─ pattern-comparison.md
│  ├─ compound-profiler.md
│  └─ streaming-profiler.md
└─ adr/
   └─ 001-react-stack.md
```

## 과제 A — 같은 로직을 두 패턴으로 비교한다

관련 문서: [HOC](../../docs/phase-5a/01-hoc-pattern.md), [Hooks](../../docs/phase-5a/02-hooks-pattern.md), [Container/Presentational](../../docs/phase-5a/04-container-presentational-pattern.md), [Render Props](../../docs/phase-5a/05-render-props-pattern.md)

analytics, authorization, online status, geolocation, feature flag, form validation 중 하나를 고른다. 첫 구현은 HOC 또는 Render Props, 두 번째 구현은 custom hook으로 만든다. 시각적 차이 때문에 구조 비교가 흐려지지 않도록 같은 `FeatureView`를 재사용한다.

### 사용자 동작 contract

구현 전에 framework와 무관한 행동을 쓴다. 예를 들어 online status라면 다음과 같다.

1. online snapshot에서 “저장” button이 활성화된다.
2. offline event 뒤 같은 button이 비활성화되고 상태 이름이 바뀐다.
3. 다시 online event가 오면 복구된다.
4. unmount 뒤 listener가 남지 않는다.
5. 외부 source 오류 또는 지원되지 않는 환경의 fallback 정책이 같다.

두 구현에 같은 test matrix를 적용한다. component 이름·Hook 호출 횟수 같은 구현 상세를 assertion하지 않는다.

### 필수 구현·관찰

- [ ] HOC를 선택했다면 공개 props와 주입 props가 분리되고 `displayName`이 있다.
- [ ] HOC 합성은 module top level에서 수행한다. 비교용 실패 fixture에서만 render 중 합성으로 state reset을 재현한다.
- [ ] Render Props를 선택했다면 render function의 입력·반환, key와 접근성 책임이 타입에 드러난다.
- [ ] Hook은 호출별 local state와 실제 공유 state/source를 구분한다.
- [ ] 외부 browser/service 의존성을 port로 주입하거나 제어 가능한 fake로 바꿀 수 있다.
- [ ] View는 HOC/Hook/SDK를 import하지 않고 props만으로 loading/error/success 등 필요한 상태를 렌더한다.

`reports/pattern-comparison.md`에 다음 표를 채운다.

| 비교 축 | HOC/Render Props | Custom Hook | 해석·선택 |
|---|---|---|---|
| 호출 지점의 입력·출력 | | | 암묵적 값은 무엇인가 |
| 컴포넌트 tree·상태 소유자 | | | wrapper가 실제 필요한가 |
| TypeScript public surface | | | generic/함수 인자/반환 중 어디가 복잡한가 |
| 오류·취소·cleanup | | | 외부 수명을 누가 소유하는가 |
| Test seam | | | 어떤 port/source를 fake로 바꾸는가 |
| 리렌더 범위 | | | Profiler/trace에서 관찰한 것은 무엇인가 |
| 유지 조건 | | | 어떤 요구에서 이 구조의 이득이 남는가 |
| 전환 비용 | | | 소비자와 test를 얼마나 바꾸는가 |

## 과제 B — Context 기반 Compound Tabs를 만든다

관련 문서: [Compound Component Pattern](../../docs/phase-5a/03-compound-pattern.md)

기본 과제는 Tabs다. Menu, Accordion, Select로 바꾸려면 선택한 widget의 WAI-ARIA APG role·keyboard·focus contract를 같은 깊이로 검증한다.

### 공개 API

```tsx
<Tabs.Root defaultValue="account">
  <Tabs.List aria-label="설정">
    <Tabs.Trigger value="account">계정</Tabs.Trigger>
    <Tabs.Trigger value="security">보안</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="account">...</Tabs.Panel>
  <Tabs.Panel value="security">...</Tabs.Panel>
</Tabs.Root>
```

### 필수 구현

- [ ] Root/List/Trigger/Panel 역할을 분리하고 Context로 가장 가까운 root를 읽는다.
- [ ] 전용 consumer Hook과 sentinel로 root 밖 Trigger/Panel 사용을 설명 가능한 오류로 실패시킨다.
- [ ] uncontrolled `defaultValue`를 지원한다.
- [ ] controlled `value/onValueChange`도 지원한다면 판별 유니언으로 두 mode의 동시 제공과 수명 중 전환을 막는다.
- [ ] `tablist`, `tab`, `tabpanel`, accessible name, `aria-selected`, ID 연결을 구현한다.
- [ ] horizontal Tabs의 Left/Right, Enter/Space, Home/End와 roving `tabIndex`를 구현한다.
- [ ] manual/automatic activation 중 하나를 선택하고 panel latency와 연결한 근거를 report에 쓴다.
- [ ] 중간 layout wrapper를 삽입해도 Context 계약이 유지된다.

### 동작 테스트

- [ ] mouse click과 keyboard activation이 같은 selected state를 만든다.
- [ ] Tab은 active tab 하나로 진입하고 arrow key가 focus를 순환한다.
- [ ] tab/panel의 accessible name과 연결이 유지된다.
- [ ] root 밖 오용, 중복/알 수 없는 value 등 정한 오류 정책을 검증한다.
- [ ] 같은 page의 Tabs 두 개가 state와 ID를 공유하지 않는다.

### 구조 비교와 성능 기록

`Children.map`/`cloneElement` 기반의 작은 실패 fixture를 별도로 만든다. 직접 자식 사이에 wrapper를 넣어 prop 주입이 끊기는지, 소비자 prop과 주입 prop이 충돌하는지 기록한다. 이 fixture를 production 구현의 기반으로 사용하지 않는다.

`reports/compound-profiler.md`에는 다음을 남긴다.

- 단일 객체 Context 버전의 selection 변경 시 consumer render 범위.
- value/action Context 분리 또는 값 안정화 뒤 같은 동작의 범위.
- commit 시간·사용자 체감 차이가 없었다면 최적화를 유지하거나 되돌린 이유.

## 과제 C — 제어 가능한 Mock Stream AI UI를 만든다

관련 문서: [AI UI Patterns](../../docs/phase-5a/06-ai-ui-patterns.md)

실제 모델을 호출하지 않는다. delay·event·오류 지점을 배열로 선언한 `AsyncIterable` 또는 `ReadableStream` mock을 만든다.

### Model과 경계

- [ ] message는 안정된 `id`, `role`, `delivery`, `requestId`를 가진다.
- [ ] part는 최소 `text | tool-call | tool-result | error` 판별 유니언이다.
- [ ] tool input/output은 `unknown`에서 schema guard를 거친다.
- [ ] run state는 `idle/submitting/streaming/success/error/cancelled`를 구분한다.
- [ ] transport interface는 input과 `AbortSignal`을 받고 app-level event stream을 반환한다.
- [ ] UI component는 mock/SDK/fetch를 import하지 않고 controller props를 받는다.

### 필수 시나리오

각 시나리오는 fake timer와 고정 ID factory로 결정적으로 실행한다.

1. **정상 완료**: 여러 text delta와 tool call/result 뒤 success가 된다.
2. **중간 취소**: partial text를 보존하고 cancelled로 끝나며 이후 event는 반영되지 않는다.
3. **중간 오류와 재시도**: partial assistant 처리 정책, user message 중복 여부, 새 request ID를 검증한다.
4. **빠른 연속 제출**: 첫 render 전 double submit도 active request 하나만 만든다.
5. **늦은 이전 응답**: A 취소 뒤 B를 시작하고 A의 늦은 event가 B를 덮지 않음을 request ID로 검증한다.
6. **잘못된 protocol/tool payload**: schema 실패가 UI error로 변환되고 근거 없는 단언으로 통과하지 않는다.

### UX·접근성·신뢰 경계

- [ ] 중단과 재시도 button에 명확한 accessible name이 있다.
- [ ] streaming text 전체를 live region으로 반복 낭독하지 않고 짧은 상태 변화만 알린다.
- [ ] 사용자가 위를 읽는 동안 강제 auto-scroll하지 않고 “최신 응답으로 이동” affordance를 제공한다.
- [ ] markdown raw HTML과 link scheme, tool output을 신뢰하지 않는 정책을 기록한다.
- [ ] client bundle에 provider secret이 없으며 실제 도입 시 필요한 server boundary를 diagram으로 그린다.

`reports/streaming-profiler.md`에는 고정된 5~10초 script에 대한 다음 관찰을 기록한다.

- 첫 delta 표시 시간, 전체 commit 수, 가장 무거운 subtree.
- chunk마다 즉시 반영한 버전과 작은 buffer로 합친 버전의 같은 시나리오 비교.
- batching이 사용자 체감을 개선하지 않거나 첫 응답을 늦췄다면 되돌린 근거.

## 과제 D — 제품 요구에서 React Stack ADR을 만든다

관련 문서: [React Stack Patterns](../../docs/phase-5a/07-react-stack-patterns.md)

현재 Phase 5 SPA와 성격이 다른 가상 제품 하나를 고른다. 공개 콘텐츠, commerce, 내부 관리자, offline field app, 실시간 협업 도구 중 하나를 권장한다.

### 요구사항과 책임 지도

- [ ] 공개 URL/SEO, interaction, mutation, offline, hosting runtime, team ownership, 성능·운영 제약을 검증 가능한 scenario로 쓴다.
- [ ] runtime/hosting → framework/rendering → build → routing → server data/cache → client state → form → UI/accessibility → test/observability 책임 지도를 작성한다.
- [ ] 필요 없는 계층은 비워 두고 “없음”인 이유를 쓴다.
- [ ] URL·server·client local/global·form draft·offline state의 원본을 하나씩 지정한다.
- [ ] loader/query cache, framework action/form library, Context/external store처럼 capability가 겹치는 지점을 표시한다.

### 후보 비교

Framework 후보와 custom stack 후보를 하나 이상 포함한다. 도구의 인기도나 다운로드 수가 아니라 같은 decision driver로 비교한다.

| Driver | Framework 후보 | Custom 후보 | 증거/미확인 |
|---|---|---|---|
| 초기 HTML·rendering | | | prototype HTML/waterfall |
| Routing·data mutation | | | 오류·revalidation 시나리오 |
| Hosting·rollback | | | preview deploy/adapter |
| Client JS·interaction | | | production build/Profiler |
| Observability | | | log/trace/Web Vitals |
| Team·upgrade | | | support/migration 문서 |
| Exit cost | | | 대표 feature 이전 spike |

### ADR 필수 항목

`adr/001-react-stack.md`에 다음을 포함한다.

- Context와 바꿀 수 없는 제약.
- 우선순위가 있는 decision drivers.
- 선택한 후보와 선택하지 않은 후보.
- 계층별 owner와 state 원본.
- 얻는 것과 새로 생기는 runtime·upgrade·glue·학습 비용.
- 관측할 metric과 사용자 시나리오.
- 공식 지원·version을 확인한 날짜와 source.
- 요구·수치·지원 상태 기반 재검토 trigger.
- route/data/adapter 단위의 migration·철회 경로.

## 통합 완성 기준 (Definition of Done)

- [ ] HOC 또는 Render Props와 custom hook이 같은 사용자 동작 contract를 만족하고 8개 비교 축을 채웠다.
- [ ] wrapper/Context/render function의 데이터 흐름과 state owner를 component tree로 설명했다.
- [ ] Compound/headless component가 provider 오용, role/name, keyboard, focus contract를 테스트한다.
- [ ] TypeScript strict에서 주입 props, render function, Context, AI part에 명시적 `any`와 근거 없는 단언이 없다.
- [ ] AI UI가 정상·취소·오류·재시도·중복 제출·늦은 응답을 실제 모델 없이 결정적으로 재현한다.
- [ ] Profiler 또는 render trace로 Context와 streaming UI의 render 범위를 기록했다.
- [ ] Stack ADR이 요구사항, 후보, 결정, 새 비용, 검증 metric, 재검토 조건, exit path를 포함한다.
- [ ] 적용해 줄어든 복잡도와 새로 생긴 wrapper·type·runtime·운영 비용을 모두 기록했다.
- [ ] 프로젝트의 실제 typecheck·test·production build가 통과하고 실행 명령·환경·결과를 report에 남겼다.

## 제출 전 자가 검토

- 패턴 이름을 지우고 봐도 어떤 문제와 힘(forces)을 해결했는지 설명되는가?
- “현대적”, “빠르다”, “유연하다” 같은 말에 tree·type·Profiler·build·deploy 증거가 붙어 있는가?
- 실패 fixture와 production 구현이 명확히 분리되어 있는가?
- 접근성·취소·오류·보안이 마지막 장식이 아니라 public contract와 test에 들어 있는가?
- 선택하지 않은 대안과 결론을 바꿀 조건을 기록했는가?
