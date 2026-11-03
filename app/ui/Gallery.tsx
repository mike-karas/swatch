"use client";

import type { Manifest } from "./api";
import { runFile } from "./api";

const DEVICE_LABELS: Record<string, string> = {
  phone: "Phone", scanner: "Handheld scanner", tablet: "Tablet", desktop: "Desktop / web",
  display: "In-store display / TV", square: "Square / tiles", logo: "Logo variants",
};
const ORIENTATIONS = ["portrait", "landscape", "square"];

export interface RunResult {
  run: string;
  zip: string;
  rendered: number;
  cached: number;
  manifest: Manifest;
}

export function Gallery({ slug, result }: { slug: string; result: RunResult }) {
  const { manifest, run } = result;
  const devices = [...new Set(manifest.assets.map((a) => a.device))];
  return (
    <div className="panel">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          {manifest.assets.length} assets{" "}
          <span className="muted small">
            {result.rendered} rendered · {result.cached} from cache · output/{slug}/{run}
          </span>
        </h2>
        <a className="btn" href={runFile(slug, run, "contact-sheet.html")} target="_blank" rel="noreferrer">
          Contact sheet
        </a>
        <a className="btn" href={runFile(slug, run, "manifest.json")} target="_blank" rel="noreferrer">
          manifest.json
        </a>
        <a className="btn primary" href={runFile(slug, run, result.zip)} download>
          Download zip
        </a>
      </div>

      {devices.map((d) => {
        const items = manifest.assets.filter((a) => a.device === d && a.scale === 1);
        const retina = manifest.assets.filter((a) => a.device === d && a.scale === 2).length;
        return (
          <section className="gallery-group" key={d}>
            <h3>
              {DEVICE_LABELS[d] ?? d} {retina > 0 && <span className="muted small">+ {retina} @2x</span>}
            </h3>
            {ORIENTATIONS.map((o) => {
              const list = items.filter((a) => a.orientation === o);
              if (!list.length) return null;
              return (
                <div key={o}>
                  <h4>{o}</h4>
                  <div className="grid">
                    {list.map((a) => {
                      const ratio = a.width / a.height;
                      const h = Math.min(d === "logo" ? 120 : 200, Math.round(300 / ratio));
                      return (
                        <figure className="tile" key={a.file}>
                          <a
                            href={runFile(slug, run, a.file)}
                            target="_blank"
                            rel="noreferrer"
                            className={a.transparent ? "checker" : undefined}
                            style={{ width: Math.round(h * ratio), height: h }}
                          >
                            <img src={runFile(slug, run, a.file)} alt={a.file} />
                          </a>
                          <figcaption>
                            <b>{a.file}</b>
                            <span className="muted">
                              {a.width}×{a.height} · {a.slot}
                            </span>
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
