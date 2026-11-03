import type { TemplateInput } from "../src/core/render/context";
import * as banner from "./banner/layout";
import * as logoLockup from "./logo-lockup/layout";
import * as splash from "./splash/layout";

/**
 * Template registry. Each template is a folder with:
 *   template.hbs  the HTML/CSS (Handlebars; {{> head}} adds fonts, reset and .safe)
 *   layout.ts     prepare(input) → the values template.hbs uses
 */
export const templates: Record<string, { prepare(input: TemplateInput): Record<string, unknown> }> = {
  splash,
  banner,
  "logo-lockup": logoLockup,
};
