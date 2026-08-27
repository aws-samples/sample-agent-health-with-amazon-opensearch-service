// Ambient type declarations for @opensearch-project/agent-health.
// The published package (0.4.0) ships runtime JS only, with no bundled
// .d.ts files and no "types" export condition, so we declare the small
// surface we use here. Mirrors the documented config options:
// https://observability.opensearch.org/docs/agent-health/configuration/
declare module '@opensearch-project/agent-health' {
  /** Auth used by connectors and by storage/observability OpenSearch access. */
  export interface ConnectorAuth {
    type: 'none' | 'basic' | 'bearer' | 'api-key' | 'aws-sigv4';
    username?: string;
    password?: string;
    token?: string;
    headerName?: string;
    headers?: Record<string, string>;
    awsRegion?: string;
    awsService?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsSessionToken?: string;
  }

  export interface UserAgentConfig {
    key: string;
    name: string;
    endpoint: string;
    connectorType: string;
    models?: string[];
    headers?: Record<string, string>;
    useTraces?: boolean;
    connectorConfig?: unknown;
    description?: string;
    enabled?: boolean;
    auth?: ConnectorAuth;
  }

  /** OpenSearch connection for storage/observability. Supports basic auth or
   *  SigV4 (for IAM-secured Amazon OpenSearch Service domains). */
  export interface OpenSearchConnectionConfig {
    endpoint?: string;
    username?: string;
    password?: string;
    authType?: 'none' | 'basic' | 'sigv4';
    awsRegion?: string;
    awsService?: string;
    tlsSkipVerify?: boolean;
  }

  export interface StorageConfig extends OpenSearchConnectionConfig { }

  export interface ObservabilityConfig extends OpenSearchConnectionConfig {
    tracesIndex?: string;
    logsIndex?: string;
  }

  export interface AgentHealthConfig {
    agents?: UserAgentConfig[];
    models?: unknown[];
    connectors?: unknown[];
    storage?: StorageConfig;
    observability?: ObservabilityConfig;
    testCases?: string | string[];
    reporters?: unknown[];
    judge?: unknown;
    extends?: boolean;
  }

  export function defineConfig(config: AgentHealthConfig): AgentHealthConfig;
}
