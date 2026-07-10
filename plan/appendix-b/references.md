# 부록 B — 소프트웨어 아키텍처 패턴 조사 자료

> 조사일: 2026-07-10
>
> 목적: `ROADMAP.md`에 추가할 부록 B의 범위를 정하기 전에, 소프트웨어 아키텍처 패턴의 계열과 학습 우선순위를 조사한다.

## 1. 조사 결론

소프트웨어 아키텍처 패턴에는 모두가 합의한 단일 목록이 없다. 고전적인 POSA(*Pattern-Oriented Software Architecture*)는 Layers, Pipes and Filters, Blackboard, Broker, MVC, PAC, Microkernel, Reflection을 아키텍처 패턴으로 분류한다. 현대의 클라우드 아키텍처 카탈로그는 N-tier, Microservices, Event-driven architecture 같은 시스템 스타일과 Saga, Transactional Outbox, Circuit Breaker 같은 분산 시스템 패턴을 함께 다룬다. 프론트엔드에서는 MVC/MVVM, Flux 계열, BFF, Micro Frontends가 별도의 중요한 계보를 이룬다.

따라서 부록 B는 패턴 이름을 백과사전식으로 나열하기보다 다음 세 층위를 구분해야 한다.

1. **시스템 전체의 형태를 정하는 아키텍처 스타일**: Layered/N-tier, Modular Monolith, Microservices, Event-driven architecture, Client-Server, REST 등
2. **애플리케이션 내부의 경계와 의존성을 정하는 패턴**: Hexagonal/Ports and Adapters, Onion, Clean Architecture, MVC/MVVM, Microkernel 등
3. **선택한 스타일에서 반복되는 문제를 푸는 보조 패턴**: CQRS, Event Sourcing, Saga, Transactional Outbox, BFF, Strangler Fig, Circuit Breaker 등

같은 시스템에 여러 패턴이 함께 적용될 수 있다. 예를 들어 하나의 시스템은 배포 형태로는 Modular Monolith이고, 각 모듈 내부는 Hexagonal Architecture를 따르며, 모듈 간 통합에는 domain event와 Transactional Outbox를 사용할 수 있다. “어떤 패턴이 최고인가”가 아니라 **어떤 제약을 추가하면 어떤 품질 속성을 얻고 어떤 비용을 지불하는가**가 과정의 중심 질문이어야 한다.

## 2. 용어와 분류 기준

### 아키텍처 스타일과 아키텍처 패턴

- **아키텍처 스타일(architectural style)**은 구성 요소와 연결 방식에 제약을 부여해 같은 특성을 공유하는 아키텍처 집합을 만든다. REST처럼 제약의 조합으로 정의되거나, Microservices처럼 서비스와 데이터 소유권의 경계를 규정하는 경우가 대표적이다.
- **아키텍처 패턴(architectural pattern)**은 반복되는 시스템 수준 문제에 대해 맥락, 상충하는 힘(forces), 구조적 해법, 결과를 함께 기술한다. POSA는 이를 시스템의 기본 구조를 정하는 최상위 패턴으로 설명한다.
- 실제 문헌에서는 두 용어를 엄격히 구분하지 않는다. 이 조사에서도 원 출처의 명칭은 보존하되, 교육 과정에서는 “적용 범위와 제약”을 기준으로 분류한다.

### 디자인 패턴과의 경계

Phase 9가 다루는 Factory, Strategy, Observer, Adapter, Facade, Proxy 등은 주로 객체·모듈 수준의 설계 패턴이다. 부록 B는 다음 조건을 만족하는 주제에 집중한다.

- 시스템이나 주요 서브시스템의 경계와 책임을 바꾼다.
- 의존성 방향, 실행 흐름, 데이터 소유권, 배포 단위 중 하나 이상을 규정한다.
- 성능, 변경 용이성, 확장성, 가용성, 보안, 운영 복잡도 같은 품질 속성에 시스템 수준의 영향을 준다.
- 특정 프레임워크의 폴더 템플릿이 아니라 다른 기술 스택에도 옮길 수 있는 제약과 트레이드오프를 가진다.

### 패턴 선택의 평가 축

패턴은 아래 질문으로 비교한다. CMU SEI의 품질 속성 연구가 강조하듯, 아키텍처 선택은 여러 품질 속성 사이의 트레이드오프를 명시해야 한다.

