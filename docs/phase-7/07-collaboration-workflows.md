# 7-7. 협업 워크플로

> 한 줄 요약: 이 문서를 읽고 나면 trunk-based development, GitHub Flow, Git Flow를 브랜치 수명과 통합 비용의 차이로 비교하고, 팀 상황에 맞는 Git 운영 규칙을 설계할 수 있다.

이 문서의 예제와 정책은 Git 자체의 ref/DAG 모델과 호스팅 플랫폼의 보호 규칙을 구분해 설명한다. protected branch, required checks, CODEOWNERS, pull request는 Git 객체가 아니라 플랫폼 정책 계층이다.

## 학습 목표

- 브랜치 전략을 이름이 아니라 브랜치 수명, 통합 주기, 릴리스 분리 필요성으로 비교할 수 있다.
- trunk-based development, GitHub Flow, Git Flow가 각각 어떤 운영 제약에서 강점과 비용을 갖는지 설명할 수 있다.
- merge commit, squash merge, rebase merge의 이력 모양과 추적성 차이를 판단할 수 있다.
- pull request와 code review를 승인 절차가 아니라 변경 의도, 테스트 증거, 운영 영향 검증 과정으로 설계할 수 있다.
- protected branch, required status checks, CODEOWNERS, branch rule로 팀 규칙을 자동화하는 방향을 제안할 수 있다.

## 배경: 왜 이것이 존재하는가

Git은 브랜치를 거의 비용 없이 만들 수 있게 했다. 하지만 브랜치 생성 비용이 낮다는 사실이 브랜치 운영 비용도 낮다는 뜻은 아니다. 브랜치가 오래 살아 있으면 main과의 차이가 커지고, 충돌은 늦게 발견되며, 기능 통합은 한 번의 큰 이벤트가 된다. 반대로 모든 변경을 즉시 trunk에 넣으면 통합 비용은 낮아지지만, trunk 안정성을 유지하기 위한 테스트와 배포 제어가 강해야 한다.

브랜치 전략은 도구 취향이 아니라 운영 모델의 반영이다. 지속 배포 웹 서비스, 앱스토어 심사가 있는 모바일 앱, 장기 지원 버전을 유지하는 라이브러리는 서로 다른 제약을 가진다. 같은 Git 명령을 쓰더라도 "main은 언제 배포 가능한가", "릴리스 후보를 어디에 고정하는가", "hotfix는 어느 브랜치에서 시작하는가"가 달라진다.

이 문서는 이름 있는 워크플로를 외우는 문서가 아니다. 브랜치 수명과 통합 주기를 기준으로 팀의 비용 구조를 설계하는 문서다.

## 핵심 개념

### 워크플로 선택의 축은 네 가지다

브랜치 전략을 고를 때 먼저 다음 축을 본다.

| 축 | 질문 | 비용이 커지는 조건 |
|---|---|---|
| 브랜치 수명 | feature branch가 몇 시간, 며칠, 몇 주 사는가 | 오래 살수록 merge base가 낡고 충돌이 늦게 발견된다 |
| 통합 주기 | main/trunk에 얼마나 자주 합치는가 | 통합이 드물수록 릴리스 직전 위험이 몰린다 |
| 릴리스 분리 | 배포 후보와 개발 흐름을 분리해야 하는가 | 승인·QA·장기 지원이 있으면 별도 release line이 필요할 수 있다 |
| gate 위치 | 테스트와 리뷰가 어느 ref를 보호하는가 | 사람 기억에 의존하면 정책이 우회된다 |

이 네 축이 정해지면 이름 있는 워크플로는 선택지가 된다. 이름을 먼저 고르면 팀 제약과 맞지 않는 의식만 남을 수 있다.

### trunk-based development는 통합 지연을 줄인다

trunk-based development는 모든 개발자가 짧은 수명의 브랜치 또는 직접 trunk를 통해 자주 통합하는 모델이다. 핵심은 trunk가 항상 배포 가능한 상태에 가깝게 유지된다는 점이다.

```text
main: A <- B <- C <- D <- E
          \     \     \
feature:   b     c     d   짧게 살고 빠르게 통합
```

이 모델이 성립하려면 몇 가지 전제가 필요하다.

- 테스트와 정적 분석이 빠르고 신뢰할 수 있어야 한다.
- incomplete feature는 feature flag나 branch by abstraction으로 숨길 수 있어야 한다.
- PR 크기가 작고 리뷰가 빠르게 돈다.
- main 보호 규칙이 강하고, 실패한 변경을 빠르게 revert할 수 있다.

