import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { createQrImage } from "../app/utils/qrCode";

describe("invitation QR images", () => {
  it.each([
    "https://bold.nembestil.dk/?session=nf-test-123",
    "https://bold.nembestil.dk/?session=nf-12345678-1234-5678-9012-123456789012",
  ])("renders a vector QR with transparent background and a complete quiet zone for %s", async url => {
    const image = await createQrImage(url);
    expect(image.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const svg = decodeURIComponent(image.slice(image.indexOf(",") + 1));
    const size = QRCode.create(url, { errorCorrectionLevel: "M" }).modules.size + 8;
    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('stroke="#182018"');
    expect(svg).not.toMatch(/<rect|<image|\sfill=|png/i);
    expect(svg.match(/<path\b/g)).toHaveLength(1);
  });
});
