# B-4. 네트워크 시스템과 배포 단위

> 한 줄 요약: Client-Server·REST·SOA·Microservices와 여러 운영 topology를 독립 배포, 데이터 소유권, 네트워크 비용으로 비교할 수 있다.

## 학습 목표

- Client-Server와 REST의 제약 합성이 어떤 품질 속성을 만드는지 설명할 수 있다.
- SOA와 Microservices의 계보를 서비스 크기가 아닌 계약·데이터·배포·팀 소유권으로 비교할 수 있다.
- Monolith와 Microservices를 성숙도 단계가 아닌 서로 다른 topology와 비용 구조로 판단할 수 있다.
- Web-Queue-Worker, Peer-to-Peer, Space-Based, Serverless의 적용 문제와 운영 경계를 구분할 수 있다.

## 배경: 왜 이것이 존재하는가

프로세스 경계를 넘는 순간 함수 호출의 전제가 사라진다. 호출은 느리고 실패하며 중복될 수 있고, 양쪽 version이 다를 수 있다. 로컬 transaction 대신 부분 성공과 복구를 설계해야 한다. 그 대가로 component를 독립적으로 배포·확장·격리하고 서로 다른 기술과 팀을 연결할 수 있다.

네트워크 시스템 스타일은 “더 잘게 나누기”의 목록이 아니다. REST는 Web 규모에서 독립 진화를 위한 제약의 조합이고, Microservices는 업무·데이터·배포 경계를 서비스에 맞춘다. Web-Queue-Worker는 긴 작업을 비동기화한다. 각각 다른 문제를 풀며 동시에 사용할 수도 있다.

## 핵심 개념

### Client-Server는 책임과 진화를 분리한다

Client-Server는 client가 사용자 상호작용과 요청을 맡고 server가 공유 자원과 서비스를 관리하도록 분리한다. server는 여러 client가 공유하는 데이터와 정책을 중앙화하고, client는 표현과 상호작용을 독립적으로 바꿀 수 있다.

분리는 새 비용을 만든다. network latency, server 장애, protocol compatibility, 인증·인가 경계가 생긴다. client와 server의 독립 진화는 계약이 안정되고 version skew를 허용할 때만 가능하다. 같은 날 함께 배포해야 하는 breaking change가 반복되면 물리적으로는 분리되어도 진화 결합은 강하다.

### REST는 HTTP JSON의 동의어가 아니라 제약의 합성이다

Fielding의 REST(Representational State Transfer)는 다음 제약을 조합한다.

| 제약 | 얻는 품질 | 지불하는 비용·주의점 |
|---|---|---|
| Client-Server | 관심사와 진화 분리 | network 경계와 계약 관리 |
| Stateless | 요청 단위 가시성·확장·복구 | 매 요청 context 전달, 대화 상태 표현 비용 |
| Cache | latency·server load 감소 | stale과 invalidation |
| Uniform Interface | 상호작용 단순화·중간자 가시성 | domain별 최적 protocol보다 비효율 가능 |
| Layered System | proxy·gateway·cache 삽입 | end-to-end 경로 가시성 저하 |
| Code-on-Demand(선택) | client 기능 확장 | 가시성과 보안 저하 |

Uniform Interface에는 resource 식별, representation을 통한 조작, self-descriptive message, HATEOAS 제약이 포함된다. 따라서 URL과 JSON을 쓰는 RPC endpoint가 자동으로 REST가 되지는 않는다.

stateless는 server가 아무 상태도 저장하지 않는다는 뜻이 아니다. client session의 요청 해석에 필요한 context가 각 요청에 충분히 포함되어 특정 server memory에 의존하지 않는다는 뜻이다. database의 주문 상태는 당연히 server에 남는다.

```ts
type OrderRepresentation = {
  id: string;
  status: 'PENDING' | 'PAID';
  links: { rel: 'self' | 'pay'; href: string; method: 'GET' | 'POST' }[];
};

const order: OrderRepresentation = {
  id: 'o-1',
  status: 'PENDING',
  links: [
    { rel: 'self', href: '/orders/o-1', method: 'GET' },
    { rel: 'pay', href: '/orders/o-1/payment', method: 'POST' },
  ],
};

console.log(order.links.find((link) => link.rel === 'pay')?.href);
// 출력: /orders/o-1/payment
```

실시간 양방향 상호작용, 매우 chatty한 workflow, 낮은 overhead의 내부 통신에는 WebSocket, streaming RPC, message가 더 맞을 수 있다. REST를 전체 시스템의 종교가 아니라 public resource API의 제약 집합으로 적용할 수 있다.

### SOA와 Microservices는 크기보다 독립성의 종류가 다르다

SOA(Service-Oriented Architecture)는 이질적인 enterprise capability를 network service 계약으로 통합하는 계보다. 중앙 ESB가 routing, transformation, orchestration, policy를 맡는 구현이 흔했지만 SOA의 필수 정의를 하나의 제품으로 축소해서는 안 된다.