얻는 것은 통합 리스크 감소다. 충돌은 작을 때 자주 해결되고, main과 멀어진 장기 브랜치가 줄어든다. 포기하는 것은 느슨한 개인 작업 공간이다. 큰 기능을 몇 주 동안 브랜치 안에서만 안정화하는 방식과 잘 맞지 않는다.

### GitHub Flow는 지속 배포 웹 서비스에 잘 맞는다

GitHub Flow는 main, feature branch, pull request, merge, deploy의 단순한 흐름이다. main은 배포 가능한 브랜치로 취급한다.

```text
main:    A <- B <- C <- M <- D
              \       /
feature:       F1 <- F2
```

일반 흐름은 다음과 같다.

1. main에서 짧은 feature branch를 만든다.
2. 커밋을 쌓고 PR을 연다.
3. 리뷰와 CI를 통과한다.
4. main에 merge한다.
5. main 또는 tag를 기준으로 배포한다.

웹 서비스처럼 배포가 자주 가능하고, 한 버전만 운영하는 제품에는 단순성이 큰 장점이다. 그러나 릴리스 승인 절차가 길거나, 여러 버전을 동시에 유지하거나, 고객별 설치형 배포가 있는 제품에는 release branch 보강이 필요하다.

### Git Flow는 릴리스 절차를 브랜치로 표현한다

Git Flow는 `main`, `develop`, `feature/*`, `release/*`, `hotfix/*`를 분리한다. 개발은 develop에 모이고, 릴리스 후보는 release branch로 안정화하며, 배포된 이력은 main에 남긴다.

```text
main:    A -------- R -------- H
          \        / \        /
develop:   B <- C     M <- N
              \       \
release:       r1 <- r2
hotfix:                  h1
```

장점은 역할 분리다. QA 기간이 길고, 버전별 안정화가 필요하며, 배포 승인이 개발 흐름과 분리되어야 하는 조직에는 설명력이 있다. 비용은 장기 브랜치다. develop과 release, main 사이에 변경을 되돌려 합치는 규칙이 복잡해지고, 통합 지연이 커진다.

Git Flow를 쓰더라도 모든 feature branch를 오래 살려도 된다는 뜻은 아니다. feature branch는 짧게, release branch만 필요한 기간 유지하는 식으로 변형하는 팀이 많다.

### PR은 승인 버튼이 아니라 변경 검증 단위다

Pull request는 Git 자체의 객체가 아니다. 호스팅 플랫폼이 두 ref 사이의 diff, 토론, 체크 결과, merge 버튼을 묶어 제공하는 협업 인터페이스다. PR의 본질은 "이 변경을 main에 넣어도 되는가"를 검증하는 단위다.

좋은 PR은 다음 정보를 제공한다.

- 변경 의도와 사용자/운영 영향
- 관련 이슈나 의사결정 기록
- 테스트 증거와 재현 방법
- 위험한 마이그레이션, 설정 변경, 롤백 절차
- 리뷰어가 집중해야 할 설계 지점

커밋 단위와 PR 단위는 다르다. 커밋은 이력과 복구의 단위이고, PR은 리뷰와 통합의 단위다. 작은 커밋 여러 개가 하나의 PR을 이룰 수 있고, squash merge 정책에서는 PR 전체가 main의 커밋 하나가 될 수 있다. 어떤 전략을 쓰든 PR 설명은 사라지지 않는 지식으로 남겨야 한다.

### merge 전략은 이력의 소비자를 결정한다

호스팅 플랫폼은 보통 세 가지 merge 방식을 제공한다.

| 전략 | main 이력 | 장점 | 비용 | 적합한 조건 |
|---|---|---|---|---|
| merge commit | PR 브랜치 커밋과 merge commit 보존 | 맥락과 통합 지점이 남는다 | 그래프가 복잡하다 | 장기 기능, 릴리스 추적, 세부 커밋 보존 필요 |
| squash merge | PR 하나가 main 커밋 하나 | main 이력이 읽기 쉽다 | PR 내부 커밋 해시가 main에서 사라진다 | 작은 PR, 커밋 품질이 들쭉날쭉한 팀 |
| rebase merge | PR 커밋들이 main 위에 선형으로 재생 | 선형 이력과 세부 커밋 보존 | 해시가 바뀌고 충돌 해결 책임이 커진다 | 커밋 단위 품질이 높고 선형 이력을 중시하는 팀 |

