# 5-4. 이펙트

> 한 줄 요약: 이 문서를 읽고 나면 useEffect를 "외부 시스템과의 동기화 장치"로 정의하고, 의존성 배열·클린업·stale closure·race condition을 그 정의에서 유도해 진단할 수 있으며, 이펙트가 필요 없는 코드를 식별해 제거할 수 있다.

이 문서는 React 19 기준이다.

## 학습 목표

- 이펙트의 실행 시점(커밋 후)과 클린업 사이클을 "동기화 시작/중단의 쌍"으로 설명할 수 있다.
- 의존성 배열을 "실행 빈도 노브"가 아니라 "이펙트가 읽는 반응형 값의 목록"으로 정의하고, 의존성 누락이 만드는 stale closure를 클로저 수준에서 해부할 수 있다.
- 데이터 페칭 이펙트의 race condition을 재현하고 ignore 플래그·AbortController로 수정할 수 있다.
- "이펙트가 필요 없는 경우" 세 유형(파생값, 이벤트 로직, 상태 연쇄)을 식별하고 재설계할 수 있다.

## 배경: 왜 이것이 존재하는가

[5-1](./01-react-mental-model.md)에서 렌더는 순수 계산이어야 한다고 했다. 그러나 실제 앱은 순수할 수 없다 — WebSocket을 구독하고, 타이머를 걸고, React가 관리하지 않는 DOM(차트 라이브러리, 비디오 엘리먼트)을 조작하고, 문서 제목을 바꾼다. 부수 효과가 갈 곳이 필요하다.

부수 효과의 1순위 지정석은 **이벤트 핸들러**다. "버튼을 누르면 전송한다"는 렌더링 모델과 충돌하지 않는다 — 사용자 행동에 반응하는 코드일 뿐이다. 문제는 특정 행동에 속하지 않는 부수 효과다. "이 채팅방 컴포넌트가 화면에 있는 동안 서버에 연결되어 있어야 한다"는 어느 클릭의 결과가 아니라 **화면 상태와 외부 시스템 상태의 일치 조건**이다. 이 자리를 위한 장치가 이펙트다.

그래서 정확한 정의는 "렌더 후 실행되는 콜백"이 아니라 **"렌더 결과와 외부 시스템을 동기화하는 선언"** 이다. 이 구분이 중요한 이유: 전자로 이해하면 이펙트는 "무언가 하고 싶을 때"의 만능 훅이 되어 이 문서 후반의 안티패턴들이 나오고, 후자로 이해하면 클린업·의존성·이중 실행이 전부 한 정의에서 유도된다. 백엔드 경험에 빗대면 이펙트는 crontab(시점 기반 실행)이 아니라 Kubernetes의 reconciliation loop다 — "선언된 상태(이번 렌더의 props/state)와 실제 세계(연결, 구독)를 일치시켜라"이고, 클린업 없는 이펙트는 리소스를 회수하지 않는 컨트롤러다.

## 핵심 개념

### 실행 시점 — 커밋 후, 화면 그리기와 경쟁하지 않게

이펙트는 렌더 중이 아니라 **커밋이 끝난 뒤** 실행된다. 순서를 관찰하면:

```jsx
function App() {
  const [n, setN] = useState(0);
  console.log('1. render');
  useEffect(() => {
    console.log('3. effect');
  });
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
// 출력 순서: 1. render → (2. 커밋: DOM 반영) → 3. effect
```

이 시점 선택의 근거: 이펙트가 렌더 중에 실행되면 순수성이 깨지고([5-1](./01-react-mental-model.md)), 커밋 전에 실행되면 아직 없는 DOM을 만지게 된다. 커밋 후로 미루면 둘 다 해결되고, 덤으로 이펙트가 화면 표시를 막지 않는다 — `useEffect`는 브라우저가 페인트한 뒤 비동기로 실행되는 것을 목표로 스케줄된다(보장이 아니라 목표다 — 예를 들어 이펙트 안에서 또 다른 동기 갱신이 예약되어 있으면 페인트 전에 실행될 수 있다).

페인트 **전**에 동기로 실행되어야 하는 좁은 예외를 위해 `useLayoutEffect`가 있다: DOM을 측정해서 그 결과로 다시 그려야 하는 경우(툴팁 위치 계산 등), 중간 상태가 한 프레임 보이는 깜빡임을 막는다. 대가는 그 실행 시간만큼 페인트가 늦어지는 것이므로([3-5](../phase-3/05-event-loop.md)의 렌더링 파이프라인에서 long task가 하는 일과 같다), 측정-재배치 용도 밖에서는 `useEffect`가 기본값이다.

