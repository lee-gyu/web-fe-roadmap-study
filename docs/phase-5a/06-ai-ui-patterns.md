# 5a-6. AI UI Patterns

> 한 줄 요약: 스트리밍 AI UI는 문자열과 loading spinner가 아니라 신뢰할 수 없는 event stream을 취소·오류·재시도·경합 가능한 materialized view로 축적하는 클라이언트이며, transport·state machine·presentation 경계를 분리해야 한다.

이 문서는 React 19.x, Fetch·Web Streams·AbortController를 기준으로 한다. Web API 동작은 2026-07-10에 MDN의 현재 문서와 대조했다. 특정 provider·모델·AI SDK signature는 고정하지 않고 provider-neutral transport 계약을 먼저 세운다.

## 학습 목표

- API secret과 provider 호출을 브라우저 밖의 애플리케이션 서버 경계에 배치할 수 있다.
- conversation·message·message part와 요청 상태를 판별 유니언으로 모델링할 수 있다.
- UTF-8 chunk와 protocol frame을 구분하고 transport adapter에서 누적·파싱할 수 있다.
- `AbortController`와 request ID로 취소·unmount·늦은 응답 경합을 안전하게 처리할 수 있다.
- mock stream으로 정상·중간 오류·취소·재시도·연속 제출을 결정적으로 검증할 수 있다.
- streaming commit·scroll·live region·신뢰하지 않는 출력의 제품 경계를 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

전통적 요청 UI는 submit 뒤 하나의 response가 도착한다. AI 응답은 다음 특성이 동시에 나타난다.

- 첫 byte까지 지연되고 내용은 여러 chunk로 부분 도착한다.
- 사용자가 중단하거나 새 질문을 제출할 수 있다.
- text 외에 tool call, tool result, 구조화 데이터와 오류가 섞인다.
- transport는 끝났지만 tool 결과가 아직 pending일 수 있다.
- 이전 요청의 늦은 event가 새 대화를 덮을 수 있다.
- 모델·tool 출력은 신뢰할 수 없는 외부 입력이다.

이를 `messages: string[]`와 `loading: boolean`로 표현하면 `submitting`과 `streaming`, `cancelled`와 `error`, 부분 assistant 응답과 완성 응답이 모두 같은 모양이 된다. UI는 어떤 버튼을 보여야 하는지, 무엇을 재시도해야 하는지, 어느 응답이 최신인지 판단할 수 없다.

핵심 관점은 AI UI를 “채팅 bubble 목록”이 아니라 **event stream을 현재 대화 view로 투영하는 state machine**으로 보는 것이다. 이는 분산 시스템의 순서·중복·취소 문제가 사용자 화면에 직접 드러난 경우다.

## 핵심 개념

### Secret과 provider 책임은 서버에 둔다

브라우저 bundle, source map, DevTools Network에서 읽을 수 있는 값은 secret이 아니다. provider API key를 `VITE_*` 환경 변수나 client component에 넣으면 사용자에게 배포된다.

```text
Browser React UI
  │ POST /api/conversation (사용자 session으로 인증)
  ▼
Application server / route handler
  - 사용자 인증·권한
  - 입력 크기·rate limit·quota
  - provider secret
  - provider protocol → app event protocol 변환
  - 감사/비용/오류 기록
  │
  ▼
AI provider
```

UI는 같은 출처의 애플리케이션 endpoint만 호출한다. 통합 framework에서는 route handler/server action이 UI와 함께 배포될 수 있다. Vite SPA에서는 별도 API server나 edge function의 배포, CORS, session, observability를 팀이 직접 소유한다. 어느 쪽이든 secret이 client로 내려오지 않는다는 invariant는 같다.

서버 proxy는 key만 숨기는 통로가 아니다. 사용자별 권한·quota·tool allowlist·provider 오류 정규화가 있는 trust boundary다. 보안 공격의 상세는 [8-4 웹 보안](../phase-8/04-web-security.md)으로 넘긴다.

