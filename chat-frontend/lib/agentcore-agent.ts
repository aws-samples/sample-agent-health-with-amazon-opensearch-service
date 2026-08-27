import { HttpAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/core";

/**
 * Token provider: returns a fresh Cognito bearer token (or undefined when the
 * user is not signed in). Amplify auto-refreshes the underlying session, so
 * calling this returns a non-expired token while the session is active.
 */
export type TokenProvider = () => Promise<string | undefined>;

export interface AgentCoreHttpAgentOptions {
  /** AWS region of the AgentCore runtime, e.g. `us-east-1`. */
  region: string;
  /** AgentCore Runtime ARN. */
  runtimeArn: string;
  /** Endpoint qualifier (endpoint name). Defaults to `DEFAULT`. */
  qualifier?: string;
  /** Returns the current Cognito bearer token for the signed-in user. */
  getToken: TokenProvider;
}

/**
 * AG-UI client that targets an Amazon Bedrock AgentCore Runtime by calling its
 * data-plane `InvokeAgentRuntime` HTTP endpoint DIRECTLY FROM THE BROWSER,
 * authenticating with the user's Cognito bearer token (JWT passthrough).
 *
 * This works without a server because the AgentCore data-plane endpoint is
 * CORS-enabled (it answers browser preflight with `access-control-allow-origin`
 * and allows the `authorization` header). The runtime uses a Cognito JWT
 * authorizer, so the browser sends `Authorization: Bearer <cognito token>` and
 * AgentCore validates it.
 *
 * The runtime speaks AG-UI: the request body is the AG-UI `RunAgentInput` JSON
 * and the response is a streamed `text/event-stream` of AG-UI events. The
 * `@assistant-ui/react-ag-ui` runtime drives this agent and parses the events
 * into chat messages.
 *
 * Auth is injected via a custom `fetch` hook (async, runs per request) so a
 * fresh token is fetched right before each invocation — avoiding stale/expired
 * tokens on long-lived sessions.
 */
export class AgentCoreHttpAgent extends HttpAgent {
  /** Stable session id for this conversation (one agent instance = one session). */
  private readonly sessionId: string;

  constructor(options: AgentCoreHttpAgentOptions) {
    const sessionId = AgentCoreHttpAgent.newSessionId();
    super({
      url: AgentCoreHttpAgent.buildInvocationUrl(
        options.region,
        options.runtimeArn,
        options.qualifier ?? "DEFAULT",
      ),
      // Custom fetch: refresh the Cognito token and attach it (plus the
      // required session-id header) immediately before the request is sent.
      fetch: async (url: string, requestInit: RequestInit) => {
        const token = await options.getToken();
        const headers = new Headers(requestInit.headers);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        headers.set(
          "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id",
          sessionId,
        );
        return fetch(url, { ...requestInit, headers });
      },
    });
    this.sessionId = sessionId;
  }

  /**
   * Build the data-plane invocations URL for a runtime ARN.
   *
   * Shape:
   *   https://bedrock-agentcore.<region>.amazonaws.com
   *     /runtimes/<URL-encoded runtime ARN>/invocations?qualifier=<qualifier>
   */
  static buildInvocationUrl(
    region: string,
    runtimeArn: string,
    qualifier = "DEFAULT",
  ): string {
    const encodedArn = encodeURIComponent(runtimeArn);
    return (
      `https://bedrock-agentcore.${region}.amazonaws.com` +
      `/runtimes/${encodedArn}/invocations?qualifier=${encodeURIComponent(qualifier)}`
    );
  }

  /**
   * AgentCore requires a session id of at least 33 characters on the
   * `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header.
   */
  private static newSessionId(): string {
    const rand = () => Math.random().toString(36).slice(2);
    return `session-${Date.now()}-${rand()}${rand()}${rand()}`;
  }

  /**
   * Send the AG-UI `RunAgentInput` as JSON and request the event-stream
   * response. (Auth + session headers are added by the custom `fetch` above.)
   */
  protected requestInit(input: RunAgentInput): RequestInit {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(input),
      signal: this.abortController.signal,
    };
  }
}
