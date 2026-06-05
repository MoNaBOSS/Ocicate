import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IMAGE_DIR = path.join(ROOT, "assets", "images");
const METADATA_DIR = path.join(ROOT, "assets", "metadata");
const EXPECTED_SUPPLY = 3000;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function numericFileSet(dir, ext) {
  const files = fs.readdirSync(dir).filter((file) => file.toLowerCase().endsWith(ext));
  const numbers = files
    .map((file) => Number(file.slice(0, -ext.length)))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return { files, numbers };
}

function numberedImageSet(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
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

  return {
    files,
    byId,
    duplicates,
    extCounts,
    numbers: Array.from(byId.keys()).sort((a, b) => a - b),
  };
}

function missingNumbers(numbers) {
  const found = new Set(numbers);
  return Array.from({ length: EXPECTED_SUPPLY }, (_, index) => index + 1).filter(
    (id) => !found.has(id),
  );
}

function inspectAssets() {
  const imageData = numberedImageSet(IMAGE_DIR);
  const metadataData = numericFileSet(METADATA_DIR, ".json");
  const pngHeader = Buffer.from("89504e470d0a1a0a", "hex");
  const badPngHeaders = [];
  const invalidJson = [];
  const editionMismatches = [];
  const metadataWithoutImage = [];
  const imageFields = new Map();
  const dominantImageExt =
    Object.entries(imageData.extCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  for (const file of imageData.files) {
    if (path.extname(file).toLowerCase() !== ".png") {
      continue;
    }

    const fd = fs.openSync(path.join(IMAGE_DIR, file), "r");
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);

    if (!header.equals(pngHeader)) {
      badPngHeaders.push(file);
    }
  }

  for (const file of metadataData.files) {
    const fullPath = path.join(METADATA_DIR, file);
    const tokenId = Number(file.replace(/\.json$/, ""));

    try {
      const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      imageFields.set(String(json.image), (imageFields.get(String(json.image)) || 0) + 1);

      if (json.edition !== tokenId) {
        editionMismatches.push({ file, edition: json.edition });
      }

      if (!imageData.byId.has(tokenId)) {
        metadataWithoutImage.push(file);
      }
    } catch (error) {
      invalidJson.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    images: {
      count: imageData.files.length,
      extensionCounts: imageData.extCounts,
      namingConvention: dominantImageExt ? `{tokenId}${dominantImageExt}` : "",
      first: imageData.numbers[0],
      last: imageData.numbers.at(-1),
      missing: missingNumbers(imageData.numbers),
      extras: imageData.numbers.filter((id) => id < 1 || id > EXPECTED_SUPPLY),
      duplicateIdCount: imageData.duplicates.length,
      duplicateIds: imageData.duplicates.slice(0, 20),
      badPngHeaderCount: badPngHeaders.length,
      badPngHeaders: badPngHeaders.slice(0, 20),
    },
    metadata: {
      count: metadataData.files.length,
      first: metadataData.numbers[0],
      last: metadataData.numbers.at(-1),
      missing: missingNumbers(metadataData.numbers),
      extras: metadataData.numbers.filter((id) => id < 1 || id > EXPECTED_SUPPLY),
      invalidJsonCount: invalidJson.length,
      invalidJson: invalidJson.slice(0, 20),
      editionMismatchCount: editionMismatches.length,
      editionMismatches: editionMismatches.slice(0, 20),
      metadataWithoutMatchingImageCount: metadataWithoutImage.length,
      metadataWithoutMatchingImage: metadataWithoutImage.slice(0, 20),
    },
    imageFieldFormats: Array.from(imageFields.entries()).sort((a, b) => b[1] - a[1]),
  };
}

const report = inspectAssets();
console.log(JSON.stringify(report, null, 2));

if (
  report.images.count !== EXPECTED_SUPPLY ||
  report.metadata.count !== EXPECTED_SUPPLY ||
  report.images.missing.length ||
  report.metadata.missing.length ||
  report.images.extras.length ||
  report.metadata.extras.length ||
  report.images.duplicateIdCount ||
  report.images.badPngHeaderCount ||
  report.metadata.invalidJsonCount ||
  report.metadata.editionMismatchCount ||
  report.metadata.metadataWithoutMatchingImageCount
) {
  process.exitCode = 1;
}
