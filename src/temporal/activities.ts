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
const DEFAULT_VECTOR_DIMENSION = 1536; // for text-embedding-3-small (matches shortened text-embedding-3-large)
const DEFAULT_CRAWLER_UA = 'docs-mcp-crawler/1.0 (+https://hypermodel.dev) axios';

// Simple token estimator: ~4 chars per token as a heuristic for English text
function estimateTokens(text: string): number {
  const length = (text || '').length;
  // Clamp to at least 1 token to avoid zeros
  return Math.max(1, Math.ceil(length / 4));
}

function estimateTokensForTexts(texts: string[]): number {
  let total = 0;
  for (const t of texts) total += estimateTokens(t);
  return total;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfter(retryAfter: unknown): number | undefined {
  if (!retryAfter) return undefined;
  try {
    const value = String(retryAfter).trim();
    // If numeric, it's seconds
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && asNum >= 0) return Math.floor(asNum * 1000);
    // Otherwise, HTTP-date
    const date = Date.parse(value);
    if (!Number.isNaN(date)) {
      const diff = date - Date.now();
      return diff > 0 ? diff : 0;
    }
  } catch {
    // ignore parsing errors
  }
  return undefined;
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const maybeStatus = (error as { status?: unknown }).status;
    if (typeof maybeStatus === 'number') return maybeStatus;
    const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof maybeStatusCode === 'number') return maybeStatusCode;
    const response = (error as { response?: { status?: unknown } }).response;
    if (response && typeof response.status === 'number') return response.status;
  }
  return undefined;
}

function getErrorHeaders(error: unknown): Record<string, unknown> {
  if (typeof error === 'object' && error !== null) {
    const asObj = error as { headers?: unknown; response?: { headers?: unknown } };
    const headers = (asObj.headers || asObj.response?.headers) as unknown;
    if (headers && typeof headers === 'object') return headers as Record<string, unknown>;
  }
  return {};
}

class EmbeddingRateLimiter {
  private readonly requestsPerMinute: number;
  private readonly tokensPerMinute: number;
  private readonly tokensPerDay: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;

  private minuteWindowStart: number;
  private minuteRequests: number;
  private minuteTokens: number;

  private dayWindowStart: number;
  private dayTokens: number;

  private tail: Promise<void> = Promise.resolve();

  constructor(options: {
    requestsPerMinute: number;
    tokensPerMinute: number;
    tokensPerDay: number;
    maxRetries: number;
    initialBackoffMs: number;
  }) {
    this.requestsPerMinute = options.requestsPerMinute;
    this.tokensPerMinute = options.tokensPerMinute;
    this.tokensPerDay = options.tokensPerDay;
    this.maxRetries = options.maxRetries;
    this.initialBackoffMs = options.initialBackoffMs;

    const now = Date.now();
    this.minuteWindowStart = now;
    this.minuteRequests = 0;
    this.minuteTokens = 0;

    this.dayWindowStart = now;
    this.dayTokens = 0;
  }

  private rollWindows(now: number) {
    // Roll minute
    if (now - this.minuteWindowStart >= 60_000) {
      const windowsPassed = Math.floor((now - this.minuteWindowStart) / 60_000);
      this.minuteWindowStart += windowsPassed * 60_000;
      this.minuteRequests = 0;
      this.minuteTokens = 0;
    }
    // Roll day
    if (now - this.dayWindowStart >= 86_400_000) {
      const daysPassed = Math.floor((now - this.dayWindowStart) / 86_400_000);
      this.dayWindowStart += daysPassed * 86_400_000;
      this.dayTokens = 0;
    }
  }

  async acquire(cost: { requests: number; tokens: number }): Promise<void> {
    // Serialize waits to avoid thundering herd among concurrent tasks in-process
    this.tail = this.tail.then(async () => {
      while (true) {
        const now = Date.now();
        this.rollWindows(now);

        const willExceedRequests = this.minuteRequests + cost.requests > this.requestsPerMinute;
        const willExceedMinuteTokens = this.minuteTokens + cost.tokens > this.tokensPerMinute;
        const willExceedDayTokens = this.dayTokens + cost.tokens > this.tokensPerDay;

        if (!willExceedRequests && !willExceedMinuteTokens && !willExceedDayTokens) {
          this.minuteRequests += cost.requests;
          this.minuteTokens += cost.tokens;
          this.dayTokens += cost.tokens;
          return;
        }

        // Compute next available time
        const untilNextMinute = Math.max(0, this.minuteWindowStart + 60_000 - now);
        const untilNextDay = Math.max(0, this.dayWindowStart + 86_400_000 - now);
        const waitMs = willExceedDayTokens
          ? Math.max(untilNextDay, 1000)
          : Math.max(untilNextMinute, 100); // at least a tiny wait to avoid tight loop
        await sleep(waitMs);
      }
    });
    return this.tail;
  }

