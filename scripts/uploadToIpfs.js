import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const ROOT = process.cwd();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const envResult = dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });
const IMAGE_DIR = path.join(ROOT, "assets", "images");
const SOURCE_METADATA_DIR = path.join(ROOT, "assets", "metadata");
const BUILD_METADATA_DIR = path.join(ROOT, "build-metadata");
const CACHE_DIR = path.join(ROOT, ".ipfs-upload-cache");
const WORKER_PATH = path.join(SCRIPT_DIR, "lighthouseUploadWorker.js");
const IPFS_CAR_BIN = path.join(ROOT, "node_modules", ".bin", "ipfs-car");
const EXPECTED_SUPPLY = 3000;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const API_KEY = envResult.parsed?.LIGHTHOUSE_API_KEY || process.env.LIGHTHOUSE_API_KEY;
const PROVIDER = (envResult.parsed?.IPFS_UPLOAD_PROVIDER || process.env.IPFS_UPLOAD_PROVIDER || "lighthouse").toLowerCase();
const FOLDER_UPLOAD_MODE = (
  envResult.parsed?.LIGHTHOUSE_FOLDER_UPLOAD_MODE ||
  process.env.LIGHTHOUSE_FOLDER_UPLOAD_MODE ||
  "auto"
).toLowerCase();
const DIRECT_FOLDER_MAX_FILES = numberFromEnv("LIGHTHOUSE_DIRECT_FOLDER_MAX_FILES", 250);
const UPLOAD_TIMEOUT_MS = numberFromEnv("LIGHTHOUSE_UPLOAD_TIMEOUT_MS", 30 * 60 * 1000);
const PACK_TIMEOUT_MS = numberFromEnv("LIGHTHOUSE_PACK_TIMEOUT_MS", 15 * 60 * 1000);
const UPLOAD_ATTEMPTS = numberFromEnv("LIGHTHOUSE_UPLOAD_ATTEMPTS", 3);
const RETRY_DELAY_MS = numberFromEnv("LIGHTHOUSE_RETRY_DELAY_MS", 15 * 1000);
const HEARTBEAT_MS = numberFromEnv("LIGHTHOUSE_HEARTBEAT_MS", 30 * 1000);
const isDryRun = process.argv.includes("--dry-run");