| 평가 축 | 확인 질문 |
|---|---|
| 변경 용이성 | 변경이 어느 경계 안에 머무는가? 경계를 넘는 변경은 얼마나 자주 발생하는가? |
| 배포 독립성 | 일부 기능만 독립적으로 빌드·배포·롤백할 수 있는가? 그 능력이 실제로 필요한가? |
| 확장성과 성능 | 무엇을 독립적으로 확장할 수 있는가? 네트워크 hop, 직렬화, 복제 비용은 무엇인가? |
| 일관성과 신뢰성 | 강한 일관성이 필요한 범위는 어디인가? 실패·중복·순서 역전을 어떻게 복구하는가? |
| 테스트 가능성 | 핵심 로직을 UI, DB, 네트워크 없이 실행할 수 있는가? 통합 테스트 범위는 얼마나 넓은가? |
| 운영 복잡도 | 배포물, 데이터 저장소, 메시지 브로커, 관측 지점, 장애 모드가 얼마나 늘어나는가? |
| 팀과 소유권 | 코드·데이터·배포 경계가 실제 팀의 책임 경계와 일치하는가? |
| 진화 비용 | 경계를 잘못 정했을 때 합치거나 나누는 비용은 얼마인가? 점진적 이전 경로가 있는가? |

## 3. 패턴 계열별 조사

### 3.1 기본 구조와 실행 흐름

| 패턴/스타일 | 핵심 구조 | 얻는 것 | 주요 비용·경계 조건 | 과정 우선순위 |
|---|---|---|---|---|
| **Layered Architecture / N-tier** | presentation, application/domain, data 같은 수평 계층으로 책임과 의존성 방향을 나눈다. Layer는 논리 경계이고 tier는 물리 배포 경계이므로 둘을 구분해야 한다. | 익숙한 책임 분리, 단순한 의존성 규칙, 레거시·업무 시스템에 적용하기 쉬움 | 기능 하나가 여러 계층을 관통해 변경되고, 계층 우회와 domain logic 누수가 누적될 수 있음 | **핵심** |
| **Pipes and Filters** | 표준화된 입출력을 가진 filter를 pipe로 연결해 데이터를 단계적으로 변환한다. | 단계 재사용·재배치, 병렬화, streaming·batch 처리에 적합 | 오류·backpressure·순서·중간 상태 관리가 어려우며 대화형 트랜잭션에는 부적합할 수 있음 | **핵심** |
| **Blackboard** | 여러 전문 컴포넌트가 공유 지식 저장소를 읽고 쓰며, 제어 컴포넌트가 해법을 점진적으로 구성한다. | 하나의 알고리즘으로 풀기 어려운 문제에서 이질적인 해법을 결합 | 종료 조건, 충돌 해결, 재현성과 디버깅이 어려움. 일반 웹 CRUD에는 과도함 | 선택 |
| **Microkernel / Plugin Architecture** | 안정적인 core와 교체·추가 가능한 plugin 사이에 명시적 계약을 둔다. | 제품 변형, 확장성, 핵심 안정화, 제3자 확장 | plugin API 호환성, 격리·권한, 버전 관리와 lifecycle 관리가 새 핵심 문제가 됨 | **핵심** |
| **Broker** | 분산 컴포넌트가 broker를 통해 위치와 구현을 숨긴 채 통신한다. | location transparency, 송수신자 결합 완화 | broker 병목·장애, 직렬화, 전달 보장, 관측성 비용 | Event-driven 과정에서 포함 |
| **Reflection** | 시스템이 자신의 구조를 기술하는 meta-level과 실제 동작인 base-level을 분리한다. | 런타임 적응성과 확장 | 간접성으로 인한 이해·검증·성능 비용. 언어의 reflection API와 동일 개념으로 축소하면 안 됨 | 심화/역사 |
| **Presentation-Abstraction-Control (PAC)** | UI를 presentation, abstraction, control을 가진 계층적 agent로 분해한다. | 복잡한 대화형 시스템의 병렬적인 UI agent 구성 | 현대 웹에서는 MVC·component architecture보다 직접 적용 사례가 적고 통신 구조가 복잡함 | 역사/비교 |

고전 POSA 목록은 패턴의 출발점으로 유용하지만, 모든 항목을 같은 분량으로 가르칠 필요는 없다. 부록 B에서는 Layered, Pipes and Filters, Microkernel을 본문 후보로 두고 Blackboard, Reflection, PAC는 “패턴 카탈로그가 어떻게 진화했는가”를 보여 주는 비교 대상으로 두는 편이 적절하다.

### 3.2 애플리케이션 경계와 의존성

