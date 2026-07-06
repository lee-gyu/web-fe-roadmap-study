# 7-1. Git 멘털 모델

> 한 줄 요약: 이 문서를 읽고 나면 Git을 파일 변경분 저장소가 아니라 작업 트리, 인덱스, 로컬 객체 데이터베이스 사이의 상태 전이로 설명할 수 있다.

이 문서의 예제는 Git 2.43.0에서 검증했다. Git 2.x 계열에서는 핵심 모델이 같지만, 기본 브랜치 이름이나 일부 출력 형식은 로컬 설정에 따라 다를 수 있다.

## 학습 목표

- 작업 트리(working tree), 인덱스(index), 로컬 저장소(local repository)가 각각 어떤 상태를 보관하는지 설명할 수 있다.
- Git의 커밋을 "변경분"이 아니라 프로젝트 스냅샷(snapshot)을 가리키는 객체로 해석할 수 있다.
- `git status`, `git diff`, `git add`, `git commit`, `git restore`가 세 영역 중 무엇을 읽고 바꾸는지 판단할 수 있다.
- `.git` 디렉터리의 최소 구성 요소를 보고 Git 저장소의 상태를 직접 관찰할 수 있다.
- "Git이 추적한다"는 말이 파일 시스템의 모든 변화를 자동으로 기록한다는 뜻이 아님을 구분할 수 있다.

## 배경: 왜 이것이 존재하는가

중앙형 버전 관리 시스템은 보통 서버를 기준점으로 삼는다. 체크아웃한 작업 사본은 서버의 특정 revision을 가져온 결과이고, 이력 조회나 브랜치 생성 같은 많은 작업이 중앙 서버와의 관계 안에서 설명된다. Git의 선택은 다르다. 로컬 저장소가 전체 이력과 객체를 가진다. 네트워크가 끊겨도 커밋을 만들고, 브랜치를 만들고, 로그를 조회할 수 있는 이유가 여기에 있다.

이 모델은 단순히 "오프라인에서도 된다"는 편의 기능이 아니다. Git은 로컬에 content-addressable object store와 참조(ref)를 가진 작은 데이터베이스를 둔다. 커밋은 이 데이터베이스 안의 객체이고, 브랜치는 객체를 가리키는 이름이다. 서버는 특별한 신탁 기관이 아니라 다른 Git 저장소일 뿐이다. 원격 저장소는 [7-5](./05-remotes-fetch-pull-push.md)에서 다루지만, 그 전제는 여기서 세운다.

경력 개발자가 Git에서 자주 겪는 혼란은 명령어 부족보다 모델 부족에서 나온다. `git add`를 "파일 저장"으로 이해하면 `git diff`와 `git diff --cached`의 차이가 흐려진다. 브랜치를 "폴더 복사본"으로 이해하면 merge와 rebase 결과를 예측하기 어렵다. `reset --hard`를 금지 주문처럼 외우면 무엇이 손실되고 무엇이 reflog에 남는지 판단하지 못한다. 이 Phase는 명령어 사전을 만드는 과정이 아니라, 명령 전후의 상태를 예측하는 모델을 세우는 과정이다.

## 핵심 개념

### Git 저장소는 세 영역으로 나뉜다

Git의 일상 명령은 대부분 다음 세 영역 사이의 차이를 읽거나 복사한다.

| 영역 | 저장하는 것 | 대표 파일/구조 | 바뀌는 대표 명령 |
|---|---|---|---|
| 작업 트리 | 현재 디렉터리에 놓인 실제 파일 | 프로젝트 파일 | 편집기, `git restore`, merge 충돌 해결 |
| 인덱스 | 다음 커밋이 될 후보 스냅샷 | `.git/index` | `git add`, `git restore --staged`, 충돌 해결 후 `git add` |
| 로컬 저장소 | 이미 만들어진 객체와 참조 | `.git/objects`, `.git/refs`, `.git/HEAD` | `git commit`, `git branch`, `git reset`, `git gc` |

