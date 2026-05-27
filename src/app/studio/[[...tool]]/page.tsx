'use client';

import dynamic from 'next/dynamic';
import config from '../../../../sanity.config';

const NextStudio = dynamic(
  () => import('next-sanity/studio').then((mod) => ({ default: mod.NextStudio })),
  { ssr: false }
);

export default function StudioPage() {
  return <NextStudio config={config} />;
}