Microservices는 작은 코드량보다 다음 경계를 함께 강조한다.

- 업무 capability 또는 bounded context
- 서비스가 소유하는 데이터와 schema
- 독립 build, deploy, rollback
- cross-functional team의 end-to-end ownership
- lightweight protocol과 분산 거버넌스

| 축 | 전형적 SOA 경향 | Microservices가 강조하는 경향 |
|---|---|---|
| 통합 | enterprise-wide 계약·중앙 통합 | 서비스별 계약·분산된 결정 |
| 데이터 | 공유 enterprise data model 가능 | 서비스별 데이터 소유권 |
| 배포 | 공동 release·중앙 운영 가능 | 독립 배포와 자동화 필수 |
| middleware | ESB에 transformation·orchestration 집중 | smart endpoint, 단순한 pipe 선호 |
| 팀 | 기능 조직과 중앙 governance | capability를 소유하는 product team |

이는 역사적 경향이지 모든 실제 시스템을 이분법으로 분류하는 표가 아니다. 이름보다 실제 계약과 운영을 관찰한다.

### Microservices는 분산 시스템 비용을 기본값으로 만든다

주문·결제·재고를 서비스로 나누면 각각 독립 배포하고 부하를 따로 확장할 수 있다. 장애 격리도 가능하다. 동시에 주문 생성 한 번에 network hop, authentication, serialization, timeout, partial failure가 들어온다.

```text
Client → Order Service → Payment Service → Inventory Service
             │                 │                  │
          order DB          payment DB         stock DB

어느 화살표도 늦거나 실패하거나 중복될 수 있다.
```

데이터 소유권이 없다면 서비스 경계는 약하다. Order Service가 Payment table을 직접 수정하면 결제 배포와 schema 진화가 주문에 결합된다. 반대로 데이터를 분리하면 하나의 ACID transaction이 사라져 [Saga와 Outbox](./06-distributed-consistency-and-resilience.md) 같은 명시적 일관성 설계가 필요하다.

Microservices premium을 지불할 근거는 독립 배포 대기, capability별 부하 격차, 보안·규제 경계, 팀 ownership 같은 실제 요구다. “나중에 커질 것”은 측정되지 않은 forces다.

### Modular Monolith는 Microservices의 전 단계가 아니다

| 구조 | 배포 단위 | 호출·transaction | 경계 강제 | 대표 비용 |
|---|---|---|---|---|
| Layered Monolith | 하나 | local, 단일 transaction 용이 | layer 규칙 | 기능 변경의 수직 확산 |
| Modular Monolith | 하나 | local, 단일 transaction 유지 가능 | module API·data ownership 자동화 | process 격리 부족 |
| Microservices | 여러 개 | network, 분산 일관성 | process·deployment·data 경계 | 운영과 실패 모드 증가 |

경계가 분명한 Modular Monolith는 많은 팀에 최종 형태가 될 수 있다. 서비스가 많다고 성숙한 것도 아니다. distributed monolith는 여러 process의 비용을 내면서 공동 배포와 shared data의 결합도 유지한다.

### 다른 topology는 서로 다른 병목을 푼다

#### Web-Queue-Worker

동기 web 요청과 오래 걸리는 작업을 queue로 분리한다. 이미지 변환, 보고서 생성, 이메일 전송처럼 요청 안에서 끝낼 필요가 없는 작업에 적합하다.

```text
Web → Queue → Worker
 │       │        │
202    backlog   retry / dead-letter
```

front와 worker를 독립 확장하고 요청 latency를 격리하지만 작업 상태, 중복 처리, queue 정체, poison message, 취소를 설계해야 한다. queue length, oldest-message age, 처리 시간, retry 횟수를 관찰한다.

#### Peer-to-Peer와 Space-Based

Peer-to-Peer는 node가 client와 server 역할을 함께 하며 중앙 병목을 줄인다. 자원 분산과 일부 장애 내성을 얻지만 discovery, trust, NAT traversal, consistency, 전체 관측이 어려워진다.

Space-Based Architecture는 분산 in-memory data grid와 processing unit으로 중앙 database 병목을 피한다. 급격한 부하에 높은 처리량을 얻을 수 있지만 복제·일관성·memory 비용과 운영 난도가 크다. 일반 업무 CRUD의 기본값이 아니다.

#### Serverless

Serverless는 단일 패턴보다 event-triggered function과 managed service를 조합하는 배포·운영 모델에 가깝다. 유휴 server 관리와 일부 scaling 부담을 provider에 넘기지만 cold start, 실행 한도, vendor contract, 분산 관측, 로컬 재현 비용이 생긴다. 함수 수가 많다는 이유로 업무 경계가 좋아지지 않는다.

## 실무 관점

