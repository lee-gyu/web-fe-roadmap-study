# B-8. 점진적 진화와 아키텍처 의사결정

> 한 줄 요약: 현재 구조의 증거에서 출발해 Strangler Fig·ACL·Gateway/BFF로 경계를 점진적으로 옮기고, 선택·실패·철회 조건을 ADR과 진화 경로로 기록할 수 있다.

## 학습 목표

- Layered Monolith, Modular Monolith, Microservices 후보를 팀·배포·데이터 경계와 품질 속성 시나리오로 평가할 수 있다.
- Strangler Fig, Anti-Corruption Layer, API Gateway/BFF의 서로 다른 이전 책임을 설명할 수 있다.
- 잘못 나눈 service와 module 경계를 다시 합칠 때의 코드·데이터·조직 비용을 계획할 수 있다.
- Conway's Law와 팀 ownership을 아키텍처 경계의 증거이자 변경 대상으로 다룰 수 있다.
- 후보별 기대 증거, 실패 모드, 재검토·철회 조건을 ADR과 진화 경로 리포트로 작성할 수 있다.

## 배경: 왜 이것이 존재하는가

아키텍처는 첫날 완성되지 않는다. 제품과 팀이 바뀌고, 실제 부하와 변경 축이 드러나며, 처음의 domain 가설이 틀렸다는 증거가 쌓인다. 그런데 구조 변경은 흔히 “Monolith를 Microservices로 전환한다”처럼 목적지가 먼저 정해진다. 그러면 모든 module을 추출하는 것이 진척도로 보이고, 실제 품질 속성이 개선되는지는 뒤로 밀린다.

점진적 진화(evolutionary architecture)는 미래 구조를 정확히 예측하기보다 변화 방향과 fitness function을 정하고 작은 단계마다 검증한다. 모든 변경에는 공존 기간과 rollback 경로가 있다. 새 시스템만 설계하는 것보다 old/new routing, data synchronization, ownership handoff가 실제 작업의 대부분을 차지한다.

[Phase 10의 ADR 작성법](../phase-10/01-project-guide.md)은 결정을 반박 가능한 기록으로 만드는 형식을 다뤘다. 이 문서는 아키텍처 패턴의 forces, 품질 속성, 실패 시나리오, 진화 증거를 그 ADR의 입력으로 만드는 데 집중한다.

## 핵심 개념

### 목적지가 아니라 현재 마찰에서 시작한다

주문 monolith를 나누기 전에 다음 baseline을 수집한다.

| 지도·증거 | 질문 | 도구 예 |
|---|---|---|
| 변경 coupling | 어떤 파일·schema가 같은 PR에서 함께 바뀌는가 | Git history, code ownership |
| runtime 호출 | critical path와 fan-out은 어디인가 | distributed trace, profiler |
| 데이터 invariant | 어떤 값이 한 transaction에서 일관되어야 하는가 | schema, transaction log, domain workshop |
| 배포 흐름 | 누가 누구를 기다리고 rollback 범위는 어디까지인가 | CI/CD log, change lead time |
| 장애 전파 | 한 component 실패가 어디까지 번지는가 | incident timeline, error budget |
| 팀 책임 | build·data·on-call을 누가 소유하는가 | ownership map, escalation 기록 |

목표도 시나리오로 쓴다. “독립 배포”가 아니라 “결제 팀이 평일에 주문·재고 재배포 없이 결제 provider 변경을 30분 안에 배포하고 10분 안에 rollback한다”처럼 측정한다.

### 세 후보는 서로 다른 제약 조합이다

| 후보 | 적합한 forces | 얻는 것 | 새 실패 모드 | 피해야 할 조건 |
|---|---|---|---|---|
| Layered Monolith | 한 팀, 단순 domain, 공동 release | local call·transaction·debugging | 기능 변경의 layer 관통 | capability별 변경·팀 경계가 강함 |
| Modular Monolith | 여러 capability, 운영 단순성 유지 | module 계약과 local transaction | 경계 우회, 전체 deploy | architecture enforcement 여력 없음 |
| Microservices | 독립 팀·배포·부하·규제 경계 | process·data·release 격리 | network·분산 일관성·운영 복잡도 | 한 팀, 낮은 배포 빈도, 불명확한 domain |

Layered에서 Modular로 가거나 Modular에서 service를 추출할 수 있지만 이것은 maturity ladder가 아니다. 목표 품질을 현재 구조에서 더 싼 전술로 달성할 수 있다면 이동하지 않는다. 예를 들어 전체 build가 느린 문제는 build graph와 cache로, 장애 전파는 process worker와 bulkhead로, 팀 충돌은 module ownership으로 먼저 줄일 수 있다.

