import axios, { AxiosInstance } from "axios";
import { ArgoCdConfig } from "../config/ArgoCdConfig.js";
import { ArgoCdAuthService } from "./ArgoCdAuthService.js";
import { formatArgoCdHttpError } from "../utils/argoCdHttp.js";

export interface ProjectSummary {
  name: string;
  description?: string;
  sourceRepos?: string[];
  destinations?: Array<{ server?: string; namespace?: string; name?: string }>;
}

interface RawProject {
  metadata?: { name?: string };
  spec?: {
    description?: string;
    sourceRepos?: string[];
    destinations?: Array<{ server?: string; namespace?: string; name?: string }>;
  };
}

interface ProjectListResponse {
  items?: RawProject[];
}

export class ArgoCdProjectService {
  constructor(
    private readonly config: ArgoCdConfig,
    private readonly authService: ArgoCdAuthService
  ) {}

  async listProjects(
    profile?: string,
    name?: string
  ): Promise<{ total: number; items: ProjectSummary[]; names: string[] }> {
    const params: Record<string, string> = {};
    if (name) {
      params.name = name;
    }

    const data = await this.request<ProjectListResponse>({
      profile,
      method: "GET",
      path: "/api/v1/projects",
      queryParams: params,
    });

    const items = (data.items ?? []).map(summarizeProject).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return {
      total: items.length,
      items,
      names: items.map((item) => item.name),
    };
  }

  private async request<T>(options: {
    profile?: string;
    method: "GET";
    path: string;
    queryParams?: Record<string, string>;
  }): Promise<T> {
    const client = await this.createAuthenticatedClient(options.profile);
    const response = await client.request<T>({
      method: options.method,
      url: options.path,
      params: options.queryParams,
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

function summarizeProject(project: RawProject): ProjectSummary {
  return {
    name: project.metadata?.name ?? "unknown",
    description: project.spec?.description,
    sourceRepos: project.spec?.sourceRepos,
    destinations: project.spec?.destinations,
  };
}
