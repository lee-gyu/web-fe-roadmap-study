# B-5. 이벤트·메시징·상태 모델

> 한 줄 요약: EDA, Publish-Subscribe, CQRS, Event Sourcing, Materialized View를 통신·명령·저장·조회라는 서로 다른 축으로 구분하고 필요한 조합만 선택할 수 있다.

## 학습 목표

- Event-Driven Architecture의 broker와 mediator topology를 제어 흐름과 결합도 관점에서 비교할 수 있다.
- Publish-Subscribe와 event stream의 보존·재처리·소비 위치 차이를 설명할 수 있다.
- CQRS의 논리적 모델 분리와 물리적 저장소 분리를 구분하고 적용 단계를 선택할 수 있다.
- Event Sourcing의 append-only event, replay, snapshot, schema evolution 비용을 평가할 수 있다.
- EDA, CQRS, Event Sourcing, Materialized View가 서로 독립적인 선택인 이유를 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

동기 호출은 실행 순서와 오류 반환이 눈에 보인다. 주문 서비스가 결제 서비스를 호출하고 응답을 기다리면 어느 호출이 실패했는지 추적하기 쉽다. 그러나 생산자는 소비자의 latency와 가용성에 결합되고, fan-out이 늘면 critical path가 길어진다. 이벤트와 메시징은 시간적 결합을 낮추고 독립 확장을 가능하게 하지만, 제어 흐름과 상태 일관성을 암묵적으로 만든다.

여기에 CQRS와 Event Sourcing을 함께 언급하면 용어가 더 섞인다. “이벤트를 쓴다”는 말은 알림 메시지를 발행한다는 뜻일 수도, event log를 database의 source of truth로 쓴다는 뜻일 수도 있다. 이 문서는 통신 style, 읽기·쓰기 모델, 상태 저장 모델, 조회 projection을 별개의 결정으로 분리한다.

## 핵심 개념

### event는 일어난 사실이고 command는 의도다

command는 특정 수신자에게 작업을 요청하며 거부될 수 있다. event는 이미 일어난 사실을 과거형으로 알리고 여러 consumer가 각자 반응한다.

```ts
type Command = {
  type: 'ChargePayment';
  orderId: string;
  amount: number;
};

type DomainEvent = {
  type: 'PaymentApproved';
  eventId: string;
  orderId: string;
  amount: number;
  occurredAt: string;
};

const command: Command = { type: 'ChargePayment', orderId: 'o-1', amount: 42_000 };
const event: DomainEvent = {
  type: 'PaymentApproved',
  eventId: 'e-1',
  orderId: command.orderId,
  amount: command.amount,
  occurredAt: '2026-07-10T00:00:00Z',
};

console.log(event.type);
// 출력: PaymentApproved
```

`ApprovePaymentRequested`처럼 사실처럼 보이는 command 이름은 책임을 흐린다. event producer는 이미 일어난 사실의 schema와 의미를 소유하고, consumer는 그 사실에 반응한다. event에 “누가 다음에 무엇을 해야 한다”는 workflow 지시를 과도하게 넣으면 느슨한 결합이 이름만 남는다.

### EDA는 event가 제어 흐름을 움직이는 style이다

Event-Driven Architecture(EDA)에서는 producer가 사건을 발행하고 consumer가 비동기로 처리한다. producer는 consumer의 존재와 완료 시점을 직접 알지 않아 fan-out과 독립 확장이 쉬워진다. 그 대신 전체 결과가 언제 완료되는지, 어느 consumer가 실패했는지, 순서와 중복을 어떻게 처리하는지 별도 protocol이 필요하다.

대표 topology는 broker와 mediator다.

```text
Broker topology                   Mediator topology

OrderPlaced → Broker → Payment    StartOrder → Mediator → Payment
                     → Inventory                      → Inventory
                     → Email                          → Email

consumer가 다음 event를 발행       mediator가 workflow와 상태를 조정
```

broker topology는 중앙 workflow 지식이 적고 consumer 추가가 쉽다. 그러나 event chain이 길어지면 흐름과 완료 조건을 찾기 어렵다. mediator topology는 순서, timeout, 보상, 상태를 한곳에서 볼 수 있지만 mediator가 결합과 병목의 중심이 될 수 있다. 단순 fan-out에는 broker가, 긴 business workflow의 가시성과 제어에는 mediator가 더 적합할 수 있다.

