# 7-2. 객체·참조·커밋

> 한 줄 요약: 이 문서를 읽고 나면 커밋 해시가 무엇의 주소인지, HEAD와 브랜치가 실제로 무엇을 가리키는지, 커밋 DAG를 어떻게 읽어야 하는지 설명할 수 있다.

이 문서의 예제는 Git 2.43.0에서 검증했다. 객체 해시 길이와 출력은 저장소의 객체 포맷(SHA-1 또는 SHA-256)에 따라 달라질 수 있으므로, 예제는 해시 값 자체가 아니라 관계를 관찰하는 데 초점을 둔다.

## 학습 목표

- blob, tree, commit, tag 객체의 역할과 연결 관계를 `git cat-file`로 확인할 수 있다.
- content-addressing이 Git 객체 식별과 이력 무결성에 어떤 의미를 갖는지 설명할 수 있다.
- 브랜치, tag, `HEAD`를 커밋 객체를 가리키는 참조(ref)로 해석할 수 있다.
- detached HEAD가 무엇이며, 왜 "작업 금지 상태"가 아니라 "이름 없는 커밋을 만들기 쉬운 상태"인지 판단할 수 있다.
- 커밋 DAG에서 부모 포인터, merge commit, 도달 가능성(reachability)을 읽을 수 있다.

## 배경: 왜 이것이 존재하는가

[7-1](./01-git-mental-model.md)에서 Git 커밋을 스냅샷으로 보았다. 이제 그 스냅샷이 실제로 어떤 객체들로 표현되는지 내려간다. Git을 명령어 묶음으로만 배우면 `branch`, `checkout`, `reset`, `rebase`가 서로 다른 기능처럼 보인다. 객체와 참조 모델로 보면 대부분은 "어떤 이름이 어떤 커밋을 가리키게 할 것인가"의 변형이다.

Git은 파일 경로를 기본 주소로 삼지 않는다. 파일 내용은 blob 객체가 되고, 객체의 내용에서 계산한 해시가 주소가 된다. 디렉터리는 tree 객체가 되고, 커밋은 tree와 부모 커밋과 메타데이터를 담는 commit 객체가 된다. 이 구조는 Merkle DAG에 가깝다. 하위 객체 내용이 바뀌면 그 객체의 해시가 바뀌고, 그것을 가리키는 상위 tree와 commit의 해시도 바뀐다.

이 설계는 몇 가지 실무 성질을 만든다. 같은 파일 내용은 같은 blob으로 공유될 수 있다. 커밋 해시는 커밋 내용 전체의 식별자이므로, 메시지나 부모가 바뀌어도 새 커밋이 된다. 브랜치는 커밋을 담는 컨테이너가 아니라 커밋을 가리키는 이름이므로 생성과 이동이 가볍다. 반대로 이름이 사라진 커밋은 당장 삭제되지는 않지만, 도달 가능하지 않으면 시간이 지나 정리될 수 있다.

## 핵심 개념

### Git 객체는 네 종류다

Git의 핵심 객체는 blob, tree, commit, tag 네 종류다.

| 객체 | 담는 것 | 비유 |
|---|---|---|
| blob | 파일 내용 바이트 | 파일 본문 |
| tree | 경로, 모드, 하위 객체 해시 | 디렉터리 엔트리 |
| commit | 루트 tree, 부모 커밋, 작성자, 메시지 | 스냅샷에 이름 없는 revision을 붙인 기록 |
| tag | 특정 객체에 붙인 주석과 서명 가능 메타데이터 | 릴리스 표지 |

작은 저장소를 만들어 직접 열어 보자.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

mkdir src
printf "export const answer = 42;\n" > src/answer.js
git add src/answer.js
git commit -m "Add answer module"

commit=$(git rev-parse HEAD)
tree=$(git rev-parse HEAD^{tree})
src_tree=$(git rev-parse HEAD:src)
blob=$(git rev-parse HEAD:src/answer.js)

