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

/**
 * Validates file MIME type, size limit, and sanitizes filenames to prevent path traversal.
 */
export function validateDocumentFile(
  filename: string,
  mimeType: string,
  sizeBytes: number,
): FileValidationResult {
  // 1. Sanitize filename: strip directory traversal and dangerous characters
  const baseName = filename.replace(/^.*[\\/]/, "");
  const sanitizedFilename = baseName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 150);

  if (
    !sanitizedFilename ||
    sanitizedFilename === "." ||
    sanitizedFilename === ".."
  ) {
    return {
      valid: false,
      sanitizedFilename: "unnamed_document",
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
