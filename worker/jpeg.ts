// JPEG checks for uploaded photos. The browser already re-encodes photos (which drops
// location data); this is a second line of defence in case a photo arrives unprocessed.

/** True if the bytes start like a JPEG file. */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Returns a copy of the JPEG without metadata segments: APP1-APP15 (EXIF, including GPS
 * location, XMP and others) and comments. Returns null if the file structure is broken.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (!looksLikeJpeg(bytes)) return null;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;

  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1] ?? 0;

    // Fill bytes between segments.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Start of scan: the image data follows, up to the end of the file.
    if (marker === 0xda) {
      kept.push(bytes.subarray(i));
      break;
    }
    // Markers with no length field.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xd8) {
      kept.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xd9) {
      kept.push(bytes.subarray(i, i + 2));
      break;
    }

    if (i + 3 >= bytes.length) return null;
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (length < 2 || i + 2 + length > bytes.length) return null;

    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) kept.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }

  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
