import { Fn, RemovalPolicy, Stack } from "aws-cdk-lib";
import { StateChangeEvent } from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as osis from "aws-cdk-lib/aws-osis";
import { Construct } from "constructs";

export interface IngestionConstructProps {
  readonly domain: opensearch.Domain;
}

export class IngestionConstruct extends Construct {
  public readonly pipelineRole: iam.Role;
  public readonly pipeline: osis.CfnPipeline;
  public readonly ingestionEndpoint: string;

  constructor(scope: Construct, id: string, props: IngestionConstructProps) {
    super(scope, id);
    const region = Stack.of(this).region;

    this.pipelineRole = new iam.Role(this, "PipelineRole", {
      assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com"),
      inlinePolicies: {
        permissions: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["es:ESHttp*"],
              resources: [`${props.domain.domainArn}/*`],
            }),
            new iam.PolicyStatement({
              actions: ["es:DescribeDomain"],
              resources: [props.domain.domainArn],
            }),
            new iam.PolicyStatement({
              actions: [
                "servicediscovery:ListInstances",
                "servicediscovery:DiscoverInstances",
                "servicediscovery:DiscoverInstancesRevision",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    const pipelineName = "otel-pipeline"

    const logGroup = new logs.LogGroup(this, "PipelineLogs", {
      logGroupName: `/aws/vendedlogs/OpenSearchIngestion/${pipelineName}/audit-logs`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });


    this.pipeline = new osis.CfnPipeline(this, "OTel", {
      pipelineName,
      minUnits: 1,
      maxUnits: 2,
      logPublishingOptions: {
        isLoggingEnabled: true,
        cloudWatchLogDestination: {
          logGroup: logGroup.logGroupName,
        },
      },

      pipelineConfigurationBody: `
        version: '2'

        # Main OTLP pipeline - receives all telemetry and routes by signal type. Metrics are left out for brevity. 
        # See https://docs.aws.amazon.com/opensearch-service/latest/developerguide/observability-ingestion.html for a full example.
        otlp-pipeline:
          source:
            otlp:
              logs_path: '/v1/logs'
              traces_path: '/v1/traces'
              metrics_path: '/v1/metrics'
          route:
            - logs: 'getEventType() == "LOG"'
            - traces: 'getEventType() == "TRACE"'
          processor: []
          sink:
            - pipeline:
                name: otel-logs-pipeline
                routes:
                  - logs
            - pipeline:
                name: otel-traces-raw-pipeline
                routes:
                  -  traces

        otel-logs-pipeline:
          source:
            pipeline:
              name: otlp-pipeline
          processor:
            - copy_values:
                entries:
                  - from_key: "time"
                    to_key: "@timestamp"
          sink:
            - opensearch:
                hosts:
                  - 'https://${props.domain.domainEndpoint}'
                index_type: log-analytics-plain
                aws:
                  serverless: false
                  region: ${region}
                  sts_role_arn: ${this.pipelineRole.roleArn}

        otel-traces-raw-pipeline:
          source:
            pipeline:
              name: otlp-pipeline
          processor:
            - otel_traces:
          sink:
            - opensearch:
                hosts:
                  - 'https://${props.domain.domainEndpoint}'
                index_type: trace-analytics-plain-raw
                aws:
                  serverless: false
                  region: ${region}
                  sts_role_arn: ${this.pipelineRole.roleArn}
`
    });

    this.ingestionEndpoint = `https://${Fn.select(0, this.pipeline.attrIngestEndpointUrls)}`;
  }
}
