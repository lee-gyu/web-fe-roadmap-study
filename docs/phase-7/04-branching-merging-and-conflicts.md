# 7-4. 브랜치·merge·충돌

> 한 줄 요약: 이 문서를 읽고 나면 브랜치를 커밋을 가리키는 이동 가능한 포인터로 이해하고, fast-forward, merge commit, 3-way merge, 충돌 해결을 그래프와 인덱스 상태로 설명할 수 있다.

이 문서의 예제는 Git 2.43.0에서 검증했다. merge 전략의 세부 구현은 Git 버전에 따라 개선될 수 있지만, 공통 조상과 두 끝점의 스냅샷을 비교한다는 모델은 같다.

## 학습 목표

- 브랜치 생성과 커밋이 ref를 어떻게 움직이는지 커밋 그래프로 설명할 수 있다.
- fast-forward merge와 merge commit의 차이를 객체 생성 여부와 이력 모양으로 구분할 수 있다.
- 3-way merge가 merge base, ours, theirs 세 스냅샷을 비교한다는 점을 설명할 수 있다.
- 충돌 마커를 해석하고, 해결 결과를 인덱스에 기록하는 절차를 수행할 수 있다.
- `rerere`가 반복 충돌 해결을 어떻게 재사용하며, 어떤 비용을 갖는지 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

브랜치를 "코드 복사본"으로 이해하면 Git merge는 두 폴더를 합치는 작업처럼 보인다. 이 모델은 금방 무너진다. 브랜치 생성이 왜 빠른지, fast-forward에는 왜 새 커밋이 없는지, rebase 중 `ours`와 `theirs`가 왜 헷갈리는지 설명하지 못한다.

[7-2](./02-objects-refs-and-commits.md)에서 본 것처럼 브랜치는 커밋을 가리키는 ref다. 브랜치에서 커밋하면 새 commit 객체가 만들어지고 그 브랜치 ref가 앞으로 이동한다. 두 브랜치가 같은 커밋에서 출발해 서로 다른 커밋을 만들면 DAG가 갈라진다. merge는 갈라진 두 끝점의 변경을 공통 조상 기준으로 합쳐 새 스냅샷을 만드는 작업이다.

이 문서에서 중요한 것은 충돌을 "Git이 실패한 상황"으로 보지 않는 것이다. 충돌은 Git이 자동으로 최종 의도를 판단할 수 없다는 신호다. Git은 세 스냅샷을 비교해 안전하게 합칠 수 있는 부분은 합치고, 같은 위치의 경쟁 변경처럼 의도가 필요한 부분은 개발자에게 넘긴다.

## 핵심 개념

### 브랜치는 커밋을 가리키는 이동 가능한 ref다

작은 그래프를 만든다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

printf "base\n" > app.txt
git add app.txt
git commit -m "Base"

git branch feature
git show-ref --heads
```

`main`과 `feature`는 같은 커밋을 가리킨다.

```text
A  main, feature
```

`feature`로 이동해 커밋하면 `feature`만 움직인다.

```sh
git switch feature
printf "feature\n" >> app.txt
git add app.txt
git commit -m "Add feature line"

git log --graph --oneline --decorate --all
```

그래프는 다음과 같다.

```text
A <- B  feature
^
main
```

브랜치가 파일 복사본이라면 생성할 때 전체 파일을 복제해야 한다. Git의 브랜치는 ref 하나이므로 가볍다. 무거운 것은 브랜치가 오래 살아서 통합해야 할 변경이 많아질 때 발생하는 사회적·통합 비용이다.

### fast-forward는 ref 이동만으로 끝난다

`main`이 `feature`의 조상이라면 merge는 새 커밋 없이 `main` ref를 `feature`가 가리키는 커밋으로 이동할 수 있다.

```sh
git switch main
git merge feature
git log --graph --oneline --decorate --all
```

이 경우 Git은 fast-forward를 수행한다.

```text
A <- B  main, feature
```

fast-forward는 통합 커밋을 남기지 않는다. 이력은 단순하지만 "feature 브랜치를 main에 통합했다"는 사건은 별도 커밋으로 남지 않는다. 작은 변경과 짧은 브랜치에는 자연스럽다. 릴리스나 큰 기능처럼 통합 사건 자체가 의미 있다면 `--no-ff`로 merge commit을 남길 수 있다.

### merge commit은 두 부모를 가진다

두 브랜치가 모두 앞으로 간 상태를 만든다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

printf "base\n" > app.txt
git add app.txt
git commit -m "Base"

git switch -c feature
printf "feature\n" >> app.txt
git add app.txt
git commit -m "Feature"

git switch main
printf "main\n" >> main.txt
git add main.txt
git commit -m "Main"

git merge feature -m "Merge feature"
git cat-file -p HEAD
git log --graph --oneline --decorate --all
```

