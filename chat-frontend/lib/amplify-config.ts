import { Amplify } from "aws-amplify";
import type { RuntimeConfig } from "./runtime-config";
import { isCognitoConfigured } from "./runtime-config";

let configured = false;

/**
 * Configure Amplify Auth once on the client from runtime config (fetched from
 * `/config.json`). Wires both the username/password (SRP) flow and the
 * hosted-UI authorization-code (OAuth) flow against the Cognito app client.
 *
 * No-op when Cognito isn't configured (local dev without a config file).
 */
export function configureAmplify(cfg: RuntimeConfig): void {
  if (configured || !isCognitoConfigured(cfg)) {
    return;
  }

  const redirectBase =
    typeof window !== "undefined" ? window.location.origin : "";

  Amplify.configure(
    {
      Auth: {
        Cognito: {
          userPoolId: cfg.cognitoUserPoolId,
          userPoolClientId: cfg.cognitoUserPoolClientId,
          ...(cfg.cognitoHostedUiDomain
            ? {
              loginWith: {
                oauth: {
                  domain: cfg.cognitoHostedUiDomain,
                  scopes: ["openid", "email", "profile"],
                  redirectSignIn: [redirectBase],
                  redirectSignOut: [redirectBase],
                  responseType: "code",
                },
              },
            }
            : {}),
        },
      },
    },
    { ssr: true },
  );

  configured = true;
}
