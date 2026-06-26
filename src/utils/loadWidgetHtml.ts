import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const EXT_APPS_PLACEHOLDER = "/*___MCP_ARGOCD_EXT_APPS_BUNDLE___*/";

function inlineExtAppsBundle(): string {
  const bundlePath = require.resolve(
    "@modelcontextprotocol/ext-apps/app-with-deps"
  );
  const bundle = readFileSync(bundlePath, "utf8");

  return bundle.replace(/export\{([^}]+)\};?\s*$/, (_, body: string) => {
    const exports = body.split(",").map((part: string) => {
      const [local, exported] = part.split(" as ").map((item) => item.trim());
      return `${exported ?? local}:${local}`;
    });
    return `globalThis.ExtApps={${exports.join(",")}};`;
  });
}

function widgetSourcePath(widgetFileName: string): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return join(moduleDir, "../widgets", widgetFileName);
}

export function loadWidgetHtml(widgetFileName: string): string {
  const template = readFileSync(widgetSourcePath(widgetFileName), "utf8");

  if (!template.includes(EXT_APPS_PLACEHOLDER)) {
    throw new Error(
      `Widget ${widgetFileName} is missing placeholder ${EXT_APPS_PLACEHOLDER}`
    );
  }

  return template.replace(EXT_APPS_PLACEHOLDER, () => inlineExtAppsBundle());
}
