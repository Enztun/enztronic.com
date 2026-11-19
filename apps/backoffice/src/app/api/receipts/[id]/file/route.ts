import { headers } from "next/headers";
import { z } from "zod";

import { AccessAuthenticationError, authenticateAccessHeaders } from "@/lib/server/auth";
import { getPrivateObject } from "@/lib/server/r2";
import { getReceiptRepository } from "@/lib/server/receipts/service";
import { AuthorizationError, getSessionUser, requireAdmin } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReceiptFileContext {
  params: Promise<{ id: string }>;
}

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

/** The uploaded receipt, inline for the review page. Admins only. */
export async function GET(_request: Request, context: ReceiptFileContext) {
  try {
    await authenticateAccessHeaders(await headers());
    requireAdmin(await getSessionUser());
  } catch (error) {
    if (error instanceof AccessAuthenticationError) {
      return new Response("Authentication required", { status: error.status, headers: privateHeaders });
    }
    if (error instanceof AuthorizationError) return new Response("Forbidden", { status: 403, headers: privateHeaders });
    return new Response("Authentication unavailable", { status: 500, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404, headers: privateHeaders });
  const receipt = await getReceiptRepository().get(id);
  if (!receipt) return new Response("Not found", { status: 404, headers: privateHeaders });

  let object: Awaited<ReturnType<typeof getPrivateObject>>;
  try {
    object = await getPrivateObject(receipt.fileKey);
  } catch {
    return new Response("Receipt storage is unavailable", { status: 502, headers: privateHeaders });
  }
  if (!object) return new Response("Receipt file is missing", { status: 404, headers: privateHeaders });

  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      ...privateHeaders,
      // The type recorded at upload came from the file's own bytes, never the browser.
      "Content-Type": receipt.contentType,
      "Content-Length": String(object.body.byteLength),
      "Content-Disposition": `inline; filename="${receipt.ledgerId}.${receipt.fileName.split(".").pop() ?? "bin"}"`,
      // Images opened directly can never run as this origin. PDFs are left to the
      // browser's own sandboxed viewer, as invoice PDFs are; a sandbox CSP blocks it.
      ...(receipt.contentType.startsWith("image/")
        ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }
        : {}),
    },
  });
}
