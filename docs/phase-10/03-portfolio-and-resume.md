# 10-3. 포트폴리오와 이력서

> 한 줄 요약: 프로젝트의 기능 목록을 문제, 제약, 선택지, 구현, 측정 결과, 한계가 드러나는 포트폴리오 사례 연구와 이력서 문장으로 바꿀 수 있다.

## 학습 목표

- README와 포트폴리오를 채용 담당자와 동료 개발자가 서로 다른 속도로 읽을 수 있는 구조로 설계할 수 있다.
- 프로젝트 사례 연구를 문제, 제약, 선택지, 결정, 구현, 측정 결과, 남은 한계의 흐름으로 작성할 수 있다.
- 성능, 접근성, 보안, 테스트, 코드 리뷰 기록을 과장 없이 증거로 제시할 수 있다.
- 이력서 bullet을 "무엇을 구현했다"에서 "어떤 제약에서 어떤 선택을 했고 어떤 결과를 얻었다"로 바꿀 수 있다.
- 공개 저장소에서 secret, 실행 불가능한 README, 불명확한 commit/PR 기록 같은 신뢰 손상 요인을 제거할 수 있다.

## 배경: 왜 이것이 존재하는가

포트폴리오는 프로젝트를 예쁘게 포장하는 공간이 아니다. 경력 개발자의 포트폴리오는 작은 기술 설계 문서이자 운영 회고에 가깝다. 면접관은 기능이 많은지보다 선택의 근거가 있는지 본다. 동료 개발자는 README만 보고 로컬 실행과 검증 방법을 재현할 수 있는지 본다. 채용 담당자는 짧은 시간 안에 "이 사람이 어떤 문제를 어떤 깊이로 다뤘는가"를 파악하려 한다.

많은 포트폴리오가 약해지는 이유는 기술 스택 목록을 앞세우기 때문이다.

```md
React, TypeScript, Next.js, Tailwind, Zustand, TanStack Query, Vercel을 사용한 영화 검색 앱
```

이 문장은 도구는 말하지만 판단은 말하지 않는다. 다음 문장은 같은 프로젝트라도 더 많은 정보를 준다.

```md
외부 영화 API의 rate limit과 느린 이미지 응답을 고려해 검색 결과를 서버 경계에서 가져오고,
URL 상태와 서버 상태 캐시를 분리했다. LCP 병목을 이미지 발견 지연으로 나누어 측정했고,
검색 결과 첫 화면의 lab LCP를 3.4s에서 2.6s로 줄였지만 field data는 아직 없다.
```

이 문장은 문제, 제약, 선택, 측정, 한계를 함께 보여 준다. Phase 10의 포트폴리오와 이력서는 바로 이 압축을 목표로 한다.

## 핵심 개념

### 사례 연구는 기술 스택 목록이 아니라 판단 흐름이다

프로젝트 사례 연구(case study)는 다음 구조를 따른다.

```text
문제
  → 제약
  → 선택지
  → 결정
  → 구현
  → 측정 결과
  → 남은 한계
  → 다음 개선
```

이 흐름은 [10-1](./01-project-guide.md)의 요구사항·ADR과 [10-2](./02-code-quality-and-review.md)의 리뷰·검증 기록을 외부 독자에게 읽히는 형태로 바꾼 것이다.

```md
## 사례 연구: 성능 회귀 추적 대시보드

### 문제
개인 프로젝트 배포 후 Lighthouse 결과가 악화되어도 어떤 PR이 어떤 지표를 건드렸는지 추적하기 어려웠다.

### 제약
- GitHub Actions artifact로 남은 JSON 결과를 읽어야 했다.
- field data가 없는 작은 프로젝트이므로 lab data의 한계를 명시해야 했다.
- 프로젝트 URL과 측정 조건을 비교 축으로 유지해야 했다.

### 선택지
- 정적 JSON 파일을 빌드 시 읽는 방식
- 서버 route에서 artifact를 조회하는 방식
- 사용자가 JSON을 업로드하는 방식

### 결정
초기 버전은 사용자가 JSON을 업로드하고 IndexedDB에 저장한다.
GitHub token을 다루지 않아 보안 경계를 줄이고, 성능 분석 UI와 데이터 모델 검증에 집중한다.

### 구현
- 측정 결과 schema를 런타임에서 검증한다.
- URL, commit SHA, 측정 조건, LCP/INP/CLS를 비교 키로 사용한다.
- 큰 trace 파일은 저장하지 않고 요약 결과와 원본 링크만 보관한다.

### 측정 결과
- 100개 결과 기준 초기 렌더 commit은 React Profiler에서 42ms였다.
- 목록 virtualizing 전에는 1,000개 결과에서 입력 지연이 관찰되었다.
- virtualizing 뒤 같은 조건에서 검색 입력의 long task가 사라졌다.

### 남은 한계
- 실제 field data와 연결하지 않는다.
- GitHub artifact 자동 수집은 다음 버전으로 미뤘다.
```

