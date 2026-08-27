/**
 * Express AG-UI server for the retail assistant agent.
 *
 * The same application code runs in two interface modes selected by the
 * `AGENT_INTERFACE_MODE` environment variable:
 *
 * - `local` (default): serves the AG-UI handler on `POST /` at port 8000 for
 *   local development (no tracing), alongside `GET /health` and `GET /ping`.
 * - `agentcore`: satisfies the Amazon Bedrock AgentCore Runtime contract by
 *   serving on port 8080 with the AG-UI handler on `POST /invocations` and the
 *   required `GET /ping` endpoint.
 *
 * Strands `agent.stream()` events are bridged to AG-UI text-message events,
 * with the <answer>-tag streaming filter applied so the client only ever sees
 * the customer-facing answer body (never <thinking> reasoning).
 */

import { randomUUID } from 'node:crypto';

import { EventType, type Message, type RunAgentInput } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import type { MessageData } from '@strands-agents/sdk';
import express, { type Request, type Response } from 'express';
import { context, propagation, type Context, type Span } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import { createAgent } from './agent.js';
import { AnswerTagStreamFilter, stripThinkingAndAnswerTags } from './answer-filter.js';
import { AGENTCORE_MODE, resolveInterfaceMode, resolvePort } from './interface-mode.js';
import { SigV4OtlpTraceExporter, httpTracesUrl } from './otel-export.js';

const AGENT_INTERFACE_MODE = resolveInterfaceMode(process.env);
const PORT = resolvePort(process.env, AGENT_INTERFACE_MODE);

// --- OpenTelemetry setup -----------------------------------------------------
// In agentcore mode, export SigV4-signed OTLP/HTTP to OSIS. In local mode no
// exporter is attached, so tracing no-ops. Region and credentials are resolved
// by the AWS provider chains inside the exporter — nothing needs to be passed in.
//
const BAGGAGE_RUN_ID = 'agent_health.run.id';

/**
 * Stamps the run id (carried in baggage on the request context, set in
 * agentEndpoint) onto EVERY span at start. Agent Health correlates a run to its
 * traces by `agent_health.run.id == runId`, and its query returns only spans
 * carrying that attribute — so the whole trajectory (model + tool + cycle
 * spans), not just the root agent span, must be tagged for the evaluator to
 * work. Reading from baggage keeps concurrent requests isolated.
 */
class RunIdSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    const runId = propagation.getBaggage(parentContext)?.getEntry(BAGGAGE_RUN_ID)?.value;
    if (runId) span.setAttribute(BAGGAGE_RUN_ID, runId);
  }
  onEnd(): void { }
  async forceFlush(): Promise<void> { }
  async shutdown(): Promise<void> { }
}

const spanProcessors: SpanProcessor[] = [];

if (AGENT_INTERFACE_MODE === AGENTCORE_MODE) {
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  if (!endpoint) {
    console.warn('OTel disabled: OTEL_EXPORTER_OTLP_ENDPOINT is unset; no traces will be exported to OSIS.');
  } else {
    spanProcessors.push(new RunIdSpanProcessor());
    spanProcessors.push(new BatchSpanProcessor(new SigV4OtlpTraceExporter(endpoint)));
    console.info(`OTel enabled: exporting SigV4-signed traces to ${httpTracesUrl(endpoint)}`);
  }
}

const tracerProvider = new NodeTracerProvider({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'retail-agent' }),
  spanProcessors,
});
tracerProvider.register();

// --- AG-UI agent endpoint ----------------------------------------------------

const app = express();
app.use(express.json({ limit: '5mb' }));

// CORS (mirrors the prior permissive demo config).
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

/** Flatten an AG-UI message's content to plain text. */
function messageText(message: Message): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && 'text' in block && typeof block.text === 'string'
          ? block.text
          : '',
      )
      .join('');
  }
  return '';
}

/**
 * Map AG-UI history to Strands seed messages. Only plain user/assistant text
 * turns are kept; tool-call / tool-result blocks are dropped so the seeded
 * history is always internally consistent (an unmatched toolUse block makes
 * Bedrock reject the whole request). Assistant text is stripped of <thinking>
 * and <answer> wrappers so only the customer-facing prose seeds the context.
 */
function toSeedMessages(messages: Message[]): MessageData[] {
  const seed: MessageData[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text =
      message.role === 'assistant'
        ? stripThinkingAndAnswerTags(messageText(message))
        : messageText(message).trim();
    if (text) seed.push({ role: message.role, content: [{ text }] });
  }
  return seed;
}

