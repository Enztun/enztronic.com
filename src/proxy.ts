import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Exclude _next, _vercel, studio, meteora sub-app, and static files
  matcher: ['/((?!_next|_vercel|studio|meteora|.*\\..*).*)'],
};
