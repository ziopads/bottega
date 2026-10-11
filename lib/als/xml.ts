// A small XML reader for Ableton Live sets (REQUIREMENTS A-6).
//
// A set is gzipped XML of a regular shape: elements with attributes (nearly
// every value is a Value="…" attribute) and almost no text. This reader turns
// it into a light tree and runs the same in the browser and in Node, so the
// page that reads a dropped folder and the Mac program that will watch the
// sessions folder (A-9) share one parser. Subtrees that are large and of no
// use here (MIDI notes, warp markers, automation breakpoints) are skipped
// without building nodes, which keeps a 12 MB set to a few hundred thousand
// nodes.

export type XNode = { t: string; a: Record<string, string>; c: XNode[] };

const SKIP = new Set(['KeyTracks', 'WarpMarkers', 'Automation', 'Notes', 'ProcessorState', 'Buffer', 'MpeSettings']);

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITY[e] ?? m;
  });
}

const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;

// The '>' that ends the tag opened at lt: an attribute value may itself hold a
// '>' (a track named "A > B"), so one inside quotes does not count.
function tagEnd(text: string, lt: number): number {
  let gt = text.indexOf('>', lt);
  while (gt !== -1) {
    let quotes = 0;
    for (let k = lt; k < gt; k++) if (text.charCodeAt(k) === 34) quotes++;
    if (quotes % 2 === 0) return gt;
    gt = text.indexOf('>', gt + 1);
  }
  return -1;
}

export function parseXml(text: string): XNode {
  const root: XNode = { t: '#root', a: {}, c: [] };
  const stack: XNode[] = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    const ch = text.charCodeAt(lt + 1);
    if (ch === 63 /* ? */ || ch === 33 /* ! */) {
      const end = text.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const gt = tagEnd(text, lt);
    if (gt === -1) break;
    if (ch === 47 /* / */) {
      if (stack.length > 1) stack.pop();
      i = gt + 1;
      continue;
    }
    const selfClosing = text.charCodeAt(gt - 1) === 47;
    const body = text.slice(lt + 1, selfClosing ? gt - 1 : gt);
    const sp = body.search(/[\s/]/);
    const tag = sp === -1 ? body : body.slice(0, sp);
    if (SKIP.has(tag) && !selfClosing) {
      // Jump to the matching close tag, counting nested ones of the same name.
      let depth = 1;
      let j = gt + 1;
      const open = `<${tag}`;
      const close = `</${tag}>`;
      while (depth > 0) {
        const nc = text.indexOf(close, j);
        if (nc === -1) {
          j = n;
          break;
        }
        let no = text.indexOf(open, j);
        while (no !== -1 && no < nc) {
          const after = text.charCodeAt(no + open.length);
          // a real opening tag of this name, not a longer name sharing the prefix
          if (after === 32 || after === 62 || after === 47 || after === 10 || after === 9) {
            const g = tagEnd(text, no);
            if (text.charCodeAt(g - 1) !== 47) depth++;
          }
          no = text.indexOf(open, no + 1);
        }
        depth--;
        j = nc + close.length;
      }
      i = j;
      continue;
    }
    const node: XNode = { t: tag, a: {}, c: [] };
    if (sp !== -1) {
      ATTR.lastIndex = 0;
      const attrs = body.slice(sp);
      let m: RegExpExecArray | null;
      while ((m = ATTR.exec(attrs))) node.a[m[1]] = decode(m[2]);
    }
    stack[stack.length - 1].c.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  return root;
}

/** The first child with this tag, following a slash-separated path. */
export function find(node: XNode | undefined, path: string): XNode | undefined {
  let cur = node;
  for (const part of path.split('/')) {
    if (!cur) return undefined;
    cur = cur.c.find((x) => x.t === part);
  }
  return cur;
}

/** The Value attribute at a path, as Live stores nearly everything. */
export function val(node: XNode | undefined, path: string): string | undefined {
  return find(node, path)?.a.Value;
}

/** Every descendant with this tag, depth first. */
export function all(node: XNode, tag: string, out: XNode[] = []): XNode[] {
  for (const ch of node.c) {
    if (ch.t === tag) out.push(ch);
    all(ch, tag, out);
  }
  return out;
}
