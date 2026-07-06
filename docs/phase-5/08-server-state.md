# 5-8. 서버 상태

> 한 줄 요약: 이 문서를 읽고 나면 서버 데이터를 "상태"가 아니라 "캐시"로 재분류하고, TanStack Query의 stale-while-revalidate 모델(fresh/stale/inactive, 쿼리 키, 무효화 전략)로 페칭 코드를 설계·진단할 수 있다.

이 문서는 React 19, TanStack Query 5 기준이다.

## 학습 목표

- 서버 상태의 캐시 고유 문제(수명, 중복, 동기화, 무효화)를 열거하고, useState + useEffect 수동 구현이 이를 컴포넌트마다 재발명하는 구조임을 설명할 수 있다.
- stale-while-revalidate 모델과 쿼리의 상태 기계(fresh/stale/inactive), staleTime/gcTime의 정확한 의미를 실측 기반으로 설명할 수 있다.
- 쿼리 키를 "캐시 신원 + 의존성 배열"로 설계하고, 계층적 키로 부분 무효화를 구성할 수 있다.
- 뮤테이션 후 갱신 전략(invalidate / setQueryData / 낙관적 업데이트)의 트레이드오프를 비교해 선택할 수 있다.

## 배경: 왜 이것이 존재하는가

[5-6](./06-state-architecture.md)에서 서버 상태를 별도 분류로 떼어 냈다: 원본이 서버에 있으므로 클라이언트가 가진 것은 상태가 아니라 **캐시**다. 이 재분류가 왜 결정적인지는 캐시가 끌고 오는 문제 목록을 보면 된다 — 언제까지 신선한가(수명), 두 컴포넌트가 같은 데이터를 원하면(중복 요청), 다른 화면에서 수정하면(동기화), 내가 수정했으면(무효화). 전부 백엔드에서 Redis를 DB 앞에 둘 때 마주치는 바로 그 문제들이고, "캐시 무효화는 어려운 문제"라는 격언도 그대로 수입된다.

[5-4](./04-effects.md)의 이펙트 페칭이 실무에서 무너지는 이유가 이것이다. race condition 처리까지 갖춘 "올바른" 이펙트 페칭도 위 목록에는 전부 무답이다: 화면을 벗어났다 돌아오면 무조건 재요청(캐시 없음), 같은 데이터를 쓰는 컴포넌트 수만큼 중복 요청, 장바구니에 담아도 목록의 재고 표시는 그대로(동기화 없음). 컴포넌트마다 이걸 짜는 것은 [5-1](./01-react-mental-model.md)에서 없앤 M×N 문제의 네트워크판 재림이다.

같은 문제를 HTTP는 이미 풀어 봤다 — [2-2](../phase-2/02-http-caching.md)의 캐싱 모델(max-age, 재검증, stale-while-revalidate 확장)이 그것이다. 그런데 HTTP 캐시는 브라우저 소유라 앱이 세밀하게 조작하기 어렵고(무효화 API가 없다), 응답 단위라 "이 데이터를 쓰는 화면들"이라는 앱의 관점을 모른다. TanStack Query는 **같은 문제를 애플리케이션 계층에서 다시 푼 것**이다 — 앱이 수명을 선언하고, 앱이 무효화를 트리거하는, 앱 관점의 read-through 캐시.

## 핵심 개념

### 쿼리 — 캐시를 읽는 선언

```jsx
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

const queryClient = new QueryClient();
// 앱 루트: <QueryClientProvider client={queryClient}><App /></QueryClientProvider>

function ProductList() {
  const { data, status, error, isFetching } = useQuery({
    queryKey: ['products'],                                   // 캐시 신원
    queryFn: () => fetch('/api/products').then(r => r.json()), // 원본 접근 방법
  });

  if (status === 'pending') return <Spinner />;   // 캐시에 아무것도 없음
  if (status === 'error') return <ErrorBox error={error} />;
  return <ul>{/* data 렌더 — isFetching은 백그라운드 재검증 표시용 */}</ul>;
}
```

관점 전환이 API 모양에 들어 있다: 컴포넌트는 "요청을 보낸다"가 아니라 **"이 키의 데이터가 필요하다"를 선언**한다. 요청을 보낼지, 캐시를 줄지, 캐시를 주고 뒤에서 갱신할지는 캐시 계층의 판단이다. 같은 키를 선언한 컴포넌트가 열 개라도 요청은 하나로 합쳐지고(중복 제거), 도착한 데이터는 열 곳에 같이 반영된다. race condition도 사라진다 — 응답은 컴포넌트가 아니라 **키의 캐시 엔트리**에 귀속되므로, [5-4](./04-effects.md)에서 손으로 짰던 ignore/abort가 계층의 기본 동작이 된다.

