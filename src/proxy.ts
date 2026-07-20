import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Exclude framework internals, non-localized tools/routes, and static files.
  matcher: ['/((?!_next|_vercel|studio|meteora|api|og-image|.*\\..*).*)'],
};