선택 기준은 "그래프가 예쁜가"가 아니라 이력의 소비자가 누구인가다. 장애 분석에서 PR 단위로만 보면 충분한 팀은 squash가 좋을 수 있다. 라이브러리처럼 개별 커밋의 API 변경을 추적해야 하는 팀은 merge commit이나 rebase merge가 낫다.

### 정책은 플랫폼 규칙으로 강제한다

팀 규칙이 문서에만 있으면 바쁜 날 우회된다. 반복되는 규칙은 저장소 설정으로 옮긴다.

| 정책 | 플랫폼 기능 | 목적 |
|---|---|---|
| main 직접 push 금지 | protected branch | 리뷰와 CI 우회 방지 |
| 테스트 통과 필수 | required status checks | 깨진 커밋 통합 방지 |
| 소유자 리뷰 필수 | CODEOWNERS | 변경 영역별 책임자 검토 |
| force push 금지 | branch protection | 공개 이력 재작성 방지 |
| 서명 커밋 요구 | signed commits rule | 감사와 공급망 신뢰 |
| PR 템플릿 | pull request template | 위험·테스트·롤백 정보 누락 방지 |

Git 자체는 "main을 보호하라"는 개념을 모른다. 서버 측 훅이나 호스팅 플랫폼 정책이 이를 강제한다. 로컬 훅은 개발자 편의 장치이지 보안 경계가 아니다. 필수 정책은 서버에서 검증해야 한다.

## 실무 관점

### 팀 상황별 기본 선택

| 팀 상황 | 추천 출발점 | 이유 | 보강 |
|---|---|---|---|
| 지속 배포 웹 서비스 | GitHub Flow 또는 trunk-based | main을 자주 배포하고 hotfix가 빠르다 | feature flag, required checks, 빠른 revert |
| 앱스토어 심사 모바일 앱 | GitHub Flow + release branch | 개발과 심사/릴리스 후보를 분리해야 한다 | release branch cherry-pick 규칙 |
| 설치형 제품/장기 지원 | Git Flow 변형 | 버전 라인 유지와 hotfix 추적이 필요하다 | merge-back 정책, 릴리스 태그 |
| 오픈소스 라이브러리 | main + release tag + maintenance branch | API 변경과 버전 기록이 중요하다 | Conventional Commits, signed tag, changelog |
| 초기 소규모 팀 | 단순 GitHub Flow | 규칙 비용을 낮춘다 | PR 템플릿과 main 보호만 먼저 |

전략은 한 번 정하면 끝나는 것이 아니다. 배포 주기, 팀 규모, 장애 대응 요구가 바뀌면 브랜치 전략도 조정해야 한다.

### PR 크기는 리뷰 품질을 결정한다

리뷰가 늦어지는 가장 흔한 이유는 PR이 크기 때문이다. 큰 PR은 리뷰어에게 많은 컨텍스트 로딩 비용을 요구하고, 작성자는 오래 기다리며, main과의 차이는 더 벌어진다.

실무 기준은 숫자 하나로 고정할 수 없다. 대신 다음 신호를 본다.

- 리뷰어가 한 번에 의도를 설명할 수 없는가?
- 테스트 실패 원인을 PR 안에서 좁히기 어려운가?
- revert할 때 관련 없는 변경까지 되돌아가는가?
- 파일 이동, 포매팅, 동작 변경이 한 PR에 섞였는가?

이 신호가 보이면 PR을 나누거나, 먼저 기계적 변경을 merge하고, 그 위에 동작 변경을 올리는 편이 낫다.

### 브랜치 네이밍은 검색성과 자동화를 위해 존재한다

`feature/foo`, `fix/bar`, `release/1.2`, `hotfix/1.2.1` 같은 네이밍은 Git의 필수 규칙이 아니다. 검색, 권한, CI 조건, 배포 자동화의 입력으로 쓰기 위해 존재한다. 네이밍 규칙이 자동화에 연결되지 않는다면 과한 형식이 될 수 있다.

예를 들어 release branch만 배포 파이프라인을 태우고 싶다면:

```text
release/*
hotfix/*
```

같은 패턴이 CI 설정과 보호 규칙의 조건이 된다. 규칙은 사람이 외우기 위해서가 아니라 시스템이 읽기 위해서 설계한다.

## 더 깊이

### 서버 측 훅과 호스팅 플랫폼 정책

