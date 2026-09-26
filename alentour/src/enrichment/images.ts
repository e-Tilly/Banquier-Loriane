/**
 * Uploaded photos: identify the format from the bytes (never the filename or the browser's
 * claim), read the dimensions, and strip metadata. Phone photos carry GPS coordinates in EXIF;
 * published unstripped, a photo taken at home tells everyone where the owner lives
 * (docs/alentour/07, "Strip EXIF on every upload").
 *
 * The one EXIF field worth keeping is Orientation: phones store pictures sideways and rely on
 * it, so stripping it would publish rotated photos. JPEGs get a minimal EXIF block holding only
 * that tag.
 *
 * Pure byte manipulation, no native image library: the formats phones and browsers upload are
 * JPEG, PNG and WebP. (iOS converts HEIC to JPEG for browser uploads.)
 */

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export interface ProcessedImage { type: ImageType; ext: string; bytes: Buffer; width: number | null; height: number | null }

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function sniff(buf: Buffer): ImageType | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function processImage(input: Buffer): ProcessedImage {
  if (input.length > MAX_IMAGE_BYTES) throw new Error("too_large");
  const type = sniff(input);
  if (type === "image/jpeg") return { type, ext: "jpg", ...stripJpeg(input) };
  if (type === "image/png") return { type, ext: "png", ...stripPng(input) };
  if (type === "image/webp") return { type, ext: "webp", ...stripWebp(input) };
  throw new Error("unsupported_format");
}

// ------------------------------------------------------------------ JPEG

function stripJpeg(buf: Buffer): { bytes: Buffer; width: number | null; height: number | null } {
  const out: Buffer[] = [buf.subarray(0, 2)];
  let orientation: number | null = null;
  let width: number | null = null, height: number | null = null;
  let i = 2;
  let wroteOrientation = false;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error("corrupt_jpeg");
    const marker = buf[i + 1]!;
    if (marker === 0xff) { i++; continue; }                        // fill byte
    if (marker === 0xd9) { out.push(buf.subarray(i, i + 2)); break; }
    if (marker >= 0xd0 && marker <= 0xd7) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    const payload = buf.subarray(i + 4, i + 2 + len);

    if (marker === 0xda) {                                          // start of scan: rest is image data
      if (!wroteOrientation && orientation && orientation !== 1) out.splice(1, 0, orientationApp1(orientation));
      out.push(buf.subarray(i));
      return { bytes: Buffer.concat(out), width, height };
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) { height = payload.readUInt16BE(1); width = payload.readUInt16BE(3); }

    if (marker === 0xe1) {                                          // EXIF / XMP: drop, remember orientation
      if (payload.toString("latin1", 0, 6) === "Exif\0\0") orientation = readOrientation(payload.subarray(6)) ?? orientation;
    } else if (marker === 0xed || marker === 0xfe) {
      // Photoshop IRB (IPTC, can hold a location) and comments: drop.
    } else if (marker === 0xe2 && payload.toString("latin1", 0, 11) !== "ICC_PROFILE") {
      // APP2 that is not a colour profile (FlashPix etc.): drop.
    } else {
      out.push(seg);
      if (marker === 0xe0 && !wroteOrientation && orientation && orientation !== 1) { out.push(orientationApp1(orientation)); wroteOrientation = true; }
    }
    i += 2 + len;
  }
  return { bytes: Buffer.concat(out), width, height };
}

/** Read tag 0x0112 from a TIFF structure. */
export function readOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const le = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > tiff.length) return null;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}

/** An APP1 segment with a TIFF header and one IFD entry: Orientation. Nothing else. */
export function orientationApp1(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);   // tag
  tiff.writeUInt16BE(3, 12);        // SHORT
  tiff.writeUInt32BE(1, 14);        // count
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22);        // no next IFD
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

// ------------------------------------------------------------------ PNG

const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(buf: Buffer): { bytes: Buffer; width: number | null; height: number | null } {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8, width: number | null = null, height: number | null = null;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new Error("corrupt_png");
    if (type === "IHDR") { width = buf.readUInt32BE(i + 8); height = buf.readUInt32BE(i + 12); }
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return { bytes: Buffer.concat(out), width, height };
}

// ------------------------------------------------------------------ WebP

function stripWebp(buf: Buffer): { bytes: Buffer; width: number | null; height: number | null } {
  const chunks: Buffer[] = [];
  let i = 12, width: number | null = null, height: number | null = null;
  while (i + 8 <= buf.length) {
    const type = buf.toString("latin1", i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > buf.length) throw new Error("corrupt_webp");
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === "VP8X") {
      width = 1 + data.readUIntLE(4, 3); height = 1 + data.readUIntLE(7, 3);
      const copy = Buffer.from(buf.subarray(i, end));
      copy[8] = copy[8]! & ~0x0c;                                   // clear the EXIF and XMP flags
      chunks.push(copy);
    } else if (type === "EXIF" || type === "XMP ") {
      // drop
    } else {
      if (type === "VP8 " && width == null && data.length >= 10) { width = data.readUInt16LE(6) & 0x3fff; height = data.readUInt16LE(8) & 0x3fff; }
      if (type === "VP8L" && width == null && data.length >= 5) {
        const bits = data.readUInt32LE(1);
        width = (bits & 0x3fff) + 1; height = ((bits >> 14) & 0x3fff) + 1;
      }
      chunks.push(buf.subarray(i, end));
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length + 4, 4);
  head.write("WEBP", 8, "latin1");
  return { bytes: Buffer.concat([head, body]), width, height };
}