### Message는 문자열이 아니라 안정된 ID와 part의 합이다

```tsx
type TextPart = {
  type: "text";
  text: string;
};

type ToolCallPart = {
  type: "tool-call";
  callId: string;
  tool: string;
  input: unknown;
  status: "pending" | "running";
};

type ToolResultPart = {
  type: "tool-result";
  callId: string;
  output: unknown;
};

type ErrorPart = {
  type: "error";
  code: string;
  message: string;
};

type MessagePart = TextPart | ToolCallPart | ToolResultPart | ErrorPart;

type Delivery =
  | "pending"
  | "streaming"
  | "success"
  | "error"
  | "cancelled";

type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  parts: MessagePart[];
  delivery: Delivery;
  requestId?: string;
};
```

ID는 array index나 현재 시각 표시 문자열이 아니라 message 수명 동안 안정적이어야 한다. `requestId`는 같은 network run에서 온 event를 묶고, `callId`는 tool call/result를 연결한다. 이 세 identity를 하나로 합치면 재시도와 여러 tool call에서 충돌한다.

`unknown`은 tool input/output이 아직 검증되지 않은 trust boundary임을 보존한다. renderer가 tool별 schema guard를 통과한 뒤 구체 타입으로 좁힌다. `as SomeToolResult`로 단언하면 외부 데이터가 TypeScript를 우회한다([4-2 타입 설계](../phase-4/02-type-design.md)).

철저성 검사는 새 part가 추가됐을 때 빠진 UI를 compile error로 만든다.

```tsx
function assertNever(value: never): never {
  throw new Error(`처리하지 않은 message part: ${JSON.stringify(value)}`);
}

function MessagePartView({ part }: { part: MessagePart }) {
  switch (part.type) {
    case "text":
      return <p>{part.text}</p>;
    case "tool-call":
      return <ToolCallView part={part} />;
    case "tool-result":
      return <ToolResultBoundary part={part} />;
    case "error":
      return <p role="alert">{part.message}</p>;
    default:
      return assertNever(part);
  }
}
```

### 요청 상태는 event timeline을 보존한다

```tsx
type RunState =
  | { status: "idle" }
  | { status: "submitting"; requestId: string; assistantId: string }
  | { status: "streaming"; requestId: string; assistantId: string }
  | { status: "success"; assistantId: string }
  | { status: "error"; assistantId: string; message: string }
  | { status: "cancelled"; assistantId: string };
```

전이는 다음처럼 제한한다.

```text
idle/success/error/cancelled
          │ submit
          ▼
      submitting ── abort ──▶ cancelled
          │ response opened
          ▼
       streaming ── abort ──▶ cancelled
          │     │
      done│     └── transport/protocol error ──▶ error
          ▼
       success
```

이 구분은 UI contract가 된다.

| 상태 | 입력/제출 | 보조 동작 | 사용자에게 보일 정보 |
|---|---|---|---|
| `submitting` | 중복 제출 차단 | 중단 가능 | 요청을 보내는 중 |
| `streaming` | 정책에 따라 입력 허용, submit은 차단 | 중단 가능 | 현재 partial text |
| `success` | 제출 가능 | copy/feedback | 완성된 응답 |
| `error` | 제출/재시도 가능 | 재시도 | 부분 응답 유지 여부와 오류 |
| `cancelled` | 제출/재시도 가능 | 재시도 | 사용자가 중단한 partial 응답 |

하나의 `loading`은 이 전이를 복원할 수 없다. Boolean을 여러 개 두는 것도 불가능 조합을 만든다.

### Byte chunk, text, protocol frame은 서로 다른 경계다

`ReadableStream<Uint8Array>`의 한 chunk가 한 글자·한 JSON object·한 server event라는 보장은 없다. UTF-8 다중 byte 문자가 chunk 사이에서 잘릴 수 있고, 한 chunk에 frame 여러 개가 들어오거나 한 frame이 여러 chunk에 걸칠 수 있다.

