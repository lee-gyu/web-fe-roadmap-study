# 7-8. 릴리스·디버깅·저장소 운영

> 한 줄 요약: 이 문서를 읽고 나면 Git 이력을 개발 중 변경 관리뿐 아니라 릴리스 식별, 회귀 추적, hotfix, 대형 저장소 운영의 관측 데이터로 활용할 수 있다.

이 문서의 예제는 Git 2.43.0에서 검증했다. Git LFS, 서명 정책, 호스팅 플랫폼 릴리스 기능은 조직의 보안·배포 환경에 따라 설정 방식이 달라지므로, 여기서는 Git 모델과 선택 기준에 집중한다.

## 학습 목표

- lightweight tag와 annotated tag의 차이를 릴리스 감사 관점에서 설명할 수 있다.
- release branch와 hotfix branch를 커밋 그래프 관점에서 운용할 수 있다.
- `git bisect`, `git blame`, `git log --graph`, pickaxe(`-S`, `-G`)를 회귀 분석 도구로 사용할 수 있다.
- worktree, submodule, subtree, Git LFS의 선택 기준과 경계 조건을 비교할 수 있다.
- packfile, GC, reflog 만료가 복구 가능성과 저장소 운영에 미치는 영향을 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

Git은 개발 중 변경을 저장하는 도구로 시작하지만, 실무에서는 운영 관측 데이터가 된다. 어떤 릴리스가 배포되었는가, 버그가 언제 들어왔는가, hotfix가 어느 버전 라인에 들어갔는가, 큰 바이너리가 왜 저장소를 느리게 만들었는가 같은 질문은 모두 Git 이력을 읽어야 답할 수 있다.

Phase 7 앞 문서들이 개인 작업과 협업 ref를 다뤘다면, 이 문서는 이력을 운영 자산으로 쓰는 방법을 다룬다. 좋은 이력은 코드 품질의 부산물이 아니라, 회귀 추적과 릴리스 재현을 가능하게 하는 시스템 일부다. 반대로 커밋 단위가 엉키고 tag가 부정확하며 release branch 규칙이 없으면, 장애가 났을 때 "무엇을 되돌릴지"부터 불명확해진다.

## 핵심 개념

### tag는 움직이지 않는 릴리스 이름이어야 한다

브랜치는 움직이는 ref다. `main`은 오늘과 내일 다른 커밋을 가리킨다. 릴리스 식별자는 움직이면 안 된다. 그래서 릴리스에는 tag를 쓴다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

printf "version 1\n" > app.txt
git add app.txt
git commit -m "Release candidate"

git tag v1.0.0
git tag -a v1.0.1 -m "Release v1.0.1"

git cat-file -t v1.0.0
git cat-file -t v1.0.1
git cat-file -p v1.0.1
```

lightweight tag는 ref가 커밋을 직접 가리킨다. annotated tag는 tag 객체를 만들고 메시지, tagger, 선택적 서명 정보를 담는다. 릴리스 기록에는 annotated tag가 더 적합하다.

| tag 종류 | 저장 구조 | 장점 | 한계 |
|---|---|---|---|
| lightweight | `refs/tags/<name>`이 객체를 직접 가리킴 | 간단한 로컬 표시 | 메시지·서명·작성자 정보가 없다 |
| annotated | tag 객체가 대상 객체를 가리킴 | 릴리스 메시지와 서명 가능 | 객체 하나가 더 생긴다 |
| signed tag | annotated tag에 GPG/SSH 서명 | 공급망 감사에 유리 | 키 관리와 검증 절차 필요 |

tag는 기술적으로 삭제와 재생성이 가능하지만, 공개 릴리스 tag를 움직이는 것은 배포 재현성을 깨는 행위다. 잘못 찍은 tag는 삭제보다 새 patch 버전을 발행하는 편이 안전한 경우가 많다.

### release branch와 hotfix는 버전 라인을 유지한다

지속 배포 서비스는 main에서 바로 배포하고 문제가 생기면 revert할 수 있다. 하지만 특정 버전 라인을 유지해야 하는 제품은 release branch가 필요할 수 있다.

```text
main:       A <- B <- C <- D <- E
                 \
release/1.0:      R1 <- H1 <- H2
```

`release/1.0`은 1.0 계열의 안정화와 hotfix를 담는다. main은 다음 개발을 계속한다. hotfix가 release branch에만 들어가면 main에는 같은 버그가 남을 수 있다. 따라서 hotfix 후에는 main으로 merge-back하거나 cherry-pick하는 규칙이 필요하다.

```sh
git switch release/1.0
git cherry-pick -x <fix-commit>
git tag -a v1.0.2 -m "Release v1.0.2"