인덱스가 빠지면 Git은 "작업 트리 전체를 그대로 커밋하는 도구"가 된다. Git이 인덱스를 둔 이유는 다음 커밋의 내용을 작업 트리와 분리해 구성하기 위해서다. 한 파일 안에서도 일부 hunks만 커밋에 넣을 수 있고, 나머지 변경은 작업 트리에 남길 수 있다. 이 성질은 [7-3](./03-staging-diff-and-commit-design.md)의 커밋 설계로 이어진다.

다음 예제는 세 영역이 서로 다른 상태가 되는 순간을 만든다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

printf "one\n" > note.txt
git add note.txt
git commit -m "Add note"

printf "two\n" >> note.txt
git add note.txt

printf "three\n" >> note.txt
git status --short
git diff
git diff --cached
```

`git status --short`에는 같은 파일이 두 번 나타날 수 있다. 왼쪽 열은 인덱스와 `HEAD`의 차이, 오른쪽 열은 작업 트리와 인덱스의 차이다. 위 예제에서 `two`는 인덱스에 올라갔지만, `three`는 작업 트리에만 있다.

```text
MM note.txt
```

이 한 줄은 "파일이 수정되었다"보다 더 많은 정보를 담는다. 첫 번째 `M`은 다음 커밋 후보가 마지막 커밋과 다르다는 뜻이고, 두 번째 `M`은 작업 트리가 다음 커밋 후보와도 다르다는 뜻이다. Git 사용 능력은 이 두 차이를 구분하는 데서 시작한다.

### 커밋은 변경분이 아니라 스냅샷이다

일상적으로는 "이 커밋은 어떤 diff를 담고 있다"고 말한다. 리뷰 화면도 커밋을 diff로 보여 준다. 하지만 Git의 사용자 모델에서 커밋은 프로젝트 전체의 스냅샷을 가리킨다. 커밋 객체는 루트 tree 객체를 가리키고, tree는 디렉터리 구조와 각 파일의 blob 객체를 가리킨다. diff는 두 스냅샷을 비교해서 계산한 결과다.

이 차이는 설계 판단에 영향을 준다.

- 파일을 수정하지 않으면 다음 커밋은 이전 커밋과 같은 blob을 재사용한다. 매번 전체 파일을 중복 저장하는 단순 복사 모델은 아니다.
- 리네임(rename)은 영구적인 "이 파일이 이름을 바꿨다" 메타데이터로 저장되지 않는다. Git은 두 스냅샷 사이의 유사도를 보고 리네임을 추론한다.
- merge는 두 diff를 붙이는 작업이 아니라, 공통 조상과 두 스냅샷을 비교해 최종 스냅샷을 구성하는 작업이다.

스냅샷 모델을 직접 확인해 보자.

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

git cat-file -p HEAD
git cat-file -p HEAD^{tree}
```

`HEAD` 커밋은 `tree <hash>` 한 줄을 가진다. 그 tree를 열면 `src` 디렉터리를 가리키는 또 다른 tree가 나온다. 파일 내용은 blob이다. Git은 "answer.js에 한 줄을 추가했다"를 커밋 객체에 직접 적지 않는다. "이 시점의 루트 tree는 이것이다"를 기록한다.

### `.git` 디렉터리는 저장소의 실제 본체다

작업 트리를 지우면 체크아웃으로 다시 만들 수 있지만, `.git`을 지우면 이력과 참조가 사라진다. 일반 프로젝트 디렉터리가 Git 저장소가 되는 순간은 `.git` 디렉터리가 생기는 순간이다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main

find .git -maxdepth 2 -type f | sort
```

초기 저장소에는 아직 커밋 객체가 없다. 그래도 몇 가지 핵심 파일은 존재한다.

| 경로 | 의미 |
|---|---|
| `.git/HEAD` | 현재 체크아웃된 ref 또는 커밋을 가리킨다 |
| `.git/config` | 이 저장소의 로컬 설정 |
| `.git/index` | 첫 `git add` 이후 만들어지는 인덱스 파일 |
| `.git/objects/` | blob, tree, commit, tag 객체가 저장되는 공간 |
| `.git/refs/` | 브랜치와 태그 같은 이름이 객체 해시를 가리키는 공간 |

첫 커밋을 만든 뒤 다시 보면 `objects` 아래에 loose object가 생기고, `refs/heads/main`에는 커밋 해시가 들어 있다.

```sh
git config user.name "Phase Seven"
git config user.email "phase7@example.com"
printf "hello\n" > hello.txt
git add hello.txt
git commit -m "Add hello"

