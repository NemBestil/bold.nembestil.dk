import { describe, expect, it } from "vitest";
import { bindCanvasLabel } from "../game/rendering/CanvasAccessibility";

function element(id = "") {
  const attributes = new Map<string, string>();
  return {
    id,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  } as unknown as HTMLCanvasElement;
}

describe("translated table canvas names", () => {
  it("follows the live container label without retaining a stale language", () => {
    const canvas = element();
    const container = element("table-view");
    canvas.setAttribute("aria-label", "Old label");
    container.setAttribute("aria-label", "Live table viewed from above");
    bindCanvasLabel(canvas, container);
    expect(canvas.getAttribute("aria-label")).toBeNull();
    expect(canvas.getAttribute("aria-labelledby")).toBe(container.id);
    container.setAttribute("aria-label", "Canlı masanın üstten görünümü");
    expect(canvas.getAttribute("aria-labelledby")).toBe("table-view");
    expect(container.getAttribute("aria-label")).toBe("Canlı masanın üstten görünümü");
  });

  it("updates the reference when the phone host moves its one canvas", () => {
    const canvas = element();
    const staging = element();
    bindCanvasLabel(canvas, staging);
    expect(canvas.getAttribute("aria-label")).toBe("Nem Bold");
    const controller = element();
    controller.setAttribute("aria-label", "Live bord set ovenfra");
    bindCanvasLabel(canvas, controller);
    const firstId = controller.id;
    expect(firstId).not.toBe("");
    bindCanvasLabel(canvas, controller);
    expect(controller.id).toBe(firstId);
    expect(canvas.getAttribute("aria-labelledby")).toBe(firstId);
    const other = element();
    other.setAttribute("aria-label", "Replay table");
    bindCanvasLabel(canvas, other);
    expect(canvas.getAttribute("aria-labelledby")).toBe(other.id);
    expect(other.id).not.toBe(firstId);
    bindCanvasLabel(canvas, staging);
    expect(canvas.getAttribute("aria-labelledby")).toBeNull();
    expect(canvas.getAttribute("aria-label")).toBe("Nem Bold");
  });
});
