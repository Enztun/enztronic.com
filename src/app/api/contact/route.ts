import 'server-only';

import { randomUUID } from 'node:crypto';
import { createClient } from 'next-sanity';
import { NextRequest, NextResponse } from 'next/server';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FORM_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_FORM_AGE_MS = 1_500;

const SERVICE_VALUES = new Set([
  'automation',
  'saas',
  'integration',
  'website',
  'branding',
  'seo',
  'ads',
  'unknown',
]);
const BUDGET_VALUES = new Set([
  'under_1k',
  '1k_5k',
  '5k_15k',
  'above_15k',
  'prefer_not',
]);
const TIME_VALUES = new Set(['morning', 'afternoon', 'evening']);

type ContactInput = {
  name: string;
  email: string;
  company?: string;
  service?: string;
  budget?: string;
  message?: string;
  preferredTime?: string;
  country?: string;
  website?: string;
  startedAt?: number;
};

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function readLimitedJson(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get('content-type')?.split(';', 1)[0].trim();
  if (contentType !== 'application/json') {
    throw new RequestError(415, 'Content-Type must be application/json');
  }

  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new RequestError(400, 'Invalid Content-Length');
    }
    if (bytes > MAX_BODY_BYTES) {
      throw new RequestError(413, 'Request body is too large');
    }
  }

  if (!req.body) {
    throw new RequestError(400, 'Request body is required');
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
        throw new RequestError(413, 'Request body is too large');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'Request body must be valid UTF-8');
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestError(400, 'Request body must be valid JSON');
  }
}

function requiredString(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number
) {
  if (typeof value !== 'string') {
    throw new RequestError(400, `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new RequestError(
      400,
      `${field} must be between ${minLength} and ${maxLength} characters`
    );
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new RequestError(400, `${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new RequestError(400, `${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function optionalEnum(value: unknown, field: string, allowed: Set<string>) {
  const normalized = optionalString(value, field, 40);
  if (normalized && !allowed.has(normalized)) {
    throw new RequestError(400, `${field} is not a supported value`);
  }
  return normalized;
}

function validateInput(value: unknown): ContactInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400, 'Request body must be an object');
  }

  const input = value as Record<string, unknown>;
  const name = requiredString(input.name, 'Name', 2, 100);
  const email = requiredString(input.email, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError(400, 'Email must be valid');
  }

  if (
    input.startedAt !== undefined &&
    (typeof input.startedAt !== 'number' || !Number.isFinite(input.startedAt))
  ) {
    throw new RequestError(400, 'Invalid form timestamp');
  }

  return {
    name,
    email,
    company: optionalString(input.company, 'Company', 120),
    service: optionalEnum(input.service, 'Service', SERVICE_VALUES),
    budget: optionalEnum(input.budget, 'Budget', BUDGET_VALUES),
    message: optionalString(input.message, 'Message', 4_000),
    preferredTime: optionalEnum(input.preferredTime, 'Preferred time', TIME_VALUES),
    country: optionalString(input.country, 'Country', 80),
    website: optionalString(input.website, 'Website', 200),
    startedAt: input.startedAt as number | undefined,
  };
}

function isLikelyBot(input: ContactInput) {
  if (input.website) return true;
  if (input.startedAt === undefined) return false;
  const age = Date.now() - input.startedAt;
  return age < MIN_FORM_AGE_MS || age > MAX_FORM_AGE_MS;
}

export async function POST(req: NextRequest) {
  try {
    const input = validateInput(await readLimitedJson(req));

    // Return the normal response so automated submitters do not learn which trap fired.
    if (isLikelyBot(input)) return json({ success: true });

    const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
    const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
    const token = process.env.SANITY_API_TOKEN;
    if (!projectId || !dataset || !token) {
      console.error('[contact] Sanity writer is not configured');
      return json({ error: 'Contact service is temporarily unavailable' }, 503);
    }

    const writer = createClient({
      projectId,
      dataset,
      apiVersion: '2024-01-01',
      token,
      useCdn: false,
    });

    await writer.create({
      // Draft IDs are not readable by anonymous clients, even in a public dataset.
      _id: `drafts.inquiry-${randomUUID()}`,
      _type: 'inquiry',
      name: input.name,
      email: input.email,
      ...(input.company && { company: input.company }),
      ...(input.service && { service: input.service }),
      ...(input.budget && { budget: input.budget }),
      ...(input.message && { message: input.message }),
      ...(input.preferredTime && { preferredTime: input.preferredTime }),
      ...(input.country && { country: input.country }),
      status: 'new',
      submittedAt: new Date().toISOString(),
    });

    return json({ success: true });
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message }, error.status);
    }
    console.error('[contact] Failed to store inquiry');
    return json({ error: 'Contact service is temporarily unavailable' }, 503);
  }
}
