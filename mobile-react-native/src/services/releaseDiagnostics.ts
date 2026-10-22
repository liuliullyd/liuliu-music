// Keep useful stages, timings and error codes without forwarding signed URLs,
// request payloads or credentials to Android's Release console.
const sensitiveKey = /^(?:.*url|uri|headers?|body|request|response|authorization|cookie|set-cookie|.*(?:token|password|secret|signature)|(?:x-)?api[_-]?key|credentials?)$/i;

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/(authorization\s*[=:]\s*)(?:Bearer|Basic)\s+[^\s,;}]+/gi, '$1[redacted]')
    .replace(/((?:set-cookie|cookie)\s*[=:]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:authorization|(?:access[_-]?|refresh[_-]?)?token|(?:x-)?api[_-]?key|password|secret|signature)\s*[=:]\s*)[^\s,;}]+/gi, '$1[redacted]');
}

export function sanitizeDiagnostic(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    // Most existing diagnostics are JSON strings. Scrub credential fields before
    // serializing again; plain text still gets URL/credential redaction.
    if (/^\s*[[{]/.test(value)) {
      try { return JSON.stringify(sanitizeDiagnostic(JSON.parse(value), seen)); } catch { /* plain text */ }
    }
    return redactDiagnosticText(value);
  }
  if (value instanceof Error) return { name: redactDiagnosticText(value.name), message: redactDiagnosticText(value.message) };
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeDiagnostic(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    sensitiveKey.test(key) ? '[redacted]' : sanitizeDiagnostic(item, seen)]));
}

let installed = false;
export function installReleaseDiagnostics() {
  if (__DEV__ || installed) return;
  installed = true;
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      try { original(...args.map(arg => sanitizeDiagnostic(arg))); }
      catch { original('[diagnostic unavailable]'); }
    };
  }
}
