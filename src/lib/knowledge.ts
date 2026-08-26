import 'server-only';

import { client } from '@/sanity/lib/client';

/**
 * Builds the knowledge base the chat agent answers from.
 *
 * The whole site is roughly 2.5k tokens of copy per locale, which is small
 * enough to sit in a cached system prompt. That beats giving the agent a search
 * tool: one API call per turn instead of two, no retrieval to get wrong, and no
 * place to inject a query into a GROQ string.
 *
 * Two properties matter and are easy to break:
 *
 *  - **Published only.** Inquiries are stored as `drafts.inquiry-*` documents in
 *    the same dataset. The default client has no token and no draft perspective,
 *    and the query is pinned to `page`/`post`, so customer PII cannot reach the
 *    model. Do not swap this for `sanityFetch`, which honours draft mode.
 *  - **Byte-stable.** Prompt caching is a prefix match, so any reordering or
 *    timestamp in here silently drops the cache hit rate to zero. Documents are
 *    sorted by `_id` and nothing derived from the clock goes in.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/** Facts that are not in the CMS. Kept short; the CMS copy carries the detail. */
const BRAND_FACTS = `Enztronic is a digital studio. Services: websites and digital
products, AI automation, SaaS and platforms, brand and product systems, and
system integration.
Contact email: enztun@enztronic.com
WhatsApp: +62 8963 7579 728
The site is published in English, Indonesian, and Chinese.`;

type KnowledgeDoc = {
  _id: string;
  _type: string;
  title: string | null;
  slug: string | null;
  language: string | null;
  body: string | null;
  modules: unknown;
};

const knowledgeQuery = `
  *[_type in ["page", "post"] && language == $locale] | order(_id asc) {
    _id,
    _type,
    title,
    "slug": slug.current,
    language,
    "body": pt::text(body),
    modules
  }
`;

/** Keys that carry structure rather than prose. */
const SKIP_KEYS = new Set(['_type', '_key', '_ref', '_id', 'asset', 'icon', 'theme', 'hotspot']);

/** Pulls the human-readable strings out of a page-builder module tree. */
function flattenText(value: unknown, into: string[]) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Asset refs are noise. Real URLs are not: the portfolio entries carry the
    // client site addresses, and the agent should be able to name them.
    if (trimmed.length > 2 && !/^(image-|file-)[a-zA-Z0-9]{8,}/.test(trimmed)) {
      into.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) flattenText(entry, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) continue;
      flattenText(entry, into);
    }
  }
}

function renderDoc(doc: KnowledgeDoc): string {
  const parts: string[] = [];
  const heading = doc.slug ? `${doc.title ?? doc.slug} (/${doc.slug})` : (doc.title ?? doc._id);
  parts.push(`## ${heading}`);

  const collected: string[] = [];
  if (doc.body) collected.push(doc.body.trim());
  flattenText(doc.modules, collected);

  // De-duplicate: page builders repeat labels across modules and the repetition
  // adds tokens without adding information.
  const seen = new Set<string>();
  for (const line of collected) {
    if (seen.has(line)) continue;
    seen.add(line);
    parts.push(line);
  }
  return parts.join('\n');
}

let cache: { locale: string; text: string; builtAt: number } | null = null;

export async function getKnowledgeBase(locale: string): Promise<string> {
  const now = Date.now();
  if (cache && cache.locale === locale && now - cache.builtAt < CACHE_TTL_MS) {
    return cache.text;
  }

  let docs: KnowledgeDoc[] = [];
  try {
    docs = await client.fetch<KnowledgeDoc[]>(knowledgeQuery, { locale });
  } catch {
    // A CMS outage should degrade the agent to brand facts only, not 500 the chat.
    console.error('[chat] Knowledge base fetch failed; falling back to brand facts');
  }

  const text = [BRAND_FACTS, ...docs.map(renderDoc)].join('\n\n');
  cache = { locale, text, builtAt: now };
  return text;
}