### 클린업 — 마운트/언마운트 콜백이 아니라 동기화의 쌍

이펙트가 "동기화"라면 시작과 중단이 쌍이어야 한다. 클린업 함수가 그 중단이고, 실행 규칙은 하나다: **다음 동기화가 시작되기 전, 그리고 언마운트 때, 직전 이펙트의 클린업이 먼저 실행된다.**

```jsx
function ChatRoom({ roomId }) {
  useEffect(() => {
    console.log('연결:', roomId);
    const conn = connect(roomId);
    return () => {
      console.log('해제:', roomId); // 이 클로저의 roomId — 자기가 연결한 그 방
      conn.disconnect();
    };
  }, [roomId]);
  // ...
}
// roomId가 1 → 2로 바뀔 때의 실측 순서:
// render, id = 1 → effect: subscribe 1
// render, id = 2 → cleanup: unsubscribe 1 → effect: subscribe 2
// 언마운트: cleanup: unsubscribe 2
```

주목할 것: 클린업은 **자기 렌더의 값**을 클로저로 들고 있다. "해제: 1"이 가능한 이유는 클린업 함수가 `roomId = 1`이던 렌더에서 만들어졌기 때문이다([5-3](./03-state-and-batching.md)의 스냅샷이 여기서도 일한다). "마운트에서 연결, 언마운트에서 해제"라는 낡은 모델로는 이 중간 전환(방 이동)이 설명되지 않는다 — 정확한 모델은 "동기화 대상이 바뀔 때마다 이전 동기화를 중단하고 새로 시작"이다.

`StrictMode`는 이 쌍의 완결성을 개발 모드에서 검증한다: 마운트 직후 이펙트를 **setup → cleanup → setup**으로 한 사이클 더 돌린다(실측: `setup / cleanup / setup`). 클린업이 setup을 정확히 되돌린다면 아무 문제가 없어야 하고, 문제가 생긴다면(구독이 두 개 쌓임, 요청이 중복 발사됨) 클린업이 불완전한 것이다. "StrictMode에서 이펙트가 두 번 돌아요"는 버그 리포트가 아니라 검출이다.

### 의존성 배열 — 빈도 노브가 아니라 읽는 값의 목록

의존성 배열의 의미는 "언제 실행할지"가 아니다. **"이 이펙트가 읽는 반응형 값(props, state, 그로부터 파생된 렌더 스코프 값)의 전부"** 다. React는 렌더마다 배열의 각 원소를 이전과 `Object.is`로 비교해, 하나라도 다르면 재동기화(클린업 → 재실행)한다.

이 구분이 왜 중요한가. "실행 빈도를 조절하고 싶다"는 의도로 의존성을 빼면, 이펙트의 클로저가 옛 렌더에 묶인다 — stale closure다.

```jsx
// ❌ 의존성 누락: 이 이펙트의 클로저는 마운트 렌더(count = 0)에 고정된다
useEffect(() => {
  const id = setInterval(() => {
    setCount(count + 1); // 항상 0 + 1 — 매초 1로 "갱신"되어 1에서 멈춘다
  }, 1000);
  return () => clearInterval(id);
}, []); // count를 읽는데 목록에 없다 — 린터가 경고하는 지점
```

[3-2](../phase-3/02-closures-and-functions.md)로 해부하면: 이펙트 함수는 마운트 렌더에서 생성된 클로저이고, 그 안의 `count`는 그 렌더의 값 0이다. 빈 배열은 "재동기화하지 않는다"는 뜻이므로 이 클로저는 영원히 교체되지 않고, 인터벌은 매초 `setCount(1)`을 반복한다.

수정 방향이 둘 있는데, 우열이 있다:

```jsx
// ✅ 차선: 의존성을 정직하게 — count가 바뀔 때마다 인터벌을 재설치 (동작은 맞다)
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, [count]);

// ✅ 최선: 이펙트가 count를 읽을 필요 자체를 없앤다 — 함수형 갱신
useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000); // 큐를 읽으므로 스냅샷 불필요
  return () => clearInterval(id);
}, []); // 이제 빈 배열이 정직하다 — 반응형 값을 아무것도 안 읽는다
```