git cat-file -t "$commit"
git cat-file -t "$tree"
git cat-file -t "$src_tree"
git cat-file -t "$blob"
git cat-file -p "$commit"
git cat-file -p "$tree"
git cat-file -p "$src_tree"
git cat-file -p "$blob"
```

`commit` 객체는 루트 tree를 가리킨다. 루트 tree는 `src` tree를 가리킨다. `src` tree는 `answer.js` blob을 가리킨다. blob에는 파일 이름이 없다. 파일 이름은 tree 엔트리에 있다. 따라서 "파일 이름 변경"은 blob을 바꾸지 않을 수 있다. 같은 내용의 파일이 두 경로에 있으면 같은 blob을 가리킬 수 있다.

### 객체 해시는 내용 기반 주소다

Git 객체의 해시는 객체 타입, 크기, 내용으로 계산된다. 같은 내용의 blob은 같은 주소를 갖고, 내용이 한 바이트라도 바뀌면 다른 주소를 갖는다. 이를 content-addressing이라고 한다.

```sh
printf "same\n" | git hash-object --stdin
printf "same\n" | git hash-object --stdin
printf "Same\n" | git hash-object --stdin
```

첫 두 명령은 같은 해시를 출력하고, 대문자가 바뀐 세 번째 명령은 다른 해시를 출력한다. 이 속성 때문에 Git 객체는 위치가 아니라 내용으로 식별된다.

전통적인 Git 저장소는 SHA-1 객체 포맷을 사용한다. Git은 SHA-256 저장소도 지원하지만, 저장소 생성 시 선택하는 객체 포맷이고 생태계 호환성 확인이 필요하다.

```sh
git init -b main --object-format=sha256 sha256-repo
```

실무에서 중요한 판단은 "SHA-1이 암호학적으로 영원히 충분하다"가 아니다. Git의 해시는 객체 식별자이며, 충돌 공격 대응과 저장소 포맷 전환은 Git 자체와 호스팅 플랫폼의 호환성 문제를 동반한다. 보안 감사가 필요한 저장소에서는 서명된 커밋과 태그, 보호 브랜치, 릴리스 검증 절차를 함께 보아야 한다. 이는 [7-8](./08-release-debugging-and-repo-operations.md)에서 다시 다룬다.

### 커밋 객체는 부모를 가리킨다

첫 커밋에는 부모가 없다. 두 번째 커밋부터는 이전 커밋을 parent로 가리킨다.

```sh
printf "export const answer = 43;\n" > src/answer.js
git add src/answer.js
git commit -m "Change answer"

git cat-file -p HEAD
```

출력에는 `parent <hash>`가 들어 있다. 이 parent 포인터가 커밋 이력을 만든다. merge commit은 parent가 둘 이상이다. Git의 이력은 선형 배열이 아니라 방향 비순환 그래프(DAG, directed acyclic graph)다. 방향은 자식에서 부모로 향한다. 새 커밋은 기존 커밋을 parent로 가리킬 뿐, 기존 커밋을 수정하지 않는다.

```text
A <- B <- C
      \
       D <- E
```

위 그림에서 `C`와 `E`는 서로 다른 끝점이다. 두 줄의 이력은 `B`를 공통 조상으로 공유한다. merge는 이 두 끝점을 다시 하나의 커밋으로 합칠 수 있다.

### 참조는 객체 해시에 붙인 이름이다

커밋 해시는 사람이 다루기에 길고 안정적인 이름으로 쓰기 어렵다. Git은 ref를 둔다. ref는 객체 해시를 가리키는 이름이다.

| ref | 예 | 의미 |
|---|---|---|
| local branch | `refs/heads/main` | 로컬 브랜치가 가리키는 커밋 |
| remote-tracking branch | `refs/remotes/origin/main` | 마지막 fetch 때 관찰한 원격 브랜치 |
| tag | `refs/tags/v1.0.0` | 특정 객체에 붙인 릴리스 이름 |
| symbolic ref | `HEAD` | 다른 ref를 가리키는 ref |

브랜치의 실체를 확인한다.

```sh
cat .git/HEAD
cat .git/refs/heads/main
git branch feature
cat .git/refs/heads/feature
```

`feature`를 만들 때 새 커밋 객체가 생기지 않는다. `refs/heads/feature`라는 이름이 현재 커밋을 가리킬 뿐이다. 그래서 브랜치 생성은 가볍다. 파일 복사본을 만들지 않기 때문이다.

현재 브랜치에서 새 커밋을 만들면, Git은 새 commit 객체를 만들고 현재 브랜치 ref를 그 커밋으로 이동시킨다. `HEAD`가 `refs/heads/main`을 가리키는 상태라면, 커밋 후 이동하는 것은 `HEAD` 파일이 아니라 `refs/heads/main`이다.

### `HEAD`는 현재 위치를 가리킨다

보통 `HEAD`는 현재 브랜치를 가리키는 symbolic ref다.

```text
HEAD -> refs/heads/main -> C
```

이 상태에서 커밋하면 `main`이 새 커밋으로 이동한다.

```text
HEAD -> refs/heads/main -> D
```

detached HEAD는 `HEAD`가 브랜치 이름이 아니라 커밋을 직접 가리키는 상태다.

```sh
git switch --detach HEAD~1
cat .git/HEAD
```

이제 `HEAD` 파일에는 `ref: ...`가 아니라 커밋 해시가 들어 있다. 이 상태에서도 새 커밋은 만들 수 있다.

```sh
printf "detached work\n" > detached.txt
git add detached.txt
git commit -m "Commit on detached HEAD"
git log --oneline --decorate -3
```

문제는 커밋 생성 가능 여부가 아니다. 새 커밋을 가리키는 브랜치 이름이 없다는 점이다. 다른 브랜치로 이동하면 그 커밋은 이름을 잃는다. reflog에는 한동안 남지만, 장기적으로 안전하지 않다. 보존하려면 이동하기 전에 브랜치를 붙인다.

```sh
git switch -c keep-detached-work
```

detached HEAD는 릴리스 tag를 잠깐 확인하거나 특정 커밋에서 빌드를 재현할 때 정상적인 상태다. 위험은 상태 자체가 아니라, 이름 없는 새 커밋을 만들고 잊어버리는 작업 방식에 있다.

### DAG는 도달 가능성으로 읽는다

Git에서 "살아 있는 커밋"은 보통 어떤 ref에서 parent 포인터를 따라 도달 가능한 커밋이다. `main`, `feature`, tag, remote-tracking ref, reflog 같은 이름이 출발점이다. ref가 사라져 어떤 이름에서도 도달할 수 없게 된 커밋은 당장 삭제되지는 않지만, GC 대상이 될 수 있다.

그래프를 직접 만든다.

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
git commit -m "Feature change"

git switch main
printf "main\n" >> app.txt
git add app.txt
git commit -m "Main change"

git log --graph --oneline --decorate --all
```

