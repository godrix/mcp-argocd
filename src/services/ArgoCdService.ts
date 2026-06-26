import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import axios, { AxiosInstance } from "axios";
import { ArgoCdConfig } from "../config/ArgoCdConfig.js";
import {
  ArgoCdApiCallOptions,
  ArgoCdApiEndpoint,
  ArgoCdSettings,
  ArgoCdUserInfo,
  HttpMethod,
  SwaggerParameter,
} from "../model/ArgoCdApi.js";
import { ArgoCdAuthService } from "./ArgoCdAuthService.js";
import { formatArgoCdHttpError } from "../utils/argoCdHttp.js";

const HTTP_METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

interface SwaggerDocument {
  paths?: Record<
    string,
    Partial<Record<string, { operationId?: string; summary?: string; tags?: string[]; parameters?: SwaggerParameter[] }>>
  >;
}

export class ArgoCdService {
  private catalog: ArgoCdApiEndpoint[] | null = null;
  private readonly settingsCache = new Map<
    string,
    { expiresAt: number; data: ArgoCdSettings }
  >();
  private static readonly SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
  readonly readOnly: boolean;

  constructor(
    private readonly config: ArgoCdConfig,
    private readonly authService: ArgoCdAuthService
  ) {
    this.readOnly = config.readOnly;
  }

  listProfiles() {
    return this.authService.listProfiles().map((profile) => ({
      name: profile.name,
      label: profile.label,
      url: profile.url,
      context: profile.context,
      isDefault: profile.name === this.authService.defaultProfile,
    }));
  }

  private swaggerPath(): string {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(moduleDir, "../../swagger.txt"),
      join(moduleDir, "../../../swagger.txt"),
      join(process.cwd(), "swagger.txt"),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error("swagger.txt not found. Ensure swagger.txt is in the package root.");
  }

