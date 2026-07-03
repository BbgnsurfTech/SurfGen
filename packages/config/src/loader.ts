import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import type { z } from 'zod';
import { ConfigurationError, type Result, err, ok } from '@surfgen/core';
import {
  AiConfigSchema,
  ModelsConfigSchema,
  ProvidersConfigSchema,
  StorageConfigSchema,
  VideoConfigSchema,
  type ConfigBundle,
} from './schemas.js';
import {
  DEFAULT_AI_CONFIG,
  DEFAULT_MODELS_CONFIG,
  DEFAULT_PROVIDERS_CONFIG,
  DEFAULT_STORAGE_CONFIG,
  DEFAULT_VIDEO_CONFIG,
} from './defaults.js';

const ENV_PREFIX = 'SURFGEN_';
const ENV_PATH_SEPARATOR = '__';

/** "true"/"false" → boolean, numeric strings → number, otherwise string. */
function coerceEnvValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/** Resolve a lower-cased env segment to an existing key's canonical casing. */
function resolveKey(target: Record<string, unknown>, segment: string): string {
  return Object.keys(target).find((key) => key.toLowerCase() === segment) ?? segment;
}

function setDeep(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = resolveKey(cursor, path[i] as string);
    const next = cursor[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[resolveKey(cursor, path[path.length - 1] as string)] = value;
}

/**
 * Apply SURFGEN_<SCOPE>__<PATH...>=value overrides. Example:
 *   SURFGEN_STORAGE__DRIVER=local           → storage: { driver: 'local' }
 *   SURFGEN_VIDEO__DEFAULTS__QUALITY=18     → video.defaults.quality = 18
 * Path segments are lower-cased; matching against config keys is
 * case-insensitive on the exact segment names.
 */
export function applyEnvOverrides(
  scope: string,
  data: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  const base = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const clone = structuredClone(base);
  const prefix = `${ENV_PREFIX}${scope.toUpperCase()}${ENV_PATH_SEPARATOR}`;
  for (const [key, raw] of Object.entries(env)) {
    if (raw === undefined || !key.startsWith(prefix)) continue;
    const path = key
      .slice(prefix.length)
      .split(ENV_PATH_SEPARATOR)
      .map((segment) => segment.toLowerCase());
    if (path.length === 0 || path.some((s) => s.length === 0)) continue;
    setDeep(clone, path, coerceEnvValue(raw));
  }
  return clone;
}

function parseFile(filePath: string): unknown {
  const text = readFileSync(filePath, 'utf8');
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return JSON.parse(text);
  if (ext === '.yaml' || ext === '.yml') return parseYaml(text);
  throw new ConfigurationError(`Unsupported config format: ${filePath}`);
}

export interface LoadOptions {
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Layered load: defaults → file → env overrides → schema validation.
 * Missing file is fine (defaults + env only). Invalid content is a
 * ConfigurationError with flattened zod issues in details.
 */
export function loadConfigFile<S extends z.ZodTypeAny>(
  scope: string,
  filePath: string | null,
  schema: S,
  defaults: z.infer<S>,
  options: LoadOptions = {},
): Result<z.infer<S>, ConfigurationError> {
  let fileData: unknown = {};
  if (filePath && existsSync(filePath)) {
    try {
      fileData = parseFile(filePath) ?? {};
    } catch (cause) {
      return err(
        new ConfigurationError(`Failed to parse ${filePath}: ${String(cause)}`, { cause }),
      );
    }
  }

  const merged = deepMerge(defaults as Record<string, unknown>, fileData as Record<string, unknown>);
  const withEnv = applyEnvOverrides(scope, merged, options.env);

  const parsed = schema.safeParse(withEnv);
  if (!parsed.success) {
    return err(
      new ConfigurationError(`Invalid ${scope} configuration`, {
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      }),
    );
  }
  return ok(parsed.data);
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const SCOPES = [
  { scope: 'ai', file: 'ai.yaml', schema: AiConfigSchema, defaults: DEFAULT_AI_CONFIG },
  {
    scope: 'providers',
    file: 'providers.json',
    schema: ProvidersConfigSchema,
    defaults: DEFAULT_PROVIDERS_CONFIG,
  },
  { scope: 'models', file: 'models.yaml', schema: ModelsConfigSchema, defaults: DEFAULT_MODELS_CONFIG },
  {
    scope: 'storage',
    file: 'storage.yaml',
    schema: StorageConfigSchema,
    defaults: DEFAULT_STORAGE_CONFIG,
  },
  { scope: 'video', file: 'video.yaml', schema: VideoConfigSchema, defaults: DEFAULT_VIDEO_CONFIG },
] as const;

/** Load the full typed bundle from a config directory. */
export function loadAll(
  configDir: string,
  options: LoadOptions = {},
): Result<ConfigBundle, ConfigurationError> {
  const bundle: Partial<Record<string, unknown>> = {};
  for (const { scope, file, schema, defaults } of SCOPES) {
    const result = loadConfigFile(scope, join(configDir, file), schema, defaults, options);
    if (!result.ok) return result;
    bundle[scope] = result.value;
  }
  return ok(bundle as unknown as ConfigBundle);
}

export interface WatchHandle {
  close(): Promise<void>;
}

/**
 * Watch a config file; onChange fires only with a VALID new config — an
 * invalid edit keeps the last good config and reports through onError.
 */
export function watchConfigFile<S extends z.ZodTypeAny>(
  scope: string,
  filePath: string,
  schema: S,
  defaults: z.infer<S>,
  onChange: (config: z.infer<S>) => void,
  onError: (error: ConfigurationError) => void,
  options: LoadOptions = {},
): WatchHandle {
  const watcher: FSWatcher = chokidarWatch(filePath, { ignoreInitial: true });
  const reload = () => {
    const result = loadConfigFile(scope, filePath, schema, defaults, options);
    if (result.ok) onChange(result.value);
    else onError(result.error);
  };
  watcher.on('change', reload);
  watcher.on('add', reload);
  return { close: () => watcher.close() };
}
