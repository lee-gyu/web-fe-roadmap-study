import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DefaultTheme } from 'vitepress';

export interface PhaseDoc {
  phase: number;
  order: number;
  title: string;
  shortTitle: string;
  link: string;
}

export interface PhaseGroup {
  phase: number;
  text: string;
  docs: PhaseDoc[];
}

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const phaseDirectoryPattern = /^phase-(\d+)$/;
const documentFilePattern = /^(\d+)-.+\.md$/;
const headingPattern = /^#\s+(.+?)\s*$/m;

const PHASE_LABELS: Record<number, string> = {
  0: 'Phase 0. 웹 플랫폼의 이해',
  1: 'Phase 1. HTML & CSS',
  2: 'Phase 2. HTTP 프로토콜',
  3: 'Phase 3. JavaScript 언어와 런타임',
};

function phaseLabel(phase: number): string {
  return PHASE_LABELS[phase] ?? `Phase ${phase}`;
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
      const match = entry.name.match(phaseDirectoryPattern);
      return match ? { name: entry.name, phase: Number(match[1]) } : null;
    })
    .filter((entry): entry is { name: string; phase: number } => entry !== null)
    .sort((a, b) => a.phase - b.phase)
    .map(({ name, phase }) => {
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
            phase,
            order,
            title,
            shortTitle: trimTitle(title),
            link: `/${name}/${slug}`,
          };
        })
        .sort((a, b) => a.order - b.order);

      return {
        phase,
        text: phaseLabel(phase),
        docs,
      };
    })
    .filter((group) => group.docs.length > 0);
}

export function buildNav(): DefaultTheme.NavItem[] {
  const documentItems: DefaultTheme.NavItemWithLink[] = getPhaseGroups().map((group) => ({
    text: group.text,
    link: group.docs[0].link,
    activeMatch: `/phase-${group.phase}/`,
  }));

  return [
    { text: '홈', link: '/' },
    { text: '문서', items: documentItems },
    { text: '로드맵', link: '/#전체-커리큘럼' },
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
