import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class ArgoCdPromptController {
  constructor(private readonly server: McpServer) {
    this.registerPrompts();
  }

  private registerPrompts(): void {
    this.registerDailyHealthcheckPrompt();
    this.registerInvestigateOutOfSyncPrompt();
    this.registerSafeSyncPrompt();
  }

  private registerDailyHealthcheckPrompt(): void {
    this.server.registerPrompt(
      "daily-argocd-healthcheck",
      {
        title: "Daily Argo CD healthcheck",
        description:
          "Runs a daily health sweep across priority apps and unhealthy/out-of-sync applications.",
        argsSchema: {
          profile: z
            .string()
            .optional()
            .describe("Environment profile (qa, stg, prod). Default from ARGOCD_DEFAULT_PROFILE."),
        },
      },
      ({ profile }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Run a daily Argo CD healthcheck${profile ? ` for profile "${profile}"` : ""}.

Workflow:
1. Read resources argocd://profiles and argocd://priority-apps for context.
2. argocd_auth_status — if tokenValid is false, run argocd_login before continuing.
3. list-priority-applications (with live status) for configured bookmark apps.
3. list-applications with healthStatus=Degraded (limit 20).
4. list-applications with syncStatus=OutOfSync (limit 20).
5. For each priority app that is Degraded or OutOfSync, run diagnose-application.
6. Summarize in Portuguese:
   - Total priority apps and their status
   - Top degraded apps (name, project, health, sync)
   - Top out-of-sync apps
   - Recommended next actions (refresh vs sync vs investigate logs)
   - Explicitly mention if ARGOCD_READ_ONLY blocks sync

Do not sync anything in this prompt unless the user explicitly asks.`,
            },
          },
        ],
      })
    );
  }

  private registerInvestigateOutOfSyncPrompt(): void {
    this.server.registerPrompt(
      "investigate-outofsync",
      {
        title: "Investigate OutOfSync application",
        description:
          "Investigates why an application is OutOfSync and whether sync is safe.",
        argsSchema: {
          name: z.string().describe("Application name"),
          profile: z
            .string()
            .optional()
            .describe("Environment profile (qa, stg, prod)"),
        },
      },
      ({ name, profile }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Investigate why Argo CD application "${name}" is OutOfSync${profile ? ` in profile "${profile}"` : ""}.

Workflow:
1. get-application — confirm sync status, health, source repo/path/revision, conditions.
2. get-application-diff — show what would change on sync.
3. get-application-manifests — compare rendered manifests if useful.
4. call-argocd-api GET /api/v1/applications/{name}/syncwindows — check sync windows.
5. get-application-events — recent events related to drift.

Report in Portuguese:
- Current sync/health status
- Summary of diff (what resources drifted)
- Whether sync windows block manual sync
- Risk assessment (safe to sync vs needs human review)
- Recommended action: refresh-application, sync-application, or escalate

Do NOT run sync-application unless user confirms after seeing the diff.`,
            },
          },
        ],
      })
    );
  }

  private registerSafeSyncPrompt(): void {
    this.server.registerPrompt(
      "safe-sync-application",
      {
        title: "Safe sync application",
        description:
          "Checks permissions and diff before triggering a controlled sync.",
        argsSchema: {
          name: z.string().describe("Application name"),
          profile: z
            .string()
            .optional()
            .describe("Environment profile (qa, stg, prod)"),
          prune: z
            .boolean()
            .optional()
            .describe("Prune resources during sync (default false)"),
          force: z
            .boolean()
            .optional()
            .describe("Force sync (default false)"),
        },
      },
      ({ name, profile, prune, force }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Safely evaluate and optionally sync Argo CD application "${name}"${profile ? ` in profile "${profile}"` : ""}.

Parameters requested: prune=${prune ?? false}, force=${force ?? false}

Pre-flight workflow:
1. argocd_auth_status — confirm tokenValid for the target profile; if false, run argocd_login first.
2. call-argocd-api GET /api/v1/account/can-i/applications/{name}/sync — check RBAC.
3. get-application — current status.
4. get-application-diff — show pending changes.
5. call-argocd-api GET /api/v1/applications/{name}/syncwindows — verify sync allowed.

If ARGOCD_READ_ONLY=true, stop and explain that sync is blocked.

If pre-flight passes AND the user intent is to sync:
6. Present diff summary and ask for explicit confirmation.
7. Only if confirmed: sync-application with prune=${prune ?? false}, force=${force ?? false}.
8. get-application again to report operation phase.

Always respond in Portuguese. Never sync prod without explicitly naming the profile.`,
            },
          },
        ],
      })
    );
  }
}
