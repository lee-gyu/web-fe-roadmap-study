# B-1. 아키텍처 패턴을 읽는 기준

> 한 줄 요약: 패턴 이름이 아니라 패턴이 강제하는 제약과 품질 속성 시나리오를 기준으로 아키텍처 대안을 비교할 수 있다.

## 학습 목표

- 아키텍처 스타일(architectural style), 아키텍처 패턴(architectural pattern), 전술(tactic), 디자인 패턴(design pattern)의 적용 범위를 구분할 수 있다.
- 패턴을 context-problem-forces-solution-consequences 구조로 해체해 설명할 수 있다.
- 모호한 품질 목표를 관찰 가능한 품질 속성 시나리오(quality attribute scenario)로 바꿀 수 있다.
- 패턴 조합의 이득과 충돌, 적용하지 않을 조건, 철회 조건을 ADR 입력으로 만들 수 있다.

## 배경: 왜 이것이 존재하는가

아키텍처 토론은 이름에서 쉽게 멈춘다. 한 팀은 Clean Architecture라고 부르고 다른 팀은 Hexagonal Architecture라고 부르지만, 실제 코드는 모두 HTTP handler가 ORM entity를 직접 반환할 수 있다. 반대로 이름을 붙이지 않은 시스템도 모듈 공개 계약, 데이터 소유권, 독립적인 실패 격리를 엄격히 지킬 수 있다. 중요한 것은 이름의 정확성보다 시스템에 실제로 가해진 제약이다.

[Phase 9의 설계 패턴](../phase-9/01-patterns-as-design-vocabulary.md)은 객체와 모듈 수준에서 설계 어휘를 다뤘다. 부록 B는 범위를 시스템과 주요 서브시스템으로 넓힌다. 여기서 선택은 의존성 방향, 실행 흐름, 데이터 소유권, 배포 단위 중 하나 이상을 바꾸며 성능·가용성·변경 용이성·운영 비용에 장기적인 영향을 준다.

이 문서 전체에서 작은 주문 시스템을 공통 사례로 사용한다. 주문 접수, 결제 승인, 재고 예약, 알림 전송이 있고, 초기에는 한 팀이 하나의 프로세스로 배포한다고 가정한다. 이후 문서에서 같은 시스템을 layer, module, service, event로 다르게 나누며 비용이 어디로 이동하는지 비교한다.

## 핵심 개념

### 이름보다 적용 범위를 먼저 구분한다

문헌은 style과 pattern을 일관되게 구분하지 않는다. 교육과 설계 리뷰에서는 다음처럼 적용 범위로 구분하는 편이 실용적이다.

| 층위 | 주로 규정하는 것 | 예 | 검토 질문 |
|---|---|---|---|
| 아키텍처 스타일 | 시스템 전체의 요소와 연결 제약 | REST, Microservices, Event-Driven Architecture | 전체 topology와 상호작용 방식이 어떻게 달라지는가 |
| 아키텍처 패턴 | 반복되는 시스템 수준 문제의 구조적 해법 | Layers, Hexagonal, Microkernel | 어떤 context와 forces에서 이 구조가 유효한가 |
| 전술 | 특정 품질 속성을 개선하는 국소적 결정 | timeout, retry, circuit breaker, cache | 어느 실패나 자원 병목을 통제하는가 |
| 디자인 패턴 | 객체·함수·모듈의 협력 구조 | Strategy, Adapter, Observer | 한 프로세스 안의 변경을 어떻게 국소화하는가 |

층위는 우열이나 규모 순서가 아니다. Microservices를 선택해도 timeout 전술이 자동으로 생기지 않고, Hexagonal Architecture를 적용해도 배포 단위가 나뉘지 않는다. 하나의 서비스 안에서 Adapter 패턴을 사용하고, 시스템 간 통신에는 Event-Driven Architecture를 적용하며, 원격 호출에는 Circuit Breaker를 둘 수 있다.

### 패턴은 `context-problem-forces-solution-consequences`로 읽는다

폴더 구조만 복사하지 않으려면 패턴을 다섯 질문으로 해체한다.