| 관찰된 문제 | 먼저 검토할 선택 | 확인할 반대 비용 |
|---|---|---|
| 공개 resource API와 독립 client | REST 제약 | chatty flow, 실시간 push, representation 비용 |
| 긴 작업이 요청 latency를 지배 | Web-Queue-Worker | 중복·취소·진행 상태·queue 운영 |
| 팀 간 공동 배포 대기 | Modular Monolith 경계 또는 Microservices | data consistency와 운영 성숙도 |
| capability별 급격히 다른 부하 | 독립 process/service | network hop과 복제 비용 |
| 짧고 드문 event 작업 | Serverless | cold start, 실행 한도, lock-in |

분리 전 baseline은 요청 trace와 배포 흐름에서 얻는다. p95/p99 latency를 hop별로 나누고, timeout budget을 기록한다. 배포는 팀 승인 수, 변경 lead time, rollback 범위, 독립 배포 비율을 본다. 운영 준비는 service별 dashboard, trace propagation, on-call, automated rollback, 계약 테스트가 있는지 확인한다.

분리는 성능 최적화가 아닐 수 있다. process 분리 후 평균 latency가 낮아져도 p99가 network tail latency에 의해 나빠질 수 있다. OpenTelemetry trace나 cloud APM으로 fan-out과 critical path를 확인하고 load test 조건을 함께 기록한다.

## 더 깊이

네트워크 경계는 fallacy를 제거하지 않고 드러낸다. retry는 실패를 숨길 수 있지만 non-idempotent 결제를 중복 실행할 수 있다. service discovery는 topology 변화를 처리하지만 잘못된 endpoint와 stale route를 만든다. gateway는 인증과 routing을 중앙화하지만 single choke point가 될 수 있다.

서비스 경계를 찾을 때 호출 빈도만 줄이는 방식은 부족하다. 함께 지켜야 하는 invariant와 데이터 ownership이 더 중요하다. 하나의 강한 transaction이 필요한 데이터를 성급히 나누면 모든 요청이 Saga가 된다. 반대로 독립적으로 바뀌고 다른 규제를 받는 capability를 한 schema에 묶으면 조직과 배포가 결합된다.

API versioning도 topology의 일부다. provider와 consumer가 독립 배포되려면 additive change, tolerant reader, deprecation window, consumer-driven contract test가 필요하다. 같은 repository에 있다는 이유로 호환성 문제를 무시하면 runtime version skew에서 실패한다.

## 정리

- process 경계는 독립 배포·확장·격리를 주는 대신 latency·부분 실패·version skew를 만든다.
- REST는 HTTP JSON이 아니라 stateless, cache, uniform interface 등을 합성한 style이다.
- Microservices는 코드 크기보다 업무·데이터·배포·팀 ownership의 독립성을 요구한다.
- Modular Monolith와 Microservices는 성숙도 단계가 아니라 서로 다른 비용 구조다.
- Web-Queue-Worker, Peer-to-Peer, Space-Based, Serverless는 각기 다른 병목과 운영 모델을 푼다.

## 확인 문제

1. REST의 stateless 제약을 “server가 database를 사용하지 않는다”로 해석하면 왜 틀리는가?

   <details>
   <summary>정답과 해설</summary>

   stateless는 요청 해석에 필요한 client session context가 각 요청에 포함되어 특정 server memory에 의존하지 않는다는 뜻이다. resource state는 server에 저장된다.

   </details>

2. 주문과 결제를 서비스로 분리했지만 shared table을 쓰고 항상 함께 배포한다. 어떤 이득은 얻지 못하고 어떤 비용은 이미 내는가?

   <details>
   <summary>정답과 해설</summary>

   데이터와 배포 독립성을 얻지 못한다. 반면 network latency, serialization, 원격 실패, 분산 관측 비용은 이미 생긴다. 전형적인 distributed monolith 신호다.

   </details>

3. 보고서 생성 API가 60초 걸린다. Web-Queue-Worker로 바꿀 때 `202 Accepted`를 반환하는 것 외에 무엇을 설계해야 하는가?

   <details>
   <summary>정답과 해설</summary>

   작업 ID와 상태 조회, idempotency, 취소, retry·dead-letter, 중복 결과, queue backlog와 처리 시간 관측, 결과 보존 기간, 사용자 알림을 설계해야 한다.

   </details>

## 참고 자료

- [Roy T. Fielding — Architectural Styles and REST](https://roy.gbiv.com/pubs/dissertation/fielding_dissertation.pdf) — Client-Server에서 REST까지 제약을 합성한 원전이다.
- [Azure Architecture Center — Architecture styles](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/) — N-tier, Web-Queue-Worker, Microservices, Event-Driven style을 비교한다.
- [Martin Fowler — Microservice Trade-Offs](https://martinfowler.com/articles/microservice-trade-offs.html) — 강한 경계와 독립 배포의 이득을 분산 비용과 함께 설명한다.
- [Martin Fowler — Microservice Premium](https://martinfowler.com/bliki/MicroservicePremium.html) — Microservices가 기본값이 아닌 이유와 초기 비용을 다룬다.
- [AWS Well-Architected — Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html) — Serverless workload의 운영·신뢰성·비용 판단 기준이다.

