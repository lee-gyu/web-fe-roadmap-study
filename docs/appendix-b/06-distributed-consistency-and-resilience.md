# B-6. 분산 일관성과 복원력

> 한 줄 요약: 분산 workflow와 원격 호출을 실패 타임라인으로 분석하고 Saga·Outbox·idempotency·timeout·retry·Circuit Breaker·Bulkhead를 정확한 경계에 배치할 수 있다.

## 학습 목표

- Saga choreography와 orchestration을 제어 흐름, 가시성, 결합도의 트레이드오프로 비교할 수 있다.
- compensating transaction이 database rollback과 다른 이유를 설명할 수 있다.
- Transactional Outbox가 해결하는 dual-write 범위와 consumer idempotency가 여전히 필요한 이유를 설명할 수 있다.
- timeout, Retry with Backoff, Circuit Breaker, Bulkhead를 하나의 latency budget과 failure timeline으로 설계할 수 있다.
- Scatter-Gather의 부분 응답·straggler·fan-out 비용과 exactly-once 표현의 경계를 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

하나의 database transaction에서는 commit 또는 rollback으로 atomicity를 얻는다. 주문·결제·재고가 서로 다른 서비스와 database로 나뉘면 global lock 없이 같은 성질을 유지하기 어렵다. 한 단계가 성공하고 다음 단계가 timeout되면 “실패했는가”조차 즉시 알 수 없다. 응답이 유실되었을 뿐 원격 side effect는 성공했을 수 있다.

복원력 패턴은 실패를 없애지 않는다. 실패가 자원을 고갈시키고 전체 시스템으로 전파되는 범위를 제한하며, 시스템이 일관된 종착 상태로 수렴하도록 돕는다. 패턴을 독립 체크리스트로 붙이면 retry storm, 중복 결제, 잘못된 fallback처럼 더 큰 장애를 만들 수 있다. 따라서 실제 시간 순서와 자원 budget으로 설계해야 한다.

## 핵심 개념

### 먼저 failure timeline을 그린다

주문 서비스가 결제를 요청하는 단순 호출도 결과는 세 가지가 아니다.

```text
t0 Order → Payment: charge(o-1, 42000)
t1 Payment: 승인 기록 commit
t2 Payment → Order: 200 OK

실패 지점 A: t1 이전 실패       → 결제 안 됨
실패 지점 B: t1 이후 응답 유실  → 결제됐지만 Order는 모름
실패 지점 C: 응답 후 Order crash → 결제됐지만 다음 상태 저장 안 됨
```

timeout은 결과가 실패했음을 뜻하지 않고 기다리기를 중단했다는 뜻이다. 이 불확실성 때문에 idempotency key, 상태 조회, reconciliation job, 명시적 업무 상태가 필요하다.

### Saga는 local transaction을 일관된 종착 상태로 연결한다

Saga는 여러 service의 local transaction을 sequence로 연결하고 실패 시 이미 완료된 단계에 compensating transaction을 실행한다.

```text
T1 주문 생성 → T2 결제 승인 → T3 재고 예약
                         실패 ↓
C1 주문 취소 ← C2 결제 환불
```

보상은 rollback이 아니다. 결제 승인은 외부에 관찰되었고 환불은 새로운 업무 사건이다. 환율·수수료·재고·알림이 이미 달라졌을 수 있다. 모든 작업이 완전히 되돌릴 수 있는 것도 아니다. 이메일 발송은 취소할 수 없으므로 정정 메시지를 보내야 한다. compensation의 실패에도 retry, 수동 개입, 감사 상태가 필요하다.

Saga는 isolation을 자동 제공하지 않는다. 진행 중 주문을 다른 요청이 읽고 취소하거나 재고를 소비할 수 있다. semantic lock(`PENDING_PAYMENT`), commutative update, version check, reread value 같은 countermeasure가 필요하다.

### choreography와 orchestration은 제어 지식의 위치가 다르다

```text
Choreography
OrderCreated → Payment → PaymentApproved → Inventory → StockReserved

Orchestration
                 ┌→ Payment command/result
Order → Saga ────┼→ Inventory command/result
       Orchestrator└→ Notification command/result
```

| 축 | Choreography | Orchestration |
|---|---|---|
| 제어 지식 | 여러 consumer와 event chain에 분산 | orchestrator state machine에 집중 |
| 결합 | producer가 consumer를 모름 | participant가 orchestrator protocol을 앎 |
| 가시성 | 긴 흐름 추적이 어려움 | 전체 상태와 timeout을 보기 쉬움 |
| 변경 | consumer 추가가 쉬움 | workflow 변경 지점이 명확함 |
| 경계 | 단순하고 짧은 반응 | 긴 업무 흐름·보상·수동 개입 |