애플리케이션 서버가 newline-delimited JSON(NDJSON)을 보낸다고 가정한 최소 adapter를 보자. `parseServerEvent`는 `JSON.parse` 결과를 `unknown`으로 받고 schema를 검증해 `ServerEvent`를 반환해야 한다.

```tsx
type ServerEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; callId: string; tool: string; input: unknown }
  | { type: "tool-result"; callId: string; output: unknown };

type ChatTransport = {
  stream(input: string, signal: AbortSignal): AsyncIterable<ServerEvent>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseServerEvent(line: string): ServerEvent {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("올바르지 않은 server event다.");
  }
  if (value.type === "text-delta" && typeof value.delta === "string") {
    return { type: "text-delta", delta: value.delta };
  }
  if (
    value.type === "tool-call" &&
    typeof value.callId === "string" &&
    typeof value.tool === "string"
  ) {
    return {
      type: "tool-call",
      callId: value.callId,
      tool: value.tool,
      input: value.input,
    };
  }
  if (value.type === "tool-result" && typeof value.callId === "string") {
    return { type: "tool-result", callId: value.callId, output: value.output };
  }
  throw new Error(`지원하지 않는 server event type: ${value.type}`);
}

function createFetchTransport(endpoint: string): ChatTransport {
  return {
    async *stream(input, signal) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`응답 stream을 열지 못했다: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim() !== "") yield parseServerEvent(line);
          }
        }

        buffer += decoder.decode(); // decoder 내부의 마지막 byte를 flush한다.
        if (buffer.trim() !== "") yield parseServerEvent(buffer);
      } finally {
        reader.releaseLock();
      }
    },
  };
}
```

`TextDecoder.decode(value, { stream: true })`는 뒤 chunk가 이어짐을 알려 잘린 다중 byte 문자를 decoder 내부에 보존한다. `buffer`는 완성되지 않은 NDJSON frame을 보존한다. provider의 SSE·binary protocol을 UI reducer가 직접 해석하지 않고 server/transport adapter가 app-level event로 정규화한다.

`response.ok`만으로 protocol 성공이 보장되지는 않는다. 잘못된 frame, 알 수 없는 event type, 누락된 완료 신호도 오류 상태로 바꿔야 한다.

### Reducer는 event stream을 message view로 축적한다

다음은 핵심 전이를 완전하게 표현한 reducer다.

```tsx
type ConversationState = {
  messages: Message[];
  run: RunState;
};

type ConversationAction =
  | { type: "submitted"; requestId: string; user: Message; assistant: Message }
  | { type: "streaming"; requestId: string }
  | { type: "event"; requestId: string; event: ServerEvent }
  | { type: "completed"; requestId: string }
  | { type: "failed"; requestId: string; message: string }
  | { type: "cancelled"; requestId: string };

type ActiveRun = Extract<RunState, { status: "submitting" | "streaming" }>;

function isActive(run: RunState, requestId: string): run is ActiveRun {
  return (
    (run.status === "submitting" || run.status === "streaming") &&
    run.requestId === requestId
  );
}

function appendEvent(parts: MessagePart[], event: ServerEvent): MessagePart[] {
  switch (event.type) {
    case "text-delta": {
      const last = parts.at(-1);
      if (last?.type === "text") {
        return [
          ...parts.slice(0, -1),
          { type: "text", text: last.text + event.delta },
        ];
      }
      return [...parts, { type: "text", text: event.delta }];
    }
    case "tool-call":
      return [
        ...parts,
        {
          type: "tool-call",
          callId: event.callId,
          tool: event.tool,
          input: event.input,
          status: "pending",
        },
      ];
    case "tool-result":
      return [
        ...parts,
        { type: "tool-result", callId: event.callId, output: event.output },
      ];
    default:
      return assertNever(event);
  }
}

