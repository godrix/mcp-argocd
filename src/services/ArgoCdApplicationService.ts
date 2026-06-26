import axios, { AxiosInstance } from "axios";
import { ArgoCdConfig } from "../config/ArgoCdConfig.js";
import {
  ApplicationSummary,
  ApplicationSyncOptions,
  DiagnoseApplicationResult,
  LogLine,
  PodLogsOptions,
} from "../model/ArgoCdApplication.js";
import { HttpMethod } from "../model/ArgoCdApi.js";
import { ArgoCdPriorityAppsRegistry } from "../config/ArgoCdPriorityApps.js";
import { ArgoCdAuthService } from "./ArgoCdAuthService.js";
import {
  buildApplicationObservabilityView,
  summarizeObservabilityView,
} from "../utils/applicationObservability.js";
import { formatArgoCdHttpError } from "../utils/argoCdHttp.js";
import {
  findUnhealthyResources,
  ResourceTreeResponse,
} from "../utils/unhealthyResources.js";
import {
  ApplicationCacheStatus,
  ArgoCdApplicationCache,
} from "./ArgoCdApplicationCache.js";

interface RawApplication {
  metadata?: { name?: string; namespace?: string };
  spec?: {
    project?: string;
    source?: { repoURL?: string; path?: string; targetRevision?: string };
  };
  status?: {
    sync?: { status?: string; revision?: string };
    health?: { status?: string };
    operationState?: { phase?: string };
    conditions?: Array<{
      type?: string;
      message?: string;
      lastTransitionTime?: string;
    }>;
  };
}

interface ApplicationListResponse {
  items?: RawApplication[];
}

export class ArgoCdApplicationService {
  readonly readOnly: boolean;
  readonly allowRefresh: boolean;
  private readonly priorityApps: ArgoCdPriorityAppsRegistry;
  private readonly appCache: ArgoCdApplicationCache;

  constructor(
    private readonly config: ArgoCdConfig,
    private readonly authService: ArgoCdAuthService
  ) {
    this.readOnly = config.readOnly;
    this.allowRefresh = config.allowRefresh;
    this.priorityApps = new ArgoCdPriorityAppsRegistry(authService.profiles);
    this.appCache = new ArgoCdApplicationCache(
      config.appCacheEnabled,
      config.appCacheTtlMs
    );
  }

  getApplicationCacheStatus(): ApplicationCacheStatus {
    return this.appCache.getStatus(this.authService.profileNames());
  }

  async getApplicationIndex(profile?: string): Promise<{
    profile: string;
    count: number;
    names: string[];
    fetchedAt: string;
    expiresAt: string;
  }> {
    const resolvedProfile = profile ?? this.authService.defaultProfile;
    const entry = await this.loadCachedApplications(resolvedProfile, false);
    return {
      profile: resolvedProfile,
      count: entry.items.length,
      names: entry.names,
      fetchedAt: entry.fetchedAt,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    };
  }

  async refreshApplicationCache(profile?: string): Promise<{
    profile: string;
    count: number;
    fetchedAt: string;
    expiresAt: string;
  }> {
    const resolvedProfile = profile ?? this.authService.defaultProfile;
    const entry = await this.loadCachedApplications(resolvedProfile, true);
    return {
      profile: resolvedProfile,
      count: entry.items.length,
      fetchedAt: entry.fetchedAt,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    };
  }

  async searchApplications(input: {
    profile?: string;
    query: string;
    project?: string;
    healthStatus?: string;
    syncStatus?: string;
    limit?: number;
    namesOnly?: boolean;
    refreshCache?: boolean;
  }): Promise<{
    profile: string;
    query: string;
    total: number;
    items: ApplicationSummary[];
    names: string[];
    cache: {
      enabled: boolean;
      fetchedAt: string;
      expiresAt: string;
      totalCached: number;
    };
  }> {
    const resolvedProfile = input.profile ?? this.authService.defaultProfile;
    const entry = await this.loadCachedApplications(
      resolvedProfile,
      input.refreshCache ?? false
    );

    const result = this.appCache.search(entry, {
      query: input.query,
      project: input.project,
      healthStatus: input.healthStatus,
      syncStatus: input.syncStatus,
      limit: input.limit,
      namesOnly: input.namesOnly,
    });

    const prioritizedItems = this.priorityApps.applyPriority(
      result.items,
      resolvedProfile
    );

    return {
      profile: resolvedProfile,
      query: input.query,
      total: result.total,
      items: prioritizedItems,
      names: input.namesOnly ? prioritizedItems.map((item) => item.name) : result.names,
      cache: {
        enabled: this.appCache.isEnabled(),
        fetchedAt: entry.fetchedAt,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        totalCached: entry.items.length,
      },
    };
  }

