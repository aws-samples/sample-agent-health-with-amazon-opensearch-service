# Observing and Evaluating Production Agents using OpenSearch Agent Health

Companion code for the AWS blog post [Observing and evaluating production agents using OpenSearch Agent Health](https://aws.amazon.com/blogs/big-data/observing-and-evaluating-production-agents-using-opensearch-agent-health/). Follow the blog post for the full walkthrough (deploying, chatting with the agent, and running evaluations). This README summarizes what the repository contains.

> [!WARNING]
> **This is a sample project for demonstration and learning purposes only. It is not intended for use in production systems.** The infrastructure makes trade-offs for simplicity and cost (single-node OpenSearch domain, resources destroyed on teardown, simulated agent tools) that are not appropriate for production workloads. Review and harden security, availability, and data handling before adapting any part of it.

## Overview

A Strands retail agent deployed to Amazon Bedrock AgentCore Runtime, a static chat frontend on AWS Amplify, an OpenSearch trace pipeline, and configuration for running OpenSearch Agent Health locally against the deployed resources. Components communicate over the [AG-UI](https://github.com/ag-ui-protocol/ag-ui) protocol, and the agent emits OpenTelemetry traces.

## Components

- **Retail agent (`retail-agent/`)** — E-commerce agent built with the [Strands Agents SDK](https://github.com/strands-agents/sdk-typescript) (TypeScript). Exposes an AG-UI endpoint and runs in two modes: local HTTP (port 8000, no auth or tracing) and [Amazon Bedrock AgentCore Runtime](https://aws.amazon.com/bedrock/agentcore/) (containerized via `Dockerfile`). Uses Amazon Nova on [Amazon Bedrock](https://aws.amazon.com/bedrock/) (configurable via `MODEL_ID`) with six simulated tools: product search, inventory check, and cart add/update/remove/get. Emits messages, reasoning steps, and tool calls as OpenTelemetry traces.
- **Chat frontend (`chat-frontend/`)** — Static [Next.js](https://nextjs.org/) export hosted on [AWS Amplify](https://aws.amazon.com/amplify/). Calls the agent from the browser over AG-UI, authenticated with an [Amazon Cognito](https://aws.amazon.com/cognito/) JWT.
- **Agent Health (`agent-health/`)** — Configuration (`agent-health.config.ts`) wiring [OpenSearch Agent Health](https://github.com/opensearch-project/agent-health) to the deployed agent endpoint and OpenSearch domain from the CDK outputs, plus test cases and on-disk run data (`agent-health-data/`). Authenticates to the agent with a Cognito token and to OpenSearch with AWS SigV4.
- **Infrastructure (`infra/`)** — [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html) app (`AgentObservabilityStack`, `us-east-1`) provisioning the AgentCore runtime, an [Amazon OpenSearch Service](https://aws.amazon.com/opensearch-service/) domain, an [Amazon OpenSearch Ingestion](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ingestion.html) (OSIS) trace pipeline, Amplify hosting, Cognito, and the OpenSearch fine-grained-access-control role mappings.

## Repository structure

```
├── retail-agent/    # Strands retail agent (TypeScript, AG-UI); local + AgentCore modes
├── chat-frontend/   # Next.js static chat UI (Amplify-hosted, Cognito auth)
├── agent-health/    # OpenSearch Agent Health config, test cases, and local data
└── infra/           # AWS CDK stack (AgentCore, OpenSearch, OSIS, Amplify, Cognito)
```

## Learn more

- [Blog post: Observing and evaluating production agents using OpenSearch Agent Health](https://aws.amazon.com/blogs/big-data/observing-and-evaluating-production-agents-using-opensearch-agent-health/)
- [OpenSearch Agent Health](https://github.com/opensearch-project/agent-health)
- [Strands Agents SDK](https://github.com/strands-agents/sdk-typescript)
- [Observability for Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/observability.html)
