import { describe, expect, test } from 'vitest';
import { GITHUB_REPO_URL, githubBlobUrl, githubReadmeAnchor } from './links';

describe('GITHUB_REPO_URL', () => {
  test('points at the BbgnsurfTech organisation that actually hosts the repo', () => {
    expect(GITHUB_REPO_URL).toBe('https://github.com/BbgnsurfTech/SurfGen');
  });

  test('has no trailing slash, so callers can append path segments safely', () => {
    expect(GITHUB_REPO_URL.endsWith('/')).toBe(false);
  });
});

describe('githubBlobUrl', () => {
  test('builds a default-branch blob link for a repo-relative path', () => {
    // Arrange
    const path = 'docs/roadmap.md';
    // Act
    const url = githubBlobUrl(path);
    // Assert
    expect(url).toBe('https://github.com/BbgnsurfTech/SurfGen/blob/main/docs/roadmap.md');
  });
});

describe('githubReadmeAnchor', () => {
  test('builds a README anchor link', () => {
    expect(githubReadmeAnchor('quick-start')).toBe(
      'https://github.com/BbgnsurfTech/SurfGen#quick-start',
    );
  });
});