```text
Context      어떤 시스템과 조직 상태인가?
Problem      반복해서 발생하는 구체적 문제는 무엇인가?
Forces       동시에 만족하기 어려운 힘은 무엇인가?
Solution     어떤 경계와 연결 제약을 추가하는가?
Consequences 무엇을 얻고, 어떤 새 비용과 실패 모드가 생기는가?
```

주문 시스템을 Microservices 후보로 검토해 보자.

- Context: 주문·결제·재고를 서로 다른 팀이 소유하고 배포 충돌이 월 수십 회 발생한다.
- Problem: 하나의 배포물 때문에 작은 변경도 전체 회귀 테스트와 공동 릴리스를 요구한다.
- Forces: 팀 자율성은 높이고 싶지만 주문과 결제의 강한 일관성, 낮은 지연, 운영 인력도 중요하다.
- Solution: 업무 capability와 데이터 소유권을 서비스 경계로 분리하고 독립 배포한다.
- Consequences: 배포 독립성을 얻지만 네트워크 실패, 중복 메시지, 분산 추적, 데이터 정합성 문제가 정상 경로에 들어온다.

같은 구조도 context가 바뀌면 답이 달라진다. 한 팀이 주 1회 함께 배포하고 트래픽도 작다면 서비스 분리는 원래 문제를 풀지 않으며 분산 비용만 추가한다.

### 품질 속성은 시나리오로 바꿔야 비교할 수 있다

“확장 가능해야 한다”, “유지보수하기 쉬워야 한다”는 검증할 수 없는 목표다. 품질 속성 시나리오는 자극(source/stimulus), 환경, 대상, 응답, 측정값을 붙여 판단을 구체화한다.

```ts
type QualityScenario = {
  source: string;
  stimulus: string;
  environment: string;
  artifact: string;
  response: string;
  measure: string;
};

const deployability: QualityScenario = {
  source: 'checkout-team',
  stimulus: '결제 수단 하나를 추가한다',
  environment: '평일 트래픽을 처리하는 중',
  artifact: 'checkout capability',
  response: '다른 기능을 다시 배포하지 않고 변경을 배포·롤백한다',
  measure: '30분 이내, 다른 팀 승인 0회, 주문 중단 0초',
};

console.log(deployability.measure);
// 출력: 30분 이내, 다른 팀 승인 0회, 주문 중단 0초
```

대표 평가 축은 다음과 같다.

| 품질 속성 | 시나리오에 넣을 측정값 | 자주 숨는 반대 비용 |
|---|---|---|
| 변경 용이성 | 변경 파일·모듈·팀 수, lead time | 추상화와 중복 증가 |
| 성능 | p50/p95/p99 latency, 처리량, 자원 사용량 | 캐시 stale, 복제, 복잡한 invalidation |
| 가용성 | 허용 중단 시간, 오류 예산, 복구 시간 | 데이터 불일치, 운영 비용 |
| 배포 독립성 | 독립 build/deploy/rollback 비율 | 계약 테스트와 관측 지점 증가 |
| 테스트 가능성 | 외부 시스템 없는 핵심 테스트 비율과 실행 시간 | adapter와 test double 유지 비용 |
| 보안 | trust boundary, 최소 권한, 감사 범위 | 사용자 마찰과 운영 절차 |

한 패턴이 모든 속성을 동시에 개선한다고 주장하면 의심해야 한다. 예를 들어 캐시는 latency와 가용성을 개선할 수 있지만 신선도와 invalidation 복잡도를 희생한다. 서비스 분리는 팀별 배포 독립성을 높일 수 있지만 호출 latency와 장애 표면을 늘린다.

### 구조 제약과 배포 현실을 따로 관찰한다

다이어그램은 의도를 보여 줄 뿐 런타임이 지키는 사실을 보장하지 않는다. 다음 네 지도를 함께 그려야 한다.

1. 코드 의존성 지도: import와 호출이 어느 방향으로 흐르는가.
2. 런타임 상호작용 지도: 동기 호출, message, shared storage가 어디를 잇는가.
3. 데이터 소유권 지도: 누가 schema를 바꾸고 누가 직접 읽고 쓰는가.
4. 배포·팀 지도: 무엇을 함께 배포하며 누가 on-call과 rollback을 책임지는가.

