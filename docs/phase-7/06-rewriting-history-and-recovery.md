# 7-6. 이력 재작성과 복구

> 한 줄 요약: 이 문서를 읽고 나면 `reset`, `restore`, `revert`, `commit --amend`, `cherry-pick`, `rebase`가 각각 어떤 영역과 커밋 그래프를 바꾸는지 구분하고, reflog를 이용해 복구 가능성을 판단할 수 있다.

이 문서의 예제는 Git 2.43.0에서 검증했다. 위험 명령은 반드시 실습용 저장소에서 실행해야 하며, 실제 업무 저장소에서는 실행 전 백업 브랜치나 tag를 남기는 습관을 둔다.

## 학습 목표

- "되돌리기"를 작업 트리 복구, 인덱스 복구, ref 이동, 새 되돌림 커밋 생성으로 나눠 설명할 수 있다.
- `reset --soft`, `reset --mixed`, `reset --hard`가 HEAD/ref, 인덱스, 작업 트리 중 무엇을 바꾸는지 구분할 수 있다.
- `commit --amend`, rebase, cherry-pick이 기존 커밋을 수정하는 것이 아니라 새 커밋을 만들 수 있음을 설명할 수 있다.
- reflog, `ORIG_HEAD`, remote-tracking ref를 이용해 이름을 잃은 커밋을 복구할 수 있다.
- 개인 이력 정리와 공개 이력 재작성의 비용 차이를 판단할 수 있다.

## 배경: 왜 이것이 존재하는가

Git에서 가장 위험한 단어는 "되돌린다"일 수 있다. 작업 트리 파일을 되돌리는 것, stage를 내리는 것, 브랜치 ref를 과거 커밋으로 옮기는 것, 이미 공개한 버그를 반대로 적용하는 새 커밋을 만드는 것은 모두 다르다. 그런데 일상 대화에서는 전부 "rollback", "undo", "revert"로 섞인다.

[7-1](./01-git-mental-model.md)의 세 영역과 [7-2](./02-objects-refs-and-commits.md)의 ref 모델을 결합하면 위험 명령의 의미가 단순해진다. `reset`은 주로 현재 브랜치 ref를 움직인다. `restore`는 작업 트리나 인덱스를 특정 기준으로 복사한다. `revert`는 기존 커밋을 지우지 않고 반대 변경을 담은 새 커밋을 만든다. `rebase`는 기존 커밋들을 다른 base 위에 새 커밋으로 재생하고 브랜치 ref를 옮긴다.

복구 가능성도 같은 모델로 판단한다. 커밋 객체가 만들어졌고 reflog나 다른 ref가 한동안 그 해시를 기억한다면 복구 가능성이 높다. 한 번도 stage나 commit되지 않은 작업 트리 변경을 `reset --hard`로 잃었다면 Git 자체에는 복구 근거가 거의 없다.

## 핵심 개념

### 되돌리기는 네 계층으로 나뉜다

| 목적 | 대표 명령 | 바꾸는 것 | 기존 커밋 보존 |
|---|---|---|---|
| 작업 트리 파일을 기준 상태로 복구 | `git restore <path>` | 작업 트리 | 해당 없음 |
| stage를 내림 | `git restore --staged <path>` | 인덱스 | 보존 |
| 현재 브랜치 ref를 이동 | `git reset <commit>` | ref, 옵션에 따라 인덱스/작업 트리 | 객체는 당장 남음 |
| 공개 이력에서 변경을 취소 | `git revert <commit>` | 새 커밋 생성 | 보존 |

`restore --staged`와 `reset`은 자주 혼동된다. 파일 하나의 stage를 내릴 때는 `restore --staged`가 의도가 분명하다. 브랜치 끝점을 옮길 때는 `reset`이다.

### reset은 현재 브랜치와 세 영역을 재배치한다

실습 그래프를 만든다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

printf "one\n" > note.txt
git add note.txt
git commit -m "One"
printf "two\n" >> note.txt
git add note.txt
git commit -m "Two"
printf "three\n" >> note.txt
git add note.txt
git commit -m "Three"

