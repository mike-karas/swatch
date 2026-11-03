#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

process.env.SWATCH_ROOT ??= fileURLToPath(new URL("..", import.meta.url));
register();
await import("../src/cli/index.ts");
