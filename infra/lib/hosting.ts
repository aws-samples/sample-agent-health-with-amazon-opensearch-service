import { DockerImage, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as amplify from "aws-cdk-lib/aws-amplify";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { execSync } from "child_process";
import { cpSync, existsSync } from "fs";
import * as path from "path";

export interface HostingConstructProps {
  /** @default "agent-health-chat" */
  readonly appName?: string;

  /** Branch name / URL subdomain. @default "main" */
  readonly branchName?: string;
}

export interface DeployBranchOptions {
  /**
   * Deploy-time values written to `/config.json` next to the static site via
   * `Source.jsonData` (which resolves CDK tokens at deploy time). They can't be
   * baked into the static build at synth time, so the app fetches them at
   * startup.
   */
  readonly runtimeConfig: Record<string, string>;

  /**
   * `chat-frontend` project dir. Built during synth via local bundling
   * (`npm run build`). `-c skipFrontendBuild=true` reuses an existing `out/`.
   */
  readonly frontendDir: string;
}

/**
 * Amplify Hosting (WEB / static) for the chat frontend. The frontend is a fully
 * static export that calls AgentCore directly from the browser with the user's
 * Cognito JWT — no server. The static `out/` is uploaded to a private artifact
 * bucket and deployed to Amplify via StartDeployment (BUCKET_PREFIX).
 *
 * Two-phase API to avoid a dependency cycle: the constructor creates the app
 * and exposes `appUrl` (for Cognito's OAuth callback URLs), then `deployBranch`
 * creates the branch and triggers the deployment.
 */
export class HostingConstruct extends Construct {
  public readonly appId: string;
  public readonly branchName: string;
  public readonly appUrl: string;

  private readonly app: amplify.CfnApp;
  private deployed = false;

  constructor(scope: Construct, id: string, props: HostingConstructProps = {}) {
    super(scope, id);

    const appName = props.appName ?? "agent-health-chat";
    this.branchName = props.branchName ?? "main";

    // No IAM service role: this is a static WEB export with no Amplify-managed
    // backend. Amplify reads the site from the artifact bucket via the bucket
    // resource policy (see deployBranch), and StartDeployment is granted to the
    // deployment custom resource — neither needs an app service role.
    this.app = new amplify.CfnApp(this, "App", {
      name: appName,
      platform: "WEB",
    });
    this.appId = this.app.attrAppId;
    this.appUrl = `https://${this.branchName}.${this.app.attrAppId}.amplifyapp.com`;
  }

  public deployBranch(options: DeployBranchOptions): void {
    if (this.deployed) {
      throw new Error("HostingConstruct.deployBranch() may only be called once.");
    }
    this.deployed = true;

    const stack = Stack.of(this);

    const branch = new amplify.CfnBranch(this, "Branch", {
      appId: this.app.attrAppId,
      branchName: this.branchName,
      enableAutoBuild: false,
    });

    const skipBuild =
      this.node.tryGetContext("skipFrontendBuild") === "true" ||
      this.node.tryGetContext("skipFrontendBuild") === true;
    const outDir = path.join(options.frontendDir, "out");

    let bundle: Asset;
    if (skipBuild) {
      if (!existsSync(outDir)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[HostingConstruct] skipFrontendBuild=true and no build at ` +
          `${outDir}; skipping deployment for this synth.`,
        );
        return;
      }
      bundle = new Asset(this, "Bundle", { path: outDir });
    } else {
      bundle = new Asset(this, "Bundle", {
        // Hash the sources (not the build output) so a code change triggers a
        // rebuild + redeploy.
        path: options.frontendDir,
        exclude: ["node_modules", ".next", "out", ".amplify-hosting"],
        bundling: {
          // Local bundling only; the Docker image is a required, unused fallback.
          image: DockerImage.fromRegistry("node:20"),
          local: {
            tryBundle(targetDir: string): boolean {
              // Clean install from the lockfile so the build is reproducible and
              // picks up dependency changes; only runs when CDK re-bundles on a
              // source change. Also lets a clean checkout (only infra deps
              // installed) build the site.
              execSync("npm ci", {
                cwd: options.frontendDir,
                stdio: "inherit",
              });
              execSync("npm run build", {
                cwd: options.frontendDir,
                stdio: "inherit",
              });
              cpSync(outDir, targetDir, { recursive: true });
              return true;
            },
          },
        },
      });
    }

    // Private bucket, ACLs disabled (CDK default BucketOwnerEnforced). Amplify
    // reads the site from here via its service principal (policy below).
    const artifactBucket = new s3.Bucket(this, "ArtifactBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const artifactPrefix = "site";

    const bucketDeployment = new BucketDeployment(this, "BundleDeployment", {
      sources: [
        Source.bucket(bundle.bucket, bundle.s3ObjectKey),
        Source.jsonData("config.json", options.runtimeConfig),
      ],
      destinationBucket: artifactBucket,
      destinationKeyPrefix: artifactPrefix,
      prune: true,
    });

    // Amplify reads the site as its service principal; the SourceArn must be the
    // URL-encoded branch ARN (per the AWS "deploy from S3 with SDKs" guidance).
    const encodedBranchArn =
      `arn%3A${stack.partition}%3Aamplify%3A${stack.region}%3A${stack.account}` +
      `%3Aapps%2F${this.app.attrAppId}%2Fbranches%2F${this.branchName}`;

    artifactBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowAmplifyList",
        principals: [new iam.ServicePrincipal("amplify.amazonaws.com")],
        actions: ["s3:ListBucket"],
        resources: [artifactBucket.bucketArn],
        conditions: {
          StringEquals: {
            "aws:SourceAccount": stack.account,
            "aws:SourceArn": encodedBranchArn,
          },
        },
      }),
    );
    artifactBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowAmplifyRead",
        principals: [new iam.ServicePrincipal("amplify.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [artifactBucket.arnForObjects(`${artifactPrefix}/*`)],
        conditions: {
          StringEquals: {
            "aws:SourceAccount": stack.account,
            "aws:SourceArn": encodedBranchArn,
          },
        },
      }),
    );

    const deploymentParams = {
      appId: this.app.attrAppId,
      branchName: this.branchName,
      // BUCKET_PREFIX source URL must end with a trailing slash.
      sourceUrl: `s3://${artifactBucket.bucketName}/${artifactPrefix}/`,
      sourceUrlType: "BUCKET_PREFIX",
    };
    const physicalId = PhysicalResourceId.of(
      `${this.app.attrAppId}-${this.branchName}-${bundle.assetHash}`,
    );

    const deployment = new AwsCustomResource(this, "Deployment", {
      onCreate: {
        service: "Amplify",
        action: "startDeployment",
        parameters: deploymentParams,
        physicalResourceId: physicalId,
      },
      onUpdate: {
        service: "Amplify",
        action: "startDeployment",
        parameters: deploymentParams,
        physicalResourceId: physicalId,
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["amplify:StartDeployment"],
          resources: [
            `arn:${stack.partition}:amplify:${stack.region}:${stack.account}:apps/*/branches/*/deployments/*`,
          ],
        }),
      ]),
    });
    deployment.node.addDependency(branch);
    deployment.node.addDependency(bucketDeployment);
  }
}
