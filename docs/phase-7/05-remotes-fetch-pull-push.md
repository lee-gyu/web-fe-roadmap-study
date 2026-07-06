# 7-5. 원격·fetch·pull·push

> 한 줄 요약: 이 문서를 읽고 나면 원격 저장소를 특별한 중앙 서버가 아니라 다른 Git 저장소로 이해하고, `fetch`, `pull`, `push`가 어떤 ref를 어떻게 갱신하는지 설명할 수 있다.

이 문서의 예제는 Git 2.43.0에서 검증했다. 네트워크 인증, 호스팅 플랫폼 권한, pull request UI는 Git 모델 위의 별도 계층이므로 여기서는 ref 동기화에 집중한다.

## 학습 목표

- remote, remote-tracking branch, upstream의 차이를 설명할 수 있다.
- `git fetch`가 객체와 `refs/remotes/*`를 갱신하지만 작업 트리와 현재 브랜치를 바꾸지 않는다는 점을 확인할 수 있다.
- `git pull`을 fetch 후 merge 또는 fetch 후 rebase로 분해해 판단할 수 있다.
- `git push`가 로컬 ref로 원격 ref를 갱신하라는 요청이며, non-fast-forward 거부가 데이터 손실 방지 장치임을 설명할 수 있다.
- refspec과 `--force-with-lease`의 의미를 협업 안전성 관점에서 해석할 수 있다.

## 배경: 왜 이것이 존재하는가

Git의 원격 저장소(remote)는 "진짜 저장소"이고 로컬은 "복사본"이라는 위계가 아니다. 둘 다 Git 저장소다. 원격이라는 말은 로컬 저장소 입장에서 네트워크나 다른 경로에 있는 저장소를 가리키는 이름일 뿐이다. `origin`도 특별한 키워드가 아니라 clone할 때 관례적으로 붙는 remote 이름이다.

이 관점은 협업 사고를 설명하는 데 중요하다. `git fetch`는 원격의 객체와 ref 상태를 로컬에 관찰 결과로 가져온다. `git push`는 로컬의 특정 ref 상태로 원격 ref를 갱신해 달라고 요청한다. 둘 다 "파일을 업로드/다운로드"하는 명령이라기보다, 객체 데이터베이스를 보강하고 ref를 움직이는 프로토콜이다.

원격 협업에서의 충돌은 보통 파일 충돌보다 먼저 ref 충돌로 나타난다. 내가 마지막으로 본 `origin/main` 이후 누군가 원격 `main`을 앞으로 움직였다면, 내 로컬 `main`을 그대로 push하는 것은 원격 ref를 되감는 행위가 된다. Git이 이를 기본적으로 거부하는 이유는 중앙 권위 때문이 아니라, 내가 보지 못한 커밋을 잃게 만들 수 있기 때문이다.

## 핵심 개념

### remote는 다른 저장소의 별칭이다

로컬 bare 저장소를 원격 역할로 두고 clone 두 개를 만든다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init --bare remote.git

git clone remote.git alice
git clone remote.git bob

