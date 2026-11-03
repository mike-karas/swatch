import fs from "node:fs/promises";
import path from "node:path";
import { NeedsLogoError } from "../core/brand/types";

/** Slugs and run ids come from URLs; only these shapes are ever used to build paths. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const RUN_RE = /^\d{8}-\d{6}$/;

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function errorJson(e: unknown, status = 400) {
  if (e instanceof NeedsLogoError) return json({ error: e.message, code: e.code, details: e.details }, 422);
  return json({ error: (e as Error).message ?? String(e) }, status);
}

export type Send = (event: string, data: unknown) => void;

/**
 * Server-sent events over a POST response. `run` streams progress with send();
 * its return value is sent as a final "done" event, a throw as "error".
 */
export function sse(run: (send: Send) => Promise<unknown>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (event, data) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        send("done", await run(send));
      } catch (e) {
        send("error", e instanceof NeedsLogoError ? { error: e.message, code: e.code, details: e.details } : { error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".zip": "application/zip",
};

/** Serves a file only if it resolves inside `root`. Scraped SVGs never get to run script. */
export async function serveFile(root: string, rel: string[], download = false): Promise<Response> {
  const file = path.resolve(root, ...rel);
  if (!file.startsWith(path.resolve(root) + path.sep)) return new Response("forbidden", { status: 403 });
  let body: Buffer;
  try {
    body = await fs.readFile(file);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const ext = path.extname(file).toLowerCase();
  const headers: Record<string, string> = {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "cache-control": "no-cache",
  };
  if (ext === ".svg") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  if (download || ext === ".zip") headers["content-disposition"] = `attachment; filename="${path.basename(file)}"`;
  return new Response(new Uint8Array(body), { headers });
}
