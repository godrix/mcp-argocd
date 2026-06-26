export interface ApplicationObservabilityCondition {
  type: string;
  message: string;
  lastTransitionTime?: string;
}

export interface ApplicationObservabilityResource {
  kind: string;
  name: string;
  namespace?: string;
  health?: string;
}

export interface ApplicationObservabilityView {
  profile: string;
  name: string;
  namespace: string;
  project: string;
  healthStatus: string;
  syncStatus: string;
  operationPhase?: string;
  repoUrl?: string;
  path?: string;
  targetRevision?: string;
  revision?: string;
  conditions: ApplicationObservabilityCondition[];
  unhealthyResources: ApplicationObservabilityResource[];
  argoCdUrl: string;
  fetchedAt: string;
}