  getPriorityAppsConfig() {
    return this.priorityApps.getConfigSummary();
  }

  getPriorityAppNames(profile?: string): string[] {
    return this.priorityApps.getConfigured(profile);
  }

  async listPriorityApplications(profile?: string): Promise<{
    configuredNames: string[];
    names: string[];
    items: ApplicationSummary[];
    missing: string[];
  }> {
    const resolvedProfile = profile ?? this.authService.defaultProfile;
    const configuredNames = this.priorityApps.getConfigured(resolvedProfile);

    if (configuredNames.length === 0) {
      return {
        configuredNames: [],
        names: [],
        items: [],
        missing: [],
      };
    }

    const items: ApplicationSummary[] = [];
    const missing: string[] = [];

    for (const [index, name] of configuredNames.entries()) {
      try {
        const { summary } = await this.getApplication(profile, name);
        items.push({
          ...summary,
          isPriority: true,
          priorityRank: index + 1,
        });
      } catch {
        missing.push(name);
        items.push({
          name,
          isPriority: true,
          priorityRank: index + 1,
          notFound: true,
        });
      }
    }

    return {
      configuredNames,
      names: configuredNames,
      items,
      missing,
    };
  }

  async listApplications(input: {
    profile?: string;
    name?: string;
    nameContains?: string;
    projects?: string[];
    selector?: string;
    repo?: string;
    healthStatus?: string;
    syncStatus?: string;
    limit?: number;
    priorityOnly?: boolean;
    namesOnly?: boolean;
    useCache?: boolean;
    refreshCache?: boolean;
  }): Promise<{
    total: number;
    items: ApplicationSummary[];
    names?: string[];
    priorityConfigured: string[];
    source?: "api" | "cache";
    cache?: {
      fetchedAt: string;
      expiresAt: string;
      totalCached: number;
    };
  }> {
    if (input.priorityOnly) {
      const priority = await this.listPriorityApplications(input.profile);
      let items = priority.items;

      if (input.healthStatus) {
        const health = input.healthStatus.toLowerCase();
        items = items.filter(
          (item) => item.healthStatus?.toLowerCase() === health
        );
      }

      if (input.syncStatus) {
        const sync = input.syncStatus.toLowerCase();
        items = items.filter(
          (item) => item.syncStatus?.toLowerCase() === sync
        );
      }

      if (input.limit && input.limit > 0) {
        items = items.slice(0, input.limit);
      }

      return {
        total: items.length,
        items,
        names: input.namesOnly ? items.map((item) => item.name) : undefined,
        priorityConfigured: priority.configuredNames,
        source: "api",
      };
    }

    const resolvedProfile = input.profile ?? this.authService.defaultProfile;
    const shouldUseCache =
      this.appCache.isEnabled() &&
      (input.useCache ||
        Boolean(input.nameContains?.trim()) ||
        input.refreshCache);

    if (shouldUseCache) {
      const entry = await this.loadCachedApplications(
        resolvedProfile,
        input.refreshCache ?? false
      );

      let items = [...entry.items];

      if (input.nameContains?.trim()) {
        const search = this.appCache.search(entry, {
          query: input.nameContains,
        });
        items = search.items;
      }

      if (input.name) {
        items = items.filter((item) => item.name === input.name);
      }

      if (input.projects?.length) {
        const projects = new Set(
          input.projects.map((project) => project.toLowerCase())
        );
        items = items.filter((item) =>
          item.project ? projects.has(item.project.toLowerCase()) : false
        );
      }

      if (input.repo) {
        const repo = input.repo.toLowerCase();
        items = items.filter((item) => item.repo?.toLowerCase().includes(repo));
      }

      if (input.healthStatus) {
        const health = input.healthStatus.toLowerCase();
        items = items.filter(
          (item) => item.healthStatus?.toLowerCase() === health
        );
      }

      if (input.syncStatus) {
        const sync = input.syncStatus.toLowerCase();
        items = items.filter((item) => item.syncStatus?.toLowerCase() === sync);
      }

      const priorityConfigured = this.priorityApps.getConfigured(resolvedProfile);
      let prioritizedItems = this.priorityApps.applyPriority(items, resolvedProfile);
      const total = prioritizedItems.length;

      if (input.limit && input.limit > 0) {
        prioritizedItems = prioritizedItems.slice(0, input.limit);
      }

      return {
        total,
        items: prioritizedItems,
        names: input.namesOnly
          ? prioritizedItems.map((item) => item.name)
          : undefined,
        priorityConfigured,
        source: "cache",
        cache: {
          fetchedAt: entry.fetchedAt,
          expiresAt: new Date(entry.expiresAt).toISOString(),
          totalCached: entry.items.length,
        },
      };
    }

    const params: Record<string, unknown> = {};
    if (input.name) params.name = input.name;
    if (input.selector) params.selector = input.selector;
    if (input.repo) params.repo = input.repo;
    if (input.projects?.length) params.projects = input.projects;

    const data = await this.request<ApplicationListResponse>({
      profile: input.profile,
      method: "GET",
      path: "/api/v1/applications",
      queryParams: params,
    });

    let items = (data.items ?? []).map((app) => summarizeApplication(app));

    if (input.healthStatus) {
      const health = input.healthStatus.toLowerCase();
      items = items.filter(
        (item) => item.healthStatus?.toLowerCase() === health
      );
    }

    if (input.syncStatus) {
      const sync = input.syncStatus.toLowerCase();
      items = items.filter((item) => item.syncStatus?.toLowerCase() === sync);
    }

    const priorityConfigured = this.priorityApps.getConfigured(input.profile);
    let prioritizedItems = this.priorityApps.applyPriority(items, input.profile);
    const total = prioritizedItems.length;

    if (input.limit && input.limit > 0) {
      prioritizedItems = prioritizedItems.slice(0, input.limit);
    }

    return {
      total,
      items: prioritizedItems,
      names: input.namesOnly ? prioritizedItems.map((item) => item.name) : undefined,
      priorityConfigured,
      source: "api",
    };
  }

