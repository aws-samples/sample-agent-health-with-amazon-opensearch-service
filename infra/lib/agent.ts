import * as path from "path";
import { Stack } from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface AgentConstructProps {
  /** Region-prefixed Bedrock inference profile id, e.g. `us.amazon.nova-pro-v1:0`. */
  readonly modelId: string;

  /** Inference-profile region prefix (`eu`/`us`/`apac`/`global`). @default "eu" */
  readonly regionPrefix?: string;

  readonly ingestionEndpoint: string;
  readonly ingestionPipelineArn: string;
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
}

export class AgentConstruct extends Construct {
  public readonly runtime: agentcore.Runtime;
  public readonly role: iam.IRole;
  public readonly endpoint: agentcore.RuntimeEndpoint;

  /**
   * AG-UI data-plane invocation URL. AgentCore surfaces only ARNs, so this is
   * built from the documented URL shape; the ARN is a deploy-time token, so the
   * separators are pre-percent-encoded (`:`->%3A, `/`->%2F) instead of encoding
   * the resolved value.
   */
  public readonly invocationUrl: string;

  constructor(scope: Construct, id: string, props: AgentConstructProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const { region, account, partition } = stack;

    this.runtime = new agentcore.Runtime(this, "RetailAgentRuntime", {
      runtimeName: "retail_agent",
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(
        path.join(__dirname, "../../retail-agent"),
        { platform: Platform.LINUX_ARM64 },
      ),
      protocolConfiguration: agentcore.ProtocolType.AGUI,
      authorizerConfiguration:
        agentcore.RuntimeAuthorizerConfiguration.usingCognito(props.userPool, [
          props.userPoolClient,
        ]),
      environmentVariables: {
        AGENT_INTERFACE_MODE: "agentcore",
        MODEL_ID: props.modelId,
        OTEL_EXPORTER_OTLP_ENDPOINT: props.ingestionEndpoint,
      },
      // Disabled deliberately: enabling it synthesizes a Logs DeliverySource/
      // DeliveryDestination(XRAY)/XRay::ResourcePolicy chain that requires the
      // account-level CloudWatch Logs trace-segment destination. Traces instead
      // flow via the in-container SigV4 OTLP exporter to OSIS.
      tracingEnabled: false,
    });

    this.endpoint = new agentcore.RuntimeEndpoint(this, "RuntimeEndpoint", {
      agentRuntimeId: this.runtime.agentRuntimeId,
      // Track the runtime's current version; otherwise the endpoint stays
      // pinned to v1 and serves a stale container after redeploys.
      agentRuntimeVersion: this.runtime.agentRuntimeVersion,
    });

    this.role = this.runtime.role;

    const encodedRuntimeArn =
      `arn%3A${partition}%3Abedrock-agentcore%3A${region}%3A${account}%3Aruntime%2F` +
      this.runtime.agentRuntimeId;
    this.invocationUrl =
      `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/` +
      `${encodedRuntimeArn}/invocations` +
      `?qualifier=${this.endpoint.endpointName}`;

    // Invoking via a cross-region inference profile requires the grant on both
    // the inference-profile ARN and the underlying foundation-model ARN. The
    // region wildcard on the latter covers the regions the profile routes to.
    const regionPrefix = props.regionPrefix ?? "eu";
    const baseModelId = props.modelId.startsWith(`${regionPrefix}.`)
      ? props.modelId.slice(regionPrefix.length + 1)
      : props.modelId;

    const inferenceProfileArn = `arn:${partition}:bedrock:${region}:${account}:inference-profile/${props.modelId}`;
    const foundationModelArn = `arn:${partition}:bedrock:*::foundation-model/${baseModelId}`;

    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "InvokeBedrockModel",
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [inferenceProfileArn, foundationModelArn],
      }),
    );

    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "IngestToOsisPipeline",
        actions: ["osis:Ingest"],
        resources: [props.ingestionPipelineArn],
      }),
    );
  }
}