cat .git/HEAD
cat .git/refs/heads/main
find .git/objects -type f | sort
```

`HEAD`는 보통 `ref: refs/heads/main`처럼 symbolic ref를 담는다. 현재 브랜치가 `main`이라는 뜻이다. `refs/heads/main`은 실제 커밋 해시를 담는다. 브랜치의 실체는 이 파일 하나로 시작한다. 물론 실제 저장소에서는 packed-refs로 이동할 수 있으므로 항상 파일로 존재한다고 가정하면 안 된다. 중요한 것은 브랜치가 "작업 트리의 복사본"이 아니라 "커밋을 가리키는 이름"이라는 점이다.

### `status`와 `diff`는 세 영역의 차이를 읽는다

`git status`는 Git이 추적하는 모든 파일의 절대 상태를 말해 주는 명령이 아니다. 인덱스, 작업 트리, `HEAD` 사이의 차이를 요약한다. `git diff` 계열은 어떤 두 영역을 비교하느냐에 따라 의미가 달라진다.

| 명령 | 비교 대상 | 질문 |
|---|---|---|
| `git diff` | 작업 트리 vs 인덱스 | 아직 stage하지 않은 변경은 무엇인가 |
| `git diff --cached` | 인덱스 vs `HEAD` | 다음 커밋에 들어갈 변경은 무엇인가 |
| `git diff HEAD` | 작업 트리 vs `HEAD` | 마지막 커밋 이후 전체 변경은 무엇인가 |
| `git status` | 위 차이의 요약 | 커밋 후보와 미stage 변경이 무엇인가 |

`git add`는 작업 트리의 현재 파일 내용을 인덱스에 복사한다. "파일을 저장한다"는 표현은 부정확하다. 파일은 이미 파일 시스템에 저장되어 있다. `add`는 "다음 커밋 후보 스냅샷에 이 파일의 현재 내용을 반영한다"는 뜻이다.

`git restore`는 반대 방향의 복사를 수행한다.

```sh
# 작업 트리 변경을 인덱스의 내용으로 되돌린다
git restore note.txt

# 인덱스에 올라간 변경을 HEAD 기준으로 내린다. 작업 트리는 그대로 둔다
git restore --staged note.txt
```

이 두 명령은 위험도가 다르다. `restore --staged`는 인덱스만 바꾸므로 작업 트리의 편집 내용은 남는다. 반면 `restore note.txt`는 작업 트리의 미stage 변경을 덮어쓴다. 아직 커밋이나 인덱스에 없는 내용은 Git 객체 데이터베이스에 없으므로 복구 근거가 약하다.

### Git이 추적하는 것과 추적하지 않는 것

Git은 파일 시스템 감시자가 아니다. Git이 관리하는 단위는 tracked 파일의 경로와 내용이다. 새 파일을 만들었다고 자동으로 커밋 후보가 되지 않는다. `git add`로 인덱스에 올려야 추적이 시작된다.

상태는 크게 세 가지다.

| 상태 | 의미 | 예 |
|---|---|---|
| tracked | 마지막 커밋 또는 인덱스에 존재하는 경로 | 소스 파일, 설정 파일 |
| untracked | 작업 트리에 있지만 Git이 아직 모르는 경로 | 새로 만든 파일 |
| ignored | ignore 규칙에 의해 의도적으로 숨긴 경로 | `node_modules/`, `.env.local`, 빌드 산출물 |

ignore는 "보안 삭제"나 "이력에서 제거"가 아니다. 이미 tracked인 파일은 `.gitignore`에 추가해도 계속 추적된다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

printf "SECRET=old\n" > .env
git add .env
git commit -m "Track env by mistake"

printf ".env\n" > .gitignore
git status --short
```