/**
 * AG-UI agent endpoint. Streams the agent's reply as AG-UI text-message events,
 * applying the <answer>-tag filter so only the customer-facing body is emitted.
 *
 * A fresh, stateless agent is built per request and seeded from the full AG-UI
 * history (the client is the source of truth — the backend keeps no session
 * state). This keeps invocations isolated: an interrupted tool-using turn can't
 * leave a dangling toolUse that poisons later turns.
 *
 * Shared by `POST /` (local) and `POST /invocations` (agentcore); behavior is
 * identical regardless of the path used to invoke it.
 */
async function agentEndpoint(req: Request, res: Response): Promise<void> {
  const input = req.body as RunAgentInput;
  const encoder = new EventEncoder({ accept: req.headers.accept });
  const messages = input.messages ?? [];

  res.setHeader('Content-Type', encoder.getContentType());

  const messageId = randomUUID();
  const filter = new AnswerTagStreamFilter();
  let started = false;
  let rawText = '';

  const write = (event: Parameters<EventEncoder['encode']>[0]) => res.write(encoder.encode(event));

  try {
    write({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });

    // Seed prior turns; the latest user message is this turn's prompt.
    const history = toSeedMessages(messages);
    let promptText = '';
    if (history.length && history[history.length - 1].role === 'user') {
      const prompt = history.pop()!;
      const block = prompt.content[0];
      promptText = block && 'text' in block ? (block.text ?? '') : '';
    }

    // Fresh agent per request. The gen_ai.* attributes describe this turn on the
    // agent span; the run-id correlation Agent Health needs is stamped on ALL
    // spans by RunIdSpanProcessor (via the baggage set below), not here.
    const agent = createAgent(history, {
      'gen_ai.conversation.id': input.threadId || 'default',
      'gen_ai.request.id': input.runId || '',
    });

    // Correlation context for the agent's spans:
    //  - Strategy A: continue Agent Health's W3C trace context (traceparent) so
    //    spans share its traceId. Works when the header reaches us (e.g. local);
    //    AgentCore drops it in the cloud, so we also do Strategy B.
    //  - Strategy B: carry the run id in baggage so RunIdSpanProcessor stamps
    //    `agent_health.run.id` on every span (body-based, header-independent).
    let parentContext = propagation.extract(context.active(), req.headers);
    const baggage = (
      propagation.getBaggage(parentContext) ?? propagation.createBaggage()
    ).setEntry(BAGGAGE_RUN_ID, { value: input.runId || '' });
    parentContext = propagation.setBaggage(parentContext, baggage);
    await context.with(parentContext, async () => {
      for await (const event of agent.stream(promptText)) {
        // Keep draining after </answer> so the agent loop finishes cleanly (tool
        // results recorded, spans closed); we just stop *emitting* downstream.
        if (filter.done) continue;
        if (event.type !== 'modelStreamUpdateEvent') continue;
        const modelEvent = event.event;
        if (
          modelEvent.type !== 'modelContentBlockDeltaEvent' ||
          modelEvent.delta.type !== 'textDelta'
        ) {
          continue;
        }

        rawText += modelEvent.delta.text;
        const emit = filter.feed(modelEvent.delta.text);
        if (!emit) continue;

        if (!started) {
          write({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
          started = true;
        }
        write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: emit });
      }
    });

    if (started) {
      write({ type: EventType.TEXT_MESSAGE_END, messageId });
    } else {
      // The model didn't emit a well-formed <answer> block (it sometimes omits
      // the tags). Fall back to the full output with thinking/answer markup
      // stripped so the customer still gets a reply instead of an empty stream.
      const fallback = stripThinkingAndAnswerTags(rawText);
      if (fallback) {
        write({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
        write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: fallback });
        write({ type: EventType.TEXT_MESSAGE_END, messageId });
      }
    }

    write({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
  } catch (error) {
    write({
      type: EventType.RUN_ERROR,
      message: error instanceof Error ? error.message : String(error),
      code: 'PROCESSING_ERROR',
    });
  } finally {
    res.end();
  }
}

app.post('/', (req, res) => {
  void agentEndpoint(req, res);
});

// AgentCore Runtime contract path. Shares the handler verbatim with `POST /`.
app.post('/invocations', (req, res) => {
  void agentEndpoint(req, res);
});

app.get('/ping', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.info(`Retail agent listening on :${PORT} (mode: ${AGENT_INTERFACE_MODE})`);
});
