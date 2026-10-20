import { isMd, parentOf, withMdExt } from "./tree";

export type ResolvedLink = {
  path: string;
  anchor: string | null;
};

function normalizePath(path: string): string {
  const isAbs = path.startsWith("/");
  const parts = path.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return (isAbs ? "/" : "") + stack.join("/");
}

/**
 * Resolves a relative or root-relative Markdown link target (`href`) against `currentDocPath`
 * within `root`. Returns `null` for external URLs or paths escaping `root`.
 */
export function resolveMarkdownLink(
  href: string,
  currentDocPath: string,
  root: string,
  knownFiles?: ReadonlySet<string>,
): ResolvedLink | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  // Ignore external schemes (http:, https:, mailto:, etc.) and protocol-relative URLs (//)
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    return null;
  }

  const hashIdx = trimmed.indexOf("#");
  const rawPath = hashIdx >= 0 ? trimmed.slice(0, hashIdx).trim() : trimmed;
  const rawAnchor = hashIdx >= 0 ? trimmed.slice(hashIdx + 1).trim() : "";
  const anchor = rawAnchor ? decodeURIComponent(rawAnchor) : null;

  if (!rawPath) {
    return anchor ? { path: currentDocPath, anchor } : null;
  }

  let decodedPath = rawPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    // keep rawPath if malformed percent-encoding
  }

  const baseDir = decodedPath.startsWith("/") ? root : parentOf(currentDocPath);
  const relPart = decodedPath.startsWith("/") ? decodedPath.slice(1) : decodedPath;
  const candidate = normalizePath(`${baseDir}/${relPart}`);

  // Security boundary: never resolve outside the workspace root
  if (candidate !== root && !candidate.startsWith(root + "/")) {
    return null;
  }

  if (knownFiles) {
    if (knownFiles.has(candidate)) return { path: candidate, anchor };
    const withExt = withMdExt(candidate);
    if (knownFiles.has(withExt)) return { path: withExt, anchor };
  }

  if (isMd(candidate)) {
    return { path: candidate, anchor };
  }

  return null;
}
