import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Offline guard. While offline, any fetch() throws. Playwright is only launched
 * for scraping (skipped offline) and for rendering, which aborts every non-data:
 * request on its own.
 *
 *   enforceOffline()     whole process (CLI --offline)
 *   withOffline(fn)      just this async call tree (web UI requests)
 */
export class OfflineViolation extends Error {}

let processOffline = false;
const scope = new AsyncLocalStorage<boolean>();
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (isOffline()) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      throw new OfflineViolation(`blocked network request in offline mode: ${new URL(url).host}`);
    }
    return real(input, init);
  }) as typeof fetch;
}

export function enforceOffline() {
  install();
  processOffline = true;
}

export function withOffline<T>(offline: boolean, fn: () => Promise<T>): Promise<T> {
  if (!offline) return fn();
  install();
  return scope.run(true, fn);
}

export const isOffline = () => processOffline || scope.getStore() === true;
