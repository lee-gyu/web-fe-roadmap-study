# A-4. 코드 원칙·모듈 경계

> 한 줄 요약: SOLID, DRY, KISS, YAGNI 같은 코드 원칙을 체크리스트가 아니라 변경 비용과 의존성 방향을 읽는 언어로 사용할 수 있다.

## 학습 목표

- SOLID 원칙을 JavaScript, TypeScript, React의 구조적 타이핑과 컴포넌트 합성 맥락에서 재해석할 수 있다.
- DRY, KISS, YAGNI, Open/Closed Principle이 서로 충돌하는 상황을 설명할 수 있다.
- Law of Demeter, Unix Philosophy, Input-Process-Output를 모듈 경계와 데이터 흐름 설계에 적용할 수 있다.
- Robustness Principle, Least Astonishment, Premature Optimization Effect의 현대적 경계 조건을 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

코드 원칙은 좋은 코드를 설명하는 언어로 유용하다. 하지만 원칙이 체크리스트가 되는 순간 역효과가 생긴다. DRY를 지키려다 변경 축이 다른 두 코드를 하나로 묶고, YAGNI를 외치다 되돌리기 어려운 데이터 모델 결정을 방치하며, SOLID를 적용한다며 작은 React 컴포넌트에 과도한 interface와 factory를 넣는 식이다.

프론트엔드의 모듈 경계는 객체 하나의 책임보다 넓다. 컴포넌트, hook, API client, route, server state cache, design token, build 설정, 테스트 fixture가 함께 움직인다. 따라서 원칙의 목적은 "원칙을 지켰는가"가 아니라 "다음 변경이 왔을 때 어느 파일과 팀이 함께 움직이는가"를 예측하는 것이다.

이 문서에서 다루는 원문 항목명은 SOLID, The Single Responsibility Principle, The Open/Closed Principle, The Liskov Substitution Principle, The Interface Segregation Principle, The Dependency Inversion Principle, The DRY Principle, The KISS principle, YAGNI, The Law of Demeter, The Unix Philosophy, Input-Process-Output, The Robustness Principle, The Principle of Least Astonishment, Premature Optimization Effect다.

## 핵심 개념

### SOLID는 객체지향 표어가 아니라 변경 이유를 읽는 어휘다

SOLID는 객체지향 설계 문맥에서 출발했지만, 프론트엔드에서도 변경 축을 말하는 데 쓸 수 있다. 다만 React 컴포넌트와 TypeScript 구조적 타이핑에서는 원문 그대로 적용하기보다 계약과 변경 이유 중심으로 번역해야 한다.

| 원칙 | 프론트엔드에서의 질문 | 경계 조건 |
|---|---|---|
| Single Responsibility | 이 모듈은 같은 이유로 변경되는 것만 담는가 | 책임을 너무 잘게 쪼개면 흐름이 흩어진다 |
| Open/Closed | 새 요구가 기존 안정 코드를 덜 바꾸게 하는 확장점이 있는가 | 미래 확장을 미리 만들면 YAGNI와 충돌한다 |
| Liskov Substitution | 같은 props/API 계약을 가진 구현이 기대를 깨지 않는가 | 구조적 타입은 런타임 의미를 보장하지 않는다 |
| Interface Segregation | 소비자가 쓰지 않는 props와 method를 알 필요가 없는가 | 지나친 분리는 조합 비용을 키운다 |
| Dependency Inversion | 변하기 쉬운 구현보다 안정적인 정책과 계약에 의존하는가 | 추상 계층이 실제 대체 가능성을 가져야 한다 |

중요한 것은 원칙 이름이 아니라 변경의 이유다. `UserTable`이 fetching, filtering, permission, rendering, analytics를 모두 처리한다면 Single Responsibility 위반이라고 말할 수 있다. 더 정확히는 사용자 목록 표시 정책과 데이터 로딩 정책과 계측 정책이 서로 다른 이유로 변경된다는 뜻이다.

### DRY는 같은 코드보다 같은 변경 축에 적용한다

DRY Principle은 중복 제거로 자주 이해된다. 그러나 텍스트가 비슷한 코드가 반드시 같은 지식의 중복은 아니다. 관리자 화면과 사용자 화면의 카드 UI가 현재 비슷해도, 변경 이유가 다르면 성급한 공통화가 더 비싼 조건 분기를 만든다.

