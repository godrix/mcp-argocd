export interface ApplicationSummary {
  name: string;
  namespace?: string;
  project?: string;
  repo?: string;
  path?: string;
  targetRevision?: string;
  syncStatus?: string;
  healthStatus?: string;
  operationPhase?: string;
  conditions?: Array<{ type?: string; message?: string }>;
  isPriority?: boolean;
  priorityRank?: number;
  notFound?: boolean;
}

export interface ApplicationSyncOptions {
  prune?: boolean;
  dryRun?: boolean;
  revision?: string;
  force?: boolean;
}

export interface PodLogsOptions {
  podName?: string;
  namespace?: string;
  container?: string;
  tailLines?: number;
  sinceSeconds?: number;
  filter?: string;
  kind?: string;
  group?: string;
  resourceName?: string;
}

export interface LogLine {
  podName?: string;
  timeStamp?: string;
  content?: string;
}

export interface DiagnoseApplicationResult {
  profile: string;
  application: ApplicationSummary;
  resourceTree?: unknown;
  events?: unknown;
  operationInProgress?: string;
  unhealthyResources: Array<{
    kind?: string;
    name?: string;
    namespace?: string;
    health?: string;
    status?: string;
  }>;
  podLogs: Array<{
    podName: string;
    namespace?: string;
    lines: LogLine[];
    error?: string;
  }>;
}