| 패턴/스타일 | 핵심 구조 | 얻는 것 | 주요 비용·경계 조건 | 과정 우선순위 |
|---|---|---|---|---|
| **Hexagonal Architecture / Ports and Adapters** | 업무 목적을 표현하는 port와 기술별 adapter를 두고 application core를 UI, DB, 외부 API에서 격리한다. | 테스트 가능성, 기술 교체 가능성, domain logic 보호 | port가 단순 wrapper로 늘어나면 ceremony만 증가한다. 외부 대체 가능성과 핵심 로직 복잡도가 낮은 작은 앱에는 과도할 수 있음 | **핵심** |
| **Onion Architecture** | domain model을 중심에 놓고 모든 의존성이 안쪽을 향하게 하며 infrastructure를 바깥으로 밀어낸다. | domain 중심의 의존성 역전, 장기 업무 애플리케이션의 변경 격리 | 계층 수와 추상화가 목적 없이 늘어날 수 있음 | Hexagonal과 한 계열로 비교 |
| **Clean Architecture** | entities/use cases/interface adapters/frameworks의 동심원과 dependency rule로 정책을 세부 구현에서 분리한다. | 업무 규칙의 프레임워크 독립성과 테스트 가능성 | 이름이 붙은 디렉터리를 복제하는 cargo cult, 단순 CRUD에서 mapping·interface 과잉 | Hexagonal/Onion과 한 계열로 비교 |
| **Modular Monolith** | 하나의 배포 단위·프로세스를 유지하되 업무 capability별 module 경계와 공개 계약을 강제한다. | 로컬 호출·단일 트랜잭션의 단순함과 강한 모듈 경계를 함께 추구 | 런타임이 경계를 강제하지 않으므로 architecture test, package visibility, ownership 규칙이 필요 | **핵심** |
| **Vertical Slice Architecture** | 기술 계층보다 use case/feature 단위로 요청 처리에 필요한 코드를 모은다. | 변경의 locality, 기능 단위 이해와 테스트 | 공통 규칙 중복, slice 간 일관성 저하, 공유 domain model과의 긴장 | 선택. Layered와 비교 |

Hexagonal, Onion, Clean Architecture는 서로 완전히 독립된 세 패턴이라기보다 **핵심 정책을 외부 기술에서 보호하고 의존성을 안쪽으로 향하게 하는 패턴 계열**로 가르치는 편이 낫다. 차이보다 공통 제약, port의 의미, 테스트 seam, 추상화 비용을 먼저 다룬다.

### 3.3 네트워크와 배포 단위

| 패턴/스타일 | 핵심 구조 | 얻는 것 | 주요 비용·경계 조건 | 과정 우선순위 |
|---|---|---|---|---|
| **Client-Server** | 사용자·표현 책임을 client에, 공유 자원·데이터 책임을 server에 둔다. | 관심사 분리, server 자원의 중앙 관리, 양쪽의 독립 진화 | server 병목·장애, network latency, protocol compatibility | REST의 기반으로 포함 |
| **REST** | client-server에 stateless, cache, uniform interface, layered system, optional code-on-demand 제약을 조합한다. | Web 규모의 가시성, 확장성, 독립 진화, 캐시 가능성 | 모든 HTTP JSON API가 REST는 아니다. chatty workflow, 실시간 push, 강한 session affinity에는 다른 상호작용이 필요할 수 있음 | **핵심** |
| **Service-Oriented Architecture (SOA)** | 업무 capability를 network service로 노출하고 계약을 통해 통합한다. | 이질적인 enterprise system 통합과 서비스 재사용 | 중앙 ESB·거버넌스가 병목이 되거나 서비스가 공유 DB에 강하게 결합될 수 있음 | Microservices의 계보로 비교 |
| **Microservices** | bounded context/업무 capability별로 독립 배포 가능한 service와 데이터 소유권을 둔다. | 강한 경계, 독립 배포·확장, 팀 자율성 | network·분산 데이터·관측·테스트·배포 복잡도가 기본 비용이다. 성숙한 DevOps와 명확한 경계가 없으면 손해가 큼 | **핵심** |
| **Peer-to-Peer** | 동등한 node가 client와 server 역할을 함께 하며 중앙 조정 의존성을 줄인다. | 자원 분산, 중앙 병목 완화, 일부 장애 내성 | discovery, trust, consistency, NAT·보안, 전체 관측이 어려움 | 선택 |
| **Space-Based Architecture** | 처리 unit과 분산 in-memory data grid를 통해 중앙 DB 병목을 피한다. | 급격한 부하에서의 탄력성과 높은 처리량 | 데이터 복제·일관성·운영 난도가 높고 일반 업무 시스템에는 과도함 | 선택/심화 |
| **Web-Queue-Worker** | 동기 web front와 장기 작업 worker를 queue로 분리한다. | 요청 latency 격리, front/worker 독립 확장, 단순한 비동기화 | queue 정체, 중복 처리, 작업 상태·실패 복구가 필요. 복잡한 domain에는 거대한 두 monolith가 될 수 있음 | 실용 사례 |
| **Serverless Architecture** | event-triggered function과 managed service를 조합하고 실행 인프라 관리를 provider에 위임한다. | 운영 부담·유휴 비용 감소, 이벤트 단위 확장 | cold start, 실행 제한, vendor coupling, 분산 관측과 로컬 재현 비용. 하나의 고정된 패턴보다 배포·운영 모델에 가까움 | 인접 개념 |