`status`(pending/error/success)는 "캐시에 뭐가 있는가"이고 `isFetching`은 "지금 요청이 날아가고 있는가"다 — 캐시가 있으면서 재검증 중인 상태(success + isFetching)가 이 모델의 핵심 상태이므로 둘은 독립 축이다.

### stale-while-revalidate — 쿼리의 상태 기계

캐시 엔트리의 수명은 상태 기계로 굴러간다:

```
          staleTime 경과              구독자 0                gcTime 경과
  fresh ───────────────→ stale ───────────────→ inactive ───────────────→ 삭제
 (신선 — 재검증 안 함)   (의심 — 트리거 시 재검증)  (화면에 없음 — 데이터는 보존)
```

- **fresh**: 이 데이터는 믿는다. 새 구독자가 마운트돼도 요청하지 않는다.
- **stale**: 의심한다. 단, 즉시 재요청하는 게 아니라 **트리거**(새 구독자 마운트, 창 포커스 복귀, 네트워크 재연결)가 올 때 재검증한다. 그동안에도 캐시는 계속 보여준다 — **stale한 것을 보여주면서(stale-while) 뒤에서 재검증(revalidate)** 이 이름의 뜻이다.
- **inactive**: 아무 컴포넌트도 구독하지 않는다. 데이터는 메모리에 남아, 재방문 시 즉시 표시용으로 쓰인다. `gcTime`(기본 5분)이 지나면 버려진다.

실측으로 고정하면 (기본값 `staleTime: 0` — 도착 즉시 stale):

```
최초 마운트:        요청 1회 → success:data-v1
언마운트 → 재마운트: 캐시(data-v1) 즉시 표시 + 백그라운드 재검증 → data-v2 (요청 2회)
```

```
staleTime: 60_000 지정 시:
언마운트 → 재마운트: 요청 없음 (총 1회), data-v1 그대로 — fresh는 재검증하지 않는다
```

즉 **staleTime은 "이 데이터의 신선도를 얼마나 믿을 것인가"라는 도메인 판단의 자리**다. 환율·재고처럼 초 단위로 낡는 것은 0~수 초, 상품 카탈로그는 수 분, 국가 코드 목록은 Infinity. 기본값 0은 "항상 의심하되 옛것을 보여주며 갱신"이라는 가장 안전한 쪽이고, 요청이 많다고 느껴지면 끄는(refetchOnWindowFocus: false) 게 아니라 staleTime을 도메인에 맞게 올리는 것이 모델에 맞는 조치다. gcTime은 전혀 다른 축 — "안 보는 데이터를 메모리에 얼마나 보관할 것인가"(재방문 체감 vs 메모리) — 이므로 둘을 혼동하지 않는다.

[2-2](../phase-2/02-http-caching.md)와의 대응을 정리하면: staleTime ≈ max-age(신선 수명), 재검증 트리거 ≈ 조건부 요청의 재검증, gcTime ≈ 캐시 저장소의 보존 기간. 같은 문제 구조를 앱 계층에서 앱의 어휘(마운트, 포커스)로 다시 편성한 것이다.

### 쿼리 키 — 캐시 신원이자 의존성 배열

쿼리 키는 두 역할을 겸한다. 첫째, **캐시 신원**: 키가 같으면 같은 데이터(중복 제거·공유의 단위), 다르면 다른 엔트리. 둘째, **의존성 배열**: 키에 든 값이 바뀌면 다른 키가 되므로, 새 엔트리에 대한 조회가 자동으로 일어난다.

```jsx
function ProductList({ category, page }) {
  const { data } = useQuery({
    queryKey: ['products', 'list', { category, page }],  // 응답을 결정하는 입력 전부
    queryFn: () => fetchProducts({ category, page }),
  });
  // category가 바뀌면: 새 키 → 캐시 확인 → 없으면 요청, 있으면 즉시 + 재검증
  // 이전 키의 데이터는 inactive로 보존 — "이전 페이지로 돌아가기"가 즉시다
}
```

