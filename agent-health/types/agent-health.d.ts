// Ambient type declarations for @opensearch-project/agent-health.
// The installed package ships full .d.ts files, but we pin only the small
// config surface this sample uses (including the buildTrajectory lifecycle
// hook) so the config stays readable and stable across minor releases.
// Mirrors the documented config options:
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
    /** Lifecycle hooks (only buildTrajectory is used here). */
    hooks?: AgentHooks;
  }

  // --- Lifecycle hooks -----------------------------------------------------
  // Trace-mode agents (useTraces: true) whose stream carries only the final
  // answer need buildTrajectory to reconstruct the tool trajectory from OTel
  // spans, otherwise the judge sees no tool calls. Shapes mirror the package's
  // TrajectoryStep/Span types; the runtime also accepts a null return, which
  // tells the trace poller to keep waiting (trace not complete yet).

  /** OTel span event as delivered to buildTrajectory. */
  export interface SpanEvent {
    name: string;
    time?: string;
    attributes?: Record<string, any>;
  }

  /** OTel span as delivered to buildTrajectory. */
  export interface Span {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    startTime: string;
    endTime: string;
    status: 'OK' | 'ERROR' | 'UNSET';
    attributes?: Record<string, any>;
    events?: SpanEvent[];
  }

  export type ToolCallStatus = 'SUCCESS' | 'FAILURE';

  /** One step in the trajectory the judge evaluates. */
  export interface TrajectoryStep {
    id: string;
    timestamp: number;
    type: 'tool_result' | 'assistant' | 'action' | 'response' | 'thinking';
    content: string;
    toolName?: string;
    toolArgs?: Record<string, any>;
    toolOutput?: any;
    status?: ToolCallStatus;
    latencyMs?: number;
  }

  export interface BuildTrajectoryContext {
    spans: Span[];
    runId: string;
  }

  export interface AgentHooks {
    /**
     * Build the trajectory the judge evaluates from the run's OTel spans.
     * Return null to signal the trace is incomplete so the poller keeps
     * waiting instead of judging a partial trace.
     */
    buildTrajectory?: (
      context: BuildTrajectoryContext,
    ) => Promise<TrajectoryStep[] | null>;
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
