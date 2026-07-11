# 8-6. Next.js와 RSC

> 한 줄 요약: Next.js App Router와 React Server Components의 서버/클라이언트 경계를 실행 모델·직렬화·캐시 계층 관점에서 나누고, 경계가 잘못 잡혔을 때의 비용을 진단할 수 있다.

## 학습 목표

- Next.js App Router의 route segment가 렌더링, 데이터 로딩, 스트리밍, 오류 경계로 작동하는 구조를 설명할 수 있다.
- React Server Components가 HTML 문자열이 아니라 React 트리를 서버와 클라이언트 실행 환경으로 분할하는 모델임을 설명할 수 있다.
- `use client`와 `use server`가 각각 모듈 그래프, 번들, 네트워크 호출, 보안 경계를 어떻게 바꾸는지 판단할 수 있다.
- 서버 컴포넌트와 클라이언트 컴포넌트의 경계를 상태, 이벤트, 브라우저 API, 비밀 값, 캐시 가능성 기준으로 나눌 수 있다.
- Next.js의 데이터 페칭, 캐싱, 재검증 전략을 "어느 계층의 캐시인가"로 구분하고, 변경 후 검증 방법을 제시할 수 있다.

## 배경: 왜 이것이 존재하는가

[렌더링 전략](./05-rendering-strategies.md)에서 CSR, SSR, SSG, ISR은 HTML을 언제 어디서 만들지에 대한 선택이라고 정리했다. 그러나 대형 React 애플리케이션에서 문제는 HTML 생성 시점만이 아니다. 화면 일부는 데이터 소스 가까이에서 실행되어야 하고, 일부는 사용자의 입력과 브라우저 API를 다뤄야 한다. 기존 SSR은 서버에서 HTML을 만들 수는 있었지만, 결국 브라우저가 같은 컴포넌트 트리를 다시 하이드레이션해야 했다. 그 결과 서버에서 계산한 UI와 클라이언트 상호작용 코드가 같은 번들 경계 안에 묶이기 쉬웠다.

React Server Components(RSC)는 이 문제를 "React 트리를 서버와 클라이언트로 나눈다"는 방식으로 다룬다. 서버 컴포넌트는 서버에서 실행되어 데이터 접근, 비밀 값 사용, 무거운 의존성 처리를 맡고, 클라이언트 컴포넌트는 상태, 이벤트, 브라우저 API를 맡는다. RSC 실행 모델과 직렬화·보안 경계의 framework 중립 모델은 [5b-7 React Server Components](../phase-5b/07-react-server-components.md)에서 세웠다. Next.js App Router는 이 실행 모델을 파일 시스템 라우팅, 중첩 레이아웃, 스트리밍, 캐시, 서버 함수와 결합한 프레임워크이며, 이 문서는 그 통합 계층을 다룬다.

이 문서는 2026년 7월 공식 문서 기준으로 React 문서는 React 19.2, Next.js App Router 문서는 최신 버전 16.2.10을 표시하는 상태를 기준으로 한다. 특히 Next.js의 캐싱 기본값과 API 이름은 버전별로 바뀌어 왔다. 따라서 이 문서는 "어떤 옵션을 외울 것인가"보다 "어느 계층에서 무엇이 캐시되고, 어떤 경계가 번들·네트워크·보안을 바꾸는가"를 기준으로 설명한다.

## 핵심 개념

### App Router는 파일 시스템을 실행 경계로 사용한다

Next.js App Router에서 `app/` 아래의 폴더는 route segment가 된다. segment마다 `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts` 같은 파일이 의미를 갖는다. 이 파일들은 단순한 컨벤션이 아니라 렌더링 경계를 만든다.

```tsx
// app/products/layout.tsx
export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1>Products</h1>
      {children}
    </section>
  );
}
```