git log --oneline --decorate
```

`HEAD~1`은 두 번째 커밋이다. reset 모드는 어디까지 되돌릴지 결정한다.

| 명령 | 현재 브랜치 ref | 인덱스 | 작업 트리 |
|---|---|---|---|
| `git reset --soft HEAD~1` | 이동 | 그대로 | 그대로 |
| `git reset --mixed HEAD~1` | 이동 | 대상 커밋으로 변경 | 그대로 |
| `git reset --hard HEAD~1` | 이동 | 대상 커밋으로 변경 | 대상 커밋으로 변경 |

기본값은 `--mixed`다. `--soft`는 마지막 커밋을 풀어서 stage된 상태로 남기고 싶을 때 쓴다. `--mixed`는 커밋만 풀고 작업 트리 변경으로 남긴다. `--hard`는 작업 트리까지 덮어쓴다.

```sh
git reset --mixed HEAD~1
git status --short
```

세 번째 커밋은 브랜치 이름에서 떨어졌지만 즉시 사라진 것은 아니다. reflog가 이전 `HEAD`를 기억한다.

```sh
git reflog --oneline
```

복구하려면 해당 해시로 브랜치를 만들거나 reset한다.

```sh
git branch rescue <lost-commit-hash>
```

### amend는 마지막 커밋을 수정하는 척하지만 새 커밋을 만든다

```sh
printf "two fixed\n" >> note.txt
git add note.txt
git commit --amend -m "Two fixed"
```

`--amend`는 기존 커밋 객체를 제자리 수정하지 않는다. 새 tree와 새 commit 객체를 만들고 현재 브랜치 ref를 그 커밋으로 옮긴다. 이전 커밋은 이름을 잃을 수 있지만 reflog에는 남는다.

개인 브랜치에서 push 전 커밋 메시지나 누락 파일을 고치는 용도에는 적합하다. 이미 공유 브랜치에 push한 커밋을 amend한 뒤 force push하면 협업자의 base가 바뀐다.

### revert는 공개 이력에 적합한 취소 방식이다

`revert`는 대상 커밋의 반대 patch를 계산해 새 커밋을 만든다.

```sh
git revert HEAD
```

그래프는 되감기지 않는다.

```text
A <- B <- C <- R
```

`R`은 `C`의 변경을 취소하는 새 커밋이다. 공개 이력에서 revert가 안전한 이유는 기존 커밋 해시와 그래프를 보존하기 때문이다. 이미 다른 사람이 `C`를 기반으로 작업하고 있어도 base가 흔들리지 않는다.

단점도 있다. revert는 "변경을 반대로 적용"하는 커밋이므로, 나중에 같은 기능을 다시 넣을 때 이미 revert된 이력을 고려해야 한다. merge commit revert는 특히 주의가 필요하다. Git은 어떤 부모를 mainline으로 볼지 알아야 한다.

```sh
git revert -m 1 <merge-commit>
```

merge revert는 이후 같은 브랜치를 다시 merge할 때 예상과 다른 결과를 만들 수 있으므로, 릴리스 브랜치나 hotfix 절차에서 명확히 기록해야 한다.

### cherry-pick은 patch를 새 위치에 재적용한다

```sh
git cherry-pick <commit>
```

`cherry-pick`은 대상 커밋이 도입한 변경을 현재 브랜치 위에 새 커밋으로 적용한다. 원본 커밋과 새 커밋은 같은 diff를 가질 수 있지만 부모가 다르므로 해시가 다르다.

릴리스 브랜치에 hotfix만 골라 넣을 때 유용하다. 그러나 같은 변경이 여러 브랜치에 다른 해시로 존재하게 되므로 추적 비용이 생긴다. cherry-pick 후에는 원본 커밋 해시를 메시지에 남기는 기본 동작이 도움이 된다.

```sh
git cherry-pick -x <commit>
```

### rebase는 커밋을 새 base 위에 재생한다

그래프가 다음과 같다고 하자.

```text
A <- B <- C  main
      \
       D <- E  feature
```

`feature`에서 `git rebase main`을 실행하면 Git은 `D`, `E`가 `B` 이후 도입한 patch를 계산하고, 이를 `C` 위에 새 커밋으로 적용한다.

```text
A <- B <- C  main
          \
           D' <- E'  feature
```

`D`와 `E`가 수정되는 것이 아니다. `D'`, `E'`라는 새 커밋이 생기고 `feature` ref가 `E'`로 이동한다. 이 때문에 push 후 공개된 커밋을 rebase하면 원격과 로컬, 협업자의 브랜치가 서로 다른 해시를 보게 된다.

작은 실습:

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