### Strangler Fig는 traffic을 조금씩 새 경로로 옮긴다

Strangler Fig는 legacy를 한 번에 교체하지 않고 proxy/router가 요청을 old 또는 new 구현으로 보낸다. 기능 단위로 새 경로를 늘리고 old 경로를 제거한다.

```text
Client → Router ─┬→ Legacy orders
                 └→ New order module/service

0% → internal users → 5% → 50% → 100% → legacy route 제거
```

안전한 절차는 다음과 같다.

1. 현재 behavior와 SLO를 characterization test와 metric으로 고정한다.
2. routing seam을 만든다.
3. read-only 또는 낮은 위험 기능을 새 구현으로 옮긴다.
4. shadow traffic이나 결과 비교로 semantic 차이를 관찰한다.
5. 작은 cohort에 write traffic을 보내고 rollback한다.
6. 데이터 source of truth를 하나로 수렴한 뒤 old path를 제거한다.

새 코드가 배포되었다고 이전이 끝난 것은 아니다. old route, synchronization job, compatibility flag, duplicate telemetry가 남아 있으면 운영 복잡도는 두 배다. 제거 조건과 날짜를 처음부터 정한다.

### Anti-Corruption Layer는 모델 오염을 막는 번역 경계다

ACL(Anti-Corruption Layer)은 새 domain model이 legacy의 용어·schema·protocol을 그대로 받아들이지 않도록 번역한다.

```ts
type LegacyOrderRow = {
  ORD_NO: string;
  PAY_YN: 'Y' | 'N';
  AMT: string;
};

type Order = {
  id: string;
  paymentStatus: 'PAID' | 'UNPAID';
  amount: number;
};

function translateOrder(row: LegacyOrderRow): Order {
  const amount = Number(row.AMT);
  if (!Number.isFinite(amount)) throw new Error('INVALID_LEGACY_AMOUNT');

  return {
    id: row.ORD_NO,
    paymentStatus: row.PAY_YN === 'Y' ? 'PAID' : 'UNPAID',
    amount,
  };
}

console.log(translateOrder({ ORD_NO: 'o-1', PAY_YN: 'Y', AMT: '42000' }));
// 출력: { id: 'o-1', paymentStatus: 'PAID', amount: 42000 }
```

ACL은 단순 mapper가 아니라 의미 차이를 소유한다. legacy의 `PAY_YN=Y`가 승인, 정산, 영수증 발행 중 무엇을 보장하는지 명시해야 한다. 번역 실패, unknown value, version skew를 metric으로 남긴다.

ACL이 영구 integration hub가 되면 새 bottleneck이 된다. 어느 legacy dependency가 제거되면 어떤 translator를 삭제할지 수명을 관리한다. 반대로 외부 시스템이 계속 존재하고 모델 차이가 본질적이면 ACL은 영구 boundary가 될 수 있다.

### Gateway와 BFF는 migration traffic과 client 계약을 분리한다

API Gateway는 routing, authentication, rate limit, protocol termination 같은 공통 진입 정책과 Strangler routing seam을 제공할 수 있다. BFF는 web/mobile별 aggregation과 표현 계약을 소유한다. 둘을 하나의 거대한 orchestration layer로 만들면 domain logic과 failure가 중앙에 집중된다.

```text
Clients → Gateway → old/new services
   │          │
   │          └─ 공통 auth, route, rate limit
   └→ BFF ────── client별 payload와 aggregation
```

migration 동안 gateway route는 versioned config, canary, timeout, rollback을 지원해야 한다. BFF는 old/new backend 차이를 잠시 숨길 수 있지만 compatibility code 제거 조건을 둔다.

### 데이터 이전이 코드 이전보다 어렵다

service 추출에서 가장 위험한 단계는 source of truth 전환이다. 대표 전략은 다음과 같다.

| 전략 | 이득 | 실패 모드 | 사용 조건 |
|---|---|---|---|
| shared DB 임시 유지 | 빠른 코드 분리 | schema ownership이 계속 결합 | 짧은 transitional 단계와 종료일 |
| dual write | old/new 동시 갱신 | 한쪽만 성공, 순서 역전 | Outbox·reconciliation로 보강 가능할 때 |
| CDC/event 복제 | write 경로 단순 | lag, schema 변화, replay | eventual consistency 허용 |
| bulk copy + cutover | 구조 단순 | downtime·delta 누락 | 데이터 작고 maintenance 가능 |
| read old, write new | source 전환 명확 | old reader와 compatibility | 단계별 client migration 가능 |