설계 규칙은 캐시 일반의 규칙이다: **queryFn이 읽는 모든 입력이 키에 들어가야 한다**(응답을 결정하는 값이 키에 없으면 다른 입력의 응답이 같은 키에 덮여 — 잘못된 캐시 적중 — 이 생긴다. [5-4](./04-effects.md)의 의존성 배열 누락과 같은 종류의 거짓말이다). URL 파라미터([5-7](./07-routing-and-code-splitting.md)의 useParams)가 키로 흘러 들어가는 구성이 자연스러운 이유이기도 하다 — URL이 서버 상태 조회의 입력을 소유하고, 키가 그것을 구독한다.

키를 **계층적으로** 설계하면 무효화가 집합 연산이 된다. 키 매칭은 전방 일치이므로:

```js
['products']                       // 상품 도메인 전부
['products', 'list', { category }] // 목록들
['products', 'detail', id]         // 상세 하나
// invalidateQueries({ queryKey: ['products'] })        → 도메인 전체 무효화
// invalidateQueries({ queryKey: ['products', 'list'] }) → 목록들만
```

### 뮤테이션과 무효화 — 쓰기 이후의 세 전략

읽기가 쿼리라면 쓰기는 뮤테이션이고, 진짜 설계 문제는 **쓰기 성공 후 캐시를 어떻게 따라잡게 하는가**다.

```jsx
const queryClient = useQueryClient();
const { mutate } = useMutation({
  mutationFn: (newProduct) => api.createProduct(newProduct),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['products'] }); // 전략 ①
  },
});
```

**① invalidate — 재검증 트리거.** 해당 키들을 stale로 표시하고, 화면에 있는(active) 쿼리는 즉시 재요청한다(실측: invalidate 직후 요청 발생, data-v2로 갱신). 서버를 다시 읽으므로 항상 정확하다 — 서버가 계산하는 필드(정렬 위치, 집계, 권한 필터)까지 맞는다. 비용은 왕복 하나. **기본값은 이것이다.**

**② setQueryData — 캐시 직접 쓰기.** 응답으로 받은 데이터를 캐시에 직접 반영한다(`queryClient.setQueryData(['products', 'detail', id], updated)`). 왕복이 없지만, "서버 상태의 클라이언트 재현"이라는 원죄가 있다 — 목록 정렬·페이지네이션·집계에 이 변경이 어떤 영향인지를 클라이언트가 재계산해야 하고, 그 로직은 서버와 어긋나기 시작한다. 응답이 갱신 결과 전체를 주는 단건 갱신 정도에 한정하는 것이 안전하다.

**③ 낙관적 업데이트 — 성공을 가정한 선반영.** 요청 전에 캐시를 미리 바꾸고, 실패하면 되돌린다(onMutate에서 이전 값 스냅샷 → onError에서 복원 → onSettled에서 invalidate로 정산). 체감 지연 0을 사는 대신, 되돌림 UX와 동시 뮤테이션의 스냅샷 관리라는 복잡도를 지불한다. 실패가 드물고 즉각 반응이 UX의 핵심인 곳(토글, 좋아요, 체크박스)에 한정한다.

| 전략 | 정확성 | 지연 | 복잡도 | 적합 |
|---|---|---|---|---|
| invalidate | 서버 보장 | 왕복 1 | 최소 | 기본값. 목록·집계에 영향 있는 쓰기 |
| setQueryData | 클라이언트 재현 | 0 | 중간 | 응답이 완전한 단건 갱신 |
| 낙관적 | 가정 후 정산 | 0 (체감) | 높음 | 실패 드묾 + 즉각성 필수인 토글류 |

### 클라이언트 상태와의 분리 — 이중 원본 금지

이 모델이 성립하려면 화면이 읽는 곳이 **캐시 그 자체**여야 한다. 흔한 위반이 "Query로 받아서 useState/Zustand에 복사"다:

```jsx
// ❌ 이중 원본: 캐시가 재검증으로 갱신돼도 복사본은 낡은 채 남는다
const { data } = useQuery({ queryKey: ['user'], queryFn: fetchUser });
const [user, setUser] = useState(null);
useEffect(() => { if (data) setUser(data); }, [data]); // 5-4의 "이펙트 불필요" 유형이기도 하다

// ✅ 캐시가 원본: 그대로 읽고, 가공은 렌더 중 계산이나 select로
const { data: user } = useQuery({
  queryKey: ['user'],
  queryFn: fetchUser,
  select: (u) => ({ ...u, displayName: `${u.lastName} ${u.firstName}` }), // 파생은 선언으로
});
```

