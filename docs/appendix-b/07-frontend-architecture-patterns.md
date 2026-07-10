# B-7. 프론트엔드 아키텍처의 계보

> 한 줄 요약: MVC·MVP·MVVM·Flux를 presentation 상태 흐름으로, BFF·Micro Frontends를 팀과 배포 경계로 구분해 프론트엔드 구조를 선택할 수 있다.

## 학습 목표

- Smalltalk MVC, server-side MVC, client-side MVC가 같은 이름 아래 다른 실행 흐름을 갖는 이유를 설명할 수 있다.
- MVP와 MVVM의 presentation 분리 방식과 explicit call·data binding의 비용을 비교할 수 있다.
- Flux/Redux 계열의 단방향 data flow가 해결한 문제와 모든 상태를 중앙화할 때의 경계를 판단할 수 있다.
- BFF를 client별 API ownership과 release cadence로 평가하고 API Gateway·GraphQL과 구분할 수 있다.
- Micro Frontends의 독립 배포 이득과 runtime integration·bundle·UX governance 비용을 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

프론트엔드 아키텍처는 화면 폴더 구조만 다루지 않는다. 사용자 입력이 상태를 어떻게 바꾸고, 상태 변경이 어떤 view를 다시 그리며, server 데이터가 어느 경계에서 client 표현으로 변환되고, 여러 팀의 산출물이 어떻게 하나의 제품으로 배포되는지를 결정한다.

MVC라는 이름은 Smalltalk desktop UI, server-side web framework, browser SPA에서 모두 쓰였지만 control과 state의 위치가 다르다. React를 “MVC의 V”라고만 부르면 component local state, effect, router, server-state cache, render scheduling을 설명하지 못한다. 패턴 이름보다 실행 흐름과 ownership을 그려야 한다.

이 문서는 [React의 렌더링·상태 모델](../phase-5/01-react-mental-model.md)과 [SSR/RSC 전략](../phase-8/05-rendering-strategies.md)의 사용법을 반복하지 않는다. 그 선택들이 presentation·API·배포 경계와 어떻게 만나는지에 집중한다.

## 핵심 개념

### MVC는 하나의 고정된 삼각형이 아니다

원래 Smalltalk MVC에서 Model은 application state와 behavior를, View는 표현을, Controller는 사용자 입력을 해석한다. Model 변경은 observer 관계로 View에 알려질 수 있고 View와 Controller가 쌍을 이룬다.

server-side web MVC에서는 HTTP request가 Controller에 들어가 Model/application service를 호출하고 View template을 선택해 HTML response를 만든다. request 사이에 View가 Model을 계속 관찰하지 않는다.

client-side MVC에서는 browser에 장기 실행되는 state와 event handler가 있으므로 Model 변경, View update, Controller 역할이 framework마다 다르게 배치된다.

```text
Smalltalk MVC                 Server MVC
User → Controller            HTTP → Controller → Model
          ↓   ↘                         ↓
        Model → View                 View template → HTML
          ↑      ↓
          └─ notify
```

따라서 “controller 폴더가 있으니 MVC”보다 다음을 묻는다.

- authoritative state는 어디에 있는가.
- user input을 누가 command로 해석하는가.
- state change가 view에 어떻게 전파되는가.
- presentation logic과 domain logic이 어디에서 만나는가.

### MVP는 View를 수동적으로 만들고 Presenter를 명시한다

MVP(Model-View-Presenter)에서 View는 rendering과 event forwarding에 집중하고 Presenter가 presentation logic을 수행한다. View와 Presenter 사이에 명시적 interface를 두면 UI toolkit 없이 Presenter를 테스트할 수 있다.

