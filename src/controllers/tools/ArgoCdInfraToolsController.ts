import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ArgoCdProjectService } from "../../services/ArgoCdProjectService.js";
import { ArgoCdAuthService } from "../../services/ArgoCdAuthService.js";
import { profileSchema, toolError, toolResponse } from "./toolUtils.js";

export class ArgoCdInfraToolsController {
  constructor(
    private readonly server: McpServer,
    private readonly projectService: ArgoCdProjectService,
    private readonly authService: ArgoCdAuthService
  ) {
    this.registerTools();
  }

  private registerTools(): void {
    this.registerListProjects();
  }

  private registerListProjects(): void {
    this.server.tool(
      "list-projects",
      "List Argo CD AppProjects with description, allowed source repos, and destinations.",
      {
        profile: profileSchema(this.authService),
        name: z.string().optional().describe("Filter by project name"),
        namesOnly: z
          .boolean()
          .optional()
          .describe("Include a names array in the response"),
      },
      async ({ profile, name, namesOnly }) => {
        try {
          const result = await this.projectService.listProjects(profile, name);
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            total: result.total,
            items: result.items,
            ...(namesOnly ? { names: result.names } : {}),
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }
}
