# 5-6. 상태 아키텍처

> 한 줄 요약: 이 문서를 읽고 나면 상태를 소유권·전파 범위·갱신 빈도로 분류해 지역 상태/Context/외부 스토어/서버 캐시 중 어디에 둘지 근거를 갖고 결정하고, Context의 리렌더 전파 문제와 tearing을 메커니즘 수준에서 설명할 수 있다.

이 문서는 React 19 기준이다. 외부 스토어 예시는 Zustand 5 기준이다.

## 학습 목표

- 상태를 지역 UI 상태 / 전역 앱 상태 / 서버 상태로 분류하고, 각 분류의 소유권이 어디 있는지 판정할 수 있다.
- Context의 전파 규칙(value 변경 시 모든 consumer 리렌더, bailout 관통)을 실측으로 확인하고, Provider 설계의 함정(인라인 value)을 수정할 수 있다.
- useSyncExternalStore가 존재하는 이유(tearing)와 외부 스토어의 selector 구독 모델이 Context와 다른 지점을 설명할 수 있다.
- "이 상태는 어디에 두는가"를 전파 범위 × 갱신 빈도 × 소유권 기준표로 결정할 수 있다.

## 배경: 왜 이것이 존재하는가

[5-3](./03-state-and-batching.md)까지의 상태는 컴포넌트 하나의 것이었다. 앱이 커지면 두 압력이 생긴다: 멀리 떨어진 컴포넌트들이 같은 상태를 봐야 하고(공유), 그 상태의 갱신이 관계없는 화면까지 다시 그리게 해서는 안 된다(격리). 상태 아키텍처는 이 두 압력의 균형 문제다.

이 문제를 백엔드 어휘로 옮기면 **데이터 소유권 설계**다. 마이크로서비스에서 "이 데이터의 원본(source of truth)은 어느 서비스인가"를 정하지 않으면 복사본들이 서로 어긋나듯, 프론트엔드에서도 같은 데이터가 여러 상태에 복사되는 순간 동기화 버그가 시작된다. 그리고 "일단 전역에 두자"는 전역 싱글턴 남용과 같은 결말 — 무엇이 무엇을 갱신하는지 아무도 모르는 상태 — 로 간다.

역사적 맥락도 이 관점으로 정리된다. Redux 전성기(2015~)의 "모든 상태를 하나의 스토어에"는 예측 가능성(단일 원본, 직렬화 가능한 액션 로그)을 샀지만, 서버 데이터까지 스토어에 복사하면서 캐시 무효화 문제를 손으로 풀게 만들었다. 이후 생태계는 상태를 **종류별로 분리**하는 방향으로 이동했다: 서버 데이터는 캐시 계층([5-8](./08-server-state.md))으로, 전역 UI 상태는 가벼운 스토어로, 나머지는 다시 컴포넌트로. 이 문서는 그 분류 기준을 세운다.

## 핵심 개념

### 상태 분류 — 소유권부터 묻는다

배치를 정하기 전에 상태의 종류를 판정한다. 질문은 "이 데이터의 원본은 누구인가"다.

| 분류 | 원본 | 예 | 기본 배치 |
|---|---|---|---|
| 지역 UI 상태 | 이 컴포넌트 | 입력값, 열림/닫힘, 탭 선택 | `useState` — 쓰는 곳에 |
| 전역 앱 상태 | 클라이언트 (여러 화면이 공유) | 테마, 로그인 세션, 장바구니 | Context 또는 외부 스토어 |
| 서버 상태 | **서버** | 상품 목록, 프로필, 주문 내역 | 서버 캐시 계층 ([5-8](./08-server-state.md)) |

세 번째 분류가 결정적이다. 서버 상태는 클라이언트가 원본이 아니므로 "상태"라기보다 **캐시**이고, 수명·재검증·무효화라는 캐시 고유 문제가 따라온다. 이를 `useState`나 전역 스토어로 다루는 순간 원본이 둘이 되고(서버의 진짜 데이터, 클라이언트의 복사본), 다른 화면에서의 변경·다른 사용자의 변경·시간 경과가 복사본을 조용히 낡게 만든다. 실무 전역 스토어의 상당 부분이 사실 서버 캐시였다는 것이 지난 몇 년 생태계의 재분류이고, 이 문서의 범위는 그것을 뺀 나머지다.

### 기본값은 아래에 — colocation과 끌어올리기