Git 서버는 `pre-receive`, `update`, `post-receive` 같은 훅으로 push를 검증할 수 있다. 자체 Git 서버를 운영한다면 이 훅으로 force push 금지, 커밋 메시지 검사, 서명 검사, 특정 경로 보호를 구현할 수 있다. GitHub/GitLab 같은 플랫폼은 이를 UI와 정책 엔진으로 제공한다.

로컬 `pre-commit`이나 `pre-push` 훅은 빠른 피드백에는 좋지만, 개발자가 설치하지 않거나 `--no-verify`로 우회할 수 있다. 따라서 로컬 훅은 "빨리 알려 주는 장치", 서버 정책은 "반드시 지키는 장치"로 역할을 나눈다.

### 코드 리뷰의 내용은 Phase 10으로 이어진다

이 문서는 Git 관점의 리뷰 단위를 다룬다. 코드 품질, 설계 경계, 리팩터링 전략, 리뷰 코멘트의 깊이는 Phase 10에서 다룰 주제다. 여기서 중요한 것은 Git 이력과 PR 정책이 좋은 리뷰를 가능하게 만드는 구조다. 커밋과 PR이 엉켜 있으면 아무리 좋은 리뷰어도 품질 높은 검토를 하기 어렵다.

## 정리

- 브랜치 전략은 이름보다 브랜치 수명, 통합 주기, 릴리스 분리, gate 위치로 판단한다.
- trunk-based development는 통합 지연을 줄이지만 강한 CI와 feature flag 규율이 필요하다.
- GitHub Flow는 지속 배포 서비스에 단순하고, Git Flow는 릴리스 분리가 필요한 제품에 설명력이 있지만 장기 브랜치 비용을 낸다.
- merge commit, squash merge, rebase merge는 이력의 소비자와 장애 분석 방식에 따라 선택해야 한다.
- 팀 규칙은 문서에만 두지 말고 protected branch, required checks, CODEOWNERS 같은 플랫폼 정책으로 강제한다.

## 확인 문제

1. 배포가 하루 여러 번 일어나고 feature flag 인프라가 있는 웹 서비스 팀에 Git Flow를 그대로 적용하면 어떤 비용이 커지는가?

<details>
<summary>정답과 해설</summary>

develop, release, main 사이의 장기 브랜치와 merge-back 비용이 커진다. 이미 자주 배포할 수 있고 feature flag로 미완성 기능을 숨길 수 있다면 긴 release branch 중심 모델은 통합 지연과 절차 비용을 늘릴 수 있다. GitHub Flow나 trunk-based 출발점이 더 단순하다.

</details>

2. squash merge를 기본으로 쓰는 팀에서 `bisect`가 어려워질 수 있는 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

PR 내부의 작은 커밋들이 main 이력에서 하나의 커밋으로 합쳐진다. 회귀가 PR 안의 특정 작은 변경에서 발생해도 main에서는 PR 전체 커밋만 탐색 단위가 된다. PR이 작다면 문제가 적지만, 큰 PR을 squash하면 원인 범위를 좁히기 어렵다.

</details>

3. 로컬 pre-commit 훅으로 테스트를 실행하고 있다. main 보호 규칙의 required checks가 여전히 필요한 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

로컬 훅은 설치되지 않았을 수 있고 `--no-verify`로 우회할 수 있으며, 개발자 환경 차이의 영향을 받는다. 필수 정책은 서버나 호스팅 플랫폼에서 강제해야 한다. 로컬 훅은 빠른 피드백 장치이고, required checks는 통합 ref를 보호하는 gate다.

</details>

## 참고 자료

- [Git Book: Distributed Git - Distributed Workflows](https://git-scm.com/book/en/v2/Distributed-Git-Distributed-Workflows) — 중앙 집중형, 통합 관리자, dictator 모델 등 분산 협업 패턴을 설명한다.
- [trunkbaseddevelopment.com](https://trunkbaseddevelopment.com/) — trunk-based development의 원칙과 branch by abstraction, feature flags 배경을 정리한 자료다.
- [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) — GitHub가 설명하는 main + branch + PR 중심 흐름이다.
- [GitLab Flow](https://docs.gitlab.com/topics/gitlab_flow/) — 환경 브랜치와 릴리스 브랜치를 포함한 변형 워크플로를 확인할 수 있다.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches) — branch protection과 required checks의 정책 계층을 확인할 수 있다.
- [GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — 경로 기반 리뷰 책임자 지정 규칙을 확인할 수 있다.
