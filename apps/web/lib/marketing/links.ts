/**
 * Canonical GitHub repository for the open-source project.
 *
 * Kept in one place because the marketing surface links to it from the nav,
 * the pricing CTA and three footer entries — when it was duplicated inline,
 * every copy carried the same wrong org and all five links 404'd together.
 */
export const GITHUB_REPO_URL = 'https://github.com/BbgnsurfTech/SurfGen';

/** Deep link to a file on the repository's default branch. */
export function githubBlobUrl(path: string): string {
  return `${GITHUB_REPO_URL}/blob/main/${path}`;
}

/** Anchor link into the repository README. */
export function githubReadmeAnchor(anchor: string): string {
  return `${GITHUB_REPO_URL}#${anchor}`;
}
