# B-2. 프로세스 내부 구조와 실행 흐름

> 한 줄 요약: Layered, Pipes and Filters, Microkernel을 실행 흐름과 변경 축으로 비교하고 고전 패턴의 현대적 적용 경계를 판단할 수 있다.

## 학습 목표

- 논리 계층(layer)과 물리 계층(tier)을 구분하고 open/closed layer의 의존성 규칙을 설명할 수 있다.
- Pipes and Filters의 표준 입출력, streaming, backpressure와 오류 전파를 설계할 수 있다.
- Microkernel의 core-plugin 계약에서 호환성, 격리, lifecycle 비용을 평가할 수 있다.
- Blackboard, PAC, Reflection의 원래 문제와 현대 웹 시스템에서의 제한된 적용 범위를 비교할 수 있다.

## 배경: 왜 이것이 존재하는가

하나의 프로세스라고 구조가 하나인 것은 아니다. 요청 중심 업무 시스템은 수평 계층이 잘 맞고, compiler나 미디어 변환은 단계별 pipeline이 자연스럽다. 편집기와 개발 도구는 안정적인 core와 확장 가능한 plugin이 필요하다. 구조는 같은 코드를 다른 폴더에 배치하는 문제가 아니라 제어 흐름과 변경이 전파되는 방식을 선택하는 문제다.

프로세스 내부 구조는 네트워크가 없으므로 단순해 보이지만 결합이 사라지지는 않는다. 함수 호출은 빠르고 transaction도 공유하기 쉽지만, 모든 코드가 모든 코드를 import할 수 있으면 경계가 침식된다. 이 문서는 런타임 호출 비용이 아니라 변경과 실패가 어디까지 번지는지에 집중한다.

## 핵심 개념

### Layer는 논리 경계이고 tier는 배포 경계다

Layered Architecture는 presentation, application, domain, data access처럼 책임을 수평으로 나눈다. layer는 논리적인 책임과 의존성 경계다. tier는 web server, application server, database처럼 물리적으로 분리된 배포·실행 경계다. 네 개 layer를 한 프로세스에 둘 수도 있고 세 tier에 나눌 수도 있다.

```text
Presentation → Application → Domain → Infrastructure
     layer          layer       layer        layer

Browser       → API process             → Database
  tier              tier                     tier
```

closed layer는 바로 아래 계층을 통해서만 접근하게 한다. application이 infrastructure를 직접 건너뛰지 않으므로 교차 관심사를 한곳에 적용하고 책임을 추적하기 쉽다. open layer는 특정 계층을 건너뛸 수 있다. 단순 조회가 domain을 거칠 이유가 없을 때 latency와 forwarding code를 줄일 수 있지만 우회가 기본이 되면 계층 의미가 사라진다.

```ts
type Order = { id: string; total: number };

class OrderRepository {
  find(id: string): Order | undefined {
    return id === 'o-1' ? { id, total: 42_000 } : undefined;
  }
}

class GetOrder {
  constructor(private readonly orders: OrderRepository) {}

  execute(id: string): Order {
    const order = this.orders.find(id);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    return order;
  }
}

const result = new GetOrder(new OrderRepository()).execute('o-1');
console.log(result.total);
// 출력: 42000
```

이 예제는 호출 방향을 보여 줄 뿐 좋은 layer 수를 증명하지 않는다. `GetOrder`가 repository 호출을 전달하기만 하고 정책이 없으며 모든 변경이 세 파일을 함께 바꾼다면 계층은 ceremony가 될 수 있다.

### 수평 계층은 기능 변경을 수직으로 퍼뜨릴 수 있다

Layered 구조는 책임별 전문화와 일관된 규칙에 유리하다. 그러나 “쿠폰을 적용한 주문 생성” 하나가 controller, DTO, service, domain, repository, mapper를 모두 바꾸게 할 수 있다. 변경 축(change axis)이 기능인데 폴더 축은 기술 계층이면 코드 탐색과 팀 ownership이 어긋난다.

이를 완화하는 선택지는 세 가지다.

- 계층을 유지하되 feature별 하위 module로 묶는다.
- 단순 read path는 open layer로 명시하되 write invariant는 domain을 통과시킨다.
- [Vertical Slice와 Modular Monolith](./03-boundaries-and-dependencies.md)로 기능 경계를 더 강하게 만든다.

계층을 없애기 전에 실제 변경 데이터를 본다. 최근 PR에서 함께 바뀐 파일, layer 간 순환 import, service method의 forwarding 비율, domain rule이 controller나 SQL에 흩어진 정도가 증거다.

### Pipes and Filters는 데이터 변환을 합성한다

Pipes and Filters는 filter가 표준 입력을 받아 표준 출력을 만들고 pipe가 단계를 연결한다. 각 filter는 다음 단계를 몰라도 되므로 재배치·재사용·병렬화가 가능하다. compiler pass, Unix pipeline, ETL, 이미지 처리, 로그 수집이 자연스러운 사례다.

