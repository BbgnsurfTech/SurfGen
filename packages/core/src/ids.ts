/**
 * Branded ID types. Structurally they are strings, but the brand prevents
 * accidentally passing a VideoId where a JobId is expected — a class of bug
 * the compiler can eliminate for free.
 */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type OrganizationId = Brand<string, 'OrganizationId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type VideoId = Brand<string, 'VideoId'>;
export type SceneId = Brand<string, 'SceneId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type TemplateId = Brand<string, 'TemplateId'>;
export type AvatarId = Brand<string, 'AvatarId'>;
export type VoiceId = Brand<string, 'VoiceId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type WorkflowRunId = Brand<string, 'WorkflowRunId'>;
export type JobId = Brand<string, 'JobId'>;
export type PipelineRunId = Brand<string, 'PipelineRunId'>;
export type ProviderId = Brand<string, 'ProviderId'>;
export type PluginId = Brand<string, 'PluginId'>;
export type WebhookId = Brand<string, 'WebhookId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;

/** Cast helper used at boundaries after format validation. */
export const asId = <T extends Brand<string, string>>(value: string): T => value as T;

/** Port: the domain never generates IDs itself — infrastructure provides the generator. */
export interface IdGeneratorPort {
  generate(): string;
}
