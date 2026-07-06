# 3-4. 객체 모델 — 프로토타입, descriptor, class 문법의 실체

> 한 줄 요약: class 키워드 아래에서 실제로 일어나는 일(생성자 함수 + 프로토타입 체인 + descriptor)을 설명할 수 있고, 클래스 기반 상속의 직관이 프로토타입 위임 모델에서 무너지는 지점을 예측·진단할 수 있다.

## 학습 목표

- 프로토타입 체인의 읽기 탐색([[Get]])과 쓰기의 비대칭을 설명하고, 프로토타입 공유 오염 버그를 진단할 수 있다.
- property descriptor의 세 플래그(writable/enumerable/configurable)가 `for...in`·spread·`Object.freeze`의 동작을 어떻게 결정하는지 설명할 수 있다.
- class 문법이 만들어내는 실제 구조(생성자 함수, non-enumerable 메서드, 인스턴스/정적 이중 체인)를 프로토타입 용어로 풀어 쓸 수 있다.
- class가 감추지 못하는 것(메서드 추출 시 this 상실, 열린 프로토타입)과 private 필드(#)가 보장하는 것을 구분할 수 있다.
- Vue 2 → Vue 3의 반응성 구현 전환(defineProperty → Proxy)을 descriptor의 한계로 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

ES2015가 class 문법을 도입한 이후, JS 코드는 Java/C#과 구분이 어려울 만큼 닮아 보인다. `class Admin extends User`, 생성자, 정적 메서드, 이제는 private 필드까지. 그래서 클래스 기반 언어 경력자는 자신의 상속 모델을 그대로 이식한다 — 그리고 그 모델은 대체로 작동한다. 문제는 무너지는 지점이 **예고 없이** 온다는 것이다: 이벤트 핸들러로 넘긴 메서드의 this가 사라지고, 프로토타입에 둔 배열이 모든 인스턴스에서 함께 바뀌고, 런타임에 누군가 내장 객체의 메서드를 바꿔치기한다.

두 모델의 차이를 한 문장으로 요약하면 이렇다. 클래스 기반 상속은 **청사진 복사**다 — 클래스는 컴파일 타임에 확정되는 설계도이고, 인스턴스는 그 설계도대로 찍혀 나오며, 메서드 디스패치는 고정된 구조(vtable)를 탄다. 프로토타입 기반은 **살아있는 위임 링크**다 — 객체는 다른 객체를 가리키는 링크([[Prototype]])를 가질 뿐이고, 프로퍼티를 못 찾으면 그 링크를 따라가 물어보며, 링크와 그 끝의 객체는 런타임에 언제든 바뀔 수 있다. class 문법은 후자에 전자의 표기를 씌운 것이다. 표기가 같아서 생기는 오해의 목록이 곧 이 문서의 실무 함정 목록이다.

이 문서는 [3-1](./01-execution-model.md)의 this 규칙과 [3-3](./03-types-and-coercion.md)의 ToPrimitive(객체→원시 관문)를 전제한다. 상속 계층을 어떻게 설계할 것인가 같은 객체지향 설계론은 경력자 전제로 다루지 않고, TypeScript가 이 구조에 씌우는 타입은 Phase 4에서 다룬다.

## 핵심 개념

### 최소 모델 — 프로퍼티 모음 + 링크 하나

JS 객체의 전부는 이것이다: **프로퍼티들의 모음, 그리고 다른 객체(또는 null)를 가리키는 내부 슬롯 [[Prototype]]**. 클래스도, 타입도, 계층도 이 최소 모델 위의 관례일 뿐이다.

프로퍼티 읽기([[Get]])는 자기 프로퍼티를 먼저 보고, 없으면 [[Prototype]] 링크를 따라가 반복한다 — null에 닿으면 undefined. 이 탐색이 프로토타입 체인이다.

```js
const base = { greet() { return "hello"; } };
const derived = Object.create(base); // [[Prototype]]이 base인 빈 객체

console.log(derived.greet());                  // 출력: "hello" — 체인 위임
console.log(Object.hasOwn(derived, "greet"));  // 출력: false — 자기 것이 아니다
console.log(Object.getPrototypeOf(derived) === base); // 출력: true
```

같은 이름을 자기 프로퍼티로 가지면 체인 탐색이 거기서 끝난다 — **섀도잉(shadowing)** 이다. 프로토타입 쪽은 바뀌지 않고 가려질 뿐이다.

여기서 이 문서의 첫 번째 핵심 비대칭이 나온다. **읽기는 체인을 타지만, 쓰기는 타지 않는다.** `obj.x = v`(데이터 프로퍼티 기준)는 체인 위의 x를 갱신하는 게 아니라 obj 자신에 새 프로퍼티를 만든다(섀도잉 생성). 이 비대칭이 유명한 공유 오염 함정을 만든다.

```js
class TagStore {
  // ❌ 인스턴스가 아니라 프로토타입에 배열을 두는 (옛 스타일) 실수의 재현
}
TagStore.prototype.tags = [];

const a = new TagStore();
const b = new TagStore();

a.tags.push("urgent"); // 쓰기가 아니라 "읽기(a.tags) 후 메서드 호출"이다!
console.log(b.tags);   // 출력: ["urgent"] — b가 오염됐다

a.tags = ["mine"];     // 이것은 진짜 쓰기 — a에 섀도잉 프로퍼티 생성
console.log(b.tags);   // 출력: ["urgent"] — 프로토타입 쪽은 그대로
```

`a.tags.push(...)`가 함정의 핵심이다. 할당이 아니므로 섀도잉이 일어나지 않고, 체인에서 **찾아낸 공유 배열을** 변경한다. "원시 값 프로퍼티는 괜찮았는데 객체 프로퍼티에서 사고가 났다"는 보고의 원인이 항상 이것이다. class의 필드 선언(`tags = []`)이 생성자에서 **인스턴스마다** 초기화되도록 설계된 것이 바로 이 함정에 대한 응답이다.

쓰기의 비대칭에는 예외가 하나 있다: 체인 위의 프로퍼티가 accessor(setter)면 쓰기도 체인을 탄다 — setter가 호출된다. 이것이 다음 절의 descriptor로 이어진다.

### property descriptor — 프로퍼티의 메타데이터

프로퍼티는 값만 갖는 게 아니다. 스펙상 모든 프로퍼티는 **descriptor**라는 메타데이터 묶음이고, 두 종류가 있다.

- **data 프로퍼티**: `value`, `writable`(재할당 가능), `enumerable`(열거에 보임), `configurable`(descriptor 변경·삭제 가능)
- **accessor 프로퍼티**: `get`, `set` 함수 + enumerable, configurable — 값이 없고, 접근이 곧 함수 호출이다

```js
const user = { name: "kim" };
console.log(Object.getOwnPropertyDescriptor(user, "name"));
// 출력: { value: "kim", writable: true, enumerable: true, configurable: true }

Object.defineProperty(user, "id", {
  value: 7,
  writable: false,
  enumerable: false,
  configurable: false,
});
```

플래그들은 언어의 여러 동작이 갈라지는 스위치다.

- **enumerable** — `for...in`(체인까지 순회!), `Object.keys`(자기 것만), spread(`{...obj}`, 자기 것만)는 전부 enumerable: true인 프로퍼티만 본다. 위 `user.id`는 `Object.keys(user)`에 안 나온다. class 메서드가 spread에 복사되지 않는 이유도 곧 보게 될 이 플래그다.
- **writable: false** — strict mode에서 재할당이 TypeError, non-strict에서는 **조용히 무시**된다. 실패가 침묵하는 non-strict의 위험이 여기서도 반복된다.
- **configurable: false** — 삭제 불가, 플래그 변경 불가. 단 writable true→false 방향만은 예외로 허용된다.

`Object.freeze(obj)`는 모든 자기 프로퍼티를 writable: false + configurable: false로 만들고 확장을 막는다. 핵심 경계 조건: **얕다(shallow)**. 프로퍼티 값이 객체면 그 객체의 내부는 그대로 변경 가능하다. `Object.freeze(config)` 후에도 `config.api.url = "..."`은 성공한다 — freeze된 것은 config의 프로퍼티 슬롯이지 그 값이 가리키는 객체가 아니다.

**descriptor는 프레임워크 반응성 구현의 역사이기도 하다.** Vue 2는 데이터 객체의 모든 프로퍼티를 accessor로 바꿔치기해(getter에서 의존성 수집, setter에서 갱신 통지) 반응성을 구현했다. 이 접근의 한계가 descriptor 모델 자체에 있다: defineProperty는 **이미 존재하는 프로퍼티**에만 훅을 걸 수 있으므로, 런타임에 추가되는 프로퍼티(`obj.newKey = v`)와 삭제는 감지할 수 없었다(Vue 2의 `Vue.set` 우회가 필요했던 이유). Vue 3와 MobX가 Proxy로 갈아탄 것은 Proxy가 프로퍼티 단위가 아니라 **객체 단위의 트랩**(get/set/has/deleteProperty)이라 추가·삭제·존재 검사까지 전부 가로챌 수 있기 때문이다. Proxy/Reflect의 전면 해설은 범위 밖이지만, "descriptor는 프로퍼티에, Proxy는 객체에 훅을 건다"는 구분이 두 세대의 차이를 설명한다.

### class 문법이 실제로 만드는 것

class는 새로운 객체 모델이 아니다. 아래 두 코드는 관찰 가능한 차이가 거의 없다.

```js
// class 문법
class User {
  constructor(name) { this.name = name; }
  greet() { return `hi, ${this.name}`; }
  static from(json) { return new User(JSON.parse(json).name); }
}

// class가 만드는 실제 구조 (개념적 등가물)
function UserFn(name) { this.name = name; }
Object.defineProperty(UserFn.prototype, "greet", {
  value: function greet() { return `hi, ${this.name}`; },
  writable: true, enumerable: false, configurable: true, // ← non-enumerable!
});
UserFn.from = function from(json) { /* ... */ }; // 정적 = 생성자 함수의 프로퍼티
```

확인해 볼 지점들:

```js
typeof User;                        // 출력: "function" — class는 함수다
Object.keys(new User("kim"));       // 출력: ["name"] — greet는 non-enumerable
({ ...new User("kim") });           // { name: "kim" } — 메서드는 spread에서 사라진다!
```

마지막 줄이 실무 함정이다. 인스턴스를 spread로 복사하면 **데이터만 남고 클래스 정체성(메서드, [[Prototype]])을 잃는다**. "복사했더니 메서드가 없다"는 버그의 원인.

`extends`는 체인을 **두 벌** 연결한다. 인스턴스 체인(`Admin.prototype` → `User.prototype`)과 정적 체인(`Admin` → `User`)이다. 정적 체인 덕에 `Admin.from(...)`처럼 부모의 정적 메서드가 상속되는데, Java에는 없는 동작이라(정적 멤버는 상속돼도 다형 디스패치가 없는 것과 다른 차원) 놀라는 지점이다.

`super`가 동작하는 메커니즘은 [[HomeObject]]다. 메서드 축약 문법으로 정의된 함수는 자신이 정의된 객체(prototype)를 [[HomeObject]] 내부 슬롯에 저장하고, `super.method()`는 "[[HomeObject]]의 [[Prototype]]에서 method를 찾아, **현재 this로** 호출"로 평가된다. this의 동적 결정([3-1](./01-execution-model.md))과 달리 super의 탐색 시작점은 정의 위치에 고정된다 — 그래서 super가 있는 메서드를 다른 객체로 복사해도 super는 원래 계층을 본다. 일반 함수 표현식(`fn: function() {...}`)에는 [[HomeObject]]가 만들어지지 않아 super를 쓸 수 없다 — "메서드 축약에서만 super가 되는" 이유다.

class 문법이 순수한 설탕이 아닌 지점도 있다: class는 new 없는 호출을 TypeError로 막고, 본문이 자동 strict mode이며, 선언이 TDZ를 가진다(함수 선언과 달리 위로 "끌어올려" 쓸 수 없다 — [3-1](./01-execution-model.md)의 let/const와 같은 등록·미초기화 처리).

### class가 감추지 못하는 것

**첫째, 메서드 추출의 this 상실.** [3-1](./01-execution-model.md)의 귀결이 class에서도 그대로다 — class 메서드는 프로토타입의 평범한 함수 프로퍼티이고, this는 여전히 호출 형태가 정한다.

```js
class SearchBox {
  constructor(input) {
    this.query = "";
    // ❌ 메서드 참조만 넘긴다 — 호출 형태 소거, this 상실
    input.addEventListener("input", this.handleInput);
    // ✅ 관례 1: 화살표 래핑 (호출 형태를 보존)
    input.addEventListener("input", (e) => this.handleInput(e));
  }
  handleInput(e) { this.query = e.target.value; }
}
```

세 번째 관례로 **필드 + 화살표 함수**(`handleInput = (e) => {...}`)가 있다. 필드는 인스턴스마다 생성되므로 this가 고정되지만, 프로토타입 공유를 포기하고 인스턴스마다 함수 객체를 만드는 비용, 그리고 프로토타입에 메서드가 없어 서브클래스에서 `super.handleInput`이 불가능해지는 제약이 따른다.

**둘째, 프로토타입은 런타임에 열려 있다.** 클래스 기반 언어에서 타입 구조는 로드 후 봉인되지만, JS의 프로토타입은 실행 중 언제든 수정·교체 가능하다. `Array.prototype.map = ...` 같은 몽키 패칭이 가능하고, 실제로 폴리필이 이 개방성 위에서 동작한다. 양날의 검이다 — 표준 기능의 소급 적용을 가능하게 했지만, 전역 공유 구조를 아무나 바꿀 수 있다는 뜻이기도 하다(2018년 SmooshGate: `Array.prototype.flatten`을 MooTools가 이미 정의해 둔 바람에 표준 이름이 `flat`으로 바뀐 사건). 애플리케이션 코드의 내장 프로토타입 확장은 이 이유로 금기다.

### private 필드 — 언어 수준의 진짜 캡슐화

`#name` 필드(ES2022)는 관례(`_name`)와 격이 다르다. **언어 차원에서 외부 접근 경로가 존재하지 않는다.**

```js
class Wallet {
  #balance = 0;
  deposit(n) { this.#balance += n; }
  get balance() { return this.#balance; }
}
const w = new Wallet();
w.deposit(100);
console.log(w.balance);      // 출력: 100
console.log(w["#balance"]);  // 출력: undefined — 프로퍼티가 아니다
// console.log(w.#balance);  // 클래스 밖에서는 SyntaxError — 파스 단계에서 거부
Object.keys(w);              // 출력: [] — #필드는 어떤 열거에도 안 나온다 (balance getter는 프로토타입 소속)
JSON.stringify(w);           // 출력: "{}" — 직렬화에도 안 보인다
```

#필드는 프로퍼티가 아니라 별도 내부 저장소이므로 descriptor도, Proxy 트랩도, `Reflect.ownKeys`도 닿지 않는다. 클로저 은닉([3-2](./02-closures-and-functions.md))과 달리 프로토타입 메서드 공유와 캡슐화를 동시에 얻는다. 오래된 대안인 WeakMap 패턴(인스턴스를 키로 비공개 데이터 저장)과 비교하면:

| | #필드 | WeakMap 패턴 | `_name` 관례 |
|---|------|-------------|-------------|
| 외부 접근 | 불가(SyntaxError) | 모듈 스코프 밖에서 불가 | 가능 — 관례일 뿐 |
| 서브클래스 접근 | 불가(클래스 단위 스코프) | WeakMap을 공유하면 가능 | 가능 |
| 직렬화/디버깅 | 안 보임 (DevTools는 특별히 보여줌) | 안 보임 | 보임 |

부수 기능으로 **브랜드 체크**가 있다: `#balance in obj`는 "obj가 이 클래스의 진짜 인스턴스인가"를 위조 불가능하게 판정한다. `instanceof`는 프로토타입 체인 검사라 체인 조작으로 속일 수 있지만, #필드의 존재는 생성자를 통과했다는 증거다.

### `__proto__`가 아니라 표준 경로로

프로토타입 링크의 조작 경로는 셋이 있었고 지금은 서열이 정리됐다. `__proto__` accessor는 비표준 유산이 웹 호환성 때문에 Annex B로 편입된 것으로, 읽기/쓰기 모두 비권장이다(객체 리터럴 안의 `__proto__:` 키만은 표준 문법이다). 표준 경로는 생성 시 지정 `Object.create(proto)`, 조회 `Object.getPrototypeOf(obj)`다. `Object.setPrototypeOf`는 표준이지만 **성능 함정**이다 — V8을 포함한 엔진들은 객체의 프로토타입이 안정적이라는 전제로 최적화(히든 클래스, 인라인 캐시 — 구현 세부)하는데, 살아 있는 객체의 프로토타입 교체는 그 전제를 깨서 해당 객체 관련 최적화를 무효화한다. 프로토타입은 생성 시점에 정하고 바꾸지 않는 것이 규칙이다.

## 실무 관점

**class vs 클로저 팩토리 vs 객체 리터럴** — 새 "타입"을 만들 때의 선택지다.

| | class | 클로저 팩토리([3-2](./02-closures-and-functions.md)) | 객체 리터럴/Object.create |
|---|------|------------------|------------------|
| 메서드 메모리 | 프로토타입 공유 — 인스턴스 수에 무관 | 인스턴스마다 함수 생성 | 공유 또는 개별, 설계 나름 |
| 캡슐화 | #필드 | 완전(환경 은닉) | 없음 |
| this 문제 | 있음 — 추출 시 상실 | 없음 — this를 안 씀 | 있음 |
| instanceof/브랜드 | 됨 | 안 됨 | 안 됨 |
| 무너지는 지점 | 콜백 위주 코드에서 bind/화살표 관리 부담 | 수만 개 인스턴스에서 메모리(계측으로 확인 — [3-10](./10-memory-and-storage.md)) | 인스턴스가 여럿 필요해지는 순간 |

판단 기준은 "this와 프로토타입의 이점(공유, 브랜드)을 쓸 것인가"다. 콜백으로 뜯겨 나갈 함수가 대부분인 모듈이라면 this 없는 클로저 팩토리가 사고 지점을 원천 제거한다. 인스턴스가 많고 계층·브랜드가 필요하면 class가 맞다.

**"프로토타입 오염(prototype pollution)" 취약점은 이 문서 모델의 보안 버전이다.** `JSON.parse` 결과를 재귀 병합하는 유틸이 `__proto__` 키를 걸러내지 않으면, 공격자가 보낸 `{"__proto__": {"isAdmin": true}}`가 `Object.prototype`에 프로퍼티를 심는다 — 이후 앱의 모든 객체가 `obj.isAdmin === true`가 된다(읽기는 체인을 타므로). 방어는 병합 시 `__proto__`/`constructor`/`prototype` 키 차단, 또는 `Object.create(null)`(체인 없는 객체)이나 Map을 사전 용도로 쓰는 것이다.

**hasOwn 검사를 습관화한다.** `for...in`은 체인까지 열거하므로, 누군가(라이브러리, 오염) 프로토타입에 enumerable 프로퍼티를 추가하면 순회 결과가 달라진다. `Object.keys`/`Object.entries`(자기 것만) 또는 `Object.hasOwn(obj, key)`(ES2022 — `obj.hasOwnProperty(key)`와 달리 체인 없는 객체에서도 안전)를 기본으로 쓴다.

## 더 깊이

**[[Get]]/[[Set]]은 교체 가능한 내부 메서드다.** 스펙은 객체를 "내부 메서드 집합을 구현하는 것"으로 정의하고(ordinary object의 [[Get]]이 §10.1.8의 체인 탐색), Proxy는 그 내부 메서드들을 사용자 함수(트랩)로 갈아끼운 exotic object다. 배열의 length 자동 갱신, 문자열의 인덱스 접근도 각각 exotic 내부 메서드의 결과다. "JS 객체의 동작"이라고 부르는 것은 사실 ordinary object의 기본 구현일 뿐이고, 프레임워크 반응성은 그 기본 구현을 트랩으로 대체하는 사업이다.

**V8의 히든 클래스(shape)와 프로퍼티 접근 비용 — 구현 세부.** V8은 같은 구조의 객체들에 히든 클래스를 공유시키고, 프로퍼티 접근 지점마다 "지난번과 같은 히든 클래스면 오프셋 직접 접근"하는 인라인 캐시를 심는다. 같은 형태의 객체만 지나가는 코드(단형)는 필드 접근이 C 구조체 수준으로 빠르고, 형태가 섞이면(다형→메가모픽) 사전 조회로 퇴화한다. 생성자/팩토리에서 **프로퍼티를 항상 같은 순서로 전부 초기화**하라는 실무 조언의 근거다. 단 이것은 표준이 보장하지 않는 V8 구현 세부이고, 코드 정확성이 아니라 성능에만 관련된다 — 의존하지 말고, 주장할 일이 있으면 벤치마크로 확인한다.

**null 프로토타입 객체의 용도.** `Object.create(null)`은 체인이 없으므로 `toString`도 `hasOwnProperty`도 없다. 순수 사전으로 쓸 때 프로토타입 오염과 키 충돌(`"constructor"`라는 사용자 키!)에서 자유롭다. V8도 내부적으로 이런 객체를 사전 모드로 다룬다. 다만 ES2015 이후에는 Map이 대부분의 사전 용도에서 더 낫다(임의 타입 키, size, 순회 순서 보장).

## 정리

- 객체의 전부는 "프로퍼티 모음 + [[Prototype]] 링크"다. 읽기는 체인을 타고 쓰기는 타지 않는다(accessor 예외) — 이 비대칭이 프로토타입 공유 오염 함정의 원인이다.
- 모든 프로퍼티는 descriptor(writable/enumerable/configurable)를 가지며, 이 플래그가 열거·spread·freeze의 동작을 정한다. freeze는 얕고, defineProperty 기반 반응성(Vue 2)은 추가/삭제를 못 봐서 Proxy(Vue 3)로 대체됐다.
- class는 생성자 함수 + non-enumerable 프로토타입 메서드 + 이중 체인(인스턴스/정적)의 문법이다. super는 [[HomeObject]] 기반이라 메서드 축약에서만 동작한다.
- class가 못 감추는 것: 메서드 추출 시 this 상실(호출 형태의 문제), 런타임에 열린 프로토타입(몽키 패칭·오염). #private 필드는 프로퍼티가 아닌 별도 저장소라 언어 수준 캡슐화와 브랜드 체크를 제공한다.
- 프로토타입은 생성 시(`Object.create`)에 정하고 바꾸지 않는다. `__proto__`는 유산, `setPrototypeOf`는 성능 함정이다.

## 확인 문제

**Q1.** 다음 코드의 출력을 예측하고, (2)와 (3)의 차이를 "읽기/쓰기 비대칭"으로 설명하라.

```js
const defaults = { retries: 3, tags: [] };
const config = Object.create(defaults);

config.retries = 5;
console.log(defaults.retries); // (1)
config.tags.push("prod");
console.log(defaults.tags);    // (2)
console.log(Object.hasOwn(config, "retries"), Object.hasOwn(config, "tags")); // (3)
```

<details>
<summary>정답과 해설</summary>

(1) `3` — `config.retries = 5`는 쓰기이므로 체인을 타지 않고 config에 섀도잉 프로퍼티를 만든다. defaults는 무관.

(2) `["prod"]` — `config.tags.push(...)`는 쓰기가 아니라 **읽기 + 메서드 호출**이다. 읽기는 체인을 타서 defaults의 배열을 찾아내고, push는 그 공유 배열을 변경한다. defaults가 오염됐다.

(3) `true false` — retries는 할당으로 자기 프로퍼티가 생겼고, tags는 여전히 체인 위 defaults의 것이다. "같은 문법처럼 보이는 `config.retries = 5`와 `config.tags.push()`가 완전히 다른 경로"라는 것이 비대칭의 요점이다. 기본값 객체를 프로토타입으로 공유하는 설계는 가변 객체 프로퍼티가 있는 순간 무너진다.
</details>

**Q2.** 인스턴스를 복제하려고 `const copy = { ...instance }`를 썼더니 "copy.greet is not a function" 에러가 났다. 원인을 descriptor와 프로토타입 두 층위로 설명하고, 클래스 정체성을 유지하는 복제 방법을 제시하라.

<details>
<summary>정답과 해설</summary>

두 층위의 원인: ① spread는 **자기(own) + enumerable** 프로퍼티만 복사하는데, class 메서드는 자기 프로퍼티가 아니라 프로토타입의 프로퍼티다(게다가 non-enumerable). ② spread 결과의 [[Prototype]]은 원본 클래스의 prototype이 아니라 `Object.prototype`이다 — 체인 자체가 끊겨서 위임으로도 메서드를 찾을 수 없다.

유지하는 복제: `Object.assign(Object.create(Object.getPrototypeOf(instance)), instance)` — 같은 프로토타입을 가진 새 객체에 데이터를 복사한다(#private 필드는 이 방법으로도 복제되지 않는다는 한계는 남는다). 더 나은 설계는 클래스에 명시적 복제 경로(`static from(other)` 또는 `clone()` 메서드)를 두는 것이다.
</details>

**Q3.** 코드 리뷰에서 다음 패턴을 발견했다. 이 코드가 통과 못 하는 상황(무너지는 지점)을 두 가지 제시하고, `#token in obj` 브랜드 체크가 그 상황들을 어떻게 다르게 처리하는지 설명하라.

```js
class ApiClient {
  #token = null;
  static isApiClient(obj) {
    return obj instanceof ApiClient;
  }
}
```

<details>
<summary>정답과 해설</summary>

`instanceof`는 "obj의 프로토타입 체인에 `ApiClient.prototype`이 있는가"라는 체인 검사일 뿐이다. 무너지는 지점: ① 위조 — `Object.create(ApiClient.prototype)`은 생성자를 거치지 않아 #token 저장소가 없는데도 instanceof를 통과한다(이후 #token 접근 메서드 호출 시 TypeError). ② 다중 realm — iframe이나 워커 등 다른 전역 환경에서 온 진짜 인스턴스는 그쪽 realm의 ApiClient.prototype을 가리키므로 instanceof가 false다.

`static isApiClient(obj) { return #token in obj; }`(ES2022 브랜드 체크)는 프로토타입 체인이 아니라 **#필드 저장소의 존재**를 검사한다. #필드는 생성자 실행으로만 설치되므로 ①의 위조가 불가능하다. ②는 여전히 해결되지 않는다(다른 realm의 클래스는 다른 #token 브랜드다) — realm 경계는 브랜드로도 넘을 수 없고, 구조 검사(덕 타이핑)나 직렬화 프로토콜이 필요하다.
</details>

## 참고 자료

- [ECMA-262 — Ordinary Object Internal Methods (§10.1)](https://tc39.es/ecma262/#sec-ordinary-object-internal-methods-and-internal-slots) — [[Get]]/[[Set]]의 체인 탐색과 쓰기 비대칭의 원문.
- [ECMA-262 — MakeMethod / [[HomeObject]] (§10.2.7)](https://tc39.es/ecma262/#sec-makemethod) — super가 메서드 축약에서만 동작하는 이유의 스펙 근거.
- [MDN — Object.defineProperty](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty) — descriptor 플래그별 동작 정리.
- [Vue 3 — Reactivity in Depth](https://vuejs.org/guide/extras/reactivity-in-depth.html) — defineProperty에서 Proxy로 전환한 공식 설명. descriptor 한계의 실전 사례.
- [v8.dev — Fast properties in V8](https://v8.dev/blog/fast-properties) — 히든 클래스와 인라인 캐시. 구현 세부 검증용 1차 자료.
