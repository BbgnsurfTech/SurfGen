/** Large language model — chat-style, used for script generation, prompt
 *  enhancement, AI rewrite, and workflow LLM nodes. */
export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LLMInput {
  readonly messages: readonly LLMMessage[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** Ask for strict-JSON output; provider maps to its native mechanism. */
  readonly jsonSchema?: Record<string, unknown>;
}

export interface LLMOutput {
  readonly text: string;
  readonly finishReason: 'stop' | 'length' | 'content_filter' | 'error';
  readonly usage?: { promptTokens: number; completionTokens: number };
}

/** Translation */
export interface TranslationInput {
  readonly text: string;
  readonly sourceLanguage?: string; // auto-detect when omitted
  readonly targetLanguage: string;
  /** Formality where supported (DeepL etc.). */
  readonly formality?: 'default' | 'formal' | 'informal';
  /** Glossary terms that must not be translated (brand names). */
  readonly preserveTerms?: readonly string[];
}

export interface TranslationOutput {
  readonly text: string;
  readonly detectedSourceLanguage?: string;
}

/** Embeddings */
export interface EmbeddingsInput {
  readonly texts: readonly string[];
}

export interface EmbeddingsOutput {
  readonly vectors: readonly (readonly number[])[];
  readonly dimensions: number;
}
