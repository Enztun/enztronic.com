/**
 * Real screenshots of client sites, keyed off the project's own URL so the
 * project data does not have to carry an image path in all three locale files.
 *
 * The allowlist is explicit rather than derived from the filesystem, because
 * pointing at a missing file would 404 on every page load before
 * `ImageWithFallback` could swap in its placeholder. Adding a project here is
 * a one-line change once its two WebPs land in `public/screenshots/`.
 *
 * Not captured, and why:
 *  - monopoleconsulting.com and berdirental.com sit behind a Cloudflare bot
 *    challenge that does not clear for an automated browser.
 *  - shortpro.co.id now redirects to shortmaxdl.github.io, an unrelated
 *    app-download page, so there is nothing of ours left there to show.
 */
const CAPTURED = new Set(['qianlima', 'acmobilmurah', 'salimberkatsejahtera']);

export type ScreenshotKind = 'laptop' | 'mobile';

const PLACEHOLDER: Record<ScreenshotKind, string> = {
  laptop: '/screenshots/placeholder-laptop.svg',
  mobile: '/screenshots/placeholder-mobile.svg',
};

/** `https://qianlima.co.id` -> `qianlima`. Returns '' for anything unparseable. */
function slugFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return '';
  }
}

/**
 * The screenshot for a project, or the shared placeholder when we do not have
 * one. Callers can render the result directly -- it is always a valid path.
 */
export function screenshotFor(url: string | undefined, kind: ScreenshotKind): string {
  const slug = url ? slugFor(url) : '';
  return CAPTURED.has(slug) ? `/screenshots/${slug}-${kind}.webp` : PLACEHOLDER[kind];
}

/** The flagship shot, used where the page speaks about the work in general. */
export const FEATURED_SCREENSHOT = '/screenshots/qianlima-laptop.webp';
