import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { IngestionConstruct } from "./ingestion";
import { AgentConstruct } from "./agent";
import { FrontendConstruct } from "./frontend";
import { HostingConstruct } from "./hosting";
import { OsPermissionProvider } from "./os-permissions";
import { OsRole } from "./os-permissions-handler/types";

export class AgentObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // IAM role/user ARN granted OpenSearch `readall`, passed as context:
    //   cdk deploy -c agentHealthReaderArn=arn:aws:iam::<acct>:role/<NAME>
    // Must be the role/user ARN, not an STS assumed-role session ARN: FGAC
    // normalizes assumed roles to the underlying role ARN, so a session ARN
    // would silently never match.
    const agentHealthReaderArn = this.node.tryGetContext(
      "agentHealthReaderArn",
    ) as string | undefined;

    const iamPrincipalArn = /^arn:aws:iam::\d{12}:(role|user)\/.+$/;
    if (!agentHealthReaderArn || !iamPrincipalArn.test(agentHealthReaderArn)) {
      throw new Error(
        "Context 'agentHealthReaderArn' is required and must be an IAM role or " +
        "user ARN (not an STS assumed-role session ARN), e.g. " +
        "-c agentHealthReaderArn=arn:aws:iam::123456789012:role/MyReader. " +
        `Got: ${agentHealthReaderArn ?? "<unset>"}`,
      );
    }

    // Explicit, lowercase domain name (OpenSearch: 3-28 chars, starts with a
    // letter, only a-z/0-9/`-`). Fixed name lets the permission provider scope
    // its `es:ESHttp*` grant to this domain's ARN without depending on the
    // Domain resource (which would cycle via the FGAC masterUserArn). One such
    // domain per account/region; override via `-c domainName=...` if needed.
    const domainName =
      (this.node.tryGetContext("domainName") as string | undefined) ??
      "agent-observability";

    const permissionProvider = new OsPermissionProvider(this, domainName);

    const domain = new opensearch.Domain(this, "Domain", {
      domainName,
      version: opensearch.EngineVersion.OPENSEARCH_3_5,
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: "or2.medium.search",
      },
      // Demo: single-AZ. Use zone awareness with >1 data node for production.
      zoneAwareness: { enabled: false },
      ebs: {
        volumeSize: 20,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },
      encryptionAtRest: { enabled: true },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      fineGrainedAccessControl: {
        masterUserArn: permissionProvider.role.roleArn,
      },
      // Demo: destroy the domain (and its data) with the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const ingestion = new IngestionConstruct(this, "Ingestion", {
      domain,
    });

    // Region-prefixed Bedrock inference profile id. The prefix must match the
    // deployment region (pinned to us-east-1 in bin/app.ts); a mismatched
    // prefix is rejected by Bedrock as an invalid model id.
    const modelId =
      (this.node.tryGetContext("modelId") as string | undefined) ??
      "us.amazon.nova-pro-v1:0";

    const regionPrefix =
      (this.node.tryGetContext("regionPrefix") as string | undefined) ?? "us";

    // Created before Cognito so its URL seeds Cognito's OAuth callback/logout
    // URLs without a Cognito<->Amplify dependency cycle.
    const hosting = new HostingConstruct(this, "Hosting");

    const frontend = new FrontendConstruct(this, "Frontend", {
      callbackUrls: [
        `${hosting.appUrl}/api/auth/callback/cognito`,
        "http://localhost:3000/api/auth/callback/cognito",
      ],
      logoutUrls: [hosting.appUrl, "http://localhost:3000"],
    });

    const agent = new AgentConstruct(this, "Agent", {
      modelId,
      regionPrefix,
      ingestionEndpoint: ingestion.ingestionEndpoint,
      ingestionPipelineArn: ingestion.pipeline.attrPipelineArn,
      userPool: frontend.userPool,
      userPoolClient: frontend.userPoolClient,
    });

    // Ingestion pipeline role gets `all_access` (it writes traces); the reader
    // gets `readall`. No human admin is mapped — the provisioning Lambda is the
    // FGAC master and re-adds itself as `security_manager`.
    permissionProvider.setPermissions(domain, [
      {
        osRole: OsRole.ALL_ACCESS,
        iamRoleArns: [ingestion.pipelineRole.roleArn],
      },
      {
        osRole: OsRole.READ_ALL,
        iamRoleArns: [agentHealthReaderArn],
      },
    ]);

    hosting.deployBranch({
      frontendDir: path.join(__dirname, "../../chat-frontend"),
      runtimeConfig: {
        region: this.region,
        agentRuntimeArn: agent.runtime.agentRuntimeArn,
        agentRuntimeQualifier: agent.endpoint.endpointName,
        cognitoUserPoolId: frontend.userPool.userPoolId,
        cognitoUserPoolClientId: frontend.userPoolClient.userPoolClientId,
        cognitoHostedUiDomain: frontend.hostedUiDomainName,
      },
    });

    new CfnOutput(this, "ChatUrl", {
      description: "Public URL of the chat frontend.",
      value: hosting.appUrl,
      exportName: "ChatUrl",
    });

    new CfnOutput(this, "UserPoolId", {
      description:
        "Cognito User Pool id. Use with `aws cognito-idp admin-create-user` to provision chat users (self sign-up is disabled).",
      value: frontend.userPool.userPoolId,
      exportName: "UserPoolId",
    });

    new CfnOutput(this, "UserPoolClientId", {
      description:
        "Cognito App Client id. Use with `aws cognito-idp initiate-auth` to mint a bearer token for Agent Health.",
      value: frontend.userPoolClient.userPoolClientId,
      exportName: "UserPoolClientId",
    });

    new CfnOutput(this, "AgentEndpoint", {
      description:
        "AG-UI invocation URL for the retail agent — the agent endpoint for Agent Health config.",
      value: agent.invocationUrl,
      exportName: "AgentEndpoint",
    });

    new CfnOutput(this, "OpenSearchEndpoint", {
      description:
        "OpenSearch domain endpoint for Agent Health storage and observability config.",
      value: `https://${domain.domainEndpoint}`,
      exportName: "OpenSearchEndpoint",
    });

    new CfnOutput(this, "Region", {
      description:
        "Deployment region — used by Agent Health for SigV4 signing to OpenSearch.",
      value: this.region,
      exportName: "Region",
    });
  }
}
