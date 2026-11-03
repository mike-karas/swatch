import os from "node:os";
import { chromium, type Browser, type BrowserContext } from "playwright";

export interface RenderSpec {
  width: number;
  height: number;
  scale: 1 | 2;
  transparent: boolean;
}

/*
 * Runs after fonts load, before the screenshot:
 *   [data-fit="N"]  shrink font-size until the text fits in N lines and its box width
 *   [data-fit-box]  scale the element down (never up) to fit its parent's width
 */
const FIT_SCRIPT = String.raw`(() => {
  for (const el of document.querySelectorAll("[data-fit]")) {
    const lines = Number(el.dataset.fit) || 1;
    let size = parseFloat(getComputedStyle(el).fontSize);
    const lh = parseFloat(getComputedStyle(el).lineHeight) / size || 1.1;
    while (size > 8 && (el.scrollHeight > Math.ceil(size * lh * lines) + 1 || el.scrollWidth > el.clientWidth + 1)) {
      size -= 1;
      el.style.fontSize = size + "px";
    }
  }
  for (const el of document.querySelectorAll("[data-fit-box]")) {
    const avail = el.parentElement.clientWidth;
    const s = Math.min(1, avail / el.scrollWidth);
    if (s < 1) el.style.transform = "scale(" + s + ")";
  }
})()`;

/** One Chromium, one context per device scale, concurrency-limited pages. */
export class Renderer {
  private contexts = new Map<number, Promise<BrowserContext>>();
  private active = 0;
  private queue: (() => void)[] = [];

  private constructor(private browser: Browser, readonly concurrency: number) {}

  /** Chromium version; part of the render-cache key. */
  get version() {
    return this.browser.version();
  }

  static async create(concurrency = Number(process.env.SWATCH_CONCURRENCY) || os.availableParallelism()): Promise<Renderer> {
    const browser = await chromium.launch();
    return new Renderer(browser, Math.max(1, concurrency));
  }

  private context(scale: number) {
    let c = this.contexts.get(scale);
    if (!c) {
      c = this.browser.newContext({ deviceScaleFactor: scale });
      this.contexts.set(scale, c);
    }
    return c;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  render(html: string, spec: RenderSpec): Promise<Buffer> {
    return this.slot(async () => {
      const ctx = await this.context(spec.scale);
      const page = await ctx.newPage();
      try {
        // Templates are self-contained (data: URIs). Anything else is a bug or a leak.
        await page.route(/^(?!data:)/, (route) => route.abort());
        await page.setViewportSize({ width: spec.width, height: spec.height });
        await page.setContent(html, { waitUntil: "load" });
        await page.evaluate("document.fonts.ready");
        await page.evaluate(FIT_SCRIPT);
        return await page.screenshot({ type: "png", omitBackground: spec.transparent, animations: "disabled", caret: "hide" });
      } finally {
        await page.close();
      }
    });
  }

  async close() {
    await this.browser.close();
  }
}