function updateMessage(
  messages: Message[],
  id: string,
  update: (message: Message) => Message,
) {
  return messages.map((message) => (message.id === id ? update(message) : message));
}

function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  if (action.type === "submitted") {
    return {
      messages: [...state.messages, action.user, action.assistant],
      run: {
        status: "submitting",
        requestId: action.requestId,
        assistantId: action.assistant.id,
      },
    };
  }

  if (!isActive(state.run, action.requestId)) return state;
  const assistantId = state.run.assistantId;

  switch (action.type) {
    case "streaming":
      return {
        messages: updateMessage(state.messages, assistantId, (message) => ({
          ...message,
          delivery: "streaming",
        })),
        run: { status: "streaming", requestId: action.requestId, assistantId },
      };
    case "event":
      return {
        ...state,
        messages: updateMessage(state.messages, assistantId, (message) => ({
          ...message,
          parts: appendEvent(message.parts, action.event),
        })),
      };
    case "completed":
      return {
        messages: updateMessage(state.messages, assistantId, (message) => ({
          ...message,
          delivery: "success",
        })),
        run: { status: "success", assistantId },
      };
    case "failed":
      return {
        messages: updateMessage(state.messages, assistantId, (message) => ({
          ...message,
          delivery: "error",
          parts: [
            ...message.parts,
            { type: "error", code: "stream_failed", message: action.message },
          ],
        })),
        run: { status: "error", assistantId, message: action.message },
      };
    case "cancelled":
      return {
        messages: updateMessage(state.messages, assistantId, (message) => ({
          ...message,
          delivery: "cancelled",
        })),
        run: { status: "cancelled", assistantId },
      };
    default:
      return assertNever(action);
  }
}
```

reducer 첫 guard가 중요한 경쟁 제어다. 새 요청이 시작됐거나 사용자가 취소해 더는 active가 아니면 옛 `requestId`의 event를 무시한다. `AbortController`는 transport에 중단을 요청하지만 이미 queue에 들어온 event나 abort를 무시하는 mock/SDK까지 state 정합성에서 제거하는 것은 request ID다.

### Hook은 transport 수명과 reducer를 연결한다

아래 Hook은 외부 transport를 주입받아 presentation과 SDK를 분리한다. `crypto.randomUUID()`는 예제의 안정 ID 생성기이며 결정적 테스트에서는 ID factory도 주입한다.

```tsx
import { useCallback, useEffect, useReducer, useRef } from "react";

type ActiveRequest = {
  requestId: string;
  controller: AbortController;
};

