import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Buckets tuned for AI/render workloads: 50ms API calls to 10-minute renders. */
export const DURATION_BUCKETS_SECONDS = [
  0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600,
];

export interface MetricsOptions {
  readonly service: string;
  readonly defaultMetrics?: boolean;
}

/**
 * Wrapper over prom-client with idempotent metric creation — modules can
 * declare the metrics they use without coordinating a central list.
 */
export class MetricsRegistry {
  readonly registry: Registry;
  private readonly counters = new Map<string, Counter<string>>();
  private readonly gauges = new Map<string, Gauge<string>>();
  private readonly histograms = new Map<string, Histogram<string>>();

  constructor(options: MetricsOptions) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: options.service });
    if (options.defaultMetrics) {
      collectDefaultMetrics({ register: this.registry });
    }
  }

  counter(name: string, help: string, labelNames: string[] = []): Counter<string> {
    const existing = this.counters.get(name);
    if (existing) return existing;
    const counter = new Counter({ name, help, labelNames, registers: [this.registry] });
    this.counters.set(name, counter);
    return counter;
  }

  gauge(name: string, help: string, labelNames: string[] = []): Gauge<string> {
    const existing = this.gauges.get(name);
    if (existing) return existing;
    const gauge = new Gauge({ name, help, labelNames, registers: [this.registry] });
    this.gauges.set(name, gauge);
    return gauge;
  }

  histogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets: number[] = DURATION_BUCKETS_SECONDS,
  ): Histogram<string> {
    const existing = this.histograms.get(name);
    if (existing) return existing;
    const histogram = new Histogram({ name, help, labelNames, buckets, registers: [this.registry] });
    this.histograms.set(name, histogram);
    return histogram;
  }

  // --- pre-declared platform metrics -------------------------------------

  jobsProcessed(): Counter<string> {
    return this.counter('surfgen_jobs_processed_total', 'Pipeline jobs processed', [
      'stage',
      'status',
    ]);
  }

  jobDuration(): Histogram<string> {
    return this.histogram('surfgen_job_duration_seconds', 'Pipeline job duration', ['stage']);
  }

  providerLatency(): Histogram<string> {
    return this.histogram('surfgen_provider_latency_seconds', 'AI provider call latency', [
      'provider',
      'capability',
    ]);
  }

  providerFailures(): Counter<string> {
    return this.counter('surfgen_provider_failures_total', 'AI provider call failures', [
      'provider',
      'capability',
    ]);
  }

  /** Prometheus exposition format for /metrics endpoints. */
  metricsText(): Promise<string> {
    return this.registry.metrics();
  }
}
