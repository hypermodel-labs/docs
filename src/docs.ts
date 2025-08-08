import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';
import OpenAI from 'openai';
import os from 'node:os';

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

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_VECTOR_DIMENSION = 1536; // for text-embedding-3-small
const DEFAULT_CRAWLER_UA = 'docs-mcp-crawler/1.0 (+https://hypermodel.dev) axios';

function deriveIndexNameFromUrl(inputUrl: string): string {
  const url = new URL(inputUrl);
  const host = url.hostname.toLowerCase();
  return host
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
  onPage: (page: CrawledPage) => Promise<void>
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

async function indexDocumentation(startUrl: string) {
  const indexName = deriveIndexNameFromUrl(startUrl);
  const connectionString = process.env.POSTGRES_CONNECTION_STRING;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!connectionString) throw new Error('POSTGRES_CONNECTION_STRING is not set');
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new PgClient({ connectionString });
  const openai = new OpenAI({ apiKey: openaiApiKey });
  await client.connect();
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
      }
      pendingChunks = [];
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
        const chunks = chunkText(page.text);
        for (const chunk of chunks) {
          pendingChunks.push({ url: page.url, title: page.title, content: chunk });
          if (pendingChunks.length >= batchSize) {
            await flush();
          }
        }
      }
    );
    await flush();

    return { indexName };
  } finally {
    await client.end();
  }
}

export function createDocsTool(server: McpServer) {
  // Create a tool to search for documentation
  server.tool(
    'search-docs',
    'Use this tool to search vectorized documentation by index name. Requires DB and OpenAI to be configured. ALWAYS USE THE LIST-INDEXES TOOL TO GET THE INDEX NAME FIRST.',
    {
      index: z.string().describe('The vector DB index to search.'),
      query: z.string().describe('The semantic query'),
      topK: z.number().optional().default(10),
    },
    async ({ index, query, topK }) => {
      const connectionString = process.env.POSTGRES_CONNECTION_STRING;
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!connectionString) {
        return { content: [{ type: 'text', text: 'Error: POSTGRES_CONNECTION_STRING not set' }] };
      }
      if (!openaiApiKey) {
        return { content: [{ type: 'text', text: 'Error: OPENAI_API_KEY not set' }] };
      }

      const client = new PgClient({ connectionString });
      const openai = new OpenAI({ apiKey: openaiApiKey });
      const table = `docs_${index}`;
      const quotedTable = `"${table}"`;
      try {
        await client.connect();
        // Generate embedding
        const [embedding] = await embedBatch(openai, [query]);
        const vectorParam = `[${embedding.join(',')}]`;
        // Query by cosine distance
        const { rows } = await client.query<any>(
          `SELECT url, title, content, 1 - (embedding <=> $1::vector) AS score
           FROM ${quotedTable}
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          [vectorParam, topK]
        );
        const results = rows.map(
          (r: { url: string; title: string; content: string; score: number }) => ({
            url: r.url as string,
            title: r.title as string,
            snippet: (r.content as string).slice(0, 500),
            score: Number(r.score),
          })
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ index, total: results.length, results }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return { content: [{ type: 'text', text: `Search failed: ${message}` }] };
      } finally {
        await client.end();
      }
    }
  );

  // Create a tool to list all the indexes that have been created
  server.tool(
    'list-indexes',
    'List available documentation indexes discovered in the database.',
    {},
    async () => {
      const connectionString = process.env.POSTGRES_CONNECTION_STRING;
      if (!connectionString) {
        return { content: [{ type: 'text', text: 'Error: POSTGRES_CONNECTION_STRING not set' }] };
      }
      const client = new PgClient({ connectionString });
      try {
        await client.connect();
        const { rows } = await client.query<{ tablename: string }>(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'docs_%' ORDER BY tablename`
        );
        const indexes = rows.map((r: { tablename: string }) =>
          String(r.tablename).replace(/^docs_/, '')
        );
        return { content: [{ type: 'text', text: JSON.stringify({ indexes }, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return { content: [{ type: 'text', text: `Failed to list indexes: ${message}` }] };
      } finally {
        await client.end();
      }
    }
  );
  // Create a tool to index documentation from a public URL
  server.tool(
    'index',
    'Index documentation from a public URL. Crawls the site and embeds content into a vector DB. ALWAYS USE THE LIST-INDEXES TOOL TO CHECK IF AN INDEX WITH THE NAME ALREADY EXISTS.',
    {
      url: z.string().describe('The URL to index documentation from'),
    },
    async ({ url }) => {
      try {
        const { indexName } = await indexDocumentation(url);
        const output = `Indexed documentation from ${url} into index "${indexName}"`;
        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return { content: [{ type: 'text', text: `Indexing failed: ${message}` }] };
      }
    }
  );
}