function numberFromEnv(name, fallback) {
  const raw = envResult.parsed?.[name] || process.env[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDuration(ms) {
  if (ms < 60 * 1000) {
    return `${Math.round(ms / 1000)}s`;
  }

  return `${(ms / 60 / 1000).toFixed(1)}m`;
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return API_KEY ? message.replaceAll(API_KEY, "[REDACTED]") : message;
}

function assertConfiguration() {
  if (PROVIDER !== "lighthouse") {
    throw new Error(`Unsupported IPFS_UPLOAD_PROVIDER=${PROVIDER}. This project only uploads through Lighthouse.`);
  }

  if (!API_KEY && !isDryRun) {
    throw new Error("Missing LIGHTHOUSE_API_KEY in local .env");
  }

  if (!["auto", "car", "direct"].includes(FOLDER_UPLOAD_MODE)) {
    throw new Error("LIGHTHOUSE_FOLDER_UPLOAD_MODE must be auto, car, or direct");
  }
}

function numericId(file, ext) {
  if (!file.endsWith(ext)) {
    return null;
  }

  const id = Number(file.slice(0, -ext.length));
  return Number.isInteger(id) ? id : null;
}

async function readNumberedMetadata(dir) {
  const files = (await fs.readdir(dir)).filter((file) => file.endsWith(".json"));
  const ids = files
    .map((file) => numericId(file, ".json"))
    .filter((id) => id !== null)
    .sort((a, b) => a - b);

  const expected = Array.from({ length: EXPECTED_SUPPLY }, (_, index) => index + 1);
  const found = new Set(ids);
  const missing = expected.filter((id) => !found.has(id));
  const extras = ids.filter((id) => id < 1 || id > EXPECTED_SUPPLY);

  return { files, ids, missing, extras };
}

async function readNumberedImages(dir) {
  const allFiles = await fs.readdir(dir);
  const files = allFiles.filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const byId = new Map();
  const duplicates = [];
  const extCounts = {};

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const id = Number(path.basename(file, ext));
    extCounts[ext] = (extCounts[ext] || 0) + 1;

    if (!Number.isInteger(id)) {
      continue;
    }

    if (byId.has(id)) {
      duplicates.push([byId.get(id), file]);
      continue;
    }

    byId.set(id, file);
  }

  const ids = Array.from(byId.keys()).sort((a, b) => a - b);
  const expected = Array.from({ length: EXPECTED_SUPPLY }, (_, index) => index + 1);
  const found = new Set(ids);
  const missing = expected.filter((id) => !found.has(id));
  const extras = ids.filter((id) => id < 1 || id > EXPECTED_SUPPLY);

  return { files, ids, byId, missing, extras, duplicates, extCounts };
}

async function validateAssets() {
  log("Preparing files: validating local images and metadata...");
  const images = await readNumberedImages(IMAGE_DIR);
  const metadata = await readNumberedMetadata(SOURCE_METADATA_DIR);
  const invalidJson = [];
  const editionMismatches = [];
  const missingMatchingImages = [];

  for (const id of metadata.ids) {
    const file = `${id}.json`;
    try {
      const json = JSON.parse(await fs.readFile(path.join(SOURCE_METADATA_DIR, file), "utf8"));
      if (json.edition !== id) {
        editionMismatches.push({ file, edition: json.edition });
      }
      if (!images.byId.has(id)) {
        missingMatchingImages.push(file);
      }
    } catch (error) {
      invalidJson.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const problems = [
    images.files.length !== EXPECTED_SUPPLY && `expected ${EXPECTED_SUPPLY} images, found ${images.files.length}`,
    metadata.files.length !== EXPECTED_SUPPLY &&
      `expected ${EXPECTED_SUPPLY} metadata files, found ${metadata.files.length}`,
    images.missing.length && `missing images: ${images.missing.slice(0, 20).join(", ")}`,
    metadata.missing.length && `missing metadata: ${metadata.missing.slice(0, 20).join(", ")}`,
    images.extras.length && `extra images: ${images.extras.slice(0, 20).join(", ")}`,
    metadata.extras.length && `extra metadata: ${metadata.extras.slice(0, 20).join(", ")}`,
    images.duplicates.length &&
      `duplicate image IDs: ${images.duplicates
        .slice(0, 5)
        .map((pair) => pair.join(" / "))
        .join(", ")}`,
    missingMatchingImages.length &&
      `metadata files without matching images: ${missingMatchingImages.slice(0, 20).join(", ")}`,
    invalidJson.length && `invalid metadata JSON: ${invalidJson.slice(0, 5).map((item) => item.file).join(", ")}`,
    editionMismatches.length &&
      `edition mismatches: ${editionMismatches.slice(0, 5).map((item) => item.file).join(", ")}`,
  ].filter(Boolean);

  if (problems.length) {
    throw new Error(`Asset validation failed:\n${problems.join("\n")}`);
  }

  log(`Preparing files: validated ${images.files.length} images and ${metadata.files.length} metadata files.`);
  return { images, metadata };
}

async function directoryStats(dir) {
  const files = await fs.readdir(dir);
  let bytes = 0;

  for (const file of files) {
    const stat = await fs.stat(path.join(dir, file));
    if (stat.isFile()) {
      bytes += stat.size;
    }
  }

  return { bytes, fileCount: files.length };
}

function consumeLines(stream, onLine) {
  let pending = "";

  stream.on("data", (chunk) => {
    pending += chunk.toString();
    let newlineIndex = pending.indexOf("\n");

    while (newlineIndex !== -1) {
      const line = pending.slice(0, newlineIndex).trim();
      pending = pending.slice(newlineIndex + 1);
      if (line) {
        onLine(line);
      }
      newlineIndex = pending.indexOf("\n");
    }
  });

  return () => {
    const line = pending.trim();
    if (line) {
      onLine(line);
    }
  };
}

async function runCommand(command, args, { label, timeoutMs, captureOutput = false }) {
  log(`${label}: started.`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const heartbeat = setInterval(() => {
      log(`${label}: still running.`);
    }, HEARTBEAT_MS);

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      clearInterval(heartbeat);
      reject(new Error(`${label} timed out after ${formatDuration(timeoutMs)}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!captureOutput) {
        process.stdout.write(chunk);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (!captureOutput) {
        process.stderr.write(chunk);
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);

      if (code === 0) {
        log(`${label}: completed.`);
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${label} failed with exit code ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

async function createCar(label, dir) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const carPath = path.join(CACHE_DIR, `${label}.car`);
  const resolvedDir = await fs.realpath(dir);

  await fs.rm(carPath, { force: true });
  log(`${label}: preparing files as a single CAR archive.`);

  await runCommand(
    IPFS_CAR_BIN,
    ["--pack", resolvedDir, "--wrapWithDirectory", "false", "--output", carPath],
    {
      label: `${label}: CAR packing`,
      timeoutMs: PACK_TIMEOUT_MS,
    },
  );

  const { stdout } = await runCommand(IPFS_CAR_BIN, ["--list-roots", carPath], {
    label: `${label}: reading CAR root`,
    timeoutMs: 60 * 1000,
    captureOutput: true,
  });
  const roots = stdout
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (roots.length !== 1) {
    throw new Error(`${label}: expected one CAR root CID, found ${roots.length}`);
  }

  const { size } = await fs.stat(carPath);
  log(`${label}: CAR ready (${formatMb(size)}).`);
  log(`${label}: local CAR root CID=${roots[0]}`);
  return { carPath, rootCid: roots[0], size };
}

function isRetryableError(error) {
  const message = sanitizeError(error).toLowerCase();

  if (/status code (429|5\d\d)/.test(message)) {
    return true;
  }

  return [
    "timed out",
    "timeout",
    "network",
    "socket",
    "econnreset",
    "econnrefused",
    "enotfound",
    "fetch failed",
    "aborted",
    "hang up",
  ].some((fragment) => message.includes(fragment));
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkerUpload(label, mode, targetPath, bytes) {
  log(`${label}: sending request to Lighthouse using ${mode === "car" ? "CAR import" : "direct folder upload"}...`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER_PATH, mode, targetPath], {
      cwd: ROOT,
      env: { ...process.env, LIGHTHOUSE_API_KEY: API_KEY },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let result = null;
    let errorMessage = "";
    let stage = "sending request";
    let lastLoggedProgress = -10;

    const onLine = (line) => {
      if (line.startsWith("PROGRESS=")) {
        const progress = Number(line.slice("PROGRESS=".length));

        if (Number.isFinite(progress) && (progress - lastLoggedProgress >= 5 || progress >= 99.9)) {
          lastLoggedProgress = progress;
          const uploadedBytes = Math.min(bytes, Math.round((progress / 100) * bytes));
          log(`${label}: sending request ${progress.toFixed(1)}% (${formatMb(uploadedBytes)} / ${formatMb(bytes)}).`);
        }

        if (progress >= 99.9 && stage !== "waiting for response") {
          stage = "waiting for response";
          log(`${label}: request body sent; waiting for Lighthouse response...`);
        }
      } else if (line.startsWith("RESULT=")) {
        result = JSON.parse(line.slice("RESULT=".length));
      } else if (line.startsWith("WORKER_ERROR=")) {
        errorMessage = line.slice("WORKER_ERROR=".length);
      } else {
        log(`${label}: ${line}`);
      }
    };

    const flushStdout = consumeLines(child.stdout, onLine);
    const flushStderr = consumeLines(child.stderr, (line) => {
      if (line.startsWith("WORKER_ERROR=")) {
        errorMessage = line.slice("WORKER_ERROR=".length);
      } else {
        errorMessage = errorMessage || line;
      }
    });

    const heartbeat = setInterval(() => {
      log(`${label}: ${stage}; still waiting for Lighthouse.`);
    }, HEARTBEAT_MS);

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      clearInterval(heartbeat);
      reject(new Error(`${label}: Lighthouse upload timed out after ${formatDuration(UPLOAD_TIMEOUT_MS)}`));
    }, UPLOAD_TIMEOUT_MS);

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      flushStdout();
      flushStderr();

      if (settled) {
        return;
      }

      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);

      if (code === 0 && result) {
        log(`${label}: received response from Lighthouse.`);
        resolve(result);
      } else {
        reject(new Error(errorMessage || `${label}: Lighthouse worker exited with code ${code}`));
      }
    });
  });
}

async function uploadWithRetries(label, operation, attempts = UPLOAD_ATTEMPTS) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    log(`${label}: upload attempt ${attempt}/${attempts}.`);

    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = sanitizeError(error);
      log(`${label}: attempt ${attempt} failed: ${message}`);

      if (!isRetryableError(error) || attempt === attempts) {
        throw new Error(message);
      }

      log(`${label}: retrying after ${formatDuration(RETRY_DELAY_MS)}.`);
      await wait(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

function findCid(value) {
  if (typeof value === "string") {
    return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-zA-Z2-7]{20,})$/.test(value) ? value : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const cid = findCid(item);
      if (cid) {
        return cid;
      }
    }
    return "";
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const cid = findCid(item);
      if (cid) {
        return cid;
      }
    }
  }

  return "";
}

async function uploadCar(label, dir) {
  const { carPath, rootCid, size } = await createCar(label, dir);
  const response = await uploadWithRetries(label, () => runWorkerUpload(label, "car", carPath, size));
  const responseCid = findCid(response);

  if (responseCid && responseCid !== rootCid) {
    throw new Error(`${label}: Lighthouse response CID ${responseCid} does not match local CAR root ${rootCid}`);
  }

  log(`${label}: Lighthouse accepted CAR root CID=${rootCid}`);
  return rootCid;
}

async function uploadDirect(label, dir, stats) {
  const response = await uploadWithRetries(label, () => runWorkerUpload(label, "direct", dir, stats.bytes), 1);
  const cid = findCid(response);

  if (!cid) {
    throw new Error(`${label}: Lighthouse response did not include a CID`);
  }

  log(`${label}: Lighthouse returned CID=${cid}`);
  return cid;
}

async function uploadDirectory(label, dir) {
  const stats = await directoryStats(dir);
  log(`${label}: preparing files (${stats.fileCount} files, ${formatMb(stats.bytes)}).`);

  const useCar =
    FOLDER_UPLOAD_MODE === "car" ||
    (FOLDER_UPLOAD_MODE === "auto" && stats.fileCount > DIRECT_FOLDER_MAX_FILES);

  if (useCar) {
    log(
      `${label}: selected CAR upload because this folder has ${stats.fileCount} files ` +
        `(direct multipart threshold: ${DIRECT_FOLDER_MAX_FILES}).`,
    );
    return uploadCar(label, dir);
  }

  try {
    return await uploadDirect(label, dir, stats);
  } catch (error) {
    if (FOLDER_UPLOAD_MODE === "direct") {
      throw error;
    }

    log(`${label}: direct folder upload failed; switching to CAR upload.`);
    return uploadCar(label, dir);
  }
}

async function rewriteMetadata(imageCid, imageById) {
  await fs.rm(BUILD_METADATA_DIR, { recursive: true, force: true });
  await fs.mkdir(BUILD_METADATA_DIR, { recursive: true });

  for (let tokenId = 1; tokenId <= EXPECTED_SUPPLY; tokenId += 1) {
    const sourceFile = path.join(SOURCE_METADATA_DIR, `${tokenId}.json`);
    const targetFile = path.join(BUILD_METADATA_DIR, `${tokenId}.json`);
    const metadata = JSON.parse(await fs.readFile(sourceFile, "utf8"));
    const imageFile = imageById.get(tokenId);

    metadata.image = `ipfs://${imageCid}/${imageFile}`;

    await fs.writeFile(targetFile, `${JSON.stringify(metadata, null, 2)}\n`);
  }
}

async function setEnvValue(key, value) {
  const envPath = path.join(ROOT, ".env");
  let lines = [];

  try {
    lines = (await fs.readFile(envPath, "utf8")).split(/\r?\n/);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.startsWith(prefix));

  if (index === -1) {
    lines.push(`${key}=${value}`);
  } else {
    lines[index] = `${key}=${value}`;
  }

  await fs.writeFile(envPath, `${lines.filter((line, lineIndex) => line || lineIndex < lines.length - 1).join("\n")}\n`);
}

async function main() {
  assertConfiguration();
  log("Lighthouse upload flow started.");
  const { images } = await validateAssets();

  if (isDryRun) {
    log("Dry run: rewriting metadata with placeholder image CID.");
    await rewriteMetadata("DRY_RUN_IMAGE_CID", images.byId);
    log("Dry run complete. Generated metadata in build-metadata.");
    console.log("IMAGE_CID=DRY_RUN_IMAGE_CID");
    console.log("METADATA_CID=DRY_RUN_METADATA_CID");
    console.log("BASE_URI=ipfs://DRY_RUN_METADATA_CID/");
    return;
  }

  const imageCid = await uploadDirectory("Images", IMAGE_DIR);
  console.log(`IMAGE_CID=${imageCid}`);

  log("Rewriting metadata image fields...");
  await rewriteMetadata(imageCid, images.byId);
  log("Rewriting metadata image fields: completed.");

  const metadataCid = await uploadDirectory("Metadata", BUILD_METADATA_DIR);
  const baseUri = `ipfs://${metadataCid}/`;

  const result = {
    provider: "lighthouse",
    imageCid,
    metadataCid,
    baseUri,
    generatedAt: new Date().toISOString(),
  };

  await fs.writeFile(path.join(ROOT, "ipfs-upload-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await setEnvValue("VITE_METADATA_BASE_URI", baseUri);
  log("Updated local .env with VITE_METADATA_BASE_URI.");

  console.log(`METADATA_CID=${metadataCid}`);
  console.log(`BASE_URI=${baseUri}`);
}

main().catch((error) => {
  console.error(`[${new Date().toISOString()}] ERROR: ${sanitizeError(error)}`);
  process.exit(1);
});