Microservices 다이어그램인데 모든 서비스가 하나의 database schema를 직접 수정하고 하나의 release train으로 배포된다면 독립 경계는 약하다. 반대로 하나의 프로세스라도 module API와 database schema 접근을 빌드·테스트로 강제하면 의미 있는 구조 경계를 가질 수 있다.

### 패턴은 조합되며 조합은 충돌할 수 있다

주문 시스템은 다음처럼 여러 층위를 조합할 수 있다.

```text
배포 topology     Modular Monolith
모듈 내부 경계    Ports and Adapters
비동기 작업       Web-Queue-Worker
상태 조회          CQRS의 논리적 read model
복원력 전술        timeout + 제한된 retry + idempotency key
```

조합은 자동으로 일관되지 않는다. REST의 stateless 제약과 sticky session은 긴장하고, Event Sourcing의 영구 event 이력은 개인정보 삭제 요구와 충돌할 수 있다. Vertical Slice로 변경 locality를 높이면서 모든 slice가 하나의 domain model을 공유하면 slice 독립성이 다시 낮아질 수 있다. 조합을 검토할 때는 각 패턴이 같은 축에 서로 반대 제약을 가하지 않는지 확인한다.

## 실무 관점

패턴 선택 리뷰에는 최소한 다음 표를 둔다.

| 후보 | 추가하는 제약 | 기대 증거 | 새 실패 모드 | 부적합 조건 | 철회·이전 경로 |
|---|---|---|---|---|---|
| Layered Monolith | 수평 layer와 단방향 의존 | 신규 기능의 책임 위치가 일관됨 | 기능 변경이 모든 layer를 관통 | 기능별 변경 빈도가 높고 layer 우회가 누적됨 | feature module로 점진 이동 |
| Modular Monolith | module 공개 계약과 직접 접근 금지 | 변경 파일·팀 수 감소 | 런타임 강제 부족, 내부 API 비대화 | 업무 경계를 찾을 증거가 없음 | 경계를 합치거나 일부만 service 추출 |
| Microservices | 독립 배포와 service별 데이터 소유 | 독립 배포율·장애 격리 개선 | network·데이터 불일치·운영 표면 증가 | 한 팀, 낮은 배포 빈도, 운영 자동화 부족 | service 합병, routing·데이터 이전 |

결정 전에 baseline을 수집한다. Git history에서 함께 바뀌는 파일, CI의 build/deploy 시간, incident의 전파 경로, database query와 network trace, 팀별 대기 시간을 본다. 구조를 바꾼 뒤 같은 지표를 다시 측정해야 “깔끔해졌다”가 아니라 실제 효과를 말할 수 있다.

아키텍처 다이어그램은 정답 그림이 아니라 검증 가설이다. 화살표가 동기인지 비동기인지, 신뢰 경계를 넘는지, 실패가 어디로 반환되는지, 데이터의 authoritative source가 어디인지 표기한다. 화살표가 많다는 이유만으로 나쁜 구조는 아니지만 의미를 설명하지 못하는 화살표는 숨은 결합일 가능성이 높다.

## 더 깊이

아키텍처는 런타임 구조만이 아니라 진화 가능성에 관한 결정이다. 변경 비용은 현재 component 수보다 변경이 경계를 가로지르는 빈도에 좌우된다. 이 때문에 정적 조직도나 도메인 명사만으로 경계를 정하기보다 다음 증거를 함께 본다.

- 같은 이유로 함께 변경되는 파일과 schema
- 같은 transaction에서 일관되어야 하는 invariant
- 독립적으로 확장되는 부하 형태
- 장애와 rollback을 함께 책임지는 팀
- 서로 다른 release cadence와 보안 등급

선택하지 않기도 아키텍처 결정이다. 외부 기술이 하나뿐이고 핵심 로직이 단순한 CRUD라면 모든 persistence 호출 뒤에 port와 mapper를 두지 않을 수 있다. 그 대신 ORM 결합이 커지는 신호와 분리 시점을 기록한다. YAGNI는 미래를 무시하라는 뜻이 아니라, 미래 가설에 현재 비용을 지불하기 전에 관측 신호를 정하라는 뜻에 가깝다.

ADR에는 결과뿐 아니라 반증 조건을 남긴다.

