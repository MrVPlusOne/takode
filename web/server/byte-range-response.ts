/**
 * A file's bytes, or the one byte range a `Range` header asks for (206), as media players request
 * them: Safari plays and seeks video only from a server that answers ranges. Several ranges in one
 * request get the whole file, which the HTTP spec allows.
 */
export function byteRangeResponse(
  body: Blob,
  size: number,
  range: string | null | undefined,
  headers: Record<string, string>,
): Response {
  const base = { ...headers, "Accept-Ranges": "bytes" };
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!match || (!match[1] && !match[2])) {
    return new Response(body, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  }
  // "bytes=-N" asks for the last N bytes.
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
