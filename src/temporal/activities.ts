import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';
import OpenAI from 'openai';
import os from 'node:os';
import pdfParse from 'pdf-parse';
import { updateIndexingJobStatus } from '../scope';
import { deriveIndexNameFromUrl } from '../deriveIndexName';

type CrawlOptions = {
  maxPages?: number;
  sameDomainOnly?: boolean;
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
  timeoutMs?: number;
  concurrency?: number;
  seedUrls?: string[];
  pathPrefix?: string;
  userAgent?: string;
};

type CrawledPage = {
  url: string;
  title: string;
  text: string;
};

type PdfParseResult = {
  text?: string;
  info?: { Title?: string };
  numpages?: number;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_VECTOR_DIMENSION = 1536; // for text-embedding-3-small
const DEFAULT_CRAWLER_UA = 'docs-mcp-crawler/1.0 (+https://hypermodel.dev) axios';

async function ensureVectorStore(client: PgClient, indexName: string, dimension: number) {
  const table = `docs_${indexName}`;
  const quotedTable = `"${table}"`;
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${quotedTable} (
      id BIGSERIAL PRIMARY KEY,
      url TEXT UNIQUE,
      title TEXT,
      content TEXT,
      embedding vector(${dimension}),
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    )`
  );
  // IVFFlat index for faster ANN search
  await client.query(
    `CREATE INDEX IF NOT EXISTS "${table}_embedding_idx" ON ${quotedTable} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
  );
  await client.query(`CREATE INDEX IF NOT EXISTS "${table}_url_idx" ON ${quotedTable} (url)`);
}

function extractMainText(html: string, pageUrl: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $('script, style, noscript, header .sr-only, nav .sr-only').remove();
  // Prefer main/article/common content wrappers; fallback to body
  const candidates = [
    'main',
    'article',
    '#content',
    '.content',
    '.docs-content',
    '.site-content',
    '.slds-container',
  ];
  let container: any = $('body');
  for (const selector of candidates) {
    const el: any = $(selector);
    if (el && el.length) {
      container = el;
      break;
    }
  }
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || pageUrl;
  const text = container.text().replace(/\s+/g, ' ').trim();
  return { title, text };
}

function isLikelyDocUrl(base: URL, target: URL): boolean {
  if (['http:', 'https:'].includes(target.protocol) === false) return false;
  // same domain if required
  if (base.hostname !== target.hostname) return false;
  // ignore non-html assets
  const ASSET_REGEX = /\.(png|jpg|jpeg|gif|svg|pdf|zip|tar|gz|tgz|mp4|mp3|wav|webm|ico)$/i;
  if (ASSET_REGEX.test(target.pathname)) return false;
  return true;
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    // strip common tracking query params
    const params = url.searchParams;
    const trackingPrefixes = ['utm_', 'icid', 'gclid', 'fbclid', 'ref', 'source'];
    for (const key of Array.from(params.keys())) {
      if (trackingPrefixes.some(p => key.toLowerCase().startsWith(p))) {
        params.delete(key);
      }
    }
    // remove trailing slash
    url.pathname = url.pathname.replace(/\/index\.html$/i, '/');
    const normalized = url.toString().replace(/\/$/, '');
    return normalized;
  } catch {
    return u;
  }
}

