/** Read scalar song fields from Kuwo's server-rendered data. Never evaluate the page's JavaScript. */
export function readKuwoReferenceMetadata(html: string): Record<string, unknown> {
  const start = html.indexOf('songinfo:{');
  if (start < 0) return {};
  const aliases: Record<string, unknown> = {};
  const parameters = /window\.__NUXT__=\(function\(([a-z,]+)\)/.exec(html)?.[1]?.split(',');
  const argumentsText = /\}\(([^<>]*?)\)\);<\/script>/.exec(html)?.[1];
  if (parameters && argumentsText) {
    try {
      const values = JSON.parse(`[${argumentsText}]`);
      parameters.forEach((key, index) => { aliases[key] = values[index]; });
    } catch { /* Literal fields remain usable when a future page changes its wrapper. */ }
  }
  const result: Record<string, unknown> = {};
  let depth = 0, quote = '', escaped = false, entryStart = start + 'songinfo:{'.length;
  for (let index = entryStart; index < html.length; index++) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{' || char === '[') depth++;
    if ((char === ',' || char === '}') && depth === 0) {
      const entry = /^([a-zA-Z0-9_]+):([\s\S]+)$/.exec(html.slice(entryStart, index));
      if (entry) {
        const [, key, raw] = entry;
        if (['id', 'rid', 'musicrid', 'name', 'artist', 'duration', 'album', 'albumid', 'pic', 'albumpic', 'pic120'].includes(key)) {
          try { result[key] = Object.hasOwn(aliases, raw) ? aliases[raw] : JSON.parse(raw); } catch { /* Not a scalar literal. */ }
        }
      }
      if (char === '}') break;
      entryStart = index + 1;
    } else if (char === '}' || char === ']') depth--;
  }
  return result;
}
