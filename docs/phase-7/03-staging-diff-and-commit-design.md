# 7-3. 스테이징·diff·커밋 설계

> 한 줄 요약: 이 문서를 읽고 나면 `git add`와 `git diff`를 인덱스 스냅샷 관점에서 해석하고, 리뷰·revert·bisect에 견디는 커밋 단위를 설계할 수 있다.

이 문서의 예제는 Git 2.43.0에서 검증했다. 커밋 메시지 규칙은 Git 자체의 강제 규칙이 아니라 팀 자동화와 리뷰 비용을 줄이기 위한 운영 규칙으로 다룬다.

## 학습 목표

- 인덱스가 다음 커밋의 tree를 구성하는 자료구조임을 `git ls-files -s`로 확인할 수 있다.
- `git diff`, `git diff --cached`, `git diff HEAD`가 비교하는 두 영역을 구분할 수 있다.
- `git add -p`를 이용해 한 파일 안의 변경도 의도 단위로 분리할 수 있다.
- 커밋 메시지의 제목과 본문이 각각 무엇을 설명해야 하는지 판단할 수 있다.
- 의미 단위 커밋이 review, revert, cherry-pick, bisect 비용에 미치는 영향을 설명할 수 있다.

## 배경: 왜 이것이 존재하는가

Git은 작업 트리 전체를 자동으로 커밋하지 않는다. [7-1](./01-git-mental-model.md)에서 본 인덱스가 있기 때문이다. 인덱스는 귀찮은 중간 단계가 아니라 "다음 커밋의 스냅샷을 설계하는 공간"이다. 이 단계가 없으면 커밋 단위는 편집기의 저장 단위나 파일 단위에 끌려간다.

경력 개발자에게 커밋은 단순한 백업 지점이 아니다. 커밋은 미래의 리뷰어가 읽는 변경 단위이고, 장애 상황에서 revert할 운영 단위이며, `git bisect`가 탐색하는 검색 공간이다. 커밋이 엉키면 리뷰는 diff 해석 게임이 되고, revert는 의도치 않은 변경까지 되돌리며, bisect는 "이 커밋은 빌드가 원래 깨진다"는 함정에 빠진다.

따라서 이 문서의 초점은 "어떤 명령으로 커밋하는가"가 아니라 "무엇을 하나의 커밋으로 인정할 것인가"다. 인덱스와 diff는 그 설계를 구현하는 도구다.

## 핵심 개념

### 인덱스는 다음 tree의 초안이다

`git add`는 파일을 저장하지 않는다. 작업 트리의 현재 내용을 blob 객체로 만들고, 해당 경로의 인덱스 엔트리를 그 blob으로 갱신한다. 다음 커밋은 인덱스를 tree 객체로 쓰면서 만들어진다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

printf "alpha\n" > app.txt
git add app.txt
git ls-files -s
git commit -m "Add app"

printf "beta\n" >> app.txt
git add app.txt
git ls-files -s
```

`git ls-files -s`는 인덱스 엔트리를 보여 준다. 출력에는 파일 모드, blob 해시, stage 번호, 경로가 포함된다.

```text
100644 <blob-hash> 0	app.txt
```

stage 번호 `0`은 충돌이 없는 일반 상태를 뜻한다. merge 충돌 중에는 같은 경로가 stage 1, 2, 3으로 나뉘어 나타날 수 있다. 이 구조는 [7-4](./04-branching-merging-and-conflicts.md)의 충돌 해결에서 다시 나온다.

### diff는 비교쌍을 명시해야 정확하다

같은 파일을 두 번 수정해서 인덱스와 작업 트리를 다르게 만들어 보자.

```sh
printf "gamma\n" >> app.txt
git add app.txt
printf "delta\n" >> app.txt

