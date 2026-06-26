import { ArgoCdAuthService } from "../services/ArgoCdAuthService.js";

function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function formatResponseBody(data: unknown): string {
  if (data === undefined || data === null) {
    return "";
  }

  if (typeof data === "string") {
    return data.slice(0, 500);
  }

  return JSON.stringify(data).slice(0, 500);
}

export function expiredTokenAction(profile: string): string {
  return [
    `Token for profile "${profile}" is missing, expired, or invalid.`,
    `Run argocd_login with profile="${profile}" (SSO),`,
    `or refresh the API key (ARGOCD_API_KEY_${profile.toUpperCase()} / argocd_set_api_key).`,
  ].join(" ");
}

export function formatArgoCdHttpError(input: {
  status: number;
  data?: unknown;
  profile?: string;
  authService?: ArgoCdAuthService;
  context?: string;
}): Error {
  const profile = input.profile ?? input.authService?.defaultProfile ?? "default";
  const body = formatResponseBody(input.data);
  const prefix = input.context ? `${input.context}: ` : "";

  if (isAuthFailureStatus(input.status) && input.authService) {
    return new Error(
      `${prefix}Argo CD authentication failed (${input.status}) for profile "${profile}". ${expiredTokenAction(profile)}`
    );
  }

  if (isAuthFailureStatus(input.status)) {
    return new Error(
      `${prefix}Argo CD authentication failed (${input.status}) for profile "${profile}". ${expiredTokenAction(profile)}`
    );
  }

  return new Error(
    `${prefix}Argo CD API error ${input.status}${body ? `: ${body}` : ""}`
  );
}