```ts
type Filter<I, O> = (input: AsyncIterable<I>) => AsyncIterable<O>;

async function* from<T>(values: T[]): AsyncIterable<T> {
  yield* values;
}

const parse: Filter<string, number> = async function* (input) {
  for await (const value of input) yield Number(value);
};

const positive: Filter<number, number> = async function* (input) {
  for await (const value of input) if (value > 0) yield value;
};

const double: Filter<number, number> = async function* (input) {
  for await (const value of input) yield value * 2;
};

let stream = parse(from(['3', '-1', '5']));
stream = positive(stream);
stream = double(stream);

for await (const value of stream) console.log(value);
// 출력: 6
// 출력: 10
```

`AsyncIterable`은 downstream이 다음 값을 요청할 때 upstream이 진행되므로 pull 기반 backpressure를 표현한다. Node.js stream처럼 push와 buffer를 쓰는 구현은 `highWaterMark`, pause/resume, drain을 관찰해야 한다. 생산자가 소비자보다 빠르면 buffer가 무한히 자라거나 데이터 손실 정책이 필요해진다.

오류도 계약의 일부다. 한 record 실패가 pipeline 전체를 중단하는지, dead-letter로 보내고 계속하는지, 이미 처리한 단계의 side effect를 어떻게 보상하는지 정해야 한다. transaction 중심의 대화형 workflow는 중간 단계가 상태를 공유하고 되돌려야 하므로 독립 filter 모델과 잘 맞지 않을 수 있다.

### Microkernel은 안정적인 core와 변하는 plugin을 분리한다

Microkernel 또는 Plugin Architecture는 최소한의 core와 확장 지점(extension point)을 둔다. core는 lifecycle, plugin discovery, 공통 모델을 관리하고 plugin은 제품별 기능이나 외부 통합을 제공한다. IDE, browser extension, build tool, 결제 수단처럼 변형이 많고 제3자 확장이 필요한 제품에 적합하다.

```ts
type PaymentRequest = { orderId: string; amount: number };
type PaymentResult = { provider: string; approved: boolean };

interface PaymentPlugin {
  readonly apiVersion: 1;
  readonly name: string;
  pay(request: PaymentRequest): Promise<PaymentResult>;
}

class PaymentKernel {
  private readonly plugins = new Map<string, PaymentPlugin>();

  register(plugin: PaymentPlugin): void {
    if (plugin.apiVersion !== 1) throw new Error('INCOMPATIBLE_PLUGIN');
    this.plugins.set(plugin.name, plugin);
  }

  async pay(name: string, request: PaymentRequest): Promise<PaymentResult> {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error('PLUGIN_NOT_FOUND');
    return plugin.pay(request);
  }
}
```

어려운 부분은 registry가 아니라 계약의 진화다. API version negotiation, capability detection, plugin 간 dependency, 초기화·종료 순서, timeout, 권한, resource quota, crash 격리를 설계해야 한다. 같은 JavaScript realm에서 plugin을 실행하면 악성 또는 결함 plugin이 전역 상태와 event loop를 망칠 수 있다. 신뢰하지 않는 plugin에는 Worker, iframe, 별도 process 같은 격리와 명시적 message protocol이 필요하다.

### 고전 패턴은 원래 문제를 보존해 읽는다

| 패턴 | 원래 해결하려는 문제 | 현대적 친척 | 경계 조건 |
|---|---|---|---|
| Blackboard | 여러 전문 해법이 공유 지식에 기여해 해를 점진 구성 | rule engine, 일부 AI orchestration | 종료·충돌·재현 규칙이 불명확하면 디버깅 불가 |
| PAC | presentation-abstraction-control을 가진 agent의 계층적 UI 협력 | 복합 desktop UI, 일부 component coordinator | 일반 웹 UI에는 통신 간접성이 과도함 |
| Reflection | meta-level이 base-level의 구조·동작을 기술하고 변경 | metadata-driven framework, DI container | 언어 reflection API 사용과 동일하지 않으며 숨은 제어 흐름 증가 |

Blackboard는 단순한 shared database가 아니다. 여러 knowledge source가 부분 해를 만들고 control component가 다음 실행을 고르는 구조다. Reflection도 `Reflect.get` 호출 자체가 아니라 시스템 구조를 표현한 meta-object가 base behavior를 바꿀 수 있다는 분리다. 이름을 현대 기술에 억지로 대응시키기보다 해결 문제가 남아 있는지 판단해야 한다.

## 실무 관점

| 상황 | 우선 검토할 구조 | 얻는 것 | 무너지는 신호 |
|---|---|---|---|
| 전형적인 업무 요청·응답 | Layered | 익숙한 책임과 단방향 의존 | 모든 기능 변경이 전 layer를 관통, bypass 증가 |
| 단계별 데이터 변환 | Pipes and Filters | 단계 합성, streaming, 독립 테스트 | 공유 transaction과 임의 분기가 핵심 |
| 제품 변형·제3자 확장 | Microkernel | 안정적 core, 확장 가능한 기능 | plugin API가 core 전체를 노출, 호환성 비용 급증 |
| 비결정적 전문 해법 결합 | Blackboard | 여러 전략의 협력 | 종료·충돌·재현성을 정의할 수 없음 |