orchestrator는 모든 domain logic을 소유하는 중앙 신이 되어서는 안 된다. 각 service가 local invariant와 transaction을 소유하고 orchestrator는 순서와 진행 상태를 조정한다.

```ts
type SagaState =
  | { status: 'PAYMENT_PENDING'; orderId: string }
  | { status: 'STOCK_PENDING'; orderId: string; paymentId: string }
  | { status: 'COMPLETED'; orderId: string }
  | { status: 'COMPENSATING'; orderId: string; reason: string };

function onPaymentApproved(
  state: Extract<SagaState, { status: 'PAYMENT_PENDING' }>,
  paymentId: string,
): SagaState {
  return { status: 'STOCK_PENDING', orderId: state.orderId, paymentId };
}

console.log(onPaymentApproved({ status: 'PAYMENT_PENDING', orderId: 'o-1' }, 'pay-1'));
// 출력: { status: 'STOCK_PENDING', orderId: 'o-1', paymentId: 'pay-1' }
```

상태 머신은 transition을 durable storage에 저장해야 crash 후 재개할 수 있다.

### Transactional Outbox는 database와 broker 사이 dual-write를 줄인다

업무 row를 commit한 뒤 event publish가 실패하면 다른 서비스는 변경을 모른다. 반대로 event를 먼저 publish하고 database commit이 실패하면 존재하지 않는 사실을 알린다. 두 시스템을 원자적으로 갱신하려는 dual-write 문제다.

Outbox는 업무 변경과 발행할 message를 같은 local database transaction에 기록한다.

```sql
BEGIN;

UPDATE orders
SET status = 'PAID'
WHERE id = 'o-1';

INSERT INTO outbox (event_id, aggregate_id, event_type, payload)
VALUES ('e-1', 'o-1', 'OrderPaid', '{"orderId":"o-1"}');

COMMIT;
```

별도 relay가 unpublished row를 읽어 broker로 보내고 발행 완료를 표시한다. polling publisher 또는 transaction log tailing을 사용할 수 있다.

```text
Order transaction → [orders + outbox] → relay → broker → consumer
                                         │
                                  crash 후 재시도
```

Outbox는 “업무 commit은 되었지만 message 기록은 없다”는 틈을 막는다. relay가 publish 후 완료 표시 전에 crash하면 같은 event를 다시 보낼 수 있다. 따라서 at-least-once delivery와 consumer idempotency는 여전히 필요하다. outbox backlog, oldest unpublished age, publish retry, cleanup을 운영 지표로 둔다.

### idempotency는 같은 요청을 여러 번 적용해도 업무 결과가 하나가 되게 한다

HTTP method의 형식적 idempotency만으로 결제 같은 업무 중복을 막을 수 없다. client가 생성한 idempotency key와 요청 fingerprint를 저장하고 같은 key가 재전송되면 기존 결과를 반환한다.

```ts
type StoredResult = { fingerprint: string; paymentId: string };
const results = new Map<string, StoredResult>();

function charge(key: string, orderId: string, amount: number): string {
  const fingerprint = `${orderId}:${amount}`;
  const previous = results.get(key);

  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error('KEY_REUSED');
    return previous.paymentId;
  }

  const paymentId = `pay-${results.size + 1}`;
  results.set(key, { fingerprint, paymentId });
  return paymentId;
}

console.log(charge('k-1', 'o-1', 42_000));
console.log(charge('k-1', 'o-1', 42_000));
// 출력: pay-1
// 출력: pay-1
```

실제 구현은 key 저장과 side effect를 같은 transaction 또는 원자 연산으로 묶고 TTL, tenant scope, 진행 중 상태를 처리해야 한다. consumer는 event ID를 inbox table에 기록하거나 업무 natural key의 unique constraint로 중복을 막을 수 있다.

### timeout과 retry는 하나의 latency budget 안에서 설계한다

timeout이 없으면 느린 dependency가 connection·thread·promise를 붙잡아 전체를 고갈시킨다. 너무 짧으면 정상적인 tail latency를 실패로 만들고 retry traffic을 증가시킨다. end-to-end budget에서 각 hop의 timeout과 retry 횟수를 역산한다.

```text
사용자 요청 budget 2,000ms
  gateway 100ms
  order local work 200ms
  payment 전체 800ms (attempt timeout 300ms × 최대 2 + backoff)
  inventory 전체 600ms
  margin 300ms
```

