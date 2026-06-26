import { ArgoCdProfileRegistry } from "./ArgoCdProfiles.js";

function parseAppNames(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("ARGOCD_PRIORITY_APPS JSON must be an array of strings.");
    }
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class ArgoCdPriorityAppsRegistry {
  private readonly globalApps: string[];
  private readonly perProfile: Map<string, string[]>;

  constructor(private readonly profiles: ArgoCdProfileRegistry) {
    this.globalApps = parseAppNames(process.env.ARGOCD_PRIORITY_APPS);
    this.perProfile = new Map();

    for (const profile of this.profiles.list()) {
      const envKey = `ARGOCD_PRIORITY_APPS_${profile.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
      const apps = parseAppNames(process.env[envKey]);
      if (apps.length > 0) {
        this.perProfile.set(profile.name, apps);
      }
    }
  }

  getConfigured(profileName?: string): string[] {
    const profile = profileName?.trim().toLowerCase() ?? this.profiles.defaultProfile;
    const profileApps = this.perProfile.get(profile) ?? [];

    if (profileApps.length > 0) {
      return [...profileApps];
    }

    return [...this.globalApps];
  }

  hasConfigured(profileName?: string): boolean {
    return this.getConfigured(profileName).length > 0;
  }

  getConfigSummary() {
    return {
      global: this.globalApps,
      perProfile: Object.fromEntries(this.perProfile.entries()),
      note:
        "Priority apps are MCP-side bookmarks. Argo CD UI favorites are stored in the browser only and are not available via API.",
    };
  }

  applyPriority<T extends { name: string }>(
    items: T[],
    profileName?: string
  ): Array<T & { isPriority: boolean; priorityRank?: number }> {
    const priorityNames = this.getConfigured(profileName);
    if (priorityNames.length === 0) {
      return items.map((item) => ({ ...item, isPriority: false }));
    }

    const rank = new Map(priorityNames.map((name, index) => [name, index + 1]));
    const tagged = items.map((item) => ({
      ...item,
      isPriority: rank.has(item.name),
      priorityRank: rank.get(item.name),
    }));

    return tagged.sort((a, b) => {
      const aRank = a.priorityRank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.priorityRank ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return a.name.localeCompare(b.name);
    });
  }
}