```ts
interface CheckoutView {
  showTotal(text: string): void;
  showError(message: string): void;
}

class CheckoutPresenter {
  constructor(private readonly view: CheckoutView) {}

  updateTotal(amount: number): void {
    if (amount < 0) {
      this.view.showError('금액은 음수일 수 없다');
      return;
    }
    this.view.showTotal(`${amount.toLocaleString('ko-KR')}원`);
  }
}

const output: string[] = [];
const presenter = new CheckoutPresenter({
  showTotal: (text) => output.push(text),
  showError: (message) => output.push(message),
});
presenter.updateTotal(42_000);
console.log(output[0]);
// 출력: 42,000원
```

explicit call은 흐름을 추적하기 쉽지만 View method와 forwarding code가 늘고 Presenter가 모든 화면 판단을 떠안아 비대해질 수 있다. modern component framework에서는 component function과 custom hook이 이 역할 일부를 더 작은 단위로 나눈다.

### MVVM은 View와 ViewModel을 binding으로 연결한다

MVVM(Model-View-ViewModel)에서 ViewModel은 View가 표시할 state와 실행할 command를 노출하고 View는 declarative binding으로 연결된다. binding engine이 양쪽을 동기화하므로 수동 DOM update가 줄어든다.

```text
View ⇄ data binding ⇄ ViewModel → Model
```

단방향 binding은 state에서 view로 흐르고 event가 command를 호출한다. 양방향 binding은 input 변경이 ViewModel을 자동 갱신하므로 폼 구현은 간단하지만 누가 언제 값을 바꿨는지 암묵적이 될 수 있다. computed property와 observer chain이 많아지면 갱신 순서와 성능을 디버깅하기 어렵다.

React의 props/state rendering은 MVVM과 닮은 점이 있지만 특정 역사적 MVVM 구현과 동일하다고 단정할 필요는 없다. 중요한 것은 declarative view가 어떤 state를 구독하고 update가 어느 방향으로 흐르는지다.

### Flux는 양방향 update와 여러 Model의 연쇄를 단방향으로 제한한다

초기 client MVC는 여러 Model과 View가 서로 event를 발행하면서 cascade update와 순서 의존이 생기기 쉬웠다. Flux는 action → dispatcher/update logic → store → view라는 단방향 흐름을 제안했다. Redux는 단일 store, pure reducer, immutable update를 통해 state transition을 기록·재현하기 쉽게 만들었다.

```ts
type State = { count: number };
type Action = { type: 'increment' } | { type: 'reset' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'increment':
      return { count: state.count + 1 };
    case 'reset':
      return { count: 0 };
  }
}

const actions: Action[] = [{ type: 'increment' }, { type: 'increment' }, { type: 'reset' }];
const state = actions.reduce(reducer, { count: 0 });
console.log(state);
// 출력: { count: 0 }
```

예측 가능성은 제약에서 온다. 임의 component가 state를 직접 변경하지 않고 action과 reducer 경로를 통과한다. 반대 비용은 간접성과 protocol code다. modal 열림, input draft 같은 local state까지 전역 store로 올리면 변경 범위와 subscription 관리가 오히려 커진다.

server state도 별개다. 원격 원천, stale, retry, cache lifecycle을 가진 데이터는 단순 client reducer보다 [server-state cache](../phase-5/08-server-state.md)가 더 적합할 수 있다. URL state, server state, shared client state, local UI state를 ownership과 수명으로 구분한다.

### BFF는 client별 backend 요구와 ownership을 분리한다

Backends for Frontends(BFF)는 web, mobile, kiosk 같은 client마다 요구에 맞는 backend를 둔다. 범용 domain service를 대체하기보다 client에 필요한 aggregation, payload shaping, protocol adaptation을 client 팀이 소유한다.

```text
Web App    → Web BFF    ─┬→ Order Service
Mobile App → Mobile BFF ─┼→ Payment Service
                         └→ Profile Service
```

Web은 넓은 화면에 한 번에 많은 데이터를 원하고 mobile은 적은 payload와 다른 release cadence가 필요할 수 있다. BFF는 client 팀의 end-to-end ownership과 latency 최적화를 돕는다. 반면 인증, cache, observability, business rule이 BFF마다 복제될 수 있다.

