/** Stable public anchors, independent of translated titles and CMS labels. */
export const SERVICE_LINKS = [
  { id: 'automation', service: 'automation' },
  { id: 'platforms', service: 'saas' },
  { id: 'websites', service: 'website' },
  { id: 'brand', service: 'branding' },
  { id: 'growth', service: 'unknown' },
  { id: 'strategy', service: 'unknown' },
] as const;

export function serviceEnquiry(index: number) {
  const item = SERVICE_LINKS[index];
  return item
    ? `/contact?service=${item.service}&context=${item.id}`
    : '/contact';
}
