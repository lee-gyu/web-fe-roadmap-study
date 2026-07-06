# Phase 7 실습 과제 — Git 이력 복구 리포트와 운영 플레이북

Phase 7 문서 학습과 병행하는 실습 과제다. [학습 기획](../../plan/phase7.md)의 3주 배분과 연동되며, 완성 기준(Definition of Done)을 체크리스트로 명시한다.

이 Phase의 실습은 **시나리오 재현 + 그래프 분석 + 운영 규칙 설계**다. 명령을 성공시키는 것으로 끝내지 않고, 각 단계에서 작업 트리, 인덱스, ref, 커밋 DAG가 어떻게 바뀌었는지 기록한다.

공통 제약:

- 모든 위험 명령(`reset --hard`, rebase, force push, `clean`, GC 관련 명령)은 실습용 임시 저장소에서만 실행한다.
- 각 시나리오마다 시작 그래프, 실행 명령, 결과 그래프, 복구 가능성을 기록한다.
- 그래프는 `git log --graph --oneline --decorate --all`, Mermaid, ASCII 중 하나로 남긴다.
- 커밋 작성자는 실습 저장소 로컬 설정으로 고정한다.

```sh
git config user.name "Phase Seven"
git config user.email "phase7@example.com"
```

## 1주차 — 로컬 저장소 내부 관찰

[7-1](../../docs/phase-7/01-git-mental-model.md), [7-2](../../docs/phase-7/02-objects-refs-and-commits.md), [7-3](../../docs/phase-7/03-staging-diff-and-commit-design.md)와 병행한다.

### 실험 A. 세 영역 상태 전이

- [ ] 빈 저장소를 `git init -b main`으로 만들고 첫 커밋 전후의 `.git` 구조를 비교했다.
- [ ] 같은 파일에 stage된 변경과 stage되지 않은 변경을 동시에 만들고, `git status --short`, `git diff`, `git diff --cached`, `git diff HEAD`의 차이를 기록했다.
- [ ] `git restore --staged`와 `git restore`를 각각 실행하고, 인덱스와 작업 트리 중 무엇이 바뀌었는지 설명했다.

### 실험 B. 객체와 ref 관찰

- [ ] `git cat-file -t`, `git cat-file -p`, `git rev-parse HEAD^{tree}`, `git rev-parse HEAD:path`로 commit/tree/blob 객체를 확인했다.
- [ ] `git show-ref`, `git symbolic-ref HEAD`, `.git/HEAD`를 비교해 `HEAD`와 브랜치 ref의 관계를 설명했다.
- [ ] detached HEAD에서 커밋을 만든 뒤 브랜치를 붙여 보존하고, 브랜치를 붙이지 않았을 때 reflog에서 찾는 절차를 기록했다.

### 실험 C. 의미 단위 커밋 설계

- [ ] 한 파일 안에 서로 다른 의도의 변경을 만들고 `git add -p`로 분리했다.
- [ ] 의미 단위 커밋 5개 이상을 만들고, 각 커밋 메시지에 변경 의도와 판단 근거를 남겼다.
- [ ] 각 커밋이 독립적으로 빌드/테스트 가능한 상태인지 평가했다.

## 2주차 — 충돌·원격·복구 시나리오

[7-4](../../docs/phase-7/04-branching-merging-and-conflicts.md), [7-5](../../docs/phase-7/05-remotes-fetch-pull-push.md), [7-6](../../docs/phase-7/06-rewriting-history-and-recovery.md)와 병행한다.

### 실험 D. merge와 rebase 충돌

- [ ] 같은 시작 그래프에서 fast-forward merge, merge commit, rebase를 각각 수행하고 최종 스냅샷과 이력 모양을 비교했다.
- [ ] 같은 줄을 두 브랜치에서 다르게 수정해 merge 충돌을 만들고, `git ls-files -u`로 stage 1/2/3을 관찰했다.
- [ ] rebase 충돌을 재현하고, 충돌 해결 후 `git rebase --continue`까지 진행했다.
- [ ] 충돌 해결 커밋 또는 rebase 결과에 해결 의도와 실행한 테스트를 기록했다.

### 실험 E. bare remote와 push 거부

- [ ] `git init --bare remote.git`와 clone 2개를 사용해 협업 환경을 만들었다.
- [ ] 한 clone에서 먼저 push한 뒤 다른 clone에서 push해 non-fast-forward 거부를 재현했다.
- [ ] `git fetch`, `git branch -vv`, `git log --graph --oneline --decorate --all`로 ahead/behind와 remote-tracking ref 상태를 설명했다.
- [ ] merge 또는 rebase로 원격 변경을 통합한 뒤 push에 성공했다.
- [ ] 실습용 브랜치에서 `--force`와 `--force-with-lease`의 차이를 재현하고, lease가 실패하는 조건을 기록했다.

### 실험 F. 이력 재작성 사고와 복구

