import 'server-only';

import { randomUUID } from 'node:crypto';
import { createClient } from 'next-sanity';

/**
 * Validation and persistence for inbound inquiries, shared by every surface
 * that can create one: the contact form and the site chat agent.
 *
 * It lives here rather than in the route so the chat agent's `submit_inquiry`
 * tool goes through exactly the same checks as the form. A second copy of these
 * rules would drift, and the copy the language model talks to is the last one
 * that should be the lenient one.
 */

/**
 * Accepted `service` values. Wider than the dropdown in `inquiryType.ts`:
 * 'seo', 'ads', and 'unknown' predate the current list and are still accepted
 * so older cached form bundles do not start failing. New surfaces should send
 * one of the five the schema lists.
 */
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

const BUDGET_VALUES = new Set(['under_1k', '1k_5k', '5k_15k', 'above_15k', 'prefer_not']);
const TIME_VALUES = new Set(['morning', 'afternoon', 'evening']);

/** The subset the chat agent is allowed to choose from — matches the CMS dropdown. */
export const CHAT_SERVICE_VALUES = [
  'website',
  'automation',
  'saas',
  'branding',
  'integration',
] as const;
export const CHAT_BUDGET_VALUES = [...BUDGET_VALUES] as const;
export const CHAT_TIME_VALUES = [...TIME_VALUES] as const;

const MAX_FORM_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_FORM_AGE_MS = 1_500;

/** Where the inquiry came from, so sales can tell the surfaces apart later. */
export type InquirySource = 'form' | 'chat';

export type InquiryInput = {
  name: string;
  email: string;
  company?: string;
  service?: string;
  budget?: string;
  message?: string;
  preferredTime?: string;
  country?: string;
  /** Honeypot. Present only on form submissions. */
  website?: string;
  /** Epoch ms the form was rendered. Present only on form submissions. */
  startedAt?: number;
};

export class InquiryError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function requiredString(value: unknown, field: string, minLength: number, maxLength: number) {
  if (typeof value !== 'string') {
    throw new InquiryError(400, `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new InquiryError(
      400,
      `${field} must be between ${minLength} and ${maxLength} characters`
    );
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new InquiryError(400, `${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new InquiryError(400, `${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function optionalEnum(value: unknown, field: string, allowed: Set<string>) {
  const normalized = optionalString(value, field, 40);
  if (normalized && !allowed.has(normalized)) {
    throw new InquiryError(400, `${field} is not a supported value`);
  }
  return normalized;
}

export function validateInquiry(value: unknown): InquiryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InquiryError(400, 'Request body must be an object');
  }

  const input = value as Record<string, unknown>;
  const name = requiredString(input.name, 'Name', 2, 100);
  const email = requiredString(input.email, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InquiryError(400, 'Email must be valid');
  }

  if (
    input.startedAt !== undefined &&
    (typeof input.startedAt !== 'number' || !Number.isFinite(input.startedAt))
  ) {
    throw new InquiryError(400, 'Invalid form timestamp');
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

/**
 * Form-only heuristics: a filled honeypot, or a submission that arrived too
 * fast or from a page left open for a week. Chat submissions carry neither
 * signal, so this returns false for them.
 */
export function isLikelyBot(input: InquiryInput) {
  if (input.website) return true;
  if (input.startedAt === undefined) return false;
  const age = Date.now() - input.startedAt;
  return age < MIN_FORM_AGE_MS || age > MAX_FORM_AGE_MS;
}

export function isInquiryWriterConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SANITY_PROJECT_ID &&
      process.env.NEXT_PUBLIC_SANITY_DATASET &&
      process.env.SANITY_API_TOKEN
  );
}

export async function createInquiry(input: InquiryInput, source: InquirySource) {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
  const token = process.env.SANITY_API_TOKEN;
  if (!projectId || !dataset || !token) {
    throw new InquiryError(503, 'Contact service is temporarily unavailable');
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
    source,
    status: 'new',
    submittedAt: new Date().toISOString(),
  });
}
