/**
 * End-to-end smoke check for the pose editor.
 *
 * Drives a real browser against the running dev server and performs an actual
 * pointer drag on a joint handle, because the one thing unit tests cannot cover
 * is whether the pointer plumbing (capture, coordinate transform, React state)
 * is wired up correctly. Uses the system Chrome via executablePath so no
 * browser download is needed.
 *
 * Usage: pnpm editor (in one shell), then node scripts/check-editor.mjs
 */
import { chromium } from "playwright-core";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_BASE = process.env.EDITOR_URL ?? "http://localhost:5183";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The save step writes real files under poses/. Snapshot anything the check
 * touches and put it back afterwards — otherwise running this smoke check
 * silently corrupts the pose library, which it did once before this guard
 * existed (the walk track's mirrored halves drifted and a unit test caught it).
 */
const TOUCHED = ["tracks/walk.json"];
/** Files the check CREATES, which must be removed again rather than restored. */
const CREATED = ["library/editor-smoke-test.json", "tracks/editor-smoke-track.json"];

const main = async () => {
  const backupDir = await mkdtemp(join(tmpdir(), "pose-editor-check-"));
  for (const rel of TOUCHED) {
    await copyFile(join("poses", rel), join(backupDir, rel.replace(/\//g, "_")));
  }
  try {
    await run();
  } finally {
    for (const rel of TOUCHED) {
      await copyFile(join(backupDir, rel.replace(/\//g, "_")), join("poses", rel));
    }
    for (const rel of CREATED) {
      await rm(join("poses", rel), { force: true });
    }
    await rm(backupDir, { recursive: true, force: true });
    console.log("restored:", TOUCHED.join(", "), "| removed:", CREATED.join(", "));
  }
};

const run = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL_BASE, { waitUntil: "networkidle" });

  const handles = page.locator("[data-role='joint-handles'] circle");
  console.log("joint handles rendered:", await handles.count());
  console.log("figure paths drawn:", await page.locator("svg path").count());

  const readAngle = async (bone) => {
    const text = await page.locator(`text=${bone}`).first().textContent().catch(() => null);
    return text;
  };

  // --- drag a knee in aim mode -------------------------------------------
  const knee = page.locator("[data-bone='leftThigh']");
  const box = await knee.boundingBox();
  if (!box) throw new Error("leftThigh handle has no bounding box");
  const before = await page.locator(".joint-readout, .inspector").first().innerText();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 40, { steps: 12 });
  await page.mouse.up();

  const after = await page.locator(".joint-readout, .inspector").first().innerText();
  console.log("aim drag changed the pose:", before !== after);

  // --- switch to a track and exercise the timeline ------------------------
  await page.getByRole("button", { name: /walk/ }).click();
  const markers = page.locator(".keyframe-marker");
  console.log("walk keyframe markers:", await markers.count());
  await page.getByRole("button", { name: "+ Key" }).click();
  console.log("markers after + Key:", await markers.count());
  await page.getByRole("button", { name: /Mirror 2nd half/ }).click();
  console.log("markers after mirror:", await markers.count());

  // --- IK mode ------------------------------------------------------------
  await page.getByText("IK — drag a hand or shin", { exact: false }).click();
  const shin = page.locator("[data-bone='leftShin']");
  const sbox = await shin.boundingBox();
  if (sbox) {
    await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sbox.x - 70, sbox.y + 30, { steps: 10 });
    await page.mouse.up();
    console.log("ik drag completed without error");
  }

  // --- create a brand new pose from the current figure ---------------------
  await page.getByRole("button", { name: /stand/ }).click();
  const entriesBefore = await page.locator(".library li").count();
  await page.getByPlaceholder("e.g. bow forward").fill("Editor Smoke Test");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForSelector(".status.ok, .status.bad", { timeout: 5000 });
  console.log("create status:", (await page.locator(".status").first().textContent())?.trim());
  console.log("library entries:", entriesBefore, "->", await page.locator(".library li").count());
  console.log("new pose selected:", await page.locator(".library .is-selected").innerText());

  // --- create a brand new TRACK --------------------------------------------
  await page.locator(".kind-toggle label", { hasText: "track" }).locator("input").check();
  await page.getByPlaceholder("e.g. slow bow").fill("Editor Smoke Track");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForSelector(".status.ok, .status.bad", { timeout: 5000 });
  console.log("track create status:", (await page.locator(".status").first().textContent())?.trim());
  console.log("timeline appeared:", await page.locator(".timeline").count());
  console.log("new track keyframes:", await page.locator(".keyframe-marker").count());
  // it must be immediately editable: scrub to the middle and key a pose
  await page.locator(".timeline-track input[type=range]").fill("12");
  await page.getByRole("button", { name: "+ Key" }).click();
  console.log("after keying frame 12:", await page.locator(".keyframe-marker").count());
  await page.getByRole("button", { name: /Save to poses/ }).click();
  await page.waitForSelector(".status.ok, .status.bad", { timeout: 5000 });
  console.log("track save:", (await page.locator(".status").first().textContent())?.trim());

  // --- full round trip: save the edited track back to disk -----------------
  await page.getByRole("button", { name: /walk/ }).click();
  await page.getByRole("button", { name: /Save to poses/ }).click();
  await page.waitForSelector(".status.ok, .status.bad", { timeout: 5000 });
  console.log("save status:", (await page.locator(".status").first().textContent())?.trim());

  await page.screenshot({ path: "out/editor.png" });
  console.log("screenshot -> out/editor.png");
  console.log(errors.length ? `CONSOLE ERRORS:\n  ${errors.join("\n  ")}` : "no console errors");
  await browser.close();
};

void main();