출력은 두 브랜치가 공통 조상에서 갈라졌음을 보여 준다. 이 그래프를 읽는 능력이 merge, rebase, reset, push 거부를 이해하는 기반이다.

## 실무 관점

### 이름과 주소를 분리해야 한다

브랜치 이름은 안정적인 식별자가 아니다. 움직이는 포인터다. 커밋 해시는 내용 기반 주소라서 한 번 만들어진 커밋 객체의 식별자로 안정적이다. 이 차이를 혼동하면 "main에 있던 커밋"과 "main이라는 이름이 지금 가리키는 커밋"을 구분하지 못한다.

| 상황 | 커밋 객체 | ref |
|---|---|---|
| 새 커밋 | 새 객체가 만들어진다 | 현재 브랜치가 새 커밋으로 이동한다 |
| 브랜치 생성 | 변화 없음 | 새 ref가 기존 커밋을 가리킨다 |
| reset | 변화 없음 또는 작업 트리 변화 | 현재 브랜치 ref가 다른 커밋으로 이동한다 |
| rebase | 새 커밋들이 만들어진다 | 브랜치 ref가 새 줄의 끝으로 이동한다 |
| tag 생성 | 보통 변화 없음 | tag ref 또는 tag 객체가 특정 객체를 가리킨다 |

실무에서 릴리스를 재현하려면 움직이는 브랜치보다 tag나 커밋 해시가 더 적합하다. 반대로 일상 개발에서는 사람이 이해하는 이름이 필요하므로 브랜치를 쓴다. 안정성과 가독성의 트레이드오프다.

### detached HEAD는 금지가 아니라 용도 제한이다

detached HEAD를 무조건 피해야 하는 상태로 가르치면, 과거 커밋 재현과 릴리스 디버깅을 불필요하게 두려워하게 된다. 올바른 기준은 "새 커밋을 만들 것인가"다.

| 용도 | detached HEAD 적합성 | 이유 |
|---|---|---|
| 특정 tag에서 빌드 재현 | 적합 | 새 커밋을 만들지 않는다 |
| 과거 커밋에서 버그 재현 | 적합 | 임시 관찰 상태다 |
| 실험 커밋 생성 | 조건부 적합 | 보존하려면 즉시 브랜치를 만들어야 한다 |
| 장기 기능 개발 | 부적합 | 작업 끝점을 가리키는 안정적인 이름이 없다 |

## 더 깊이

### annotated tag와 lightweight tag는 객체 모델이 다르다

