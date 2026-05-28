import { createClient } from 'next-sanity';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
const apiVersion = '2024-01-01';

export const client = createClient({
  projectId: projectId ?? 'unconfigured',
  dataset,
  apiVersion,
  useCdn: true,
});

export const previewClient = createClient({
  projectId: projectId ?? 'unconfigured',
  dataset,
  apiVersion,
  useCdn: false,
  token: process.env.SANITY_API_TOKEN,
  perspective: 'previewDrafts',
  stega: {
    enabled: true,
    studioUrl: '/studio',
  },
});

export const isSanityConfigured = Boolean(projectId);
