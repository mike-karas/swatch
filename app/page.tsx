"use client";

import { useEffect, useRef, useState } from "react";
import { slugify } from "@/src/core/output/naming";
import { api, ApiError, postStream, type Brand } from "./ui/api";
import { Gallery, type RunResult } from "./ui/Gallery";
import { IdentityEditor, type Meta } from "./ui/IdentityEditor";

interface SavedBrand {
  slug: string;
  name: string;
  domain: string | null;
  primary?: string;
  updatedAt: string;
}

type Stage = "input" | "resolving" | "identity" | "generating" | "done";

export default function Home() {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [offline, setOffline] = useState(false);
  const [stage, setStage] = useState<Stage>("input");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [saved, setSaved] = useState<SavedBrand[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; file: string } | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [reuseFor, setReuseFor] = useState<SavedBrand | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);

  useEffect(() => {
    api<Meta>("/api/meta").then(setMeta).catch(() => {});
    refreshSaved();
  }, []);

  function refreshSaved() {
    api<{ brands: SavedBrand[] }>("/api/brands").then((r) => setSaved(r.brands)).catch(() => {});
  }

  async function openSaved(slug: string) {
    setError(null);
    setReuseFor(null);
    try {
      const { brand: b } = await api<{ brand: Brand }>(`/api/brand/${slug}`);
      setBrand(b);
      setName(b.name);
      setDomain(b.domain ?? "");
      setResult(null);
      setStage("identity");
    } catch (e) {
      setError(e as ApiError);
    }
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) return;
    const existing = saved.find((s) => s.slug === slugify(name));
    const hasUpload = !!logoInput.current?.files?.length;
    if (existing && !hasUpload && !reuseFor) {
      setReuseFor(existing);
      return;
    }
    resolve();
  }

  async function resolve() {
    setReuseFor(null);
    setError(null);
    setLog([]);
    setResult(null);
    setStage("resolving");
    const form = new FormData();
    form.set("name", name.trim());
    form.set("domain", domain.trim());
    if (offline) form.set("offline", "1");
    const file = logoInput.current?.files?.[0];
    if (file) form.set("logo", file);
    try {
      const { brand: b } = await postStream<{ brand: Brand }>("/api/resolve", form, (d) => setLog((l) => [...l, d.message]));
      setBrand(b);
      setStage("identity");
      refreshSaved();
    } catch (e) {
      setError(e as ApiError);
      setStage("input");
    }
  }

  async function generate(only: string[]) {
    if (!brand) return;
    setError(null);
    setProgress(null);
    setStage("generating");
    try {
      const r = await postStream<RunResult>("/api/generate", { slug: brand.slug, only }, (d) => setProgress(d));
      setResult(r);
      setStage("done");
    } catch (e) {
      setError(e as ApiError);
      setStage("identity");
    }
  }

  const needsLogo = error?.code === "NEEDS_LOGO";

  return (
    <main className="shell">
      <header className="topbar">
        <h1>Swatch</h1>
        <span className="sub">Branded demo assets</span>
        <span className="spacer" />
        {stage !== "input" && (
          <button className="btn link" onClick={() => { setStage("input"); setError(null); }}>
            New brand
          </button>
        )}
      </header>

      {(stage === "input" || stage === "resolving") && (
        <form className="panel" onSubmit={submit}>
          <h2>Brand</h2>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field grow">
              Brand name
              <input value={name} onChange={(e) => { setName(e.target.value); setReuseFor(null); }} placeholder="Ace Hardware" autoFocus disabled={stage === "resolving"} />
            </label>
            <label className="field grow">
              Website domain (optional)
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acehardware.com" disabled={stage === "resolving"} />
            </label>
            <button className="btn primary" type="submit" disabled={stage === "resolving" || !name.trim()}>
              {stage === "resolving" ? "Resolving…" : "Find brand"}
            </button>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="check">
              <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} disabled={stage === "resolving"} />
              Offline (no third-party calls; needs a logo upload)
            </label>
            <label className="btn file-btn small">
              {uploadName ? `Logo: ${uploadName}` : "Upload logo…"}
              <input
                ref={logoInput}
                type="file"
                accept=".svg,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setUploadName(e.target.files?.[0]?.name ?? null)}
                disabled={stage === "resolving"}
              />
            </label>
            {uploadName && (
              <button type="button" className="btn link small" onClick={() => { if (logoInput.current) logoInput.current.value = ""; setUploadName(null); }}>
                Clear
              </button>
            )}
          </div>

          {reuseFor && (
            <div className="notice warn" style={{ marginTop: 14 }}>
              <b>{reuseFor.name}</b> already has a saved identity (brands/{reuseFor.slug}/brand.json, updated{" "}
              {new Date(reuseFor.updatedAt).toLocaleString()}).
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn primary" onClick={() => openSaved(reuseFor.slug)}>
                  Use saved identity
                </button>
                <button type="button" className="btn" onClick={resolve}>
                  Resolve again
                </button>
              </div>
            </div>
          )}

          {stage === "resolving" && (
            <ul className="log" style={{ marginTop: 14 }}>
              {log.map((m, i) => (
                <li key={i} className={i === log.length - 1 ? "current" : ""}>
                  {m}
                </li>
              ))}
              {log.length === 0 && <li className="current">Starting</li>}
            </ul>
          )}

          {error && stage === "input" && (
            <div className={`notice ${needsLogo ? "warn" : "bad"}`} style={{ marginTop: 14 }}>
              <b>{error.message}</b>
              {needsLogo && <div style={{ marginTop: 4 }}>Upload a logo above (SVG, or PNG at least 500px), then Find brand again.</div>}
              {error.details.length > 0 && (
                <ul>
                  {error.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {saved.length > 0 && stage === "input" && (
            <>
              <h3 style={{ marginTop: 20 }}>Saved identities</h3>
              <div className="chips">
                {saved.map((s) => (
                  <button type="button" key={s.slug} className="chip" onClick={() => openSaved(s.slug)}>
                    <i style={{ background: s.primary ?? "transparent" }} /> {s.name}
                    {s.domain && <span className="muted small">{s.domain}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </form>
      )}

      {brand && (stage === "identity" || stage === "generating" || stage === "done") && (
        <>
          {stage === "identity" && (
            <IdentityEditor brand={brand} meta={meta} offline={offline} busy={false} onBrand={setBrand} onGenerate={generate} />
          )}
          {stage === "identity" && error && (
            <div className="notice bad" style={{ marginTop: 12 }}>
              {error.message}
            </div>
          )}

          {stage === "generating" && (
            <div className="panel">
              <h2>Rendering {brand.name}</h2>
              <div className="bar">
                <div style={{ width: `${progress ? (100 * progress.done) / progress.total : 2}%` }} />
              </div>
              <p className="small muted mono">
                {progress ? `${progress.done}/${progress.total}  ${progress.file}` : "Starting renderer…"}
              </p>
            </div>
          )}

          {stage === "done" && result && (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <button className="btn" onClick={() => setStage("identity")}>
                  ← Edit identity
                </button>
              </div>
              <Gallery slug={brand.slug} result={result} />
            </>
          )}
        </>
      )}
    </main>
  );
}