핵심은 성공담처럼 쓰지 않는 것이다. 한계가 없는 프로젝트는 보통 한계를 보지 않았다는 뜻이다. 알려진 한계를 명확히 쓰면 오히려 신뢰가 올라간다.

### README는 세 독자를 동시에 다룬다

README는 최소 세 독자를 상대한다.

| 독자 | 읽는 속도 | 필요한 정보 |
|---|---|---|
| 채용 담당자 | 30초 | 문제, 결과, 링크, 대표 스크린샷 |
| 동료 개발자 | 5분 | 구조, 실행 방법, 기술 선택, 검증 명령 |
| 면접관 | 15분+ | ADR, 측정 로그, PR 이력, 한계 |

따라서 README는 위에서 아래로 점점 깊어져야 한다.

````md
# Performance Regression Board

배포별 성능 측정 결과와 변경 이력을 비교해 LCP/INP/CLS 회귀 원인을 추적하는 대시보드다.

## 링크
- Demo:
- Repository:
- Case study:

## 문제와 목표
작은 프로젝트는 CrUX field data가 부족해 배포별 성능 회귀를 직접 추적하기 어렵다.
이 프로젝트는 lab 측정 결과를 조건과 함께 저장하고, 지표 변화와 관련 PR을 한 화면에서 비교한다.

## 핵심 사용자 플로우
1. 사용자는 Lighthouse JSON을 업로드한다.
2. 측정 조건, URL, commit SHA를 확인한다.
3. 이전 측정과 LCP/INP/CLS 차이를 비교한다.
4. 회귀가 큰 항목에서 관련 변경 기록을 확인한다.

## 기술 선택 요약
| 영역 | 선택 | 이유 | ADR |
|---|---|---|---|
| 렌더링 | Vite SPA | 첫 버전은 사용자가 파일을 업로드하므로 서버 렌더링 이점이 작다 | [ADR-001](./docs/adr/001-rendering.md) |
| 저장소 | IndexedDB | 큰 JSON 요약을 브라우저에 보관하고 오프라인 비교를 지원한다 | [ADR-002](./docs/adr/002-storage.md) |
| 검증 | runtime schema | 업로드 파일은 외부 입력이므로 TypeScript 타입만으로 부족하다 | [ADR-003](./docs/adr/003-schema.md) |

## 실행
```sh
pnpm install
pnpm dev
```

## 검증
```sh
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm build
```

## 성능·접근성·보안 점검
| 항목 | 조건 | 결과 | 한계 |
|---|---|---|---|
| LCP | Chrome DevTools, Fast 4G, 4x CPU, cold cache | 2.1s | 실제 사용자 field data 없음 |
| 키보드 탐색 | 업로드 → 비교 → 상세 열기 | 완료 | 스크린 리더별 발화는 수동 점검 미완료 |
| 보안 | 업로드 JSON parsing, HTML sink 없음 | raw HTML 렌더링 없음 | 파일 크기 제한은 5MB로 임의 설정 |

## 알려진 한계
- GitHub artifact 자동 수집은 포함하지 않는다.
- multi-user 동기화와 권한 관리는 다루지 않는다.
- 측정 결과의 통계적 유의성은 판단하지 않는다.
````

README는 "잘 만들었다"를 주장하지 않는다. 독자가 재현할 수 있는 경로를 제공한다. 실행 명령, 환경 변수, seed/demo data, 검증 명령, 알려진 한계가 없으면 동료 개발자는 프로젝트를 신뢰하기 어렵다.

### 증거는 수치보다 측정 조건이 먼저다

포트폴리오에서 숫자는 강한 증거처럼 보이지만, 조건이 없으면 오해를 만든다.

나쁜 문장:

```md
Lighthouse 점수를 65점에서 98점으로 개선했다.
```

좋은 문장:

```md
Chrome DevTools, Fast 4G, 4x CPU slowdown, cold cache 조건에서
검색 결과 페이지 Lighthouse Performance 점수가 65 → 92로 개선되었다.
주요 변화는 LCP 이미지 발견 시점을 앞당긴 것이며, 실제 사용자 field data는 수집하지 못했다.
```

