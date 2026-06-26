import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ArgoCdApplicationService } from "../../services/ArgoCdApplicationService.js";
import { ArgoCdAuthService } from "../../services/ArgoCdAuthService.js";
import { profileSchema, toolError, toolResponse } from "./toolUtils.js";

export class ArgoCdApplicationToolsController {
  constructor(
    private readonly server: McpServer,
    private readonly appService: ArgoCdApplicationService,
    private readonly authService: ArgoCdAuthService
  ) {
    this.registerTools();
  }

  private registerTools(): void {
    this.registerListApplications();
    this.registerSearchApplications();
    this.registerApplicationCacheTools();
    this.registerListPriorityApplications();
    this.registerGetApplication();
    this.registerGetApplicationDiff();
    this.registerGetApplicationManifests();
    this.registerRefreshApplication();
    this.registerSyncApplication();
    this.registerGetPodLogs();
    this.registerGetResourceTree();
    this.registerTerminateOperation();
    this.registerDiagnoseApplication();
  }

  private registerListApplications(): void {
    this.server.tool(
      "list-applications",
      "List Argo CD applications with optional filters. Priority apps from env (ARGOCD_PRIORITY_APPS) appear first with isPriority=true.",
      {
        profile: profileSchema(this.authService),
        name: z
          .string()
          .optional()
          .describe("Filter by exact application name (API-side, not substring)"),
        nameContains: z
          .string()
          .optional()
          .describe(
            "Substring search on cached application names (LIKE). Uses in-memory cache — much faster than listing all apps."
          ),
        projects: z
          .array(z.string())
          .optional()
          .describe("Filter by Argo CD project names"),
        selector: z.string().optional().describe("Label selector"),
        repo: z.string().optional().describe("Filter by repository URL"),
        healthStatus: z
          .enum(["Healthy", "Progressing", "Degraded", "Suspended", "Missing", "Unknown"])
          .optional()
          .describe("Filter by health status (client-side)"),
        syncStatus: z
          .enum(["Synced", "OutOfSync", "Unknown"])
          .optional()
          .describe("Filter by sync status (client-side)"),
        priorityOnly: z
          .boolean()
          .optional()
          .describe(
            "Return only apps configured in ARGOCD_PRIORITY_APPS / ARGOCD_PRIORITY_APPS_<PROFILE>"
          ),
        namesOnly: z
          .boolean()
          .optional()
          .describe("Return a names array instead of full summaries only in names field"),
        useCache: z
          .boolean()
          .optional()
          .describe(
            "Use cached application list instead of live API call (respects TTL)"
          ),
        refreshCache: z
          .boolean()
          .optional()
          .describe("Force refresh application cache before listing"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max applications to return (priority apps kept first)"),
      },
      async (input) => {
        try {
          const result = await this.appService.listApplications(input);
          return toolResponse({
            profile: input.profile ?? this.authService.defaultProfile,
            readOnlyMode: this.appService.readOnly,
            ...result,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerSearchApplications(): void {
    this.server.tool(
      "search-applications",
      "Search Argo CD applications by substring (LIKE) using an in-memory cache. Matches name, project, repo, path and namespace. The Argo CD API only supports exact name match — use this tool for partial search (e.g. query='adherence').",
      {
        profile: profileSchema(this.authService),
        query: z
          .string()
          .min(1)
          .describe("Substring to search (case-insensitive LIKE)"),
        project: z.string().optional().describe("Filter by exact project name"),
        healthStatus: z
          .enum(["Healthy", "Progressing", "Degraded", "Suspended", "Missing", "Unknown"])
          .optional()
          .describe("Filter by health status"),
        syncStatus: z
          .enum(["Synced", "OutOfSync", "Unknown"])
          .optional()
          .describe("Filter by sync status"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max results (default: all matches, sorted by name)"),
        namesOnly: z
          .boolean()
          .optional()
          .describe("Include compact names array in response"),
        refreshCache: z
          .boolean()
          .optional()
          .describe("Force refresh cache before searching"),
      },
      async (input) => {
        try {
          const result = await this.appService.searchApplications(input);
          return toolResponse({
            readOnlyMode: this.appService.readOnly,
            ...result,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerApplicationCacheTools(): void {
    this.server.tool(
      "refresh-application-cache",
      "Force refresh the in-memory application name cache for a profile. Useful after creating/deleting applications.",
      {
        profile: profileSchema(this.authService),
      },
      async ({ profile }) => {
        try {
          const result = await this.appService.refreshApplicationCache(profile);
          return toolResponse(result);
        } catch (error) {
          return toolError(error);
        }
      }
    );

    this.server.tool(
      "application-cache-status",
      "Show application cache status per profile (enabled, TTL, count, expiry).",
      {},
      async () => {
        try {
          return toolResponse(this.appService.getApplicationCacheStatus());
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerListPriorityApplications(): void {
    this.server.tool(
      "list-priority-applications",
      "List MCP priority/bookmark applications configured in env (ARGOCD_PRIORITY_APPS). Fetches live status for each name. Argo CD UI favorites are browser-only and cannot be read via API.",
      {
        profile: profileSchema(this.authService),
        namesOnly: z
          .boolean()
          .optional()
          .describe("If true, return only the configured names array"),
      },
      async ({ profile, namesOnly }) => {
        try {
          const result = await this.appService.listPriorityApplications(profile);
          const resolvedProfile = profile ?? this.authService.defaultProfile;

          if (namesOnly) {
            return toolResponse({
              profile: resolvedProfile,
              names: result.names,
              configuredNames: result.configuredNames,
              missing: result.missing,
            });
          }

          return toolResponse({
            profile: resolvedProfile,
            ...result,
            priorityConfig: this.appService.getPriorityAppsConfig(),
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerGetApplication(): void {
    this.server.tool(
      "get-application",
      "Get detailed status of a single Argo CD application (sync, health, conditions, source).",
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
      },
      async ({ profile, name }) => {
        try {
          const result = await this.appService.getApplication(profile, name);
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            ...result,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerGetApplicationDiff(): void {
    this.server.tool(
      "get-application-diff",
      "Server-side dry-run diff for an application (what would change on sync).",
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
        project: z.string().optional().describe("Argo CD project name override"),
        appNamespace: z.string().optional().describe("Application namespace override"),
      },
      async ({ profile, name, project, appNamespace }) => {
        try {
          const diff = await this.appService.getApplicationDiff(profile, name, {
            project,
            appNamespace,
          });
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            name,
            diff,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerGetApplicationManifests(): void {
    this.server.tool(
      "get-application-manifests",
      "Get rendered manifests for an application (optionally at a specific revision).",
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
        revision: z.string().optional().describe("Git revision to render"),
        project: z.string().optional().describe("Argo CD project name override"),
        noCache: z.boolean().optional().describe("Bypass manifest cache"),
      },
      async ({ profile, name, revision, project, noCache }) => {
        try {
          const manifests = await this.appService.getApplicationManifests(
            profile,
            name,
            { revision, project, noCache }
          );
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            name,
            manifests,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerRefreshApplication(): void {
    this.server.tool(
      "refresh-application",
      "Refresh an application (reconcile from Git). Use mode=hard to invalidate cache. Allowed when ARGOCD_ALLOW_REFRESH=true (default).",
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
        mode: z
          .enum(["normal", "hard"])
          .optional()
          .describe("Refresh mode. Default: hard"),
      },
      async ({ profile, name, mode }) => {
        try {
          const result = await this.appService.refreshApplication(
            profile,
            name,
            mode ?? "hard"
          );
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            refreshMode: mode ?? "hard",
            ...result,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerSyncApplication(): void {
    const description = this.appService.readOnly
      ? "Sync application to target state. Blocked while ARGOCD_READ_ONLY=true."
      : "Sync application to target state (prune, force, dry-run supported).";

    this.server.tool(
      "sync-application",
      description,
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
        prune: z.boolean().optional().describe("Prune resources during sync"),
        force: z.boolean().optional().describe("Force sync (replace)"),
        dryRun: z.boolean().optional().describe("Dry run only"),
        revision: z.string().optional().describe("Sync to specific revision"),
      },
      async ({ profile, name, prune, force, dryRun, revision }) => {
        try {
          const application = await this.appService.syncApplication(
            profile,
            name,
            { prune, force, dryRun, revision }
          );
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            message: `Sync triggered for ${name}`,
            summary: {
              name: application.metadata?.name,
              syncStatus: application.status?.sync?.status,
              healthStatus: application.status?.health?.status,
              operationPhase: application.status?.operationState?.phase,
            },
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerGetPodLogs(): void {
    this.server.tool(
      "get-application-pod-logs",
      "Get pod logs for an application (buffered tail, no streaming). Specify podName or use filters.",
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
        podName: z.string().optional().describe("Pod name"),
        namespace: z.string().optional().describe("Pod namespace"),
        container: z.string().optional().describe("Container name"),
        tailLines: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Number of log lines (default 200)"),
        sinceSeconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Logs since N seconds ago"),
        filter: z.string().optional().describe("Log content filter"),
      },
      async (input) => {
        try {
          const { name, profile, ...logOptions } = input;
          const result = await this.appService.getPodLogs(
            profile,
            name,
            logOptions
          );
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            application: name,
            ...result,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerGetResourceTree(): void {
    this.server.tool(
      "get-application-resource-tree",
      "Get the resource tree for an application (pods, services, deployments, health per node).",
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
      },
      async ({ profile, name }) => {
        try {
          const resourceTree = await this.appService.getResourceTree(
            profile,
            name
          );
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            name,
            resourceTree,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerTerminateOperation(): void {
    const description = this.appService.readOnly
      ? "Terminate running sync/operation. Blocked while ARGOCD_READ_ONLY=true."
      : "Terminate the currently running operation on an application.";

    this.server.tool(
      "terminate-application-operation",
      description,
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
      },
      async ({ profile, name }) => {
        try {
          await this.appService.terminateApplicationOperation(profile, name);
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            message: `Operation terminated for ${name}`,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerDiagnoseApplication(): void {
    this.server.tool(
      "diagnose-application",
      "Composite troubleshooting: application status + resource tree + events + logs from unhealthy pods.",
      {
        profile: profileSchema(this.authService),
        name: z.string().describe("Application name"),
        tailLines: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Log lines per unhealthy pod (default 100)"),
        maxPodLogs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max unhealthy pods to fetch logs from (default 3)"),
      },
      async ({ profile, name, tailLines, maxPodLogs }) => {
        try {
          const result = await this.appService.diagnoseApplication(
            profile,
            name,
            { tailLines, maxPodLogs }
          );
          return toolResponse(result);
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }
}