Monolith와 Microservices를 “낡음 대 최신”으로 배치해서는 안 된다. Monolith는 하나의 배포 단위라는 topology이고 내부가 무질서하다는 뜻이 아니다. Microservices는 독립 배포와 데이터 자율성의 이득을 얻는 대신 네트워크와 분산 데이터의 비용을 항상 지불한다. 과정에서는 **Layered Monolith → Modular Monolith → Microservices**를 성숙도 순서가 아니라 서로 다른 제약 조합으로 비교해야 한다.

### 3.4 이벤트, 메시징, 데이터 상태

| 패턴/스타일 | 핵심 구조 | 얻는 것 | 주요 비용·경계 조건 | 과정 우선순위 |
|---|---|---|---|---|
| **Event-Driven Architecture (EDA)** | producer가 event channel/broker에 사건을 발행하고 consumer가 비동기로 반응한다. broker topology와 mediator topology가 대표적이다. | 생산자·소비자 결합 완화, 독립 확장, 실시간 fan-out | 전달 보장, 순서, 중복, schema evolution, eventual consistency, end-to-end 추적이 어려움 | **핵심** |
| **Publish-Subscribe** | publisher가 subscriber를 알지 않고 topic에 메시지를 발행하며 여러 subscriber가 각각 수신한다. | fan-out과 독립적인 소비자 추가 | 구독·전달 의미, 느린 소비자, 중복 처리, 민감 정보 노출 관리 | EDA의 기본 패턴 |
| **CQRS** | command/write model과 query/read model을 분리하고 필요하면 저장소와 확장 전략도 분리한다. | 읽기·쓰기 모델의 독립 최적화, 복잡한 업무 명령의 명시화 | 단순 CRUD에는 복잡도만 증가한다. 저장소 분리 시 stale read와 동기화 실패를 다뤄야 함 | **핵심** |
| **Event Sourcing** | 현재 상태 대신 상태를 만든 immutable event의 append-only sequence를 진실의 원천으로 저장한다. | 감사 이력, replay, 새 projection 생성, 변경 의도 보존 | event schema의 영구 호환성, projection 재구축, snapshot, 삭제·개인정보 요구가 어려움 | **핵심** |
| **Saga** | 여러 service의 local transaction을 choreography 또는 orchestration으로 연결하고 실패 시 compensating transaction을 수행한다. | 분산 transaction coordinator 없이 장기 업무 흐름의 일관된 종착 상태 추구 | 보상은 rollback과 같지 않다. 중간 상태 노출, idempotency, 격리 부족, 흐름 추적 비용 | Microservices와 함께 |
| **Transactional Outbox** | 업무 데이터 변경과 발행할 메시지를 한 local transaction에 기록하고 별도 relay가 broker로 전달한다. | DB commit과 event publish 사이의 dual-write 불일치 완화 | relay 운영, 중복 전달, 순서·정리 정책이 필요하므로 consumer idempotency는 여전히 필요 | **핵심 보조 패턴** |
| **Materialized View** | 원본 데이터나 event에서 읽기 목적에 맞춘 미리 계산된 projection을 만든다. | 복잡한 query의 latency와 부하 감소 | 갱신 지연, rebuild, source와 view의 일관성 관리 | CQRS/Event Sourcing과 함께 |

세 용어를 반드시 분리한다.

- Event-driven architecture는 컴포넌트 간 **통신과 제어 흐름**에 관한 스타일이다.
- Event Sourcing은 aggregate의 **상태 저장 모델**이다.
- CQRS는 **읽기와 쓰기의 모델 분리**이다.

이 셋은 함께 쓰일 수 있지만 서로를 필수로 요구하지 않는다. 특히 CQRS를 쓴다고 Event Sourcing이 자동으로 필요한 것은 아니며, Event Sourcing은 시스템 전체가 아니라 감사·replay 가치가 높은 일부 aggregate에 선택적으로 적용할 수 있다.

### 3.5 분산 시스템의 통합·복원·진화 패턴

다음 항목은 시스템 전체 스타일이라기보다 Microservices와 EDA를 실제로 운영하기 위해 필요한 보조 패턴이다. 별도 백과사전식 챕터보다 구체적인 실패 시나리오와 함께 묶어야 한다.

