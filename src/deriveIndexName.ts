export function deriveIndexNameFromUrl(inputUrl: string): string {
  const url = new URL(inputUrl);
  const host = url.hostname.toLowerCase();
  const hostPart = host
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const segments = url.pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1] || '';
  let filePart = '';
  if (lastSegment && /\.[a-z0-9]{1,8}$/i.test(lastSegment)) {
    let decoded = lastSegment;
    try {
      decoded = decodeURIComponent(lastSegment);
    } catch {
      // ignore decoding errors; fallback to raw segment
    }
    const base = decoded.replace(/\.[a-z0-9]{1,8}$/i, '');
    filePart = base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  return filePart ? `${hostPart}-${filePart}` : hostPart;
}
