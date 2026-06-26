import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ArgoCdService } from "../../services/ArgoCdService.js";
import { ArgoCdAuthService } from "../../services/ArgoCdAuthService.js";
import { profileSchema, toolError, toolResponse } from "./toolUtils.js";

const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export class ArgoCdToolsController {
  constructor(
    private readonly server: McpServer,
    private readonly argoCdService: ArgoCdService,
    private readonly authService: ArgoCdAuthService
  ) {
    this.registerTools();
  }

  private registerTools(): void {
    this.registerListProfiles();
    this.registerArgocdLogin();
    this.registerArgocdSetApiKey();
    this.registerGetSettings();
    this.registerGetUserInfo();
    this.registerSearchEndpoints();
    this.registerDescribeEndpoint();
    this.registerCallApi();
    this.registerAuthStatus();
  }

  private registerListProfiles(): void {
    this.server.tool(
      "list-argocd-profiles",
      "List configured Argo CD environment profiles (qa, stg, prod, etc.) with URLs and authentication status.",
      {
        validateTokens: z
          .boolean()
          .optional()
          .describe(
            "When true, probes /api/v1/session/userinfo to detect expired tokens (slower)."
          ),
      },
      async ({ validateTokens }) => {
        try {
          const result = validateTokens
            ? await this.argoCdService.getProfilesAuthStatusLive()
            : this.argoCdService.getProfilesAuthStatus();
          return toolResponse(result);
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerArgocdLogin(): void {
    this.server.tool(
      "argocd_login",
      "Authenticate to Argo CD for a profile. Default: SSO via argocd CLI (opens browser). Alternative: username/password with sso=false. For API tokens without CLI login, use argocd_set_api_key or ARGOCD_API_KEY env vars.",
      {
        profile: profileSchema(this.authService),
        sso: z
          .boolean()
          .optional()
          .describe("Use SSO login (default: true). Set false for username/password."),
        username: z
          .string()
          .optional()
          .describe("Argo CD username when sso=false"),
        password: z
          .string()
          .optional()
          .describe("Argo CD password when sso=false"),
        ssoPort: z
          .number()
          .int()
          .optional()
          .describe("Local OAuth callback port for SSO (default 8085)"),
        grpcWeb: z
          .boolean()
          .optional()
          .describe("Use gRPC-web (recommended behind ingress). Default: true"),
        launchBrowser: z
          .boolean()
          .optional()
          .describe("Automatically open the browser for SSO. Default: true"),
      },
      async ({ profile, sso, username, password, ssoPort, grpcWeb, launchBrowser }) => {
        try {
          const session = await this.authService.login({
            profile,
            sso,
            username,
            password,
            ssoPort,
            grpcWeb,
            launchBrowser,
          });

          return toolResponse({
            message: sso === false ? "Login successful" : "SSO login successful",
            authMethod: "argocd-cli",
            profile: session.profile,
            server: session.server,
            url: session.url,
            username: session.username,
            configPath: this.authService.configPath,
            readOnlyMode: this.argoCdService.readOnly,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerArgocdSetApiKey(): void {
    this.server.tool(
      "argocd_set_api_key",
      "Set an Argo CD API key (Bearer token) in memory for the current MCP session. Use when you have a token from the Argo CD UI (User Settings → API tokens) or argocd account generate-token. Env vars (ARGOCD_API_KEY) take precedence on server restart.",
      {
        profile: profileSchema(this.authService),
        apiKey: z
          .string()
          .min(1)
          .describe("Argo CD API token / JWT (Bearer)"),
      },
      async ({ profile, apiKey }) => {
        try {
          const resolvedProfile = this.authService.setApiKey(profile, apiKey);
          const session = this.authService.loadSession(resolvedProfile.name);

          return toolResponse({
            message: "API key configured for this MCP session",
            authMethod: "api-key",
            profile: resolvedProfile.name,
            url: resolvedProfile.url,
            authenticated: Boolean(session?.token),
            tokenSource: "api-key-memory",
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerAuthStatus(): void {
    this.server.tool(
      "argocd_auth_status",
      "Show authentication status for all configured Argo CD profiles. Probes the API to detect expired or revoked tokens and returns recommendedAction (e.g. run argocd_login again).",
      {},
      async () => {
        try {
          return toolResponse(await this.argoCdService.getProfilesAuthStatusLive());
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerGetSettings(): void {
    this.server.tool(
      "get-argocd-settings",
      "Get public Argo CD settings for an environment profile (URL, OIDC config, UI banners). Does not require authentication.",
      {
        profile: profileSchema(this.authService),
        server: z
          .string()
          .optional()
          .describe("Optional server URL/host override (ignores profile URL)."),
      },
      async ({ profile, server }) => {
        try {
          const settings = await this.argoCdService.getSettings(profile, server);
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            settings,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerGetUserInfo(): void {
    this.server.tool(
      "get-argocd-userinfo",
      "Get the authenticated user for an environment profile (username, Azure groups, issuer).",
      {
        profile: profileSchema(this.authService),
      },
      async ({ profile }) => {
        try {
          const userInfo = await this.argoCdService.getUserInfo(profile);
          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            userInfo,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerSearchEndpoints(): void {
    this.server.tool(
      "search-argocd-endpoints",
      "Search Argo CD REST API endpoints from the bundled swagger catalog. Use before call-argocd-api.",
      {
        query: z
          .string()
          .optional()
          .describe("Keyword filter (path, summary, operationId, tag). Example: sync application"),
        tag: z
          .string()
          .optional()
          .describe("Filter by swagger tag. Example: ApplicationService"),
      },
      async ({ query, tag }) => {
        try {
          const endpoints = this.argoCdService.searchEndpoints(query, tag);
          return toolResponse({
            total: endpoints.length,
            readOnlyMode: this.argoCdService.readOnly,
            endpoints: endpoints.map((endpoint) => ({
              operationId: endpoint.operationId,
              method: endpoint.method,
              path: endpoint.path,
              summary: endpoint.summary,
              tags: endpoint.tags,
              readOnly: endpoint.readOnly,
            })),
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerDescribeEndpoint(): void {
    this.server.tool(
      "describe-argocd-endpoint",
      "Get full parameter documentation for an Argo CD API endpoint from swagger.",
      {
        operationId: z
          .string()
          .optional()
          .describe("Swagger operationId. Example: ApplicationService_Get"),
        path: z
          .string()
          .optional()
          .describe("API path. Example: /api/v1/applications/{name}"),
        method: httpMethodSchema
          .optional()
          .describe("HTTP method when using path lookup."),
      },
      async ({ operationId, path, method }) => {
        try {
          const endpoint = this.argoCdService.describeEndpoint({
            operationId,
            path,
            method,
          });

          return toolResponse({
            ...endpoint,
            readOnlyMode: this.argoCdService.readOnly,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  private registerCallApi(): void {
    const description = this.argoCdService.readOnly
      ? "Execute a read-only Argo CD REST API call (GET). Mutations are blocked while ARGOCD_READ_ONLY=true."
      : "Execute any Argo CD REST API call. Use search-argocd-endpoints and describe-argocd-endpoint first.";

    this.server.tool(
      "call-argocd-api",
      description,
      {
        profile: profileSchema(this.authService),
        method: httpMethodSchema.describe("HTTP method"),
        path: z
          .string()
          .describe("API path from swagger. Example: /api/v1/applications/{name}"),
        pathParams: z
          .record(z.union([z.string(), z.number()]))
          .optional()
          .describe('Path placeholders. Example: { "name": "my-app" }'),
        queryParams: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query string parameters"),
        body: z
          .unknown()
          .optional()
          .describe("JSON request body for POST/PUT/PATCH"),
      },
      async ({ profile, method, path, pathParams, queryParams, body }) => {
        try {
          const data = await this.argoCdService.callApi({
            profile,
            method,
            path,
            pathParams,
            queryParams,
            body,
          });

          return toolResponse({
            profile: profile ?? this.authService.defaultProfile,
            data,
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }
}
