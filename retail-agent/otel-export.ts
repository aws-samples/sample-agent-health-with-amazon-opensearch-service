/**
 * SigV4-signing OTLP/HTTP span export to OpenSearch Ingestion (OSIS).
 *
 * The retail agent exports traces only in agentcore mode. The standard OTLP/HTTP
 * exporter sends static headers and cannot SigV4-sign (signing must cover the
 * serialized body), and OSIS rejects unsigned requests. This module provides a
 * custom SpanExporter that serializes spans to OTLP protobuf, SigV4-signs the
 * request (service "osis") with credentials/region from the AWS provider chain,
 * and POSTs via fetch.
 *
 * Protobuf (not JSON) is used deliberately: the OSIS `otlp` source only supports
 * Protobuf for OTLP/HTTP. With JSON, the source base64-decodes the spec-mandated
 * hex trace_id/span_id (proto3 `bytes` semantics), corrupting 16/8-byte IDs into
 * 24/12-byte values that overflow the `otel-v1-apm-span` `ignore_above: 32`
 * mapping and become unqueryable. Protobuf carries the IDs as raw binary, so
 * they round-trip correctly.
 */

import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
  NODE_REGION_CONFIG_FILE_OPTIONS,
  NODE_REGION_CONFIG_OPTIONS,
} from '@aws-sdk/region-config-resolver';
import { loadConfig } from '@smithy/node-config-provider';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';

const OTLP_TRACES_PATH = '/v1/traces';
const SIGV4_SERVICE = 'osis';

/**
 * Resolve the AWS region the same way every AWS SDK client does: the region
 * provider chain (AWS_REGION / AWS_DEFAULT_REGION → shared config → IMDS).
 * No region needs to be passed in or set explicitly by the caller.
 */
const regionProvider = loadConfig(
  NODE_REGION_CONFIG_OPTIONS,
  NODE_REGION_CONFIG_FILE_OPTIONS,
);

/** Append the OSIS OTLP traces path (`/v1/traces`) unless already present. */
export function httpTracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith(OTLP_TRACES_PATH) ? trimmed : trimmed + OTLP_TRACES_PATH;
}

/**
 * SpanExporter that SigV4-signs each OTLP/HTTP request to OSIS.
 *
 * Credentials and region both come from the AWS provider chains (env vars,
 * `~/.aws`, and the ECS/AgentCore container metadata endpoint), so nothing
 * needs to be passed in. Export becomes a no-op-with-error if signing fails,
 * mirroring the graceful degradation of the prior implementation.
 */
export class SigV4OtlpTraceExporter implements SpanExporter {
  private readonly url: string;
  private readonly host: string;
  private readonly credentials = fromNodeProviderChain();

  constructor(endpoint: string) {
    this.url = httpTracesUrl(endpoint);
    this.host = new URL(this.url).host;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const body = ProtobufTraceSerializer.serializeRequest(spans);
    if (!body) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    this.signAndSend(body)
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) => resultCallback({ code: ExportResultCode.FAILED, error }));
  }

  private async signAndSend(body: Uint8Array): Promise<void> {
    const region = await regionProvider();
    const signer = new SignatureV4({
      service: SIGV4_SERVICE,
      region,
      credentials: this.credentials,
      sha256: Sha256,
    });

    const url = new URL(this.url);
    const request = new HttpRequest({
      method: 'POST',
      protocol: url.protocol,
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'content-type': 'application/x-protobuf',
        host: this.host,
      },
      body,
    });

    const signed = await signer.sign(request);
    const res = await fetch(this.url, {
      method: 'POST',
      headers: signed.headers,
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OSIS export failed: HTTP ${res.status} ${res.statusText} ${text}`.trim());
    }
  }

  async shutdown(): Promise<void> { }

  async forceFlush(): Promise<void> { }
}
