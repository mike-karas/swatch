import type { NextConfig } from "next";

const config: NextConfig = {
  // Native / filesystem-heavy packages run as plain Node modules, not bundled.
  serverExternalPackages: ["playwright", "playwright-core", "sharp", "handlebars"],
  devIndicators: false,
};

export default config;
