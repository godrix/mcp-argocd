import {
  ApplicationObservabilityView,
} from "../model/ApplicationObservability.js";
import { ApplicationSummary } from "../model/ArgoCdApplication.js";
import {
  findUnhealthyResources,
  ResourceTreeResponse,
} from "./unhealthyResources.js";

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

export function buildArgoCdApplicationUrl(
  baseUrl: string,
  name: string,
  namespace?: string
): string {
  const root = baseUrl.replace(/\/+$/, "");
  const appNamespace = namespace?.trim() || "argocd";
  return `${root}/applications/${encodeURIComponent(appNamespace)}/${encodeURIComponent(name)}`;
}

export function buildApplicationObservabilityView(input: {
  profile: string;
  baseUrl: string;
  summary: ApplicationSummary;
  application: RawApplication;
  resourceTree: ResourceTreeResponse;
  fetchedAt?: string;
}): ApplicationObservabilityView {
  const name = input.summary.name;
  const namespace =
    input.summary.namespace ??
    input.application.metadata?.namespace ??
    "argocd";
  const project = input.summary.project ?? input.application.spec?.project ?? "default";
  const healthStatus =
    input.summary.healthStatus ?? input.application.status?.health?.status ?? "Unknown";
  const syncStatus =
    input.summary.syncStatus ?? input.application.status?.sync?.status ?? "Unknown";

  return {
    profile: input.profile,
    name,
    namespace,
    project,
    healthStatus,
    syncStatus,
    operationPhase:
      input.summary.operationPhase ?? input.application.status?.operationState?.phase,
    repoUrl: input.summary.repo ?? input.application.spec?.source?.repoURL,
    path: input.summary.path ?? input.application.spec?.source?.path,
    targetRevision:
      input.summary.targetRevision ??
      input.application.spec?.source?.targetRevision,
    revision: input.application.status?.sync?.revision,
    conditions: (input.application.status?.conditions ?? []).map((item) => ({
      type: item.type ?? "Unknown",
      message: item.message ?? "",
      lastTransitionTime: item.lastTransitionTime,
    })),
    unhealthyResources: findUnhealthyResources(input.resourceTree),
    argoCdUrl: buildArgoCdApplicationUrl(input.baseUrl, name, namespace),
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
  };
}

export function summarizeObservabilityView(
  view: ApplicationObservabilityView
): string {
  const unhealthyCount = view.unhealthyResources.length;
  const unhealthySuffix =
    unhealthyCount === 0
      ? "no unhealthy resources"
      : `${unhealthyCount} unhealthy resource${unhealthyCount === 1 ? "" : "s"}`;

  return `${view.profile}/${view.name}: ${view.healthStatus} / ${view.syncStatus} — ${unhealthySuffix}`;
}