export function useConversation(transport: ChatTransport) {
  const [state, dispatch] = useReducer(conversationReducer, {
    messages: [],
    run: { status: "idle" },
  });
  const activeRef = useRef<ActiveRequest | null>(null);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;

    activeRef.current = null;
    active.controller.abort();
    dispatch({ type: "cancelled", requestId: active.requestId });
  }, []);

  const send = useCallback(
    async (input: string) => {
      const prompt = input.trim();
      if (prompt === "" || activeRef.current) return;

      const requestId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const assistantId = crypto.randomUUID();
      const controller = new AbortController();
      activeRef.current = { requestId, controller };

      dispatch({
        type: "submitted",
        requestId,
        user: {
          id: userId,
          role: "user",
          parts: [{ type: "text", text: prompt }],
          delivery: "success",
          requestId,
        },
        assistant: {
          id: assistantId,
          role: "assistant",
          parts: [],
          delivery: "pending",
          requestId,
        },
      });

      try {
        const events = transport.stream(prompt, controller.signal);
        dispatch({ type: "streaming", requestId });

        for await (const event of events) {
          dispatch({ type: "event", requestId, event });
        }

        dispatch({ type: "completed", requestId });
      } catch (error) {
        if (activeRef.current?.requestId !== requestId) return;

        if (controller.signal.aborted) {
          dispatch({ type: "cancelled", requestId });
        } else {
          dispatch({
            type: "failed",
            requestId,
            message: error instanceof Error ? error.message : "알 수 없는 오류",
          });
        }
      } finally {
        if (activeRef.current?.requestId === requestId) {
          activeRef.current = null;
        }
      }
    },
    [transport],
  );

  useEffect(() => {
    return () => {
      const active = activeRef.current;
      activeRef.current = null;
      active?.controller.abort();
    };
  }, []);

  return { state, send, cancel };
}
```

`activeRef`는 빠른 double click이 React의 다음 render 전에 들어와도 두 번째 요청을 막는다. unmount cleanup은 state를 갱신하지 않고 active request만 취소한다. reducer guard 때문에 옛 generator가 늦게 종료돼도 최신 state를 바꾸지 않는다.

이 Hook은 transport/state container다. Message list, composer, stop/retry button은 props만 받는 presentational component로 둔다([5a-4](./04-container-presentational-pattern.md)). SDK를 도입하면 SDK Hook을 UI 전체에 퍼뜨리지 않고 `ChatTransport` 또는 이 controller contract를 구현하는 adapter에 가둔다.

### Mock stream은 edge case를 시간표로 만든다

실제 provider는 느리고 비용이 들며 실패 지점이 재현되지 않는다. script 기반 async iterator로 같은 event를 같은 시점에 만든다.

```tsx
type MockStep =
  | { afterMs: number; event: ServerEvent }
  | { afterMs: number; error: Error };

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException("요청이 취소되었다.", "AbortError"));
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createMockTransport(script: readonly MockStep[]): ChatTransport {
  return {
    async *stream(_input, signal) {
      for (const step of script) {
        await abortableDelay(step.afterMs, signal);
        if ("error" in step) throw step.error;
        yield step.event;
      }
    },
  };
}
```

테스트에서는 fake timer와 고정 ID factory를 사용하면 wall clock 없이 전이를 진행할 수 있다. 최소 시나리오는 다음과 같다.

1. text delta 여러 개 뒤 정상 완료.
2. 두 번째 delta 전 cancel: partial text 유지 + `cancelled`.
3. 중간 error: partial text + error part + retry affordance.
4. cancel 직후 새 요청, 옛 transport의 늦은 event: 최신 요청에 반영되지 않음.
5. 빠른 double submit: user message와 active request가 하나만 생성됨.
6. tool-call과 tool-result: `callId` 연결 및 unknown schema 거부.

## 실무 관점

### 재시도는 “같은 문자열 다시 send”보다 정책이 많다

오류 뒤 재시도할 때 다음을 먼저 정한다.

- 기존 partial assistant message를 보존·대체·접을 것인가?
- user message를 새로 추가할 것인가, 같은 turn의 새 attempt로 연결할 것인가?
- server mutation/tool call이 이미 실행됐다면 idempotency key가 있는가?
- conversation context에는 실패한 partial 응답을 포함할 것인가?

권장 model은 turn과 attempt를 구분하고 `retryOf` 또는 `attempt`를 기록하는 것이다. UI 수준에서 같은 user bubble을 중복 추가하지 않고 새 request ID로 새 attempt를 시작한다. 결제·메일 발송 같은 side-effecting tool은 client 재시도만으로 안전해지지 않으며 server가 idempotency를 보장해야 한다.

Debounce는 빠른 입력 event를 묶는 UI 정책이고 rate limit은 시간당 요청 수를 제한하는 server 정책이며 duplicate suppression은 같은 submit을 한 번만 처리하는 정합성 정책이다. 서로 대체하지 않는다.

### Streaming commit은 먼저 측정하고 작은 batch를 적용한다

매 token/chunk마다 reducer를 dispatch하면 chunk 빈도만큼 render가 예약된다. React의 batching이 일부를 합치더라도 network task가 나뉘면 commit이 늘 수 있다. 하지만 무조건 throttle하면 첫 응답이 늦어지고 cursor가 뚝뚝 끊길 수 있다.

Profiler에서 다음을 기록한다.

- 첫 delta까지 시간과 첫 글자 표시 시간.
- 5~10초 stream의 commit 수와 가장 무거운 subtree.
- markdown parse, syntax highlight, message list 전체가 매번 재계산되는지.
- 16ms frame budget을 반복해서 넘는 commit이 있는지.

병목이 확인되면 transport event를 16~50ms의 작은 buffer로 합치거나 무거운 markdown rendering을 완성 block 단위로 제한한다. 먼저 message component 경계를 안정화하고 오래된 message가 다시 렌더되지 않게 한다. “chunk 수가 많다”만으로 느리다고 결론 내리지 않는다.

### Scroll은 시스템이 아니라 사용자가 소유할 수 있다

새 delta마다 `scrollIntoView()`를 호출하면 사용자가 이전 답변을 읽기 위해 위로 올린 순간 화면을 빼앗는다.

정책은 다음처럼 나눈다.

- 사용자가 bottom 근처에 있거나 자신의 새 message를 제출한 직후에는 follow mode를 유지한다.
- 사용자가 위로 스크롤하면 follow mode를 끈다.
- 새 응답이 계속 오면 “최신 응답으로 이동” button과 unread indicator를 제공한다.
- button을 누르면 bottom으로 이동하고 follow mode를 다시 켠다.

scroll position은 presentation state다. transport Hook에 숨기지 않고 message viewport component가 소유한다.

### Live region은 chunk 전체를 낭독하지 않는다

streaming text container 전체를 `aria-live`로 두면 매 delta마다 긴 문장이 다시 낭독될 수 있다. 짧은 별도 status region을 둔다.

```tsx
<p className="sr-only" aria-live="polite">
  {run.status === "submitting" && "응답을 요청했다."}
  {run.status === "streaming" && "응답을 작성 중이다."}
  {run.status === "success" && "응답이 완료되었다."}
  {run.status === "error" && "응답 중 오류가 발생했다."}