측정 결과에는 다음이 포함되어야 한다.

| 항목 | 써야 하는 내용 |
|---|---|
| 환경 | 브라우저, 기기/CPU throttling, 네트워크, cache 상태 |
| 대상 | URL, route, 사용자 플로우, 데이터 크기 |
| 기준선 | 변경 전 수치 또는 관찰 상태 |
| 조치 | 단일 변경 또는 비교 가능한 변경 묶음 |
| 결과 | 수치, trace, screenshot, test output |
| 한계 | lab/field 차이, 샘플 수, 외부 API 변동 |

성능뿐 아니라 접근성·보안·테스트도 같은 방식으로 쓴다. "axe 통과"는 시작점이고, 어떤 플로우를 키보드로 완주했는지, 어떤 입력 경로에서 XSS sink가 없는지, 어떤 테스트가 어떤 회귀를 막는지 적어야 한다.

### 포트폴리오 페이지는 대표 프로젝트의 깊이를 먼저 보여 준다

포트폴리오 웹사이트를 따로 만든다면 프로젝트 카드 10개보다 대표 프로젝트 1~2개의 깊이가 더 중요하다. 첫 화면에서 이름, 역할, 대표 문제 영역을 빠르게 보여 주고, 각 프로젝트 상세로 들어가면 사례 연구가 읽혀야 한다.

프로젝트 카드의 나쁜 예:

```md
## Movie App
React, TypeScript, Next.js, Tailwind, Zustand 사용
```

좋은 예:

```md
## 영화 검색과 감상 목록 관리
외부 API rate limit과 이미지 로딩 지연을 고려해 검색 결과의 서버/클라이언트 경계를 나눴다.
URL 상태와 서버 상태 캐시를 분리하고, lab 조건에서 검색 결과 LCP를 3.4s → 2.6s로 줄였다.
```

스크린샷도 기능 나열이 아니라 판단을 보조해야 한다. "예쁜 화면"보다 "빈 결과, 실패 상태, 성능 trace, 접근성 tree, ADR 요약"이 더 좋은 증거가 될 수 있다. 다만 채용 담당자가 보는 페이지에는 너무 많은 내부 문서를 한꺼번에 밀어 넣지 않는다. 카드에는 압축하고, 상세 페이지와 저장소에 깊이를 둔다.

### 이력서 bullet은 상황·행동·결과를 압축한다

이력서에서 흔한 약한 문장은 다음과 같다.

```md
- React와 TypeScript로 영화 검색 앱 개발
- Lighthouse를 이용해 성능 최적화
- GitHub Actions로 CI 구축
```

이 문장은 도구만 말한다. 경력직 bullet은 제약, 행동, 결과를 압축해야 한다.

```md
- 외부 영화 API의 rate limit과 느린 이미지 응답을 고려해 검색 결과를 서버 경계에서 가져오고 URL 상태와 서버 상태 캐시를 분리해, lab 조건에서 검색 결과 LCP를 3.4s에서 2.6s로 개선
- 사용자가 업로드한 Lighthouse JSON을 `unknown` 입력으로 처리하고 runtime schema 검증을 추가해, 잘못된 측정 파일이 UI 상태를 깨뜨리는 문제를 component test로 방지
- PR마다 typecheck, lint, component test, build를 실행하는 GitHub Actions gate를 구성하고, 성능·접근성 변경에는 trace 또는 키보드 검증 기록을 PR 본문에 남기는 워크플로 정착
```

정량 지표가 항상 있어야 하는 것은 아니다. 개인 프로젝트는 실제 사용자 데이터가 없을 수 있다. 이때는 관찰 가능한 품질 변화나 운영 리스크 감소를 쓴다.

| 약한 표현 | 더 나은 표현 |
|---|---|
| 상태 관리를 개선했다 | 서버 상태와 URL 상태를 분리해 뒤로 가기와 공유 URL에서 검색 조건이 재현되도록 했다 |
| 접근성을 고려했다 | 검색, 필터, 상세 열기 플로우를 키보드로 완주하고 이름 없는 버튼 6개를 native button과 label로 수정했다 |
| 보안을 강화했다 | Markdown preview에 sanitizer allowlist를 적용하고 raw HTML sink를 한 컴포넌트로 제한했다 |
| 테스트를 작성했다 | API 실패·빈 결과·rate limit 상태를 MSW 기반 component test로 고정했다 |