  loadCatalog(): ArgoCdApiEndpoint[] {
    if (this.catalog) {
      return this.catalog;
    }

    const raw = readFileSync(this.swaggerPath(), "utf8");
    const swagger = JSON.parse(raw) as SwaggerDocument;
    const endpoints: ArgoCdApiEndpoint[] = [];

    for (const [path, methods] of Object.entries(swagger.paths ?? {})) {
      for (const [method, operation] of Object.entries(methods ?? {})) {
        const upperMethod = method.toUpperCase() as HttpMethod;
        if (!HTTP_METHODS.has(upperMethod) || !operation) {
          continue;
        }

        endpoints.push({
          operationId: operation.operationId ?? `${upperMethod} ${path}`,
          method: upperMethod,
          path,
          summary: operation.summary ?? "",
          tags: operation.tags ?? [],
          parameters: operation.parameters ?? [],
          readOnly: upperMethod === "GET",
        });
      }
    }

    this.catalog = endpoints.sort((a, b) =>
      `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)
    );

    return this.catalog;
  }

  searchEndpoints(query?: string, tag?: string): ArgoCdApiEndpoint[] {
    const normalizedQuery = query?.trim().toLowerCase();
    const normalizedTag = tag?.trim().toLowerCase();

    return this.loadCatalog().filter((endpoint) => {
      if (normalizedTag && !endpoint.tags.some((item) => item.toLowerCase() === normalizedTag)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        endpoint.operationId,
        endpoint.path,
        endpoint.summary,
        endpoint.method,
        ...endpoint.tags,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }

  describeEndpoint(input: {
    operationId?: string;
    path?: string;
    method?: HttpMethod;
  }): ArgoCdApiEndpoint {
    const catalog = this.loadCatalog();

    if (input.operationId) {
      const match = catalog.find(
        (endpoint) => endpoint.operationId === input.operationId
      );
      if (!match) {
        throw new Error(`Endpoint not found for operationId: ${input.operationId}`);
      }
      return match;
    }

    if (input.path && input.method) {
      const match = catalog.find(
        (endpoint) => endpoint.path === input.path && endpoint.method === input.method
      );
      if (!match) {
        throw new Error(`Endpoint not found for ${input.method} ${input.path}`);
      }
      return match;
    }

    throw new Error("Provide operationId or both path and method.");
  }

  async getSettings(
    profileName?: string,
    serverUrl?: string,
    options?: { useCache?: boolean }
  ): Promise<ArgoCdSettings> {
    try {
      const url = serverUrl
        ? serverUrl.startsWith("http")
          ? serverUrl.replace(/\/+$/, "")
          : `https://${serverUrl.replace(/\/+$/, "")}`
        : this.authService.resolveServerUrl(profileName);

      const cacheKey = url;
      if (options?.useCache !== false) {
        const cached = this.settingsCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          return cached.data;
        }
      }

      const client = this.createClient(url, false);
      const data = await this.request<ArgoCdSettings>(client, {
        method: "GET",
        url: "/api/v1/settings",
      });

      this.settingsCache.set(cacheKey, {
        expiresAt: Date.now() + ArgoCdService.SETTINGS_CACHE_TTL_MS,
        data,
      });

      return data;
    } catch (error) {
      throw this.wrapAxiosError(error, "Error fetching Argo CD settings");
    }
  }

  async getUserInfo(profileName?: string): Promise<ArgoCdUserInfo> {
    const profile = profileName ?? this.authService.defaultProfile;

    try {
      const client = await this.createAuthenticatedClient(profileName);
      return await this.request<ArgoCdUserInfo>(
        client,
        {
          method: "GET",
          url: "/api/v1/session/userinfo",
        },
        profile
      );
    } catch (error) {
      throw this.wrapAxiosError(error, "Error fetching Argo CD user info", profile);
    }
  }

  async callApi(options: ArgoCdApiCallOptions): Promise<unknown> {
    if (this.readOnly && options.method !== "GET") {
      throw new Error(
        `Write operation ${options.method} ${options.path} blocked while ARGOCD_READ_ONLY=true.`
      );
    }

    const endpoint = this.describeEndpoint({
      path: options.path,
      method: options.method,
    });

    if (this.readOnly && !endpoint.readOnly) {
      throw new Error(
        `Endpoint ${options.method} ${options.path} is not read-only and ARGOCD_READ_ONLY=true.`
      );
    }

    const resolvedPath = this.resolvePath(options.path, options.pathParams);
    const profile = options.profile ?? this.authService.defaultProfile;
    const client = await this.createAuthenticatedClient(options.profile);

    try {
      return await this.request(
        client,
        {
          method: options.method,
          url: resolvedPath,
          params: options.queryParams,
          data: options.body,
        },
        profile
      );
    } catch (error) {
      throw this.wrapAxiosError(
        error,
        `Error calling ${options.method} ${options.path}`,
        profile
      );
    }
  }

  getProfilesAuthStatus() {
    return {
      ...this.authService.getProfilesAuthStatus(),
      configPath: this.authService.configPath,
      readOnlyMode: this.readOnly,
      allowRefresh: this.config.allowRefresh,
    };
  }

  async getProfilesAuthStatusLive() {
    const base = this.getProfilesAuthStatus();
    const profiles = await Promise.all(
      base.profiles.map(async (profile) => {
        if (!profile.tokenPresent) {
          return {
            ...profile,
            authenticated: false,
            tokenValid: false,
            recommendedAction:
              profile.recommendedAction ??
              this.authService.authenticationHint(profile.profile),
          };
        }

        try {
          const userInfo = await this.getUserInfo(profile.profile);
          return {
            ...profile,
            authenticated: true,
            tokenValid: true,
            username: userInfo.username,
            recommendedAction: undefined,
            authError: undefined,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const expired = /\b(401|403)\b/.test(message);

          return {
            ...profile,
            authenticated: false,
            tokenValid: false,
            recommendedAction: expired
              ? this.authService.expiredTokenAction(profile.profile)
              : this.authService.authenticationHint(profile.profile),
            authError: message,
          };
        }
      })
    );

    return {
      ...base,
      profiles,
      validatedLive: true,
      note: "authenticated reflects live token validity (probed via /api/v1/session/userinfo).",
    };
  }

  private resolvePath(
    path: string,
    pathParams?: Record<string, string | number>
  ): string {
    if (!pathParams) {
      return path;
    }

    let resolved = path;
    for (const [key, value] of Object.entries(pathParams)) {
      resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
    }

    if (/\{[^}]+\}/.test(resolved)) {
      throw new Error(
        `Missing path parameters for ${path}. Provide pathParams for all placeholders.`
      );
    }

    return resolved;
  }

  private async createAuthenticatedClient(profileName?: string): Promise<AxiosInstance> {
    const session = this.authService.loadSession(profileName);
    if (!session?.token) {
      const profile = profileName ?? this.authService.defaultProfile;
      throw new Error(
        `Not authenticated for profile "${profile}". ${this.authService.authenticationHint(profile)}`
      );
    }

    return this.createClient(session.url, true, session.token);
  }

  private createClient(
    baseUrl: string,
    useAuth: boolean,
    token?: string
  ): AxiosInstance {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (useAuth && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return axios.create({
      baseURL: baseUrl,
      headers,
      validateStatus: () => true,
      timeout: 120_000,
    });
  }

  private async request<T = unknown>(
    client: AxiosInstance,
    config: {
      method: HttpMethod;
      url: string;
      params?: Record<string, string | number | boolean>;
      data?: unknown;
    },
    profile?: string
  ): Promise<T> {
    const response = await client.request<T>(config);

    if (response.status >= 400) {
      throw formatArgoCdHttpError({
        status: response.status,
        data: response.data,
        profile,
        authService: this.authService,
      });
    }

    return response.data;
  }

  wrapAxiosError(error: unknown, context: string, profile?: string): Error {
    if (error instanceof Error) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;

      if (status && status >= 400) {
        return formatArgoCdHttpError({
          status,
          data,
          profile,
          authService: this.authService,
          context,
        });
      }

      const details =
        data !== undefined ? JSON.stringify(data) : error.message;
      return new Error(`${context} (${status ?? "network"}): ${details}`);
    }

    return new Error(`${context}: ${String(error)}`);
  }
}
