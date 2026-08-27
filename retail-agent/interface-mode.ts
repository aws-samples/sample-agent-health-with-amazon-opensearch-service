/**
 * Interface-mode and listen-port resolution for the retail agent.
 *
 * The agent runs in one of two interface modes:
 * - `local` (default): plain HTTP for local development (no tracing). AG-UI
 *   handler on `POST /` at port 8000, plus `GET /health` and `GET /ping`.
 * - `agentcore`: satisfies the Amazon Bedrock AgentCore Runtime contract. Serves
 *   on port 8080 with the AG-UI handler on `POST /invocations` and `GET /ping`.
 */

export const LOCAL_MODE = 'local';
export const AGENTCORE_MODE = 'agentcore';

const DEFAULT_PORTS: Record<string, number> = {
  [LOCAL_MODE]: 8000,
  [AGENTCORE_MODE]: 8080,
};

/** Resolve the interface mode from env. Defaults to `local`. */
export function resolveInterfaceMode(env: NodeJS.ProcessEnv): string {
  return (env.AGENT_INTERFACE_MODE ?? '').trim().toLowerCase() || LOCAL_MODE;
}

/** Default listen port for a mode (`agentcore` → 8080, anything else → 8000). */
export function defaultPortForMode(mode: string): number {
  return DEFAULT_PORTS[mode] ?? DEFAULT_PORTS[LOCAL_MODE];
}

/** Resolve the listen port, honoring a non-empty `PORT` override. */
export function resolvePort(env: NodeJS.ProcessEnv, mode: string): number {
  const raw = env.PORT;
  if (raw === undefined || raw.trim() === '') {
    return defaultPortForMode(mode);
  }
  return parseInt(raw.trim(), 10);
}
