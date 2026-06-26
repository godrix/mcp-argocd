import { describe, expect, it } from "vitest";
import {
  buildApplicationObservabilityView,
  buildArgoCdApplicationUrl,
  summarizeObservabilityView,
} from "../src/utils/applicationObservability.js";
import { findUnhealthyResources } from "../src/utils/unhealthyResources.js";
import { loadWidgetHtml } from "../src/utils/loadWidgetHtml.js";

describe("findUnhealthyResources", () => {
  it("returns nodes that are not healthy or suspended", () => {
    const result = findUnhealthyResources({
      nodes: [
        { kind: "Pod", name: "ok", health: { status: "Healthy" } },
        { kind: "Pod", name: "bad", health: { status: "Degraded" } },
        { kind: "Service", name: "paused", health: { status: "Suspended" } },
      ],
    });

    expect(result).toEqual([
      {
        kind: "Pod",
        name: "bad",
        namespace: undefined,
        health: "Degraded",
      },
    ]);
  });
});

describe("buildApplicationObservabilityView", () => {
  const baseInput = {
    profile: "qa",
    baseUrl: "https://argocd-qa.example.io",
    summary: {
      name: "my-app",
      namespace: "argocd",
      project: "default",
      repo: "https://git.example.com/repo.git",
      path: "apps/my-app",
      targetRevision: "main",
      syncStatus: "OutOfSync",
      healthStatus: "Degraded",
      operationPhase: "Running",
    },
    application: {
      metadata: { name: "my-app", namespace: "argocd" },
      spec: {
        project: "default",
        source: {
          repoURL: "https://git.example.com/repo.git",
          path: "apps/my-app",
          targetRevision: "main",
        },
      },
      status: {
        sync: { status: "OutOfSync", revision: "abc123" },
        health: { status: "Degraded" },
        operationState: { phase: "Running" },
        conditions: [
          {
            type: "ComparisonError",
            message: "Failed to compare",
            lastTransitionTime: "2026-06-25T10:00:00Z",
          },
        ],
      },
    },
    resourceTree: {
      nodes: [
        { kind: "Deployment", name: "my-app", health: { status: "Degraded" } },
      ],
    },
    fetchedAt: "2026-06-25T12:00:00.000Z",
  };

  it("builds a compact observability payload", () => {
    const view = buildApplicationObservabilityView(baseInput);

    expect(view.profile).toBe("qa");
    expect(view.name).toBe("my-app");
    expect(view.revision).toBe("abc123");
    expect(view.conditions).toHaveLength(1);
    expect(view.unhealthyResources).toHaveLength(1);
    expect(view.argoCdUrl).toBe(
      "https://argocd-qa.example.io/applications/argocd/my-app"
    );
    expect(view.fetchedAt).toBe("2026-06-25T12:00:00.000Z");
  });

  it("summarizes health, sync and unhealthy count", () => {
    const view = buildApplicationObservabilityView(baseInput);
    expect(summarizeObservabilityView(view)).toBe(
      "qa/my-app: Degraded / OutOfSync — 1 unhealthy resource"
    );
  });
});

describe("buildArgoCdApplicationUrl", () => {
  it("encodes namespace and name in the UI path", () => {
    expect(
      buildArgoCdApplicationUrl("https://argocd.example.io/", "app/name", "team-a")
    ).toBe("https://argocd.example.io/applications/team-a/app%2Fname");
  });
});

describe("loadWidgetHtml", () => {
  it("inlines the ext-apps bundle into the widget template", () => {
    const html = loadWidgetHtml("app-observability.html");

    expect(html).toContain("globalThis.ExtApps");
    expect(html).not.toContain("/*___MCP_ARGOCD_EXT_APPS_BUNDLE___*/");
    expect(html).toContain("Argo CD Observability");
  });
});