git switch main
git cherry-pick -x <fix-commit>
```

`-x`는 원본 커밋 해시를 메시지에 남긴다. 여러 버전 라인에 같은 수정이 들어갈 때 추적에 도움이 된다.

release branch의 비용은 중복 변경 관리다. 장기 지원 버전이 많을수록 hotfix 적용 여부, 충돌 해결, 테스트 매트릭스가 늘어난다. 이 비용을 감당할 운영 이유가 없다면 단순한 tag 중심 릴리스가 낫다.

### bisect는 회귀를 이진 탐색한다

`git bisect`는 좋은 커밋과 나쁜 커밋 사이에서 원인 커밋을 이진 탐색한다. 좋은 커밋 단위가 중요한 이유를 가장 직접적으로 보여 주는 도구다.

```sh
git bisect start
git bisect bad HEAD
git bisect good v1.0.0

# Git이 checkout한 커밋에서 테스트한다
pnpm test
git bisect good   # 테스트 통과
# 또는
git bisect bad    # 테스트 실패

git bisect reset
```

테스트 명령이 명확하면 자동화할 수 있다.

```sh
git bisect start HEAD v1.0.0
git bisect run pnpm test
git bisect reset
```

`bisect run`은 명령 exit code로 good/bad를 판정한다. 테스트가 flaky하면 bisect 결과도 흔들린다. 중간 커밋이 빌드 불가능한 상태라면 탐색이 막힌다. 그래서 [7-3](./03-staging-diff-and-commit-design.md)의 "각 커밋이 의미 있고 빌드 가능한 상태" 원칙이 운영 디버깅으로 이어진다.

### blame은 책임 추궁보다 맥락 탐색 도구다

`git blame`은 각 줄이 마지막으로 변경된 커밋을 보여 준다.

```sh
git blame -- app.txt
```

좋은 사용법은 "누가 잘못했는가"가 아니라 "이 줄이 어떤 맥락에서 들어왔는가"를 찾는 것이다. blame 결과의 커밋을 열고 PR, 이슈, 테스트 변경을 함께 본다.

```sh
git show <commit>
git log --follow -- path/to/file
```

대규모 포매팅이나 파일 이동이 blame을 오염시킬 수 있다. Git은 ignore-revs 파일로 특정 커밋을 blame에서 숨길 수 있다.

```sh
printf "<formatting-commit-hash>\n" > .git-blame-ignore-revs
git blame --ignore-revs-file .git-blame-ignore-revs -- app.txt
```

이 파일을 저장소에 커밋하고 팀 도구에 설정하면, 포매팅 커밋이 맥락 탐색을 방해하는 비용을 줄일 수 있다.

### log 검색은 그래프와 pathspec, pickaxe를 조합한다

이력 조사는 `git log` 옵션을 조합하는 일이다.

```sh
git log --graph --oneline --decorate --all
git log -- path/to/file
git log --follow -- path/to/file
git log -S "oldFunctionName" -- src
git log -G "fetch\\(" -- src
```

`-S`는 특정 문자열의 등장 횟수를 바꾼 커밋을 찾는다. 이를 pickaxe라고 부른다. `-G`는 diff의 추가/삭제 줄이 정규식과 맞는 커밋을 찾는다. API 이름이 언제 도입되었는지, 특정 조건문이 언제 바뀌었는지 찾을 때 유용하다.

`-- pathspec`은 경로 범위를 제한한다. 대형 저장소에서는 검색 범위를 좁히는 것이 성능과 신호 품질 모두에 중요하다.

### worktree는 객체 데이터베이스를 공유하는 여러 작업 트리다

hotfix 중에 현재 작업 브랜치를 stash하지 않고 다른 브랜치를 열고 싶을 때가 있다. `git worktree`는 하나의 저장소 객체 데이터베이스를 공유하면서 여러 작업 트리를 만든다.

```sh
git worktree add ../project-hotfix main
cd ../project-hotfix
git switch -c hotfix/login-crash
```

장점은 빠른 문맥 전환이다. 현재 작업 트리를 건드리지 않고 release branch나 main을 별도 디렉터리에서 열 수 있다. 비용은 관리 복잡도다. 같은 브랜치를 두 worktree에서 동시에 checkout할 수 없고, 작업 트리가 늘수록 어떤 디렉터리가 어떤 브랜치인지 추적해야 한다.

```sh
git worktree list
git worktree remove ../project-hotfix
```

### submodule, subtree, monorepo는 소유권 문제다

외부 저장소를 포함하는 방법은 여러 가지다.

| 선택 | 모델 | 장점 | 비용 | 적합한 조건 |
|---|---|---|---|---|
| submodule | 상위 저장소가 하위 저장소의 특정 커밋을 가리킴 | 의존 저장소 이력을 분리 | clone/update UX가 어렵고 detached HEAD가 흔함 | 독립 배포되는 외부 프로젝트를 고정 버전으로 포함 |
| subtree | 외부 저장소 내용을 상위 이력 안에 병합 | 사용자는 일반 파일처럼 다룸 | 이력과 동기화 명령이 복잡 | 외부 코드를 vendoring하되 사용 경험을 단순화 |
| monorepo | 한 저장소에 여러 패키지 | 원자적 변경과 공유 도구 | clone/CI/권한/빌드 규모 비용 | 강한 내부 소유권과 통합 빌드가 필요한 조직 |

"submodule은 무조건 나쁘다"보다 중요한 것은 소유권이다. 외부 프로젝트를 독립적으로 추적해야 한다면 submodule이 맞을 수 있다. 팀 대부분이 하위 저장소까지 함께 수정해야 한다면 submodule은 작업 흐름을 방해할 가능성이 크다.

### Git LFS는 대형 바이너리를 포인터로 바꾼다

Git은 텍스트 소스와 작은 바이너리에는 강하지만, 자주 바뀌는 대형 바이너리를 일반 객체로 저장하면 저장소가 빠르게 커진다. Git LFS는 저장소에는 포인터 파일을 커밋하고 실제 대형 객체는 별도 LFS 저장소에 둔다.

```sh
git lfs track "*.psd"
git add .gitattributes
git add design.psd
git commit -m "Track design asset with LFS"
```

장점은 clone과 packfile 부담을 줄이는 것이다. 비용은 별도 서버, 대역폭, 인증, 백업 정책이다. 프론트엔드에서 큰 이미지 원본, 영상, 디자인 파일을 저장소에 포함해야 한다면 LFS를 검토할 수 있다. 빌드 산출물이나 패키지 tarball처럼 재현 가능한 결과물은 LFS보다 아티팩트 저장소가 더 적합할 수 있다.

## 실무 관점

### 릴리스 절차는 ref 규칙으로 문서화한다

Git 운영 플레이북에는 최소한 다음을 적어야 한다.

| 항목 | 결정 예시 |
|---|---|
| 릴리스 기준 | `main`의 annotated tag만 배포한다 |
| 버전 tag | `vMAJOR.MINOR.PATCH` 형식, tag 재사용 금지 |
| release branch | `release/x.y`는 patch 지원 기간 동안 유지한다 |
| hotfix 시작점 | 배포 tag 또는 release branch에서 시작한다 |
| main 반영 | hotfix는 main으로 cherry-pick 또는 merge-back한다 |
| 검증 | tag 생성 전 required checks와 smoke test 통과 |
| rollback | 새 revert 커밋 또는 이전 tag 재배포 중 제품별 기준 |

이 규칙이 없으면 장애 중에 "어느 브랜치에서 고칠지"를 회의해야 한다. 장애 상황에서 설계를 시작하지 않기 위해 플레이북을 미리 둔다.

### 이력 조사 명령은 사고 대응 루틴으로 묶는다

회귀가 들어온 상황에서의 기본 루틴:

```sh
git fetch --all --tags
git log --graph --oneline --decorate --all --max-count=50
git log v1.2.3..HEAD -- path/to/suspect
git bisect start HEAD v1.2.3
git bisect run pnpm test
```

결과 커밋을 찾은 뒤에는 `show`, PR, issue, 배포 기록을 연결한다.

```sh
git show --stat <bad-commit>
git show <bad-commit>
```

이 흐름을 팀 문서에 남겨야 새로 온 개발자도 같은 방식으로 사고를 조사할 수 있다.

## 더 깊이

### packfile, GC, reflog 만료는 복구 기간을 결정한다

새 객체는 처음에 loose object로 저장될 수 있고, 시간이 지나거나 `git gc`가 실행되면 packfile로 묶인다. packfile은 객체를 압축하고 delta를 사용해 저장 공간을 줄인다. 도달 불가능한 객체는 reflog 만료와 prune 정책에 따라 정리될 수 있다.

```sh
git count-objects -v
git gc
git count-objects -v
```

복구 관점에서 중요한 것은 "커밋이 영원히 남는다"가 아니라 "어떤 ref나 reflog에서 도달 가능한 동안 남을 가능성이 높다"이다. [7-6](./06-rewriting-history-and-recovery.md)에서 본 복구 전략이 시간 제한을 갖는 이유가 여기 있다.

### signed commit은 신원 주장이고, 배포 신뢰는 절차 전체다

서명된 커밋이나 tag는 "이 키의 소유자가 이 객체에 서명했다"는 증거를 제공한다. 그러나 키 소유자 검증, 키 회전, CI provenance, artifact 서명, 배포 권한이 함께 설계되지 않으면 공급망 보안을 완성하지 못한다. Git 서명은 중요한 조각이지만 전체 배포 보안의 대체물이 아니다.

```sh
git tag -s v1.0.0 -m "Release v1.0.0"
git verify-tag v1.0.0
```

조직에서 signed commit을 요구한다면 개발자 온보딩, 키 관리, 자동화 계정 서명 방식을 함께 정해야 한다.

### hooks는 로컬 편의와 서버 정책으로 나뉜다

로컬 hooks:

```text
.git/hooks/pre-commit
.git/hooks/pre-push
```

로컬 훅은 빠른 피드백을 준다. 포맷, 린트, 간단한 테스트를 commit 전에 실행할 수 있다. 그러나 저장소에 기본으로 versioning되지 않고 우회 가능하다. Husky, lefthook 같은 도구는 설치를 표준화하지만, 필수 보안 경계가 되지는 않는다.

서버 훅이나 플랫폼 보호 규칙은 push 자체를 거부할 수 있다. main 보호, signed commit 요구, required checks는 이 계층에 있어야 한다.

## 정리

- 릴리스 식별자는 움직이는 브랜치보다 tag가 적합하며, 감사가 필요하면 annotated 또는 signed tag를 사용한다.
- release branch와 hotfix는 버전 라인을 유지하는 도구지만, 중복 변경과 merge-back 비용을 만든다.
- `git bisect`, `blame`, `log -S/-G`는 Git 이력을 운영 디버깅 데이터로 사용하는 핵심 도구다.
- worktree, submodule, subtree, Git LFS는 저장소 소유권과 규모 문제에 대한 서로 다른 선택지다.
- packfile, GC, reflog 만료는 이력 복구 가능 기간과 저장소 운영 비용을 결정한다.

## 확인 문제

1. 릴리스에 브랜치 이름 `main`만 기록하고 tag를 남기지 않으면 어떤 문제가 생기는가?

<details>
<summary>정답과 해설</summary>

`main`은 계속 움직이는 ref다. 시간이 지나면 해당 릴리스가 정확히 어떤 커밋에서 만들어졌는지 재현하기 어렵다. 릴리스에는 움직이지 않는 tag나 커밋 해시를 기록해야 한다. 감사와 메시지가 필요하면 annotated tag가 적합하다.

</details>

2. `git bisect`가 중간에 빌드 불가능한 커밋을 계속 만나면 무엇이 문제이고, 커밋 설계와 어떤 관련이 있는가?

<details>
<summary>정답과 해설</summary>

각 커밋이 독립적으로 검증 가능한 상태가 아니라는 뜻이다. bisect는 커밋 단위로 good/bad를 판정하므로 중간 커밋이 자주 깨지면 검색 공간이 오염된다. 의미 단위 커밋은 리뷰뿐 아니라 회귀 탐색의 품질도 결정한다.

</details>

3. 대형 디자인 원본 파일을 저장소에 계속 커밋하고 있어 clone이 느려졌다. Git LFS가 해결할 수 있는 것과 해결하지 못하는 것은 무엇인가?

<details>
<summary>정답과 해설</summary>

Git LFS는 저장소에는 포인터 파일을 두고 실제 대형 객체를 별도 저장소에 저장하므로 Git 객체와 packfile 부담을 줄일 수 있다. 그러나 별도 서버, 대역폭, 인증, 백업 정책이 필요하고, 이미 일반 Git 객체로 들어간 과거 대형 파일은 이력 정리 없이는 사라지지 않는다. 재현 가능한 빌드 산출물이라면 LFS보다 아티팩트 저장소가 더 적합할 수 있다.

</details>

## 참고 자료

- [git-tag manual](https://git-scm.com/docs/git-tag) — lightweight, annotated, signed tag의 생성과 검증 옵션을 확인할 수 있다.
- [git-bisect manual](https://git-scm.com/docs/git-bisect) — 회귀 원인 커밋을 이진 탐색하는 명령의 공식 문서다.
- [git-blame manual](https://git-scm.com/docs/git-blame) — 줄 단위 이력 조사와 ignore-revs 옵션을 확인할 수 있다.
- [git-log manual](https://git-scm.com/docs/git-log) — 그래프 출력, pathspec, pickaxe(`-S`, `-G`) 검색을 확인할 수 있다.
- [git-worktree manual](https://git-scm.com/docs/git-worktree) — 여러 작업 트리를 하나의 저장소와 연결하는 방식과 제약을 설명한다.
- [git-submodule manual](https://git-scm.com/docs/git-submodule) — submodule의 데이터 모델과 명령을 확인할 수 있다.
- [Git LFS](https://git-lfs.com/) — 대형 파일을 Git 외부 객체 저장소로 관리하는 공식 프로젝트다.
- [git-gc manual](https://git-scm.com/docs/git-gc) — packfile 정리, unreachable object 정리, reflog 만료와 관련된 동작을 확인할 수 있다.