Retry with Backoff는 일시적 장애와 rate limit에만 사용한다. exponential backoff에 jitter를 넣어 client가 동시에 재시도하는 thundering herd를 줄인다.

```ts
function retryDelay(attempt: number, baseMs = 100, capMs = 5_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exponential); // full jitter
}

console.log(retryDelay(3) >= 0);
// 출력: true
```

validation error, 권한 오류, 영구적인 business rejection은 retry하지 않는다. side effect는 idempotent하거나 key로 보호되어야 한다. server의 `Retry-After`, 전체 deadline, caller cancellation도 전달한다.

### Circuit Breaker와 Bulkhead는 다른 전파 경로를 막는다

Circuit Breaker는 일정 실패율이나 연속 실패를 감지하면 원격 호출을 빠르게 거부하는 상태 머신이다.

```text
Closed --실패 임계치--> Open --대기 시간--> Half-Open
  ↑                                         │
  └──────── probe 성공 ─────────────────────┘
                 probe 실패 → Open
```

breaker는 dependency를 복구하지 않는다. 실패 호출이 자원을 계속 점유하지 않도록 막고 회복 probe를 제한한다. fallback이 오래된 가격이나 잘못된 권한을 반환하면 빠른 실패보다 위험할 수 있으므로 의미적으로 안전한 fallback만 둔다.

Bulkhead는 dependency별 connection pool, worker queue, process·instance를 격리한다. 추천 서비스가 느려도 결제용 자원이 남게 한다. 격리는 자원 활용률을 낮출 수 있고 pool 크기 조정과 queue rejection 정책이 필요하다.

```text
shared pool 100                    isolated pools
recommendation 100개 점유 → 전부 실패  payment 40 | inventory 40 | recommendation 20
```

timeout은 대기 상한, retry는 일시 실패 재시도, breaker는 지속 실패 차단, bulkhead는 자원 전파 격리다. 서로 대체하지 않는다.

### Scatter-Gather는 fan-out의 tail latency를 증폭한다

Scatter-Gather는 여러 worker/service에 요청을 보내 결과를 모은다. 검색 federation, 가격 비교, shard query에 유용하다. 전체 응답이 가장 느린 participant를 기다리면 straggler가 p99를 지배한다.

```text
Aggregator ─┬→ A 80ms
            ├→ B 95ms
            └→ C 1,900ms  ← 전체 latency
```

all, quorum, first-success, deadline까지의 partial result 중 합성 규칙을 정해야 한다. fan-out이 20이면 각 dependency의 성공률이 높아도 전체 성공률은 급격히 낮아질 수 있다. 요청 취소, per-branch timeout, 결과 provenance, 부분 응답 UI를 설계한다.

### exactly-once는 관찰 범위를 명시해야 한다

network와 crash가 있는 end-to-end workflow에서 “한 번만 전달”과 “업무 효과가 한 번만 보임”은 다르다. broker가 특정 protocol 안에서 exactly-once processing을 제공해도 외부 database, email, payment API까지 같은 transaction에 묶이지 않을 수 있다.

실무 목표는 대개 at-least-once delivery + idempotent consumer + deduplication + reconciliation로 **effectively-once business outcome**을 만드는 것이다. 보장 범위, 중복 window, key retention, 실패 시 수동 복구를 문서화한다.

## 실무 관점

장애 전술은 순서대로 검토한다.

1. operation의 업무 의미와 idempotency를 정의한다.
2. end-to-end deadline과 hop별 timeout을 정한다.
3. retry 가능한 오류와 최대 attempt·backoff·jitter를 정한다.
4. 지속 장애를 breaker로 차단하고 안전한 fallback을 정한다.
5. resource pool을 bulkhead로 격리한다.
6. trace, metric, log와 사용자 상태를 연결한다.

| 관측 항목 | 필요한 이유 |
|---|---|
| attempt count와 최종 결과 | retry가 성공률을 높였는지 부하만 늘렸는지 판단 |
| timeout·breaker rejection 비율 | dependency tail latency와 차단 상태 확인 |
| queue depth·pool saturation | cascading failure 전조 탐지 |
| duplicate·dedup hit | 전달 의미와 idempotency 효과 확인 |
| Saga state age | 중간 상태에 갇힌 workflow 탐지 |
| outbox/DLQ oldest age | 발행·소비 정체의 사용자 영향 판단 |

