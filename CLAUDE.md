# CLAUDE.md — 저장소 작업 지침

이 저장소는 5년차 이상 경력 개발자를 위한 웹 프론트엔드 심화 교육 자료다.
에이전트는 이 문서를 진입점으로 삼고, 작업 범위에 맞는 상세 지침만 추가로 읽는다.

## 기준 문서

- [ROADMAP.md](ROADMAP.md)는 커리큘럼의 목표, 범위, 순서, 파일 경로를 관리한다.
- [PROGRESS.md](PROGRESS.md)는 문서 작성 진행 상태와 미완료 TODO를 관리한다.
- `docs/`의 Markdown은 교육 콘텐츠의 canonical 원본이다.
- 도구와 의존성 정보는 `mise.toml`, `package.json`을 기준으로 확인한다.
- 상세 실행 규칙은 `.agents/`의 작업별 지침이 소유한다. 다른 문서에 같은 규칙을 복제하지 않는다.

## 작업별 지침

작업을 시작하기 전에 변경 대상을 분류하고 다음 문서를 읽는다.

| 작업 범위 | 필수 지침 |
| --- | --- |
| `docs/phase-*`, `docs/appendix-*` 집필·수정·검토 | [.agents/content-writing.md](.agents/content-writing.md) |
| `ROADMAP.md`, `PROGRESS.md`, `plan/`, `exercises/` 관리 | [.agents/curriculum-management.md](.agents/curriculum-management.md) |
| VitePress, 패키지, 도구 버전, CI·배포 관리 | [.agents/repository-operations.md](.agents/repository-operations.md) |

작업이 여러 범위에 걸치면 해당 지침을 모두 적용한다. 예를 들어 챕터를 추가하면 콘텐츠 집필 지침과 커리큘럼 관리 지침을 함께 읽는다. 새 Phase·부록 디렉터리를 만들거나 VitePress 내비게이션에 새 그룹이 생기는 작업은 사이트 동작 변경이므로 저장소 운영 지침과 `docs/.vitepress/navigation.ts` 점검까지 작업 범위에 포함한다.

## 공통 원칙

- 먼저 관련 기준 문서와 기존 구현을 확인하고 현재 패턴을 따른다.
- 요청 범위 밖의 파일과 기존 사용자 변경을 보존한다.
- 기준 문서와 상세 지침이 충돌하면 기준 문서를 우선하고, 지침의 불일치를 함께 알린다.
- 변경 범위에 맞는 검증을 실행하고, 실행하지 못한 검증은 완료한 것으로 표현하지 않는다.
