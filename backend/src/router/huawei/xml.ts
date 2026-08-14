/**
 * Minimal XML helpers for the Huawei HiLink API (which speaks XML, not JSON).
 * Just enough to read tag values / repeated blocks and build simple request
 * bodies — no dependency, and easy to unit-test. Not a general XML parser.
 */

/** First value of <tag>…</tag> (trimmed), or null. */
export function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1].trim()) : null;
}

/** All inner contents of repeated <name>…</name> blocks. */
export function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Is this response an error (<error><code>…</code></error>)? Returns code or null. */
export function errorCode(xml: string): string | null {
  const m = xml.match(/<error>[\s\S]*?<code>(\d+)<\/code>/i);
  return m ? m[1] : null;
}

/** Build a flat <request>…</request> body from key/value pairs (order kept). */
export function buildRequest(fields: Array<[string, string | number]>): string {
  const body = fields.map(([k, v]) => `<${k}>${escape(String(v))}</${k}>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><request>${body}</request>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
