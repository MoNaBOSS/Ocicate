import lighthouse from "@lighthouse-web3/sdk";

const [mode, targetPath] = process.argv.slice(2);
const apiKey = process.env.LIGHTHOUSE_API_KEY;

if (!apiKey) {
  console.error("WORKER_ERROR=Missing LIGHTHOUSE_API_KEY");
  process.exit(1);
}

if (!["car", "direct"].includes(mode) || !targetPath) {
  console.error("WORKER_ERROR=Usage: lighthouseUploadWorker.js <car|direct> <path>");
  process.exit(1);
}

function onProgress(data) {
  const progress = Number(data?.progress);
  if (Number.isFinite(progress)) {
    console.log(`PROGRESS=${progress}`);
  }
}

try {
  const response =
    mode === "car"
      ? await lighthouse.uploadCAR(targetPath, apiKey, { onProgress })
      : await lighthouse.upload(targetPath, apiKey, { onProgress });

  console.log(`RESULT=${JSON.stringify(response)}`);
} catch (error) {
  console.error(`WORKER_ERROR=${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