KISS principle은 단순성을 강조한다. 하지만 단순함은 요구사항의 실제 복잡도를 지운다는 뜻이 아니다. YAGNI는 아직 필요 없는 확장을 미루라는 원칙이다. 그러나 나중에 바꾸기 어려운 public API, 데이터 모델, URL 구조, 보안 경계는 "나중에 하자"로만 다루기 어렵다.

세 원칙은 자주 충돌한다.

| 상황 | DRY 관점 | KISS/YAGNI 관점 | 판단 기준 |
|---|---|---|---|
| 유사한 두 컴포넌트 | 공통 컴포넌트 추출 | 중복 유지가 더 단순 | 앞으로 같은 이유로 바뀌는가 |
| API client wrapper | 공통 오류 처리 | 각 endpoint의 차이 유지 | 오류 정책이 실제로 공통인가 |
| 플러그인 구조 | 확장점 제공 | 지금 필요한 기능만 구현 | 확장이 확정된 계약인가 추측인가 |

### Demeter와 Unix Philosophy는 모듈이 아는 범위를 줄인다

The Law of Demeter는 한 객체가 너무 먼 내부 구조를 알지 않게 하라는 원칙이다. 프론트엔드에서는 컴포넌트가 깊은 응답 구조, 전역 store 내부, route loader의 private detail을 직접 아는 문제로 나타난다.

나쁜 신호는 이런 형태다.

- 컴포넌트가 `user.company.billingPlan.featureFlags.checkout.enabled` 같은 깊은 구조를 직접 읽는다.
- 화면이 API 응답의 raw shape에 강하게 묶인다.
- test가 내부 class name이나 private store action에 의존한다.
- hook이 호출자에게 내부 캐시 키 조합을 요구한다.

The Unix Philosophy는 작은 도구, 명확한 입력과 출력, 조합 가능한 경계를 강조한다. 프론트엔드에서는 순수한 변환 함수, 명확한 hook 계약, 서버 상태와 UI 상태의 분리, 작은 build 도구 조합으로 번역할 수 있다. Input-Process-Output는 이 흐름을 더 노골적으로 보여 준다. 입력을 검증하고, 처리를 순수하게 유지하고, 출력 경계를 명확히 하면 테스트와 리뷰가 쉬워진다.

### 관대함과 놀라움의 경계

The Robustness Principle은 입력에는 관대하고 출력에는 보수적이라는 원칙으로 알려져 있다. 웹의 상호운용성에는 이 태도가 도움을 주었다. 그러나 현대 애플리케이션에서는 무제한 관대함이 보안과 데이터 품질을 해칠 수 있다. API가 잘못된 입력을 조용히 보정하면 클라이언트 버그가 오래 숨어 있을 수 있고, XSS 위험 입력을 관대하게 받아들이면 피해가 커진다.

The Principle of Least Astonishment는 API와 UI가 사용자의 예상을 불필요하게 깨지 않아야 한다는 원칙이다. 사용자가 삭제 버튼을 눌렀는데 저장이 되거나, `onClose`가 취소와 저장 완료를 모두 의미하거나, disabled 버튼이 click handler를 호출하면 놀라움이 생긴다. 놀라움은 문서로만 해결되지 않는다. 계약 자체가 예측 가능해야 한다.

### 최적화는 병목 관찰 뒤에 온다

Premature Optimization Effect는 병목 확인 전 최적화가 구조를 왜곡하는 문제를 경고한다. React에서 모든 컴포넌트에 `memo`를 붙이거나, bundle 분석 없이 dynamic import를 남발하거나, 실제 INP 병목을 보지 않고 debounce를 추가하면 코드가 복잡해지고 원인 추적이 어려워질 수 있다.

하지만 이 원칙은 성능 설계를 미루라는 뜻이 아니다. public API, 이미지 전략, 데이터 fetching 위치, route 경계, streaming 여부처럼 나중에 바꾸기 어려운 구조는 초기에 고려해야 한다. "조기 최적화"와 "성능을 고려한 설계"는 다르다. 전자는 증거 없는 미세 조정이고, 후자는 되돌리기 어려운 병목을 피하는 구조 판단이다.

## 실무 관점

모듈 경계는 다음 질문으로 정한다.

| 축 | 질문 |
|---|---|
| 변경 빈도 | 함께 바뀌는 것끼리 묶였는가 |
| 데이터 소유권 | 원천 데이터와 파생 상태의 책임이 분리되었는가 |
| 테스트 경계 | 모듈을 독립적으로 검증할 수 있는가 |
| 런타임 비용 | 경계가 render, network, bundle 비용을 키우는가 |
| 팀 소유권 | 소유 팀과 배포 책임이 경계와 맞는가 |
| public contract | 외부 소비자가 의존해도 되는 부분이 명확한가 |