원칙: **린터(`exhaustive-deps`)를 끄는 것이 아니라, 의존성이 거슬리면 의존성을 없애는 코드로 재설계한다.** 함수형 갱신([5-3](./03-state-and-batching.md)), 객체 대신 원시값 의존(`[user]` 대신 `[user.id]`), 함수를 이펙트 안으로 이동 — 전부 "이 이펙트가 정말로 읽어야 하는 것"을 줄이는 기법이다. 렌더마다 새로 만들어지는 객체·함수를 의존성에 넣으면 매 렌더 재동기화되는 반대 방향 사고도 같은 원칙으로 잡는다(원시값으로 좁히거나, 정말 필요하면 [5-5](./05-performance-model.md)의 useMemo/useCallback으로 참조를 고정한다).

### 데이터 페칭과 race condition

이펙트로 fetch를 하면 [3-8](../phase-3/08-network-apis.md)에서 본 race condition이 그대로 들어온다. 사용자가 프로필 1을 열고 즉시 2로 전환하면, 요청 두 개가 동시에 난다 — 그리고 네트워크는 순서를 보장하지 않는다.

```jsx
// ❌ 늦게 도착한 응답이 이긴다
useEffect(() => {
  fetchUser(userId).then(data => setName(data));
}, [userId]);
// 실측 (userId 1의 응답이 2보다 늦게 도착하도록 지연을 조작):
// ignore 없음 → 화면: user-1   ← userId는 2인데 화면은 1. 화면-상태 불일치
```

이펙트 모델 안의 해법은 클린업이다 — "이 동기화는 중단되었다"를 응답 처리에 알린다:

```jsx
// ✅ ignore 플래그: 중단된 동기화의 응답을 버린다
useEffect(() => {
  let ignore = false;
  fetchUser(userId).then(data => {
    if (!ignore) setName(data);
  });
  return () => { ignore = true; }; // userId가 바뀌면 이전 이펙트의 응답은 무시
}, [userId]);
// 실측: ignore 적용 → 화면: user-2
```

한 단계 더 — 응답을 버리는 대신 요청 자체를 취소하려면 [3-8](../phase-3/08-network-apis.md)의 AbortController를 클린업에 연결한다:

```jsx
useEffect(() => {
  const controller = new AbortController();
  fetchUser(userId, { signal: controller.signal })
    .then(data => setName(data))
    .catch(err => {
      if (err.name !== 'AbortError') throw err; // 취소는 오류가 아니다
    });
  return () => controller.abort(); // 대역폭·서버 자원까지 회수
}, [userId]);
```

ignore는 단순하고(취소 불가능한 작업에도 적용 가능), abort는 자원까지 아낀다 — 실무에서는 abort + AbortError 무시가 정석이다. 그리고 여기까지 쓰고 나면 목록이 생긴다: race 처리, 로딩/에러 상태, 캐싱 없음(방문할 때마다 재요청), 중복 요청… 컴포넌트마다 이걸 재발명하는 것이 이펙트 페칭의 실제 비용이고, 이 문제들의 정식 해법은 [5-8](./08-server-state.md)의 서버 상태 라이브러리다. 이 문서에서는 그 라이브러리가 내부에서 무엇을 대신해 주는지를 이해하는 것까지가 목표다.

### 이펙트가 필요 없는 경우

이펙트의 정의(외부 시스템과의 동기화)를 기준으로 걸러내면, 실무 이펙트의 상당수는 이펙트가 아니어야 한다. 세 유형:

**① 파생값 계산.** 렌더 중 계산으로 충분한 것을 상태 + 이펙트로 동기화하는 패턴.

```jsx
// ❌ 상태 두 개의 수동 동기화 — 렌더 두 번(옛 fullName으로 한 번, 이펙트 갱신 후 한 번)
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// ✅ 렌더 중 계산 — 항상 일관, 렌더 한 번
const fullName = `${first} ${last}`;
```

**② 이벤트에 속한 로직.** "제출되면 알림을 보낸다"를 "submitted 상태가 true가 되면 이펙트가 알림"으로 우회하는 패턴 — 인과가 상태를 경유하며 흐려지고, 컴포넌트가 다른 이유로 리렌더될 때 오발사 위험이 생긴다. 사용자 행동의 결과는 그 행동의 핸들러에 쓴다.

**③ 상태 연쇄.** `setA` → 이펙트가 `setB` → 다른 이펙트가 `setC`. 각 단계가 렌더 한 번씩을 낭비하고, 실행 순서가 코드에서 보이지 않는다. 다음 상태들이 서로 계산 가능하면 한 핸들러(또는 하나의 reducer 전이 — [5-3](./03-state-and-batching.md))에서 함께 갱신한다.

