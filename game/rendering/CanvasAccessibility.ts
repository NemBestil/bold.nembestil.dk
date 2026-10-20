let canvasLabelId = 0;

/** Link the canvas to its translated Vue container so its name stays reactive. */
export function bindCanvasLabel(canvas: HTMLCanvasElement, container: HTMLElement) {
  if (container.getAttribute?.("aria-label")) {
    if (!container.id) container.id = `table-canvas-label-${++canvasLabelId}`;
    canvas.removeAttribute("aria-label");
    canvas.setAttribute("aria-labelledby", container.id);
  } else {
    canvas.removeAttribute("aria-labelledby");
    canvas.setAttribute("aria-label", "Nem Bold");
  }
}
