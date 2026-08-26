import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { InquiryError, createInquiry, validateInquiry } from '@/lib/inquiry';
import { CONTACT_RULE, checkRateLimit, clientKey, rateLimitHeaders } from '@/lib/rate-limit';

/**
 * Writes an inquiry the visitor confirmed in the chat widget.
 *
 * This is a separate route from the agent on purpose. The agent proposes; a
 * person taps send; only then does anything reach Sanity. Keeping the write out
 * of the model's reach is what stops a prompt-injected conversation from filing
 * inquiries on its own.
 *
 * The payload is re-validated here rather than trusted from the previous
 * response — it round-tripped through the browser, and the browser is not a
 * place where validation holds.
 *
 * It shares CONTACT_RULE with the form on purpose: both create inquiries, so
 * using both surfaces should not buy anyone a second budget.
 */

const MAX_BODY_BYTES = 16 * 1024;

function json(data: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extra },
  });
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(clientKey(req), CONTACT_RULE);
  const limitHeaders = rateLimitHeaders(limit);
  if (!limit.ok) {
    return json({ error: 'Too many submissions. Please try again shortly.' }, 429, limitHeaders);
  }

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return json({ error: 'Request body is too large' }, 413, limitHeaders);
  }

  try {
    const input = validateInquiry(await req.json());
    await createInquiry(input, 'chat');
    return json({ success: true }, 200, limitHeaders);
  } catch (error) {
    if (error instanceof InquiryError) {
      if (error.status >= 500) console.error('[chat/confirm]', error.message);
      return json({ error: error.message }, error.status, limitHeaders);
    }
    console.error('[chat/confirm] Failed to store inquiry');
    return json({ error: 'Contact service is temporarily unavailable' }, 503, limitHeaders);
  }
}
