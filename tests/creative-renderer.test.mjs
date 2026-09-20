import assert from "node:assert/strict";
import test from "node:test";

import { createProject } from "../src/lib/creative/project.ts";
import { dimensionsForFormat, drawCreative, layerRect, renderCreative } from "../src/lib/creative/renderer.ts";

function fakeContext() {
  const calls = [];
  const context = {
    calls,
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    clearRect(...args) { calls.push(["clearRect", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    createLinearGradient(...args) {
      const gradient = { stops: [], addColorStop(offset, color) { this.stops.push({ offset, color }); } };
      calls.push(["createLinearGradient", ...args, gradient]);
      return gradient;
    },
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    beginPath() { calls.push(["beginPath"]); },
    rect(...args) { calls.push(["rect", ...args]); },
    clip() { calls.push(["clip"]); },
    translate(...args) { calls.push(["translate", ...args]); },
    rotate(...args) { calls.push(["rotate", ...args]); },
    drawImage(...args) { calls.push(["drawImage", ...args]); },
    measureText(value) { return { width: String(value).length * 10 }; },
    fillText(...args) { calls.push(["fillText", ...args]); },
  };
  return context;
}

function fakeCanvas() {
  const context = fakeContext();
  return {
    width: 0,
    height: 0,
    context,
    getContext() { return context; },
  };
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

test("format dimensions and normalized transforms are exact and stable", () => {
  assert.deepEqual(dimensionsForFormat("card"), { width: 1080, height: 1350 });
  assert.deepEqual(dimensionsForFormat("banner"), { width: 1920, height: 1080 });
  assert.deepEqual(layerRect({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 }, 1080, 1350), {
    x: 270,
    y: 135,
    width: 540,
    height: 540,
  });
});

test("preview renderer paints independent assets and returns exact target dimensions", async () => {
  const project = createProject({ id: "render_test", format: "card" });
  const canvas = fakeCanvas();
  const result = await renderCreative(project, {
    background: { width: 1600, height: 900 },
    athlete: { width: 1200, height: 1600 },
    logo: { width: 400, height: 200 },
  }, { canvas });
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1350);
  const images = [
    { width: 1600, height: 900 },
    { width: 1200, height: 1600 },
    { width: 400, height: 200 },
  ];
  assert.deepEqual(canvas.context.calls.filter(([name]) => name === "drawImage").map(([, image]) => image), images);
  assert.ok(canvas.context.calls.some(([name]) => name === "fillText"));
});

test("format scrim sits between the background and supplied athlete pixels", () => {
  const project = createProject({ id: "scrim_test", format: "banner" });
  const context = fakeContext();
  drawCreative(project, context, {
    background: { width: 1600, height: 900 },
    athlete: { width: 1200, height: 1600 },
  }, "banner");
  const calls = context.calls.map(([name]) => name);
  const backgroundDraw = calls.indexOf("drawImage");
  const scrim = calls.indexOf("createLinearGradient");
  const scrimFill = calls.findIndex((name, index) => index > scrim && name === "fillRect");
  const athleteDraw = calls.indexOf("drawImage", backgroundDraw + 1);
  assert.ok(backgroundDraw >= 0);
  assert.ok(scrim > backgroundDraw);
  assert.ok(scrimFill > scrim);
  assert.ok(athleteDraw > scrimFill);
  assert.deepEqual(context.calls[scrim].slice(0, 5), ["createLinearGradient", 0, 0, 1920, 0]);
});

test("the same draw function used by preview exposes deterministic text and layer results", () => {
  const project = createProject({ id: "render_test", format: "banner", event: { name: "A very long event name that still fits", date: "June 14", location: "Seattle", callToAction: "Join us" } });
  const context = fakeContext();
  const result = drawCreative(project, context, {
    athlete: { width: 1200, height: 1600 },
  }, "banner");
  assert.deepEqual(result.drawnLayers, ["athlete"]);
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.ok(result.textLines["event-name"].length >= 1);
  assert.ok(result.textLines["event-name"][0].length > 0);
});

test("font readiness is awaited for every layout family before pixels are painted", async () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const loads = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { fonts: { load: async (descriptor) => { loads.push(descriptor); }, ready: Promise.resolve() } },
  });
  try {
    await renderCreative(createProject({ id: "font_test" }), {}, { canvas: fakeCanvas() });
    assert.equal(loads.length, 4);
    assert.ok(loads.every((descriptor) => descriptor.includes("General Sans")));
  } finally {
    restoreGlobal("document", previousDocument);
  }
});

test("a newer render owns a shared target when an older asset decode finishes later", async () => {
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  class DelayedImage {
    naturalWidth = 1200;
    naturalHeight = 1600;
    onload;
    onerror;
    set src(value) {
      this.url = value;
      setTimeout(() => this.onload?.(), value.includes("slow") ? 20 : 0);
    }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: DelayedImage });
  const canvas = fakeCanvas();
  try {
    const slow = renderCreative(createProject({ id: "slow" }), { athlete: "/slow.png" }, { canvas });
    const fast = renderCreative(createProject({ id: "fast" }), { athlete: "/fast.png" }, { canvas });
    await Promise.all([slow, fast]);
    const drawn = canvas.context.calls.filter(([name]) => name === "drawImage").map(([, image]) => image.url);
    assert.deepEqual(drawn, ["/fast.png"]);
  } finally {
    restoreGlobal("Image", previousImage);
  }
});

test("long text reduces its font before ellipsizing content that cannot fit", () => {
  const project = createProject({
    id: "long_text",
    format: "banner",
    event: { name: "Championship Invitational Under the Lights", date: "June 14", location: "Seattle", callToAction: "Join us" },
  });
  const context = fakeContext();
  context.measureText = (value) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(context.font)?.[1] ?? 10);
    return { width: String(value).length * size * 0.55 };
  };
  const result = drawCreative(project, context, {}, "banner");
  assert.ok(result.textLines["event-name"].length <= 2);
  assert.ok(!result.textLines["event-name"].at(-1).endsWith("…"));
});