| 선택 | 주된 책임 | 분리 신호 | 중복 신호 |
|---|---|---|---|
| API Gateway | routing, auth, rate limit 같은 공통 진입 정책 | 모든 client에 공통 cross-cutting concern | client presentation logic이 집중됨 |
| BFF | client별 aggregation·표현 계약 | 요구·팀·release cadence가 실제로 다름 | client가 하나이거나 API 요구가 동일 |
| GraphQL gateway | client가 필요한 field를 query | 다양한 조회 조합과 schema federation | backend 호출 폭증·권한·cache가 더 복잡 |

BFF에 core business invariant를 복제하면 client별 규칙이 갈라진다. domain policy는 service가 소유하고 BFF는 client adaptation에 머무는 것이 일반적이다.

### Micro Frontends는 조직과 배포 경계를 browser까지 가져온다

Micro Frontends는 사용자 가치의 vertical slice를 여러 팀이 독립 개발·테스트·배포하고 하나의 제품 경험으로 합성한다. 단순히 repository를 나누거나 component library를 사용하는 것이 아니다. 독립 release가 실제로 가능하고 팀이 slice를 end-to-end 소유해야 한다.

통합 방식은 trade-off가 다르다.

| 통합 시점 | 방식 | 이득 | 비용 |
|---|---|---|---|
| build-time | package dependency | 단순 runtime, type 공유 | host rebuild·배포가 필요해 독립성 감소 |
| server-time | route/fragment composition | 초기 HTML 통합, runtime 격리 | server 조합과 일관된 caching 복잡도 |
| runtime | iframe, Module Federation, script | 독립 배포와 점진 upgrade | version·실패·security·bundle 조정 |
| route | URL 영역별 app | 가장 단순한 ownership | 화면 간 navigation·상태·UX 연결 비용 |

iframe은 격리와 기술 독립성이 높지만 focus, accessibility tree, sizing, navigation, shared auth가 어렵다. runtime module은 자연스러운 UI 합성이 가능하지만 React 같은 singleton dependency version, shared state, CSS collision, remote load 실패를 관리해야 한다.

독립 팀마다 framework와 design system을 자유롭게 선택하면 조직 자율성은 높아지지만 사용자는 불일치한 제품과 중복 bundle 비용을 지불한다. 자율성의 경계에 공통 accessibility, performance budget, telemetry, design token, routing, security contract가 필요하다.

## 실무 관점

| 문제 | 먼저 검토할 패턴 | 측정할 효과 | 철회 조건 |
|---|---|---|---|
| presentation logic을 UI toolkit 없이 테스트 | MVP 또는 ViewModel 분리 | UI 없는 test 범위·변경 파일 수 | forwarding과 mock이 본문보다 많음 |
| 복잡한 shared client transition | Flux/Redux 계열 | state transition 재현·subscription 범위 | 대부분 local/server state임 |
| client별 API 요구와 팀이 다름 | BFF | payload·request 수·release 대기 | 로직 복제와 service 수가 이득 초과 |
| 여러 팀의 frontend 배포 충돌 | route 우선 Micro Frontends | 독립 배포율·lead time | bundle·UX·incident 비용이 더 큼 |

Micro Frontends를 도입하기 전에 monorepo, ownership rule, feature flag, route-level deployment로도 문제를 풀 수 있는지 확인한다. 배포 pipeline이 느린 문제를 runtime 분산으로 해결하면 browser가 CI 문제의 비용을 떠안는다.

성능은 팀별 bundle 합이 아니라 사용자 route의 실제 waterfall로 측정한다. 중복 framework bytes, remote entry 지연, long task, LCP/INP를 release별로 본다. runtime remote 실패 시 shell이 전체 crash하지 않고 fallback·retry·rollback할 수 있어야 한다.

## 더 깊이