```tsx
// app/products/[id]/page.tsx
import { notFound } from "next/navigation";
import { ProductSummary } from "@/app/products/ProductSummary";

async function getProduct(id: string) {
  const response = await fetch(`https://api.example.com/products/${id}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to load product");
  }

  return response.json() as Promise<{ id: string; name: string; price: number }>;
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);

  if (!product) {
    notFound();
  }

  return <ProductSummary product={product} />;
}
```

```tsx
// app/products/[id]/loading.tsx
export default function Loading() {
  return <p>상품 정보를 불러오는 중이다.</p>;
}
```

```tsx
// app/products/[id]/error.tsx
"use client";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div role="alert">
      <p>{error.message}</p>
      <button type="button" onClick={reset}>
        다시 시도
      </button>
    </div>
  );
}
```

`layout.tsx`는 하위 segment가 바뀌어도 유지되는 UI 경계다. `page.tsx`는 해당 route의 고유 화면이다. `loading.tsx`는 내부적으로 Suspense fallback처럼 동작해 느린 데이터나 느린 segment를 기다리는 동안 보여 줄 UI를 제공한다. `error.tsx`는 사용자 상호작용으로 재시도해야 하므로 클라이언트 컴포넌트가 된다.

이 구조의 설계 배경은 화면을 URL 경로 단위로만 나누지 않고, 데이터·오류·로딩·스트리밍 경계까지 같은 트리 구조에서 표현하려는 데 있다. 서버 프레임워크의 라우터가 컨트롤러 단위로 요청을 처리했다면, App Router는 React 트리의 일부를 route segment와 연결한다.

경계 조건은 segment가 너무 잘게 나뉘거나 너무 크게 뭉칠 때 드러난다. 너무 잘게 나누면 로딩·오류 UI가 중복되고 캐시 정책을 추적하기 어려워진다. 너무 크게 묶으면 작은 데이터 지연이 전체 route의 표시를 막고, 사용자가 이미 볼 수 있는 영역까지 기다리게 된다.

### 서버 컴포넌트는 HTML 문자열이 아니다

서버 컴포넌트(Server Component)는 서버에서 실행되는 React 컴포넌트다. 하지만 결과가 단순 HTML 문자열로 끝나지 않는다. Next.js는 서버에서 React Server Component Payload를 만들고, 이 payload와 클라이언트 컴포넌트의 JavaScript 참조를 이용해 초기 HTML을 만들며, 브라우저에서는 payload를 사용해 서버/클라이언트 트리를 맞춘 뒤 클라이언트 컴포넌트를 하이드레이션한다.

```tsx
// app/products/ProductSummary.tsx
import AddToCartButton from "./AddToCartButton";

export function ProductSummary({
  product,
}: {
  product: { id: string; name: string; price: number };
}) {
  return (
    <article>
      <h2>{product.name}</h2>
      <p>{product.price.toLocaleString()}원</p>
      <AddToCartButton productId={product.id} />
    </article>
  );
}
```

```tsx
// app/products/AddToCartButton.tsx
"use client";

import { useState } from "react";

