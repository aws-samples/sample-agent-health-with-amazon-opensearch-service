import { defineConfig } from '@opensearch-project/agent-health';
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

export default defineConfig({
  agents: [
    {
      key: 'retail-agent',
      name: 'Retail Assistant',
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
