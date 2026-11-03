/** logo.dev client. Both calls are optional and skipped when their key is unset. */

export async function searchDomain(name: string): Promise<string | null> {
  const key = process.env.LOGODEV_SECRET_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.logo.dev/search?q=${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const hits = (await res.json()) as { name: string; domain: string }[];
  return hits[0]?.domain ?? null;
}

export async function fetchLogo(domain: string): Promise<{ bytes: Buffer; contentType: string; url: string } | null> {
  const key = process.env.LOGODEV_PUBLISHABLE_KEY;
  if (!key) return null;
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${key}&size=512&retina=true&format=png&fallback=404`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "image/png",
    url: url.replace(key, "<key>"),
  };
}
