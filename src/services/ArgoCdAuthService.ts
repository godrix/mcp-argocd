import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { ArgoCdConfig } from "../config/ArgoCdConfig.js";
import {
  apiKeysFromProfilesList,
  ArgoCdTokenSource,
  listApiKeyEnvVars,
  readDefaultApiKeyFromEnv,
  readProfileApiKeyFromEnv,
  ResolvedArgoCdToken,
  tokenEnvVarForProfile,
} from "../config/ArgoCdApiKeys.js";
import { ArgoCdProfile, ArgoCdProfileRegistry } from "../config/ArgoCdProfiles.js";
import { ArgoCdSession } from "../model/ArgoCdApi.js";
import { expiredTokenAction } from "../utils/argoCdHttp.js";

const execFileAsync = promisify(execFile);

interface ArgoCdCliConfig {
  "current-context"?: string;
  contexts?: Array<{
    name?: string;
    server?: string;
    user?: string;
  }>;
  servers?: Array<{
    server?: string;
    "grpc-web"?: boolean;
    "grpc-web-root-path"?: string;
  }>;
  users?: Array<{
    name?: string;
    "auth-token"?: string;
  }>;
}

export interface ArgoCdLoginOptions {
  profile?: string;
  server?: string;
  sso?: boolean;
  username?: string;
  password?: string;
  ssoPort?: number;
  grpcWeb?: boolean;
  insecure?: boolean;
  launchBrowser?: boolean;
}

export interface ArgoCdProfileAuthStatus {
  profile: string;
  label: string;
  url: string;
  context: string;
  authenticated: boolean;
  tokenPresent: boolean;
  tokenValid?: boolean;
  recommendedAction?: string;
  authMethod?: "api-key" | "argocd-cli";
  tokenSource?: ArgoCdTokenSource;
  server?: string;
  isDefault: boolean;
  username?: string;
  authError?: string;
}

export class ArgoCdAuthService {
  readonly profiles: ArgoCdProfileRegistry;
  private readonly memoryApiKeys = new Map<string, string>();
  private readonly positionalApiKeys: Map<string, string>;

  constructor(private readonly config: ArgoCdConfig) {
    this.profiles = new ArgoCdProfileRegistry();
    this.positionalApiKeys = apiKeysFromProfilesList(this.profiles.profileNames());
  }

  get configPath(): string {
    return this.config.configPath;
  }

  profileNames(): string[] {
    return this.profiles.profileNames();
  }

  get defaultProfile(): string {
    return this.profiles.defaultProfile;
  }

  listProfiles(): ArgoCdProfile[] {
    return this.profiles.list();
  }

  setApiKey(profileName: string | undefined, apiKey: string): ArgoCdProfile {
    const profile = this.profiles.get(profileName);
    const trimmed = apiKey.trim();

    if (!trimmed) {
      throw new Error("API key cannot be empty.");
    }

    this.memoryApiKeys.set(profile.name, trimmed);
    return profile;
  }

  clearApiKey(profileName?: string): void {
    if (profileName) {
      this.memoryApiKeys.delete(this.profiles.get(profileName).name);
      return;
    }

    this.memoryApiKeys.clear();
  }

  loadSession(profileName?: string): ArgoCdSession | null {
    const profile = this.profiles.get(profileName);
    const resolved = this.resolveToken(profile);

    if (!resolved) {
      return null;
    }

    if (resolved.source === "argocd-cli-config") {
      return this.loadSessionFromCliConfig(profile);
    }

    return {
      profile: profile.name,
      server: profile.context,
      url: profile.url,
      token: resolved.token,
      grpcWeb: this.config.grpcWeb,
    };
  }

  getProfilesAuthStatus(): {
    defaultProfile: string;
    profiles: ArgoCdProfileAuthStatus[];
    apiKeyEnvVars: string[];
  } {
    const profiles = this.listProfiles().map((profile) => {
      const session = this.loadSession(profile.name);
      const resolved = this.resolveToken(profile);

      return {
        profile: profile.name,
        label: profile.label,
        url: profile.url,
        context: profile.context,
        authenticated: Boolean(session?.token),
        tokenPresent: Boolean(session?.token),
        authMethod: resolved
          ? resolved.source === "argocd-cli-config"
            ? "argocd-cli"
            : "api-key"
          : undefined,
        tokenSource: resolved?.source,
        server: session?.server,
        isDefault: profile.name === this.profiles.defaultProfile,
        recommendedAction: session?.token
          ? undefined
          : this.authenticationHint(profile.name),
      } satisfies ArgoCdProfileAuthStatus;
    });

    return {
      defaultProfile: this.profiles.defaultProfile,
      profiles,
      apiKeyEnvVars: listApiKeyEnvVars(this.profileNames()),
    };
  }

  resolveServerUrl(profileName?: string, serverOverride?: string): string {
    if (serverOverride?.trim()) {
      return serverOverride.startsWith("http")
        ? serverOverride.replace(/\/+$/, "")
        : `https://${serverOverride.replace(/\/+$/, "")}`;
    }

    return this.profiles.get(profileName).url;
  }