```md
# ADR-012. 주문 시스템을 우선 Modular Monolith로 유지한다

## 맥락과 forces
- 한 팀이 주문·결제·재고를 함께 운영한다.
- 주문 생성은 세 capability의 강한 transaction을 요구한다.
- 독립 배포 대기 시간의 p95는 현재 20분이다.

## 결정
모듈 공개 API와 schema ownership을 강제하되 하나의 배포 단위를 유지한다.

## 기대 증거
- capability 변경의 80%가 한 module에 머문다.
- 전체 build와 rollback은 현재 수준을 넘지 않는다.

## 재검토 조건
- 팀이 분리되고 공동 배포 대기 p95가 4시간을 넘는다.
- capability별 부하 또는 보안 격리가 필요해진다.
```

## 정리

- 아키텍처의 핵심은 패턴 이름이 아니라 의존성·흐름·데이터·배포에 가하는 제약이다.
- style, pattern, tactic, design pattern은 적용 범위가 다르며 한 시스템에서 함께 쓰인다.
- 패턴은 context-problem-forces-solution-consequences와 품질 속성 시나리오로 비교한다.
- 구조 선택은 원하는 속성을 얻는 대신 새 실패 모드와 운영 비용을 만든다.
- baseline, 기대 증거, 부적합 조건, 철회 경로가 있어야 선택을 검증하고 되돌릴 수 있다.

## 확인 문제

1. 한 팀이 운영하는 작은 CRUD 서비스에 controller-service-repository-interface-adapter를 모두 도입했다. 테스트 가능한 구조라는 주장만 있을 때 어떤 추가 질문으로 필요성을 검증하겠는가?

   <details>
   <summary>정답과 해설</summary>

   교체 가능성이 있는 외부 기술, 핵심 업무 규칙의 복잡도, 외부 없이 실행해야 할 테스트, 실제 변경이 경계를 가로지르는 빈도를 묻는다. 이 증거가 약하면 추상화가 품질 속성을 개선하지 않고 forwarding code와 mapping 비용만 만들 수 있다. 도입하지 않는 대신 결합이 커지는 관측 신호를 정할 수 있다.

   </details>

2. 서비스가 열 개로 배포되지만 shared database와 공동 release train을 사용한다. 이것을 Microservices라고 부르는 것보다 어떤 사실을 기록해야 하는가?

   <details>
   <summary>정답과 해설</summary>

   서비스별 schema 쓰기 권한, 독립 build/deploy/rollback 가능 여부, 동기 호출과 장애 전파, 팀별 ownership을 기록한다. 프로세스 수보다 데이터와 배포의 실제 독립성이 품질 속성을 결정한다.

   </details>

3. 캐시 도입이 성능을 개선한다는 주장을 품질 속성 시나리오로 바꾸고, 함께 악화될 수 있는 속성을 제시하라.

   <details>
   <summary>정답과 해설</summary>

   예: 정상 트래픽에서 상품 조회 p95를 300ms에서 100ms 이하로 줄이고 origin 요청률을 70% 낮춘다. 동시에 데이터 신선도 지연, invalidation 실패, 메모리 비용, cache stampede와 장애 시 stale 응답 정책을 관찰해야 한다.

   </details>

## 참고 자료

- [CMU SEI — Quality Attributes](https://www.sei.cmu.edu/library/quality-attributes/) — 품질 속성을 아키텍처 트레이드오프와 연결하는 출발점이다.
- [Roy T. Fielding — Architectural Styles and the Design of Network-based Software Architectures](https://roy.gbiv.com/pubs/dissertation/fielding_dissertation.pdf) — 제약을 조합해 style과 품질 속성을 도출하는 원전이다.
- [Pattern-Oriented Software Architecture, Chapter 2](https://www.oreilly.com/library/view/pattern-oriented-software-architecture/9781118725269/9781118725269_c02.xhtml) — context와 forces를 포함한 고전 아키텍처 패턴의 범위를 제시한다.
- [Martin Fowler — Catalog of Patterns of Enterprise Application Architecture](https://martinfowler.com/eaaCatalog/) — 시스템 style보다 낮은 application architecture 패턴의 범위를 비교할 수 있다.