지역 상태의 원칙은 [5-5](./05-performance-model.md)에서 이미 나왔다: **그 상태를 쓰는 가장 좁은 범위에 둔다**(colocation). 전파 범위가 최소화되고, 컴포넌트가 자기 완결적이 되고, 삭제할 때 상태도 같이 사라진다.

두 컴포넌트가 같은 상태를 봐야 하면 **가장 가까운 공통 조상**으로 끌어올린다(lifting state up). 여기서 중요한 것은 끌어올리기가 비용을 갖는 결정이라는 점이다 — 조상이 리렌더 진원지가 되면서 전파 범위가 넓어진다. "나중에 필요할지 모르니 미리 위에/전역에"는 이 비용을 편익 없이 지불하는 것이다. 방향은 항상: 아래에서 시작하고, 공유 요구가 실제로 생기면 그때 필요한 높이까지만 올린다.

끌어올리다 보면 중간 계층들이 자기는 쓰지 않는 props를 아래로 나르기만 하는 지점이 온다 — props drilling. 이것이 Context를 검토하는 신호다. 단, 계층 두세 개의 drilling은 문제가 아니라 명시성이다(데이터 흐름이 코드에 보인다). Context의 실제 비용을 보고 판단하자.

### Context의 실제 동작 — 전파 규칙 실측

Context의 전파 규칙은 두 문장이다: **Provider의 value가 (Object.is로) 바뀌면 그 Provider 아래의 모든 consumer가 리렌더된다. consumer가 아닌 중간 컴포넌트는 리렌더되지 않는다 — 렌더가 생략(bailout)된 서브트리 안이라도 consumer는 깨운다.**

두 번째 문장이 놀라운 부분이므로 실측한다. 상태 소유자가 children을 받는 구조(전파 차단 패턴 — [5-2](./02-rendering-and-reconciliation.md))로 Provider를 만들면:

```jsx
const Theme = createContext(null);

function ThemeProvider({ children }) {
  const [mode, setMode] = useState('light');
  return <Theme.Provider value={{ mode, setMode }}>{children}</Theme.Provider>;
}
function Page() {          // context를 읽지 않는 중간 계층
  console.log('Page render');
  return <div><Consumer /><NonConsumer /></div>;
}
// <ThemeProvider><Page /></ThemeProvider> 에서 setMode('dark') 실측:
// ThemeProvider render dark
// Consumer render, dark      ← Page와 NonConsumer의 렌더 로그는 없다
```

`Page`는 children 참조가 그대로라 건너뛰었는데, 그 안의 `Consumer`만 정확히 깨어났다 — context 전파는 컴포넌트 트리의 렌더 전파와 **별도 경로**로 동작한다(구현: Provider가 자기 서브트리에서 해당 context를 읽는 Fiber를 찾아 갱신을 표시한다). "Provider 아래를 전부 리렌더시킨다"는 통념은 이 패턴을 안 쓴 코드에서 관찰된 현상이지, context 자체의 규칙이 아니다.

대신 진짜 함정은 **value의 참조**다. 렌더는 함수 재실행이므로 <code v-pre>value={{ mode, setMode }}</code>는 매 렌더 새 객체이고, Provider를 품은 컴포넌트가 관계없는 이유로 리렌더되면 mode가 안 바뀌었어도 모든 consumer가 리렌더된다(실측: 관계없는 상태 갱신에 `Consumer render` 재발). 방어는 두 겹이다:

```jsx
function AppProviders({ children }) {
  const [mode, setMode] = useState('light');
  // ① Provider 컴포넌트를 분리해 관계없는 리렌더 진원지와 격리하고
  // ② 그래도 리렌더될 수 있다면 value 참조를 고정한다
  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return <Theme.Provider value={value}>{children}</Theme.Provider>;
}
```

남는 한계가 Context의 본질적 제약이다: **구독의 단위가 value 전체**다. `{ user, cart, notifications }`를 한 Provider에 담으면 notifications만 바뀌어도 user만 읽는 consumer까지 리렌더된다 — value 중 어느 조각을 읽는지 React가 알 수 없기 때문이다. 완화책은 Context를 성격별로 쪼개는 것(갱신 빈도가 다른 것끼리 분리, 자주 쓰는 분리로는 상태/디스패치 분리 — setMode는 참조가 불변이라 디스패치 Context의 consumer는 리렌더가 없다)이지만, 조각 단위 구독 요구가 커지면 도구를 바꿀 신호다.

