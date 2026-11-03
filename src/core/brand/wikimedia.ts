/**
 * Wikidata / Wikimedia Commons fallback: many brands have an official logo
 * (P154, usually SVG) and website (P856) on Wikidata. Used when the brand's own
 * site can't be scanned and no logo.dev key is set. Public API, no key.
 */

const UA = "Swatch/1.0 (internal demo-asset generator; https://www.wikidata.org/wiki/Wikidata:Data_access)";
const api = (url: string) => fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) });

interface Claim {
  rank: "preferred" | "normal" | "deprecated";
  mainsnak: { datavalue?: { value: unknown } };
  qualifiers?: Record<string, unknown>;
}

/** Current value of a property: preferred rank, else the last one without an end date (P582). */
function current(claims: Claim[] | undefined): string | null {
  const live = (claims ?? []).filter((c) => c.rank !== "deprecated" && c.mainsnak.datavalue);
  const pick = live.find((c) => c.rank === "preferred") ?? live.filter((c) => !c.qualifiers?.P582).at(-1) ?? live.at(-1);
  const v = pick?.mainsnak.datavalue?.value;
  return typeof v === "string" ? v : null;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

export interface WikidataBrand {
  id: string;
  label: string;
  domain: string | null;
  /** Candidate logo files, best first: English Wikipedia infobox logo, then Wikidata P154. */
  logoFiles: string[];
}

/** "Kroger logo (1961-2019).svg" names a retired logo. */
export function isHistoricLogo(file: string, year = new Date().getFullYear()): boolean {
  const m = file.match(/\b(1[89]|20)\d{2}\s*[-–]\s*((?:1[89]|20)\d{2})\b/);
  return !!m && Number(m[2]) < year;
}

async function infoboxLogo(enwikiTitle: string): Promise<string | null> {
  const res = await api(
    `https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&section=0&page=${encodeURIComponent(enwikiTitle)}`,
  );
  if (!res.ok) return null;
  const text: string = (await res.json()).parse?.wikitext ?? "";
  const raw = text.match(/\|\s*logo\s*=\s*([^\n]+)/i)?.[1]?.trim();
  if (!raw || raw.includes("{{")) return null;
  const file = raw.replace(/^\[\[/, "").replace(/^(file|image):/i, "").split("|")[0].replace(/\]\]$/, "").trim();
  return /\.(svg|png)$/i.test(file) ? file : null;
}

/**
 * Finds the brand's Wikidata item. With a known domain, only an item whose
 * official website matches is accepted; otherwise the first search hit that has a logo.
 */
export async function findWikidataBrand(name: string, domain: string | null): Promise<WikidataBrand | null> {
  const search = await api(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=7&search=${encodeURIComponent(name)}`,
  );
  if (!search.ok) return null;
  const ids: string[] = ((await search.json()).search ?? []).map((s: { id: string }) => s.id);
  if (!ids.length) return null;

  const res = await api(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels|sitelinks&sitefilter=enwiki&languages=en&ids=${ids.join("|")}`,
  );
  if (!res.ok) return null;
  type Entity = { labels?: { en?: { value: string } }; claims?: Record<string, Claim[]>; sitelinks?: { enwiki?: { title: string } } };
  const entities = (await res.json()).entities as Record<string, Entity>;

  const items = ids.map((id) => {
    const e = entities[id];
    const sites = (e?.claims?.P856 ?? []).map((c) => c.mainsnak.datavalue?.value).filter((v): v is string => typeof v === "string");
    const hosts = sites.map(hostOf).filter((h): h is string => !!h);
    return { id, e, hosts, label: e?.labels?.en?.value ?? id, logo: current(e?.claims?.P154) };
  });
  const hit = domain
    ? items.find((i) => i.hosts.includes(domain))
    : items.find((i) => i.logo && i.hosts.length);
  if (!hit) return null;

  const files: string[] = [];
  const enwiki = hit.e?.sitelinks?.enwiki?.title;
  const fromInfobox = enwiki ? await infoboxLogo(enwiki).catch(() => null) : null;
  for (const f of [fromInfobox, hit.logo]) if (f && !files.includes(f) && !isHistoricLogo(f)) files.push(f);
  return { id: hit.id, label: hit.label, domain: domain ?? hit.hosts[0] ?? null, logoFiles: files };
}

export async function fetchCommonsFile(fileName: string): Promise<{ bytes: Buffer; contentType: string; url: string } | null> {
  // enwiki's FilePath serves both local (non-free) files and Commons files.
  const url = `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName.replace(/ /g, "_"))}`;
  const res = await api(url);
  if (!res.ok) return null;
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "", url: res.url };
}