cd alice
git switch -c main
git config user.name "Alice"
git config user.email "alice@example.com"
printf "hello\n" > README.md
git add README.md
git commit -m "Initial commit"
git push -u origin main
```

`remote.git`은 작업 트리가 없는 bare 저장소다. 서버에서 흔히 쓰는 형태지만, 본질은 일반 Git 저장소와 같다. `alice` 저장소에서 remote 정보를 확인한다.

```sh
git remote -v
git config --get-regexp '^remote\.origin\.'
```

`origin`은 URL과 fetch refspec을 가진 설정 항목이다. clone이 만든 기본 fetch refspec은 보통 다음 모양이다.

```text
+refs/heads/*:refs/remotes/origin/*
```

뜻은 "원격의 `refs/heads/*`를 로컬의 `refs/remotes/origin/*`로 가져온다"이다. `origin/main`은 원격 브랜치 자체가 아니라, 마지막 fetch 때 로컬이 관찰한 원격 `main`의 상태다.

### fetch는 관찰 결과를 갱신한다

`bob` 저장소에서 원격 상태를 가져온다.

```sh
cd "$tmp/bob"
git fetch origin
git branch -r
git log --oneline --decorate --all
```

`origin/main`은 생겼지만, 로컬 `main`이 자동으로 생기거나 작업 트리가 바뀌지는 않는다. fetch는 객체를 내려받고 remote-tracking ref를 갱신한다. 현재 브랜치와 인덱스와 작업 트리는 그대로 둔다.

로컬 브랜치를 만들고 upstream을 연결한다.

```sh
git switch -c main --track origin/main
git branch -vv
```

upstream은 이 로컬 브랜치가 기본 비교 대상으로 삼는 원격 브랜치다. `git status`의 ahead/behind, 인자 없는 `git pull`, 기본 `git push`가 이 관계를 사용한다.

### pull은 fetch와 통합을 합친 명령이다

`git pull`은 독립적인 마법이 아니다. 기본적으로 다음 두 단계다.

```sh
git fetch
git merge @{upstream}
```

설정에 따라 두 번째 단계가 rebase가 될 수 있다.

```sh
git pull --rebase
```

이 차이는 이력 모양을 바꾼다. merge pull은 원격 변경과 내 로컬 변경이 갈라졌을 때 merge commit을 만들 수 있다. rebase pull은 내 로컬 커밋을 원격 최신 커밋 위에 새로 재생한다. 팀이 규칙을 정하지 않고 각자 다른 기본값을 쓰면 같은 저장소 안에 merge commit과 선형 재작성 이력이 섞인다.

| 방식 | 그래프 결과 | 장점 | 위험 |
|---|---|---|---|
| `pull` 기본 merge | 필요하면 merge commit | 공개 커밋 해시를 보존한다 | 작은 동기화 merge commit이 많이 생길 수 있다 |
| `pull --rebase` | 로컬 커밋을 원격 끝 위로 재생 | 개인 브랜치 이력이 선형이다 | 이미 공유한 커밋을 재작성하면 협업자가 흔들린다 |
| `fetch` 후 수동 판단 | 통합 방식을 명시 선택 | 그래프를 확인하고 결정한다 | 한 단계 더 필요하다 |

복잡한 상황에서는 `pull`보다 `fetch` 후 `log --graph`로 상태를 보고 merge/rebase를 명시하는 편이 낫다.

```sh
git fetch origin
git log --graph --oneline --decorate --all --max-count=20
```

### push는 원격 ref 갱신 요청이다

`alice`와 `bob`이 같은 원격 브랜치에 서로 다른 커밋을 push하는 상황을 만든다.

```sh
cd "$tmp/alice"
printf "alice\n" >> README.md
git add README.md
git commit -m "Alice update"
git push

cd "$tmp/bob"
git config user.name "Bob"
git config user.email "bob@example.com"
printf "bob\n" >> README.md
git add README.md
git commit -m "Bob update"
git push
```

`bob`의 push는 거부된다.

```text
! [rejected] main -> main (fetch first)
```

원격 `main`은 Alice의 커밋으로 이미 앞으로 이동했다. Bob의 로컬 `main`은 그 커밋을 조상으로 포함하지 않는다. Bob의 push를 받아들이면 원격 `main`에서 Alice의 커밋이 보이지 않게 된다. Git은 non-fast-forward 갱신을 기본 거부해 이를 막는다.

해결은 먼저 원격 상태를 가져와 통합하는 것이다.

```sh
git fetch origin
git log --graph --oneline --decorate --all
git merge origin/main
# 또는 개인 브랜치라면 git rebase origin/main
git push
```

파일 충돌이 나면 [7-4](./04-branching-merging-and-conflicts.md)의 절차대로 해결한다.

### refspec은 ref 매핑 규칙이다

일상 명령에서는 refspec을 직접 쓰지 않아도 된다. 하지만 refspec을 알면 fetch와 push의 본질이 선명해진다.

```sh
git push origin main:refs/heads/review/main-copy
```

이 명령은 로컬 `main`이 가리키는 커밋으로 원격의 `refs/heads/review/main-copy`를 갱신해 달라는 요청이다. 왼쪽이 로컬 소스, 오른쪽이 원격 목적지다.

fetch refspec은 반대 방향이다.

```sh
git fetch origin refs/heads/main:refs/remotes/origin/main
```

원격 `refs/heads/main`을 로컬 `refs/remotes/origin/main`에 기록한다. `+`가 앞에 붙으면 non-fast-forward 갱신도 허용한다. remote-tracking ref는 관찰 결과이므로 강제 갱신이 일반적이지만, 로컬 브랜치나 원격 공유 브랜치에 `+`를 쓰는 것은 다른 의미를 갖는다.

### force push와 lease는 ref 경쟁을 다룬다

force push는 원격 ref를 fast-forward가 아니어도 갱신하라는 요청이다.

```sh
git push --force origin main
```

이 명령은 원격의 현재 상태를 내가 마지막으로 본 상태와 비교하지 않고 덮을 수 있다. 협업자가 이미 새 커밋을 push했어도 그 커밋을 원격 브랜치 이름에서 떨어뜨릴 수 있다.

`--force-with-lease`는 더 나은 기본값이다.

```sh
git push --force-with-lease origin my-branch
```

lease는 "원격 ref가 내가 마지막으로 관찰한 값과 같을 때만 강제 갱신한다"는 조건이다. 내가 fetch한 뒤 누군가 같은 브랜치에 push했다면 실패한다. 이는 optimistic concurrency control과 비슷하다. 내가 본 버전이 아직 최신일 때만 쓰기를 허용한다.

그래도 `--force-with-lease`가 모든 문제를 없애지는 않는다. 잘못된 브랜치에 실행하면 여전히 위험하고, 내가 fetch를 자동으로 자주 실행하는 도구를 쓰면 lease의 기대값이 바뀔 수 있다. 공유 브랜치에서는 보호 규칙으로 force push 자체를 막는 것이 더 강한 방어다.

## 실무 관점

### fetch 먼저, 통합은 의식적으로 한다

팀에서 자주 발생하는 문제는 `pull`이 너무 많은 일을 한 번에 한다는 점이다. 작은 개인 브랜치에서는 편리하지만, main과 오래 갈라진 브랜치에서는 fetch와 통합을 분리하는 편이 상태를 더 잘 이해하게 해 준다.

```sh
git fetch origin
git status
git branch -vv
git log --graph --oneline --decorate --all --max-count=30
```

이 네 가지는 원격 동기화 전의 진단 루틴으로 충분하다.

| 질문 | 확인 명령 | 의미 |
|---|---|---|
| 내 브랜치의 upstream은 무엇인가 | `git branch -vv` | 기본 pull/push 대상 |
| 원격 main이 어디까지 왔는가 | `git log origin/main` | 마지막 fetch 기준 원격 상태 |
| 내 커밋이 원격에 없는가 | `git log @{upstream}..HEAD` | 내가 ahead인 커밋 |
| 원격 커밋이 내게 없는가 | `git log HEAD..@{upstream}` | 내가 behind인 커밋 |

### 원격 브랜치를 중앙 진실로 착각하지 않는다

`origin/main`은 원격의 실시간 상태가 아니다. 마지막 fetch 때 로컬이 기록한 관찰값이다. 원격 서버에서 main이 바뀌었어도 fetch 전까지 로컬 `origin/main`은 바뀌지 않는다. 따라서 force-with-lease나 ahead/behind 판단은 "내가 마지막으로 관찰한 상태"를 기준으로 한다.

이 한계를 이해하면 CI 실패나 PR 충돌 표시도 더 정확히 읽을 수 있다. 호스팅 플랫폼은 서버 쪽 최신 ref로 계산하고, 로컬은 마지막 fetch 결과로 계산한다. 둘이 다르면 먼저 fetch해야 한다.

## 더 깊이

### push.default와 upstream 설정은 팀 혼란의 원인이 될 수 있다

Git의 `push.default` 설정은 인자 없는 `git push`가 무엇을 push할지 결정한다.

```sh
git config --get push.default
```

현대 Git의 기본값은 보통 `simple`이다. 현재 브랜치의 upstream 이름이 같을 때만 push한다. 예전 설정이나 개인 설정에 따라 `matching`, `current` 등이 쓰이면 의도치 않은 브랜치가 push될 수 있다. 팀 문서에는 다음처럼 명시하는 편이 좋다.

```sh
git config --global push.default simple
git config --global pull.ff only
```

`pull.ff only`는 fast-forward가 아닐 때 pull merge를 만들지 않고 실패하게 한다. 모든 팀에 맞는 기본값은 아니지만, "동기화 merge commit을 만들지 않는다"는 정책이 있는 팀에는 유용하다.

### shallow clone과 partial clone은 이력 가시성을 줄인다

CI에서 속도를 위해 `--depth=1` shallow clone을 쓰면 전체 이력이 없다. `git describe`, `git bisect`, 변경 범위 계산, merge base 계산이 예상과 다르게 동작할 수 있다. partial clone은 필요한 객체를 지연해서 가져오는 방식이다. 대형 저장소에는 유용하지만, 모든 도구가 지연 객체를 잘 다루는지 확인해야 한다.

성능 최적화로 clone 범위를 줄일 때는 어떤 Git 기능이 전체 이력을 요구하는지 함께 점검해야 한다.

## 정리

- remote는 다른 Git 저장소의 별칭이고, `origin`은 관례적 이름일 뿐이다.
- `fetch`는 객체와 remote-tracking ref를 갱신하지만 현재 브랜치와 작업 트리를 바꾸지 않는다.
- `pull`은 fetch 후 merge 또는 rebase이므로, 이력 모양을 결정하는 정책이 필요하다.
- `push`는 원격 ref 갱신 요청이며, non-fast-forward 거부는 다른 사람의 커밋을 잃지 않게 하는 안전장치다.
- force push가 필요하면 공유 브랜치가 아닌지 확인하고, 기본적으로 `--force-with-lease`와 보호 브랜치 정책을 사용한다.

## 확인 문제

1. `git fetch origin` 후 `origin/main`은 최신이 되었지만 작업 트리 파일은 바뀌지 않았다. 왜 정상인가?

<details>
<summary>정답과 해설</summary>

fetch는 원격 객체를 내려받고 `refs/remotes/origin/*` 같은 remote-tracking ref를 갱신하는 명령이다. 현재 로컬 브랜치, 인덱스, 작업 트리는 바꾸지 않는다. 작업 트리를 바꾸려면 merge, rebase, switch 같은 별도 단계가 필요하다.

</details>

2. push가 `non-fast-forward`로 거부되었다. 이 거부가 보호하는 것은 무엇인가?

<details>
<summary>정답과 해설</summary>

원격 ref에서 이미 도달 가능한 다른 사람의 커밋을 잃지 않게 보호한다. 내 로컬 브랜치가 원격 브랜치의 최신 커밋을 조상으로 포함하지 않는 상태에서 push하면 원격 ref가 되감길 수 있다. 먼저 fetch 후 merge 또는 rebase로 원격 변경을 통합해야 한다.

</details>

3. `--force-with-lease`가 `--force`보다 안전한 이유와 여전히 위험한 이유를 설명하라.

<details>
<summary>정답과 해설</summary>

`--force-with-lease`는 원격 ref가 내가 마지막으로 관찰한 값과 같을 때만 강제 갱신한다. 누군가 그 사이에 push했다면 실패하므로 협업자의 새 커밋을 덮을 가능성을 줄인다. 그러나 잘못된 브랜치에 실행하면 여전히 위험하고, 공유 브랜치에서 이력 재작성 자체가 팀의 base를 흔들 수 있다. 보호 브랜치와 팀 합의가 필요하다.

</details>

## 참고 자료

- [git-remote manual](https://git-scm.com/docs/git-remote) — remote 이름과 URL 관리 방법을 확인할 수 있다.
- [git-fetch manual](https://git-scm.com/docs/git-fetch) — fetch refspec과 remote-tracking ref 갱신 규칙을 설명한다.
- [git-pull manual](https://git-scm.com/docs/git-pull) — pull이 fetch와 통합 단계로 구성됨을 확인할 수 있다.
- [git-push manual](https://git-scm.com/docs/git-push) — push refspec, fast-forward 규칙, force-with-lease 옵션을 설명한다.
- [Git Book: Working with Remotes](https://git-scm.com/book/en/v2/Git-Basics-Working-with-Remotes) — 원격 저장소와 fetch/push의 기본 흐름을 공식 튜토리얼로 확인할 수 있다.