dual write를 application에서 순차 호출하는 것은 atomic하지 않다. [Transactional Outbox](./06-distributed-consistency-and-resilience.md), CDC, reconciliation과 사용자에게 보이는 stale 정책을 함께 설계한다. 전환 시점에는 row count보다 business invariant와 sample semantic diff를 비교한다.

### 잘못 나눈 경계는 다시 합칠 수 있어야 한다

서비스 합병은 실패의 낙인이 아니다. 두 서비스가 항상 함께 변경·배포되고 synchronous chatty call과 distributed transaction을 요구한다면 하나의 경계가 더 정직할 수 있다.

합병 비용은 다음에 걸쳐 있다.

- public API consumer와 version deprecation
- database key·schema·history 병합
- event topic과 ordering·idempotency 변경
- deployment·dashboard·alert·on-call 제거
- repository와 team ownership 재조정
- data residency·권한 경계 재검토

추출할 때 reverse migration도 설계한다. contract가 너무 넓거나 양쪽이 서로의 table을 필요로 하면 추출을 중단하고 module 경계를 다시 찾는다.

### Conway's Law는 관찰이자 설계 입력이다

[Conway's Law](../appendix-a/05-organization-teams-and-collaboration.md)는 시스템이 조직의 communication structure를 닮는 경향을 말한다. 네 팀이 하나의 shared module을 승인제로 운영하면 code boundary가 중앙 병목을 반영한다. 반대로 원하는 capability 경계를 기준으로 cross-functional team을 구성하는 inverse Conway maneuver도 가능하다.

조직도를 architecture diagram에 그대로 복사해서는 안 된다. 팀 변경은 code보다 느리고 책임 handoff에는 domain knowledge, on-call, data access, budget이 필요하다. 서비스마다 별도 팀을 만들면 작은 서비스의 운영 공백이 생길 수 있다. team cognitive load와 ownership 안정성을 함께 본다.

### ADR은 선택뿐 아니라 진화 가설을 기록한다

```md
# ADR-B-004. 결제 capability를 주문 monolith에서 점진 분리한다

## 상태
Proposed

## 품질 속성 시나리오
결제 팀은 다른 capability 재배포 없이 provider 변경을 30분 안에 배포하고
10분 안에 rollback할 수 있어야 한다. 주문 p99 증가는 100ms 이하여야 한다.

## 현재 증거
- 최근 20개 결제 PR 중 14개가 전체 release train을 4시간 이상 기다렸다.
- 결제와 주문은 `payment_status` table을 함께 쓴다.
- 단일 transaction이 필요한 환불 invariant 두 개가 아직 분리되지 않았다.

## 후보
1. 기존 Layered Monolith 유지 + build/deploy 개선
2. Modular Monolith에서 payment API와 schema ownership 강제
3. Payment Service 추출

## 결정
먼저 2를 선택한다. transaction 경계와 ownership을 검증한 후 3을 재평가한다.

## 기대 증거와 실패 모드
- 결제 변경의 80%가 payment module에 머문다.
- 직접 table 접근은 architecture test로 0건을 유지한다.
- module API가 주문 entity 전체를 노출하면 경계 설계를 중단한다.

## 재검토·철회 조건
- 독립 배포 대기 p95가 2시간을 넘고 팀이 별도 on-call을 운영한다면 service를 검토한다.
- cross-module transaction이 핵심 요청의 50%를 넘으면 module을 다시 합친다.
```

## 실무 관점

진화 경로 리포트는 단계마다 검증과 철회를 포함한다.

| 단계 | 변경 | 검증 증거 | 중단·rollback 조건 |
|---|---|---|---|
| 0. Baseline | 현재 지도와 SLO 작성 | trace, change coupling, incident | 문제·목표가 측정되지 않음 |
| 1. 논리 경계 | module API·ownership | direct import/query 감소 | cross-boundary 변경 증가 |
| 2. Routing seam | gateway/flag | old/new 결과 비교 | 오류·latency budget 초과 |
| 3. Data 이동 | CDC/outbox/cutover | lag·semantic diff·reconcile | invariant 불일치 |
| 4. 독립 운영 | deploy·on-call 분리 | lead time·blast radius | 운영 비용이 이득 초과 |
| 5. Cleanup | old route·data·flag 제거 | 잔여 traffic 0, owner 확인 | unknown consumer 존재 |

fitness function은 architecture 원칙을 실행 가능한 신호로 만든다. module 간 forbidden import, service별 schema write, API compatibility, p99 latency, 독립 배포 비율, team cognitive load를 CI와 dashboard에서 추적한다. metric이 목표가 되어 gaming되지 않도록 사용자 결과와 incident를 counter-metric으로 둔다.

적용 과제에서는 최소 세 후보를 같은 시나리오로 비교한다. 한 후보의 장점만 자세히 쓰지 않고 각 후보의 실패 모드와 더 나아지는 조건을 적는다. 구현하지 않은 architecture도 관측 가능한 가설이어야 한다.

## 더 깊이

진화 중에는 architecture quantum, 즉 높은 functional cohesion과 synchronous constraint 때문에 함께 배포되어야 하는 최소 단위를 관찰할 수 있다. network로 나뉘어도 한 transaction·같은 release·같은 runtime coupling이 필요하면 실제 quantum은 여전히 하나다. 반대로 monolith 안에서도 module이 독립 data와 contract를 가지면 분리 옵션을 보존한다.

feature flag와 canary는 code migration만이 아니라 architecture migration 도구다. cohort별 route, shadow read, compare-and-log, automatic rollback을 사용할 수 있다. 그러나 flag가 data source of truth를 모호하게 만들면 위험하다. 각 flag에 owner, 만료일, old/new write authority를 기록한다.

아키텍처 결정의 sunk cost를 경계한다. service 수, migration 진척률, 새 platform 투자 때문에 잘못된 경계를 유지하면 운영 손실이 누적된다. decision review는 “얼마나 만들었는가”보다 처음의 품질 시나리오가 실제로 개선되었는지 묻는다.

## 정리

- architecture 진화는 목표 패턴이 아니라 현재 마찰과 품질 속성 baseline에서 시작한다.
- Strangler Fig는 traffic을, ACL은 의미를, Gateway/BFF는 진입·client 계약을 점진적으로 분리한다.
- 데이터 source of truth 전환과 old path 제거까지 끝나야 migration이 완료된다.
- 잘못 나눈 경계를 합치는 것은 정상적인 진화이며 reverse migration 비용을 미리 기록해야 한다.
- ADR에는 현재 증거, 후보, 기대 증거, 실패 모드, 재검토·철회 조건을 함께 둔다.

## 확인 문제

1. monolith의 build가 느리다는 이유만으로 Microservices를 선택하려 한다. 먼저 비교할 더 싼 대안과 증거는 무엇인가?

   <details>
   <summary>정답과 해설</summary>

   incremental build, dependency graph, cache, test selection, module별 pipeline을 검토한다. 실제 병목 단계, 변경과 무관한 rebuild 비율, deploy 독립성이 필요한 팀 요구를 측정한다. build 문제만이면 network·data 분산 비용을 낼 근거가 약하다.

   </details>

2. Strangler migration에서 새 주문 read API가 준비되었다. 바로 write source도 두 곳으로 만들면 왜 위험한가?

   <details>
   <summary>정답과 해설</summary>

   순차 dual write는 한쪽만 성공하거나 순서가 뒤집힐 수 있다. source of truth와 replication 방향을 하나로 정하고 CDC/Outbox, lag 측정, reconciliation, rollback을 설계해야 한다.

   </details>

3. 두 서비스가 항상 함께 배포되고 호출의 90%가 서로 왕복한다. 합병 검토 시 어떤 비용을 목록화해야 하는가?

   <details>
   <summary>정답과 해설</summary>

   API consumer deprecation, database와 key 병합, event topic·ordering, deployment·관측·on-call 제거, repository·team ownership, 보안·규제 경계를 확인한다. local module 경계를 유지하면서 process를 합치는 경로도 후보로 둔다.

   </details>

4. ADR의 재검토 조건이 “필요할 때”뿐이다. 어떤 형태로 바꿔야 하는가?

   <details>
   <summary>정답과 해설</summary>

   독립 배포 대기 p95, cross-boundary transaction 비율, p99 latency, 팀 분리, 규제 변화처럼 관찰 가능한 threshold 또는 사건으로 바꾼다. review 날짜와 owner도 둔다.

   </details>

## 참고 자료

- [AWS Prescriptive Guidance — Strangler Fig](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html) — proxy, ACL, 데이터 동기화를 이용한 점진 교체 단계를 설명한다.
- [AWS Prescriptive Guidance — Anti-Corruption Layer](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/acl.html) — 서로 다른 domain model 사이의 번역 경계를 설명한다.
- [GitLab Handbook — Rails Monolith Decomposition](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/modular_monolith/) — module 경계를 먼저 강화하고 ROI가 있는 경계만 추출하는 실제 전략이다.
- [Martin Fowler — Microservice Premium](https://martinfowler.com/bliki/MicroservicePremium.html) — 서비스 분리의 선행 비용과 적용 시점을 판단하는 기준이다.
- [Michael Nygard — Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — ADR의 간결한 원형과 결정 변경 이력을 설명한다.

