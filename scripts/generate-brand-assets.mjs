import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const logo = await readFile(new URL('../public/branding/nembestil-bold.svg', import.meta.url), 'utf8');
const n = logo.match(/<g id="nem"[^>]*>\s*<path d="([^"]+)"/)[1];
const ball = logo.match(/<path d="([^"]+)" id="Shape"/)[1];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>Nem Bold</title><rect width="64" height="64" rx="13" fill="#121812"/><path d="${n}" transform="translate(5 20) scale(.25)" fill="#D3ED67"/><path d="${ball}" transform="translate(29 13.6) scale(.3)" fill="#fff"/></svg>\n`;
const target = new URL('../public/', import.meta.url);
await writeFile(new URL('favicon.svg', target), svg);
for (const [filename, size] of [['favicon-32x32.png', 32], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(filename, target).pathname);
}
// ICO entries can contain PNG images; include sizes used by browser tabs and shortcuts.
const entries = await Promise.all([16, 32, 48].map(size => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * entries.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach((png, index) => {
  const pos = 6 + index * 16;
  header[pos] = header[pos + 1] = [16, 32, 48][index];
  header.writeUInt16LE(1, pos + 4);
  header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(png.length, pos + 8);
  header.writeUInt32LE(offset, pos + 12);
  offset += png.length;
});
await writeFile(new URL('favicon.ico', target), Buffer.concat([header, ...entries]));
console.log('Favicon, PNG icons and Apple touch icon generated from the original logo.');