| 문제 | 관련 패턴 | 핵심 판단 |
|---|---|---|
| 외부 진입점과 service routing | **API Gateway**, Gateway Routing/Aggregation/Offloading | 중앙화할 cross-cutting concern과 gateway가 병목·단일 장애점이 되는 경계를 구분한다. |
| client별 backend 요구 충돌 | **Backends for Frontends (BFF)** | web/mobile 등 client별 API·성능·release ownership이 실제로 다를 때만 분리한다. client가 하나이거나 요구가 같으면 중복이다. |
| 일시적 원격 장애 | **Retry with Backoff**, timeout | retry가 안전한 작업인지, retry storm을 만드는지, 전체 latency budget 안에 있는지 먼저 판단한다. |
| 지속되는 원격 장애 | **Circuit Breaker** | 실패를 빠르게 반환해 자원 고갈을 막되 half-open 복구와 fallback의 정확성을 설계한다. |
| 장애 격리 | **Bulkhead** | thread/connection pool과 배포 자원을 분리해 한 의존성의 실패가 전체로 번지는 것을 제한한다. |
| 여러 service에 작업 분산 | **Scatter-Gather**, Competing Consumers | 부분 응답, straggler, fan-out 비용, 결과 합성 규칙을 정의한다. |
| 레거시 모델 격리 | **Anti-Corruption Layer (ACL)** | 새 모델이 레거시 언어와 계약에 오염되지 않도록 번역 경계를 둔다. 영구 중간 계층이 되지 않도록 수명도 정한다. |
| 점진적 현대화 | **Strangler Fig** | proxy/routing으로 기능을 하나씩 새 시스템으로 이전한다. domain 경계를 모른 채 성급히 추출하면 분산된 결합만 남는다. |
| 분산 workflow | **Saga** | 참여자가 적고 흐름이 단순하면 choreography, 흐름 가시성과 중앙 제어가 중요하면 orchestration을 검토한다. |
| DB 변경과 event 발행 | **Transactional Outbox** | atomicity는 local transaction으로 확보하지만 at-least-once 전달과 중복 소비를 별도로 처리한다. |

### 3.6 UI와 프론트엔드 아키텍처

| 패턴/스타일 | 핵심 구조 | 얻는 것 | 주요 비용·경계 조건 | 과정 우선순위 |
|---|---|---|---|---|
| **MVC** | model, view, controller로 사용자 입력과 표현, 상태를 분리한다. | UI 관심사 분리와 여러 view 가능성 | Smalltalk MVC, server-side web MVC, client MVC가 서로 다른 변형이다. React를 억지로 MVC의 V라고만 설명하면 실제 data flow를 놓침 | **핵심 비교** |
| **MVP** | passive view와 presentation logic을 가진 presenter 사이에 명시적 계약을 둔다. | view 테스트와 UI toolkit 격리 | presenter 비대화와 forwarding code 증가 | 비교 |
| **MVVM** | declarative view를 data binding으로 view model의 state·command와 연결한다. | UI와 presentation logic의 결합 완화, binding 기반 동기화 | 양방향 binding의 암묵적 갱신 흐름, view model 비대화, framework 의존 | **핵심 비교** |
| **Flux / Redux 계열의 단방향 데이터 흐름** | action/event가 중앙화된 update logic을 거쳐 state를 바꾸고 view가 새 state를 읽는다. | 상태 변경 경로의 예측 가능성, 기록·재현·도구 지원 | 작은 지역 상태까지 중앙화하면 boilerplate와 간접성이 커진다. server state cache와 client state도 구분해야 함 | **핵심** |
| **Micro Frontends** | 사용자 가치의 vertical slice별로 독립 개발·테스트·배포 가능한 frontend를 하나의 제품으로 합성한다. | 팀 자율성, 점진적 upgrade, 독립 배포 | 중복 bundle, UX·design system 파편화, runtime integration, 공유 상태·routing, 조직 거버넌스 비용 | **핵심 심화** |
| **Backends for Frontends** | frontend 종류나 팀마다 요구에 맞춘 backend adapter/API를 소유한다. | client 맞춤 payload·latency·release cadence, frontend 팀의 end-to-end ownership | 인증·관측·업무 규칙 중복, service 증가. 범용 API나 GraphQL로 충분한지 비교 필요 | **핵심** |

SSR, SSG, CSR, streaming SSR, Islands Architecture는 렌더링·hydration 경계를 정하는 웹 아키텍처 주제이지만 이미 Phase 8의 렌더링 전략과 직접 겹친다. 부록 B에서는 중복 설명하지 않고, frontend architecture가 배포 경계와 데이터 흐름을 결정할 때 해당 문서로 연결하는 편이 적절하다.

