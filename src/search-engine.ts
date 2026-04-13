import MiniSearch from 'minisearch';

interface BlockDoc {
  id: string;
  uuid: string;
  pageName: string;
  content: string;
}

interface PageDoc {
  id: string;
  pageName: string;
  content: string;
}

let blockSearchIndex: MiniSearch<BlockDoc> | null = null;
let pageSearchIndex: MiniSearch<PageDoc> | null = null;

interface FlatBlock {
  uuid: string;
  content: string;
}

const defaultTokenize = MiniSearch.getDefault('tokenize');
const cjkCharPattern = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const mixedScriptSegmentPattern = /[A-Za-z0-9]+|[\u3400-\u9FFF\uF900-\uFAFF]+/g;

function tokenizeWithCjkSupport(text: string): string[] {
  const tokens = new Set<string>();

  for (const token of defaultTokenize(text)) {
    if (!token) continue;
    tokens.add(token);

    const mixedSegments = token.match(mixedScriptSegmentPattern) || [];
    for (const segment of mixedSegments) {
      if (!segment || segment === token) continue;
      tokens.add(segment);
    }

    if (!cjkCharPattern.test(token)) continue;

    const cjkChars = mixedSegments
      .filter((segment) => cjkCharPattern.test(segment))
      .flatMap((segment) => Array.from(segment))
      .filter((char) => cjkCharPattern.test(char));

    // Index individual Han characters so suffix matches like "试" can find "测试".
    if (cjkChars.length > 1) {
      cjkChars.forEach((char) => tokens.add(char));
    }
  }

  return Array.from(tokens);
}

function flattenBlocks(blocks: any[]): FlatBlock[] {
  const result: FlatBlock[] = [];
  for (const block of blocks) {
    if (block.content?.trim()) {
      result.push({ uuid: block.uuid, content: block.content });
    }
    if (block.children?.length) result.push(...flattenBlocks(block.children));
  }
  return result;
}

function createBlockIndex(): MiniSearch<BlockDoc> {
  return new MiniSearch<BlockDoc>({
    fields: ['pageName', 'content'],
    storeFields: ['uuid', 'pageName', 'content'],
    tokenize: tokenizeWithCjkSupport,
    searchOptions: {
      fuzzy: 0.2,
      prefix: true,
      boost: { pageName: 2 }
    }
  });
}

function createPageIndex(): MiniSearch<PageDoc> {
  return new MiniSearch<PageDoc>({
    fields: ['pageName'],
    storeFields: ['pageName', 'content'],
    tokenize: tokenizeWithCjkSupport,
    searchOptions: {
      fuzzy: 0.2,
      prefix: true
    }
  });
}

let indexReady = false;
let indexPromise: Promise<void> | null = null;

export async function buildIndex(): Promise<void> {
  if (indexReady && blockSearchIndex && pageSearchIndex) return;
  if (indexPromise) return indexPromise;

  indexPromise = doBuildIndex();
  await indexPromise;
  indexPromise = null;
}

async function doBuildIndex(): Promise<void> {
  const blockIdx = createBlockIndex();
  const pageIdx = createPageIndex();

  const pages = await logseq.Editor.getAllPages();
  if (!pages) return;

  const blockDocs: BlockDoc[] = [];
  const pageDocs: PageDoc[] = [];

  const BATCH = 10;
  const filtered = pages.filter((p: any) => !p.name.startsWith('__'));

  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (page: any) => {
        const pageName = page.originalName || page.name;
        const blocks = await logseq.Editor.getPageBlocksTree(page.name);
        const flatBlocks = blocks ? flattenBlocks(blocks) : [];
        return {
          pageDoc: {
            id: `page-${page.id}`,
            pageName,
            content: flatBlocks[0]?.content || ''
          },
          blockDocs: flatBlocks.map((b) => ({
          id: `${page.id}-${b.uuid}`,
          uuid: b.uuid,
          pageName,
          content: b.content
          }))
        };
      })
    );
    for (const result of batchResults) {
      pageDocs.push(result.pageDoc);
      blockDocs.push(...result.blockDocs);
    }
  }

  blockIdx.addAll(blockDocs);
  pageIdx.addAll(pageDocs);
  blockSearchIndex = blockIdx;
  pageSearchIndex = pageIdx;
  indexReady = true;
  const journals = filtered.filter((p: any) => p['journal?']).length;
  console.log(`[Fuzzy Search] Indexed ${blockDocs.length} blocks across ${filtered.length} pages (${journals} journals)`);
}

export function invalidateIndex(): void {
  indexReady = false;
}

export function isIndexReady(): boolean {
  return indexReady && blockSearchIndex !== null && pageSearchIndex !== null;
}

export interface SearchResult {
  kind: 'block' | 'page';
  pageName: string;
  uuid?: string;
  content: string;
  score: number;
}

interface SearchOptions {
  titleOnly?: boolean;
}

export function search(query: string, options: SearchOptions = {}): SearchResult[] {
  if (!query.trim()) return [];

  if (options.titleOnly) {
    if (!pageSearchIndex) return [];

    return pageSearchIndex.search(query).slice(0, 15).map((result) => ({
      kind: 'page',
      pageName: result.pageName,
      content: result.content,
      score: result.score
    }));
  }

  if (!blockSearchIndex) return [];

  return blockSearchIndex.search(query).slice(0, 15).map((result) => ({
    kind: 'block',
    pageName: result.pageName,
    uuid: result.uuid,
    content: result.content,
    score: result.score
  }));
}