판별 질문은 하나다: **"이 코드는 외부 시스템과 동기화하는가?"** 아니오라면 이펙트가 아니다 — 렌더 중 계산이거나, 핸들러의 일이다.

## 실무 관점

### 이펙트 증상 → 원인 대응표

| 증상 | 원인 | 수정 |
|---|---|---|
| 인터벌/구독 콜백이 항상 옛 값을 본다 | 의존성 누락 → stale closure | 함수형 갱신 등으로 의존성 자체를 제거, 또는 정직한 의존성 |
| 이펙트가 매 렌더 돈다 | 의존성에 렌더마다 새로 만드는 객체/함수 | 원시값으로 좁히기, 함수를 이펙트 안으로, 참조 고정은 최후 |
| StrictMode에서 구독·요청이 중복된다 | 클린업 누락/불완전 | setup을 정확히 되돌리는 클린업 작성 |
| 빠른 전환 시 화면에 옛 데이터가 남는다 | 페칭 race | AbortController(+AbortError 무시) 또는 ignore 플래그 |
| 값 하나 바꿨는데 렌더가 여러 번 돈다 | 상태 연쇄(이펙트가 setState) | 핸들러/reducer에서 함께 갱신, 파생값은 렌더 중 계산 |

### "의존성 경고를 끄고 싶다"는 신호다

`// eslint-disable-next-line react-hooks/exhaustive-deps`가 필요하다고 느끼는 지점은 거의 항상 설계 문제의 표면이다: 이펙트 하나가 두 가지 동기화를 겸하고 있거나(분리하면 의존성이 자연스러워진다), 이벤트 로직이 이펙트에 들어와 있거나(핸들러로), "최신 값을 읽되 재실행은 원치 않는" 요구다. 마지막 경우는 React가 `useEffectEvent`(이펙트에서 호출하는 비반응형 함수)로 해결하려는 문제이며, React 19.2에서 정식 API로 제공된다 — 그 전 버전에서는 ref에 최신 값을 비춰 읽는 우회가 흔했다. 어느 쪽이든 "경고를 끈다"는 선택지에는 stale closure가 대가로 붙는다는 것을 알고 선택해야 한다.

### 이펙트 설계 체크리스트

- 이펙트 하나 = 동기화 하나. "연결도 하고 분석 이벤트도 보내는" 이펙트는 의존성이 합집합이 되어 서로를 불필요하게 재실행시킨다 — 분리한다.
- 클린업을 먼저 생각한다. "이 동기화를 중단하려면?"에 답이 없는 이펙트(예: 완료를 기다릴 수밖에 없는 작업)는 ignore 플래그가 최소 방어다.
- 컴포넌트 밖에서 한 번이면 되는 일(앱 초기화, 전역 리스너)은 컴포넌트 밖 모듈 스코프나 진입점에서 한다 — 이펙트는 컴포넌트 수명에 묶인 동기화에만.

## 더 깊이

### 이펙트의 스케줄링 — passive effect

구현 수준에서 `useEffect`는 passive effect로 분류된다. 커밋 단계에서 React는 이펙트를 즉시 실행하지 않고 스케줄러에 콜백을 예약하며, 이 콜백은 일반적으로 페인트 이후의 태스크에서 클린업 → setup 순으로 일괄 실행된다. 반면 `useLayoutEffect`(와 클래스의 `componentDidMount`)는 커밋의 일부로 **동기** 실행된다 — DOM 변경과 페인트 사이에 끼어들 수 있는 이유이자, 무거우면 페인트를 지연시키는 이유다. "일반적으로"라는 단서가 붙는 것은 같은 프레임에 동기 갱신이 이어지면 React가 페인트 전에 passive effect를 당겨 실행(flush)하는 경로가 있기 때문이다 — "페인트 후"는 보장이 아니라 스케줄링 목표라는 본문의 서술이 여기서 나온다.

### 이펙트와 이벤트 루프

[3-5](../phase-3/05-event-loop.md)의 어휘로 배치하면: 커밋(DOM 변경)은 갱신을 처리하는 태스크 안에서 일어나고, 브라우저는 그 태스크가 끝난 뒤 렌더링 기회를 갖고(스타일·레이아웃·페인트), passive effect는 그 이후의 태스크에서 돈다. 따라서 이펙트에서 `el.getBoundingClientRect()`를 읽으면 이미 페인트된 레이아웃을 읽는 것이고(강제 동기 레이아웃 없음), `useLayoutEffect`에서 읽고 쓰면 페인트 전이므로 깜빡임은 없지만 레이아웃 계산을 그 자리에서 지불한다. 이 비용 차이는 DevTools Performance 패널에서 태스크와 페인트 마커의 위치로 직접 관찰할 수 있다.