merge commit에는 `parent`가 두 줄 있다. 첫 번째 부모는 merge를 실행한 현재 브랜치의 끝점, 두 번째 부모는 병합 대상 브랜치의 끝점이다. 최종 스냅샷은 두 브랜치의 변경이 합쳐진 결과다.

```text
      C  feature
     / \
A <- B  M  main
```

실제 방향은 자식이 부모를 가리키지만, 사람이 그릴 때는 시간 흐름을 왼쪽에서 오른쪽으로 그리는 경우가 많다. 중요한 것은 `M`이 두 부모를 가진다는 점이다.

### 3-way merge는 공통 조상을 기준으로 한다

Git이 merge할 때 보는 것은 단순히 "현재 파일"과 "상대 파일" 두 개가 아니다. 공통 조상(merge base), ours, theirs 세 스냅샷이다.

| 이름 | 의미 |
|---|---|
| merge base | 두 브랜치가 갈라지기 전의 공통 조상 |
| ours | merge를 실행한 현재 브랜치의 스냅샷 |
| theirs | merge 대상 브랜치의 스냅샷 |

공통 조상에서 `line`이 있었고, ours는 그 줄을 `main`으로 바꾸고, theirs는 `feature`로 바꿨다면 Git은 의도를 판단할 수 없다. 같은 기준에서 같은 위치를 서로 다르게 바꿨기 때문이다.

충돌을 재현한다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

printf "title: base\n" > config.txt
git add config.txt
git commit -m "Base config"

git switch -c feature
printf "title: feature\n" > config.txt
git add config.txt
git commit -m "Change title in feature"

git switch main
printf "title: main\n" > config.txt
git add config.txt
git commit -m "Change title in main"

