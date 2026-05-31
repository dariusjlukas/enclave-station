import DOMPurify from 'dompurify';

/**
 * Sanitize a server-provided search snippet. ts_headline only adds <mark>
 * highlight tags around matches; everything else must be treated as text.
 */
export function sanitizeSnippet(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['mark'],
    ALLOWED_ATTR: [],
  });
}
