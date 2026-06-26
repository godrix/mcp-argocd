import { existsSync, readFileSync } from "node:fs";
import {
  normalizeServerUrl,
  serverHostFromUrl,
} from "./ArgoCdConfig.js";

export interface ArgoCdProfileDefinition {
  url: string;
  context?: string;
  label?: string;
}

export interface ArgoCdProfilesFile {
  defaultProfile?: string;
  profiles: Record<string, ArgoCdProfileDefinition>;
}

export interface ArgoCdProfile {
  name: string;
  url: string;
  context: string;
  label: string;
}

interface EnvLoadResult {
  profiles: ArgoCdProfile[];
  defaultProfile?: string;
}

function profileEnvKey(profileName: string): string {
  return profileName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function parseCsv(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function profileUrlsFromEnv(): string[] {
  return parseCsv(
    process.env.ARGOCD_URL_PROFILES ?? process.env.ARGOCD_PROFILE_URL
  );
}

export class ArgoCdProfileRegistry {
  private readonly profiles: Map<string, ArgoCdProfile>;
  readonly defaultProfile: string;

  constructor() {
    const loaded = this.loadProfiles();
    this.profiles = loaded.profiles;
    this.defaultProfile = loaded.defaultProfile;
  }

  list(): ArgoCdProfile[] {
    return [...this.profiles.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  get(profileName?: string): ArgoCdProfile {
    const name = (profileName?.trim() || this.defaultProfile).toLowerCase();
    const profile = this.profiles.get(name);

    if (!profile) {
      const available = this.list()
        .map((item) => item.name)
        .join(", ");
      throw new Error(
        `Unknown Argo CD profile "${name}". Available profiles: ${available || "(none configured)"}`
      );
    }

    return profile;
  }

  profileNames(): string[] {
    return this.list().map((profile) => profile.name);
  }

  private loadProfiles(): {
    profiles: Map<string, ArgoCdProfile>;
    defaultProfile: string;
  } {
    const merged = new Map<string, ArgoCdProfile>();
    const fromFile = this.loadFromProfilesFile();
    const fromEnv = this.loadFromEnv();

    for (const profile of fromFile.profiles) {
      merged.set(profile.name, profile);
    }

    for (const profile of fromEnv.profiles) {
      merged.set(profile.name, profile);
    }

    const defaultProfile =
      fromEnv.defaultProfile ||
      fromFile.defaultProfile ||
      merged.keys().next().value ||
      "default";

    if (!merged.has(defaultProfile) && merged.size > 0) {
      const first = merged.keys().next().value as string;
      return { profiles: merged, defaultProfile: first };
    }

    return { profiles: merged, defaultProfile };
  }

  private loadFromProfilesFile(): {
    profiles: ArgoCdProfile[];
    defaultProfile?: string;
  } {
    const path = process.env.ARGOCD_PROFILES_FILE?.trim();
    if (!path || !existsSync(path)) {
      return { profiles: [] };
    }

    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as ArgoCdProfilesFile;

    const profiles = Object.entries(parsed.profiles ?? {}).map(
      ([name, definition]) => this.toProfile(name, definition)
    );

    return {
      profiles,
      defaultProfile: parsed.defaultProfile?.trim().toLowerCase(),
    };
  }

  private loadFromEnv(): EnvLoadResult {
    const defaultUrl = process.env.ARGOCD_URL?.trim();
    const profileNames = parseCsv(process.env.ARGOCD_PROFILES).map((name) =>
      name.toLowerCase()
    );
    const profileUrls = profileUrlsFromEnv();
    const defaultProfileName =
      process.env.ARGOCD_DEFAULT_PROFILE?.trim().toLowerCase();

    const hasMultiHints =
      profileNames.length > 0 ||
      profileUrls.length > 0 ||
      Boolean(defaultProfileName);

    if (defaultUrl && hasMultiHints) {
      throw new Error(
        "Use ARGOCD_URL alone for a single Argo CD instance, or ARGOCD_PROFILES + ARGOCD_DEFAULT_PROFILE + ARGOCD_URL_PROFILES for multiple environments — not both."
      );
    }

    if (hasMultiHints) {
      return this.loadMultiEnvProfiles(profileNames, profileUrls, defaultProfileName);
    }

    if (defaultUrl) {
      return {
        profiles: [
          this.toProfile("default", {
            url: defaultUrl,
            context: process.env.ARGOCD_CONTEXT?.trim(),
            label: process.env.ARGOCD_LABEL?.trim(),
          }),
        ],
        defaultProfile: "default",
      };
    }

    return { profiles: [] };
  }

  private loadMultiEnvProfiles(
    profileNames: string[],
    profileUrls: string[],
    defaultProfileName?: string
  ): EnvLoadResult {
    if (!defaultProfileName) {
      throw new Error(
        "ARGOCD_DEFAULT_PROFILE is required when using ARGOCD_URL_PROFILES."
      );
    }

    if (profileNames.length === 0) {
      throw new Error(
        "ARGOCD_PROFILES is required when using ARGOCD_URL_PROFILES."
      );
    }

    if (profileUrls.length === 0) {
      throw new Error(
        "ARGOCD_URL_PROFILES is required for multi-environment setup."
      );
    }

    if (profileUrls.length !== profileNames.length) {
      throw new Error(
        `ARGOCD_PROFILES (${profileNames.length}) and ARGOCD_URL_PROFILES (${profileUrls.length}) must have the same number of entries.`
      );
    }

    if (!profileNames.includes(defaultProfileName)) {
      throw new Error(
        `ARGOCD_DEFAULT_PROFILE "${defaultProfileName}" must be listed in ARGOCD_PROFILES.`
      );
    }

    const profiles = new Map<string, ArgoCdProfile>();

    for (let index = 0; index < profileNames.length; index++) {
      const name = profileNames[index];
      const envKey = profileEnvKey(name);
      const url =
        process.env[`ARGOCD_PROFILE_${envKey}_URL`]?.trim() ||
        profileUrls[index];

      profiles.set(
        name,
        this.toProfile(name, {
          url,
          context: process.env[`ARGOCD_PROFILE_${envKey}_CONTEXT`]?.trim(),
          label: process.env[`ARGOCD_PROFILE_${envKey}_LABEL`]?.trim(),
        })
      );
    }

    return {
      profiles: [...profiles.values()],
      defaultProfile: defaultProfileName,
    };
  }

  private toProfile(
    name: string,
    definition: ArgoCdProfileDefinition
  ): ArgoCdProfile {
    const normalizedName = name.trim().toLowerCase();
    const url = normalizeServerUrl(definition.url);
    const context =
      definition.context?.trim() ||
      serverHostFromUrl(url) ||
      normalizedName;

    return {
      name: normalizedName,
      url,
      context,
      label: definition.label?.trim() || normalizedName.toUpperCase(),
    };
  }
}

export function tokenEnvVarForProfile(profileName: string): string {
  return `ARGOCD_API_KEY_${profileEnvKey(profileName)}`;
}
