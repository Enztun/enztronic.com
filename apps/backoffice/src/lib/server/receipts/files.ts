import { createHash } from "node:crypto";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_NOTE_LENGTH = 1000;

export type ReceiptContentType = "image/png" | "image/jpeg" | "image/webp" | "application/pdf";

export interface ValidatedReceiptFile {
  bytes: Uint8Array;
  contentType: ReceiptContentType;
  extension: "png" | "jpg" | "webp" | "pdf";
  fileName: string;
  sha256: string;
}

export class ReceiptInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptInputError";
  }
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);

/** The file type comes from its first bytes only; the browser's claim and the name are ignored. */
export function sniffContentType(bytes: Uint8Array): ReceiptContentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" } as const;

/** A display name only: never used as a storage path. */
export function safeFileName(name: string, extension: string): string {
  const base = name
    .normalize("NFKC")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^\p{L}\p{N} ._()-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .slice(0, 120);
  return `${base || "receipt"}.${extension}`;
}

export function validateReceiptFile(name: string, bytes: Uint8Array): ValidatedReceiptFile {
  if (bytes.byteLength === 0) throw new ReceiptInputError("Choose a screenshot or PDF of the receipt.");
  if (bytes.byteLength > MAX_RECEIPT_BYTES) throw new ReceiptInputError("The file is larger than 5 MB. Crop the screenshot or export a smaller PDF.");
  const contentType = sniffContentType(bytes);
  if (!contentType) throw new ReceiptInputError("Only PNG, JPEG, WebP screenshots or PDF files can be read.");
  const extension = EXTENSIONS[contentType];
  return {
    bytes,
    contentType,
    extension,
    fileName: safeFileName(name, extension),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function normalizeNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.replace(/\r\n?/g, "\n").trim();
  if (!note) return null;
  if (note.length > MAX_NOTE_LENGTH) throw new ReceiptInputError(`Keep the note under ${MAX_NOTE_LENGTH} characters.`);
  return note;
}
