#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { AgentObservabilityStack } from "../lib/agent-observability-stack";

const app = new App();

new AgentObservabilityStack(app, "AgentObservabilityStack", {
    env: {
        region: "us-east-1",
    },
    description: "Sample agent deployment that streams its observability signals into OpenSearch",
});
