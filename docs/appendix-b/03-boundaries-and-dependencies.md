# B-3. 핵심 보호와 모듈 경계

> 한 줄 요약: Hexagonal·Onion·Clean의 공통 dependency rule과 Modular Monolith·Vertical Slice의 변경 축을 비교해 필요한 경계만 설계할 수 있다.

## 학습 목표

- Ports and Adapters에서 inside-outside 비대칭과 port를 기술이 아닌 업무 목적으로 정의하는 이유를 설명할 수 있다.
- Hexagonal, Onion, Clean Architecture의 공통 제약과 용어 차이를 구분할 수 있다.
- Modular Monolith의 공개 계약, 데이터 소유권, 경계 강제 방법을 설계할 수 있다.
- Vertical Slice와 Layered 구조를 변경 locality, 중복, 일관성의 트레이드오프로 비교할 수 있다.
- 단순 CRUD에서 interface·mapper·layer가 ceremony로 전락하는 조건을 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

업무 규칙은 대개 UI, database, message broker보다 오래 산다. 그런데 framework callback, ORM entity, HTTP DTO가 업무 규칙의 언어가 되면 외부 기술의 변경이 핵심 정책까지 전파된다. 경계 패턴은 모든 기술을 교체 가능하게 만들려는 시도가 아니라, 중요한 정책과 자주 바뀌는 세부 구현 사이의 의존성을 통제하려는 시도다.

이 계열은 동심원 그림과 폴더 이름으로 소비되기 쉽다. `domain`, `usecase`, `adapter`, `infrastructure` 폴더를 만든 뒤 모든 객체를 복사하는 mapper가 생기지만 실제 업무 규칙은 controller에 남기도 한다. 구조의 가치는 파일 수가 아니라 핵심 로직을 외부 장치 없이 실행할 수 있는지, 외부 변경이 어느 경계에서 멈추는지로 판단해야 한다.

## 핵심 개념

### Hexagonal Architecture는 안과 밖의 비대칭을 만든다

Ports and Adapters의 핵심은 UI와 database를 좌우 layer로 배치하는 그림이 아니다. application 내부는 사용 목적을 표현하고 외부 장치는 그 목적에 맞게 접속한다. 의존성은 adapter에서 port와 core를 향한다.

```text
Driving adapter                 Application                Driven adapter
HTTP / CLI / test → input port → use case → output port ← DB / API / queue
                         inside | outside
```

driving side는 application을 호출한다. driven side는 application이 필요로 하는 기능을 제공한다. port는 `PostgresRepository` 같은 기술 이름보다 `LoadOrder`, `ChargePayment`처럼 application이 요구하는 대화를 표현한다.

```ts
type PlaceOrderCommand = { orderId: string; amount: number };
type Order = { id: string; status: 'PLACED' };

interface SaveOrder {
  save(order: Order): Promise<void>;
}

interface ChargePayment {
  charge(orderId: string, amount: number): Promise<'APPROVED' | 'DECLINED'>;
}

class PlaceOrder {
  constructor(
    private readonly orders: SaveOrder,
    private readonly payments: ChargePayment,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<Order> {
    const payment = await this.payments.charge(command.orderId, command.amount);
    if (payment === 'DECLINED') throw new Error('PAYMENT_DECLINED');

    const order: Order = { id: command.orderId, status: 'PLACED' };
    await this.orders.save(order);
    return order;
  }
}

const useCase = new PlaceOrder(
  { save: async () => undefined },
  { charge: async () => 'APPROVED' },
);

console.log(await useCase.execute({ orderId: 'o-1', amount: 42_000 }));
// 출력: { id: 'o-1', status: 'PLACED' }
```

이 테스트 seam은 유용하지만 아직 transaction 실패 문제를 해결하지 않는다. 결제가 승인된 뒤 주문 저장이 실패하면 두 외부 효과의 일관성을 별도로 설계해야 한다. 경계 패턴은 분산 transaction이나 resilience를 자동으로 제공하지 않는다.

### Onion과 Clean은 같은 방향 규칙을 다른 어휘로 강조한다

| 계열 | 중심에 두는 것 | 바깥으로 밀어내는 것 | 강조점 |
|---|---|---|---|
| Hexagonal | application과 port | UI, DB, 외부 시스템 adapter | 안과 밖의 대화와 테스트 가능한 교체점 |
| Onion | domain model과 service | infrastructure | domain 중심의 동심원 의존성 |
| Clean | entity와 use case | interface adapter, framework, driver | source dependency는 정책을 향한다는 dependency rule |

셋의 공통점은 업무 정책이 세부 구현을 import하지 않게 하는 것이다. 차이는 유용한 설명 어휘이지 세 가지 architecture package를 동시에 설치해야 한다는 뜻이 아니다. 프로젝트에서 “안쪽”이 무엇인지, 허용되는 의존성 방향과 crossing data가 무엇인지 한 가지 용어로 명확히 정하는 편이 낫다.

