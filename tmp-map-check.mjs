import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 9391;
const profile = mkdtempSync(join(tmpdir(), "fv-edge-"));
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const child = spawn(
  edge,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--remote-allow-origins=*", "about:blank"],
  { stdio: "ignore" },
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitPort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Edge is still starting.
    }
    await sleep(500);
  }
  throw new Error("edge-not-ready");
}

function envValue(key) {
  const env = readFileSync("d:/work/flyvan/.env", "utf8");
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) return "";
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const msgId = ++id;
          return new Promise((done) => {
            pending.set(msgId, done);
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const done = pending.get(message.id);
        pending.delete(message.id);
        done(message);
      }
    });
    ws.addEventListener("error", () => reject(new Error("cdp-error")));
  });
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text || "evaluate-failed");
  }
  return result.result?.result?.value;
}

async function main() {
  await waitPort();
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const page = await created.json();
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const email = envValue("SEED_OWNER_EMAIL") || "owner@localhost.test";
  const password = envValue("SEED_OWNER_PASSWORD");
  const login = await fetch("http://localhost:3001/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  if (!login.ok) throw new Error(`login-${login.status}`);
  const session = await login.json();

  await client.send("Page.navigate", { url: "http://localhost:3000/login" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const href = await evaluate(client, "location.href");
    if (String(href).includes("localhost:3000/login")) break;
    await sleep(300);
  }
  await evaluate(client, `sessionStorage.setItem("flyvan.session", ${JSON.stringify(JSON.stringify(session))})`);
  await client.send("Page.navigate", { url: "http://localhost:3000/admin/destinations" });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = await evaluate(client, "Boolean(document.body && document.body.innerText.includes('وجهة جديدة'))");
    if (ready) break;
    await sleep(400);
  }
  await evaluate(client, "[...document.querySelectorAll('button')].find((button) => button.textContent.includes('وجهة جديدة'))?.click()");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const open = await evaluate(client, "Boolean(document.querySelector('dialog[open] .fv-map'))");
    if (open) break;
    await sleep(300);
  }
  await sleep(3500);
  const before = await evaluate(
    client,
    `(() => {
      const dialog = document.querySelector("dialog[open]");
      const map = dialog?.querySelector(".fv-map");
      const tiles = [...(map?.querySelectorAll("img.leaflet-tile") ?? [])];
      const loaded = tiles.filter((tile) => tile.complete && tile.naturalWidth > 0);
      const button = [...dialog.querySelectorAll("button")].find((item) => item.textContent.includes("حفظ الوجهة"));
      const dialogBox = dialog.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      const tile = loaded[0];
      return {
        mapHeight: Math.round(map.getBoundingClientRect().height),
        tileCount: tiles.length,
        loadedCount: loaded.length,
        tileWidth: tile ? Math.round(tile.getBoundingClientRect().width) : 0,
        naturalWidth: tile ? tile.naturalWidth : 0,
        dialogTransform: getComputedStyle(dialog).transform,
        buttonInside: buttonBox.bottom <= dialogBox.bottom + 1 && buttonBox.top >= dialogBox.top,
        hasPaste: Boolean(dialog.querySelector('input[placeholder="الصق الرابط أو الإحداثيات"]')),
        hasHere: [...dialog.querySelectorAll("button")].some((item) => item.textContent.includes("موقعي الحالي")),
      };
    })()`,
  );
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[placeholder="الصق الرابط أو الإحداثيات"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(input, "https://www.google.com/maps/@33.513800,36.276500,16z");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      [...document.querySelectorAll("button")].find((button) => button.textContent.includes("استخدام الرابط"))?.click();
    })()`,
  );
  let pin = false;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    pin = await evaluate(client, "Boolean(document.querySelector('dialog[open] .fv-pin-destination'))");
    if (pin) break;
    await sleep(200);
  }
  await evaluate(client, "[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'موقعي الحالي')?.click()");
  let geo = "";
  for (let attempt = 0; attempt < 15; attempt += 1) {
    geo = await evaluate(client, "document.querySelector('dialog[open] .text-danger')?.textContent ?? ''");
    if (geo) break;
    await sleep(300);
  }
  console.log(JSON.stringify({ ...before, pin, geo }));
  client.close();
}

try {
  await main();
} catch (error) {
  if (error?.message !== "edge-not-ready") console.error(String(error?.message || error));
  process.exitCode = 1;
} finally {
  spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  await sleep(400);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Crashpad may still hold a file.
  }
}
