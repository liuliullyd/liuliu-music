/** Request a thumbnail before Android allocates a full-resolution decode buffer. */
export function homeCoverUri(uri: string): string {
  if (!/^https?:\/\/p\d+\.music\.126\.net\//i.test(uri)) return uri;
  const [base, query = ''] = uri.split('?');
  const params = query
    .split('&')
    .filter(part => part && !part.startsWith('param='));
  return `${base}?${[...params, 'param=256y256'].join('&')}`;
}

export type CoverResolution = 'thumbnail' | 'player';

/** Normalize a remote cover at the render boundary without changing track identity. */
export function normalizeCoverUri(
  uri: string,
  resolution: CoverResolution = 'thumbnail',
): string {
  // Provider extraction already orders HTTPS and intentional HTTP alternatives.
  // Only the known NetEase thumbnail endpoint retains its existing HTTPS rule.
  const normalized = uri
    .trim()
    .replace(/^\/\//, 'https:')
    .replace(/^http:\/\/(p\d+\.music\.126\.net\/)/i, 'https://$1');
  return normalized && resolution === 'thumbnail'
    ? homeCoverUri(normalized)
    : normalized;
}