[5-6](./06-state-architecture.md)의 소유권 원칙 그대로다: 서버가 원본인 데이터의 사본을 클라이언트 상태에 만들면, 그 순간부터 동기화 책임이 생기고 그 책임은 대개 이행되지 않는다. 전역 스토어에서 서버 데이터를 전부 들어내고 나면 남는 클라이언트 상태가 얼마 안 된다는 것 — "전역 상태의 대부분은 서버 캐시였다" — 이 이 분리의 실무적 결론이다.

## 실무 관점

### "요청이 너무 많이 나가요" — 모델로 진단하기

TanStack Query 도입 초기의 흔한 놀람: 탭을 오갈 때마다, 창을 클릭할 때마다 요청이 나간다. 이것은 버그가 아니라 기본값(staleTime 0 + 포커스 재검증)의 의도된 동작 — "화면에 보이는 데이터는 항상 최신을 지향한다" — 이다. 대응 순서: ① 이 데이터의 실제 신선 수명을 도메인에 물어 staleTime을 선언한다(그러면 재검증 트리거가 와도 fresh라 무시된다). ② 그래도 과하면 트리거를 조정한다(refetchOnWindowFocus 등). 트리거부터 끄는 것은 "낡은 화면"이라는 원래 문제로 돌아가는 것이므로 순서가 중요하다. 관찰 도구는 TanStack Query Devtools — 쿼리별 fresh/stale/inactive 상태와 재요청 사유가 실시간으로 보인다.

### 로딩·에러 UI의 재설계

SWR 모델에서 "로딩 중"은 두 가지로 갈라진다: 캐시가 아예 없는 최초(pending — 스피너/스켈레톤이 맞다)와, 캐시를 보여주며 재검증 중(success + isFetching — 화면을 가리면 안 되고, 미묘한 인디케이터나 아무것도 안 하는 게 맞다). 이 구분 없이 `isFetching`으로 스피너를 띄우면 포커스 복귀마다 화면이 깜빡이는 앱이 된다. 에러도 같다 — 재검증 실패는 캐시(data)가 여전히 있으므로, "데이터 대신 에러 화면"이 아니라 "옛 데이터 + 갱신 실패 알림"이 맞는 상태 조합이다. `error && data` 조합이 존재한다는 것이 이 모델의 UI 함의다.

### 어디까지 이 계층에 맡길 것인가

- **페이지네이션·무한 스크롤**: 키에 page를 넣는 것까지가 이 문서의 모델이고, 이전 페이지 유지(placeholderData)·무한 목록(useInfiniteQuery)은 같은 모델의 편의 확장이다 — 필요할 때 공식 문서로 충분하다.
- **Suspense 통합**: `useSuspenseQuery`는 pending을 분기 대신 [5-7](./07-routing-and-code-splitting.md)의 Suspense 경계로 올린다. 라우트 loader에서 `queryClient.ensureQueryData`로 프리페치하고 컴포넌트는 useSuspenseQuery로 읽는 조합이 render-then-fetch 워터폴을 fetch-then-render로 바꾸는 현재의 정석 구성이다.
- **웹소켓·실시간**: 푸시로 오는 데이터는 재검증 모델과 다른 문제다. 얕은 통합(푸시 수신 → invalidate)까지는 이 계층으로 되지만, 고빈도 스트림은 [5-6](./06-state-architecture.md)의 외부 스토어 쪽이 맞다.
- **오프라인·영속 캐시**: gcTime은 메모리 캐시다. 새로고침을 견디는 캐시(persistQueryClient)는 별도 계층이고, 일관성 문제(낡은 영속 캐시)를 함께 데려온다.

## 더 깊이

### 구독 메커니즘 — 이 라이브러리도 외부 스토어다

TanStack Query의 캐시(QueryCache)는 React 밖의 객체이고, `useQuery`는 [5-6](./06-state-architecture.md)의 `useSyncExternalStore`로 해당 키의 엔트리를 구독하는 훅이다 — Zustand와 같은 접속 방식이다. 전파 최적화도 같은 어법으로 돼 있다: 훅이 반환하는 객체의 프로퍼티 접근을 추적해(tracked properties), 컴포넌트가 실제로 읽은 필드(`data`만 읽었는지, `isFetching`도 읽었는지)가 바뀔 때만 리렌더한다. `select` 옵션은 selector 그 자체 — 결과가 (구조적 공유 덕에) 같으면 리렌더가 없다. 5-6에서 세운 외부 스토어 모델이 그대로 적용되는 것을 확인할 수 있는 구현이다.