프론트엔드 경계는 state ownership에서 가장 자주 무너진다. 서로 다른 micro frontend가 같은 장바구니 객체를 직접 mutate하면 독립 배포 계약이 사라진다. URL, custom event, versioned client API, server source of truth 중 최소 계약을 선택한다. 전역 event bus는 편리하지만 schema registry와 ownership 없이 사용하면 browser 안의 distributed monolith가 된다.

design system도 중앙 package 배포만으로 governance가 되지 않는다. semantic token, 접근성 behavior, visual regression, migration codemod, 지원 version을 제품 팀과 공동 운영해야 한다. 중앙 팀이 모든 변경의 승인 병목이면 Conway's Law가 화면 구조에 반영된다.

SSR/RSC와 Micro Frontends는 다른 축이다. 전자는 rendering과 code execution 경계를, 후자는 팀과 배포 경계를 주로 정한다. server composition으로 조합할 수 있지만 cache key, streaming order, hydration/runtime compatibility를 추가로 설계해야 한다.

## 정리

- MVC는 역사적 환경에 따라 control과 state 흐름이 달라 이름만으로 구조를 설명할 수 없다.
- MVP는 explicit Presenter call, MVVM은 data binding으로 presentation을 분리하며 각각 forwarding과 암묵성 비용이 있다.
- Flux는 단방향 state transition을 강제하지만 모든 local·server state를 중앙화할 이유는 없다.
- BFF는 client별 요구와 ownership이 실제로 다를 때 가치가 있다.
- Micro Frontends의 독립 배포 이득은 runtime·bundle·UX·조직 governance 비용과 함께 평가한다.

## 확인 문제

1. React를 “MVC의 View”라고만 설명할 때 놓치는 실행 흐름은 무엇인가?

   <details>
   <summary>정답과 해설</summary>

   component local state, event handler, effect, context/store subscription, server-state cache, router, rendering scheduler가 state와 control 일부를 소유한다. authoritative state와 update path를 실제로 그려야 한다.

   </details>

2. web과 mobile BFF가 같은 인증·가격 계산 코드를 복제하고 있다. 어떤 책임을 이동해야 하는가?

   <details>
   <summary>정답과 해설</summary>

   공통 인증 정책은 gateway 또는 공통 security 계층으로, 가격 invariant는 domain service로 이동한다. BFF에는 client별 aggregation과 presentation adaptation을 남긴다.

   </details>

3. 세 frontend 팀이 독립 repository를 쓰지만 host release에 모두 합쳐 월 1회 배포한다. Micro Frontends의 핵심 이득을 얻고 있는가?

   <details>
   <summary>정답과 해설</summary>

   repository 분리만으로 독립 배포를 얻지 못한다. 팀별 변경이 실제로 독립 build·test·deploy·rollback 가능한지, runtime failure가 격리되는지 확인해야 한다.

   </details>

## 참고 자료

- [Pattern-Oriented Software Architecture, Chapter 2](https://www.oreilly.com/library/view/pattern-oriented-software-architecture/9781118725269/9781118725269_c02.xhtml) — MVC와 PAC를 대화형 시스템 architecture로 다룬다.
- [Microsoft Learn — Data binding and MVVM](https://learn.microsoft.com/en-us/windows/uwp/data-binding/data-binding-and-mvvm) — ViewModel과 binding의 역할을 설명한다.
- [Redux — A Brief History of Redux](https://redux.js.org/understanding/history-and-design/history-of-redux) — client MVC의 문제에서 Flux·Redux로 이어진 배경을 다룬다.
- [Azure Architecture Center — Backends for Frontends](https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends) — BFF의 적용 조건과 API Gateway·GraphQL과의 경계를 설명한다.
- [Cam Jackson — Micro Frontends](https://martinfowler.com/articles/micro-frontends.html) — 독립 배포 가능한 frontend와 여러 integration 방식을 비교한다.