이 한계에서 Context의 정체성이 나온다: Context는 상태 관리 도구가 아니라 **주입(injection) 통로**다 — DI 컨테이너처럼 "트리 아래 어디서든 이 값에 접근"을 제공할 뿐, 구독 최적화·갱신 로직·미들웨어는 없다. 갱신이 드문 값(테마, 로케일, 현재 사용자, 서비스 인스턴스)에는 정확히 맞고, 갱신이 잦고 부분 구독이 필요한 값에는 맞지 않는다.

### 외부 스토어와 useSyncExternalStore

상태를 React 밖 모듈 스코프의 객체에 두고 컴포넌트가 구독하는 접근이 외부 스토어다. React 상태가 아니므로 [5-3](./03-state-and-batching.md)의 갱신 큐·스냅샷과 무관하게 언제든 변할 수 있고, 여기서 동시성 렌더링과의 충돌이 생긴다: 렌더가 중단·재개 가능하므로([5-2](./02-rendering-and-reconciliation.md)), 렌더 도중 스토어가 변하면 **한 화면의 앞부분은 옛 값, 뒷부분은 새 값**으로 그려질 수 있다. 이것이 tearing이다 — 화면 일관성(같은 렌더 안에서는 같은 값) 불변식의 파괴이고, React 상태에서는 스냅샷 의미론이 원천 차단하지만 외부 값에는 보장이 없다.

`useSyncExternalStore`(React 18+)가 이 간극의 표준 다리다:

```jsx
// 최소 외부 스토어
const store = {
  value: 0,
  listeners: new Set(),
  subscribe(l) { store.listeners.add(l); return () => store.listeners.delete(l); },
  getSnapshot() { return store.value; },
  set(v) { store.value = v; store.listeners.forEach(l => l()); },
};

function StoreReader() {
  const v = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <b>{v}</b>;
}
// 실측: store.set(42) → StoreReader만 리렌더 (형제 컴포넌트 렌더 없음)
```

이름의 sync가 계약의 핵심이다: React는 커밋 전에 스냅샷이 렌더 때와 같은지 확인하고, 다르면 **동기로 다시 렌더**해 찢어진 화면이 커밋되는 것을 막는다(해당 갱신은 동시성 기능의 이점을 포기한다 — 일관성과 맞바꾼 것). getSnapshot은 캐시된 불변 스냅샷을 반환해야 하며, 호출마다 새 객체를 만들면 무한 리렌더가 된다. 이 API는 브라우저 API 구독(`navigator.onLine`, media query, localStorage)에도 같은 이유로 쓰인다 — React 밖에서 변하는 모든 것이 "외부 스토어"다.

실측에서 보이는 외부 스토어의 구조적 장점: 갱신이 **구독한 컴포넌트만** 깨운다. 상태가 트리에 없으므로 조상 리렌더가 없고, 전파 범위는 구독 지점으로 정확히 좁혀진다.

### Zustand — selector 구독 모델

`useSyncExternalStore` 위에 스토어 정의·selector·액션을 얹은 최소 라이브러리가 Zustand다:

```jsx
import { create } from 'zustand';

const useCartStore = create((set) => ({
  items: [],
  coupon: null,
  add: (item) => set((s) => ({ items: [...s.items, item] })), // 불변 갱신 — 5-3과 같은 규칙
  applyCoupon: (c) => set({ coupon: c }),
}));

function CartBadge() {
  // selector: 스토어에서 이 컴포넌트가 읽는 조각만 선언
  const count = useCartStore((s) => s.items.length);
  return <span>{count}</span>;
}
```

Context와의 차이가 selector에 응축돼 있다: 갱신 시 각 구독의 selector를 실행해 **결과가 (Object.is로) 달라진 컴포넌트만** 리렌더한다. `coupon`이 바뀌어도 `s.items.length`는 그대로이므로 `CartBadge`는 조용하다 — Context가 못 하는 조각 단위 구독이다. 대가는 selector 반환값의 참조 규율(렌더마다 새 객체를 반환하는 selector는 매번 리렌더)과, 상태가 React 트리 밖으로 나가면서 컴포넌트 수명과의 결합(테스트 간 격리, 트리별 인스턴스)을 손수 챙겨야 한다는 것이다.

### 선택 기준표