git status --short
git diff
git diff --cached
git diff HEAD
```

각 명령의 질문은 다르다.

| 명령 | 비교 | 실무 질문 |
|---|---|---|
| `git diff` | 작업 트리 vs 인덱스 | 아직 커밋 후보에 넣지 않은 변경이 무엇인가 |
| `git diff --cached` | 인덱스 vs `HEAD` | 지금 커밋하면 무엇이 들어가는가 |
| `git diff HEAD` | 작업 트리 vs `HEAD` | 마지막 커밋 이후 전체 변경이 무엇인가 |
| `git diff --stat` | 지정 비교의 요약 | 리뷰 전에 변경 규모가 합리적인가 |
| `git diff --word-diff` | 단어 단위 차이 | 문서나 긴 문자열 변경을 줄 단위보다 세밀하게 볼 필요가 있는가 |

리뷰 전에 반드시 확인해야 하는 것은 보통 `git diff --cached`다. 커밋에 들어가는 것은 작업 트리 전체가 아니라 인덱스이기 때문이다. `git diff`만 보고 "좋다"고 판단하면 stage된 변경을 놓칠 수 있다.

### patch staging은 의도 단위를 만든다

한 파일 안에 서로 다른 의도의 변경이 섞이는 상황은 흔하다. 예를 들어 버그 수정 중 로그 문구를 고치고, 근처의 타입 이름도 정리하고, 테스트도 추가한다. 파일 단위 커밋은 이 셋을 섞어 버린다. `git add -p`는 hunk 단위로 인덱스에 올릴지 선택하게 해 준다.

```sh
tmp=$(mktemp -d)
cd "$tmp"
git init -b main
git config user.name "Phase Seven"
git config user.email "phase7@example.com"

cat > calculator.js <<'EOF'
export function divide(a, b) {
  return a / b;
}

export function format(value) {
  return String(value);
}
EOF
git add calculator.js
git commit -m "Add calculator"

cat > calculator.js <<'EOF'
export function divide(a, b) {
  if (b === 0) {
    throw new Error("division by zero");
  }
  return a / b;
}

export function formatNumber(value) {
  return String(value);
}
EOF

git add -p calculator.js
```

대화형 UI에서 hunk가 너무 크면 `s`로 더 잘게 나눌 수 있다. 변경이 붙어 있어 자동 분리가 어렵다면 파일을 잠시 편집해 첫 커밋의 변경만 남긴 뒤 stage하고, 나머지를 다시 적용하는 방식도 가능하다. 핵심은 "한 커밋이 하나의 판단 가능한 의도를 갖는가"다.

### 커밋 메시지는 diff가 말하지 않는 것을 말한다

diff는 무엇이 바뀌었는지 보여 준다. 좋은 커밋 메시지는 왜 바뀌었는지, 어떤 제약 때문에 이 형태를 선택했는지, 나중에 읽는 사람이 어떤 맥락을 알아야 하는지를 말한다.

```text
Guard division by zero in calculator

