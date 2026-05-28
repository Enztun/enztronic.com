import { draftMode } from 'next/headers';
import type { QueryParams } from 'next-sanity';
import { client, previewClient } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sanityFetch<T = any>({
  query,
  params = {},
}: {
  query: string;
  params?: QueryParams;
}): Promise<T> {
  const { isEnabled } = await draftMode();
  const fetchClient = isEnabled ? previewClient : client;
  return fetchClient.fetch<T>(query, params);
}