async function discoverSitemaps(
  startUrl: string,
  timeoutMs: number,
  userAgent?: string
): Promise<string[]> {
  const base = new URL(startUrl);
  const headers = {
    'User-Agent': userAgent || DEFAULT_CRAWLER_UA,
    Accept: 'text/plain,application/xml,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8',
  } as const;

  const candidates = [
    new URL('/robots.txt', base).toString(),
    new URL('/sitemap.xml', base).toString(),
    new URL('/docs/sitemap.xml', base).toString(),
    new URL('/sitemap_index.xml', base).toString(),
  ];
  const sitemapUrls: string[] = [];

  for (const candidate of candidates) {
    try {
      const res = await axios.get(candidate, { timeout: timeoutMs, responseType: 'text', headers });
      const contentType = (res.headers['content-type'] || '').toLowerCase();
      const body: string = res.data ?? '';
      if (candidate.endsWith('robots.txt')) {
        const lines = body.split('\n');
        for (const line of lines) {
          const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
          if (m) sitemapUrls.push(m[1].trim());
        }
      } else if (contentType.includes('xml') || body.trim().startsWith('<?xml')) {
        const $ = cheerio.load(body, { xmlMode: true });
        $('sitemap > loc, url > loc, loc').each((_, el) => {
          const loc = ($(el).text() || '').trim();
          if (loc) sitemapUrls.push(loc);
        });
      } else if (contentType.includes('text/plain')) {
        for (const line of body.split(/\r?\n/)) {
          const loc = line.trim();
          if (loc.startsWith('http')) sitemapUrls.push(loc);
        }
      }
    } catch {
      // ignore
    }
  }

  // De-duplicate and keep same-domain only
  const unique = Array.from(new Set(sitemapUrls))
    .map(normalizeUrl)
    .filter(u => {
      try {
        const x = new URL(u);
        return x.hostname === base.hostname;
      } catch {
        return false;
      }
    });
  return unique;
}

async function expandSitemapsToUrls(
  sitemaps: string[],
  timeoutMs: number,
  userAgent?: string
): Promise<string[]> {
  const headers = {
    'User-Agent': userAgent || DEFAULT_CRAWLER_UA,
    Accept: 'application/xml,text/plain;q=0.9,*/*;q=0.8',
  } as const;
  const urls: string[] = [];
  for (const sm of sitemaps) {
    try {
      const res = await axios.get(sm, { timeout: timeoutMs, responseType: 'text', headers });
      const body: string = res.data ?? '';
      const $ = cheerio.load(body, { xmlMode: true });
      // If it's a sitemap index, it will have <sitemap><loc> children
      if ($('sitemapindex, sitemap').length && $('urlset').length === 0) {
        $('sitemap > loc, loc').each((_, el) => {
          const loc = ($(el).text() || '').trim();
          if (loc) urls.push(loc);
        });
      }
      // If it's a URL set
      $('urlset > url > loc, url > loc').each((_, el) => {
        const loc = ($(el).text() || '').trim();
        if (loc) urls.push(loc);
      });
    } catch {
      // ignore
    }
  }
  return Array.from(new Set(urls.map(normalizeUrl)));
}

async function crawlSite(
  startUrl: string,
  options: CrawlOptions,
  onPage: (page: CrawledPage) => Promise<void>,
  onProgress?: (discovered: number, processed: number) => void
) {
  const {
    maxPages = 200,
    sameDomainOnly = true,
    includePatterns = [],
    excludePatterns = [],
    timeoutMs = 15000,
    concurrency = 4,
    seedUrls = [],
    pathPrefix,
    userAgent,
  } = options || {};
  const start = new URL(startUrl);
  const initialSeeds = [normalizeUrl(startUrl), ...seedUrls.map(normalizeUrl)];
  const queue: string[] = Array.from(new Set(initialSeeds));
  const visited = new Set<string>();
  let active = 0;
  let stopped = false;

  const next = async (): Promise<void> => {
    if (stopped) return;
    if (visited.size >= maxPages) return;
    const current = queue.shift();
    if (!current) return;
    if (visited.has(current)) return;
    visited.add(current);
    active += 1;
    try {
      const res = await axios.get(current, {
        timeout: timeoutMs,
        responseType: 'text',
        headers: {
          'User-Agent': userAgent || DEFAULT_CRAWLER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        validateStatus: (status: number) => status >= 200 && status < 400, // follow 3xx via Location
        maxRedirects: 5,
      });
      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('text/html')) return;
      const { title, text } = extractMainText(res.data, current);
      if (text && text.length > 0) {
        await onPage({ url: current, title, text });
        if (onProgress) {
          onProgress(visited.size + queue.length, visited.size);
        }
      }
      // discover links
      const $ = cheerio.load(res.data);
      $('a[href]').each((index: number, el: any) => {
        const href = ($(el).attr('href') || '').trim();
        if (!href) return;
        try {
          const abs = new URL(href, current);
          if (sameDomainOnly && abs.hostname !== start.hostname) return;
          if (pathPrefix && !abs.pathname.startsWith(pathPrefix)) return;
          if (!isLikelyDocUrl(start, abs)) return;
          const normalized = normalizeUrl(abs.toString());
          if (includePatterns.length && !includePatterns.some(r => r.test(normalized))) return;
          if (excludePatterns.length && excludePatterns.some(r => r.test(normalized))) return;
          if (
            !visited.has(normalized) &&
            !queue.includes(normalized) &&
            visited.size + queue.length < maxPages
          ) {
            queue.push(normalized);
          }
        } catch {
          // ignore bad URL
        }
      });
    } catch {
      // ignore fetch errors
    } finally {
      active -= 1;
      if (queue.length && visited.size < maxPages) {
        void fill();
      }
    }
  };

  const fill = async () => {
    while (active < concurrency && queue.length && visited.size < maxPages) {
      void next();
      active += 0; // no-op to satisfy loop
    }
  };

  await fill();
  // wait until drain
  while ((queue.length || active) && visited.size < maxPages) {
    await new Promise(r => setTimeout(r, 100));
  }
  stopped = true;
}

