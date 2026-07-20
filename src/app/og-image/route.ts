import { ImageResponse } from 'next/og';
import { OpenGraphCard, openGraphImageSize } from '@/components/seo/OpenGraphCard';

export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(OpenGraphCard(), openGraphImageSize);
}