### 구조적 공유 — 참조 안정성의 출처

재검증 응답이 이전 데이터와 내용이 같으면, TanStack Query는 **이전 객체 참조를 그대로 유지**한다(structural sharing — 새 JSON을 이전 트리와 재귀 비교해, 변한 가지만 새 객체로 만들고 나머지는 이전 참조를 재사용). 이 덕에 재검증이 돌아도 내용이 안 변했으면 `data` 참조가 안정적이라 리렌더·memo·의존성 배열([5-5](./05-performance-model.md))이 헛돌지 않는다. React의 불변성 전제([5-3](./03-state-and-batching.md) — 참조 비교가 변경 감지의 전부)와 캐시 계층이 맞물리는 지점이며, 거대한 응답에서는 이 재귀 비교 자체가 비용이 될 수 있어 끌 수도 있다(structuralSharing: false — 대신 위 이점을 잃는다).

### HTTP 캐시와의 관계 — 겹침이 아니라 적층

queryFn의 fetch는 여전히 브라우저 HTTP 캐시([2-2](../phase-2/02-http-caching.md))를 통과한다. 즉 두 캐시가 적층된다: Query 캐시(앱 관점 — 키 단위, 무효화 API 있음)가 위, HTTP 캐시(전송 관점 — URL 단위, 서버가 정책 소유)가 아래. 재검증 요청이 HTTP 계층에서 304로 끝나면 왕복은 있되 본문 전송이 없다 — 두 계층이 협력하는 이상적 구성이다. 반대로 서버가 과한 max-age를 주면 invalidate가 재요청을 보내도 HTTP 캐시가 낡은 응답을 돌려주는 충돌이 난다 — "invalidate했는데 데이터가 안 바뀐다"의 성가신 원인 중 하나로, API 응답에는 `no-cache`(재검증 강제)류의 보수적 정책이 권장되는 이유다.

## 정리

- 서버 데이터는 상태가 아니라 캐시다 — 수명·중복·동기화·무효화 문제가 따라오며, 이펙트 페칭은 이를 컴포넌트마다 재발명한다. 컴포넌트는 요청 대신 "이 키가 필요하다"를 선언하고 캐시 계층이 판단한다.
- 쿼리는 fresh(믿음 — 재검증 안 함) → stale(트리거 시 재검증, 그동안 캐시 표시) → inactive(gcTime까지 보존)의 상태 기계다. staleTime은 도메인의 신선도 판단이고, gcTime은 메모리 보존 기간이다.
- 쿼리 키는 캐시 신원 + 의존성 배열이다: queryFn이 읽는 입력 전부가 키에 들어가야 하고, 계층적 키는 전방 일치로 부분 무효화를 가능하게 한다.
- 쓰기 후 전략은 invalidate(기본값 — 서버 재확인) / setQueryData(왕복 0, 클라이언트 재현 위험) / 낙관적(체감 0, 되돌림 복잡도)의 트레이드오프다.
- 캐시가 원본이다 — useState/스토어로의 복사는 이중 원본이고, 파생은 select나 렌더 중 계산으로. 전역 상태의 대부분은 사실 서버 캐시였다.

## 확인 문제

**Q1.** 검색 페이지에서 `useQuery({ queryKey: ['search'], queryFn: () => api.search(keyword, filters) })`로 구현했더니, 키워드를 바꿔도 가끔 이전 검색 결과가 나오고, 뒤로 갔다 오면 엉뚱한 결과가 즉시 뜬다. 원인을 캐시 모델로 설명하고 수정하라.

<details>
<summary>정답과 해설</summary>

원인: queryFn이 읽는 입력(keyword, filters)이 키에 없다. 캐시 관점에서 모든 검색이 `['search']`라는 **하나의 엔트리**이므로 — ① keyword가 바뀌어도 같은 키라 "캐시 있음 + stale"로 취급되어 이전 결과를 먼저 보여주고(SWR), 재검증 응답이 오기 전까지 낡은 화면이 남는다. ② 뒤로 갔다 오면 마지막으로 그 키에 저장된 검색(어떤 입력이었는지 모를)이 즉시 표시된다. 잘못된 캐시 적중이다.