git switch feature
git rebase main
git log --graph --oneline --decorate --all
git reflog --oneline
```

reflog에는 rebase 전 `feature`가 가리키던 커밋도 남는다. rebase가 잘못되었으면 `git rebase --abort`로 중단하거나, 완료 후라도 reflog를 이용해 이전 끝점으로 돌아갈 수 있다.

### interactive rebase는 개인 이력 편집 도구다

```sh
git rebase -i HEAD~3
```

interactive rebase는 최근 커밋의 순서 변경, squash, fixup, 메시지 수정, 중간 커밋 편집을 가능하게 한다.

| 명령 | 의미 | 용도 |
|---|---|---|
| `pick` | 그대로 재생 | 기본 |
| `reword` | 메시지만 수정 | 설명 보강 |
| `edit` | 해당 커밋에서 멈춤 | 누락 파일 추가, 커밋 분할 |
| `squash` | 이전 커밋과 합치고 메시지 편집 | 작업 중간 커밋 정리 |
| `fixup` | 이전 커밋과 합치고 메시지 버림 | "fix typo" 커밋 흡수 |
| `drop` | 커밋 제거 | 잘못 만든 개인 커밋 삭제 |

이 도구는 PR 제출 전 개인 브랜치를 읽기 좋게 정리하는 데 강력하다. 그러나 이미 공유된 커밋을 재작성하면 다른 사람의 작업 기반을 바꾼다. 공개 이력에 쓰려면 팀 합의와 강한 커뮤니케이션이 필요하다.

### reflog는 ref 이동의 로컬 일지다

reflog는 브랜치와 `HEAD`가 과거에 무엇을 가리켰는지 로컬에 기록한다.

```sh
git reflog
git reflog show main
```

실수로 hard reset한 뒤 커밋을 복구하는 기본 흐름은 다음과 같다.

```sh
git reflog --oneline
git branch rescue HEAD@{1}
git log --graph --oneline --decorate --all
```

`HEAD@{1}`이 항상 원하는 지점이라는 뜻은 아니다. reflog를 읽고 reset 전 끝점이 어느 항목인지 확인해야 한다. reflog는 로컬 기록이므로 다른 clone에는 없고, 만료 정책과 GC에 영향을 받는다. 오래된 "이름 없는" 커밋은 결국 사라질 수 있다.

`ORIG_HEAD`도 복구 단서가 된다. merge, rebase, reset 같은 위험한 이동 전의 `HEAD`를 Git이 기록해 둘 때가 있다.

```sh
git show ORIG_HEAD
```

단, 모든 상황에서 영구적으로 믿을 수 있는 백업은 아니다. 중요한 작업 전에는 명시적 브랜치가 더 안전하다.

```sh
git branch backup/before-risky-rebase
```

## 실무 관점

### 공개 이력과 개인 이력을 나눠 판단한다

| 작업 | 개인 브랜치 push 전 | 공유 브랜치 push 후 |
|---|---|---|
| amend | 적합 | force push 필요, 위험 |
| interactive rebase | 적합 | 협업자 base 변경 |
| reset으로 커밋 제거 | 적합 | 원격 ref 되감기 필요 |
| revert | 다소 장황할 수 있음 | 안전한 기본 선택 |
| cherry-pick | 필요 시 사용 | 중복 변경 추적 필요 |

개인 이력은 리뷰 가능한 형태로 정리해도 된다. 공개 이력은 다른 사람의 작업 기반이다. 이벤트 소싱에서 이미 소비된 이벤트를 바꾸면 downstream이 깨지는 것과 같은 문제다.

### 위험 명령 전 백업 ref를 만든다

복구 가능한 Git 사고 대부분은 "어딘가에 해시가 남아 있었다"는 공통점을 가진다. 그러므로 위험 명령 전에는 이름을 남기는 습관이 가장 싸다.

```sh
git branch backup/$(date +%Y%m%d-%H%M%S)
```

셸과 운영체제에 따라 `date` 옵션이 다를 수 있으므로 팀 스크립트로 표준화하는 편이 좋다. 핵심은 커밋 해시에 사람이 찾을 수 있는 ref를 붙이는 것이다. tag를 써도 된다.

### 복구 가능성은 "객체가 있었는가"와 "이름이 남았는가"로 본다

| 사고 | 복구 가능성 | 근거 |
|---|---|---|
| 커밋 후 reset | 높음 | reflog에 이전 커밋 해시가 남음 |
| amend 후 이전 커밋 필요 | 높음 | reflog에 amend 전 커밋이 남음 |
| push 전 rebase 실수 | 높음 | 로컬 reflog와 backup branch |
| force push로 원격 커밋 가림 | 중간 | 다른 clone, remote-tracking ref, 호스팅 reflog 여부 |
| untracked 파일 `git clean -fd` | 낮음 | Git 객체로 저장된 적 없음 |
| 미stage 작업 `reset --hard` | 낮음 | Git 객체로 저장된 적 없을 수 있음 |

## 더 깊이

### `git fsck --lost-found`는 마지막 수단이다

어떤 ref와 reflog에서도 찾기 어려운 dangling 객체를 찾을 때 `git fsck`를 쓸 수 있다.

```sh
git fsck --lost-found
```

이 명령은 도달 불가능한 객체를 보고할 수 있다. 그러나 dangling blob이나 commit이 무엇인지 사람이 다시 해석해야 하고, GC 이후에는 사라졌을 수 있다. 실무 복구 전략의 1순위는 reflog, 2순위는 다른 clone과 remote-tracking ref, 3순위가 `fsck`다.

### rebase와 merge는 같은 최종 스냅샷을 만들 수 있지만 같은 이력은 아니다

충돌을 잘 해결하면 rebase와 merge가 같은 파일 결과를 만들 수 있다. 그러나 merge는 기존 커밋을 보존하고 통합 커밋을 추가하며, rebase는 새 커밋을 만든다. `git blame`, release note, bisect, cherry-pick, 감사 로그에서 이 차이가 드러난다. "최종 파일이 같으니 같은 작업"이라고 보면 안 된다.

## 정리

- `restore`, `reset`, `revert`는 모두 되돌리기처럼 보이지만 바꾸는 계층이 다르다.
- `reset` 모드는 현재 브랜치 ref, 인덱스, 작업 트리 중 어디까지 대상 커밋에 맞출지 결정한다.
- amend와 rebase는 기존 커밋을 수정하지 않고 새 커밋을 만든 뒤 ref를 이동한다.
- reflog는 로컬 ref 이동 기록이며, 이름을 잃은 커밋 복구의 핵심 단서다.
- 공개 이력 재작성은 다른 사람의 작업 기반을 바꾸므로, 기본적으로 revert나 새 커밋을 선택한다.

## 확인 문제

1. `git reset --soft HEAD~1` 후 `git status`에는 어떤 종류의 변경이 보이는가?

<details>
<summary>정답과 해설</summary>

현재 브랜치 ref만 이전 커밋으로 이동하고 인덱스와 작업 트리는 그대로 남는다. 따라서 방금 풀린 마지막 커밋의 변경이 stage된 변경으로 보인다. 바로 다시 커밋할 수 있는 상태다.

</details>

2. 이미 `origin/main`에 push한 커밋의 메시지를 `commit --amend`로 고친 뒤 push하려고 한다. 왜 일반 push가 거부될 수 있는가?

<details>
<summary>정답과 해설</summary>

amend는 기존 커밋을 제자리 수정하지 않고 새 커밋을 만든다. 로컬 `main`은 원격 `main`과 다른 해시를 가진 새 커밋을 가리키며, 원격 커밋을 조상으로 포함하지 않을 수 있다. 일반 push는 원격 ref를 되감는 non-fast-forward 갱신을 거부한다.

</details>

3. `reset --hard`로 커밋 하나를 잃은 상황과 커밋하지 않은 새 파일을 `git clean -fd`로 지운 상황의 복구 가능성이 다른 이유는 무엇인가?

<details>
<summary>정답과 해설</summary>

커밋으로 만들어진 객체는 reflog나 다른 ref가 한동안 해시를 기억할 수 있으므로 복구 가능성이 높다. 반면 untracked 새 파일은 Git 객체 데이터베이스에 저장된 적이 없다. `git clean -fd`로 삭제하면 Git 내부에는 복구할 근거가 없다.

</details>

## 참고 자료

- [git-reset manual](https://git-scm.com/docs/git-reset) — reset 모드별로 ref, 인덱스, 작업 트리가 어떻게 바뀌는지 확인할 수 있다.
- [git-restore manual](https://git-scm.com/docs/git-restore) — 작업 트리와 인덱스 복구 명령의 범위를 설명한다.
- [git-revert manual](https://git-scm.com/docs/git-revert) — 기존 이력을 보존하면서 반대 변경 커밋을 만드는 명령이다.
- [git-rebase manual](https://git-scm.com/docs/git-rebase) — rebase와 interactive rebase의 동작 및 옵션을 확인할 수 있다.
- [git-reflog manual](https://git-scm.com/docs/git-reflog) — 로컬 ref 이동 기록과 만료 정책을 설명한다.
- [Git Book: Rewriting History](https://git-scm.com/book/en/v2/Git-Tools-Rewriting-History) — amend, interactive rebase, filter류 작업의 배경을 확인할 수 있다.