  private async loadCachedApplications(
    profile: string,
    forceRefresh: boolean
  ) {
    if (!this.appCache.isEnabled()) {
      throw new Error(
        "Application cache is disabled. Set ARGOCD_APP_CACHE_ENABLED=true to use cache-backed search."
      );
    }

    if (!forceRefresh) {
      const cached = this.appCache.get(profile);
      if (cached) {
        return cached;
      }
    }

    const items = await this.fetchAllApplications(profile);
    return this.appCache.set(profile, items);
  }

  private async fetchAllApplications(
    profile: string
  ): Promise<ApplicationSummary[]> {
    const data = await this.request<ApplicationListResponse>({
      profile,
      method: "GET",
      path: "/api/v1/applications",
    });

    return (data.items ?? []).map((app) => summarizeApplication(app));
  }

  async getApplication(
    profile: string | undefined,
    name: string,
    refresh?: "normal" | "hard"
  ): Promise<{ summary: ApplicationSummary; application: RawApplication }> {
    const params: Record<string, string> = {};
    if (refresh) {
      params.refresh = refresh;
    }

    const application = await this.request<RawApplication>({
      profile,
      method: "GET",
      path: `/api/v1/applications/${encodeURIComponent(name)}`,
      queryParams: params,
    });

    return {
      summary: summarizeApplication(application),
      application,
    };
  }

  async refreshApplication(
    profile: string | undefined,
    name: string,
    mode: "normal" | "hard" = "hard"
  ): Promise<{ summary: ApplicationSummary; application: RawApplication }> {
    this.assertRefreshAllowed();
    return this.getApplication(profile, name, mode);
  }

  async getResourceTree(profile: string | undefined, name: string) {
    return this.request<ResourceTreeResponse>({
      profile,
      method: "GET",
      path: `/api/v1/applications/${encodeURIComponent(name)}/resource-tree`,
    });
  }

  async getApplicationEvents(profile: string | undefined, name: string) {
    return this.request<unknown>({
      profile,
      method: "GET",
      path: `/api/v1/applications/${encodeURIComponent(name)}/events`,
    });
  }

