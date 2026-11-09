const { execFileSync, spawn } = require("node:child_process");
const { networkInterfaces } = require("node:os");
const path = require("node:path");

const port = "8081";
const address = lanAddress();
const projectRoot = path.resolve(__dirname, "..");
const expoCli = path.join(projectRoot, "node_modules", "expo", "bin", "cli");

if (address) {
  console.log(`Expo Go على الهاتف: exp://${address}:${port}`);
  console.log(`الخادم من الهاتف: http://${address}:3001`);
} else {
  console.log("تعذر معرفة عنوان الشبكة. ابقِ الهاتف والكمبيوتر على نفس الواي فاي.");
}

const child = spawn(process.execPath, [expoCli, "start", "--host", "lan", "--port", port], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ...(address ? { REACT_NATIVE_PACKAGER_HOSTNAME: address } : {}),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function lanAddress() {
  const candidates = lanCandidates();
  const routed = defaultRouteAddress();
  if (routed && candidates.some((item) => item.address === routed)) return routed;
  return (
    candidates.find((item) => item.address.startsWith("192.168."))?.address ??
    candidates.find((item) => item.address.startsWith("10."))?.address ??
    candidates[0]?.address ??
    ""
  );
}

function lanCandidates() {
  const candidates = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (isVirtual(name)) continue;
    for (const entry of entries ?? []) {
      const family = entry.family;
      if (entry.internal || (family !== "IPv4" && family !== 4) || entry.address.startsWith("169.254.")) continue;
      candidates.push({ name, address: entry.address });
    }
  }
  return candidates;
}

function defaultRouteAddress() {
  if (process.platform !== "win32") return "";
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric,InterfaceMetric | ForEach-Object { $alias = $_.InterfaceAlias; Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $alias + '|' + $_.IPAddress } }",
      ],
      { encoding: "utf8", timeout: 8000, windowsHide: true },
    );
    for (const line of output.split(/\r?\n/)) {
      const [name, address] = line.trim().split("|");
      if (!name || !address || isVirtual(name) || address.startsWith("169.254.")) continue;
      return address;
    }
  } catch {
    return "";
  }
  return "";
}

function isVirtual(name) {
  return /vethernet|hyper-v|wsl|virtualbox|vmware|loopback|bluetooth|protun|tun|vpn|wintun|tap-/i.test(name);
}