경계를 통과하는 데이터는 단순해야 한다. core가 ORM session, HTTP request, framework decorator를 받으면 바깥의 lifecycle과 규칙이 안으로 들어온다. 반대로 모든 계층마다 동일 필드의 DTO를 복제하면 변경 비용만 생긴다. 외부 schema와 domain 의미가 다르거나 수명·보안 경계가 다를 때 mapping이 가치가 있다.

### 추상화는 변동성과 정책 밀도가 있을 때 비용을 회수한다

port가 유효한 신호는 다음과 같다.

- 외부 장치 없이 실행하고 싶은 중요한 업무 규칙이 있다.
- 같은 목적에 여러 adapter가 실제로 존재한다. 예: production payment와 sandbox payment.
- 외부 계약의 변경 속도나 failure model이 core와 다르다.
- trust boundary에서 입력을 번역·검증해야 한다.
- 교체보다 테스트 seam 또는 정책 보호의 가치가 크다.

반대로 단순 관리자 CRUD가 하나의 database만 사용하고 규칙이 validation 몇 줄뿐이라면 repository interface와 네 종류의 DTO는 미래 가설에 현재 비용을 부과한다. 이 경우 ORM을 직접 쓰되 query가 domain 전반에 퍼지는지, 테스트가 느려지는지, 외부 schema가 불안정해지는지를 재검토 신호로 남길 수 있다.

### Modular Monolith는 배포를 나누지 않고 경계를 강제한다

Monolith는 하나의 배포 단위라는 뜻이지 하나의 무질서한 module이라는 뜻이 아니다. Modular Monolith는 업무 capability별 module이 공개 API와 데이터를 소유하고, 다른 module은 내부 구현이나 table을 직접 읽지 못하게 한다.

```text
orders/                     payments/
  public.ts  ◀───────────▶    public.ts
  internal/                    internal/
  schema: order_*              schema: payment_*

한 process · 한 deployable · 필요하면 한 physical database
```

TypeScript에서는 package export와 lint rule로 import를 제한할 수 있다.

```ts
// orders/public.ts
export type PlaceOrder = (input: { customerId: string }) => Promise<{ orderId: string }>;

// payments는 orders/internal/*을 import하지 않고 공개 계약만 사용한다.
import type { PlaceOrder } from '../orders/public.js';

export async function startCheckout(placeOrder: PlaceOrder): Promise<string> {
  const { orderId } = await placeOrder({ customerId: 'c-1' });
  return orderId;
}
```

경계는 코드뿐 아니라 data에 필요하다. 같은 database를 쓰더라도 module별 schema/table ownership을 두고 다른 module의 table을 직접 join하지 않는다. 필요한 데이터는 공개 query, read-only projection, domain event로 얻는다. 이 규칙이 없으면 code module만 나뉘고 database 결합이 실제 architecture가 된다.

Modular Monolith는 local call과 단일 transaction, 단순한 배포·디버깅을 유지한다. 대신 process가 isolation을 강제하지 않으므로 architecture test, module API review, code ownership, observability label로 규율을 자동화해야 한다.

### Vertical Slice는 기술 계층보다 변경 축을 따른다

Vertical Slice Architecture는 `controllers/`, `services/`, `repositories/`보다 `place-order/`, `cancel-order/`, `get-order/`처럼 use case별로 요청 처리 코드를 모은다. 한 기능 변경이 한 slice에 머물 가능성이 높다.

```text
Layered                            Vertical Slice
controllers/place.ts              place-order/
services/place.ts                    handler.ts
repositories/order.ts                policy.ts
dto/place.ts                         query.ts

한 변경이 여러 폴더를 이동          한 변경이 한 기능 폴더에 머묾
```

slice끼리 무조건 코드를 공유하지 않는 것은 아니다. 반복이 안정된 domain rule이라면 공통 module로 올린다. 너무 일찍 일반화하면 여러 use case의 우연한 유사성을 결합하고, 너무 늦게 공유하면 보안·transaction 규칙이 제각각 된다. 중복의 비용과 잘못된 추상화의 비용을 함께 본다.

Vertical Slice는 배포 topology가 아니다. 하나의 monolith 안에 적용할 수도 있고 service 내부에서 쓸 수도 있다. Modular Monolith는 capability 경계를, Vertical Slice는 그 안의 change axis를 정할 수 있어 서로 조합 가능하다.

## 실무 관점

| 선택 | 적합한 문제 | 주요 이득 | 주요 비용 | 철회 신호 |
|---|---|---|---|---|
| 직접 framework/ORM 사용 | 단순 CRUD, 낮은 정책 밀도 | 적은 코드, 빠른 피드백 | 기술 결합, 느린 통합 테스트 | 규칙 분산·외부 변경 전파 증가 |
| Hexagonal 계열 | 복잡한 정책, 외부 adapter 변동 | 핵심 보호, 빠른 core test | port·mapping·조립 비용 | 대부분 port가 단순 전달만 함 |
| Modular Monolith | 여러 capability, 단일 운영 단위 | 강한 논리 경계와 local 단순성 | 경계 자동화와 규율 필요 | module 간 직접 접근이 상시 예외가 됨 |
| Vertical Slice | use case별 변경이 잦음 | 변경 locality, 기능별 이해 | 중복과 규칙 편차 | cross-slice 변경이 대부분이 됨 |