  async getApplicationDiff(
    profile: string | undefined,
    name: string,
    options?: { project?: string; appNamespace?: string }
  ) {
    return this.request<unknown>({
      profile,
      method: "GET",
      path: `/api/v1/applications/${encodeURIComponent(name)}/server-side-diff`,
      queryParams: {
        ...(options?.project ? { project: options.project } : {}),
        ...(options?.appNamespace ? { appNamespace: options.appNamespace } : {}),
      },
    });
  }

  async getApplicationManifests(
    profile: string | undefined,
    name: string,
    options?: { revision?: string; project?: string; noCache?: boolean }
  ) {
    return this.request<unknown>({
      profile,
      method: "GET",
      path: `/api/v1/applications/${encodeURIComponent(name)}/manifests`,
      queryParams: {
        ...(options?.revision ? { revision: options.revision } : {}),
        ...(options?.project ? { project: options.project } : {}),
        ...(options?.noCache ? { noCache: options.noCache } : {}),
      },
    });
  }

  async getPodLogs(
    profile: string | undefined,
    name: string,
    options: PodLogsOptions = {}
  ): Promise<{ lines: LogLine[]; truncated: boolean }> {
    const tailLines = options.tailLines ?? 200;
    const params: Record<string, string | number | boolean> = {
      tailLines,
      follow: false,
    };

    if (options.namespace) params.namespace = options.namespace;
    if (options.container) params.container = options.container;
    if (options.sinceSeconds) params.sinceSeconds = options.sinceSeconds;
    if (options.filter) params.filter = options.filter;
    if (options.kind) params.kind = options.kind;
    if (options.group) params.group = options.group;
    if (options.resourceName) params.resourceName = options.resourceName;

    const path = options.podName
      ? `/api/v1/applications/${encodeURIComponent(name)}/pods/${encodeURIComponent(options.podName)}/logs`
      : `/api/v1/applications/${encodeURIComponent(name)}/logs`;

    if (options.podName) {
      params.podName = options.podName;
    }

    const client = await this.createAuthenticatedClient(profile);
    const response = await client.get<string>(path, {
      params,
      responseType: "text",
      transformResponse: [(data) => data],
    });

    if (response.status >= 400) {
      throw new Error(
        `Argo CD API error ${response.status}: ${String(response.data).slice(0, 500)}`
      );
    }

    const lines = parseLogStream(String(response.data));
    return {
      lines: lines.slice(-tailLines),
      truncated: lines.length > tailLines,
    };
  }

  async syncApplication(
    profile: string | undefined,
    name: string,
    options: ApplicationSyncOptions = {}
  ) {
    this.assertMutationAllowed("sync-application");

    const body: Record<string, unknown> = {
      name,
      prune: options.prune ?? false,
      dryRun: options.dryRun ?? false,
    };

    if (options.revision) {
      body.revision = options.revision;
    }

    if (options.force) {
      body.syncOptions = { items: ["Force=true"] };
    }

    return this.request<RawApplication>({
      profile,
      method: "POST",
      path: `/api/v1/applications/${encodeURIComponent(name)}/sync`,
      body,
    });
  }

  async terminateApplicationOperation(profile: string | undefined, name: string) {
    this.assertMutationAllowed("terminate-application-operation");

    return this.request<unknown>({
      profile,
      method: "DELETE",
      path: `/api/v1/applications/${encodeURIComponent(name)}/operation`,
    });
  }

  async getApplicationObservability(
    profile: string | undefined,
    name: string
  ): Promise<{
    view: ReturnType<typeof buildApplicationObservabilityView>;
    summary: string;
  }> {
    const resolvedProfile = profile ?? this.authService.defaultProfile;
    const { summary, application } = await this.getApplication(profile, name);
    const resourceTree = await this.getResourceTree(profile, name);
    const baseUrl = this.authService.resolveServerUrl(resolvedProfile);

    const view = buildApplicationObservabilityView({
      profile: resolvedProfile,
      baseUrl,
      summary,
      application,
      resourceTree,
    });

    return {
      view,
      summary: summarizeObservabilityView(view),
    };
  }