export default function AddToCartButton({ productId }: { productId: string }) {
  const [pending, setPending] = useState(false);

  async function addToCart() {
    setPending(true);

    try {
      await fetch("/api/cart", {
        method: "POST",
        body: JSON.stringify({ productId }),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" disabled={pending} onClick={addToCart}>
      {pending ? "담는 중" : "장바구니 담기"}
    </button>
  );
}
```

`ProductSummary`는 서버 컴포넌트다. 이 컴포넌트는 상태나 이벤트 핸들러를 갖지 않으므로 서버에서 실행되어도 충분하다. `AddToCartButton`은 `useState`와 `onClick`을 사용하므로 클라이언트 컴포넌트다. 서버 컴포넌트는 클라이언트 컴포넌트가 들어갈 위치와 props를 payload에 남기고, 클라이언트는 해당 위치에서 필요한 JavaScript를 로드해 상호작용을 붙인다.

이 모델이 기존 SSR과 다른 지점은 "어떤 컴포넌트가 클라이언트 번들에 들어가는가"다. SSR만 사용하면 서버에서 HTML을 만들더라도 클라이언트에서 하이드레이션할 컴포넌트 코드가 대부분 필요하다. RSC에서는 서버 컴포넌트 코드가 클라이언트 번들에 들어가지 않을 수 있다. 데이터 접근 코드, Markdown 파서, ORM, 서버 전용 SDK 같은 의존성을 브라우저로 보내지 않아도 된다.

경계 조건은 서버 컴포넌트가 브라우저 상호작용을 직접 다루려 할 때 드러난다. 서버 컴포넌트는 `useState`, `useEffect`, DOM 이벤트 핸들러, `window`, `localStorage` 같은 브라우저 API를 사용할 수 없다. 반대로 클라이언트 컴포넌트에 서버 전용 의존성을 import하면 번들 크기 증가, 빌드 오류, 비밀 값 노출 위험으로 이어진다.

### `use client`는 파일 하나가 아니라 모듈 그래프 경계다

`"use client"` 지시자는 해당 파일을 클라이언트 컴포넌트 진입점으로 만든다. 중요한 점은 그 파일 하나만 클라이언트에서 실행되는 것이 아니라, 그 파일이 import하는 모듈 그래프가 클라이언트 번들에 포함된다는 것이다.

```tsx
// app/dashboard/DashboardShell.tsx
"use client";

import HeavyChart from "./HeavyChart";
import StaticHeader from "./StaticHeader";

export default function DashboardShell() {
  return (
    <>
      <StaticHeader />
      <HeavyChart />
    </>
  );
}
```

위 구조에서 `StaticHeader`가 순수한 정적 마크업만 렌더하더라도 `DashboardShell`이 직접 import하면 클라이언트 모듈 그래프에 포함된다. 더 좁은 경계가 낫다.

```tsx
// app/dashboard/page.tsx
import ChartIsland from "./ChartIsland";
import StaticHeader from "./StaticHeader";

export default function DashboardPage() {
  return (
    <>
      <StaticHeader />
      <ChartIsland />
    </>
  );
}
```

```tsx
// app/dashboard/ChartIsland.tsx
"use client";

import HeavyChart from "./HeavyChart";

export default function ChartIsland() {
  return <HeavyChart />;
}
```

이 변경은 `StaticHeader`를 서버 컴포넌트로 남기고, 실제 상호작용이 필요한 차트만 클라이언트 번들로 보낸다. 브라우저 JavaScript 크기, 파싱 시간, hydration 작업량을 줄일 수 있다. 확인은 `next build`의 route별 bundle 정보, 번들 분석 도구, DevTools Performance의 script evaluation 시간으로 한다.

`use client`의 설계 배경은 컴포넌트 단위가 아니라 모듈 그래프 단위로 브라우저 실행 가능성을 판정해야 하기 때문이다. JavaScript bundler는 import graph를 따라 코드를 묶는다. 어떤 파일이 클라이언트에서 실행된다면 그 파일이 동기적으로 import하는 코드도 브라우저에서 실행 가능한 코드여야 한다.

경계 조건은 두 가지다. 첫째, `use client`를 상위 layout에 붙이면 하위 대부분이 클라이언트 번들로 빨려 들어간다. 둘째, 클라이언트 컴포넌트에서 서버 컴포넌트를 직접 import할 수는 없지만, 서버 컴포넌트를 `children` 같은 prop으로 전달해 조합할 수는 있다. import graph와 render tree를 구분해야 한다.

### 직렬화 경계는 API 경계처럼 다뤄야 한다

서버 컴포넌트에서 클라이언트 컴포넌트로 전달되는 props는 직렬화 가능해야 한다. 문자열, 숫자, boolean, 배열, 일반 객체처럼 payload로 표현 가능한 값은 경계를 넘길 수 있지만, 함수, 클래스 인스턴스, DOM 노드, 브라우저 객체, 서버 커넥션 같은 실행 환경에 묶인 값은 넘길 수 없다.

```tsx
// app/users/page.tsx
import UserList from "./UserList";

class UserViewModel {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}

  displayName() {
    return this.name.toUpperCase();
  }
}

export default async function UsersPage() {
  const users = [new UserViewModel("1", "Ada")];

  // 클라이언트 경계로 클래스 인스턴스를 넘기면 메서드와 프로토타입 의미가 보존되지 않는다.
  return <UserList users={users.map((user) => ({ id: user.id, name: user.name }))} />;
}
```

```tsx
// app/users/UserList.tsx
"use client";

export default function UserList({
  users,
}: {
  users: Array<{ id: string; name: string }>;
}) {
  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

이 경계는 마이크로서비스 사이의 JSON API 경계와 비슷하다. 내부 도메인 모델을 그대로 넘기기보다, 클라이언트가 렌더링과 상호작용에 필요한 DTO 형태로 잘라 넘긴다. 차이는 네트워크 API를 직접 작성하지 않아도 프레임워크가 payload를 만든다는 점이다. API가 자동으로 생기는 것처럼 보이지만, 직렬화 가능성·크기·민감 정보 노출은 여전히 설계자의 책임이다.

서버 함수(Server Function)와 서버 액션(Server Action)은 예외처럼 보일 수 있다. 클라이언트에서 서버 함수를 import해 호출할 수 있기 때문이다. 그러나 함수 자체가 클라이언트로 직렬화되는 것이 아니라, 서버에 있는 함수를 참조하고 네트워크 요청으로 호출하는 모델이다. 따라서 인증과 인가는 모든 서버 함수 내부에서 다시 검사해야 한다.

### 데이터 페칭은 서버 실행과 캐시 계층을 분리해서 봐야 한다

App Router의 서버 컴포넌트는 `async` 함수가 될 수 있고, 서버에서 `fetch`, ORM, 데이터베이스 클라이언트 같은 비동기 I/O를 직접 호출할 수 있다.

```tsx
// app/articles/page.tsx
async function getArticles() {
  const response = await fetch("https://api.example.com/articles");

  if (!response.ok) {
    throw new Error("Failed to load articles");
  }

  return response.json() as Promise<Array<{ id: string; title: string }>>;
}

export default async function ArticlesPage() {
  const articles = await getArticles();

  return (
    <ul>
      {articles.map((article) => (
        <li key={article.id}>{article.title}</li>
      ))}
    </ul>
  );
}
```

이 코드가 서버에서 실행된다는 사실과 결과가 캐시된다는 사실은 별개다. 서버에서 실행해도 매 요청마다 실행할 수 있고, 캐시 지시를 주면 재사용할 수 있다. Next.js 16 문서는 Cache Components를 `cacheComponents: true`로 활성화하고 `use cache`, `cacheLife`, `cacheTag` 같은 지시와 함수를 사용하는 모델을 설명한다. 이전 버전의 fetch cache 기본값과 다른 설명을 섞어 외우면 실무에서 사고가 난다.

캐시는 계층별로 구분해야 한다.

| 계층 | 무엇을 재사용하는가 | 대표 제어 수단 | 무너지는 조건 |
|------|--------------------|----------------|--------------|
| HTTP/CDN 캐시 | 응답 바이트 | `Cache-Control`, `Vary`, CDN purge | 개인화 응답, 잘못된 cache key |
| request memoization | 같은 렌더 요청 안의 중복 I/O 결과 | React `cache`, 동일 요청 내 함수 재사용 | 요청 경계가 바뀌면 재사용되지 않음 |
| 데이터 캐시 | 데이터 조회 결과 | `use cache`, `cacheLife`, `cacheTag`, `unstable_cache` | 무효화 누락, 사용자별 데이터 혼입 |
| route/page 캐시 | 렌더링 결과 또는 route segment 결과 | `revalidate`, `revalidatePath`, `revalidateTag` | 실시간성, 권한별 화면 차이 |
| 클라이언트 라우터 캐시 | 방문·prefetch한 RSC payload | Next.js router prefetch/navigation | 오래된 UI, mutation 후 refresh 누락 |

성능 개선을 위해 캐시를 켰다면 "어느 계층에서 hit가 났는가"를 확인해야 한다. DevTools Network에서 HTTP cache/CDN header를 보고, Next.js 로컬 production 모드에서 `next build` 후 `next start`로 재검증 동작을 확인하며, 데이터 조회 함수에 로깅을 넣어 실제 호출 횟수를 비교한다. 개발 서버는 캐시와 HMR을 편의적으로 다루므로 production 동작 검증을 대체하지 못한다.

### 재검증은 데이터 소유권 기준으로 설계한다

캐시가 있으면 무효화(invalidation)가 설계의 중심이 된다. App Router에서는 시간 기반 재검증, 경로 기반 재검증, 태그 기반 재검증을 조합할 수 있다. invalidation·regeneration·propagation을 구분하는 일반 상태 머신은 [5b-4 Incremental Static Generation](../phase-5b/04-incremental-static-generation.md)에서 다뤘다.

```tsx
// app/blog/[id]/page.tsx
export const revalidate = 3600;

export async function generateStaticParams() {
  const response = await fetch("https://api.example.com/posts");
  const posts = (await response.json()) as Array<{ id: string }>;

  return posts.map((post) => ({ id: post.id }));
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const response = await fetch(`https://api.example.com/posts/${id}`);
  const post = (await response.json()) as { title: string; body: string };

  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </article>
  );
}
```

```ts
// app/actions.ts
"use server";

import { revalidatePath, revalidateTag } from "next/cache";

export async function publishPost(formData: FormData) {
  const title = String(formData.get("title") ?? "");

  if (!title) {
    throw new Error("title is required");
  }

  // 여기에서 인증, 인가, 입력 검증, 저장을 수행한다.
  await savePost({ title });

  revalidatePath("/blog");
  revalidateTag("posts");
}

async function savePost(input: { title: string }) {
  console.log("saving", input.title);
}
```

`revalidatePath`는 route 단위로 사고할 때 적합하다. 글을 발행하면 `/blog` 목록과 `/blog/[id]` 상세를 다시 만들어야 한다는 요구처럼 URL이 소유권의 중심이면 경로 기반이 자연스럽다. `revalidateTag`는 같은 데이터가 여러 route에서 쓰일 때 적합하다. `posts` 목록이 홈, 블로그, 검색 화면에 동시에 쓰이면 데이터 소유권을 태그로 묶는 편이 낫다.

경계 조건은 과도한 태그와 과도한 경로 무효화다. 태그가 너무 세분화되면 어떤 mutation이 어떤 태그를 무효화해야 하는지 추적하기 어렵다. 반대로 모든 mutation에서 넓은 경로를 무효화하면 캐시 hit율이 떨어지고 서버 비용이 증가한다. 캐시 전략은 데이터 모델의 소유권과 변경 빈도에 맞춰야 한다.

### 서버 액션은 RPC가 아니라 mutation 경계다

`"use server"` 지시자는 async 함수를 서버에서 실행되는 함수로 표시한다. Server Action은 이 서버 함수를 form 제출이나 클라이언트 이벤트에서 mutation 용도로 호출하는 사용 패턴이다.

```tsx
// app/cart/actions.ts
"use server";

import { revalidatePath } from "next/cache";

export async function addItem(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");
  const quantity = Number(formData.get("quantity") ?? "1");

  if (!productId || !Number.isInteger(quantity) || quantity < 1) {
    throw new Error("invalid cart item");
  }

  const session = await getSession();

  if (!session) {
    throw new Error("unauthorized");
  }

  await saveCartItem(session.userId, productId, quantity);
  revalidatePath("/cart");
}

async function getSession() {
  return { userId: "user-1" };
}

async function saveCartItem(userId: string, productId: string, quantity: number) {
  console.log(userId, productId, quantity);
}
```

```tsx
// app/cart/AddItemForm.tsx
import { addItem } from "./actions";

export function AddItemForm({ productId }: { productId: string }) {
  return (
    <form action={addItem}>
      <input type="hidden" name="productId" value={productId} />
      <input type="number" name="quantity" min="1" defaultValue="1" />
      <button type="submit">담기</button>
    </form>
  );
}
```

form action으로 서버 액션을 호출하면 JavaScript가 아직 로드되지 않은 상태에서도 브라우저의 기본 form 제출 모델을 활용할 수 있다. 이것이 progressive enhancement 측면의 장점이다. 클라이언트 컴포넌트에서 버튼 클릭으로 서버 액션을 호출할 수도 있지만, 그 경우에는 클라이언트 JavaScript와 hydration이 더 강하게 전제가 된다.

보안 경계는 명확하다. 서버 액션은 애플리케이션 UI에서만 호출되는 비공개 함수가 아니다. 네트워크 요청으로 도달 가능한 서버 엔드포인트로 취급해야 한다. 모든 서버 액션에서 인증, 인가, 입력 검증, rate limit, CSRF에 준하는 threat model을 다시 검토해야 한다. [웹 보안](./04-web-security.md)에서 다룬 XSS가 성공하면 사용자의 권한으로 서버 액션을 호출할 수 있다는 점도 고려한다.

### 경계 분리는 "상태와 데이터의 소유 위치"로 결정한다

서버/클라이언트 컴포넌트 경계는 취향 문제가 아니다. 실행 환경이 제공하는 능력과 비용을 기준으로 나눠야 한다.

| 요구 | 서버 컴포넌트가 유리한 이유 | 클라이언트 컴포넌트가 필요한 이유 | 경계 조건 |
|------|----------------------------|----------------------------------|----------|
| 데이터베이스/내부 API 조회 | 데이터 소스 가까이에서 실행하고 비밀 값을 숨긴다 | 브라우저에서 직접 접근하면 토큰 노출과 CORS 문제가 생긴다 | 사용자 입력마다 즉시 갱신되는 데이터는 mutation 후 refresh/revalidate가 필요하다 |
| 정적 콘텐츠/문서 렌더링 | Markdown 파서와 큰 의존성을 서버에 남긴다 | 클라이언트 검색/필터가 있으면 일부 island가 필요하다 | 큰 payload를 한 번에 넘기면 RSC 전송 비용이 커진다 |
| 버튼, 입력, 드래그, 차트 상호작용 | 서버는 이벤트 핸들러를 유지하지 않는다 | 상태와 DOM 이벤트가 필요하다 | 상위 전체를 client로 만들면 bundle이 커진다 |
| 개인화 헤더/권한별 메뉴 | 쿠키와 세션을 서버에서 읽어 민감 정보를 숨긴다 | 사용자 즉시 조작 상태는 client가 필요하다 | 캐시 key가 사용자별로 갈라진다 |
| 실시간 협업/소켓 | 초기 데이터와 권한 검사는 서버가 적합하다 | 연결 유지와 즉시 반응은 client가 맡는다 | RSC는 장기 연결 상태 저장소가 아니다 |

경계를 잘못 나누면 증상이 다르게 나타난다.

- 클라이언트로 너무 많이 보낸 경우: JavaScript bundle 증가, hydration 지연, INP 악화, 비밀 값 노출 위험.
- 서버에 너무 많이 남긴 경우: 버튼 이벤트를 붙일 수 없음, 브라우저 API 접근 오류, 작은 상호작용마다 네트워크 왕복 증가.
- props를 크게 넘긴 경우: RSC payload 증가, navigation 지연, 캐시 효율 저하.
- 캐시를 넓게 잡은 경우: 사용자별 데이터 혼입, stale UI, mutation 후 화면 불일치.

실무에서는 먼저 route를 서버 컴포넌트 중심으로 만들고, 실제 상호작용이 필요한 가장 작은 지점에 `use client`를 둔다. 그다음 build output과 Performance trace로 script evaluation, hydration, network payload가 줄었는지 확인한다.

## 실무 관점

### App Router 도입은 라우터 교체가 아니라 소유권 재배치다

Pages Router나 React Router 기반 SPA에서 App Router로 이동할 때 단순히 파일명을 바꾸는 작업으로 접근하면 실패하기 쉽다. 기존 앱의 많은 컴포넌트는 "데이터 조회, 상태, 이벤트, 화면 렌더링"을 한 파일 안에 섞어 둔다. App Router에서는 이 책임을 다시 나눠야 한다.

| 기존 SPA 패턴 | App Router에서의 재배치 | 얻는 것 | 비용 |
|---------------|-------------------------|---------|------|
| route 진입 후 `useEffect`로 목록 조회 | `page.tsx` 서버 컴포넌트에서 조회 | 초기 HTML과 데이터가 함께 도착, client JS 감소 | 서버 캐시·오류·로딩 경계 설계 필요 |
| 전역 layout에서 모든 상호작용 처리 | 정적 layout + 작은 client island | 공통 UI bundle 축소 | island 간 상태 공유 설계 필요 |
| mutation 후 client cache invalidate | Server Action + `revalidatePath`/`revalidateTag` | 서버 데이터와 UI 재검증 연결 | 낙관적 UI와 pending state를 별도로 설계 |
| API route를 BFF처럼 사용 | 서버 컴포넌트 직접 조회 또는 route handler | 중간 JSON hop 감소 | 외부 소비 API와 내부 조회 경계 구분 필요 |

도입 순서는 "모든 것을 RSC로 바꾸기"가 아니라 경계가 명확한 화면부터 시작하는 편이 낫다. 문서/블로그/상품 목록처럼 공개 데이터와 정적 레이아웃이 많은 route는 효과가 잘 드러난다. 복잡한 캔버스 편집기, 실시간 협업 도구, 대시보드 위젯처럼 브라우저 상호작용이 중심인 화면은 작은 server wrapper와 client app 구조가 더 자연스러울 수 있다.

### RSC 경계는 번들 분석으로 확인한다

RSC의 장점은 코드가 서버에 남는다는 데 있다. 이 장점은 추측하지 말고 build 산출물로 확인해야 한다.

```bash
pnpm next build
```

확인할 항목은 다음과 같다.

- route별 first load JS가 줄었는가.
- `use client` 진입점이 상위 layout에 붙어 있지 않은가.
- 서버 전용 의존성이 client bundle에 들어가지 않았는가.
- RSC payload가 너무 커져 navigation이 느려지지 않았는가.
- Performance trace에서 script evaluation과 hydration 작업이 줄었는가.

Next.js 앱이 아니라 이 저장소의 학습 문서에서는 실제 프로젝트를 빌드하지 않지만, Phase 8 실습에서는 같은 화면을 넓은 client boundary와 좁은 client boundary로 나눠 build output을 비교해야 한다. "서버 컴포넌트를 썼다"가 아니라 "클라이언트로 내려간 JavaScript와 hydration 비용이 줄었다"가 검증 결과다.

### 캐시 정책은 mutation과 함께 리뷰한다

캐시는 읽기 경로에서 켜지만 사고는 쓰기 경로에서 난다. 상품 상세를 캐시했다면 상품 가격 변경, 품절 상태 변경, 권한별 가격 노출, 관리자 미리보기 같은 mutation과 예외 흐름이 재검증 정책에 반영되어야 한다.

| 데이터 | 권장 시작점 | 재검증 방식 | 주의점 |
|--------|-------------|-------------|--------|
| 공개 문서/블로그 | SSG/ISR 또는 `use cache` | 긴 시간 기반 + publish 시 path/tag | 예약 발행, 삭제, slug 변경 |
| 상품 목록 | 캐시 + tag | 재고/가격 변경 시 tag | 사용자별 가격이면 공유 캐시 금지 |
| 로그인 사용자 대시보드 | 동적 렌더링 | 요청별 조회 또는 private cache | 사용자 데이터 혼입 방지 |
| 검색 결과 | 제한적 캐시 | query normalize 후 짧은 TTL | 무한한 cache key 폭발 |
| 장바구니 | 동적 또는 사용자별 private cache | mutation 후 path refresh | 다른 사용자와 절대 공유 금지 |

검증은 production 모드에서 해야 한다. 개발 서버는 빠른 피드백을 위해 캐시를 다르게 다룰 수 있고, HMR과 router cache가 실제 배포 환경의 edge/CDN/cache handler와 다르다.

### Server Action은 API 설계 원칙을 피하지 못한다

Server Action을 쓰면 form과 mutation 코드가 컴포넌트 가까이에 놓인다. 이 장점 때문에 인증·인가·입력 검증을 컴포넌트 신뢰 모델로 착각하기 쉽다. 서버 액션은 직접 POST 요청으로 호출될 수 있다는 전제에서 설계한다.

좋은 서버 액션은 다음 성격을 갖는다.

- 입력은 `FormData`나 명시적 객체에서 파싱하고 스키마로 검증한다.
- 인증은 세션을 서버에서 읽고, 인가는 대상 리소스 기준으로 다시 검사한다.
- mutation은 idempotency, 중복 제출, race condition을 고려한다.
- 성공 후 재검증 범위를 명확히 둔다.
- 클라이언트 pending/error UI는 `useActionState`, `useFormStatus`, optimistic update 같은 별도 모델로 설계한다.

서버 액션을 모든 데이터 읽기에 쓰는 것은 경계가 흐려지는 신호다. 읽기 데이터는 서버 컴포넌트의 데이터 페칭과 캐시 정책으로 다루고, 서버 액션은 상태 변경과 그 이후의 재검증을 표현하는 것이 기본이다.

## 더 깊이

### RSC payload는 UI diff와 코드 참조를 함께 운반한다

RSC payload는 서버 컴포넌트가 렌더링한 결과, 클라이언트 컴포넌트가 들어갈 자리, 클라이언트 JavaScript 파일 참조, 서버에서 클라이언트로 넘긴 props를 포함한다. 이것은 REST API의 JSON 응답과 다르다. JSON API는 도메인 데이터를 보내고 클라이언트가 UI를 결정한다. RSC payload는 이미 React 트리 형태의 UI 결과를 포함한다.

이 차이는 장점과 위험을 동시에 만든다. 장점은 클라이언트가 데이터 조회와 UI 조립 로직을 덜 가진다는 점이다. 위험은 payload가 UI 구조와 결합되어 있어 너무 큰 트리를 자주 보내면 navigation 비용이 커진다는 점이다. RSC가 "API가 필요 없다"는 뜻은 아니다. 외부 소비자, 모바일 앱, 타 서비스가 사용하는 계약은 여전히 명시적 API가 필요하다. RSC payload는 React 앱 내부의 렌더링 프로토콜로 보는 편이 정확하다.

### partial prerendering과 streaming은 같은 질문을 다른 축에서 푼다

Next.js의 최근 렌더링 모델은 정적 shell과 동적 hole을 조합하는 방향으로 발전해 왔다. 정적 가능한 부분은 먼저 보내고, 동적 데이터가 필요한 부분은 Suspense 경계 뒤에서 스트리밍한다. 이 접근은 [렌더링 전략](./05-rendering-strategies.md)의 "보이는 HTML"과 "상호작용 가능한 앱" 사이를 더 잘게 나눈다. shell·boundary의 전달 계약은 [5b-6 Streaming SSR](../phase-5b/06-streaming-server-side-rendering.md)의 모델을 전제로 한다.

이 모델의 판단 기준은 "이 컴포넌트가 동적인가"가 아니라 "이 동적성이 route 전체를 막아야 하는가"다. 사용자 이름 하나를 읽기 위해 전체 문서 렌더링을 동적으로 만들 필요는 없을 수 있다. 반대로 권한에 따라 본문 전체가 달라지는 관리자 화면이라면 정적 shell을 억지로 유지하는 것이 캐시 혼입 위험을 키울 수 있다.

### 서버/클라이언트 경계는 조직 경계와도 연결된다

RSC 경계가 기술적으로만 보이면 "누가 어떤 데이터를 소유하는가"를 놓친다. 서버 컴포넌트가 직접 데이터베이스를 조회한다면 프론트엔드 코드가 도메인 쿼리와 권한 모델을 더 가까이 다루게 된다. 이는 BFF를 줄이는 장점이 있지만, 백엔드 소유 데이터 계약을 흐리게 만들 수도 있다.

조직적으로 안정적인 기준은 다음과 같다.

- 외부 클라이언트도 써야 하는 데이터는 명시적 API 계약을 유지한다.
- 웹 UI 전용 조합 데이터는 서버 컴포넌트나 BFF에서 조립할 수 있다.
- 권한 검사는 데이터 소유 계층에서 한 번, 서버 액션/route handler에서 다시 한 번 수행한다.
- UI 성능 때문에 데이터 계약을 깨지 않고, 데이터 계약 때문에 모든 UI를 클라이언트로 밀어내지도 않는다.

RSC는 서버와 클라이언트 사이의 경계를 없애지 않는다. 경계를 React 트리 안으로 끌어와 더 자주, 더 작게 결정하게 만든다.

## 정리

- App Router의 route segment는 URL 경로뿐 아니라 layout, loading, error, streaming, data boundary를 표현하는 실행 경계다.
- 서버 컴포넌트는 HTML 문자열 생성기가 아니라 RSC payload를 통해 React 트리를 서버와 클라이언트 실행 환경으로 나누는 모델이다.
- `use client`는 파일 하나가 아니라 import graph를 클라이언트 번들로 옮기는 경계이므로 최대한 좁게 둔다.
- 서버에서 실행된다는 사실과 캐시된다는 사실은 다르다. Next.js 캐시는 HTTP, request, data, route, router 계층을 분리해 판단해야 한다.
- Server Action은 UI 내부 함수처럼 보여도 네트워크로 호출되는 mutation 경계이므로 인증, 인가, 입력 검증, 재검증 범위를 명시해야 한다.

## 확인 문제

1. 다음 구조에서 `app/layout.tsx`에 `"use client"`를 붙이고 theme toggle, 검색창, 로고, 내비게이션을 모두 import했다. 빌드 결과 first load JS가 크게 늘었다. 어떤 일이 일어났고, 어떻게 경계를 다시 잡아야 하는가?

<details>
<summary>정답과 해설</summary>

`use client`가 `layout.tsx`를 클라이언트 컴포넌트 진입점으로 만들면서 layout이 import하는 모듈 그래프가 클라이언트 번들에 포함되었다. 로고와 정적 내비게이션처럼 서버 컴포넌트로 남아도 되는 코드까지 브라우저로 내려갔을 가능성이 높다. 해결은 theme toggle, 검색창처럼 상태·이벤트·브라우저 API가 필요한 작은 컴포넌트에만 `use client`를 붙이고, layout 자체와 정적 UI는 서버 컴포넌트로 유지하는 것이다. 이후 `next build`, 번들 분석, Performance trace의 script evaluation/hydration 시간을 비교한다.
</details>

2. 서버 컴포넌트에서 ORM으로 가져온 `User` 클래스 인스턴스를 클라이언트 컴포넌트 prop으로 넘겼더니 메서드가 사라지거나 직렬화 오류가 발생했다. 왜 이런 문제가 생기는가?

<details>
<summary>정답과 해설</summary>

서버 컴포넌트와 클라이언트 컴포넌트 사이에는 RSC payload 직렬화 경계가 있다. 클래스 인스턴스의 프로토타입, 메서드, 데이터베이스 커넥션 같은 실행 환경 의존성은 이 경계를 안정적으로 넘길 수 없다. 클라이언트가 필요한 값만 일반 객체 DTO로 변환해 전달해야 한다. 이 경계는 내부 API 계약처럼 다루어야 하며, 민감 정보도 이 단계에서 제거해야 한다.
</details>

3. 블로그 목록을 캐시했는데 글 발행 직후 목록에는 새 글이 보이지 않고 상세 URL로 직접 접근하면 보인다. 어떤 계층의 문제를 의심해야 하며, 어떤 재검증 전략을 검토해야 하는가?

<details>
<summary>정답과 해설</summary>

상세 route와 목록 route의 캐시가 서로 다른 계층 또는 다른 key로 관리되고 있을 가능성이 높다. 글 발행 mutation 후 상세만 갱신되거나, 목록 route/tag가 재검증되지 않았을 수 있다. 글 발행 서버 액션에서 `/blog` 목록 경로에 `revalidatePath("/blog")`를 호출하거나, 목록 조회에 `posts` 같은 tag를 붙이고 `revalidateTag("posts")`를 호출하는 전략을 검토한다. production 모드에서 `next build`와 `next start`로 실제 재검증 동작을 확인한다.
</details>

4. 장바구니 화면을 성능 개선 목적으로 `use cache` 또는 긴 `revalidate`로 캐시하려 한다. 어떤 조건을 먼저 확인해야 하는가?

<details>
<summary>정답과 해설</summary>

장바구니는 사용자별 데이터이므로 공유 캐시에 올라가면 다른 사용자의 데이터가 노출될 수 있다. 먼저 cache key가 사용자 세션과 분리되는지, 해당 캐시가 private cache인지, mutation 후 stale 장바구니가 보이지 않도록 refresh/revalidate가 설계되었는지 확인해야 한다. 실시간성과 권한 경계가 강한 데이터는 매 요청 동적 렌더링이나 사용자별 private cache가 더 안전하다.
</details>

## 참고 자료

- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components): App Router에서 서버 컴포넌트와 클라이언트 컴포넌트를 언제 사용하는지, RSC payload와 hydration 흐름이 어떻게 연결되는지 확인할 수 있다.
- [Next.js — Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data): 서버 컴포넌트의 async 데이터 페칭, 스트리밍, request memoization 패턴을 확인할 수 있다.
- [Next.js — Caching](https://nextjs.org/docs/app/getting-started/caching): Next.js 16 계열의 Cache Components, `use cache`, `cacheLife`, `cacheTag` 모델을 확인할 수 있다.
- [Next.js — Revalidating](https://nextjs.org/docs/app/getting-started/revalidating): 시간 기반, path 기반, tag 기반 재검증을 어떤 API로 수행하는지 확인할 수 있다.
- [Next.js — Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data): Server Function과 Server Action의 관계, form action, 보안 주의점을 확인할 수 있다.
- [Next.js — ISR Guide](https://nextjs.org/docs/app/guides/incremental-static-regeneration): App Router에서 ISR을 구현하고 재검증하는 흐름을 예제로 확인할 수 있다.
- [React — Server Components](https://react.dev/reference/rsc/server-components): React Server Components가 빌드 시점·요청 시점 서버에서 어떻게 실행될 수 있는지 확인할 수 있다.
- [React — 'use client'](https://react.dev/reference/rsc/use-client): `use client`가 서버/클라이언트 모듈 그래프 경계를 어떻게 정의하는지 확인할 수 있다.