### Publish-Subscribe와 event stream은 전달 후의 세계가 다르다

Publish-Subscribe는 publisher가 topic에 message를 보내고 활성 subscription이 각 사본을 받는 fan-out 모델이다. event stream은 보존된 순서열에 event를 append하고 consumer가 offset을 관리하며 과거부터 다시 읽을 수 있는 모델이다.

| 축 | Pub/Sub 중심 | Event stream 중심 |
|---|---|---|
| 보존 | 전달 후 짧게 보존하거나 제거 가능 | retention 기간 동안 log에 유지 |
| 소비 위치 | subscription과 delivery 상태 | partition별 offset |
| 재처리 | 별도 dead-letter·replay 설계 | offset을 되돌려 재소비 가능 |
| 순서 | topic 전체 또는 제한된 ordering | 보통 partition 내부 순서 |
| 대표 용도 | 알림·fan-out·integration event | event log, analytics, projection 구축 |

제품마다 구현 의미가 다르므로 “broker가 exactly-once를 지원한다” 같은 문구만으로 end-to-end 처리를 단정하지 않는다. acknowledgement 이전 consumer crash, transaction commit 이후 ack 실패, redelivery를 timeline으로 검증한다.

### schema는 producer와 미래 consumer 사이의 장기 계약이다

비동기 message는 producer와 consumer가 다른 version으로 실행되는 시간을 늘린다. queue에 과거 message가 남고 새로운 consumer가 replay할 수도 있다. event schema는 현재 consumer뿐 아니라 미래의 재처리와도 호환되어야 한다.

안전한 진화의 기본은 additive change와 tolerant reader다. 필드를 추가하되 old consumer가 무시할 수 있게 하고, 의미를 바꾸는 필드는 새 이름이나 새 event type/version으로 도입한다. 삭제와 rename은 retention, replay, 모든 consumer migration을 확인한 뒤 진행한다. schema registry와 compatibility check는 문서가 아니라 build gate로 만든다.

### CQRS는 읽기와 쓰기의 모델을 분리한다

CQRS(Command Query Responsibility Segregation)는 상태를 바꾸는 command model과 데이터를 반환하는 query model을 분리한다. 가장 가벼운 형태는 같은 database와 codebase에서 command DTO와 query DTO만 다르게 두는 것이다.

```ts
type PlaceOrder = { customerId: string; lines: { productId: string; quantity: number }[] };
type OrderSummary = { orderId: string; itemCount: number; displayStatus: string };

function validate(command: PlaceOrder): void {
  if (command.lines.length === 0) throw new Error('EMPTY_ORDER');
}

function toSummary(orderId: string, command: PlaceOrder): OrderSummary {
  return {
    orderId,
    itemCount: command.lines.reduce((sum, line) => sum + line.quantity, 0),
    displayStatus: '주문 접수',
  };
}

const command: PlaceOrder = {
  customerId: 'c-1',
  lines: [{ productId: 'p-1', quantity: 2 }],
};
validate(command);
console.log(toSummary('o-1', command));
// 출력: { orderId: 'o-1', itemCount: 2, displayStatus: '주문 접수' }
```

필요하면 read storage를 분리하고 event나 CDC(Change Data Capture)로 갱신한다. 이 단계부터 read-after-write가 stale할 수 있고 동기화 실패, projection rebuild, 운영 저장소가 늘어난다. CQRS를 선택했다고 물리 저장소까지 즉시 분리할 필요는 없다.

CQRS는 쓰기 invariant가 복잡하고 읽기 형태가 여러 개이며 부하 특성이 크게 다를 때 가치가 있다. 동일 schema의 단순 CRUD라면 command/query model과 handler가 중복될 뿐이다.

### Event Sourcing은 상태 저장 모델이다

Event Sourcing은 현재 row 대신 상태를 만든 domain event의 append-only sequence를 source of truth로 저장한다. 현재 상태는 event를 순서대로 fold해 재구성한다.

