/**
 * Runtime configuration fetched from `/config.json` at app startup.
 *
 * Why runtime (not build-time env): the Cognito ids, region, and AgentCore ARN
 * are CDK deploy-time values. A static build happens BEFORE those resolve, so
 * they cannot be baked in via `NEXT_PUBLIC_*`. Instead CDK writes a resolved
 * `config.json` next to the static site at deploy time (S3 `Source.jsonData`),
 * and the browser fetches it on load.
 *
 * For local dev, a `public/config.json` can provide values (or it can 404, in
 * which case Cognito is treated as unconfigured and the app talks to a local
 * agent without auth).
 */
export interface RuntimeConfig {
  region: string;
  cognitoUserPoolId: string;
  cognitoUserPoolClientId: string;
  cognitoHostedUiDomain?: string;
  agentRuntimeArn: string;
  agentRuntimeQualifier: string;
}

const EMPTY: RuntimeConfig = {
  region: "us-east-1",
  cognitoUserPoolId: "",
  cognitoUserPoolClientId: "",
  cognitoHostedUiDomain: undefined,
  agentRuntimeArn: "",
  agentRuntimeQualifier: "DEFAULT",
};

let cached: RuntimeConfig | undefined;

/**
 * Fetch and cache `/config.json`. Returns empty defaults if it is missing or
 * malformed (e.g. local dev without a config file).
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (!res.ok) {
      cached = EMPTY;
      return cached;
    }
    const data = (await res.json()) as Partial<RuntimeConfig>;
    cached = { ...EMPTY, ...data };
    return cached;
  } catch {
    cached = EMPTY;
    return cached;
  }
}

export function isCognitoConfigured(cfg: RuntimeConfig): boolean {
  return Boolean(cfg.cognitoUserPoolId && cfg.cognitoUserPoolClientId);
}
