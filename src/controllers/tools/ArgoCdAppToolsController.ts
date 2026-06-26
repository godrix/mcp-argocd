import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ArgoCdApplicationService } from "../../services/ArgoCdApplicationService.js";
import { ArgoCdAuthService } from "../../services/ArgoCdAuthService.js";
import { loadWidgetHtml } from "../../utils/loadWidgetHtml.js";
import { profileSchema, toolError } from "./toolUtils.js";

const RESOURCE_URI = "ui://widgets/app-observability.html";
const WIDGET_FILE = "app-observability.html";

export class ArgoCdAppToolsController {
  private readonly widgetHtml: string;

  constructor(
    private readonly server: McpServer,
    private readonly appService: ArgoCdApplicationService,
    private readonly authService: ArgoCdAuthService
  ) {
    this.widgetHtml = loadWidgetHtml(WIDGET_FILE);
    this.registerResource();
    this.registerViewTool();
    this.registerRefreshTool();
  }

  private observabilityInputSchema() {
    return {
      profile: profileSchema(this.authService),
      name: z.string().min(1).describe("Argo CD application name"),
    };
  }

  private async runObservability(
    profile: string | undefined,
    name: string
  ): Promise<CallToolResult> {
    const { view, summary } = await this.appService.getApplicationObservability(
      profile,
      name
    );

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: view as unknown as Record<string, unknown>,
    };
  }

  private registerResource(): void {
    registerAppResource(
      this.server,
      "app-observability",
      RESOURCE_URI,
      {
        description:
          "Dashboard de observabilidade de uma application Argo CD (health, sync, Git, conditions)",
      },
      async () => ({
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: this.widgetHtml,
          },
        ],
      })
    );
  }

  private registerViewTool(): void {
    registerAppTool(
      this.server,
      "view-application-observability",
      {
        title: "Observabilidade da application",
        description:
          "Abre um painel interativo com health, sync, Git, conditions e recursos unhealthy de uma application Argo CD. Em hosts sem MCP App, retorna JSON e resumo em texto.",
        inputSchema: this.observabilityInputSchema(),
        annotations: {
          title: "Observabilidade Argo CD",
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
        _meta: {
          ui: { resourceUri: RESOURCE_URI },
        },
      },
      async (input) => {
        try {
          return await this.runObservability(input.profile, input.name);
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerRefreshTool(): void {
    registerAppTool(
      this.server,
      "refresh-application-observability",
      {
        title: "Atualizar observabilidade",
        description:
          "Recarrega dados de observabilidade para o widget. Chamado pela UI, não pelo modelo.",
        inputSchema: this.observabilityInputSchema(),
        annotations: {
          title: "Refresh observability",
          readOnlyHint: true,
        },
        _meta: {
          ui: { visibility: ["app"] },
        },
      },
      async (input) => {
        try {
          return await this.runObservability(input.profile, input.name);
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }
}