git merge feature || true
cat config.txt
git ls-files -u
```

파일에는 충돌 마커가 들어간다.

```text
<<<<<<< HEAD
title: main
=======
title: feature
>>>>>>> feature
```

이 마커는 "둘 중 하나를 고르라"는 뜻만은 아니다. 최종 스냅샷은 `title: main feature`처럼 둘을 조합할 수도 있고, 제3의 값이 될 수도 있다. 개발자의 역할은 의도한 최종 파일을 만드는 것이다.

### 충돌 해결은 인덱스에 최종 스냅샷을 올리는 일이다

충돌 파일을 편집해 최종 상태를 만든다.

```sh
printf "title: resolved\n" > config.txt
git add config.txt
git status --short
git commit -m "Merge feature"
```

`git add` 후 `git ls-files -u`가 비어 있으면 충돌 stage가 해결된 것이다. Git은 충돌 마커가 없어졌는지만 보는 것이 아니라, 해당 경로의 stage 0 인덱스 엔트리가 생겼는지를 본다.

merge 중 중단하려면 다음을 쓴다.

```sh
git merge --abort
```

`--abort`는 merge 시작 전 상태로 돌아가려는 명령이다. 작업 트리에 merge 전부터 있던 미커밋 변경이 섞여 있으면 복원이 복잡해질 수 있으므로, 큰 merge 전에는 작업 트리를 깨끗하게 두거나 임시 커밋·stash로 안전 지점을 만드는 편이 좋다.

### rebase 중 `ours`와 `theirs`는 직관과 어긋날 수 있다

merge에서 ours는 현재 브랜치, theirs는 대상 브랜치다. rebase는 현재 브랜치의 커밋을 새 base 위에 하나씩 재생한다. 충돌 시점의 ours는 새 base 쪽이고, theirs는 재생 중인 커밋 쪽처럼 보일 수 있다. 이 때문에 `checkout --ours`와 `checkout --theirs`를 기계적으로 쓰면 의도와 반대 결과가 나올 수 있다.

현대 Git에서는 파일 단위 선택보다 충돌 마커를 읽고 최종 파일을 직접 만드는 습관이 더 안전하다.

```sh
git status
git diff
# 파일을 편집해 최종 상태를 만든다
git add conflicted-file.txt
git rebase --continue
```

rebase 자체의 그래프 변화는 [7-6](./06-rewriting-history-and-recovery.md)에서 자세히 다룬다.

## 실무 관점

### merge commit과 선형 이력은 서로 다른 비용을 낸다

| 전략 | 얻는 것 | 포기하는 것 | 무너지는 조건 |
|---|---|---|---|
| fast-forward | 이력이 단순하고 새 커밋이 없다 | 통합 사건이 남지 않는다 | 기능 브랜치의 통합 단위를 추적해야 할 때 |
| merge commit | 브랜치 통합 사실과 실제 병합 시점을 보존한다 | 그래프가 복잡해질 수 있다 | 너무 작은 PR마다 merge commit이 쌓일 때 |
| rebase 후 fast-forward | main 이력이 선형이다 | 커밋 해시가 바뀌고 충돌을 커밋마다 다시 풀 수 있다 | 공개 브랜치를 재작성하거나 충돌이 큰 장기 브랜치일 때 |
| squash merge | main에 PR 하나당 커밋 하나만 남는다 | PR 내부 커밋의 추적성이 사라진다 | bisect와 cherry-pick이 작은 커밋 단위를 필요로 할 때 |

정답은 없다. 배포 주기, 리뷰 문화, 장애 대응 방식이 선택을 결정한다. 핵심은 팀이 한 가지 기본 전략을 정하고, 예외를 문서화하는 것이다. 팀 정책은 [7-7](./07-collaboration-workflows.md)에서 다룬다.

### 충돌은 늦게 발견할수록 비싸다

브랜치가 오래 살아 있을수록 merge base와 현재 main 사이의 거리가 길어진다. 충돌 가능성은 단순히 줄 수로 결정되지 않는다. 같은 설계 지점을 서로 다르게 바꾸면 작은 diff도 큰 충돌이 된다. 충돌 비용을 줄이는 방법은 충돌 해결 도구보다 통합 주기를 줄이는 것이다.

실무에서 효과적인 습관은 다음과 같다.

- 기능 브랜치를 짧게 유지하고 자주 main을 가져온다.
- 리팩터링과 기능 변경을 분리해 충돌 범위를 줄인다.
- 큰 파일 하나에 여러 책임이 모이지 않게 모듈 경계를 관리한다.
- 충돌 해결 후에는 관련 테스트를 실행하고, 해결 의도를 커밋 메시지나 PR에 남긴다.

### `rerere`는 반복 충돌 해결 캐시다

`rerere`는 reuse recorded resolution의 약자다. 같은 충돌 형태를 다시 만나면 과거 해결 결과를 재사용한다.

```sh
git config rerere.enabled true
```

장기 브랜치를 반복해서 rebase하거나, 여러 릴리스 브랜치에 같은 패치를 적용하는 팀에서는 유용할 수 있다. 하지만 잘못된 해결도 재사용될 수 있다. `rerere`는 의도 판단을 대신하지 않는다. 충돌 해결 후 테스트와 리뷰가 여전히 필요하다.

## 더 깊이

### merge base가 여러 개일 수 있다

단순한 그래프에서는 공통 조상이 하나처럼 보인다. 그러나 복잡한 criss-cross merge 이력에서는 merge base 후보가 여러 개일 수 있다. Git은 재귀적 전략 또는 현재 기본 전략인 `ort`를 통해 가상 merge base를 구성해 병합한다. 사용자가 매번 이를 직접 다룰 일은 드물지만, "공통 조상 하나를 기준으로만 계산한다"는 단순화가 항상 물리적으로 맞지는 않다는 점은 알아야 한다.

공식 명령으로 현재 merge base를 확인할 수 있다.

```sh
git merge-base main feature
```

충돌이 예상보다 이상하게 보일 때는 merge base와 양쪽 diff를 직접 비교한다.

```sh
base=$(git merge-base main feature)
git diff "$base"..main
git diff "$base"..feature
```

### rename 충돌은 스냅샷 비교와 유사도 추론의 결합이다

Git은 리네임을 별도 객체로 저장하지 않는다. merge나 diff 시점에 삭제된 파일과 새 파일의 유사도를 보고 리네임을 추론한다. 한 브랜치가 파일을 이동하고 다른 브랜치가 내용을 크게 바꾸면 추론이 어려워질 수 있다. 그래서 대규모 이동과 내용 변경을 별도 커밋으로 나누는 것이 중요하다.

## 정리

- 브랜치는 커밋을 가리키는 ref이며, 커밋할 때 현재 브랜치 ref가 새 커밋으로 이동한다.
- fast-forward는 새 커밋 없이 ref만 앞으로 이동하는 merge다.
- merge commit은 두 부모 이상을 가진 커밋으로, 통합 사건을 이력에 남긴다.
- 3-way merge는 merge base, ours, theirs 세 스냅샷을 비교해 최종 스냅샷을 만든다.
- 충돌 해결은 충돌 마커를 지운 파일을 인덱스 stage 0에 올리는 작업이며, 해결 의도와 테스트가 함께 필요하다.

## 확인 문제

1. `main`이 `feature`의 조상일 때 `git merge feature`는 왜 새 커밋을 만들지 않을 수 있는가?

<details>
<summary>정답과 해설</summary>

`main` ref를 `feature`가 가리키는 커밋으로 이동하기만 해도 `feature`의 모든 커밋이 `main`에 포함된다. 새 스냅샷을 계산할 필요가 없으므로 fast-forward가 가능하다. 객체 생성은 없고 ref 이동만 일어난다.

</details>

2. merge 충돌 파일에서 충돌 마커를 삭제했지만 `git status`가 여전히 unmerged 상태라고 한다. 무엇이 빠졌는가?

<details>
<summary>정답과 해설</summary>

최종 파일을 인덱스에 올리는 `git add`가 빠졌다. Git은 작업 트리 파일의 마커 존재만으로 해결 여부를 판단하지 않는다. 충돌 중 인덱스의 stage 1, 2, 3 엔트리를 최종 stage 0 엔트리로 바꾸어야 해결된 것으로 본다.

</details>

3. merge commit을 남기는 전략과 rebase 후 fast-forward 전략 중 어느 쪽이 항상 우월한가?

<details>
<summary>정답과 해설</summary>

항상 우월한 쪽은 없다. merge commit은 통합 사실과 브랜치 맥락을 보존하지만 그래프가 복잡해질 수 있다. rebase 후 fast-forward는 이력을 선형으로 만들지만 커밋 해시를 새로 만들고 공개 이력 재작성 위험을 갖는다. 팀의 배포 방식, 리뷰 단위, 장애 분석 요구에 따라 선택해야 한다.

</details>

## 참고 자료

- [git-branch manual](https://git-scm.com/docs/git-branch) — 브랜치 ref 생성과 관리 옵션을 확인할 수 있다.
- [git-merge manual](https://git-scm.com/docs/git-merge) — fast-forward, merge commit, 충돌 처리, merge 전략을 설명한다.
- [git-merge-base manual](https://git-scm.com/docs/git-merge-base) — 공통 조상을 찾는 명령의 공식 문서다.
- [git-rerere manual](https://git-scm.com/docs/git-rerere) — 반복 충돌 해결 재사용 기능의 동작과 주의점을 확인할 수 있다.
- [Git Book: Branching and Merging](https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging) — 브랜치와 merge의 기본 그래프를 단계별로 설명한다.
