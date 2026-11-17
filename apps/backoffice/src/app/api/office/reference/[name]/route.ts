import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireAdminSession } from '@/lib/server/session';
import { officeError, officeHeaders, officeJson } from '@/lib/server/office-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const allowed = new Set(['adrian.png', 'clara.png', 'nadia.png', 'leo.png', 'lisa.png', 'sam.png', 'theo.png']);

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    await requireAdminSession();
    const { name } = await context.params;
    if (!allowed.has(name)) return officeJson({ error: 'Reference not found' }, 404);
    const bytes = await readFile(join(process.cwd(), 'office-spec', 'visuals', 'reference', name));
    return new Response(bytes, { headers: { ...officeHeaders, 'Content-Type': 'image/png' } });
  } catch (error) { return officeError(error); }
}
