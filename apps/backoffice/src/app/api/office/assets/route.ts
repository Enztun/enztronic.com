import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireAdminSession } from '@/lib/server/session';
import { officeError, officeHeaders, officeJson } from '@/lib/server/office-http';
import registry from '@/components/office/scene-assets.generated.json';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ApprovedAsset = { id: string; url: string; sha256: string };

/** Private, hash-pinned allowlist only. Never serves native source files. */
export async function GET(request: Request) {
  try {
    await requireAdminSession();
    const filename = new URL(request.url).searchParams.get('file');
    const asset = (registry.assets as ApprovedAsset[]).find((entry) => new URL(entry.url, 'http://office.invalid').searchParams.get('file') === filename);
    if (!filename || !asset || !/^assets\/office\/[a-z0-9/_-]+\.glb$/.test(filename) || !/^[a-f0-9]{64}$/.test(asset.sha256)) return officeJson({ error: 'Validated model not found' }, 404);
    // Static private boundary also keeps deployment file tracing out of env/config files.
    const root = await realpath(path.join(process.cwd(), 'office-assets'));
    const resolved = await realpath(path.resolve(root, filename));
    if (!resolved.startsWith(root + path.sep)) return officeJson({ error: 'Validated model not found' }, 404);
    const details = await stat(resolved);
    if (!details.isFile() || details.size > 32 * 1024 * 1024) return officeJson({ error: 'Model failed its bounded delivery check' }, 409);
    const bytes = await readFile(resolved);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) return officeJson({ error: 'Model changed after validation; rerun asset approval' }, 409);
    return new Response(new Uint8Array(bytes), { headers: { ...officeHeaders, 'Content-Type': 'model/gltf-binary', 'Content-Length': String(bytes.length) } });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return officeJson({ error: 'Validated model file is missing' }, 404);
    return officeError(error);
  }
}