원칙은 리뷰 코멘트에도 구체적으로 써야 한다. "DRY 위반"보다 "이 두 코드는 UI가 비슷하지만 관리자 정책과 사용자 정책이 다르게 바뀔 가능성이 높아서 지금 합치면 조건 분기가 늘어난다"가 더 낫다. "YAGNI"보다 "이 확장점은 현재 확정된 두 번째 구현이 없고, 제거 비용보다 유지 비용이 커 보인다"가 더 낫다.

## 더 깊이

TypeScript는 계약을 표현하지만 런타임 의미를 자동으로 보장하지 않는다. Liskov Substitution Principle을 구조적 타입에 적용할 때 특히 주의해야 한다. 두 객체가 같은 method shape를 가져도, error throwing, async timing, side effect, permission semantics가 다르면 대체 가능하지 않다.

React props도 비슷하다. `Button`과 `LinkButton`이 같은 `onClick` props를 받아도, navigation, disabled semantics, keyboard behavior, accessibility role이 다르면 단순 대체는 깨질 수 있다. 타입이 맞는다는 것은 최소 조건이다. 사용자가 기대하는 동작 계약은 별도로 검증해야 한다.

## 회고 질문

- 이 원칙을 적용하면 변경 비용은 어느 쪽에서 줄고 어느 쪽에서 늘어나는가?
- 중복된 코드가 같은 이유로 바뀌는가, 다른 이유로 바뀌는가?
- 지금 만든 확장점은 확정된 요구인가, 불안의 표현인가?
- 이 모듈의 public contract와 private detail은 무엇인가?
- 성능 최적화의 근거는 계측인가, 추측인가?

## 정리

- 코드 원칙은 체크리스트가 아니라 변경 비용을 토론하는 언어다.
- SOLID는 React와 TypeScript에서는 계약, 변경 이유, 대체 가능성 중심으로 번역해야 한다.
- DRY는 같은 코드가 아니라 같은 지식과 변경 축에 적용한다.
- KISS와 YAGNI는 복잡도를 숨기거나 되돌리기 어려운 결정을 방치하라는 뜻이 아니다.
- Robustness와 최적화 원칙은 보안, 데이터 품질, 계측 증거와 함께 판단해야 한다.

## 확인 문제

1. 두 화면의 카드 UI가 거의 같아서 공통 컴포넌트로 합치자는 의견이 나왔다. DRY 관점에서 무엇을 확인해야 하는가?

<details>
<summary>정답과 해설</summary>

겉모양이 아니라 변경 이유가 같은지 확인해야 한다. 두 화면이 다른 정책, 권한, 데이터 lifecycle로 바뀐다면 공통화는 조건 분기를 늘릴 수 있다. 같은 제품 규칙과 디자인 계약으로 함께 바뀐다면 공통화가 적절할 수 있다.

</details>

2. Robustness Principle을 입력 검증에서 그대로 적용하면 어떤 문제가 생길 수 있는가?

<details>
<summary>정답과 해설</summary>

잘못된 입력을 조용히 보정하면 클라이언트 버그와 데이터 품질 문제가 숨을 수 있다. 보안 관련 입력에서는 관대함이 공격 표면을 넓힐 수 있다. 외부 경계에서는 명확한 검증과 실패가 더 안전할 수 있다.

</details>

3. `memo`를 많이 추가했는데 성능이 나아지지 않았다. Premature Optimization 관점에서 어떤 점검이 필요한가?

<details>
<summary>정답과 해설</summary>

실제 병목을 React Profiler, Performance 패널, bundle analyzer 등으로 확인했는지 점검해야 한다. 렌더링이 병목이 아닐 수 있고, props 안정성을 맞추는 비용이 더 클 수 있다.

</details>

## 참고 자료

- `hacker-laws/README.md`: 코드 원칙과 모듈 경계 관련 항목의 원문 목록이다.
- [Phase 4-2. 타입 설계](../phase-4/02-type-design.md): TypeScript 계약 설계와 런타임 경계를 연결해 읽는다.
- [Phase 5-1. React mental model](../phase-5/01-react-mental-model.md): 컴포넌트 경계와 렌더링 모델을 연결한다.
- [Phase 9-4. 구조 패턴과 경계](../phase-9/04-structural-and-boundary-patterns.md): 모듈 경계와 패턴 선택을 연결해 읽는다.
