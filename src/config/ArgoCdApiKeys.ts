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

export type ArgoCdTokenSource =
  | "api-key-env"
  | "api-key-memory"
  | "argocd-cli-config";

export interface ResolvedArgoCdToken {
  token: string;
  source: ArgoCdTokenSource;
}

export function apiKeysFromProfilesList(profileNames: string[]): Map<string, string> {
  const keys = parseCsv(process.env.ARGOCD_API_KEYS);
  const result = new Map<string, string>();

  if (keys.length === 0 || keys.length !== profileNames.length) {
    return result;
  }

  for (let index = 0; index < profileNames.length; index++) {
    result.set(profileNames[index], keys[index]);
  }

  return result;
}

export function readProfileApiKeyFromEnv(profileName: string): string | undefined {
  const envKey = profileEnvKey(profileName);
  const candidates = [
    process.env[`ARGOCD_API_KEY_${envKey}`],
    process.env[`ARGOCD_TOKEN_${envKey}`],
    process.env[`ARGOCD_PROFILE_${envKey}_API_KEY`],
    process.env[`ARGOCD_PROFILE_${envKey}_TOKEN`],
  ];

  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

export function readDefaultApiKeyFromEnv(): string | undefined {
  return (
    process.env.ARGOCD_API_KEY?.trim() ||
    process.env.ARGOCD_TOKEN?.trim() ||
    undefined
  );
}

export function tokenEnvVarForProfile(profileName: string): string {
  return `ARGOCD_API_KEY_${profileEnvKey(profileName)}`;
}

export function listApiKeyEnvVars(profileNames: string[]): string[] {
  const vars = new Set<string>(["ARGOCD_API_KEY", "ARGOCD_TOKEN", "ARGOCD_API_KEYS"]);

  for (const name of profileNames) {
    const key = profileEnvKey(name);
    vars.add(`ARGOCD_API_KEY_${key}`);
    vars.add(`ARGOCD_TOKEN_${key}`);
  }

  return [...vars];
}