  async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt < this.maxRetries) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;
        const status: number | undefined = getErrorStatus(error);
        const retriable = status === 429 || (typeof status === 'number' && status >= 500);
        if (!retriable) break;

        // Honor Retry-After if present
        const headers = getErrorHeaders(error);
        const retryAfterHeader = (headers['retry-after'] || headers['Retry-After']) as unknown;
        const retryAfterMs = parseRetryAfter(retryAfterHeader);
        const base = this.initialBackoffMs * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 250);
        const delay = retryAfterMs !== undefined ? retryAfterMs : base + jitter;
        await sleep(delay);
      }
      attempt += 1;
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

// Configure limiter with headroom below absolute limits to avoid 429s
const CONFIGURED_RPM = Number(process.env.DOCS_EMBED_RPM || '') || 9000; // 90% of 10k
const CONFIGURED_TPM = Number(process.env.DOCS_EMBED_TPM || '') || 9000000; // 90% of 10M
const CONFIGURED_TPD = Number(process.env.DOCS_EMBED_TPD || '') || 3800000000; // 95% of 4B
const CONFIGURED_MAX_RETRIES = Number(process.env.DOCS_EMBED_MAX_RETRIES || '') || 6;
const CONFIGURED_INITIAL_BACKOFF_MS =
  Number(process.env.DOCS_EMBED_INITIAL_BACKOFF_MS || '') || 500;

const embeddingLimiter = new EmbeddingRateLimiter({
  requestsPerMinute: CONFIGURED_RPM,
  tokensPerMinute: CONFIGURED_TPM,
  tokensPerDay: CONFIGURED_TPD,
  maxRetries: CONFIGURED_MAX_RETRIES,
  initialBackoffMs: CONFIGURED_INITIAL_BACKOFF_MS,
});

// Optional distributed limiter (Postgres) for multi-process coordination
let didEnsureDistributedTable = false;
async function ensureDistributedRateStore(client: PgClient): Promise<void> {
  if (didEnsureDistributedTable) return;
  await client.query(
    `CREATE TABLE IF NOT EXISTS docs_embed_rate_window (
      id INT PRIMARY KEY,
      minute_window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
      minute_requests INT NOT NULL DEFAULT 0,
      minute_tokens BIGINT NOT NULL DEFAULT 0,
      day_window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
      day_tokens BIGINT NOT NULL DEFAULT 0
    )`
  );
  await client.query(
    `INSERT INTO docs_embed_rate_window (id) VALUES (1)
     ON CONFLICT (id) DO NOTHING`
  );
  didEnsureDistributedTable = true;
}

async function distributedAcquirePostgres(
  client: PgClient,
  cost: { requests: number; tokens: number }
): Promise<void> {
  if ((process.env.DOCS_EMBED_DISTRIBUTED || '').toLowerCase() !== 'postgres') return;
  await ensureDistributedRateStore(client);

  const lockKey = 881122; // arbitrary app-level advisory lock key
  while (true) {
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    try {
      const nowRes = await client.query('SELECT now() as now');
      const now: Date = nowRes.rows[0].now;
      const rowRes = await client.query(`SELECT * FROM docs_embed_rate_window WHERE id = 1`);
      const row = rowRes.rows[0] || {};

      const minuteWindowStart: Date = row.minute_window_start || now;
      const dayWindowStart: Date = row.day_window_start || now;
      let minuteRequests: number = Number(row.minute_requests || 0);
      let minuteTokens: number = Number(row.minute_tokens || 0);
      let dayTokens: number = Number(row.day_tokens || 0);

      const minuteElapsed = now.getTime() - new Date(minuteWindowStart).getTime();
      const dayElapsed = now.getTime() - new Date(dayWindowStart).getTime();

      if (minuteElapsed >= 60_000) {
        minuteRequests = 0;
        minuteTokens = 0;
      }
      if (dayElapsed >= 86_400_000) {
        dayTokens = 0;
      }

      const willExceedRequests = minuteRequests + cost.requests > CONFIGURED_RPM;
      const willExceedMinuteTokens = minuteTokens + cost.tokens > CONFIGURED_TPM;
      const willExceedDayTokens = dayTokens + cost.tokens > CONFIGURED_TPD;

      if (!willExceedRequests && !willExceedMinuteTokens && !willExceedDayTokens) {
        minuteRequests += cost.requests;
        minuteTokens += cost.tokens;
        dayTokens += cost.tokens;
        const newMinuteStart = minuteElapsed >= 60_000 ? now : minuteWindowStart;
        const newDayStart = dayElapsed >= 86_400_000 ? now : dayWindowStart;
        await client.query(
          `UPDATE docs_embed_rate_window
           SET minute_window_start = $1,
               minute_requests = $2,
               minute_tokens = $3,
               day_window_start = $4,
               day_tokens = $5
           WHERE id = 1`,
          [newMinuteStart, minuteRequests, minuteTokens, newDayStart, dayTokens]
        );
        return;
      }

      const untilNextMinute = Math.max(
        0,
        new Date(minuteWindowStart).getTime() + 60_000 - now.getTime()
      );
      const untilNextDay = Math.max(
        0,
        new Date(dayWindowStart).getTime() + 86_400_000 - now.getTime()
      );
      const waitMs = willExceedDayTokens
        ? Math.max(untilNextDay, 1000)
        : Math.max(untilNextMinute, 100);
      // Release lock before waiting
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      await sleep(waitMs);
      continue;
    } finally {
      // Ensure lock is released if we returned early
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => {});
    }
  }
}

