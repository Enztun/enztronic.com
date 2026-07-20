/**
 * Retired on 2026-07-20.
 *
 * The previous seed deleted all localized page documents before recreating
 * them from stale marketing copy. That could erase Studio edits and restore
 * unsupported claims. Use the revision-checked, non-destructive migration:
 *
 *   node scripts/patch-rebrand-seo.mjs
 *   node scripts/patch-rebrand-seo.mjs --apply
 */

throw new Error(
  'Destructive page seeding is disabled. Use scripts/patch-rebrand-seo.mjs instead.'
);