</p>
```

중단 button은 `aria-label="응답 생성 중단"`처럼 목적이 분명해야 한다. 오류와 retry 관계도 가까운 markup으로 연결한다.

### 출력은 항상 신뢰하지 않는 입력이다

React가 string child를 escape한다고 해서 markdown·tool output이 자동으로 안전해지는 것은 아니다.

- raw HTML을 허용하는 markdown renderer는 비활성화하거나 검증된 sanitizer를 적용한다.
- link scheme을 `http`, `https` 등 allowlist로 제한하고 `javascript:`을 거부한다.
- tool output은 tool별 schema 검증 후 전용 renderer로 보낸다.
- model이 반환한 “명령”을 자동 실행하지 않고 server tool allowlist·권한·사용자 확인을 적용한다.
- 오류에 provider 내부 prompt, secret, stack trace를 노출하지 않는다.

UI 안전과 prompt 품질은 다른 문제다. CSP·Trusted Types·XSS 상세는 [8-4](../phase-8/04-web-security.md), agent tool 권한은 [11-6](../phase-11/06-safety-permissions-and-governance.md)에서 심화한다.

### 선택 체크리스트

- provider secret과 사용자별 quota·tool 권한이 server boundary에 있는가?
- message·request·tool call ID가 서로 다른 수명을 표현하는가?
- text/tool/error part가 판별 유니언이고 외부 payload는 `unknown`에서 검증되는가?
- byte chunk, UTF-8 text, protocol frame 파싱이 transport adapter에 격리됐는가?
- abort와 request ID guard가 모두 있어 늦은 event를 막는가?
- retry의 partial message·idempotency 정책이 정해졌는가?
- mock stream으로 정상·취소·오류·경합을 결정적으로 재현하는가?
- commit, scroll, live region, output trust를 각각 올바른 component 경계가 소유하는가?

## 정리

- AI UI는 부분적이고 실패 가능한 event stream의 materialized view이며 문자열 배열과 loading Boolean로 충분하지 않다.
- secret·권한·quota·provider 변환은 application server, browser는 같은 출처 endpoint만 호출한다.
- message는 안정 ID와 `text | tool-call | tool-result | error` part, delivery 상태를 가진다.
- transport adapter가 UTF-8 chunk와 protocol frame을 누적·검증하고 reducer는 app event를 대화 view로 축적한다.
- AbortController는 실행을 중단하고 request ID guard는 늦은 event가 최신 state를 덮는 것을 막는다.
- mock async iterator가 정상·오류·취소·재시도·경합을 비용 없이 결정적으로 만든다.
- streaming 성능, scroll, live announcement, markdown/tool output 안전은 별도 측정·신뢰 경계다.

## 확인 문제

**Q1.** `reader.read()`의 `value`를 매번 `new TextDecoder().decode(value)`한 뒤 `JSON.parse`했다. 한글이 깨지거나 간헐적으로 JSON 오류가 나는 이유와 수정 경계를 설명하라.

<details>
<summary>정답과 해설</summary>

network byte chunk는 UTF-8 문자나 JSON frame 경계와 일치하지 않는다. 같은 `TextDecoder`를 유지해 중간 chunk를 `{ stream: true }`로 decode하고, 별도 문자열 buffer에 미완성 protocol frame을 보존한다. delimiter로 완성 frame만 꺼낸 뒤 JSON parse와 schema validation을 수행하고 마지막에 decoder를 flush한다.
</details>

**Q2.** 사용자가 요청 A를 취소하고 B를 보냈는데 A transport가 abort를 무시하고 늦은 delta를 보냈다. AbortController만으로 부족한 이유와 reducer의 방어는 무엇인가?

<details>
<summary>정답과 해설</summary>

abort는 협력적 중단 신호라 이미 queue에 든 callback이나 신호를 무시하는 adapter를 state에서 제거하지 못한다. 모든 event에 request ID를 붙이고 reducer가 현재 active request ID와 일치할 때만 반영한다. cancel이나 새 submit으로 active ID가 바뀐 뒤 A event는 no-op이 된다.
</details>

**Q3.** streaming message 전체에 `aria-live="polite"`를 붙였다. 시각적으로는 잘 동작하지만 어떤 문제가 생기며 어떻게 바꾸는가?

<details>
<summary>정답과 해설</summary>

매 chunk마다 긴 message가 반복 낭독되어 사용자가 내용을 듣기 어렵다. stream content와 별도로 짧은 status live region을 두고 “작성 중/완료/오류” 같은 낮은 빈도의 상태만 알린다. 완성 content는 일반 문서 탐색으로 읽게 하고 중단·재시도 control에 명확한 accessible name을 준다.
</details>

## 참고 자료

- [MDN — Using readable streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams) — `ReadableStream` 소비, async iteration, AbortSignal 취소 흐름을 확인한다.
- [MDN — `TextDecoder.decode()`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode) — chunk decode의 `stream` flag와 마지막 flush 의미를 확인한다.
- [MDN — `AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) — fetch·stream 작업에 전달하는 중단 신호 계약을 확인한다.
- [WAI-ARIA — `aria-live`](https://w3c.github.io/aria/#aria-live) — live region의 politeness와 변경 알림 의미를 확인한다.
- [React — `useReducer`](https://react.dev/reference/react/useReducer) — event 기반 상태 전이를 순수 reducer로 모델링하는 계약을 확인한다.
- [Patterns.dev — AI UI Patterns](https://www.patterns.dev/react/ai-ui-patterns/) — 문제 지형과 UI 사례를 위한 2차 자료다.
