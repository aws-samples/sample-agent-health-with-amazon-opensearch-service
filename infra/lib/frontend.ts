import { RemovalPolicy, Stack } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export interface FrontendConstructProps {
  /**
   * Hosted-UI Cognito domain prefix — globally unique, lowercase, no
   * `aws`/`cognito`. @default `agent-health-<account>`
   */
  readonly cognitoDomainPrefix?: string;

  readonly callbackUrls?: string[];
  readonly logoutUrls?: string[];
}

/**
 * Cognito User Pool + App Client + hosted-UI domain for the chat UI, reused as
 * the AgentCore Runtime authorizer (hence exposed as concrete types).
 */
export class FrontendConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  /** Bare hosted-UI domain host (no scheme), for Amplify Auth's oauth.domain. */
  public readonly hostedUiDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendConstructProps = {}) {
    super(scope, id);

    const stack = Stack.of(this);

    this.userPool = new cognito.UserPool(this, "ChatUserPool", {
      userPoolName: "agent-health-chat",
      // Admin-provisioned users only (`aws cognito-idp admin-create-user`).
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Demo: remove the pool (and its users) with the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient("ChatUiClient", {
      userPoolClientName: "chat-ui",
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: props.callbackUrls ?? [
          "http://localhost:3000/api/auth/callback/cognito",
        ],
        logoutUrls: props.logoutUrls ?? ["http://localhost:3000"],
      },
      preventUserExistenceErrors: true,
    });

    const domainPrefix =
      props.cognitoDomainPrefix ??
      (this.node.tryGetContext("cognitoDomainPrefix") as string | undefined) ??
      `agent-health-${stack.account}`;

    this.userPoolDomain = this.userPool.addDomain("HostedUiDomain", {
      cognitoDomain: { domainPrefix },
    });

    this.hostedUiDomainName = `${domainPrefix}.auth.${stack.region}.amazoncognito.com`;
  }
}
