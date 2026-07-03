import { ValidationError } from '../errors.js';
import type { Result } from '../result.js';
import { err, ok } from '../result.js';

/**
 * BCP-47-ish language tag value object: primary subtag (ISO 639-1) with an
 * optional region (ISO 3166-1 alpha-2), e.g. "en", "pt-BR".
 */
const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export class LanguageTag {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<LanguageTag, ValidationError> {
    const normalized = LanguageTag.normalize(raw);
    if (!LANGUAGE_TAG_PATTERN.test(normalized)) {
      return err(new ValidationError(`Invalid language tag: ${raw}`, { details: { raw } }));
    }
    return ok(new LanguageTag(normalized));
  }

  private static normalize(raw: string): string {
    const [primary, region] = raw.trim().replace('_', '-').split('-');
    const lower = (primary ?? '').toLowerCase();
    return region ? `${lower}-${region.toUpperCase()}` : lower;
  }

  /** Primary language subtag without region ("pt-BR" → "pt"). */
  get primary(): string {
    return this.value.split('-')[0] as string;
  }

  equals(other: LanguageTag): boolean {
    return this.value === other.value;
  }

  /** Same primary language regardless of region ("pt-BR" ≈ "pt-PT"). */
  matchesPrimary(other: LanguageTag): boolean {
    return this.primary === other.primary;
  }

  toString(): string {
    return this.value;
  }
}