수정: `queryKey: ['search', { keyword, filters }]` — 입력이 신원이 되므로 키워드 변경은 새 엔트리 조회가 되고, 각 검색 결과가 자기 키에 격리된다. 규칙: 이펙트의 의존성 배열과 같다 — queryFn이 읽는 반응형 입력은 전부 키에 넣는다. (filters가 객체라도 키는 구조적으로 해시되므로 참조 안정성은 필요 없다.)
</details>

**Q2.** 상품 상세에서 "재고 알림 신청" 토글과 "리뷰 작성" 두 뮤테이션이 있다. 토글은 즉각 반응해야 하고 실패가 드물다. 리뷰는 작성 후 목록의 평점 평균·리뷰 수·정렬(최신순)이 함께 바뀌어야 한다. 각각에 쓰기 후 전략을 선택하고 근거를 대라.

<details>
<summary>정답과 해설</summary>

토글 — 낙관적 업데이트: 판단 기준 두 개(실패 드묾, 즉각성이 UX의 핵심)를 정확히 충족하는 유형이다. onMutate에서 `['products', 'detail', id]` 캐시의 이전 값을 스냅샷하고 토글 상태를 선반영, onError에서 복원 + 실패 알림, onSettled에서 invalidate로 서버와 정산한다.

리뷰 — invalidate: 이 쓰기는 서버가 계산하는 파생값들(평균, 카운트, 정렬 위치)에 영향을 준다. setQueryData로 따라가려면 평균 재계산·목록 삽입 위치 결정을 클라이언트가 재현해야 하고, 그 로직은 서버와 어긋날 운명이다(페이지네이션까지 끼면 더). `onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products', 'detail', id] })` + 리뷰 목록 키 무효화 — 왕복 하나의 비용으로 서버 보장 정확성을 산다. 리뷰 작성은 즉각성이 왕복 지연보다 중요하지 않은(제출 완료 피드백이 있는) 상호작용이라는 점도 invalidate 쪽 근거다.
</details>

**Q3.** 팀 코드에서 다음 패턴을 발견했다: 여러 컴포넌트가 쓰는 사용자 정보를 위해, 로그인 직후 `fetchUser()` 응답을 Zustand 스토어에 넣고 모든 화면이 스토어에서 읽는다. 프로필 수정 화면만 별도로 `useQuery(['user'])`를 쓰며, 수정 후 invalidate한다. 이 구조에서 생길 버그를 예측하고 재설계하라.

<details>
<summary>정답과 해설</summary>

이중 원본 구조다: 같은 서버 데이터(user)의 사본이 두 곳(Zustand, Query 캐시)에 있고 동기화 통로가 없다. 예측되는 버그: 프로필 수정 → invalidate → Query 캐시는 새 데이터로 재검증되지만 **Zustand의 사본은 낡은 채** — 헤더의 이름·아바타 등 스토어를 읽는 모든 화면이 옛 정보를 계속 표시한다(새로고침하면 로그인 플로우가 다시 채워 "가끔 고쳐지는" 미스터리 버그가 된다). 역방향도 있다: 스토어만 갱신하는 코드가 생기면 수정 화면이 낡는다.

재설계: user는 서버가 원본 — 서버 캐시 한 곳에만 둔다. 모든 화면이 `useQuery({ queryKey: ['user'], queryFn: fetchUser, staleTime: 도메인 판단 })`로 읽고(중복 요청은 캐시가 합친다), 수정은 뮤테이션 + invalidate로. Zustand에는 클라이언트가 원본인 것(예: "프로필 편집 중인 임시 입력" 같은 UI 상태)만 남긴다. 로그인 직후 선로딩이 필요하면 스토어 복사 대신 `queryClient.prefetchQuery`로 같은 캐시를 미리 채운다.
</details>

## 참고 자료

- [TanStack Query 공식 문서 — Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) — staleTime 0·재검증 트리거 등 기본값의 의도. "요청이 많다" 오해의 공식 해명.
- [TanStack Query — Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys) / [Query Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation) — 키 설계와 전방 일치 무효화의 1차 자료.
- [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — onMutate/onError/onSettled 정석 패턴.
- [RFC 5861 — HTTP stale-while-revalidate](https://datatracker.ietf.org/doc/html/rfc5861) — 이 모델의 HTTP 원형. 2-2와 이 문서를 잇는 다리.
- [Practical React Query (TkDodo)](https://tkdodo.eu/blog/practical-react-query) — 라이브러리 메인테이너의 실무 패턴 연재. staleTime 판단, 이중 원본 금지 등 이 문서 실무 관점의 검증 참고.
