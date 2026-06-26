import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ArgoCdApplicationService } from "../../services/ArgoCdApplicationService.js";
import { ArgoCdAuthService } from "../../services/ArgoCdAuthService.js";
import { ArgoCdService } from "../../services/ArgoCdService.js";

function jsonResource(uri: URL, data: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export class ArgoCdResourcesController {
  constructor(
    private readonly server: McpServer,
    private readonly argoCdService: ArgoCdService,
    private readonly authService: ArgoCdAuthService,
    private readonly appService: ArgoCdApplicationService
  ) {
    this.registerResources();
  }

  private registerResources(): void {
    this.registerProfilesResource();
    this.registerPriorityAppsResource();
    this.registerSettingsResource();
    this.registerApplicationIndexResource();
  }

  private registerProfilesResource(): void {
    this.server.registerResource(
      "argocd-profiles",
      "argocd://profiles",
      {
        title: "Argo CD profiles",
        description:
          "Configured environment profiles (qa/stg/prod), URLs, auth status, and MCP mode flags.",
        mimeType: "application/json",
      },
      async (uri) =>
        jsonResource(uri, {
          ...this.argoCdService.getProfilesAuthStatus(),
          generatedAt: new Date().toISOString(),
        })
    );
  }

  private registerPriorityAppsResource(): void {
    this.server.registerResource(
      "argocd-priority-apps",
      "argocd://priority-apps",
      {
        title: "Argo CD priority applications",
        description:
          "MCP bookmark/priority application names from ARGOCD_PRIORITY_APPS env vars.",
        mimeType: "application/json",
      },
      async (uri) => {
        const profiles = this.authService.listProfiles().map((profile) => ({
          profile: profile.name,
          label: profile.label,
          names: this.appService.getPriorityAppNames(profile.name),
        }));

        return jsonResource(uri, {
          defaultProfile: this.authService.defaultProfile,
          ...this.appService.getPriorityAppsConfig(),
          byProfile: profiles,
          generatedAt: new Date().toISOString(),
        });
      }
    );
  }

  private registerSettingsResource(): void {
    this.server.registerResource(
      "argocd-settings",
      new ResourceTemplate("argocd://settings/{profile}", {
        list: async () => ({
          resources: this.authService.listProfiles().map((profile) => ({
            uri: `argocd://settings/${profile.name}`,
            name: profile.name,
            title: `Argo CD settings (${profile.label})`,
            mimeType: "application/json",
          })),
        }),
        complete: {
          profile: async () => this.authService.profileNames(),
        },
      }),
      {
        title: "Argo CD settings",
        description:
          "Public Argo CD settings per profile (OIDC, UI banners, kustomize). Cached for 5 minutes.",
        mimeType: "application/json",
      },
      async (uri, { profile }) => {
        const profileName = String(profile);
        const settings = await this.argoCdService.getSettings(profileName, undefined, {
          useCache: true,
        });

        return jsonResource(uri, {
          profile: profileName,
          settings,
          cached: true,
          generatedAt: new Date().toISOString(),
        });
      }
    );
  }

  private registerApplicationIndexResource(): void {
    this.server.registerResource(
      "argocd-application-index",
      new ResourceTemplate("argocd://application-index/{profile}", {
        list: async () => ({
          resources: this.authService.listProfiles().map((profile) => ({
            uri: `argocd://application-index/${profile.name}`,
            name: profile.name,
            title: `Application index (${profile.label})`,
            mimeType: "application/json",
          })),
        }),
        complete: {
          profile: async () => this.authService.profileNames(),
        },
      }),
      {
        title: "Argo CD application index",
        description:
          "Cached application names and summaries per profile. Populated on first access; respects ARGOCD_APP_CACHE_TTL_SECONDS.",
        mimeType: "application/json",
      },
      async (uri, { profile }) => {
        const profileName = String(profile);
        const index = await this.appService.getApplicationIndex(profileName);
        const status = this.appService.getApplicationCacheStatus();
        const profileStatus = status.profiles.find(
          (item) => item.profile === profileName
        );

        return jsonResource(uri, {
          ...index,
          cached: profileStatus?.cached ?? true,
          ttlSeconds: status.ttlSeconds,
          generatedAt: new Date().toISOString(),
        });
      }
    );
  }
}
