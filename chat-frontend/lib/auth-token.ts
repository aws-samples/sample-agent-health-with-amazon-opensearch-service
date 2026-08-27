import { fetchAuthSession } from "aws-amplify/auth";

/**
 * Fetch the current user's Cognito JWT for AgentCore invocation.
 *
 * AgentCore's Cognito JWT authorizer validates the bearer token against the
 * configured user pool/app client. We send the access token by default; set
 * `NEXT_PUBLIC_COGNITO_TOKEN=id` to send the id token instead if the authorizer
 * is configured to expect it. Amplify refreshes tokens automatically, so this
 * returns a valid (non-expired) token while the session is active.
 */
export async function getCognitoBearerToken(): Promise<string | undefined> {
  try {
    const session = await fetchAuthSession();
    const useIdToken =
      (process.env.NEXT_PUBLIC_COGNITO_TOKEN || "access").toLowerCase() === "id";
    const token = useIdToken
      ? session.tokens?.idToken
      : session.tokens?.accessToken;
    return token?.toString();
  } catch {
    return undefined;
  }
}