- [ ] `reset --soft`, `reset --mixed`, `reset --hard`를 각각 실행하고 세 영역의 차이를 표로 정리했다.
- [ ] amend 또는 interactive rebase 후 커밋 해시가 바뀌는 것을 확인했다.
- [ ] 잘못된 reset/rebase/force push 중 2개 이상을 reflog, `ORIG_HEAD`, remote-tracking ref, 다른 clone 중 하나로 복구했다.
- [ ] 각 사고에 대해 "손상된 것", "남아 있는 증거", "복구 명령", "복구 후 검증"을 기록했다.

## 3주차 — Git 운영 플레이북

[7-7](../../docs/phase-7/07-collaboration-workflows.md), [7-8](../../docs/phase-7/08-release-debugging-and-repo-operations.md)와 병행한다.

### 실험 G. 팀 상황 정의와 브랜치 전략

다음 중 하나를 선택한다.

- 지속 배포 웹 서비스
- 앱스토어 심사가 있는 모바일 앱
- 장기 버전 유지가 필요한 라이브러리

선택한 상황에 대해 다음을 작성한다.

- [ ] trunk-based development, GitHub Flow, Git Flow 변형 중 하나를 선택하고, 선택하지 않은 대안이 덜 맞는 이유를 표로 설명했다.
- [ ] 기본 브랜치, feature branch 수명, release branch 필요 여부, hotfix 시작점을 정의했다.
- [ ] PR 크기, 리뷰 기준, merge 전략, force push 금지/예외를 문서화했다.
- [ ] protected branch, required checks, CODEOWNERS, PR template 같은 자동화 정책을 어디에 적용할지 정했다.

### 실험 H. 릴리스와 회귀 대응

- [ ] lightweight tag와 annotated tag를 각각 만들고 차이를 `git cat-file`로 확인했다.
- [ ] release branch와 hotfix branch 흐름을 작은 그래프로 재현했다.
- [ ] `git bisect` 또는 `git bisect run`으로 회귀 원인 커밋을 찾는 절차를 수행했다.
- [ ] `git blame`, `git log -S`, `git log -G`, pathspec을 사용해 특정 변경의 도입 지점을 찾았다.
- [ ] worktree, submodule, subtree, Git LFS 중 팀 상황에 필요한 선택지를 검토하고 선택 기준을 남겼다.

## 산출물

### 1. 커밋 그래프 분석 노트

각 실험마다 다음 형식을 사용한다.

````md
## 시나리오 이름

### 시작 상태
- 현재 브랜치:
- 주요 ref:
- 그래프:

### 실행 명령
```sh
git ...
```

### 결과 상태
- 작업 트리:
- 인덱스:
- ref 변화:
- 새로 생긴 커밋:

### 해석
- Git이 자동으로 판단한 것:
- 사람이 결정해야 했던 것:
- 다음에 같은 상황을 줄이는 방법:
````

### 2. 이력 복구 리포트

| 사고 | 손상된 것 | 남아 있는 증거 | 복구 명령 | 복구 후 검증 | 재발 방지 |
|---|---|---|---|---|---|
| reset --hard | 예: 브랜치 끝점 | reflog | `git branch rescue <hash>` | `git log --all` | 위험 전 backup branch |

### 3. Git 운영 플레이북

최종 문서는 다음 항목을 포함한다.

- 팀 상황과 배포 제약
- 기본 브랜치 전략과 브랜치 수명
- 커밋 단위와 메시지 규칙
- PR 크기, 리뷰 기준, merge 전략
- protected branch, required checks, CODEOWNERS 정책
- force push 금지와 예외 승인 절차
- release tag, release branch, hotfix 절차
- 회귀 대응 절차: bisect, revert, cherry-pick, hotfix 선택 기준
- 저장소 운영 기준: LFS, submodule/subtree/worktree, hooks, GC 주의점

## 완성 기준 (Definition of Done)

- [ ] 작업 트리·인덱스·HEAD·브랜치 ref의 차이를 실제 명령 출력으로 설명한 관찰 노트
- [ ] `cat-file`, `ls-files`, `log --graph`를 사용한 객체·인덱스·DAG 분석
- [ ] 의미 단위 커밋 5개 이상과 각 커밋 메시지의 의도 설명
- [ ] merge 충돌과 rebase 충돌을 각각 재현하고 해결한 기록
- [ ] bare remote + clone 2개로 fetch/pull/push, push 거부, force-with-lease 시나리오 재현
- [ ] 잘못된 reset/rebase/force push 중 2개 이상을 reflog 또는 remote ref로 복구한 리포트
- [ ] 팀 상황에 맞는 Git 운영 플레이북 완성(브랜치 전략·PR 정책·릴리스·hotfix·회귀 추적 포함)

## 진행 팁

- 위험 명령을 실행하기 전 `git branch backup/before-<scenario>`를 만드는 습관을 들인다.
- 실습 저장소는 작게 유지한다. 파일은 2~3개면 충분하고, 중요한 것은 그래프와 ref 변화다.
- `git log --graph --oneline --decorate --all` 출력은 모든 시나리오의 공통 증거로 남긴다.
- 복구 성공은 "명령이 에러 없이 끝났다"가 아니라, 원하는 커밋이 ref에서 도달 가능하고 작업 트리와 테스트가 기대 상태임을 확인하는 것이다.