  async login(options: ArgoCdLoginOptions = {}): Promise<ArgoCdSession> {
    const profile = this.profiles.get(options.profile);
    const serverHost = new URL(profile.url).host;
    const useSso = options.sso ?? true;
    const args = ["login", serverHost, "--name", profile.context];

    if (useSso) {
      args.push("--sso");
    } else {
      const username = options.username?.trim();
      const password = options.password?.trim();

      if (!username || !password) {
        throw new Error(
          "Username and password are required when sso=false. For API key auth, use argocd_set_api_key or set ARGOCD_API_KEY env vars instead of login."
        );
      }

      args.push("--username", username, "--password", password);
    }

    if (options.grpcWeb ?? this.config.grpcWeb) {
      args.push("--grpc-web");
    }

    if (options.insecure ?? this.config.insecure) {
      args.push("--insecure");
    }

    if (useSso && options.ssoPort !== undefined) {
      args.push("--sso-port", String(options.ssoPort));
    }

    if (useSso && options.launchBrowser === false) {
      args.push("--sso-launch-browser=false");
    }

    try {
      const { stdout, stderr } = await execFileAsync("argocd", args, {
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const session = this.loadSessionFromCliConfig(profile);
      if (!session) {
        throw new Error(
          `Login succeeded but no auth token found for profile "${profile.name}" (context: ${profile.context}).`
        );
      }

      return {
        ...session,
        username: this.extractUsername(stdout) ?? this.extractUsername(stderr),
      };
    } catch (error) {
      if (isMissingArgocdCli(error)) {
        throw new Error(
          "argocd CLI not found. Install with: brew install argocd"
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Argo CD login failed for profile "${profile.name}": ${message}`
      );
    }
  }

  authenticationHint(profileName?: string): string {
    const profile = this.profiles.get(profileName).name;
    const envVar = tokenEnvVarForProfile(profile);

    return [
      `Run argocd_login with profile="${profile}" (SSO or username/password),`,
      `or set ${envVar} / ARGOCD_API_KEY (default profile),`,
      `or use argocd_set_api_key for this MCP session.`,
      `If the token expired, run argocd_login again or rotate the API key.`,
    ].join(" ");
  }

  expiredTokenAction(profileName?: string): string {
    return expiredTokenAction(this.profiles.get(profileName).name);
  }

  private resolveToken(profile: ArgoCdProfile): ResolvedArgoCdToken | null {
    const memoryToken = this.memoryApiKeys.get(profile.name);
    if (memoryToken) {
      return { token: memoryToken, source: "api-key-memory" };
    }

    const profileEnvToken = readProfileApiKeyFromEnv(profile.name);
    if (profileEnvToken) {
      return { token: profileEnvToken, source: "api-key-env" };
    }

    const positionalToken = this.positionalApiKeys.get(profile.name);
    if (positionalToken) {
      return { token: positionalToken, source: "api-key-env" };
    }

    if (profile.name === this.profiles.defaultProfile) {
      const defaultToken =
        readDefaultApiKeyFromEnv() || this.config.token?.trim();
      if (defaultToken) {
        return { token: defaultToken, source: "api-key-env" };
      }
    }

    const cliSession = this.loadSessionFromCliConfig(profile);
    if (cliSession?.token) {
      return { token: cliSession.token, source: "argocd-cli-config" };
    }

    return null;
  }

  private loadSessionFromCliConfig(
    profile: ArgoCdProfile
  ): ArgoCdSession | null {
    const cliConfig = this.readCliConfig();
    if (!cliConfig) {
      return null;
    }

    const context = this.findContextForProfile(cliConfig, profile);
    if (!context?.name) {
      return null;
    }

    const userName = context.user ?? context.name;
    const serverHost = context.server ?? context.name;
    const user = cliConfig.users?.find((item) => item.name === userName);
    const token = user?.["auth-token"];

    if (!token) {
      return null;
    }

    const serverEntry = cliConfig.servers?.find(
      (item) => item.server === serverHost
    );

    return {
      profile: profile.name,
      server: serverHost,
      url: profile.url,
      token,
      grpcWeb: serverEntry?.["grpc-web"] ?? this.config.grpcWeb,
    };
  }

  private readCliConfig(): ArgoCdCliConfig | null {
    if (!existsSync(this.config.configPath)) {
      return null;
    }

    const raw = readFileSync(this.config.configPath, "utf8");
    return parseYaml(raw) as ArgoCdCliConfig;
  }

  private findContextForProfile(
    cliConfig: ArgoCdCliConfig,
    profile: ArgoCdProfile
  ) {
    const contexts = cliConfig.contexts ?? [];
    const profileHost = new URL(profile.url).host;

    return (
      contexts.find((item) => item.name === profile.context) ??
      contexts.find((item) => item.server === profileHost) ??
      contexts.find((item) => item.name === profile.name)
    );
  }

  private extractUsername(output?: string): string | undefined {
    if (!output) {
      return undefined;
    }

    const match = output.match(/'([^']+)'\s+logged in successfully/i);
    return match?.[1];
  }
}

function isMissingArgocdCli(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