| 기준 | 지역 useState | Context | 외부 스토어 | 서버 캐시 (5-8) |
|---|---|---|---|---|
| 소유권 | 이 컴포넌트 | 클라이언트 공유 | 클라이언트 공유 | **서버** |
| 전파 | 자기 서브트리 | 모든 consumer (value 전체 단위) | selector 통과분만 | 쿼리 키 구독자만 |
| 갱신 빈도 허용 | 높음 | **낮음** (드문 갱신 전용) | 높음 | 서버 왕복 단위 |
| 적합 예 | 입력, 토글, 탭 | 테마, 로케일, 세션, 서비스 주입 | 장바구니, 복잡한 클라이언트 도메인 상태 | 목록, 상세, 프로필 |
| 무너지는 지점 | 공유 요구 발생 | 잦은 갱신 + 부분 구독 요구 | 남용 시 전역 싱글턴화, 트리 밖 수명 관리 | 클라이언트가 원본인 데이터 |

판정 순서: ① 서버가 원본인가 → 서버 캐시. ② 한 서브트리만 쓰는가 → 지역, 필요한 높이까지만 끌어올림. ③ 전역 공유이되 갱신이 드문가 → Context. ④ 전역 공유 + 잦은 갱신 + 부분 구독 → 외부 스토어.

## 실무 관점

### "Context가 느려서 Redux/Zustand로 바꿨다"의 진단

이 흔한 서사는 대개 원인 오진이다. 실측에서 봤듯 Context 리렌더 문제의 대부분은 ① 인라인 value 객체(참조 불안정), ② 갱신 빈도가 다른 값들의 동거(한 value에 뭉침), ③ Provider가 children 패턴 없이 앱 전체를 직접 품는 구조 — 셋 다 Context 사용법의 문제다. 도구를 바꾸면 이 문제들이 selector 규율로 형태만 바뀌어 따라온다. 순서는 [5-5](./05-performance-model.md)와 같다: Profiler로 어느 consumer가 왜 리렌더되는지 계측 → 위 세 가지 수정 → 그래도 부분 구독 요구가 본질이면 그때 스토어로.

### 파생 상태를 저장하지 않는다 — 아키텍처 수준에서도

컴포넌트 수준의 원칙([5-4](./04-effects.md)의 "파생값은 렌더 중 계산")은 스토어 수준에서도 같다. `items`와 `totalPrice`를 둘 다 스토어에 두면 동기화 책임이 생긴다 — `totalPrice`는 selector로 계산한다(`useCartStore(s => s.items.reduce(...))`). 서버 캐시의 복사본을 스토어에 넣는 것도 같은 위반의 더 큰 형태다: "TanStack Query에서 받아서 Zustand에 넣는다"는 패턴이 보이면 원본 이중화 경보다 — 화면이 읽을 곳은 캐시 그 자체여야 한다([5-8](./08-server-state.md)).

### URL도 상태 저장소다

"어느 상품 상세를 보는가", "필터·정렬·페이지", "모달이 열려 있는가"처럼 **새로고침·공유·뒤로가기에서 살아남아야 하는 상태**는 useState도 스토어도 아니라 URL이 정답이다 — 브라우저가 이미 제공하는 전역·영속·공유 가능한 상태 저장소이고, [5-7](./07-routing-and-code-splitting.md)의 라우터가 그 구독 통로다. 이 분류를 빠뜨리면 "뒤로 가기 했더니 필터가 사라졌다"류의 UX 버그가 상태 아키텍처 문제로 나타난다.

### 전역화 요청의 리트머스

"이 상태를 전역으로 옮기자"는 요청에 붙일 질문들: 실제로 몇 개의 화면이 읽는가(둘이면 공통 조상으로 충분하다), 갱신 주체가 몇인가(하나면 소유자를 그곳에 두면 된다), 서버가 원본 아닌가(그러면 캐시 문제다), 새로고침에도 남아야 하는가(그러면 URL 또는 영속 계층이다). 네 질문을 통과한 것만이 진짜 전역 앱 상태이고, 경험상 그 목록은 짧다 — 세션, 테마, 장바구니류 몇 개.

## 더 깊이

### Context 전파의 구현 경로

