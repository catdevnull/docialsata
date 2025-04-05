import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import type { Env, MiddlewareHandler } from 'hono';
import {
  SpanKind,
  SpanStatusCode,
  type Tracer,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import type { Logger } from 'pino';
import {
  ConsoleLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
const pino = require('pino');

const authHeaders = {
  Authorization: `Bearer ${process.env.AXIOM_API_TOKEN}`,
  'X-Axiom-Dataset': process.env.AXIOM_DATASET_NAME!,
};

// Initialize OTLP trace exporter with the endpoint URL and headers
const traceExporter = new OTLPTraceExporter({
  url: 'https://api.axiom.co/v1/traces',
  headers: authHeaders,
});
const logRecordExporter = new OTLPLogExporter({
  url: 'https://api.axiom.co/v1/logs',
  headers: authHeaders,
});

// Configuring the OpenTelemetry Node SDK
const sdk = new NodeSDK({
  serviceName: 'docial',
  spanProcessors: [
    new SimpleSpanProcessor(traceExporter),
    // new SimpleSpanProcessor(new ConsoleSpanExporter()),
  ],
  logRecordProcessors: [
    // new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()),
    new SimpleLogRecordProcessor(logRecordExporter),
  ],

  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-pino': { enabled: true },
    }),
    new FetchInstrumentation(),
  ],
});

// Starting the OpenTelemetry SDK to begin collecting telemetry data
sdk.start();

export const logger: Logger = pino({
  level: 'debug',
});
logger.info('Tracing initialized');

let rawTracer: Tracer | undefined;
export const opentelemetryMiddleware =
  (): MiddlewareHandler<Env> => async (c, next) => {
    // if (!otel) {
    //   try {
    //     await next();
    //     if (ctx.error) {
    //       logger.error({ error: ctx.error.message });
    //     }
    //   } catch (error) {
    //     logger.error({
    //       error: error instanceof Error ? error.message : 'unknown error',
    //     });
    //     throw error;
    //   }
    //   return;
    // }

    if (!rawTracer) {
      rawTracer = trace.getTracer('docial', '0.0.0');
    }

    const name = c.req.matchedRoutes[c.req.matchedRoutes.length - 1].path;

    const span = rawTracer.startSpan(
      `${c.req.method} ${name}`,
      {
        attributes: {
          'http.method': c.req.method,
          'http.url': c.req.url,
          'http.authorization': c.req.header('Authorization'),
        },
        kind: SpanKind.SERVER,
      },
      propagation.extract(context.active(), c.req.raw.headers),
    );

    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        await next();
      });
      if (c.error) {
        logger.error({ error: c.error.message });
        span.recordException(c.error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: c.error.message,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'unknown error',
      });
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'unknown error',
      });
      throw error;
    }
    span.end();
  };
