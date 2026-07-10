import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DefaultTheme } from 'vitepress';

export interface PhaseDoc {
  phase: number | null;
  order: number;
  title: string;
  shortTitle: string;
  link: string;
}

export interface PhaseGroup {
  id: string;
  phase: number | null;
  sortOrder: number;
  text: string;
  activeMatch: string;
  docs: PhaseDoc[];
}

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const phaseDirectoryPattern = /^phase-(\d+)([a-z]?)$/;
const appendixDirectoryPattern = /^appendix-([a-z])$/;
const documentFilePattern = /^(\d+)-.+\.md$/;
const headingPattern = /^#\s+(.+?)\s*$/m;

const PHASE_LABELS: Record<string, string> = {
  0: 'Phase 0. 웹 플랫폼의 이해',
  1: 'Phase 1. HTML & CSS',
  2: 'Phase 2. HTTP 프로토콜',
  3: 'Phase 3. JavaScript 언어와 런타임',
  4: 'Phase 4. TypeScript 타입 시스템',
  5: 'Phase 5. React 렌더링 모델',
  '5a': 'Phase 5a. React Patterns',
  6: 'Phase 6. 도구의 내부 동작',
  7: 'Phase 7. Git 변경 이력과 협업 모델',
  8: 'Phase 8. 브라우저·네트워크·보안 심화',
  9: 'Phase 9. 설계 패턴',
  10: 'Phase 10. 실전 프로젝트와 기술 검증',
  11: 'Phase 11. AI 에이전트 활용',
};

const APPENDIX_LABELS: Record<string, string> = {
  a: '부록 A. 사고법과 경험 법칙',
  b: '부록 B. 소프트웨어 아키텍처 패턴',
};

function phaseLabel(phaseId: string): string {
  return PHASE_LABELS[phaseId] ?? `Phase ${phaseId}`;
}

function phaseSortOrder(phase: number, suffix: string): number {
  if (!suffix) {
    return phase;
  }

  return phase + (suffix.charCodeAt(0) - 'a'.charCodeAt(0) + 1) / 100;
}

function directoryConfig(name: string): Omit<PhaseGroup, 'docs'> | null {
  const phaseMatch = name.match(phaseDirectoryPattern);

  if (phaseMatch) {
    const phase = Number(phaseMatch[1]);
    const suffix = phaseMatch[2] ?? '';
    const phaseId = `${phase}${suffix}`;

    return {
      id: name,
      phase,
      sortOrder: phaseSortOrder(phase, suffix),
      text: phaseLabel(phaseId),
      activeMatch: `/${name}/`,
    };
  }

  const appendixMatch = name.match(appendixDirectoryPattern);

  if (appendixMatch) {
    const appendix = appendixMatch[1];

    return {
      id: name,
      phase: null,
      sortOrder: 1000 + appendix.charCodeAt(0),
      text: APPENDIX_LABELS[appendix] ?? `부록 ${appendix.toUpperCase()}`,
      activeMatch: `/${name}/`,
    };
  }

  return null;
}

function trimTitle(title: string): string {
  return title.split(/\s+[—-]\s+|:\s+/)[0] ?? title;
}

function readDocumentTitle(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(headingPattern);

  if (!match) {
    throw new Error(`Missing first-level heading: ${filePath}`);
  }

  return match[1].trim();
}

export function getPhaseGroups(): PhaseGroup[] {
  if (!existsSync(docsRoot)) {
    return [];
  }

  return readdirSync(docsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const config = directoryConfig(entry.name);
      return config ? { name: entry.name, config } : null;
    })
    .filter((entry): entry is { name: string; config: Omit<PhaseGroup, 'docs'> } => entry !== null)
    .sort((a, b) => a.config.sortOrder - b.config.sortOrder)
    .map(({ name, config }) => {
      const phasePath = join(docsRoot, name);
      const docs = readdirSync(phasePath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => {
          const match = entry.name.match(documentFilePattern);

          if (!match) {
            throw new Error(
              `Phase document filename must start with a numeric prefix: ${join(name, entry.name)}`,
            );
          }

          const order = Number(match[1]);
          const title = readDocumentTitle(join(phasePath, entry.name));
          const slug = basename(entry.name, '.md');

          return {
            phase: config.phase,
            order,
            title,
            shortTitle: trimTitle(title),
            link: `/${name}/${slug}`,
          };
        })
        .sort((a, b) => a.order - b.order);

      return {
        ...config,
        docs,
      };
    })
    .filter((group) => group.docs.length > 0);
}

export function buildNav(): DefaultTheme.NavItem[] {
  const documentItems: DefaultTheme.NavItemWithLink[] = getPhaseGroups().map((group) => ({
    text: group.text,
    link: group.docs[0].link,
    activeMatch: group.activeMatch,
  }));

  return [
    { text: '홈', link: '/' },
    { text: '문서', items: documentItems }
  ];
}

export function buildSidebar(): DefaultTheme.SidebarItem[] {
  return getPhaseGroups().map((group) => ({
    text: group.text,
    collapsed: false,
    items: group.docs.map((doc) => ({
      text: doc.shortTitle,
      link: doc.link,
    })),
  }));
}
