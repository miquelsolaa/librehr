export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export interface FileValidationResult {
  valid: boolean;
  sanitizedFilename: string;
  error?: string | undefined;
}

const FALLBACK_FILENAME = "unnamed_document";

// Strips any directory part and every character outside [a-zA-Z0-9._-], so
// the result is safe to use as the last segment of a storage key. Returns
// null when nothing usable is left.
function stripFilename(filename: string): string | null {
  const sanitized = filename
    .replace(/^.*[\\/]/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 150);
  return !sanitized || sanitized === "." || sanitized === ".."
    ? null
    : sanitized;
}

/**
 * Makes a client-supplied filename safe to embed in a storage key: no
 * directory part, no traversal, only `[a-zA-Z0-9._-]`, at most 150 chars.
 *
 * @example
 * sanitizeDocumentFilename("../../etc/2026-05 nómina.pdf"); // "2026-05_n_mina.pdf"
 * sanitizeDocumentFilename(".."); // "unnamed_document"
 */
export function sanitizeDocumentFilename(filename: string): string {
  return stripFilename(filename) ?? FALLBACK_FILENAME;
}

/**
 * Validates file MIME type, size limit, and sanitizes filenames to prevent path traversal.
 */
export function validateDocumentFile(
  filename: string,
  mimeType: string,
  sizeBytes: number,
): FileValidationResult {
  // 1. Sanitize filename: strip directory traversal and dangerous characters
  const sanitizedFilename = stripFilename(filename);

  if (sanitizedFilename === null) {
    return {
      valid: false,
      sanitizedFilename: FALLBACK_FILENAME,
      error: "Invalid filename",
    };
  }

  // 2. MIME type check
  if (!ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
    return {
      valid: false,
      sanitizedFilename,
      error: `Unsupported file type: ${mimeType}. Allowed types: PDF, PNG, JPEG, WebP, DOCX.`,
    };
  }

  // 3. File size check
  if (sizeBytes <= 0 || sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      sanitizedFilename,
      error: `File size exceeds the 15 MB limit (size: ${Math.round(sizeBytes / 1024)} KB).`,
    };
  }

  return {
    valid: true,
    sanitizedFilename,
  };
}
