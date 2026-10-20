/** A scalable QR image whose quiet zone inherits the invitation card's color. */
export async function createQrImage(url: string): Promise<string> {
  const QRCode = await import("qrcode");
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#182018", light: "#00000000" },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
