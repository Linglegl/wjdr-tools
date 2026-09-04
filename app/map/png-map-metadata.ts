const PNG_MAP_DATA_KEY = "WJDR_MAP_DATA";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const MAX_PNG_MAP_DATA_BYTES = 1024 * 1024;
const MAX_PNG_CHUNKS = 2048;

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value,
  );
}

function pngChunkType(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset + 4],
    bytes[offset + 5],
    bytes[offset + 6],
    bytes[offset + 7],
  );
}

function assertPng(bytes: Uint8Array) {
  if (
    bytes.length < PNG_SIGNATURE.length ||
    PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    throw new Error("not-png");
  }
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertChunkCrc(bytes: Uint8Array, offset: number, dataEnd: number) {
  const expected = readUint32(bytes, dataEnd);
  const actual = crc32(bytes.subarray(offset + 4, dataEnd));
  if (expected !== actual) throw new Error("invalid-png-crc");
}

export function embedMapDataInPng(png: Uint8Array, json: string) {
  assertPng(png);
  let iendOffset = -1;
  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  while (offset + 12 <= png.length) {
    chunkCount += 1;
    if (chunkCount > MAX_PNG_CHUNKS) throw new Error("too-many-png-chunks");
    const length = readUint32(png, offset);
    const dataEnd = offset + 8 + length;
    const nextOffset = dataEnd + 4;
    if (nextOffset > png.length) throw new Error("invalid-png");
    assertChunkCrc(png, offset, dataEnd);
    if (pngChunkType(png, offset) === "IEND") {
      iendOffset = offset;
      break;
    }
    offset = nextOffset;
  }
  if (iendOffset < 0) throw new Error("invalid-png");

  const encoder = new TextEncoder();
  const keyword = encoder.encode(PNG_MAP_DATA_KEY);
  const text = encoder.encode(json);
  if (text.length > MAX_PNG_MAP_DATA_BYTES) {
    throw new Error("map-data-too-large");
  }
  const payload = new Uint8Array(keyword.length + 5 + text.length);
  payload.set(keyword, 0);
  payload.set(text, keyword.length + 5);

  const type = encoder.encode("iTXt");
  const chunk = new Uint8Array(payload.length + 12);
  writeUint32(chunk, 0, payload.length);
  chunk.set(type, 4);
  chunk.set(payload, 8);
  writeUint32(
    chunk,
    payload.length + 8,
    crc32(chunk.subarray(4, 8 + payload.length)),
  );

  const result = new Uint8Array(png.length + chunk.length);
  result.set(png.subarray(0, iendOffset), 0);
  result.set(chunk, iendOffset);
  result.set(png.subarray(iendOffset), iendOffset + chunk.length);
  return result;
}

export function extractMapDataFromPng(png: Uint8Array) {
  assertPng(png);
  const decoder = new TextDecoder();
  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  while (offset + 12 <= png.length) {
    chunkCount += 1;
    if (chunkCount > MAX_PNG_CHUNKS) throw new Error("too-many-png-chunks");
    const length = readUint32(png, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;
    if (nextOffset > png.length) throw new Error("invalid-png");
    assertChunkCrc(png, offset, dataEnd);
    const type = pngChunkType(png, offset);
    if (type === "iTXt") {
      if (length > MAX_PNG_MAP_DATA_BYTES + 256) {
        throw new Error("map-data-too-large");
      }
      const data = png.subarray(dataStart, dataEnd);
      const keywordEnd = data.indexOf(0);
      if (
        keywordEnd > 0 &&
        decoder.decode(data.subarray(0, keywordEnd)) === PNG_MAP_DATA_KEY
      ) {
        if (keywordEnd + 5 > data.length) throw new Error("invalid-itxt");
        const compressionFlag = data[keywordEnd + 1];
        const compressionMethod = data[keywordEnd + 2];
        let cursor = keywordEnd + 3;
        const languageEnd = data.indexOf(0, cursor);
        if (
          compressionFlag !== 0 ||
          compressionMethod !== 0 ||
          languageEnd < 0
        ) {
          return null;
        }
        cursor = languageEnd + 1;
        const translatedKeywordEnd = data.indexOf(0, cursor);
        if (translatedKeywordEnd < 0) return null;
        const text = data.subarray(translatedKeywordEnd + 1);
        if (text.length > MAX_PNG_MAP_DATA_BYTES) {
          throw new Error("map-data-too-large");
        }
        return decoder.decode(text);
      }
    }
    if (type === "IEND") break;
    offset = nextOffset;
  }
  return null;
}
