// Structural check for an Angular route guard, robust to key ordering and to
// the length of `// vuln-code-snippet …` comments (issue #24).
//
// Instead of scanning a fixed-width text window after the route path, we locate
// the `{ … }` object literal that owns the path and assert the guard name
// appears anywhere inside it. To keep brace-balancing honest we first blank out
// comments and string interiors (replacing them with same-length filler so
// character offsets stay aligned), so a brace or the guard name appearing inside
// a comment or string can neither break the balance nor cause a false positive.

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Produce two same-length views of the source:
//   masked      — comments and string interiors replaced with spaces (used for
//                 structural brace-balancing; ignores braces inside strings)
//   decommented — comments removed but string interiors kept (used to find the
//                 path literal and the guard name in real code)
// Newlines are preserved in both so offsets line up with the original source.
function analyze(src) {
  const masked = [];
  const decommented = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : '';

    // Line comment
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        masked.push(' ');
        decommented.push(' ');
        i++;
      }
      continue;
    }

    // Block comment
    if (c === '/' && next === '*') {
      masked.push(' ', ' ');
      decommented.push(' ', ' ');
      i += 2;
      while (i < n && !(src[i] === '*' && i + 1 < n && src[i + 1] === '/')) {
        const fill = src[i] === '\n' ? '\n' : ' ';
        masked.push(fill);
        decommented.push(fill);
        i++;
      }
      if (i < n) {
        masked.push(' ', ' ');
        decommented.push(' ', ' ');
        i += 2;
      }
      continue;
    }

    // String / template literal
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      masked.push(c);
      decommented.push(c);
      i++;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < n) {
          masked.push(' ', ' ');
          decommented.push(ch, src[i + 1]);
          i += 2;
          continue;
        }
        if (ch === quote) {
          masked.push(ch);
          decommented.push(ch);
          i++;
          break;
        }
        masked.push(ch === '\n' ? '\n' : ' ');
        decommented.push(ch);
        i++;
      }
      continue;
    }

    masked.push(c);
    decommented.push(c);
    i++;
  }
  return { masked: masked.join(''), decommented: decommented.join('') };
}

// Walk backwards from `fromIdx` to the opening brace of the enclosing object.
function findEnclosingOpen(masked, fromIdx) {
  let depth = 0;
  for (let i = fromIdx; i >= 0; i--) {
    const ch = masked[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

// Walk forwards from an opening brace to its matching close.
function findMatchingClose(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Returns true if the object literal that encloses the first match of `anchor`
 * contains `guardName` anywhere inside its `{ … }` block — regardless of key
 * order or surrounding comment length. `anchor` may be a plain substring or a
 * RegExp; it is matched against real (comment-stripped) code, so a brace, the
 * anchor, or the guard name appearing inside a comment or string can neither
 * break brace-balancing nor cause a false positive.
 */
export function enclosingObjectHasGuard(rawContent, anchor, guardName) {
  const { masked, decommented } = analyze(rawContent);

  const anchorRe = anchor instanceof RegExp
    ? anchor
    : new RegExp(escapeRegExp(anchor));
  const m = anchorRe.exec(decommented);
  if (!m) return false;
  const anchorIdx = m.index;

  const open = findEnclosingOpen(masked, anchorIdx);
  if (open === -1) return false;
  const close = findMatchingClose(masked, open);
  if (close === -1) return false;

  const objectSrc = decommented.slice(open, close + 1);
  return objectSrc.includes(guardName);
}

/**
 * Returns true if the route object whose path is `routePath` contains
 * `guardName` anywhere inside its `{ … }` block. Thin wrapper over
 * {@link enclosingObjectHasGuard} anchored on the quoted path literal.
 */
export function routeObjectHasGuard(rawContent, routePath, guardName) {
  const pathRe = new RegExp(`['"\`]${escapeRegExp(routePath)}['"\`]`);
  return enclosingObjectHasGuard(rawContent, pathRe, guardName);
}