성능을 측정할 때 구조 이름으로 추론하지 않는다. pipeline은 각 stage의 처리량, queue depth, buffer memory, end-to-end p95를 관찰한다. layer는 호출 수보다 database query, serialization, mapping allocation을 profiler로 본다. plugin은 startup time, hook별 실행 시간, timeout·crash 격리 성공률을 기록한다.

의존성 규칙은 문서만으로 오래 유지되지 않는다. TypeScript package export, ESLint import restriction, architecture test, build graph, code owner로 허용 방향을 자동 검사한다. 다만 규칙 위반 수가 많다면 개발자를 탓하기 전에 규칙이 실제 변경 흐름과 맞는지 검토한다.

## 더 깊이

세 구조는 control topology가 다르다.

```text
Layers              Pipeline               Microkernel
request              data                   request
  ↓                    ↓                       ↓
L1 → L2 → L3         F1 → F2 → F3       plugin ↔ CORE ↔ plugin
  ↓                    ↓                       ↓
response             output                response/event
```

Layers에서는 상위 계층이 하위를 호출하고 결과를 돌려받는다. Pipeline에서는 데이터가 동일한 protocol을 따라 이동한다. Microkernel에서는 core가 lifecycle과 extension point를 소유하며 control inversion이 일어난다. 따라서 같은 “모듈화”라는 표현을 써도 테스트 방식과 실패 경계가 다르다.

구조를 바꿀 때 big-bang 재배치를 피한다. 먼저 한 요청 경로에서 책임과 측정값을 표시한다. pipeline 후보라면 side effect 없는 변환 하나를 filter로 추출한다. plugin 후보라면 내부 기능 하나를 versioned contract 뒤로 옮긴다. 새 구조가 변경 locality와 관측성을 개선하는지 확인한 뒤 범위를 넓힌다.

## 정리

- layer는 논리 책임 경계이고 tier는 물리 배포 경계다.
- closed layer는 규칙을 일관되게 적용하지만 수직 기능 변경의 forwarding code를 늘릴 수 있다.
- Pipes and Filters의 핵심은 표준 입출력이며 backpressure와 오류 정책도 protocol에 포함된다.
- Microkernel의 어려움은 plugin 등록보다 계약 versioning, lifecycle, 권한, 격리다.
- Blackboard, PAC, Reflection은 이름보다 원래 문제와 제어 흐름을 기준으로 제한적으로 적용한다.

## 확인 문제

1. 네 개 layer가 모두 같은 process에 있고 database만 별도 server에 있다. 이 시스템은 몇 layer와 몇 tier인가?

   <details>
   <summary>정답과 해설</summary>

   논리적으로 네 layer이며 배포 관점에서는 application process와 database의 두 tier로 볼 수 있다. layer 수와 tier 수는 일치하지 않는다.

   </details>

2. 이미지 처리 pipeline에서 producer가 초당 1,000개를 만들고 filter가 100개만 처리한다. queue를 크게 잡는 것만으로 해결되지 않는 이유와 필요한 정책은 무엇인가?

   <details>
   <summary>정답과 해설</summary>

   지속적인 생산·소비율 차이는 buffer를 결국 소진하고 latency와 memory만 늘린다. upstream throttling, bounded queue, drop/coalesce, consumer scale-out 중 데이터 의미에 맞는 backpressure 정책과 queue depth·처리 시간을 관찰해야 한다.

   </details>

3. 결제 plugin이 core의 ORM entity와 logger 전역 객체를 직접 사용한다. 어떤 품질 속성이 약해지는가?

   <details>
   <summary>정답과 해설</summary>

   plugin 계약이 core 내부 구현과 결합되어 독립 versioning, 테스트, 격리, 제3자 확장이 약해진다. 직렬화 가능한 최소 계약과 capability를 제공하고, 신뢰 수준에 따라 실행 경계를 분리해야 한다.

   </details>

## 참고 자료

- [Pattern-Oriented Software Architecture, Chapter 2](https://www.oreilly.com/library/view/pattern-oriented-software-architecture/9781118725269/9781118725269_c02.xhtml) — Layers, Pipes and Filters, Blackboard, PAC, Microkernel, Reflection의 고전 정의를 비교한다.
- [Mark Richards — Software Architecture Patterns](https://www.oreilly.com/content/software-architecture-patterns/) — Layered와 Microkernel을 품질 속성 축으로 설명한다.
- [Azure Architecture Center — N-tier architecture style](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/n-tier) — 논리 layer와 물리 tier의 배포 관점을 확인할 수 있다.
- [Node.js — Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams) — 실제 stream 구현에서 buffer와 backpressure가 작동하는 방식을 관찰할 수 있다.

