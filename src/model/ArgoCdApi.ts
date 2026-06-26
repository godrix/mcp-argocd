export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SwaggerParameter {
  name: string;
  in: "path" | "query" | "body" | "header";
  required: boolean;
  type?: string;
  description?: string;
}

export interface ArgoCdApiEndpoint {
  operationId: string;
  method: HttpMethod;
  path: string;
  summary: string;
  tags: string[];
  parameters: SwaggerParameter[];
  readOnly: boolean;
}

export interface ArgoCdApiCallOptions {
  profile?: string;
  method: HttpMethod;
  path: string;
  pathParams?: Record<string, string | number>;
  queryParams?: Record<string, string | number | boolean>;
  body?: unknown;
}

export interface ArgoCdSession {
  profile: string;
  server: string;
  url: string;
  token: string;
  grpcWeb: boolean;
  username?: string;
}

export interface ArgoCdSettings {
  url?: string;
  oidcConfig?: {
    name?: string;
    issuer?: string;
    clientID?: string;
    scopes?: string[];
  };
  [key: string]: unknown;
}

export interface ArgoCdUserInfo {
  loggedIn?: boolean;
  username?: string;
  iss?: string;
  groups?: string[];
}
