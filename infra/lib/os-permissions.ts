import * as cdk from "aws-cdk-lib";
import * as cr from "aws-cdk-lib/custom-resources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as os from "aws-cdk-lib/aws-opensearchservice";
import { CustomResource } from "aws-cdk-lib";

import { OsRoleMapping } from "./os-permissions-handler/types";

export class OsPermissionProvider {
  private readonly stack: cdk.Stack;
  public securityGroup?: ec2.ISecurityGroup;
  public readonly role: iam.IRole;
  constructor(stack: cdk.Stack, domainName: string) {
    this.stack = stack;
    // Scope the OpenSearch data-plane grant to this stack's domain only. The ARN
    // is built from the explicit domain name rather than `domain.domainArn` on
    // purpose: the Domain already depends on this role (its FGAC masterUserArn),
    // so referencing the Domain resource's token here would create a Role<->Domain
    // cycle. Building the ARN from the known name + stack env tokens avoids that.
    const domainArn = `arn:${stack.partition}:es:${stack.region}:${stack.account}:domain/${domainName}/*`;
    this.role = new iam.Role(stack, "OsPermissionProviderFunctionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        permissions: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["es:ESHttp*"],
              resources: [domainArn],
            }),
          ],
        }),
      },
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(
          stack,
          "LambdaLoggingManagedPolicy",
          "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });
  }

  public setPermissions(
    domain: os.Domain,
    roleMappings: OsRoleMapping[],
    vpc?: ec2.IVpc,
  ) {
    if (vpc) {
      const vpcArn = `arn:${this.stack.partition}:ec2:${this.stack.region}:${this.stack.account}:vpc/${vpc.vpcId}`;
      this.role.attachInlinePolicy(
        new iam.Policy(this.stack, "OsPermissionProviderVpcAttachmentPolicy", {
          document: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                actions: [
                  "ec2:DescribeNetworkInterfaces",
                  "ec2:CreateNetworkInterface",
                  "ec2:DeleteNetworkInterface",
                  "ec2:DescribeInstances",
                  "ec2:AttachNetworkInterface",
                ],
                resources: ["*"],
                conditions: {
                  ArnEqualsIfExists: { "ec2:Vpc": vpcArn },
                },
              }),
            ],
          }),
        }),
      );
      this.securityGroup = new ec2.SecurityGroup(
        this.stack,
        "OsPermissionProviderSecurityGroup",
        {
          vpc,
          allowAllOutbound: true,
        },
      );
    }

    const providerFunction = new nodejs.NodejsFunction(
      this.stack,
      "OsPermissionProviderFunction",
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        role: this.role,
        depsLockFilePath: "./lib/os-permissions-handler/package-lock.json",
        handler: "handler",
        entry: "./lib/os-permissions-handler/handler.ts",
        vpc,
        securityGroups: this.securityGroup ? [this.securityGroup] : [],
        timeout: cdk.Duration.seconds(10),
      },
    );

    const osPermissionProvider = new cr.Provider(
      this.stack,
      "OsPermissionProvider",
      {
        onEventHandler: providerFunction,
        logGroup: new logs.LogGroup(this.stack, "OsPermissionProviderLogs", {
          retention: logs.RetentionDays.ONE_DAY,
        }),
      },
    );

    new CustomResource(this.stack, "OsPermission", {
      serviceToken: osPermissionProvider.serviceToken,
      properties: {
        OsEndpoint: domain.domainEndpoint,
        LambdaRoleArn: this.role.roleArn,
        RoleMappings: roleMappings,
      },
    });
  }
}
