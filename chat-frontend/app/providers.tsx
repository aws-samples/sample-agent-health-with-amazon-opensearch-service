"use client";

import { useEffect, useMemo, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { configureAmplify } from "@/lib/amplify-config";
import {
  isCognitoConfigured,
  loadRuntimeConfig,
  type RuntimeConfig,
} from "@/lib/runtime-config";
import { getCognitoBearerToken } from "@/lib/auth-token";
import { AgentCoreHttpAgent } from "@/lib/agentcore-agent";

/**
 * Client-side providers for the chat UI.
 *
 * Loads runtime config from `/config.json` (written by CDK at deploy time),
 * configures Amplify Auth, then:
 * - When Cognito is configured, gates the chat behind a Cognito login so the
 *   user obtains a JWT, sent directly to AgentCore from the browser.
 * - When not configured (local dev), skips the gate and uses an empty token.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const c = await loadRuntimeConfig();
      configureAmplify(c);
      if (active) setCfg(c);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!cfg) {
    return <LoadingScreen label="Loading…" />;
  }

  if (!isCognitoConfigured(cfg)) {
    return (
      <ChatRuntimeProvider config={cfg} getToken={async () => undefined}>
        {children}
      </ChatRuntimeProvider>
    );
  }

  return <AuthGatedChat config={cfg}>{children}</AuthGatedChat>;
}

/**
 * Cognito login gate (Amplify UI Authenticator), loaded lazily so its bundle
 * only loads when Cognito is enabled.
 */
function AuthGatedChat({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: React.ReactNode;
}) {
  const [ui, setUi] = useState<null | {
    Authenticator: typeof import("@aws-amplify/ui-react").Authenticator;
  }>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const mod = await import("@aws-amplify/ui-react");
      await import("@aws-amplify/ui-react/styles.css");
      if (active) setUi({ Authenticator: mod.Authenticator });
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!ui) {
    return <LoadingScreen label="Loading sign-in…" />;
  }

  const { Authenticator } = ui;

  return (
    <Authenticator hideSignUp>
      {() => (
        <ChatRuntimeProvider config={config} getToken={getCognitoBearerToken}>
          {children}
        </ChatRuntimeProvider>
      )}
    </Authenticator>
  );
}

/**
 * Wires the assistant-ui AG-UI runtime to an `AgentCoreHttpAgent` that calls
 * the AgentCore runtime directly from the browser with the user's token.
 */
function ChatRuntimeProvider({
  config,
  children,
  getToken,
}: {
  config: RuntimeConfig;
  children: React.ReactNode;
  getToken: () => Promise<string | undefined>;
}) {
  const agent = useMemo(
    () =>
      new AgentCoreHttpAgent({
        region: config.region,
        runtimeArn: config.agentRuntimeArn,
        qualifier: config.agentRuntimeQualifier,
        getToken,
      }),
    [config, getToken],
  );

  const runtime = useAgUiRuntime({ agent });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#003b5c",
        fontSize: "1rem",
      }}
    >
      {label}
    </main>
  );
}