`.env`는 이미 tracked이므로 ignore 규칙만으로 사라지지 않는다. 이후 커밋에서 추적을 끊으려면 `git rm --cached .env`가 필요하고, 이미 공개 저장소에 올라간 비밀값은 이력 재작성만으로 해결되지 않는다. 자격 증명 회전(rotation)이 필요하다. Git의 모델은 기록을 다루는 도구이지, 유출된 비밀을 무효화하는 보안 시스템이 아니다.

## 실무 관점

### 세 영역을 모르면 위험 명령이 모두 비슷해 보인다

Git의 위험도는 어떤 영역을 바꾸는지로 판단한다.

| 명령 | 바꾸는 영역 | 주요 위험 | 복구 단서 |
|---|---|---|---|
| `git restore <path>` | 작업 트리 | 미stage 편집 손실 | 편집기 히스토리, 백업 |
| `git restore --staged <path>` | 인덱스 | 커밋 후보에서 빠짐 | 작업 트리에 내용이 남음 |
| `git reset --soft HEAD~1` | 현재 브랜치 ref | 마지막 커밋 이름 이동 | reflog |
| `git reset --hard HEAD~1` | ref, 인덱스, 작업 트리 | 커밋 이후 작업 트리 손실 | reflog는 커밋 복구에만 도움 |
| `git clean -fd` | 작업 트리의 untracked 파일 | Git이 모르는 파일 삭제 | Git 자체에는 없음 |

같은 "되돌리기"라도 손실되는 데이터의 종류가 다르다. 커밋으로 한 번 들어간 객체는 reflog와 GC 정책이 허용하는 동안 복구할 수 있지만, 한 번도 인덱스나 커밋에 들어간 적 없는 편집 내용은 Git의 책임 범위 밖이다.

### 스냅샷 모델은 리뷰와 릴리스의 단위에도 영향을 준다

커밋이 스냅샷이라면 좋은 커밋은 "이 diff가 작다"보다 "이 스냅샷이 의미 있는 상태다"에 가깝다. 중간 커밋마다 테스트가 통과하고, revert해도 시스템이 일관된 상태로 돌아가며, `bisect`가 원인 커밋을 좁힐 수 있어야 한다. 이 기준은 [7-3](./03-staging-diff-and-commit-design.md)에서 자세히 다룬다.

| 커밋 방식 | 얻는 것 | 포기하는 것 | 무너지는 조건 |
|---|---|---|---|
| 작업이 끝난 뒤 큰 커밋 하나 | 커밋 수가 적다 | 리뷰와 bisect가 어렵다 | 변경 의도가 둘 이상 섞일 때 |
| 파일별 커밋 | 만들기 쉽다 | 의도 단위가 보장되지 않는다 | 한 기능이 여러 파일을 함께 바꿀 때 |
| 의미 단위 커밋 | revert, 리뷰, bisect가 쉽다 | staging과 메시지 작성 비용 | 단위가 너무 잘게 쪼개져 각 커밋이 깨질 때 |

## 더 깊이

### 인덱스는 단순한 체크박스가 아니다

인덱스는 "stage된 파일 목록"보다 더 구체적인 자료구조다. 각 경로에 대해 파일 모드, blob 객체 해시, 충돌 단계(stage) 같은 메타데이터를 가진다. merge 충돌 중에는 같은 경로가 여러 stage로 인덱스에 존재할 수 있다. 그래서 충돌 해결은 파일의 충돌 마커를 지우는 것으로 끝나지 않는다. 의도한 최종 파일을 만든 뒤 `git add`로 인덱스에 해결된 stage 0 엔트리를 올려야 한다.

직접 볼 수 있다.

```sh
git ls-files -s
```

평상시에는 각 파일이 stage 0으로 나온다. 충돌 중에는 stage 1(공통 조상), stage 2(ours), stage 3(theirs)가 나타난다. 이 구조가 [7-4](./04-branching-merging-and-conflicts.md)의 3-way merge를 설명하는 기반이다.

### 객체 데이터베이스와 사용자 모델은 구분해야 한다

