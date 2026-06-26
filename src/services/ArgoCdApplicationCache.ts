import { ApplicationSummary } from "../model/ArgoCdApplication.js";

export interface ApplicationCacheEntry {
  profile: string;
  items: ApplicationSummary[];
  names: string[];
  fetchedAt: string;
  expiresAt: number;
}

export interface ApplicationCacheStatus {
  enabled: boolean;
  ttlSeconds: number;
  profiles: Array<{
    profile: string;
    cached: boolean;
    count: number;
    fetchedAt?: string;
    expiresAt?: string;
    expired: boolean;
  }>;
}

export interface ApplicationSearchOptions {
  query: string;
  limit?: number;
  healthStatus?: string;
  syncStatus?: string;
  project?: string;
  namesOnly?: boolean;
}

export class ArgoCdApplicationCache {
  private readonly entries = new Map<string, ApplicationCacheEntry>();

  constructor(
    private readonly enabled: boolean,
    private readonly ttlMs: number
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  getTtlSeconds(): number {
    return Math.round(this.ttlMs / 1000);
  }

  get(profile: string): ApplicationCacheEntry | undefined {
    const entry = this.entries.get(profile);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      return undefined;
    }
    return entry;
  }

  set(profile: string, items: ApplicationSummary[]): ApplicationCacheEntry {
    const entry: ApplicationCacheEntry = {
      profile,
      items,
      names: items.map((item) => item.name),
      fetchedAt: new Date().toISOString(),
      expiresAt: Date.now() + this.ttlMs,
    };
    this.entries.set(profile, entry);
    return entry;
  }

  invalidate(profile?: string): void {
    if (profile) {
      this.entries.delete(profile);
      return;
    }
    this.entries.clear();
  }

  getStatus(profiles: string[]): ApplicationCacheStatus {
    return {
      enabled: this.enabled,
      ttlSeconds: this.getTtlSeconds(),
      profiles: profiles.map((profile) => {
        const entry = this.entries.get(profile);
        const expired = !entry || entry.expiresAt <= Date.now();
        return {
          profile,
          cached: Boolean(entry) && !expired,
          count: entry?.items.length ?? 0,
          fetchedAt: entry?.fetchedAt,
          expiresAt: entry ? new Date(entry.expiresAt).toISOString() : undefined,
          expired,
        };
      }),
    };
  }

  search(
    entry: ApplicationCacheEntry,
    options: ApplicationSearchOptions
  ): {
    total: number;
    items: ApplicationSummary[];
    names: string[];
  } {
    const query = options.query.trim().toLowerCase();
    if (!query) {
      throw new Error("Search query cannot be empty.");
    }

    let items = entry.items.filter((item) => matchesSearch(item, query));

    if (options.project) {
      const project = options.project.toLowerCase();
      items = items.filter((item) => item.project?.toLowerCase() === project);
    }

    if (options.healthStatus) {
      const health = options.healthStatus.toLowerCase();
      items = items.filter(
        (item) => item.healthStatus?.toLowerCase() === health
      );
    }

    if (options.syncStatus) {
      const sync = options.syncStatus.toLowerCase();
      items = items.filter((item) => item.syncStatus?.toLowerCase() === sync);
    }

    items.sort((a, b) => a.name.localeCompare(b.name));

    const total = items.length;
    if (options.limit && options.limit > 0) {
      items = items.slice(0, options.limit);
    }

    return {
      total,
      items,
      names: items.map((item) => item.name),
    };
  }
}

function matchesSearch(item: ApplicationSummary, query: string): boolean {
  const fields = [
    item.name,
    item.project,
    item.repo,
    item.path,
    item.namespace,
  ];

  return fields.some((field) => field?.toLowerCase().includes(query));
}
