import { headers } from "next/headers";
import { z } from "zod";

import {
  AccessAuthenticationError,
  authenticateAccessHeaders,
} from "@/lib/server/auth";
import { generateInvoicePdf } from "@/lib/server/invoice-delivery";
import { getInvoice } from "@/lib/server/invoices";
import { PdfRenderError } from "@/lib/server/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PdfRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: PdfRouteContext) {
  let identity;
  try {
    identity = await authenticateAccessHeaders(await headers());
  } catch (error) {
    if (error instanceof AccessAuthenticationError) {
      return new Response("Authentication required", {
        status: error.status,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
    return new Response("Authentication unavailable", { status: 500 });
  }

  const { id } = await context.params;
  const invoiceId = z.string().uuid().safeParse(id);
  if (!invoiceId.success) return new Response("Not found", { status: 404 });

  const invoice = await getInvoice(invoiceId.data);
  if (!invoice) return new Response("Not found", { status: 404 });
  if (invoice.status === "draft" || !invoice.snapshot) {
    return new Response("Finalize the invoice before generating its PDF", {
      status: 409,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  try {
    const pdf = await generateInvoicePdf(invoice, {
      type: "owner",
      id: identity.email,
    });
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdf.filename}"`,
        "Content-Length": String(pdf.buffer.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      "Invoice PDF generation failed",
      error instanceof PdfRenderError
        ? { code: error.code }
        : {
            code: "unexpected",
            name: error instanceof Error ? error.name : "UnknownError",
            message:
              error instanceof Error
                ? error.message.slice(0, 300)
                : "Unknown PDF generation failure",
          },
    );
    return new Response("Invoice PDF could not be generated", {
      status: 500,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