## 4. 비슷해 보이지만 같은 종류가 아닌 개념

| 개념 | 분류 시 주의점 |
|---|---|
| **Domain-Driven Design (DDD)** | 패턴 하나가 아니라 복잡한 domain을 모델링하고 경계를 찾는 설계 접근이다. Bounded Context, Aggregate, Anti-Corruption Layer 등은 아키텍처 선택에 강하게 영향을 주지만 DDD 전체를 하나의 아키텍처 패턴으로 부르지 않는다. |
| **SOLID, DRY, KISS, YAGNI** | 설계 원칙·휴리스틱이다. 부록 A와 Phase 9에서 다루며, 시스템 topology를 직접 정의하지 않는다. |
| **Monorepo / Polyrepo** | source repository 운영 전략이다. 배포 경계와 일치할 수도 있지만 Monorepo라고 Monolith인 것도, Polyrepo라고 Microservices인 것도 아니다. |
| **Container, Kubernetes, Function as a Service** | 실행·배포 기술이다. Microservices나 Serverless 선택을 지원하지만 기술 자체가 업무 경계를 결정하지 않는다. |
| **Atomic Design, Feature-Sliced Design** | 각각 UI design system 방법론과 frontend code organization 방법론으로 유용하지만, 출처와 적용 범위가 아키텍처 패턴 카탈로그와 다르다. frontend 보충 사례로 다룰 수 있다. |
| **Repository, Active Record, Data Mapper** | persistence 경계의 application architecture pattern이다. Fowler의 엔터프라이즈 애플리케이션 패턴으로 다루되 시스템 전체 스타일과 같은 층위에 놓지 않는다. Phase 9와의 중복도 확인한다. |
| **Circuit Breaker, Retry, Cache-Aside** | 신뢰성·데이터 접근을 위한 전술적 패턴이다. 단독으로 전체 아키텍처를 설명하지 않지만 분산 스타일을 선택하면 필수 설계 요소가 된다. |

## 5. 부록 B 과정에 대한 잠정 범위 제안

아직 `ROADMAP.md`의 최종 문서 목록은 확정하지 않는다. 조사 결과를 실제 과정으로 바꿀 때는 다음 묶음이 중복을 줄이면서도 핵심 계보를 설명하기 좋다.

1. **패턴을 선택하는 법** — style/pattern/tactic의 층위, forces와 quality attributes, 패턴 조합과 경계 조건
2. **프로세스 내부 구조** — Layered, Pipes and Filters, Microkernel, Blackboard/PAC/Reflection 비교
3. **핵심 보호와 모듈 경계** — Hexagonal, Onion, Clean Architecture, Modular Monolith, Vertical Slice
4. **네트워크 시스템의 형태** — Client-Server, REST, SOA, Microservices, Web-Queue-Worker
5. **이벤트와 상태 모델** — EDA, Pub/Sub, CQRS, Event Sourcing, Materialized View
6. **분산 일관성과 복원력** — Saga, Transactional Outbox, idempotency, Circuit Breaker, Bulkhead, Retry
7. **프론트엔드 아키텍처 계보** — MVC/MVP/MVVM, Flux/Redux, BFF, Micro Frontends
8. **진화 전략과 의사결정** — Monolith↔Microservices의 비용, Strangler Fig/ACL, 조직 경계, 패턴 조합을 ADR로 검증

### 우선 포함할 핵심 패턴

- Layered/N-tier
- Pipes and Filters
- Microkernel/Plugin
- Hexagonal/Ports and Adapters와 Onion/Clean 계열
- Modular Monolith
- Client-Server와 REST
- Microservices와 Event-driven architecture
- CQRS와 Event Sourcing
- Saga와 Transactional Outbox
- MVC/MVVM, Flux, BFF, Micro Frontends
- Strangler Fig와 Anti-Corruption Layer

### 비교·심화로 축소할 패턴

- Blackboard, Broker, PAC, Reflection
- SOA, Peer-to-Peer, Space-Based Architecture
- Web-Queue-Worker, Serverless Architecture
- MVP, Vertical Slice Architecture
- API Gateway, Circuit Breaker, Bulkhead, Retry, Scatter-Gather 등 보조 패턴

### 현재 커리큘럼과의 중복 방지