```ts
type OrderEvent =
  | { type: 'OrderPlaced'; total: number }
  | { type: 'PaymentApproved' }
  | { type: 'OrderCancelled'; reason: string };

type OrderState = {
  total: number;
  status: 'EMPTY' | 'PENDING' | 'PAID' | 'CANCELLED';
};

function evolve(state: OrderState, event: OrderEvent): OrderState {
  switch (event.type) {
    case 'OrderPlaced':
      return { total: event.total, status: 'PENDING' };
    case 'PaymentApproved':
      return { ...state, status: 'PAID' };
    case 'OrderCancelled':
      return { ...state, status: 'CANCELLED' };
  }
}

const events: OrderEvent[] = [
  { type: 'OrderPlaced', total: 42_000 },
  { type: 'PaymentApproved' },
];

const state = events.reduce(evolve, { total: 0, status: 'EMPTY' });
console.log(state);
// 출력: { total: 42000, status: 'PAID' }
```

이 모델은 감사 이력, 과거 시점 재현, 새 projection 생성에 강하다. 그러나 event는 이미 저장된 history이므로 schema를 단순 수정할 수 없다. upcaster로 old event를 읽을 때 변환하거나 migration event를 추가해야 한다. event의 의미가 당시 코드와 외부 데이터에 의존하면 replay 결과가 달라질 수 있으므로 결정에 필요한 사실을 event에 보존해야 한다.

event가 수천 개 쌓인 aggregate는 매번 처음부터 replay하기 비싸다. snapshot은 특정 version의 state를 저장하고 이후 event만 적용한다. snapshot은 source of truth가 아니라 재생 최적화이며 schema version과 무효화 정책이 필요하다.

삭제와 개인정보 요구도 경계다. immutable history에 개인정보를 직접 저장하면 삭제·정정 요구와 충돌한다. 암호화 키 삭제, tokenization, 별도 개인정보 vault 같은 설계가 필요하지만 복잡도가 크다. 감사 가치가 높은 일부 aggregate에 선택적으로 적용하는 편이 일반적이다.

### Materialized View는 조회 목적의 파생 상태다

Materialized View는 원본 데이터나 event에서 query에 맞춘 projection을 미리 계산한다. 주문 상세 aggregate가 아니라 “고객별 최근 주문 20개” 화면에 필요한 형태를 별도 저장할 수 있다.

projection은 query latency와 source 부하를 줄이지만 stale 가능성이 있다. source version 또는 last processed offset을 노출하면 lag를 측정할 수 있다. rebuild는 동일 event를 다시 처리해도 같은 결과가 나오는 idempotent projector와 versioned schema가 필요하다.

### 네 선택은 서로를 필수로 요구하지 않는다

```text
EDA              통신·제어 흐름을 event로 연결
CQRS             command model과 query model을 분리
Event Sourcing   상태의 source of truth를 event log로 저장
Materialized View 읽기 목적의 파생 상태를 유지
```

- CRUD database를 쓰면서 EDA로 integration event를 발행할 수 있다.
- 같은 process와 database에서 CQRS의 논리 모델만 분리할 수 있다.
- Event Sourcing aggregate를 동기 API로만 제공할 수 있다.
- 복잡한 SQL 원본에서 Materialized View를 만들되 CQRS라 부르지 않을 수 있다.

함께 쓰는 경우가 많다는 사실은 의존 관계가 아니라 forces가 겹친 결과다.

## 실무 관점

| 요구 | 최소 선택 | 추가 선택을 검토할 신호 | 새 운영 항목 |
|---|---|---|---|
| 여러 consumer에게 사실 알림 | Pub/Sub | replay·대규모 순서열 필요 시 stream | delivery, DLQ, schema |
| 쓰기 규칙과 조회 형태가 다름 | 논리 CQRS | 부하·schema가 크게 달라질 때 저장소 분리 | lag, projection rebuild |
| 감사·과거 재현이 핵심 | 선택적 Event Sourcing | 긴 replay 시 snapshot | event version, snapshot |
| 비싼 조회를 빠르게 제공 | Materialized View | view 종류·부하 증가 | freshness, rebuild, storage |

