import { strict as assert } from 'assert';
import { deriveIndexNameFromUrl } from './deriveIndexName';

// Before: host-only when no filename in the URL path
{
  const url = 'https://www.example.com/docs/getting-started/intro';
  const indexName = deriveIndexNameFromUrl(url);
  assert.equal(indexName, 'example-com');
}

// After: host + filename (without extension) when URL ends with a file
{
  const url =
    'https://hmd-wp.go-vip.net/wp-content/uploads/2025/05/2025-US-FDD-Embassy-Suites-v.2.pdf';
  const indexName = deriveIndexNameFromUrl(url);
  assert.equal(indexName, 'hmd-wp-go-vip-net-2025-us-fdd-embassy-suites-v-2');
}

// www stripping and subdomains normalized
{
  const url = 'http://www.Example-Sub.Domain.co.uk/path';
  const indexName = deriveIndexNameFromUrl(url);
  assert.equal(indexName, 'example-sub-domain-co-uk');
}

// Path without filename (with query and fragment) -> host-only
{
  const url = 'https://example.com/guide/intro?utm_source=foo#section-1';
  const indexName = deriveIndexNameFromUrl(url);
  assert.equal(indexName, 'example-com');
}

// Filename with spaces/caps -> sanitized and appended
{
  const url = 'https://files.example.com/docs/My Report 2024 FINAL.PDF';
  const indexName = deriveIndexNameFromUrl(url);
  assert.equal(indexName, 'files-example-com-my-report-2024-final');
}

console.log('deriveIndexNameFromUrl tests passed.');