사용자에게 eventual consistency를 숨기지 않는다. 주문 상태를 `완료/실패` 두 값으로 축소하지 말고 `결제 확인 중`, `재고 예약 중`, `보상 처리 중`, `수동 확인 필요`를 표현한다. 같은 action의 중복 클릭은 button disable만 믿지 않고 server idempotency로 보호한다.

## 더 깊이

복원력 전술은 feedback system이다. aggressive retry는 dependency를 더 압박해 실패율을 높이고 breaker를 열며, breaker가 닫힐 때 동시에 probe가 몰리면 다시 실패한다. adaptive concurrency limit, retry budget, load shedding을 이용해 실패 시 유입량 자체를 줄일 수 있다.

보상 순서도 단순 역순이 아닐 수 있다. 재고 예약을 해제하기 전에 환불해야 하는 규제, 배송이 시작되어 취소할 수 없는 상태, promotion 사용 횟수 복구처럼 domain별 정책이 있다. 각 단계에 `execute`, `compensate`, `status`, `manualResolution`을 명시하고 감사 log를 남긴다.

reconciliation은 실패한 설계의 임시방편이 아니라 분산 시스템의 정상 안전망이다. payment provider와 내부 ledger를 주기적으로 비교하고, outbox source와 consumer projection offset을 대조하며, 불일치가 자동·수동으로 수렴하는 경로를 둔다.

## 정리

- timeout은 결과 실패가 아니라 기다리기 중단이므로 불확실한 성공을 다뤄야 한다.
- Saga는 local transaction과 보상으로 일관된 종착 상태를 추구하며 ACID rollback과 다르다.
- Outbox는 dual-write 틈을 막지만 중복 전달을 허용하므로 idempotent consumer가 필요하다.
- timeout, retry, Circuit Breaker, Bulkhead는 각각 대기·일시 실패·지속 실패·자원 전파를 통제한다.
- exactly-once 주장은 broker·transaction·업무 효과 중 어느 범위인지 명시해야 한다.

## 확인 문제

1. 결제 호출이 timeout되어 같은 요청을 retry하려 한다. 시작 전에 확인할 세 가지는 무엇인가?

   <details>
   <summary>정답과 해설</summary>

   원 요청이 성공했을 가능성, idempotency key 또는 상태 조회 경로, 전체 deadline과 retry 가능한 오류인지 확인한다. 단순 timeout은 결제 실패를 보장하지 않는다.

   </details>

2. Outbox를 도입했는데 소비자에게 같은 `OrderPaid`가 두 번 도착했다. 구현 오류인가?

   <details>
   <summary>정답과 해설</summary>

   반드시 그렇지 않다. relay가 publish 후 완료 표시 전에 crash하면 재발행할 수 있다. Outbox는 atomic record를 제공하지만 보통 at-least-once 전달이므로 consumer deduplication 또는 업무 idempotency가 필요하다.

   </details>

3. 추천 서비스 장애 때문에 결제가 느려진다. Circuit Breaker와 Bulkhead는 각각 무엇을 바꾸는가?

   <details>
   <summary>정답과 해설</summary>

   breaker는 추천 호출이 지속 실패할 때 빠르게 거부해 대기를 줄인다. bulkhead는 추천이 쓰는 connection·worker 자원을 결제와 분리해 고갈 전파를 막는다. 안전한 추천 생략 fallback도 필요하다.

   </details>

4. Scatter-Gather 검색에서 5개 중 4개 결과가 200ms 안에 오고 하나가 3초 걸린다. 가능한 응답 정책을 비교하라.

   <details>
   <summary>정답과 해설</summary>

   모두 기다리면 completeness를 얻지만 tail latency를 지불한다. deadline까지 4개를 반환하면 빠르지만 부분 결과를 표시해야 한다. quorum이나 first-success는 업무 의미에 맞을 때만 가능하다. 늦은 branch를 취소하고 provenance와 누락을 노출한다.

   </details>

## 참고 자료

- [AWS Prescriptive Guidance — Saga patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html) — choreography·orchestration과 compensation을 비교한다.
- [AWS Prescriptive Guidance — Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) — dual-write 문제와 중복 전달 조건을 설명한다.
- [AWS Prescriptive Guidance — Circuit Breaker](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/circuit-breaker.html) — breaker 상태와 적용 경계를 다룬다.
- [Azure Architecture Center — Bulkhead pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead) — 자원 격리와 활용률 비용을 설명한다.
- [AWS Builders' Library — Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) — timeout budget과 retry storm을 다루는 실무 지침이다.

