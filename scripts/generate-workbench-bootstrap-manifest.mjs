import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "scripts", "lib", "bootstrap-common.sh");
const outputPath = path.join(root, "lib", "generated", "workbench-bootstrap-manifest.ts");

const BUNDLE_IDS = ["solo-builder-core", "research-node", "local-model-box"];

function parseShellListTokens(raw) {
  return raw
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCasePrintfMap(functionBody) {
  const result = new Map();
  const cases = Array.from(functionBody.matchAll(/([a-z0-9|-]+(?:\|[a-z0-9|-]+)*)\)\n\s+printf '%s\\n' ([^\n]+)\n\s+;;/g));
  for (const match of cases) {
    const bundleIds = match[1]?.split("|").map((item) => item.trim()).filter(Boolean) ?? [];
    const values = parseShellListTokens(match[2] ?? "");
    for (const bundleId of bundleIds) {
      result.set(bundleId, values);
    }
  }
  return result;
}

function getFunctionBody(text, functionName) {
  const match = text.match(new RegExp(`${functionName}\\(\\) \\{([\\s\\S]*?)\\n\\}`, "m"));
  if (!match) {
    throw new Error(`Failed to locate function ${functionName} in ${sourcePath}`);
  }
  return match[1];
}

function buildManifest(text) {
  const manifest = Object.fromEntries(BUNDLE_IDS.map((bundleId) => [bundleId, { packages: [], services: [] }]));

  const corePackagesByBundle = parseCasePrintfMap(getFunctionBody(text, "bundle_core_packages"));
  const overlayPackagesByBundle = parseCasePrintfMap(getFunctionBody(text, "bundle_overlay_packages"));

  for (const bundleId of BUNDLE_IDS) {
    const corePackages = corePackagesByBundle.get(bundleId) ?? [];
    const overlayPackages = overlayPackagesByBundle.get(bundleId) ?? [];
    manifest[bundleId].packages = [...corePackages, ...overlayPackages];
  }

  const servicePrintf = text.match(/bundle_services\(\) \{[\s\S]*?printf '%s\\n' ([^\n]+)\n\}/);
  const services = servicePrintf ? parseShellListTokens(servicePrintf[1] ?? "") : [];
  for (const bundleId of BUNDLE_IDS) {
    manifest[bundleId].services = services;
  }

  for (const bundleId of BUNDLE_IDS) {
    if (manifest[bundleId].packages.length === 0) {
      throw new Error(`Failed to parse packages for ${bundleId} from ${sourcePath}`);
    }
    if (manifest[bundleId].services.length === 0) {
      throw new Error(`Failed to parse services for ${bundleId} from ${sourcePath}`);
    }
  }

  return manifest;
}

const source = fs.readFileSync(sourcePath, "utf8");
const manifest = buildManifest(source);

const fileContent = `export const BOOTSTRAP_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;\n`;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, fileContent);
console.log(`Generated ${path.relative(root, outputPath)}`);