사용자 모델에서는 커밋이 스냅샷이다. 내부 구현에서는 loose object, packfile, delta compression 같은 저장 최적화가 들어간다. 오래된 객체는 packfile로 압축되고, packfile 안에서는 객체 간 delta가 저장될 수 있다. 그렇다고 Git을 "diff 저장소"로 설명하면 merge, rebase, ref 이동을 잘못 이해하게 된다. 사용자가 결과를 예측할 때 필요한 모델은 "커밋이 루트 tree를 가리킨다"이다. 저장 효율을 설명할 때만 packfile과 delta를 꺼내면 된다.

## 정리

- Git 저장소의 일상 상태는 작업 트리, 인덱스, 로컬 저장소 세 영역으로 나뉜다.
- `git add`는 파일 저장이 아니라 다음 커밋 후보 스냅샷을 인덱스에 구성하는 명령이다.
- 커밋은 변경분 자체가 아니라 프로젝트 스냅샷을 가리키는 객체이고, diff는 두 스냅샷의 비교 결과다.
- `.git` 디렉터리가 저장소의 본체이며, `objects`, `refs`, `HEAD`, `index`가 핵심 상태를 담는다.
- 위험 명령의 위험도는 작업 트리, 인덱스, ref, 객체 그래프 중 무엇을 바꾸는지로 판단해야 한다.

## 확인 문제

1. `git status --short`에 `MM app.js`가 표시되었다. `git diff`, `git diff --cached`, `git commit`은 각각 어떤 내용을 보게 되는가?

<details>
<summary>정답과 해설</summary>

첫 번째 `M`은 인덱스와 `HEAD`의 차이, 두 번째 `M`은 작업 트리와 인덱스의 차이다. `git diff`는 작업 트리에만 남은 변경을 보여 준다. `git diff --cached`는 인덱스에 올라간 변경, 즉 다음 커밋 후보를 보여 준다. `git commit`은 작업 트리의 최신 내용 전체가 아니라 인덱스에 올라간 내용만 커밋한다.

</details>

2. `.gitignore`에 `.env`를 추가했는데도 `git status`에 `.env` 수정이 계속 표시된다. 왜 그런가?

<details>
<summary>정답과 해설</summary>

`.env`가 이미 tracked 상태이기 때문이다. ignore 규칙은 untracked 파일을 숨기는 규칙이지, 이미 이력이나 인덱스에 들어간 경로의 추적을 끊지 않는다. 추적을 끊으려면 `git rm --cached .env` 후 커밋해야 한다. 이미 공개된 비밀값은 별도로 폐기하고 재발급해야 한다.

</details>

3. `git restore --staged file.txt`와 `git restore file.txt` 중 어느 쪽이 더 위험한가? 세 영역 모델로 설명하라.

<details>
<summary>정답과 해설</summary>

일반적으로 `git restore file.txt`가 더 위험하다. `restore --staged`는 인덱스만 `HEAD` 기준으로 되돌리고 작업 트리 내용은 남긴다. 반면 `restore file.txt`는 작업 트리를 인덱스 또는 지정한 기준의 내용으로 덮어쓴다. 아직 커밋이나 인덱스에 들어가지 않은 편집은 Git 객체 데이터베이스에 없으므로 복구하기 어렵다.

</details>

## 참고 자료

- [Git Book: Git Basics](https://git-scm.com/book/en/v2/Git-Basics-Getting-a-Git-Repository) — 저장소 생성, 추적 상태, 기본 명령을 Git 공식 배포판의 설명으로 확인할 수 있다.
- [Git Book: Git Internals - Plumbing and Porcelain](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain) — Git을 사용자 명령(porcelain)과 내부 명령(plumbing)으로 나누어 보는 관점을 제공한다.
- [git-status manual](https://git-scm.com/docs/git-status) — status 출력이 인덱스와 작업 트리의 차이를 어떻게 표현하는지 확인할 수 있다.
- [gitglossary](https://git-scm.com/docs/gitglossary) — working tree, index, ref, object 같은 용어의 공식 정의를 확인할 수 있다.
