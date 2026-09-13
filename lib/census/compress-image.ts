/**
 * Browser-only: shrinks a photo to a JPEG of at most `maxBytes` (default 300 KB) by capping the
 * longest side and lowering quality. Forty lines instead of an unmaintained dependency.
 */
export async function compressImage(
  file: Blob,
  maxBytes = 300 * 1024,
  maxSide = 1280,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= maxBytes) return blob;
  }
  // Still too large: halve the dimensions and try again.
  const smaller = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.5),
  );
  if (!smaller) throw new Error("image encoding failed");
  return maxSide > 480 ? compressImage(smaller, maxBytes, Math.round(maxSide / 2)) : smaller;
}
