export type Change = { from: number; to: number; insert: string };
export type Eol = "\n" | "\r\n";
export type Format = { eol: Eol; bom: boolean };
export type ReadResult =
  | { kind: "ok"; text: string }
  | { kind: "invalid"; text: string }
  | { kind: "missing" };

const BOM = "﻿";
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

// ponytail: single-range diff (common prefix + suffix). Two distant edits in one write
// replace everything between them; swap for a Myers diff if cursors in that span jump.
export function diffRange(a: string, b: string): Change | null {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  if (start > 0 && isHigh(a.charCodeAt(start - 1))) start--;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  if (endA < a.length && isLow(a.charCodeAt(endA))) {
    endA++;
    endB++;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

// ponytail: a lone "\r" (old Mac endings) is normalized to the file's EOL; nobody writes those anymore.
export function splitFormat(raw: string): { text: string; format: Format } {
  const bom = raw.startsWith(BOM);
  const body = bom ? raw.slice(1) : raw;
  const crlf = body.split("\r\n").length - 1;
  const lf = body.split("\n").length - 1 - crlf;
  return { text: body.replace(/\r\n?/g, "\n"), format: { eol: crlf > lf ? "\r\n" : "\n", bom } };
}

export function joinFormat(text: string, format: Format): string {
  const body = format.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  return format.bom ? BOM + body : body;
}

export function decodeUtf8(bytes: Uint8Array): ReadResult {
  try {
    return { kind: "ok", text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { kind: "invalid", text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) };
  }
}

export function conflictCopyPath(path: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash
    ? `${path.slice(0, dot)}.conflict-${stamp}${path.slice(dot)}`
    : `${path}.conflict-${stamp}.md`;
}