  async diagnoseApplication(
    profile: string | undefined,
    name: string,
    options: { tailLines?: number; maxPodLogs?: number } = {}
  ): Promise<DiagnoseApplicationResult> {
    const resolvedProfile = profile ?? this.authService.defaultProfile;
    const tailLines = options.tailLines ?? 100;
    const maxPodLogs = options.maxPodLogs ?? 3;

    const { summary, application } = await this.getApplication(
      profile,
      name
    );
    const resourceTree = await this.getResourceTree(profile, name);
    const events = await this.getApplicationEvents(profile, name);

    const unhealthyResources = findUnhealthyResources(resourceTree);
    const podTargets = findUnhealthyPods(resourceTree).slice(0, maxPodLogs);

    const podLogs: DiagnoseApplicationResult["podLogs"] = [];

    for (const pod of podTargets) {
      try {
        const result = await this.getPodLogs(profile, name, {
          podName: pod.name,
          namespace: pod.namespace,
          tailLines,
        });
        podLogs.push({
          podName: pod.name ?? "unknown",
          namespace: pod.namespace,
          lines: result.lines,
        });
      } catch (error) {
        podLogs.push({
          podName: pod.name ?? "unknown",
          namespace: pod.namespace,
          lines: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      profile: resolvedProfile,
      application: summary,
      resourceTree,
      events,
      unhealthyResources,
      podLogs,
      operationInProgress: application.status?.operationState?.phase,
    };
  }

  private assertMutationAllowed(operation: string): void {
    if (this.readOnly) {
      throw new Error(
        `${operation} blocked while ARGOCD_READ_ONLY=true. Set ARGOCD_READ_ONLY=false to enable mutations.`
      );
    }
  }

  private assertRefreshAllowed(): void {
    if (!this.allowRefresh) {
      throw new Error(
        "refresh-application blocked while ARGOCD_ALLOW_REFRESH=false."
      );
    }
  }

  private async request<T>(options: {
    profile?: string;
    method: HttpMethod;
    path: string;
    queryParams?: Record<string, unknown>;
    body?: unknown;
  }): Promise<T> {
    const client = await this.createAuthenticatedClient(options.profile);

    const response = await client.request<T>({
      method: options.method,
      url: options.path,
      params: options.queryParams,
      data: options.body,
    });

    if (response.status >= 400) {
      throw formatArgoCdHttpError({
        status: response.status,
        data: response.data,
        profile: options.profile ?? this.authService.defaultProfile,
        authService: this.authService,
      });
    }

    return response.data;
  }

  private async createAuthenticatedClient(
    profileName?: string
  ): Promise<AxiosInstance> {
    const session = this.authService.loadSession(profileName);
    if (!session?.token) {
      const profile = profileName ?? this.authService.defaultProfile;
      throw new Error(
        `Not authenticated for profile "${profile}". ${this.authService.authenticationHint(profile)}`
      );
    }

    return axios.create({
      baseURL: session.url,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      validateStatus: () => true,
      timeout: 120_000,
    });
  }
}

function summarizeApplication(app: RawApplication): ApplicationSummary {
  return {
    name: app.metadata?.name ?? "unknown",
    namespace: app.metadata?.namespace,
    project: app.spec?.project,
    repo: app.spec?.source?.repoURL,
    path: app.spec?.source?.path,
    targetRevision: app.spec?.source?.targetRevision,
    syncStatus: app.status?.sync?.status,
    healthStatus: app.status?.health?.status,
    operationPhase: app.status?.operationState?.phase,
    conditions: app.status?.conditions?.map((item) => ({
      type: item.type,
      message: item.message,
    })),
  };
}

function findUnhealthyPods(tree: ResourceTreeResponse) {
  return (tree.nodes ?? []).filter((node) => {
    if (node.kind?.toLowerCase() !== "pod") {
      return false;
    }
    const health = node.health?.status?.toLowerCase();
    return !health || (health !== "healthy" && health !== "suspended");
  });
}

function parseLogStream(raw: string): LogLine[] {
  const lines: LogLine[] = [];

  for (const chunk of raw.split("\n")) {
    const trimmed = chunk.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const entry = JSON.parse(trimmed) as {
        content?: string;
        podName?: string;
        timeStampStr?: string;
        timeStamp?: { seconds?: string };
      };
      lines.push({
        content: entry.content,
        podName: entry.podName,
        timeStamp: entry.timeStampStr ?? entry.timeStamp?.seconds,
      });
    } catch {
      lines.push({ content: trimmed });
    }
  }

  return lines;
}