Provider의 value가 바뀌면 React는 workInProgress 트리를 만들며 각 Fiber에서 bailout 여부를 판정하는데, bailout하는 경우에도 그 서브트리에 해당 context의 소비자가 있는지 추적하는 경로가 있다 — 각 Fiber는 자기가 읽는 context들의 목록(dependencies)을 갖고, Provider 갱신 시 React는 서브트리를 훑으며 일치하는 소비자 Fiber에 갱신을 표시한다(propagateContextChange). "bailout을 관통해 consumer만 깨운다"는 실측이 이 메커니즘이다. 반대로 말하면 Provider 갱신은 소비자 탐색 비용을 가지므로, 극단적으로 넓은 트리 + 잦은 갱신 조합은 이 탐색 자체도 비용이 된다 — 잦은 갱신에 Context를 쓰지 말라는 권고의 구현 측 근거다.

### tearing이 실제로 보이는 조건

tearing은 세 조건의 교집합에서만 관찰된다: 외부 가변 값 + 렌더 중단이 일어나는 동시성 기능(transition 등) 사용 + 렌더 도중의 값 변경. React 18 이전(동기 렌더)에는 렌더가 원자적이라 구조적으로 불가능했고, 18+에서도 일반 갱신(동기 lane)은 찢어지지 않는다. 낮은 재현율 때문에 "우리 앱은 괜찮던데"가 되기 쉬운데, 이는 race condition이 "대개 괜찮은" 것과 같은 종류의 괜찮음이다. 외부 상태 라이브러리들(Redux, Zustand, Jotai)이 전부 uSES 기반으로 이행한 것이 이 문제의 실재성에 대한 생태계의 답이다.

### 상태 관리 라이브러리의 세 갈래

현 생태계의 클라이언트 상태 도구는 모델로 세 갈래다: **단일 스토어 + 구독**(Redux, Zustand — 이 문서의 모델), **원자 그래프**(Jotai, Recoil — 상태를 atom 단위로 쪼개고 의존 그래프로 파생값을 자동 재계산; 구독이 atom 단위라 selector가 필요 없다), **프록시 추적**(Valtio, MobX — 렌더 중 어떤 프로퍼티를 읽었는지 프록시로 기록해 그 프로퍼티 변경에만 반응). 셋 다 "부분 구독으로 전파를 좁힌다"는 같은 문제를 다른 정밀도·규율로 푼다. 선택은 팀의 규율 선호(명시적 selector vs 자동 추적) 문제에 가깝고, 이 문서의 분류 기준(소유권·전파·빈도)은 어느 갈래에서든 동일하게 적용된다.

## 정리

- 배치 전에 분류: 원본이 서버면 서버 캐시(5-8), 컴포넌트 하나면 지역, 클라이언트 공유면 Context 또는 외부 스토어. 기본값은 가장 아래(colocation)이고 끌어올리기는 비용을 갖는 결정이다.
- Context 전파의 실제 규칙: value가 Object.is로 바뀌면 모든 consumer가 리렌더되며, bailout된 서브트리도 관통한다. 함정은 전파 자체가 아니라 인라인 value 객체와 갱신 빈도가 다른 값의 동거다.
- Context는 상태 관리가 아니라 주입 통로다 — 갱신이 드문 값(테마, 세션, 서비스)에 맞고, 부분 구독은 못 한다.
- 외부 스토어는 useSyncExternalStore로 React와 접속한다 — sync 계약이 동시성 렌더의 tearing(한 화면에 두 시점 공존)을 막고, selector가 조각 단위 구독으로 전파를 좁힌다.
- 새로고침·공유·뒤로가기를 견뎌야 하는 상태는 URL이 저장소다. 파생값은 어느 계층에서든 저장하지 말고 계산한다.

## 확인 문제

**Q1.** 앱 전체를 감싸는 <code v-pre><AppContext.Provider value={{ user, cart, theme, addToCart, setTheme }}></code>가 있고, 장바구니에 담기를 누를 때마다 테마 토글 버튼까지 리렌더된다는 Profiler 결과가 나왔다. 원인을 Context의 전파 규칙으로 설명하고, 도구를 바꾸지 않는 선에서의 재설계를 제시하라.

<details>
<summary>정답과 해설</summary>

원인: Context 구독의 단위는 value 전체다. `addToCart`가 `cart`를 갱신하면 value 객체가 새로 만들어지고(Object.is 불일치), 이 Provider의 **모든** consumer — theme만 읽는 토글 버튼 포함 — 가 리렌더된다. React는 consumer가 value의 어느 조각을 읽는지 모른다.