### 왜 React는 페칭을 이펙트에서 밀어내는가

공식 문서조차 이펙트 페칭을 "가능하지만 권장 경로가 아님"으로 서술한다. 구조적 이유가 있다: 이펙트는 커밋 후에 돌므로, 데이터 요청이 **렌더 완료를 기다린다**. 부모가 렌더 → 커밋 → 이펙트 → 자식 데이터 도착 → 자식의 자식이 또 페칭… 하는 네트워크 워터폴이 계층마다 생긴다. 렌더보다 먼저(라우트 진입 시점 — [5-7](./07-routing-and-code-splitting.md)의 loader) 또는 렌더와 병행해(Suspense 기반, RSC — 7-6) 요청을 시작하는 것이 방향이고, 클라이언트 캐시 계층([5-8](./08-server-state.md))이 그 사이의 실용 해법이다. 이펙트 페칭은 "컴포넌트 수명에 묶인 동기화"라는 이펙트의 정의에는 맞지만, 시작 시점이 구조적으로 늦다.

## 정리

- 이펙트는 "렌더 후 콜백"이 아니라 렌더 결과와 외부 시스템의 동기화 선언이다. 커밋 후 실행되고, `useLayoutEffect`는 측정-재배치용 동기 예외다.
- 클린업은 동기화 중단이며, 재동기화 전과 언마운트 시 자기 렌더의 스냅샷 값으로 실행된다. StrictMode의 setup→cleanup→setup은 이 쌍의 완결성 검증이다.
- 의존성 배열은 이펙트가 읽는 반응형 값의 전부다. 빈도 조절로 오용하면 stale closure가 생기고, 올바른 대응은 린터 끄기가 아니라 의존성을 줄이는 재설계(함수형 갱신, 원시값 의존)다.
- 페칭 이펙트는 race condition을 기본 탑재한다 — AbortController(또는 ignore 플래그)를 클린업에 연결하는 것이 최소 방어이고, 정식 해법은 5-8의 서버 상태 계층이다.
- 외부 시스템과의 동기화가 아니면 이펙트가 아니다: 파생값은 렌더 중 계산, 사용자 행동의 결과는 핸들러, 상태 연쇄는 한 전이로 합친다.

## 확인 문제

**Q1.** 다음 채팅 컴포넌트는 StrictMode 개발 모드에서 메시지가 두 번씩 수신된다. 프로덕션 빌드에서는 괜찮아 보인다. 원인을 설명하고, "StrictMode를 끄면 되지 않느냐"는 동료의 제안에 어떻게 답할지 서술하라.

```jsx
function ChatRoom({ roomId }) {
  const [messages, setMessages] = useState([]);
  useEffect(() => {
    socket.emit('join', roomId);
    socket.on('message', m => setMessages(prev => [...prev, m]));
  }, [roomId]);
  // ...
}
```

<details>
<summary>정답과 해설</summary>

원인: 클린업이 없다. StrictMode는 setup→cleanup→setup을 돌리는데 cleanup이 비어 있으므로 `socket.on('message', ...)` 리스너가 두 번 등록되고, 메시지마다 setMessages가 두 번 돈다.

동료에게: StrictMode는 버그를 만든 것이 아니라 이미 있는 버그를 앞당겨 보여준 것이다. 프로덕션에서도 `roomId`가 바뀌면 같은 일이 일어난다 — 이전 방의 리스너와 join이 정리되지 않은 채 새 방 것이 쌓여, 방을 옮길 때마다 리스너가 누적되고 이전 방 메시지까지 수신한다. StrictMode를 끄면 이 검출만 사라지고 버그는 남는다. 수정은 동기화의 쌍을 완성하는 것:

```jsx
useEffect(() => {
  const onMessage = m => setMessages(prev => [...prev, m]);
  socket.emit('join', roomId);
  socket.on('message', onMessage);
  return () => {
    socket.off('message', onMessage);
    socket.emit('leave', roomId);
  };
}, [roomId]);
```
</details>

**Q2.** 검색 페이지에서 "타이핑을 멈추면 0.5초 뒤 검색"을 이펙트로 구현했다. 빠르게 타이핑한 뒤 결과가 가끔 이전 검색어의 것으로 표시된다. 디바운스가 있는데 왜 race가 남는지 설명하고 수정하라.