lightweight tag는 단순히 `refs/tags/<name>`이 커밋을 가리키는 형태다. annotated tag는 tag 객체를 만들고, 그 tag 객체가 커밋을 가리킨다. tag 객체에는 tagger, 메시지, 서명 같은 메타데이터가 들어갈 수 있다.

```sh
git tag lightweight-v1
git tag -a annotated-v1 -m "Release v1"

git cat-file -t lightweight-v1
git cat-file -t annotated-v1
git cat-file -p annotated-v1
```

릴리스 감사와 배포 추적에는 annotated tag가 더 적합하다. 단순한 로컬 표시에는 lightweight tag도 충분하다. tag 전략은 [7-8](./08-release-debugging-and-repo-operations.md)에서 다룬다.

### pack된 ref와 loose ref

예제에서는 `.git/refs/heads/main` 파일을 직접 읽었다. 그러나 Git은 많은 ref를 `.git/packed-refs`에 묶어 저장할 수 있다. 따라서 스크립트가 ref를 읽어야 한다면 파일 경로를 직접 파싱하지 말고 `git rev-parse`, `git show-ref`, `git for-each-ref` 같은 명령을 써야 한다.

```sh
git show-ref --heads --tags
git rev-parse main
git symbolic-ref HEAD
```

내부 구조를 관찰하는 것은 모델을 이해하는 데 좋지만, 도구를 만들 때는 Git의 plumbing 명령을 쓰는 편이 안정적이다.

## 정리

- Git 객체는 blob, tree, commit, tag로 나뉘며, 커밋은 루트 tree와 부모 커밋을 가리킨다.
- 객체 해시는 내용 기반 주소이므로 내용, 부모, 메시지 같은 커밋 구성 요소가 바뀌면 새 커밋이 된다.
- 브랜치는 커밋을 가리키는 이동 가능한 ref이며, 작업 트리 복사본이 아니다.
- `HEAD`는 보통 현재 브랜치를 가리키지만, detached HEAD에서는 커밋을 직접 가리킨다.
- 커밋 DAG는 부모 포인터와 도달 가능성으로 읽어야 merge, rebase, reset, 복구를 예측할 수 있다.

## 확인 문제

1. 같은 파일 내용을 두 경로에 복사해 커밋하면 blob 객체는 반드시 두 개가 되는가?

<details>
<summary>정답과 해설</summary>

아니다. blob은 파일 이름이 아니라 내용으로 식별된다. 두 경로의 내용이 완전히 같다면 같은 blob 객체를 두 tree 엔트리가 가리킬 수 있다. 경로와 파일명은 blob이 아니라 tree 엔트리에 들어 있다.

</details>

2. `git commit --amend`로 메시지만 바꾸면 커밋 해시가 바뀌는가? 왜 그런가?

<details>
<summary>정답과 해설</summary>

바뀐다. 커밋 해시는 tree, 부모, 작성자/커미터 정보, 메시지 등 commit 객체 내용에서 계산된다. 메시지만 바뀌어도 commit 객체 내용이 달라지므로 새 해시를 가진 새 커밋이 만들어지고 브랜치 ref가 그 커밋으로 이동한다.

</details>

3. detached HEAD에서 커밋을 만든 뒤 `main`으로 이동했다. 그 커밋은 즉시 삭제되는가? 안전하게 보존하려면 무엇을 해야 하는가?

<details>
<summary>정답과 해설</summary>

즉시 삭제되지는 않는다. reflog에는 한동안 남을 수 있다. 그러나 어떤 브랜치나 tag에서도 도달할 수 없다면 장기적으로 GC 대상이 된다. 안전하게 보존하려면 이동하기 전에 또는 reflog에서 찾아낸 뒤 `git branch <name> <commit>`으로 이름을 붙여야 한다.

</details>

## 참고 자료

- [Git Book: Git Internals - Git Objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) — blob, tree, commit 객체를 직접 만드는 방식으로 내부 모델을 설명한다.
- [Git Book: Git Internals - Git References](https://git-scm.com/book/en/v2/Git-Internals-Git-References) — 브랜치와 HEAD가 ref로 표현되는 방식을 확인할 수 있다.
- [git-cat-file manual](https://git-scm.com/docs/git-cat-file) — 객체 타입과 내용을 확인하는 plumbing 명령의 공식 문서다.
- [git-rev-parse manual](https://git-scm.com/docs/git-rev-parse) — revision 표기법과 ref 해석 규칙을 확인할 수 있다.
- [gitrepository-layout](https://git-scm.com/docs/gitrepository-layout) — `.git` 디렉터리의 공식 레이아웃 설명이다.