재설계: ① 갱신 빈도·성격별로 Context를 쪼갠다 — `ThemeContext`(드묾), `CartContext`(잦음), `UserContext`. cart 갱신은 이제 CartContext의 consumer만 깨운다. ② 각 Provider에서 상태와 디스패치를 분리한다 — `setTheme`·`addToCart` 같은 함수는 참조가 안정적이므로(useState setter, 또는 useCallback 고정) 디스패치 전용 Context의 consumer는 상태 갱신에 리렌더되지 않는다. ③ 각 Provider 컴포넌트는 children을 받는 구조로 만들고 value를 useMemo로 고정해, 관계없는 리렌더가 value 참조를 흔들지 않게 한다. 추가로: `user`가 서버 원본이라면 애초에 Context가 아니라 서버 캐시 소관이다.
</details>

**Q2.** `useSyncExternalStore` 없이 `useEffect`에서 스토어를 구독하고 `useState`로 복사하는 방식(`useEffect(() => store.subscribe(() => setV(store.get())), [])`)과 비교해, uSES가 추가로 보장하는 것은 무엇인가? 이펙트 방식에는 어떤 시간 축 구멍이 있는가?

<details>
<summary>정답과 해설</summary>

이펙트 방식의 구멍: ① 구독 시작이 커밋 후다(5-4의 실행 시점) — 렌더(스냅샷 읽기)와 구독 시작 사이에 스토어가 변하면 그 변경을 놓친 채 옛 값으로 화면이 남는다(수동으로 구독 직후 재확인 코드를 넣어야 막힌다). ② tearing 무방비 — 동시성 렌더가 중단된 사이 스토어가 변하면, 재개된 렌더의 뒷부분이 새 값을 읽어 한 커밋 안에 두 시점이 공존할 수 있다. useState 복사본은 이를 감지할 방법이 없다.

uSES의 추가 보장: 렌더 중 읽은 스냅샷을 React가 기억하고, 커밋 전에 getSnapshot을 다시 호출해 불일치하면 동기 재렌더로 일관된 화면만 커밋한다(tearing 차단). 또한 구독 누락 구간 문제를 훅 계약 안에서 처리한다. 요약하면 이펙트 방식은 "대개 동작하는" 수동 다리이고, uSES는 동시성 렌더링의 시간 축까지 계약에 넣은 표준 다리다.
</details>

**Q3.** 상품 목록 페이지의 다음 상태들을 기준표로 분류하고 배치를 결정하라: ⓐ 상품 목록 데이터, ⓑ 현재 페이지 번호와 정렬 기준, ⓒ "비교함"에 담은 상품 id 목록(여러 페이지에서 쓰고, 헤더 배지에도 개수 표시), ⓓ 각 상품 카드의 이미지 캐러셀 현재 슬라이드.

<details>
<summary>정답과 해설</summary>

ⓐ 서버가 원본 — 서버 캐시(5-8, TanStack Query 등). 스토어나 useState 복사 금지. ⓑ 새로고침·공유·뒤로가기에서 살아남아야 하는 탐색 상태 — URL 쿼리 파라미터(`?page=3&sort=price`). 라우터로 읽고 쓴다. ⓒ 클라이언트가 원본(서버에 없는 사용자 선택), 여러 화면 + 헤더가 공유, 갱신도 잦은 편 — 전역이 정당하다. 부분 구독(배지는 개수만)이 유용하므로 외부 스토어(Zustand)의 selector가 잘 맞고, 규모가 작으면 Context로도 가능하되 갱신 빈도를 고려해 분리된 Context로. 새로고침 유지가 요구되면 스토어 + localStorage 영속을 더한다. ⓓ 그 카드만의 UI 상태 — 카드 컴포넌트의 지역 useState. 끌어올릴 이유가 없고, 카드 언마운트와 함께 사라지는 것이 맞는 수명이다.
</details>

## 참고 자료

- [react.dev — Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) / [Scaling Up with Reducer and Context](https://react.dev/learn/scaling-up-with-reducer-and-context) — Context의 공식 사용 기준("Before you use context" 절 포함).
- [react.dev — useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — 계약(subscribe/getSnapshot)과 주의사항의 공식 문서.
- [What is tearing? (reactwg/react-18)](https://github.com/reactwg/react-18/discussions/69) — tearing의 정의와 시각 자료. React 워킹 그룹 공식 논의.
- [Zustand 문서](https://zustand.docs.pmnd.rs/) — selector 구독 모델과 실무 패턴. 이 문서의 Zustand 5 기준 근거.
- [react.dev — Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) — 끌어올리기와 단일 원본 원칙의 공식 서술.
