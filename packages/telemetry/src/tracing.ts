import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

export interface TracingOptions {
  readonly serviceName: string;
  readonly otlpEndpoint?: string;
  readonly enabled?: boolean;
}

export interface TracingHandle {
  shutdown(): Promise<void>;
}

/**
 * Initialize OpenTelemetry. Heavy SDK modules are imported lazily so services
 * that run with tracing disabled (tests, CLI) pay nothing.
 */
export async function initTracing(options: TracingOptions): Promise<TracingHandle> {
  const endpoint = options.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (options.enabled === false || !endpoint) {
    return { shutdown: async () => {} };
  }

  const [{ NodeSDK }, { OTLPTraceExporter }, { getNodeAutoInstrumentations }] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/auto-instrumentations-node'),
  ]);

  const sdk = new NodeSDK({
    serviceName: options.serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}

/** Run fn inside a span; records exceptions and error status before rethrow. */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const tracer = trace.getTracer('surfgen');
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}
