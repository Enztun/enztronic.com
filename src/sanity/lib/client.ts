import { createClient } from 'next-sanity'

export const client = createClient({
  projectId: '7k9f0gp3',
  dataset: 'production',
  apiVersion: '2025-08-13',
  useCdn: true
})
