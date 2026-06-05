const IPFS_GATEWAY = "https://gateway.lighthouse.storage/ipfs/";
const EMBEDDED_IPFS_URI = /ipfs:\/\/[^\s"'“”‘’()<>]+/i;
const JSON_PATH = /([a-z0-9][a-z0-9._/-]*\.json(?:[?#][^\s]*)?)/i;
const IPFS_PATH = /\/ipfs\/(.+)$/i;

export function stripLeadingSlash(value: string) {
  return value.replace(/^\/+/, "");
}

export function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

export function isAbsoluteUri(value: string) {
  return /^(ipfs|https?|data):/i.test(value);
}

export function normalizeUri(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(EMBEDDED_IPFS_URI);

  if (!match || match[0] === trimmed) {
    return trimmed;
  }

  const suffix = trimmed.slice((match.index || 0) + match[0].length);
  const relativeJsonPath = suffix.match(JSON_PATH)?.[1];

  return relativeJsonPath
    ? `${ensureTrailingSlash(match[0])}${stripLeadingSlash(relativeJsonPath)}`
    : match[0];
}

export function ipfsToGatewayUrl(uri: string) {
  const normalized = normalizeUri(uri);
  const ipfsPath = extractIpfsPath(normalized);

  if (!ipfsPath) {
    return normalized;
  }

  return `${IPFS_GATEWAY}${stripLeadingSlash(ipfsPath)}`;
}

export function extractIpfsPath(uri: string) {
  const normalized = normalizeUri(uri);

  if (normalized.toLowerCase().startsWith("ipfs://")) {
    return stripLeadingSlash(normalized.slice("ipfs://".length));
  }

  try {
    const parsed = new URL(normalized);
    const match = parsed.pathname.match(IPFS_PATH);

    if (match?.[1]) {
      return stripLeadingSlash(`${match[1]}${parsed.search}${parsed.hash}`);
    }
  } catch {
    return "";
  }

  return "";
}

export function resolveWithBase(uri: string, baseUri: string) {
  const trimmed = normalizeUri(uri);

  if (!trimmed) {
    return "";
  }

  if (isAbsoluteUri(trimmed)) {
    return trimmed;
  }

  const normalizedBaseUri = normalizeUri(baseUri);

  if (!normalizedBaseUri) {
    return trimmed;
  }

  return `${ensureTrailingSlash(normalizedBaseUri)}${stripLeadingSlash(trimmed)}`;
}

export function resolveTokenUri(tokenUri: string, metadataBaseUri: string) {
  return resolveWithBase(tokenUri, metadataBaseUri);
}

export function resolveFetchableUri(uri: string, baseUri = "") {
  return ipfsToGatewayUrl(resolveWithBase(uri, baseUri));
}

export function parentUri(uri: string) {
  const clean = uri.split("?")[0].split("#")[0];
  const slash = clean.lastIndexOf("/");
  return slash === -1 ? "" : clean.slice(0, slash + 1);
}

export function resolveMetadataImageUri(imageUri: string, resolvedMetadataUri: string) {
  const normalizedImageUri = normalizeUri(imageUri);

  if (!normalizedImageUri) {
    return "";
  }

  if (isAbsoluteUri(normalizedImageUri)) {
    return normalizedImageUri;
  }

  return resolveWithBase(normalizedImageUri, parentUri(resolvedMetadataUri));
}