- **Phase 9**: 객체·모듈 수준의 GoF 및 JavaScript/React 합성 패턴은 반복하지 않는다. Adapter나 Observer가 아키텍처 수준에서 어떻게 확장되는지만 연결한다.
- **Phase 5-6**: React 상태 아키텍처와 Flux를 연결하되 useState, Context, external store 사용법을 다시 가르치지 않는다.
- **Phase 8**: REST의 architectural constraints는 다루되 HTTP 기본, 보안, SSR/RSC/렌더링 전략은 링크로 위임한다.
- **Phase 10**: ADR 작성법을 반복하지 않고, 패턴 선택의 forces와 품질 속성을 ADR 입력으로 만드는 사례를 제공한다.
- **부록 A**: Conway's Law, CAP, SOLID 같은 법칙·원칙 자체를 다시 설명하지 않고 아키텍처 패턴의 경계 조건을 판단할 때 참조한다.

## 6. 권위 있는 참고 자료

### 고전 패턴과 개념적 기반

- [Buschmann et al. — Pattern-Oriented Software Architecture, Chapter 2: Architectural Patterns](https://www.oreilly.com/library/view/pattern-oriented-software-architecture/9781118725269/9781118725269_c02.xhtml) — 아키텍처 패턴을 최상위 시스템 구조로 정의하고 Layers, Pipes and Filters, Blackboard, Broker, MVC, PAC, Microkernel, Reflection의 고전 목록을 제시한다.
- [Roy T. Fielding — Architectural Styles and the Design of Network-based Software Architectures](https://roy.gbiv.com/pubs/dissertation/fielding_dissertation.pdf) — Client-Server부터 REST까지 제약을 단계적으로 합성하고 각 제약이 유도하는 품질 속성을 설명하는 원전이다.
- [CMU SEI — Quality Attributes](https://www.sei.cmu.edu/library/quality-attributes/) — 성능, 신뢰성, 변경 용이성 같은 품질 속성을 아키텍처와 연결해 객관적인 트레이드오프를 평가해야 한다는 근거다.
- [Martin Fowler — Catalog of Patterns of Enterprise Application Architecture](https://martinfowler.com/eaaCatalog/) — Layering, domain logic, persistence, web presentation, distribution 패턴을 시스템 스타일보다 한 단계 낮은 application architecture 수준에서 분류할 때 사용한다.

### 경계와 의존성 패턴 원전

- [Alistair Cockburn — Hexagonal Architecture: the original 2005 article](https://alistair.cockburn.us/hexagonal-architecture) — Ports and Adapters의 intent, UI·DB 없는 테스트, 안과 밖의 비대칭, port를 기술이 아닌 목적으로 정의하는 이유를 설명한다.
- [Jeffrey Palermo — The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — 장기 업무 애플리케이션에서 domain 중심 의존성과 infrastructure 외부화를 제안한 원문 시리즈의 시작점이다.
- [Robert C. Martin — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — Hexagonal, Onion 등 여러 선행 아이디어의 공통점을 dependency rule로 정리한 원문이다.
- [AWS Prescriptive Guidance — Hexagonal architecture pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html) — 현대적인 cloud workload에서의 적용 조건, testability 이득, adapter 유지 비용을 함께 확인할 수 있다.
- [GitLab Handbook — Rails Monolith Decomposition](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/modular_monolith/) — 실제 대형 monolith에서 bounded context와 명시적으로 강제되는 dependency를 만들고, ROI가 분명한 module만 service로 추출한다는 진화 전략을 보여 준다.
- [Jimmy Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) — 기술 계층 대신 change axis와 use case를 따라 코드를 결합해 slice 사이 결합을 줄이자는 제안의 원문이다.

### 현대 시스템 스타일과 분산 패턴

- [Azure Architecture Center — Architecture styles](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/) — N-tier, Web-Queue-Worker, Microservices, Event-driven, Big Data, Big Compute를 dependency 관리 방식과 domain 특성으로 비교한다. 목록이 완전하지 않다고 명시한 점도 중요하다.
- [Azure Architecture Center — Event-driven architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven) — publish-subscribe와 event stream, broker와 mediator topology, 전달·순서·eventual consistency의 경계 조건을 설명한다.
- [Mark Richards — Software Architecture Patterns](https://www.oreilly.com/content/software-architecture-patterns/) — Layered, Event-driven, Microkernel, Microservices, Space-Based 패턴을 동일한 품질 속성 축으로 비교한다.
- [Martin Fowler — Microservice Trade-Offs](https://martinfowler.com/articles/microservice-trade-offs.html) — 강한 module boundary와 독립 배포라는 이득을 distribution, eventual consistency, 운영 성숙도 비용과 함께 비교한다.
- [Martin Fowler — Microservice Premium](https://martinfowler.com/bliki/MicroservicePremium.html) — Microservices가 모든 시스템에 기본값이 아니라 초기 비용과 위험을 추가한다는 판단 기준을 제공한다.
- [AWS Well-Architected — Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html) — serverless workload의 운영, 보안, 신뢰성, 성능, 비용을 architecture decision으로 평가하는 공식 지침이다.
- [AWS Prescriptive Guidance — Cloud design patterns, architectures, and implementations](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/introduction.html) — ACL, Circuit Breaker, Event Sourcing, Hexagonal, Pub/Sub, Saga, Strangler Fig, Transactional Outbox의 공식 카탈로그다.
- [AWS Prescriptive Guidance — Saga patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html) — choreography와 orchestration, forward recovery와 compensation의 차이를 비교한다.
- [AWS Prescriptive Guidance — Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) — database update와 message publish 사이 dual-write 문제를 푸는 구조와 중복 처리 조건을 설명한다.
- [AWS Prescriptive Guidance — Strangler Fig](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html) — monolith를 점진적으로 교체하는 proxy, ACL, 데이터 동기화 단계와 잘못된 경계 추출의 위험을 설명한다.
- [AWS Prescriptive Guidance — Circuit Breaker](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/circuit-breaker.html) — 지속되는 원격 장애를 빠르게 차단하고 복구 상태를 관리하는 보조 패턴의 공식 설명이다.
- [Azure Architecture Center — Bulkhead pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead) — dependency별 resource pool과 service instance를 격리해 cascading failure를 제한하는 조건과 자원 효율 비용을 설명한다.

### 데이터와 상태 패턴

- [Azure Architecture Center — CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) — read/write model 분리의 단계, 독립 저장소 사용 시 eventual consistency, 단순 CRUD에 부적합한 조건을 설명한다.
- [Azure Architecture Center — Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) — append-only event store, replay, snapshot, event versioning, 선택적 적용 조건을 설명한다.
- [Azure Architecture Center — Materialized View pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view) — 원본 query가 비싸거나 직접 질의하기 어려울 때 목적별 projection을 만들고 갱신 지연을 관리하는 패턴을 설명한다.
- [Martin Fowler — Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) — 애플리케이션 상태의 모든 변경을 event sequence로 기록하고 재구성하는 패턴의 초기 설명이다.

### UI와 프론트엔드 아키텍처

- [POSA Chapter 2](https://www.oreilly.com/library/view/pattern-oriented-software-architecture/9781118725269/9781118725269_c02.xhtml) — MVC와 PAC를 객체 패턴이 아니라 대화형 시스템의 아키텍처 패턴으로 다룬다.
- [Microsoft Learn — Data binding and MVVM](https://learn.microsoft.com/en-us/windows/uwp/data-binding/data-binding-and-mvvm) — MVVM을 UI와 non-UI code를 분리하는 UI architectural design pattern으로 정의하고 data binding의 역할과 도입 비용을 설명한다.
- [Redux — A Brief History of Redux](https://redux.js.org/understanding/history-and-design/history-of-redux) — event emitter 기반 MVC의 예측 불가능성에서 Flux의 단방향 update path와 Redux의 reducer 모델로 이어진 배경을 설명한다.
- [Redux — Prior Art](https://redux.js.org/understanding/history-and-design/prior-art) — Flux, Elm과 Redux의 공통점과 차이를 공식 문서 관점에서 비교한다.
- [Azure Architecture Center — Backends for Frontends](https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends) — client별 backend 분리의 적용 조건, 중복 비용, API Gateway·GraphQL과의 경계를 설명한다.
- [Cam Jackson — Micro Frontends](https://martinfowler.com/articles/micro-frontends.html) — 독립 배포 가능한 frontend의 정의, integration 방식, 팀 자율성과 payload·거버넌스 비용을 함께 다룬다.

## 7. 후속 기획 시 확인할 질문

- 부록 B의 독자가 실제로 선택·비교할 수 있어야 하는 핵심 패턴 수는 몇 개인가?
- frontend 중심 사례와 backend/distributed system 사례의 비율을 어떻게 배분할 것인가?
- 하나의 reference application을 Layered → Modular Monolith → Microservices로 변형해 비교할 것인가, 패턴마다 독립 사례를 둘 것인가?
- 각 패턴의 “적합하지 않은 조건”과 제거·이전 전략까지 한 문서 안에 포함할 수 있는가?
- 코드 구조만 보여 주지 않고 latency, failure, deployability, testability를 관찰할 검증 실습을 어떻게 구성할 것인가?
- 고전 패턴 중 Blackboard, PAC, Reflection을 독립 학습 대상으로 남길 가치가 있는가, 역사적 비교로 충분한가?
- DDD, Serverless, Vertical Slice처럼 패턴 경계가 논쟁적인 주제를 본문과 보충 자료 중 어디에 둘 것인가?
