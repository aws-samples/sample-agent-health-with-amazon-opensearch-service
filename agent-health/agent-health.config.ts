import { defineConfig } from '@opensearch-project/agent-health';
import type { Span, TrajectoryStep } from '@opensearch-project/agent-health';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import cdkOut from '../infra/cdk-outputs.json' with { type: 'json' };

const out = cdkOut.AgentObservabilityStack;

// Mint a short-lived Cognito access token at startup for the AgentCore JWT
// authorizer. The chat App Client has no secret and enables USER_PASSWORD_AUTH,
// so InitiateAuth needs only a provisioned user's username/password (read from
// env so no secrets live in the committed config). The authorizer validates the
// access token, so that is what we forward. Valid ~1h (long enough for a run).
async function mintCognitoAccessToken(): Promise<string> {
  const email = process.env.COGNITO_EMAIL;
  const password = process.env.COGNITO_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'COGNITO_EMAIL and COGNITO_PASSWORD must be set to mint a Cognito access token',
    );
  }

  const client = new CognitoIdentityProviderClient({ region: out.Region });
  const res = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: out.UserPoolClientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }),
  );

  const token = res.AuthenticationResult?.AccessToken;
  if (!token) {
    throw new Error(
      `Cognito InitiateAuth returned no AccessToken` +
      (res.ChallengeName ? ` (challenge: ${res.ChallengeName})` : ''),
    );
  }
  return token;
}

const bearerToken = await mintCognitoAccessToken();

/**
 * Reconstruct the judge's trajectory from the agent's OTel spans.
 *
 * The AgentCore AG-UI stream deliberately carries only the final answer (tool
 * internals are kept off the shared frontend endpoint), so without this the
 * judge sees no tool calls and wrongly grades "no tool was invoked". Strands
 * emits the root `invoke_agent` span last, so a missing root means the trace is
 * still arriving: return null to keep the poller waiting rather than judging a
 * partial trace.
 */
function buildRetailTrajectory(spans: Span[]): TrajectoryStep[] | null {
  const opName = (s: Span) => s.attributes?.['gen_ai.operation.name'];
  const root = spans.find((s) => opName(s) === 'invoke_agent');
  if (!root) return null; // trace incomplete -> keep polling

  const parseJson = (v: unknown): any => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const stripTags = (t: string) =>
    t
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
      .replace(/<\/?answer>/g, '')
      .trim();
  const eventAttr = (s: Span, event: string, key: string) =>
    s.events?.find((e) => e.name === event)?.attributes?.[key];

  const steps: TrajectoryStep[] = spans
    .filter((s) => opName(s) === 'execute_tool')
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
    .map((s): TrajectoryStep => {
      const args = eventAttr(s, 'gen_ai.tool.message', 'content');
      const output = eventAttr(s, 'gen_ai.choice', 'message');
      const toolName = s.attributes?.['gen_ai.tool.name'];
      return {
        id: s.attributes?.['gen_ai.tool.call.id'] ?? s.spanId,
        timestamp: Date.parse(s.startTime),
        type: 'tool_result',
        content: `${toolName}(${args ?? ''})`,
        toolName,
        toolArgs: parseJson(args),
        toolOutput: parseJson(output),
        status:
          s.attributes?.['gen_ai.tool.status'] === 'success'
            ? 'SUCCESS'
            : 'FAILURE',
        latencyMs: Date.parse(s.endTime) - Date.parse(s.startTime),
      };
    });

  const answer = stripTags(String(eventAttr(root, 'gen_ai.choice', 'message') ?? ''));
  if (answer) {
    steps.push({
      id: `${root.spanId}-response`,
      timestamp: Date.parse(root.endTime),
      type: 'response',
      content: answer,
    });
  }
  return steps;
}

export default defineConfig({
  agents: [
    {
      key: 'retail-agent',
      name: 'Retail Assistant (production)',
      connectorType: 'agui-streaming',
      // the AG-UI /invocations URL on AgentCore.
      endpoint: out.AgentEndpoint,
      useTraces: true,
      description: 'Strands-powered retail assistant with 6 tools',
      // The AgentCore runtime is gated by a Cognito JWT authorizer. The token
      // is minted above at startup and is valid ~1h (long enough for a run).
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
      // The AG-UI stream returns only the final answer, so rebuild the tool
      // trajectory from OTel spans for the judge (see buildRetailTrajectory).
      hooks: {
        buildTrajectory: async ({ spans }) => buildRetailTrajectory(spans),
      },
    },
    {
      key: 'retail-agent-local',
      name: 'Retail Assistant (local)',
      connectorType: 'agui-streaming',
      // Local Node/TypeScript run: AG-UI handler on POST / at port 8000.
      // No auth — plain HTTP, no bearer token.
      endpoint: 'http://localhost:8000/',
      useTraces: false,
      description: 'Local Strands retail assistant (TypeScript, no auth)',
    },
  ],
  // Storage is kept local here as this is imitating a production setup
  // We don't want to write Agent Health configuration to a production database
  // storage: {
  //   endpoint: out.OpenSearchEndpoint,
  //   authType: 'sigv4',
  //   awsRegion: out.Region,
  //   awsService: 'es',
  // },
  observability: {
    endpoint: out.OpenSearchEndpoint,
    authType: 'sigv4',
    awsRegion: out.Region,
    awsService: 'es',
    // Traces land here via the OSIS pipeline (otel_traces processor).
    tracesIndex: 'otel-v1-apm-span-*',
  },
  testCases: './test-cases.json',
});