실제 경계를 찾을 때 명사 목록보다 변화와 invariant를 본다. 한 transaction에서 반드시 함께 지켜야 하는 규칙은 같은 경계에 둘 근거가 된다. 자주 독립적으로 바뀌고 다른 팀이 소유하는 기능은 분리 후보다. Git change coupling, database transaction, incident ownership, 호출 latency trace를 함께 사용한다.

경계 강제는 좁게 시작한다. 신규 module의 public entry만 정의하고 기존 직접 import를 측정한다. architecture test가 실패할 때 예외 목록을 무기한 늘리지 말고, 경계가 틀렸는지 migration이 덜 되었는지 분리한다.

## 더 깊이

의존성 역전(dependency inversion)은 호출 방향과 source dependency 방향이 다를 수 있게 한다. `PlaceOrder`가 runtime에는 payment adapter를 호출하지만 source code에서는 `ChargePayment` port만 알고, adapter가 그 port를 구현한다. 이 비대칭이 policy를 detail에서 보호한다.

```text
runtime call:       use case ─────────▶ payment adapter
source dependency: use case ◀── port ─ payment adapter
```

그러나 모든 dependency inversion이 가치 있는 것은 아니다. interface 안정성이 구현보다 낮다면 오히려 두 곳을 함께 바꿔야 한다. 좋은 port는 현재 adapter 메서드를 복사한 모양이 아니라 application이 필요로 하는 안정된 의미를 표현한다. `executeSql(sql)`보다 `reserveStock(orderId, lines)`가 application boundary에 가깝다.

경계를 나중에 service로 추출할 가능성이 있어도 처음부터 network를 흉내 내지 않는다. local module API를 직렬화 가능한 계약으로 유지하고 data ownership을 분리하는 정도면 추출 옵션을 보존할 수 있다. 실제 추출 시에는 timeout, partial failure, authentication, versioning을 새로 설계해야 하며 local call이 원격 호출로 투명하게 바뀐다고 가정해서는 안 된다.

## 정리

- Hexagonal, Onion, Clean은 핵심 정책을 세부 구현에서 보호하는 dependency rule 계열이다.
- port는 기술 이름이 아니라 application의 목적과 안정된 대화를 표현해야 한다.
- mapping과 interface는 변동성·정책 밀도·trust boundary가 있을 때 비용을 회수한다.
- Modular Monolith는 하나의 배포 단위 안에서 공개 계약과 데이터 소유권을 강제한다.
- Vertical Slice는 use case라는 변경 축을 따르며 계층·module·service와 조합할 수 있다.

## 확인 문제

1. `OrderRepository` interface와 `PrismaOrderRepository`가 모든 Prisma 메서드를 일대일로 노출한다. 이 경계가 core를 보호하지 못하는 이유는 무엇인가?

   <details>
   <summary>정답과 해설</summary>

   port의 언어와 변화가 Prisma API에 종속되어 implementation detail이 interface로 복제되었기 때문이다. use case가 필요한 `loadPendingOrders`, `saveOrder` 같은 목적 중심 계약과 crossing data를 정의해야 한다.

   </details>

2. 하나의 database를 쓰는 Modular Monolith에서 주문 module이 결제 table을 직접 join하면 어떤 문제가 생기는가?

   <details>
   <summary>정답과 해설</summary>

   결제 schema 변경이 주문에 전파되고 ownership과 공개 계약을 우회한다. 물리 database 공유와 논리 data ownership은 구분해야 한다. 공개 query나 목적별 projection을 통해 필요한 정보를 제공할 수 있다.

   </details>

3. Vertical Slice에서 같은 validation 코드가 세 번 보인다. 즉시 공통 helper로 합쳐야 하는가?

   <details>
   <summary>정답과 해설</summary>

   동일한 업무 이유로 함께 바뀌는 규칙인지 먼저 확인한다. 우연히 코드 모양만 같다면 공유가 slice를 결합한다. 보안이나 invariant처럼 반드시 일관되어야 한다면 안정된 정책 module로 올리는 편이 낫다.

   </details>

## 참고 자료

- [Alistair Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) — port의 목적, 안과 밖의 비대칭, 외부 장치 없는 테스트를 설명한 원문이다.
- [Jeffrey Palermo — The Onion Architecture](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — domain 중심 의존성과 infrastructure 외부화의 원문이다.
- [Robert C. Martin — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — 여러 경계 패턴의 공통 dependency rule을 정리한다.
- [GitLab Handbook — Rails Monolith Decomposition](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/modular_monolith/) — 대형 monolith에서 module 경계를 강제하고 선택적으로 추출하는 사례다.
- [Jimmy Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) — 기술 계층보다 change axis를 따라 결합하자는 제안이다.

