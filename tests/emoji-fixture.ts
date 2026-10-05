import { deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, checksum]);
}

// A real, decodable 1×1 pink RGBA PNG with CRCs, shared by API and browser tests.
const dimensions = Buffer.alloc(13);
dimensions.writeUInt32BE(1, 0);
dimensions.writeUInt32BE(1, 4);
dimensions[8] = 8;
dimensions[9] = 6;
export const emojiPng = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", dimensions),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 120, 255]))),
  chunk("IEND", Buffer.alloc(0)),
]);