```jsx
useEffect(() => {
  const t = setTimeout(() => {
    fetch(`/api/search?q=${query}`).then(r => r.json()).then(setResults);
  }, 500);
  return () => clearTimeout(t);
}, [query]);
```

<details>
<summary>정답과 해설</summary>

디바운스는 **요청 발사 전** race(타이핑 중 과도한 요청)만 막는다. 발사된 뒤의 race는 그대로다: "ab"로 500ms 멈춤 → 요청 A 발사 → 이어서 "abc"로 500ms 멈춤 → 요청 B 발사. A와 B가 네트워크에 동시에 떠 있고, A가 늦게 도착하면 `setResults(A)`가 B를 덮는다. 클린업의 `clearTimeout`은 타이머만 취소하지, 이미 발사된 fetch에는 아무 효과가 없다.

수정: 클린업이 진행 중인 요청까지 중단하게 한다.

```jsx
useEffect(() => {
  const controller = new AbortController();
  const t = setTimeout(() => {
    fetch(`/api/search?q=${query}`, { signal: controller.signal })
      .then(r => r.json())
      .then(setResults)
      .catch(err => { if (err.name !== 'AbortError') throw err; });
  }, 500);
  return () => { clearTimeout(t); controller.abort(); };
}, [query]);
```

query가 바뀌면 타이머 단계든 요청 단계든 이전 동기화 전체가 중단된다. 이 "요청 수명을 컴포넌트 상태에 묶는" 관리가 5-8의 라이브러리가 대신해 주는 일이다.
</details>

**Q3.** 다음 코드에서 이펙트를 전부 제거하고 같은 동작을 만들 수 있는가? 각 이펙트가 세 안티패턴 유형 중 무엇인지 짚고 재설계하라.

```jsx
function Cart({ items }) {
  const [total, setTotal] = useState(0);
  const [discounted, setDiscounted] = useState(0);
  useEffect(() => {
    setTotal(items.reduce((s, i) => s + i.price, 0));
  }, [items]);
  useEffect(() => {
    setDiscounted(total > 50000 ? total * 0.9 : total);
  }, [total]);
  useEffect(() => {
    if (items.length === 0) showToast('장바구니가 비었습니다');
  }, [items]);
  // "비우기" 버튼: onClick={() => setItems([])}  (부모에서 내려온 setter)
}
```

<details>
<summary>정답과 해설</summary>

셋 다 제거 가능하다. ① `total`: 파생값이다(유형 ①). `items`에서 렌더 중 계산 — `const total = items.reduce(...)`. 현재 코드는 items 변경 시 렌더가 3번(items 반영 → total 이펙트 갱신 → discounted 이펙트 갱신) 도는 상태 연쇄(유형 ③)이기도 하다. ② `discounted`: 역시 파생값 — `const discounted = total > 50000 ? total * 0.9 : total`. ③ 토스트: "비었음"이라는 상태가 아니라 **비우는 행동**의 결과다(유형 ②). 이펙트로 두면 처음부터 빈 장바구니로 마운트될 때, 또는 다른 이유의 리렌더에서 조건이 맞을 때도 발사될 수 있다. 비우기 버튼의 핸들러로 옮긴다: `onClick={() => { setItems([]); showToast('장바구니가 비었습니다'); }}`.

재설계 후 이 컴포넌트에는 상태도 이펙트도 없다 — props에서 전부 계산된다. "이 코드는 외부 시스템과 동기화하는가?"에 셋 다 "아니오"였던 것이다.
</details>

## 참고 자료

- [react.dev — Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects) — 이펙트의 정의, 클린업 사이클, StrictMode 이중 실행, 페칭 race의 공식 서술. 이 문서의 1차 자료.
- [react.dev — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — 이펙트 제거 대상의 공식 카탈로그. 실무 관점 절의 근거.
- [react.dev — Removing Effect Dependencies](https://react.dev/learn/removing-effect-dependencies) / [useEffectEvent](https://react.dev/reference/react/useEffectEvent) — 의존성을 줄이는 재설계와 비반응형 읽기의 공식 해법.
- [react.dev — useLayoutEffect](https://react.dev/reference/react/useLayoutEffect) — 동기 실행의 비용과 사용 조건.
- [overreacted.io — A Complete Guide to useEffect](https://overreacted.io/a-complete-guide-to-useeffect/) — 클로저·스냅샷 관점의 이펙트 해부. 훅 설계자(Dan Abramov)의 글.
