#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "dotenv/config";
import { loadArgoCdConfig } from "./config/ArgoCdConfig.js";
import { ArgoCdPromptController } from "./controllers/prompts/ArgoCdPromptController.js";
import { ArgoCdResourcesController } from "./controllers/resources/ArgoCdResourcesController.js";
import { ArgoCdAppToolsController } from "./controllers/tools/ArgoCdAppToolsController.js";
import { ArgoCdApplicationToolsController } from "./controllers/tools/ArgoCdApplicationToolsController.js";
import { ArgoCdInfraToolsController } from "./controllers/tools/ArgoCdInfraToolsController.js";
import { ArgoCdToolsController } from "./controllers/tools/ArgoCdToolsController.js";
import { ArgoCdApplicationService } from "./services/ArgoCdApplicationService.js";
import { ArgoCdAuthService } from "./services/ArgoCdAuthService.js";
import { ArgoCdProjectService } from "./services/ArgoCdProjectService.js";
import { ArgoCdService } from "./services/ArgoCdService.js";

const packageJson = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../package.json"),
    "utf8"
  )
) as { version: string };

async function main() {
  const config = loadArgoCdConfig();
  const authService = new ArgoCdAuthService(config);
  const argoCdService = new ArgoCdService(config, authService);
  const appService = new ArgoCdApplicationService(config, authService);
  const projectService = new ArgoCdProjectService(config, authService);
  const status = argoCdService.getProfilesAuthStatus();

  const server = new McpServer({
    name: "@godrix/argocd-mcp",
    version: packageJson.version,
  });

  new ArgoCdToolsController(server, argoCdService, authService);
  new ArgoCdApplicationToolsController(server, appService, authService);
  new ArgoCdAppToolsController(server, appService, authService);
  new ArgoCdInfraToolsController(server, projectService, authService);
  new ArgoCdResourcesController(server, argoCdService, authService, appService);
  new ArgoCdPromptController(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const modeLabel = config.readOnly ? "Read-only" : "Full access";

  console.error("========================================");
  console.error(`Argo CD MCP Server running v${packageJson.version}`);
  console.error(`Mode: ${modeLabel}`);
  console.error(`Default profile: ${status.defaultProfile}`);
  console.error(`Profiles: ${status.profiles.map((p) => p.profile).join(", ") || "(none)"}`);
  console.error(`Config: ${authService.configPath}`);
  console.error("========================================");
  console.error("");
  console.error("Resources:");
  console.error("  argocd://profiles");
  console.error("  argocd://priority-apps");
  console.error("  argocd://settings/{profile}");
  console.error("");
  console.error("Prompts:");
  console.error("  daily-argocd-healthcheck");
  console.error("  investigate-outofsync");
  console.error("  safe-sync-application");
  console.error("========================================");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