The public API previously returned Infinity for zero divisors because it
delegated directly to JavaScript number division. The caller treats non-finite
values as valid amounts, so reject the input at the boundary instead.
```

제목은 명령형 또는 서술형 중 팀 규칙에 맞추면 된다. 중요한 것은 제목이 변경의 의도를 압축하고, 본문이 diff에서 보이지 않는 판단 근거를 남긴다는 점이다.

Conventional Commits는 `feat:`, `fix:`, `refactor:` 같은 접두사를 강제하는 문법이 아니다. 릴리스 노트 생성, semantic versioning, 검색, CI 정책 같은 자동화에 커밋 메시지를 입력으로 쓰기 위한 메타데이터 규칙이다. 자동화를 쓰지 않는 팀이라면 모든 접두사가 비용일 수 있다. 자동 릴리스를 운영하는 라이브러리라면 메시지 형식이 API 변경 기록의 일부가 된다.

### `.gitignore`는 커밋 설계의 일부다

커밋 단위가 좋더라도 불필요한 산출물이 들어오면 이력은 빠르게 오염된다. ignore 규칙은 Git이 untracked 파일을 보여 줄지 말지를 결정한다.

```sh
printf "node_modules/\ndist/\n.env.local\n" > .gitignore
git add .gitignore
git commit -m "Add ignore rules"
```

그러나 ignore는 이미 tracked인 파일을 제거하지 않는다. 또한 모든 생성 파일을 무조건 ignore하는 것도 답이 아니다. lockfile은 생성물이지만 의존성 해석 결과를 고정하는 입력이므로 보통 추적한다. 반대로 빌드 산출물은 배포 전략에 따라 추적하지 않을 수도 있고, 정적 호스팅용 별도 브랜치에만 둘 수도 있다. 기준은 "이 파일이 소스인가, 재현 가능한 산출물인가, 배포 입력인가"다.

## 실무 관점

### 좋은 커밋은 독립적으로 읽히고 되돌릴 수 있다

커밋 설계의 트레이드오프를 표로 정리하면 다음과 같다.

| 방식 | 장점 | 비용 | 경계 조건 |
|---|---|---|---|
| 큰 작업 커밋 | 작성이 빠르고 히스토리가 짧다 | 리뷰, revert, bisect가 어렵다 | 버그 수정과 리팩터링이 섞이면 운영 사고 때 되돌리기 어렵다 |
| 파일 단위 커밋 | stage가 쉽고 누락이 적다 | 의도 단위와 맞지 않을 수 있다 | 한 기능이 여러 파일을 함께 바꿀 때 각 커밋이 깨진 상태가 된다 |
| 의미 단위 커밋 | 리뷰와 복구가 쉽다 | patch staging과 메시지 비용이 든다 | 너무 잘게 쪼개면 각 커밋의 가치가 사라지고 리뷰 흐름이 끊긴다 |
| squash-only 이력 | main 이력이 단순하다 | 세부 커밋의 조사 가능성이 줄어든다 | 장애 분석에서 작은 도입 지점을 찾아야 할 때 비용이 커진다 |

현실적인 기준은 다음 세 질문이다.

- 이 커밋 하나만 revert해도 시스템이 일관된 상태로 돌아가는가?
- 이 커밋에서 테스트가 실패한다면 원인 범위를 설명할 수 있는가?
- 리뷰어가 이 커밋의 의도를 제목과 diff만으로 따라갈 수 있는가?

세 질문에 계속 실패한다면 커밋 단위가 너무 크거나 서로 다른 의도를 섞고 있는 것이다.

### 리팩터링과 동작 변경은 섞지 않는 편이 낫다

리네임, 파일 이동, 포매팅, 타입 이름 정리 같은 구조 변경은 기능 변경과 섞이면 diff 해석 비용을 크게 늘린다. Git은 리네임을 저장하지 않고 스냅샷 간 유사도로 추론하므로, 대규모 이동과 내용 변경을 한 커밋에 섞으면 추론도 어려워진다.

```sh
# 리뷰가 쉬운 흐름
git mv src/user.js src/domain/user.js
git commit -m "Move user module into domain directory"

