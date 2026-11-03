import type { Brand } from "@/src/core/brand/types";
import type { Manifest } from "@/src/core/output/manifest";

export type { Brand, Manifest };

export class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly details: string[] = []) {
    super(message);
  }
}

/**
 * POSTs and reads a server-sent-event response. Calls onEvent for each
 * "progress" event and resolves with the "done" payload (rejects on "error").
 */
export async function postStream<T>(url: string, body: FormData | object, onEvent: (data: any) => void): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body),
    headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
  });
  if (!res.body) throw new ApiError(`HTTP ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = chunk.match(/^event: (.*)$/m)?.[1];
      const data = JSON.parse(chunk.match(/^data: (.*)$/m)?.[1] ?? "null");
      if (event === "progress") onEvent(data);
      else if (event === "done") return data as T;
      else if (event === "error") throw new ApiError(data.error, data.code, data.details);
    }
  }
  throw new ApiError("The server closed the connection early.");
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    headers: init?.json !== undefined ? { "content-type": "application/json" } : init?.headers,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, data.code, data.details);
  return data as T;
}

export const brandFile = (slug: string, rel: string, v?: string) =>
  `/api/brand/${slug}/files/${rel.split("/").map(encodeURIComponent).join("/")}${v ? `?v=${encodeURIComponent(v)}` : ""}`;

export const runFile = (slug: string, run: string, file: string) => `/api/runs/${slug}/${run}/${encodeURIComponent(file)}`;
