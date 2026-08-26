import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import {
  InquiryError,
  createInquiry,
  isLikelyBot,
  validateInquiry,
} from '@/lib/inquiry';
import {
  CONTACT_RULE,
  checkRateLimit,
  clientKey,
  rateLimitHeaders,
} from '@/lib/rate-limit';

const MAX_BODY_BYTES = 16 * 1024;

function json(
  data: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

async function readLimitedJson(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get('content-type')?.split(';', 1)[0].trim();
  if (contentType !== 'application/json') {
    throw new InquiryError(415, 'Content-Type must be application/json');
  }

  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new InquiryError(400, 'Invalid Content-Length');
    }
    if (bytes > MAX_BODY_BYTES) {
      throw new InquiryError(413, 'Request body is too large');
    }
  }

  if (!req.body) {
    throw new InquiryError(400, 'Request body is required');
  }

  const reader = req.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytesRead = 0;
  let raw = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InquiryError(413, 'Request body is too large');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof InquiryError) throw error;
    throw new InquiryError(400, 'Request body must be valid UTF-8');
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new InquiryError(400, 'Request body must be valid JSON');
  }
}

export async function POST(req: NextRequest) {
  // Checked before the body is read so a flood costs us a header lookup rather
  // than a parse and a Sanity round trip.
  const limit = checkRateLimit(clientKey(req), CONTACT_RULE);
  const limitHeaders = rateLimitHeaders(limit);
  if (!limit.ok) {
    return json({ error: 'Too many submissions. Please try again shortly.' }, 429, limitHeaders);
  }

  try {
    const input = validateInquiry(await readLimitedJson(req));

    // Return the normal response so automated submitters do not learn which trap fired.
    if (isLikelyBot(input)) return json({ success: true }, 200, limitHeaders);

    await createInquiry(input, 'form');
    return json({ success: true }, 200, limitHeaders);
  } catch (error) {
    if (error instanceof InquiryError) {
      if (error.status >= 500) console.error('[contact]', error.message);
      return json({ error: error.message }, error.status, limitHeaders);
    }
    console.error('[contact] Failed to store inquiry');
    return json({ error: 'Contact service is temporarily unavailable' }, 503, limitHeaders);
  }
}