function chunkText(text: string, chunkSize = 1500, overlap = 150): string[] {
  const paragraphs = text
    .split(/\n{2,}|(?<=\.)\s{2,}/g)
    .map(p => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';
  for (const p of paragraphs) {
    if ((buffer + ' ' + p).trim().length <= chunkSize) {
      buffer = (buffer ? buffer + '\n\n' : '') + p;
    } else {
      if (buffer) chunks.push(buffer);
      if (p.length > chunkSize) {
        for (let i = 0; i < p.length; i += chunkSize - overlap) {
          chunks.push(p.slice(i, i + chunkSize));
        }
        buffer = '';
      } else {
        buffer = p;
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

async function embedBatch(
  openai: OpenAI,
  texts: string[],
  model = DEFAULT_EMBEDDING_MODEL
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await openai.embeddings.create({ model, input: texts });
  return response.data.map((d: { embedding: number[] }) => d.embedding as unknown as number[]);
}

async function upsertDocument(
  client: PgClient,
  indexName: string,
  url: string,
  title: string,
  content: string,
  embedding: number[],
  metadata: Record<string, unknown>
) {
  const table = `docs_${indexName}`;
  const quotedTable = `"${table}"`;
  // pgvector expects vectors as a string literal like "[1,2,3]"
  const vectorParam = `[${embedding.join(',')}]`;
  await client.query(
    `INSERT INTO ${quotedTable} (url, title, content, embedding, metadata)
     VALUES ($1, $2, $3, $4::vector, $5)
     ON CONFLICT (url) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       embedding = EXCLUDED.embedding,
       metadata = EXCLUDED.metadata`,
    [url, title, content, vectorParam, metadata]
  );
}

export async function indexDocumentationActivity(
  startUrl: string,
  jobId: string
): Promise<{ indexName: string; pagesIndexed: number; totalChunks: number }> {
  const indexName = deriveIndexNameFromUrl(startUrl);
  const connectionString = process.env.POSTGRES_CONNECTION_STRING;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!connectionString) throw new Error('POSTGRES_CONNECTION_STRING is not set');
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new PgClient({ connectionString });
  const openai = new OpenAI({ apiKey: openaiApiKey });
  await client.connect();

  let pagesDiscovered = 0;
  let pagesProcessed = 0;
  let pagesIndexed = 0;
  let totalChunks = 0;

  try {
    // Update status to running
    await updateIndexingJobStatus(client, jobId, 'running');
  } catch (error) {
    console.warn('Failed to update job status to running:', error);
  }

  try {
    await ensureVectorStore(client, indexName, DEFAULT_VECTOR_DIMENSION);

    // Crawl and index
    const batchSize = 16; // chunks per embedding batch
    let pendingChunks: { url: string; title: string; content: string }[] = [];

    const flush = async () => {
      if (pendingChunks.length === 0) return;
      const contents = pendingChunks.map(c => c.content);
      const embeddings = await embedBatch(openai, contents);
      for (let i = 0; i < pendingChunks.length; i += 1) {
        const { url, title, content } = pendingChunks[i];
        const embedding = embeddings[i];
        const metadata = { source: url, type: 'html', title, size: content.length } as const;
        await upsertDocument(
          client,
          indexName,
          url + '#' + crypto.createHash('md5').update(content).digest('hex'),
          title,
          content,
          embedding,
          metadata
        );
        totalChunks++;
      }
      pendingChunks = [];

      // Update progress periodically
      try {
        await updateIndexingJobStatus(client, jobId, 'running', {
          pagesDiscovered,
          pagesProcessed,
          pagesIndexed,
          totalChunks,
        });
      } catch (error) {
        console.warn('Failed to update job progress:', error);
      }
    };

    // Configure crawl from env
    const maxPages = Number(process.env.DOCS_MAX_PAGES || '') || 10000;
    const detectedCpus = Number(os.cpus()?.length || 0);
    const defaultConcurrency = Math.min(16, Math.max(4, detectedCpus || 8));
    const concurrency = Number(process.env.DOCS_CONCURRENCY || '') || defaultConcurrency;
    const timeoutMs = Number(process.env.DOCS_TIMEOUT_MS || '') || 25000;
    const userAgent = process.env.DOCS_USER_AGENT || DEFAULT_CRAWLER_UA;
    const includeRegexEnv = process.env.DOCS_INCLUDE_REGEX;
    const excludeRegexEnv = process.env.DOCS_EXCLUDE_REGEX;

    const start = new URL(startUrl);
    const pathPrefix = start.pathname && start.pathname !== '/' ? start.pathname : undefined;

    // Discover seed URLs from sitemaps (best-effort)
    let seedUrls: string[] = [];
    try {
      const sitemaps = await discoverSitemaps(startUrl, timeoutMs, userAgent);
      const sitemapUrls = await expandSitemapsToUrls(sitemaps, timeoutMs, userAgent);
      // Filter to same domain and optional path prefix
      seedUrls = sitemapUrls.filter(u => {
        try {
          const x = new URL(u);
          if (x.hostname !== start.hostname) return false;
          if (pathPrefix && !x.pathname.startsWith(pathPrefix)) return false;
          return true;
        } catch {
          return false;
        }
      });
    } catch {
      // ignore sitemap failures
    }

    const defaultUserAgent = 'docs-mcp-crawler/1.0 (+https://hypermodel.dev) axios';
    // Provide baseline excludes even if env not set
    const baseExcludePatterns: RegExp[] = [
      /\/(login|logout|signin|signup|account|profile)(\/|$)/i,
      /\/(tags|category|categories)(\/|$)/i,
      /\/(feed|rss|comments)(\/|$)/i,
      /\.(xml|json|txt)(\?|$)/i,
    ];

    await crawlSite(
      startUrl,
      {
        maxPages,
        sameDomainOnly: true,
        concurrency,
        timeoutMs,
        userAgent: userAgent || defaultUserAgent,
        seedUrls,
        pathPrefix,
        includePatterns: includeRegexEnv ? [new RegExp(includeRegexEnv)] : [],
        excludePatterns: [
          ...baseExcludePatterns,
          ...(excludeRegexEnv ? [new RegExp(excludeRegexEnv)] : []),
        ],
      },
      async page => {
        pagesDiscovered++;
        const chunks = chunkText(page.text);
        if (chunks.length > 0) {
          pagesProcessed++;
          pagesIndexed++;
          for (const chunk of chunks) {
            pendingChunks.push({ url: page.url, title: page.title, content: chunk });
            if (pendingChunks.length >= batchSize) {
              await flush();
            }
          }
        }
      },
      (discovered, processed) => {
        pagesDiscovered = discovered;
        pagesProcessed = processed;
      }
    );
    await flush();

    // Update final status to completed
    try {
      await updateIndexingJobStatus(client, jobId, 'completed', {
        pagesDiscovered,
        pagesProcessed,
        pagesIndexed,
        totalChunks,
      });
    } catch (error) {
      console.warn('Failed to update job status to completed:', error);
    }

    return { indexName, pagesIndexed, totalChunks };
  } catch (error) {
    // Update status to failed
    try {
      await updateIndexingJobStatus(client, jobId, 'failed', {
        pagesDiscovered,
        pagesProcessed,
        pagesIndexed,
        totalChunks,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorDetails: error instanceof Error ? { stack: error.stack } : { error: String(error) },
      });
    } catch (statusError) {
      console.warn('Failed to update job status to failed:', statusError);
    }
    throw error;
  } finally {
    await client.end();
  }
}

export async function indexPdfActivity(
  pdfUrl: string,
  jobId: string
): Promise<{ indexName: string; pagesIndexed: number; totalChunks: number }> {
  const indexName = deriveIndexNameFromUrl(pdfUrl);
  const connectionString = process.env.POSTGRES_CONNECTION_STRING;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!connectionString) throw new Error('POSTGRES_CONNECTION_STRING is not set');
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new PgClient({ connectionString });
  const openai = new OpenAI({ apiKey: openaiApiKey });
  await client.connect();

  // For PDFs, we treat the entire PDF as one "page" for counters
  let pagesDiscovered = 1;
  let pagesProcessed = 0;
  let pagesIndexed = 0;
  let totalChunks = 0;

  try {
    try {
      await updateIndexingJobStatus(client, jobId, 'running');
    } catch (error) {
      console.warn('Failed to update job status to running (pdf):', error);
    }

    await ensureVectorStore(client, indexName, DEFAULT_VECTOR_DIMENSION);

    const timeoutMs = Number(process.env.DOCS_TIMEOUT_MS || '') || 25000;
    const userAgent = process.env.DOCS_USER_AGENT || DEFAULT_CRAWLER_UA;

    // Fetch PDF bytes
    const res = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
      },
      validateStatus: (status: number) => status >= 200 && status < 400,
      maxRedirects: 5,
    });
    const pdfBuffer: Buffer = Buffer.from(res.data);

    const parsed: PdfParseResult = await pdfParse(pdfBuffer);

    const rawTitle: string | undefined = parsed?.info?.Title;
    const title = (rawTitle && String(rawTitle).trim()) || pdfUrl.split('/').pop() || pdfUrl;
    const fullText: string = String(parsed?.text || '')
      .replace(/\s+/g, ' ')
      .trim();

    const batchSize = 16;
    let pendingChunks: { url: string; title: string; content: string }[] = [];

    const flush = async () => {
      if (pendingChunks.length === 0) return;
      const contents = pendingChunks.map(c => c.content);
      const embeddings = await embedBatch(openai, contents);
      for (let i = 0; i < pendingChunks.length; i += 1) {
        const { url, title, content } = pendingChunks[i];
        const embedding = embeddings[i];
        const metadata = {
          source: url,
          type: 'pdf',
          title,
          size: content.length,
          pageCount: Number(parsed?.numpages || 0),
        } as const;
        await upsertDocument(
          client,
          indexName,
          url + '#' + crypto.createHash('md5').update(content).digest('hex'),
          title,
          content,
          embedding,
          metadata
        );
        totalChunks++;
      }
      pendingChunks = [];

      try {
        await updateIndexingJobStatus(client, jobId, 'running', {
          pagesDiscovered,
          pagesProcessed,
          pagesIndexed,
          totalChunks,
        });
      } catch (error) {
        console.warn('Failed to update job progress (pdf):', error);
      }
    };

    if (fullText.length > 0) {
      const chunks = chunkText(fullText);
      if (chunks.length > 0) {
        pagesProcessed = 1;
        pagesIndexed = 1;
        for (const chunk of chunks) {
          pendingChunks.push({ url: pdfUrl, title, content: chunk });
          if (pendingChunks.length >= batchSize) {
            await flush();
          }
        }
        await flush();
      }
    }

    try {
      await updateIndexingJobStatus(client, jobId, 'completed', {
        pagesDiscovered,
        pagesProcessed,
        pagesIndexed,
        totalChunks,
      });
    } catch (error) {
      console.warn('Failed to update job status to completed (pdf):', error);
    }

    return { indexName, pagesIndexed, totalChunks };
  } catch (error) {
    try {
      await updateIndexingJobStatus(client, jobId, 'failed', {
        pagesDiscovered,
        pagesProcessed,
        pagesIndexed,
        totalChunks,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorDetails: error instanceof Error ? { stack: error.stack } : { error: String(error) },
      });
    } catch (statusError) {
      console.warn('Failed to update job status to failed (pdf):', statusError);
    }
    throw error;
  } finally {
    await client.end();
  }
}