async function ensureVectorStore(client: PgClient, indexName: string, dimension: number) {
  const table = `docs_${indexName}`;
  const quotedTable = `"${table}"`;
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');

  // Ensure table type matches requested vector dimension. If not, drop and recreate.
  try {
    const dimRes = await client.query(
      `SELECT (atttypmod - 4) AS dims
       FROM pg_attribute
       WHERE attrelid = $1::regclass
         AND attname = 'embedding'
         AND NOT attisdropped`,
      [table]
    );
    if (dimRes.rows.length > 0) {
      const existingDims = Number(dimRes.rows[0]?.dims || 0);
      if (existingDims && existingDims !== dimension) {
        console.warn(
          `Recreating ${table}: embedding dimension changed ${existingDims} -> ${dimension}`
        );
        await client.query(`DROP TABLE IF EXISTS ${quotedTable} CASCADE`);
      }
    }
  } catch (error) {
    console.warn('Error checking existing vector dimension:', error);
  }

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

  // Prefer HNSW. Guard IVFFlat fallback for high dimensions (>2000)
  try {
    await client.query(
      `CREATE INDEX IF NOT EXISTS "${table}_embedding_idx" ON ${quotedTable} USING hnsw (embedding vector_cosine_ops)`
    );
  } catch (error) {
    const tooHighDim = dimension > 2000;
    if (tooHighDim) {
      console.warn(
        `Skipping IVFFlat index for ${table}: dimension ${dimension} exceeds 2000. Queries will use sequential scan.`
      );
    } else {
      console.warn('HNSW index creation failed, trying IVFFlat:', error);
      await client.query(
        `CREATE INDEX IF NOT EXISTS "${table}_embedding_idx" ON ${quotedTable} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
      );
    }
  }
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
      $('a[href]').each((index: number, el: unknown) => {
        const href = ($(el as any).attr('href') || '').trim();
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
  const tokens = estimateTokensForTexts(texts);
  await embeddingLimiter.acquire({ requests: 1, tokens });
  const response = await embeddingLimiter.withRetry(() =>
    openai.embeddings.create({ model, input: texts })
  );
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
    const batchSize = Number(process.env.DOCS_EMBED_BATCH_SIZE || '') || 32; // chunks per embedding batch
    let pendingChunks: { url: string; title: string; content: string }[] = [];

    const flush = async () => {
      if (pendingChunks.length === 0) return;
      const contents = pendingChunks.map(c => c.content);
      await distributedAcquirePostgres(client, {
        requests: 1,
        tokens: estimateTokensForTexts(contents),
      });
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

    const batchSize = Number(process.env.DOCS_EMBED_BATCH_SIZE || '') || 32;
    let pendingChunks: { url: string; title: string; content: string }[] = [];

    const flush = async () => {
      if (pendingChunks.length === 0) return;
      const contents = pendingChunks.map(c => c.content);
      await distributedAcquirePostgres(client, {
        requests: 1,
        tokens: estimateTokensForTexts(contents),
      });
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
