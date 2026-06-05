# Ocicat NFT Frontend

React + Vite + TypeScript frontend for the Ocicat NFT contract on BNB Smart Chain.

## Contract

- Address: `0x90bdea0ddb6160faf6115dc35317c05cc911be22`
- Network: BNB Smart Chain Mainnet
- Chain ID: `56`
- Mint function: `mint(uint256 amount)`
- Mint price reader: `mintPriceInWei()`
- Quote helper: `quote(uint256 amount)`
- Base URI setter: `setBaseURI(string uri)`

## Local Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` locally:

```bash
IPFS_UPLOAD_PROVIDER=lighthouse
LIGHTHOUSE_API_KEY=
VITE_METADATA_BASE_URI=
VITE_BSC_RPC_URL=https://bsc-dataseed.binance.org/
```

## Asset Checks

```bash
npm run inspect:assets
```

The app expects:

- `assets/images/1.png` through `assets/images/3000.png`
- `assets/metadata/1.json` through `assets/metadata/3000.json`
- matching numeric image filenames for each metadata edition

## Lighthouse IPFS Upload

```bash
npm run upload:ipfs
```

The script:

1. Packs large folders into a CAR archive and uploads `assets/images` through Lighthouse.
2. Rewrites metadata `image` fields to `ipfs://IMAGE_CID/{matching-image-filename}`.
3. Packs and uploads rewritten metadata from `build-metadata` through Lighthouse.
4. Updates local `.env` with `VITE_METADATA_BASE_URI`.
5. Prints:

```bash
IMAGE_CID=...
METADATA_CID=...
BASE_URI=ipfs://METADATA_CID/
```

Set the contract base URI to the exact printed `BASE_URI`.

The upload logs file counts, MB totals, CAR packing, request progress, response waits, retries, and timestamps.
Useful optional controls:

```bash
LIGHTHOUSE_FOLDER_UPLOAD_MODE=auto
LIGHTHOUSE_UPLOAD_TIMEOUT_MS=1800000
LIGHTHOUSE_UPLOAD_ATTEMPTS=3
```

## Frontend

```bash
npm run dev -- --host 127.0.0.1
npm run build
```

After upload, set:

```bash
VITE_METADATA_BASE_URI=ipfs://METADATA_CID/
VITE_BSC_RPC_URL=https://bsc-dataseed.binance.org/
```

Then rebuild and deploy `dist`.

If the on-chain `tokenURI` returns a relative value such as `1.json`, the frontend resolves it against
`VITE_METADATA_BASE_URI`.