# 다음 커밋에서 동작 변경
sed -i 's/isAdmin/hasAdminRole/g' src/domain/user.js
git add src/domain/user.js
git commit -m "Rename admin role predicate"
```

`sed -i`는 macOS와 GNU 환경의 옵션 차이가 있으므로 문서 예시에서는 개념만 본다. 실제 프로젝트에서는 편집기나 codemod를 쓰는 편이 안정적이다.

## 더 깊이

### 인덱스는 충돌 해결의 기록장이기도 하다

merge 충돌 중에는 작업 트리에 충돌 마커가 보이고, 인덱스에는 같은 경로의 여러 버전이 보관된다.

```sh
git ls-files -u
```

출력의 stage 1은 merge base, stage 2는 ours, stage 3은 theirs다. 개발자가 충돌 마커를 지우고 최종 파일을 만든 뒤 `git add`를 실행하면 Git은 그 최종 파일을 stage 0 엔트리로 올리고, 충돌이 해결된 것으로 본다. "충돌 해결 = 파일 편집"이 아니라 "의도한 최종 스냅샷을 인덱스에 기록"이다.

### diff 알고리즘은 사실을 하나로 고정하지 않는다

Git diff는 두 스냅샷 사이의 차이를 사람이 읽기 좋은 형태로 계산한다. 이때 알고리즘 선택에 따라 hunk 모양이 달라질 수 있다. `--histogram`, `--patience`, `--word-diff` 같은 옵션은 같은 변경을 다른 방식으로 보여 준다. 커밋 객체가 diff를 저장하는 것이 아니라 두 스냅샷에서 diff를 계산한다는 사실이 여기서도 중요하다.

대규모 리팩터링 리뷰에서는 `git diff --find-renames`, `git diff --histogram` 같은 옵션이 더 나은 신호를 줄 수 있다. 그러나 알고리즘이 리뷰를 대신하지는 않는다. 가장 강한 최적화는 변경을 의미 단위로 나누는 것이다.

## 정리

- 인덱스는 다음 커밋의 tree를 구성하는 초안이며, `git add`는 작업 트리 내용을 인덱스에 반영한다.
- `git diff` 계열은 비교하는 두 영역을 명시해야 정확하게 해석할 수 있다.
- `git add -p`는 파일 단위가 아니라 의도 단위 커밋을 만드는 핵심 도구다.
- 좋은 커밋 메시지는 diff가 말하는 "무엇"이 아니라 "왜"와 판단 맥락을 남긴다.
- 커밋 단위는 리뷰뿐 아니라 revert, cherry-pick, bisect, 릴리스 노트 자동화 비용을 결정한다.

## 확인 문제

1. `git diff`에는 아무것도 나오지 않지만 `git diff --cached`에는 변경이 나온다. 현재 작업 트리, 인덱스, `HEAD`는 어떤 관계인가?

<details>
<summary>정답과 해설</summary>

작업 트리와 인덱스는 같다. 그래서 `git diff`는 비어 있다. 하지만 인덱스와 `HEAD`는 다르므로 `git diff --cached`에는 다음 커밋에 들어갈 변경이 나온다. 지금 `git commit`을 실행하면 `--cached`에 보이는 내용이 커밋된다.

</details>

2. 버그 수정과 대규모 포매팅을 한 커밋에 넣으면 왜 리뷰와 bisect가 어려워지는가?

<details>
<summary>정답과 해설</summary>

포매팅 변경이 실제 동작 변경 diff를 가린다. 리뷰어는 의미 있는 변경을 찾기 위해 많은 노이즈를 걸러야 하고, `bisect`가 해당 커밋을 원인으로 찾더라도 포매팅과 버그 수정이 섞여 원인 줄을 좁히기 어렵다. 포매팅과 동작 변경은 별도 커밋으로 나누는 편이 좋다.

</details>

3. Conventional Commits를 모든 팀에 무조건 적용해야 하는가? 어떤 조건에서 비용이 이득을 넘는가?

<details>
<summary>정답과 해설</summary>

무조건은 아니다. 릴리스 노트, semantic versioning, changelog 생성, CI 정책이 커밋 메시지를 입력으로 쓴다면 형식화의 이득이 크다. 반대로 커밋 메시지를 자동화 입력으로 쓰지 않고 PR 단위로만 변경을 관리하는 작은 팀에서는 접두사 규칙이 형식 준수 비용만 만들 수 있다. 팀의 자동화와 검색 요구가 판단 기준이다.

</details>

## 참고 자료

- [git-add manual](https://git-scm.com/docs/git-add) — 인덱스에 변경을 추가하는 동작과 patch 모드 옵션을 확인할 수 있다.
- [git-diff manual](https://git-scm.com/docs/git-diff) — 비교 대상 지정, diff 알고리즘, 리네임 감지 옵션을 확인할 수 있다.
- [git-ls-files manual](https://git-scm.com/docs/git-ls-files) — 인덱스 엔트리와 충돌 stage를 관찰하는 방법을 제공한다.
- [Conventional Commits](https://www.conventionalcommits.org/) — 커밋 메시지를 자동화 입력으로 쓰는 규칙의 원문이다.
- [Git Book: Recording Changes to the Repository](https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository) — tracked, staged, committed 상태 전이를 공식 튜토리얼 형태로 확인할 수 있다.