이력서는 포트폴리오의 목차다. bullet에서 모든 설명을 끝내려 하지 말고, 저장소 README나 case study로 이어지는 링크를 준비한다.

### 공개 저장소 위생은 신뢰의 기본값이다

저장소 자체도 포트폴리오다. 다음 항목은 기술 깊이 이전에 신뢰를 만든다.

- README만 보고 로컬 실행이 가능하다.
- `.env.example`에 필요한 환경 변수 이름과 의미가 있다.
- 실제 secret, 개인 token, 운영 데이터가 없다.
- demo data나 seed data가 준비되어 있다.
- `pnpm install`, `pnpm test`, `pnpm build`가 문서와 일치한다.
- commit message와 PR 본문이 변경 의도를 설명한다.
- ADR과 요구사항 문서가 코드 변경과 연결되어 있다.
- license와 외부 asset 출처가 정리되어 있다.
- 알려진 한계가 숨겨지지 않는다.

특히 secret 제거는 필수다. 이미 commit된 secret은 삭제 커밋만으로 해결되지 않는다. revoke하고, 필요하면 이력 정리와 노출 범위 판단이 필요하다. 공개 저장소에 올릴 demo data는 실제 사용자 데이터와 분리한다.

## 실무 관점

### 과장보다 조건부 주장이 강하다

포트폴리오 문장은 강해 보이려고 과장할수록 약해진다.

| 과장된 주장 | 조건부 주장 |
|---|---|
| 완벽한 접근성을 구현했다 | 주요 사용자 플로우를 키보드로 완주했고, 자동 점검에서 잡힌 이름/대비 문제를 수정했다 |
| 대규모 트래픽을 고려했다 | 정적 자산은 immutable cache를 적용했지만, 실제 부하 테스트와 운영 모니터링은 범위 밖이다 |
| 보안에 강한 앱이다 | raw HTML sink를 제거하고 httpOnly cookie를 사용했지만, 결제·개인정보 처리는 다루지 않는다 |
| 성능을 극대화했다 | LCP 병목을 이미지 발견 지연으로 확인하고 lab 조건에서 0.8초 줄였다 |

조건부 주장은 방어 가능하다. 면접관이 "그 조건이 실제 사용자를 대표하는가"라고 물으면 field data 부재와 다음 검증 계획을 설명할 수 있다.

### 프로젝트가 작을수록 범위 제외가 중요하다

개인 포트폴리오 프로젝트는 인증, 결제, 권한, 실시간 협업, 국제화, 모니터링을 모두 넣기 어렵다. 넣지 않은 것을 숨기면 질문에서 무너진다. 범위 제외를 명시하면 프로젝트 판단이 선명해진다.

```md
## 알려진 한계와 실제 서비스 전 보강 항목
- 결제와 개인정보 저장은 다루지 않는다. 실제 서비스라면 PCI 범위와 개인정보 파기 정책을 별도로 설계해야 한다.
- field performance data를 수집하지 않는다. 실제 운영에서는 `web-vitals` 기반 RUM을 배포 버전과 연결한다.
- 관리자 권한 모델은 mock이다. 실제 서비스라면 서버 권한 검사를 API 계층에서 강제해야 한다.
```

한계는 감점 항목이 아니라 판단의 일부다. 모든 것을 구현하지 못했다는 사실보다, 무엇을 구현하지 않았는지 모르는 것이 더 위험하다.

## 더 깊이

### 포트폴리오의 신뢰도는 증거의 체인으로 결정된다

좋은 기술 서사는 단일 문장으로 설득하지 않는다. 여러 증거가 연결된다.

```text
README의 주장
  → ADR의 선택 근거
  → PR의 구현 diff
  → 테스트와 trace의 검증 결과
  → 회고의 한계와 다음 조치
```

예를 들어 "서버 상태와 URL 상태를 분리했다"는 주장은 다음 체인으로 이어진다.

- ADR: 서버 상태 캐시와 URL 상태 분리 결정
- 코드: search params와 query cache key가 분리된 구현
- PR: 뒤로 가기와 공유 URL 검증 기록
- 테스트: URL query 초기화와 cache invalidation test
- README: 이 선택이 사용자 플로우에 준 영향 요약

이 체인이 있으면 면접에서 꼬리 질문을 받아도 실제 파일과 기록으로 돌아갈 수 있다. 체인이 없으면 답변은 기억과 인상에 의존한다.

### 정량 지표가 없을 때는 비교 가능한 관찰을 쓴다

