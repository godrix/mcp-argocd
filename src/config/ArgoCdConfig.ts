import { homedir } from "node:os";
import { join } from "node:path";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export interface ArgoCdConfig {
  url?: string;
  token?: string;
  readOnly: boolean;
  allowRefresh: boolean;
  appCacheEnabled: boolean;
  appCacheTtlMs: number;
  configPath: string;
  grpcWeb: boolean;
  insecure: boolean;
}

export function defaultConfigPath(): string {
  return process.env.ARGOCD_CONFIG?.trim() || join(homedir(), ".config", "argocd", "config");
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function loadArgoCdConfig(): ArgoCdConfig {
  const url = process.env.ARGOCD_URL?.trim().replace(/\/+$/, "");
  const token =
    process.env.ARGOCD_API_KEY?.trim() || process.env.ARGOCD_TOKEN?.trim();

  return {
    url: url || undefined,
    token: token || undefined,
    readOnly: parseBoolean(process.env.ARGOCD_READ_ONLY, true),
    allowRefresh: parseBoolean(process.env.ARGOCD_ALLOW_REFRESH, true),
    appCacheEnabled: parseBoolean(process.env.ARGOCD_APP_CACHE_ENABLED, true),
    appCacheTtlMs:
      parsePositiveInt(process.env.ARGOCD_APP_CACHE_TTL_SECONDS, 300) * 1000,
    configPath: defaultConfigPath(),
    grpcWeb: parseBoolean(process.env.ARGOCD_GRPC_WEB, true),
    insecure: parseBoolean(process.env.ARGOCD_INSECURE, false),
  };
}

export function normalizeServerUrl(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function serverHostFromUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