event system은 end-to-end trace를 설계한다. `traceId`, `correlationId`, `causationId`, `eventId`, aggregate version을 구분하고 log에 남긴다. broker dashboard의 publish 성공만으로 업무 완료를 판단하지 않는다. consumer lag, redelivery, DLQ, projection offset, end-to-end 완료 latency를 함께 본다.

사용자 경험에는 eventual consistency가 직접 보인다. 주문을 생성한 직후 목록 projection이 늦다면 optimistic row, “처리 중” 상태, polling/subscription, read-your-writes fallback 중 하나가 필요하다. 모든 stale을 숨기기보다 사용자가 다음 행동을 안전하게 판단할 수 있게 상태를 표현한다.

## 더 깊이

event ordering은 보통 전체 순서가 아니라 aggregate 또는 partition key 안의 순서로 제한한다. 전체 순서는 throughput과 availability를 희생한다. 주문별 순서가 필요하면 `orderId`를 partition key로 두되 hot key와 repartitioning 비용을 관찰한다.

낙관적 동시성은 aggregate version으로 구현할 수 있다. command가 읽은 version이 현재와 다르면 append를 거부하고 다시 판단한다. 이는 동시 수정을 감지하지만 자동 merge를 제공하지 않는다.

```text
read Order version 7
decide PaymentApproved
append expectedVersion=7
  ├─ current=7  → version 8로 성공
  └─ current=8  → conflict, command 재평가
```

event log를 integration bus로 그대로 노출하면 내부 domain history가 외부 계약에 고정된다. 내부 domain event와 외부 integration event를 분리해 보안·schema·수명 차이를 관리할 수 있다. 모든 내부 사실을 외부에 발행하지 않는다.

## 정리

- command는 의도이고 event는 이미 일어난 사실이다.
- EDA는 통신과 제어 흐름, CQRS는 읽기·쓰기 모델, Event Sourcing은 상태 저장 모델이다.
- Pub/Sub와 event stream은 보존·offset·재처리 의미가 다르다.
- 물리 저장소를 분리한 CQRS와 Event Sourcing은 stale, replay, schema evolution 비용을 만든다.
- Materialized View의 핵심 운영 지표는 freshness와 rebuild 가능성이다.

## 확인 문제

1. CQRS를 도입하면 Event Sourcing도 도입해야 한다는 주장에 반례를 들어라.

   <details>
   <summary>정답과 해설</summary>

   command handler와 query model을 분리하되 현재 상태는 일반 relational table에 저장할 수 있다. read replica나 별도 projection도 CRUD 변경 event로 갱신할 수 있으며 domain event log를 source of truth로 둘 필요가 없다.

   </details>

2. consumer가 database commit 후 acknowledgement 전에 crash했다. 어떤 일이 생기며 무엇이 필요한가?

   <details>
   <summary>정답과 해설</summary>

   broker는 message를 처리하지 못했다고 보고 재전달할 수 있다. 같은 side effect가 두 번 실행되지 않도록 event ID 기반 inbox/deduplication 또는 업무 idempotency가 필요하다.

   </details>

3. 사용자가 주문 직후 목록에서 주문을 찾지 못한다. read projection이 2초 늦는 구조에서 가능한 UX와 측정 방법을 제시하라.

   <details>
   <summary>정답과 해설</summary>

   mutation 결과로 임시 row를 합성하거나 command model에서 해당 주문을 read-your-writes로 읽고 projection이 따라오면 전환할 수 있다. last processed offset, source event 시각과 projection 반영 시각의 차이, 사용자 관점 완료 latency를 측정한다.

   </details>

## 참고 자료

- [Azure Architecture Center — Event-driven architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven) — broker·mediator topology와 Pub/Sub·stream을 비교한다.
- [Azure Architecture Center — CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) — 논리적 분리부터 독립 저장소까지의 단계와 부적합 조건을 설명한다.
- [Azure Architecture Center — Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) — replay, snapshot, versioning과 선택적 적용 조건을 다룬다.
- [Azure Architecture Center — Materialized View pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view) — 목적별 projection과 갱신 지연의 비용을 설명한다.
- [Martin Fowler — Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) — 상태 변경을 event sequence로 보존하고 재구성하는 초기 설명이다.

