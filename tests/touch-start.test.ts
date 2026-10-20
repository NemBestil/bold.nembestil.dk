import { describe, expect, it } from "vitest";
import { isTouchDevice, joinSessionFromLink } from "../app/utils/touchStart";

describe("touch start and joining", () => {
  it("offers phone hosting on touch and coarse-pointer devices while keeping normal desktop hosting", () => {
    expect(isTouchDevice(5, false)).toBe(true);
    expect(isTouchDevice(0, true)).toBe(true);
    expect(isTouchDevice(0, false)).toBe(false);
  });
  it("extracts only a session from QR links or pasted room codes", () => {
    expect(joinSessionFromLink(" https://example.com/controller?session=nf-fixture-123 ")).toBe("nf-fixture-123");
    expect(joinSessionFromLink("http://192.168.1.20:3000/controller/?session=nf-fixture-123")).toBe("nf-fixture-123");
    expect(joinSessionFromLink("/app/controller?session=nf-fixture-123")).toBe("nf-fixture-123");
    expect(joinSessionFromLink("nf-fixture-123")).toBe("nf-fixture-123");
  });
  it.each(["", "https://example.com/", "javascript:alert(1)", "/controller?session=%0Ainvalid", "nf-" + "x".repeat(130)])("rejects missing or invalid session links: %s", (value) => {
    expect(joinSessionFromLink(value)).toBeNull();
  });
});
