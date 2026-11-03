import { zlibSync } from 'fflate';
import { mkdir, writeFile } from 'node:fs/promises';

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]); let crc = -1;
  for (const byte of content) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ -1) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
await mkdir('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const scan = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x + .5) / size - .5, ny = (y + .5) / size - .5;
    const inside = Math.hypot(Math.max(0, Math.abs(nx) - .28), Math.max(0, Math.abs(ny) - .28)) < .20;
    let distance = 1;
    for (let ray = 0; ray < 8; ray++) {
      const angle = ray * Math.PI / 4; const dx = Math.cos(angle), dy = Math.sin(angle);
      const t = Math.max(.04, Math.min(.29, nx * dx + ny * dy)); distance = Math.min(distance, Math.hypot(nx - dx * t, ny - dy * t));
    }
    const stroke = distance < .022 || Math.hypot(nx, ny) < .05;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    scan[offset] = stroke ? 166 : 20; scan[offset + 1] = stroke ? 237 : 30; scan[offset + 2] = stroke ? 202 : 42; scan[offset + 3] = inside ? 255 : 0;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(`public/icon/${size}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', Buffer.from(zlibSync(scan))), chunk('IEND', Buffer.alloc(0))]));
}
console.log('Generated reproducible local Synapse icons.');