모든 프로젝트가 매출, 사용자 수, p75 field metric을 갖지는 않는다. 개인 프로젝트에서 숫자를 억지로 만들 필요는 없다. 대신 비교 가능한 관찰을 쓴다.

```md
- 기존에는 API 실패와 빈 결과가 같은 UI로 보였지만, 실패·빈 결과·rate limit 상태를 분리하고 각 상태의 component test를 추가했다.
- 모달을 `div` 클릭 영역으로 구현한 초기 버전에서 native `button`과 focus trap을 적용해 키보드로 열기·닫기·본문 복귀가 가능해졌다.
- 업로드 파일 parsing을 컴포넌트 내부에서 수행하던 구조를 parser 모듈로 분리해 잘못된 JSON 입력 테스트를 DOM 없이 실행할 수 있게 했다.
```

숫자가 없더라도 변경 전후의 위험이 비교 가능하면 증거가 된다.

## 정리

- 포트폴리오 사례 연구는 문제, 제약, 선택지, 결정, 구현, 측정 결과, 한계의 흐름으로 작성한다.
- README는 채용 담당자, 동료 개발자, 면접관이 서로 다른 속도로 읽을 수 있도록 위에서 아래로 깊어져야 한다.
- 성능·접근성·보안 수치는 측정 조건과 한계를 함께 써야 증거가 된다.
- 이력서 bullet은 기술 스택 목록이 아니라 상황·제약, 행동·선택, 결과·증거를 압축한 문장이어야 한다.
- 공개 저장소의 실행 가능성, secret 관리, ADR·PR 이력은 코드만큼 중요한 신뢰 자료다.

## 확인 문제

### 1. 다음 포트폴리오 문장을 어떻게 고치겠는가?

```md
Next.js와 TypeScript를 사용해 성능 좋은 쇼핑몰을 만들었다.
```

<details>
<summary>정답과 해설</summary>

문제, 제약, 선택, 측정 조건, 한계가 없다. 예를 들어 "상품 상세 페이지의 초기 콘텐츠 노출과 API key 보호를 위해 Next.js App Router에서 서버 데이터 접근을 사용했고, 장바구니 버튼만 클라이언트 컴포넌트로 분리했다. Chrome DevTools Fast 4G, 4x CPU 조건에서 상세 페이지 LCP를 3.1s에서 2.4s로 줄였지만 field data는 아직 없다"처럼 바꿀 수 있다.

</details>

### 2. README의 "검증" 섹션에 `pnpm test`만 적혀 있으면 어떤 정보가 부족한가?

<details>
<summary>정답과 해설</summary>

무엇을 검증하는 테스트인지, 어떤 사용자 플로우가 수동 검증 대상인지, 접근성·성능·보안은 어떤 도구와 조건으로 확인했는지 알 수 없다. 테스트 명령은 필요하지만 충분하지 않다. typecheck, lint, test, build 외에 주요 플로우, 측정 조건, 알려진 한계가 함께 있어야 동료 개발자가 품질을 재현할 수 있다.

</details>

### 3. 실제 사용자 수치가 없는 개인 프로젝트에서 성과를 어떻게 표현할 수 있는가?

<details>
<summary>정답과 해설</summary>

과장된 정량 지표를 만들지 말고 변경 전후의 관찰 가능한 위험 감소를 쓴다. 예를 들어 실패 상태 분리, keyboard flow 완주, client bundle에서 서버 SDK 제거, parser 모듈 분리로 테스트 가능성 개선, lab 조건에서 특정 지표 개선처럼 조건과 한계가 있는 증거를 사용한다.

</details>

## 참고 자료

- [GitHub Docs — About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes): 공개 저장소 README가 어떤 정보를 제공해야 하는지 확인할 수 있다.
- [GitHub Docs — About pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests): PR 이력을 포트폴리오 증거로 남길 때 기본 모델을 확인할 수 있다.
- [web.dev — Core Web Vitals](https://web.dev/articles/vitals): 성능 결과를 LCP, INP, CLS 같은 사용자 경험 지표로 설명할 때 기준이 된다.
- [Chrome for Developers — Lighthouse](https://developer.chrome.com/docs/lighthouse/overview): Lighthouse 결과를 해석하고 자동 점검의 범위를 이해하는 데 쓴다.
- [OWASP Cheat Sheet Series — Cross Site Scripting Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html): 사용자 입력과 HTML sink를 다루는 프로젝트에서 보안 근거를 세울 수 있다.
