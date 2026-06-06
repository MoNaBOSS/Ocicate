import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  formatEther,
  getAddress,
  isAddress,
  type JsonRpcSigner,
} from "ethers";
import {
  Cat,
  ChevronDown,
  CheckCircle2,
  Clipboard,
  Coins,
  Copy,
  Database,
  ExternalLink,
  Gift,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Minus,
  Plus,
  RefreshCcw,
  Send,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  BNBSmartChainParams,
  BSC_CHAIN_ID,
  BSC_CHAIN_ID_HEX,
  BSC_RPC_URL,
  CONTRACT_ABI,
  CONTRACT_ADDRESS,
  METADATA_BASE_URI,
} from "./lib/contract";
import {
  ipfsToGatewayUrl,
  resolveFetchableUri,
  resolveMetadataImageUri,
  resolveTokenUri,
} from "./lib/metadata";

type View = "mint" | "dashboard" | "transfer";

type ReadResult<T> = {
  value: T;
  source: string;
};

type ContractInfo = {
  name: string;
  symbol: string;
  totalSupplyRaw: bigint | null;
  maxSupplyRaw: bigint | null;
  remainingSupplyRaw: bigint | null;
  priceRaw: bigint | null;
  supplySource: string;
  maxSupplySource: string;
  priceSource: string;
};

type Attribute = {
  trait_type?: string;
  value?: string | number;
};

type NftMetadata = {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Attribute[];
};

type OwnedNft = {
  tokenId: number;
  tier: string;
  tokenUri: string;
  metadataUri: string;
  metadataUrl: string;
  imageUri: string;
  imageUrl: string;
  metadata?: NftMetadata;
  error?: string;
};

type TxResponse = {
  hash: string;
  wait: () => Promise<unknown>;
};

type TransferReceipt = {
  tokenIds: number[];
  hash: string;
};

type GiftState = {
  whitelist: bigint | null;
  claimed: bigint | null;
  isLoading: boolean;
  isClaiming: boolean;
  txHash: string;
  error: string;
};

const PRICE_FUNCTIONS = [
  "mintPriceInWei",
  "mintPrice",
  "publicMintPrice",
  "price",
  "cost",
  "MINT_PRICE",
  "mintCost",
];
const SUPPLY_FUNCTIONS = ["totalSupply", "totalMinted", "minted", "currentTokenId", "nextTokenId"];
const MAX_SUPPLY_FUNCTIONS = ["maxSupply", "MAX_SUPPLY", "MAX_NFT_SUPPLY", "collectionSize"];
const MINT_FUNCTIONS = ["mint(uint256)", "publicMint(uint256)", "mintNFT(uint256)", "safeMint(uint256)"];
const SINGLE_MINT_FUNCTIONS = [...MINT_FUNCTIONS, "mint()"];
const EXPECTED_SUPPLY = 3000;
const MAX_MINT_QUANTITY = 100;
const BATCH_TRANSFER_NOTICE = "Batch send enabled";
const SOCIAL_LINKS = [
  { label: "X / Twitter", href: "https://x.com/ocicattoken" },
  { label: "Telegram", href: "https://t.me/ocicatcoin" },
];
const initialGiftState: GiftState = {
  whitelist: null,
  claimed: null,
  isLoading: false,
  isClaiming: false,
  txHash: "",
  error: "",
};

const tiers = [
  {
    name: "Tiger Blood",
    range: "1 - 1000",
    start: 1,
    end: 1000,
    tone: "red",
    copy: "The most intense Ocicat tier, built around high-energy red traits and flagship collector presence.",
    sample: "/samples/1.png",
  },
  {
    name: "Wildclaw",
    range: "1001 - 2000",
    start: 1001,
    end: 2000,
    tone: "gold",
    copy: "A sharp middle tier for holders who want the Dreamers Club identity with battle-ready edge.",
    sample: "/samples/1423.png",
  },
  {
    name: "Alley Cat",
    range: "2001 - 3000",
    start: 2001,
    end: 3000,
    tone: "blue",
    copy: "Streetwise, playful, and unmistakably Ocicat, rounding out the full 3000-piece collection.",
    sample: "/samples/777.png",
  },
];

const initialInfo: ContractInfo = {
  name: "Ocicat NFT",
  symbol: "OCICAT",
  totalSupplyRaw: null,
  maxSupplyRaw: BigInt(EXPECTED_SUPPLY),
  remainingSupplyRaw: null,
  priceRaw: null,
  supplySource: "",
  maxSupplySource: "configured",
  priceSource: "",
};

function contractCall<T>(contract: Contract, fragment: string, ...args: unknown[]) {
  const callable = (contract as unknown as Record<string, (...params: unknown[]) => Promise<T>>)[fragment];

  if (typeof callable !== "function") {
    throw new Error(`Contract function ${fragment} is not in the frontend ABI.`);
  }

  return callable(...args);
}

function toBigInt(value: unknown) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  if (typeof value === "string" && value) {
    return BigInt(value);
  }

  return null;
}

async function readFirstBigInt(contract: Contract, candidates: string[]): Promise<ReadResult<bigint> | null> {
  for (const candidate of candidates) {
    try {
      const value = toBigInt(await contractCall<unknown>(contract, candidate));

      if (value !== null) {
        return { value, source: candidate };
      }
    } catch {
      // Some deployed contracts expose only one of these conventional names.
    }
  }

  return null;
}

async function readFirstString(contract: Contract, candidates: string[], fallback: string) {
  for (const candidate of candidates) {
    try {
      const value = await contractCall<string>(contract, candidate);
      return value || fallback;
    } catch {
      // Optional metadata reads should not block the app.
    }
  }

  return fallback;
}

function formatBnb(value: bigint | null) {
  if (value === null) {
    return "Not exposed";
  }

  return `${Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} BNB`;
}

function formatNumber(value: bigint | null) {
  if (value === null) {
    return "--";
  }

  return Number(value).toLocaleString();
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeAddress(address: string) {
  try {
    return getAddress(address);
  } catch {
    return address.toLowerCase();
  }
}

function sameAddress(left: string, right: string) {
  return normalizeAddress(left) === normalizeAddress(right);
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error) {
    for (const key of ["shortMessage", "reason", "message"]) {
      if (key in error) {
        const value = (error as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) {
          return value;
        }
      }
    }

    const nestedMessage = (error as { info?: { error?: { message?: unknown } } }).info?.error?.message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return nestedMessage;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message);
  }

  return String(error);
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "number" ? code : Number(code);
  }

  return undefined;
}

function tierForToken(tokenId: number) {
  return tiers.find((tier) => tokenId >= tier.start && tokenId <= tier.end)?.name || "Ocicat";
}

function traitPreview(metadata?: NftMetadata) {
  return metadata?.attributes?.slice(0, 4) || [];
}

function giftStatusLabel(giftState: GiftState) {
  if (giftState.isLoading) {
    return "Checking gifts...";
  }

  const remainingGifts = giftRemainingCount(giftState);

  if (remainingGifts > 0n) {
    return `🎁 ${formatGiftCount(remainingGifts)}`;
  }

  if (giftState.whitelist !== null || giftState.error) {
    return "No gifts found";
  }

  return "Connect wallet to check gifts";
}

function formatGiftCount(value: bigint | null) {
  return value === null ? "--" : value.toLocaleString();
}

function giftRemainingCount(giftState: GiftState) {
  if (giftState.whitelist === null || giftState.claimed === null) {
    return 0n;
  }

  return giftState.whitelist > giftState.claimed ? giftState.whitelist - giftState.claimed : 0n;
}

function NftImage({ nft }: { nft: OwnedNft }) {
  const primarySrc = nft.imageUrl || ipfsToGatewayUrl(nft.imageUri);
  const lighthouseRetrySrc = ipfsToGatewayUrl(nft.imageUri || nft.imageUrl);
  const [src, setSrc] = useState(primarySrc);
  const [hasRetried, setHasRetried] = useState(false);

  useEffect(() => {
    setSrc(primarySrc);
    setHasRetried(false);
  }, [primarySrc, lighthouseRetrySrc]);

  if (!src) {
    return (
      <div className="image-fallback">
        <ImageIcon size={28} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={nft.metadata?.name || `Ocicat #${nft.tokenId}`}
      onError={() => {
        if (!hasRetried && lighthouseRetrySrc && lighthouseRetrySrc !== src) {
          setHasRetried(true);
          setSrc(lighthouseRetrySrc);
          return;
        }

        setSrc("");
      }}
    />
  );
}

function parseChainId(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    return value.startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
  }

  return null;
}

function clampQuantity(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(MAX_MINT_QUANTITY, Math.trunc(value)));
}

export default function App() {
  const [activeView, setActiveView] = useState<View>("mint");
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [walletBalanceRaw, setWalletBalanceRaw] = useState<bigint | null>(null);
  const [contractInfo, setContractInfo] = useState<ContractInfo>(initialInfo);
  const [mintQuantity, setMintQuantity] = useState(1);
  const [ownedNfts, setOwnedNfts] = useState<OwnedNft[]>([]);
  const [selectedTokenIds, setSelectedTokenIds] = useState<number[]>([]);
  const [recipient, setRecipient] = useState("");
  const [transferSuccess, setTransferSuccess] = useState("");
  const [transferReceipts, setTransferReceipts] = useState<TransferReceipt[]>([]);
  const [status, setStatus] = useState("Ready for BNB Smart Chain.");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [isLoadingOwned, setIsLoadingOwned] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const [giftState, setGiftState] = useState<GiftState>(initialGiftState);
  const [isGiftNoticeDismissed, setIsGiftNoticeDismissed] = useState(false);

  const readProvider = useMemo(
    () =>
      new JsonRpcProvider(BSC_RPC_URL, {
        chainId: BSC_CHAIN_ID,
        name: "bnb",
      }),
    [],
  );

  const readContract = useMemo(
    () => new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, readProvider),
    [readProvider],
  );

  const writeContract = useMemo(
    () => (signer ? new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer) : null),
    [signer],
  );

  const connectedToBsc = chainId === BSC_CHAIN_ID;
  const mintCostRaw = contractInfo.priceRaw === null ? null : contractInfo.priceRaw * BigInt(mintQuantity);
  const remainingSupplyRaw =
    contractInfo.remainingSupplyRaw ??
    (contractInfo.totalSupplyRaw !== null && contractInfo.maxSupplyRaw !== null
      ? contractInfo.maxSupplyRaw - contractInfo.totalSupplyRaw
      : null);
  const remainingSupplyNumber =
    remainingSupplyRaw === null ? null : Math.max(0, Number(remainingSupplyRaw));
  const maxSelectableQuantity =
    remainingSupplyNumber === null
      ? MAX_MINT_QUANTITY
      : Math.max(1, Math.min(MAX_MINT_QUANTITY, remainingSupplyNumber));
  const isSoldOut = remainingSupplyNumber !== null && remainingSupplyNumber <= 0;
  const selectedNfts = useMemo(
    () =>
      selectedTokenIds
        .map((tokenId) => ownedNfts.find((nft) => nft.tokenId === tokenId))
        .filter((nft): nft is OwnedNft => Boolean(nft)),
    [ownedNfts, selectedTokenIds],
  );
  const remainingGiftCount = giftRemainingCount(giftState);
  const isGiftEligible = remainingGiftCount > 0n;
  const shouldShowGiftNotice = Boolean(address && isGiftEligible && !isGiftNoticeDismissed);
  const mintedPercent =
    contractInfo.totalSupplyRaw !== null && contractInfo.maxSupplyRaw
      ? Math.min(100, (Number(contractInfo.totalSupplyRaw) / Number(contractInfo.maxSupplyRaw)) * 100)
      : 0;

  const readContractInfo = useCallback(async () => {
    const [name, symbol, supply, maxSupply, remainingSupply, price] = await Promise.all([
      readFirstString(readContract, ["name"], "Ocicat NFT"),
      readFirstString(readContract, ["symbol"], "OCICAT"),
      readFirstBigInt(readContract, SUPPLY_FUNCTIONS),
      readFirstBigInt(readContract, MAX_SUPPLY_FUNCTIONS),
      readFirstBigInt(readContract, ["remainingSupply"]),
      readFirstBigInt(readContract, PRICE_FUNCTIONS),
    ]);

    setContractInfo({
      name,
      symbol,
      totalSupplyRaw: supply?.value ?? null,
      maxSupplyRaw: maxSupply?.value ?? BigInt(EXPECTED_SUPPLY),
      remainingSupplyRaw: remainingSupply?.value ?? null,
      priceRaw: price?.value ?? null,
      supplySource: supply?.source ?? "",
      maxSupplySource: maxSupply?.source ?? "configured",
      priceSource: price?.source ?? "",
    });
  }, [readContract]);

  const getWalletChainId = useCallback(async () => {
    if (!window.ethereum) {
      return null;
    }

    const currentChain = await window.ethereum.request<unknown>({ method: "eth_chainId" });
    const parsedChain = parseChainId(currentChain);
    setChainId(parsedChain);

    return parsedChain;
  }, []);

  const syncConnectedWallet = useCallback(
    async (requestAccounts = false) => {
      if (!window.ethereum) {
        return null;
      }

      const accounts = await window.ethereum.request<string[]>({
        method: requestAccounts ? "eth_requestAccounts" : "eth_accounts",
      });

      const currentChain = await getWalletChainId();

      if (!accounts?.[0]) {
        setAddress("");
        setSigner(null);
        setWalletBalanceRaw(null);
        return null;
      }

      const browserProvider = new BrowserProvider(window.ethereum);
      const connectedSigner = await browserProvider.getSigner();
      const connectedAddress = await connectedSigner.getAddress();
      const balance = await browserProvider.getBalance(connectedAddress);

      setSigner(connectedSigner);
      setAddress(connectedAddress);
      setWalletBalanceRaw(balance);

      if (currentChain === BSC_CHAIN_ID) {
        setStatus(`Connected ${truncateAddress(connectedAddress)} on BNB Smart Chain.`);
      } else {
        setStatus(`Connected ${truncateAddress(connectedAddress)}. Switch to BNB Smart Chain to mint.`);
      }

      return connectedSigner;
    },
    [getWalletChainId],
  );

  const switchToBsc = useCallback(async () => {
    if (!window.ethereum) {
      throw new Error("No injected wallet found. Install MetaMask or another BNB-compatible wallet.");
    }

    const currentChain = await getWalletChainId();
    if (currentChain === BSC_CHAIN_ID) {
      return;
    }

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BSC_CHAIN_ID_HEX }],
      });
    } catch (error) {
      if (errorCode(error) !== 4902) {
        throw error;
      }

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [BNBSmartChainParams],
      });
    }

    setChainId(BSC_CHAIN_ID);
  }, [getWalletChainId]);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setStatus("No injected wallet found. Install MetaMask or another BNB-compatible wallet.");
      return null;
    }

    try {
      setStatus("Connecting wallet...");
      const currentChain = await getWalletChainId();
      if (currentChain !== BSC_CHAIN_ID) {
        await switchToBsc();
      }

      return await syncConnectedWallet(true);
    } catch (error) {
      setStatus(`Wallet connection failed: ${errorMessage(error)}`);
      return null;
    }
  }, [getWalletChainId, switchToBsc, syncConnectedWallet]);

  const copyAddress = useCallback(async () => {
    if (!address) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setStatus("Clipboard copy is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
      setStatus("Wallet address copied.");
    } catch (error) {
      setStatus(`Copy failed: ${errorMessage(error)}`);
    }
  }, [address]);

  const refreshGiftStatus = useCallback(
    async (walletAddress = address) => {
      if (!walletAddress) {
        setGiftState(initialGiftState);
        setIsGiftNoticeDismissed(false);
        return;
      }

      setGiftState((current) => ({ ...current, isLoading: true, error: "" }));

      try {
        const [whitelist, claimed] = await Promise.all([
          contractCall<bigint>(readContract, "whitelist", walletAddress),
          contractCall<bigint>(readContract, "claimed", walletAddress),
        ]);

        setGiftState((current) => ({
          ...current,
          whitelist,
          claimed,
          isLoading: false,
          error: "",
        }));
        setIsGiftNoticeDismissed(false);
      } catch (error) {
        setGiftState((current) => ({
          ...current,
          isLoading: false,
          error: errorMessage(error),
        }));
      }
    },
    [address, readContract],
  );

  const clearTransferSelection = useCallback(() => {
    setSelectedTokenIds([]);
    setTransferSuccess("");
    setTransferReceipts([]);
  }, []);

  const toggleSelectedToken = useCallback((tokenId: number) => {
    setSelectedTokenIds((current) =>
      current.includes(tokenId)
        ? current.filter((currentTokenId) => currentTokenId !== tokenId)
        : [...current, tokenId].sort((left, right) => left - right),
    );
    setTransferSuccess("");
    setTransferReceipts([]);
  }, []);

  const openTransferWithToken = useCallback((tokenId: number) => {
    setSelectedTokenIds([tokenId]);
    setTransferSuccess("");
    setTransferReceipts([]);
    setActiveView("transfer");
  }, []);

  const addSelectedToken = useCallback((value: string) => {
    const tokenId = Number(value);
    if (!Number.isInteger(tokenId) || tokenId < 1) {
      return;
    }

    setSelectedTokenIds((current) =>
      current.includes(tokenId) ? current : [...current, tokenId].sort((left, right) => left - right),
    );
    setTransferSuccess("");
    setTransferReceipts([]);
  }, []);

  const pasteRecipient = useCallback(async () => {
    if (!navigator.clipboard?.readText) {
      setStatus("Clipboard access is not available in this browser.");
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      setRecipient(clipboardText.trim());
      setTransferSuccess("");
      setTransferReceipts([]);
    } catch (error) {
      setStatus(`Paste failed: ${errorMessage(error)}`);
    }
  }, []);

  const disconnectSession = useCallback(() => {
    setAddress("");
    setSigner(null);
    setWalletBalanceRaw(null);
    setOwnedNfts([]);
    setSelectedTokenIds([]);
    setRecipient("");
    setTransferSuccess("");
    setTransferReceipts([]);
    setGiftState(initialGiftState);
    setIsGiftNoticeDismissed(false);
    setIsWalletMenuOpen(false);
    setStatus("App wallet session cleared.");
  }, []);

  const fetchTokenMetadata = useCallback(
    async (tokenId: number): Promise<OwnedNft> => {
      let tokenUri = "";
      let metadataUri = "";
      let metadataUrl = "";
      let imageUri = "";
      let imageUrl = "";

      try {
        tokenUri = await contractCall<string>(readContract, "tokenURI", BigInt(tokenId));
        metadataUri = resolveTokenUri(tokenUri, METADATA_BASE_URI);
        metadataUrl = resolveFetchableUri(tokenUri, METADATA_BASE_URI);
        console.info(`[Ocicat NFT #${tokenId}] contract tokenURI:`, tokenUri);
        console.info(`[Ocicat NFT #${tokenId}] metadata gateway URL:`, metadataUrl);

        const response = await fetch(metadataUrl, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`Metadata request failed with ${response.status}`);
        }

        const metadata = (await response.json()) as NftMetadata;
        imageUri = resolveMetadataImageUri(metadata.image || "", metadataUri);
        imageUrl = ipfsToGatewayUrl(imageUri);
        console.info(`[Ocicat NFT #${tokenId}] image gateway URL:`, imageUrl);

        return {
          tokenId,
          tier: tierForToken(tokenId),
          tokenUri,
          metadataUri,
          metadataUrl,
          imageUri,
          imageUrl,
          metadata,
        };
      } catch (error) {
        return {
          tokenId,
          tier: tierForToken(tokenId),
          tokenUri,
          metadataUri,
          metadataUrl,
          imageUri,
          imageUrl,
          error: errorMessage(error),
        };
      }
    },
    [readContract],
  );

  const scanOwnerTokens = useCallback(
    async (ownerAddress: string) => {
      const supply =
        contractInfo.totalSupplyRaw ??
        (await readFirstBigInt(readContract, SUPPLY_FUNCTIONS))?.value ??
        BigInt(EXPECTED_SUPPLY);
      const limit = Math.min(Number(supply || BigInt(EXPECTED_SUPPLY)), EXPECTED_SUPPLY);
      const found: number[] = [];
      let cursor = 1;

      await Promise.all(
        Array.from({ length: 8 }, async () => {
          while (cursor <= limit) {
            const tokenId = cursor;
            cursor += 1;

            try {
              const owner = await contractCall<string>(readContract, "ownerOf", BigInt(tokenId));
              if (sameAddress(owner, ownerAddress)) {
                found.push(tokenId);
              }
            } catch {
              // Burned or nonexistent token IDs are skipped.
            }
          }
        }),
      );

      return found.sort((a, b) => a - b);
    },
    [contractInfo.totalSupplyRaw, readContract],
  );

  const loadOwnedNfts = useCallback(
    async (ownerAddress = address) => {
      if (!ownerAddress) {
        setOwnedNfts([]);
        return;
      }

      setIsLoadingOwned(true);
      setOwnedNfts([]);
      setStatus("Loading owned Ocicat NFTs...");

      try {
        const balance = await contractCall<bigint>(readContract, "balanceOf", ownerAddress);

        if (balance === 0n) {
          setOwnedNfts([]);
          setStatus("Wallet connected. No Ocicat NFTs detected yet.");
          return;
        }

        const tokenIds: number[] = [];

        try {
          for (let index = 0; index < Number(balance); index += 1) {
            const tokenId = await contractCall<bigint>(
              readContract,
              "tokenOfOwnerByIndex",
              ownerAddress,
              BigInt(index),
            );
            tokenIds.push(Number(tokenId));
          }
        } catch {
          tokenIds.push(...(await scanOwnerTokens(ownerAddress)));
        }

        const uniqueIds = Array.from(new Set(tokenIds)).sort((a, b) => a - b);
        const metadata = await Promise.all(uniqueIds.map((tokenId) => fetchTokenMetadata(tokenId)));
        const nextTokenIdSet = new Set(uniqueIds);

        setOwnedNfts(metadata);
        setSelectedTokenIds((current) => current.filter((tokenId) => nextTokenIdSet.has(tokenId)));
        setStatus(`Loaded ${metadata.length} owned Ocicat NFT${metadata.length === 1 ? "" : "s"}.`);
      } catch (error) {
        setStatus(`Owned NFT lookup failed: ${errorMessage(error)}`);
      } finally {
        setIsLoadingOwned(false);
      }
    },
    [address, fetchTokenMetadata, readContract, scanOwnerTokens],
  );

  const claimGift = useCallback(async () => {
    if (!writeContract || !address) {
      setStatus("Connect your wallet before claiming a gift.");
      return;
    }

    if (!isGiftEligible) {
      setStatus(giftStatusLabel(giftState));
      return;
    }

    if (!connectedToBsc) {
      try {
        await switchToBsc();
      } catch (error) {
        setStatus(`Switch to BNB Chain failed: ${errorMessage(error)}`);
        return;
      }
    }

    setGiftState((current) => ({ ...current, isClaiming: true, error: "", txHash: "" }));
    setStatus("Waiting for wallet confirmation to claim your free OciCat NFT...");

    try {
      const tx = await contractCall<TxResponse>(writeContract, "claim");

      setGiftState((current) => ({ ...current, txHash: tx.hash }));
      setStatus(`Gift claim submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Gift claimed successfully. Refreshing your collection...");
      await Promise.all([refreshGiftStatus(address), loadOwnedNfts(address), readContractInfo()]);
    } catch (error) {
      const message = errorMessage(error);
      await refreshGiftStatus(address);
      setStatus(`Gift claim failed: ${message}`);
    } finally {
      setGiftState((current) => ({ ...current, isClaiming: false }));
    }
  }, [
    address,
    connectedToBsc,
    giftState,
    isGiftEligible,
    loadOwnedNfts,
    readContractInfo,
    refreshGiftStatus,
    switchToBsc,
    writeContract,
  ]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    setStatus("Refreshing contract data...");

    try {
      await readContractInfo();
      if (address) {
        await Promise.all([loadOwnedNfts(address), refreshGiftStatus(address)]);
      } else {
        setStatus("Contract data refreshed.");
      }
    } catch (error) {
      setStatus(`Refresh failed: ${errorMessage(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [address, loadOwnedNfts, readContractInfo, refreshGiftStatus]);

  const mint = useCallback(async () => {
    if (!window.ethereum) {
      setStatus("No injected wallet found.");
      return;
    }

    setIsMinting(true);

    try {
      const currentChain = await getWalletChainId();
      if (currentChain !== BSC_CHAIN_ID) {
        await switchToBsc();
      }

      const activeSigner = signer ?? (await syncConnectedWallet(true));
      if (!activeSigner) {
        setStatus("Connect your wallet to mint.");
        return;
      }

      const activeAddress = await activeSigner.getAddress();
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, activeSigner);
      const quantity = Math.max(1, Math.min(MAX_MINT_QUANTITY, mintQuantity));

      if (remainingSupplyNumber !== null && remainingSupplyNumber <= 0) {
        setStatus("Mint is sold out.");
        return;
      }

      if (remainingSupplyNumber !== null && quantity > remainingSupplyNumber) {
        setStatus(`Only ${remainingSupplyNumber} Ocicat NFT${remainingSupplyNumber === 1 ? "" : "s"} remaining.`);
        return;
      }

      const livePrice = contractInfo.priceRaw ?? (await readFirstBigInt(contract, PRICE_FUNCTIONS))?.value ?? 0n;
      let value = livePrice * BigInt(quantity);
      const candidates = quantity === 1 ? SINGLE_MINT_FUNCTIONS : MINT_FUNCTIONS;
      let lastError = "No mint function succeeded.";

      try {
        value = await contractCall<bigint>(contract, "quote", BigInt(quantity));
      } catch {
        // Older mint contracts may not have quote(amount), so fall back to price * quantity.
      }

      const balance = await activeSigner.provider.getBalance(activeAddress);
      setWalletBalanceRaw(balance);

      if (balance < value) {
        setStatus(`Insufficient BNB balance. Required total is ${formatBnb(value)}.`);
        return;
      }

      setStatus(`Submitting mint for ${quantity} Ocicat NFT${quantity === 1 ? "" : "s"}...`);

      for (const candidate of candidates) {
        try {
          const tx =
            candidate === "mint()"
              ? await contractCall<TxResponse>(contract, candidate, { value })
              : await contractCall<TxResponse>(contract, candidate, BigInt(quantity), { value });

          setStatus(`Mint submitted: ${tx.hash}`);
          await tx.wait();
          setStatus("Mint confirmed. Refreshing your dashboard...");
          await refreshAll();
          setActiveView("dashboard");
          return;
        } catch (error) {
          lastError = errorMessage(error);
        }
      }

      throw new Error(lastError);
    } catch (error) {
      setStatus(`Mint failed: ${errorMessage(error)}`);
    } finally {
      setIsMinting(false);
    }
  }, [
    contractInfo.priceRaw,
    getWalletChainId,
    mintQuantity,
    remainingSupplyNumber,
    refreshAll,
    signer,
    switchToBsc,
    syncConnectedWallet,
  ]);

  const transfer = useCallback(async () => {
    if (!writeContract || !address) {
      setStatus("Connect your wallet before transferring.");
      return;
    }

    if (!connectedToBsc) {
      try {
        await switchToBsc();
      } catch (error) {
        setStatus(`Switch to BNB Chain failed: ${errorMessage(error)}`);
        return;
      }
    }

    if (!isAddress(recipient)) {
      setStatus("Enter a valid recipient address.");
      return;
    }

    if (sameAddress(address, recipient)) {
      setStatus("Enter a recipient different from your connected wallet.");
      return;
    }

    const tokenIds = Array.from(new Set(selectedTokenIds)).sort((left, right) => left - right);

    if (tokenIds.length === 0) {
      setStatus("Select at least one owned NFT to transfer.");
      return;
    }

    const ownedTokenIds = new Set(ownedNfts.map((nft) => nft.tokenId));

    if (tokenIds.some((tokenId) => !ownedTokenIds.has(tokenId))) {
      setStatus("Selection includes an NFT not owned by the connected wallet.");
      return;
    }

    setIsTransferring(true);
    setTransferSuccess("");
    setTransferReceipts([]);
    setStatus(`Sending ${tokenIds.length} Ocicat NFT${tokenIds.length === 1 ? "" : "s"}...`);

    try {
      const isApprovedForBatch = await contractCall<boolean>(
        writeContract,
        "isApprovedForAll",
        address,
        CONTRACT_ADDRESS,
      );

      if (!isApprovedForBatch) {
        setStatus("Approval required before batch send. Confirm approval in your wallet...");
        const approvalTx = await contractCall<TxResponse>(
          writeContract,
          "setApprovalForAll",
          CONTRACT_ADDRESS,
          true,
        );
        setStatus(`Approval submitted: ${approvalTx.hash}`);
        await approvalTx.wait();
        setStatus("Approval confirmed. Sending selected NFTs...");
      }

      const tx = await contractCall<TxResponse>(
        writeContract,
        "batchTransferTo",
        recipient,
        tokenIds.map((tokenId) => BigInt(tokenId)),
      );

      setTransferReceipts([{ tokenIds, hash: tx.hash }]);
      setStatus(`Batch transfer submitted: ${tx.hash}`);
      await tx.wait();

      setRecipient("");
      await loadOwnedNfts(address);
      setSelectedTokenIds([]);
      setTransferSuccess(
        `Sent ${tokenIds.length} Ocicat NFT${tokenIds.length === 1 ? "" : "s"} successfully.`,
      );
      setStatus(
        `Transfer complete: ${tokenIds.map((tokenId) => `#${tokenId}`).join(", ")} sent.`,
      );
    } catch (error) {
      setStatus(`Transfer failed: ${errorMessage(error)}`);
    } finally {
      setIsTransferring(false);
    }
  }, [
    address,
    connectedToBsc,
    loadOwnedNfts,
    ownedNfts,
    recipient,
    selectedTokenIds,
    switchToBsc,
    writeContract,
  ]);

  useEffect(() => {
    readContractInfo().catch((error) => setStatus(`Initial contract read failed: ${errorMessage(error)}`));
  }, [readContractInfo]);

  useEffect(() => {
    setMintQuantity((current) => Math.min(clampQuantity(current), maxSelectableQuantity));
  }, [maxSelectableQuantity]);

  useEffect(() => {
    syncConnectedWallet(false).catch(() => {
      // Passive wallet detection is best effort and should never block the public mint page.
    });
  }, [syncConnectedWallet]);

  useEffect(() => {
    if (!address) {
      setGiftState(initialGiftState);
      setIsGiftNoticeDismissed(false);
      return;
    }

    loadOwnedNfts(address).catch((error) => setStatus(`Owned NFT load failed: ${errorMessage(error)}`));
  }, [address, loadOwnedNfts]);

  useEffect(() => {
    if (!address) {
      return;
    }

    refreshGiftStatus(address).catch((error) => setStatus(`Gift lookup failed: ${errorMessage(error)}`));
  }, [address, refreshGiftStatus]);

  useEffect(() => {
    if (!window.ethereum) {
      return undefined;
    }

    const handleAccounts = (...args: unknown[]) => {
      const accounts = (args[0] as string[]) || [];
      setAddress(accounts[0] || "");
      if (!accounts[0]) {
        setSigner(null);
        setOwnedNfts([]);
        setSelectedTokenIds([]);
        setRecipient("");
        setTransferSuccess("");
        setTransferReceipts([]);
        setGiftState(initialGiftState);
        setIsGiftNoticeDismissed(false);
        setWalletBalanceRaw(null);
        return;
      }

      syncConnectedWallet(false).catch((error) =>
        setStatus(`Wallet refresh failed: ${errorMessage(error)}`),
      );
    };

    const handleChain = (...args: unknown[]) => {
      const nextChain = args[0];
      const parsedChain = parseChainId(nextChain);
      setChainId(parsedChain);
      if (parsedChain === BSC_CHAIN_ID) {
        setStatus("Connected to BNB Smart Chain.");
      } else if (parsedChain !== null) {
        setStatus("Switch to BNB Smart Chain to mint or transfer.");
      }

      syncConnectedWallet(false).catch(() => {
        // Chain changes can happen while the wallet is locked; ignore passive refresh failures.
      });
    };

    window.ethereum.on?.("accountsChanged", handleAccounts);
    window.ethereum.on?.("chainChanged", handleChain);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum?.removeListener?.("chainChanged", handleChain);
    };
  }, [syncConnectedWallet]);

  return (
    <div className="app">
      <header className="site-header">
        <button className="brand-mark" type="button" onClick={() => setActiveView("mint")}>
          <img src="/brand/ocicatlogo.png" alt="Ocicat logo" />
          <span>OCICAT NFT</span>
        </button>

        <nav className="nav-actions" aria-label="Primary">
          <button className={activeView === "mint" ? "active" : ""} onClick={() => setActiveView("mint")}>
            Mint
          </button>
          <button
            className={activeView === "dashboard" ? "active" : ""}
            onClick={() => setActiveView("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={activeView === "transfer" ? "active" : ""}
            onClick={() => setActiveView("transfer")}
          >
            Transfer
          </button>
        </nav>

        <div className="wallet-actions">
          <button className="icon-button" type="button" onClick={refreshAll} aria-label="Refresh">
            <RefreshCcw size={18} className={isRefreshing ? "spin" : ""} />
          </button>
          <div className="wallet-menu">
            <button
              className="connect-button"
              type="button"
              onClick={() => {
                if (!address) {
                  connectWallet();
                  return;
                }

                setIsWalletMenuOpen((current) => !current);
              }}
              aria-expanded={address ? isWalletMenuOpen : undefined}
            >
              <Wallet size={18} />
              {address ? (
                <span>{truncateAddress(address)}</span>
              ) : (
                <>
                  <span className="wallet-label-full">Connect Wallet</span>
                  <span className="wallet-label-short">Connect</span>
                </>
              )}
              {address && <ChevronDown size={16} />}
            </button>

            {address && isWalletMenuOpen && (
              <div className="wallet-dropdown">
                <div className="wallet-profile-head">
                  <span>Wallet Profile</span>
                  <strong>{truncateAddress(address)}</strong>
                  <button
                    className="wallet-close-button"
                    type="button"
                    onClick={() => setIsWalletMenuOpen(false)}
                    aria-label="Close wallet profile"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="wallet-address-row">
                  <span>Full Address</span>
                  <strong>{address}</strong>
                  <button className="inline-icon-button" type="button" onClick={copyAddress}>
                    <Copy size={14} />
                    Copy
                  </button>
                </div>
                <div>
                  <span>BNB Balance</span>
                  <strong>{walletBalanceRaw === null ? "--" : formatBnb(walletBalanceRaw)}</strong>
                </div>
                <div>
                  <span>Network</span>
                  <strong>{connectedToBsc ? "BNB Smart Chain" : "Switch required"}</strong>
                </div>
                <div>
                  <span>Owned NFTs</span>
                  <strong>{ownedNfts.length.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Gift Status</span>
                  <strong>{giftStatusLabel(giftState)}</strong>
                </div>
                <section className="gift-history">
                  {giftState.isLoading ? (
                    <p>Checking gifts...</p>
                  ) : isGiftEligible ? (
                    <article className="gift-card available">
                      <strong className="gift-quantity">🎁 {formatGiftCount(remainingGiftCount)}</strong>
                      <button type="button" onClick={claimGift} disabled={giftState.isClaiming}>
                        {giftState.isClaiming ? <Loader2 className="spin" size={14} /> : <Gift size={14} />}
                        Claim Free Gift
                      </button>
                    </article>
                  ) : (
                    <p>No gifts found.</p>
                  )}

                  {giftState.txHash && (
                    <a
                      className="gift-tx-link"
                      href={`https://bscscan.com/tx/${giftState.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Gift transaction
                      <ExternalLink size={14} />
                    </a>
                  )}
                </section>
                <button type="button" onClick={disconnectSession}>
                  <LogOut size={16} />
                  Disconnect app session
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main>
        {activeView === "mint" && (
          <>
            <section className="hero">
              <div className="hero-bg" />
              <div className="hero-content">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <ShieldCheck size={18} />
                    BNB Smart Chain Mainnet
                  </div>
                  <h1>
                    OCICAT
                    <span>NFT</span>
                  </h1>
                  <p>
                    The Dreamers Club mint for 3000 OciCats on BNB Smart Chain.
                  </p>
                  <div className="contract-link-panel">
                    <a
                      href={`https://bscscan.com/address/${CONTRACT_ADDRESS}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Verified Contract
                      <ExternalLink size={16} />
                    </a>
                  </div>
                </div>

                <img className="hero-cat" src="/brand/catimage.png" alt="Ocicat character" />

                <div className="mint-panel">
                  <div className="panel-title">
                    <Zap size={20} />
                    Live Mint
                  </div>
                  <dl className="stat-grid">
                    <div>
                      <dt>Price</dt>
                      <dd>{formatBnb(contractInfo.priceRaw)}</dd>
                    </div>
                    <div>
                      <dt>Supply</dt>
                      <dd>
                        {formatNumber(contractInfo.totalSupplyRaw)} / {formatNumber(contractInfo.maxSupplyRaw)}
                      </dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd>{formatBnb(mintCostRaw)}</dd>
                    </div>
                    <div>
                      <dt>Wallet</dt>
                      <dd>{walletBalanceRaw === null ? "--" : formatBnb(walletBalanceRaw)}</dd>
                    </div>
                  </dl>
                  <div className="supply-meter" aria-label="Mint progress">
                    <span style={{ width: `${mintedPercent}%` }} />
                  </div>
                  <div className="field">
                    <span>Quantity</span>
                    <div className="quantity-control" aria-label="Mint quantity">
                      <button
                        type="button"
                        onClick={() => setMintQuantity((current) => clampQuantity(current - 1))}
                        disabled={mintQuantity <= 1}
                        aria-label="Decrease quantity"
                      >
                        <Minus size={18} />
                      </button>
                      <strong>{mintQuantity}</strong>
                      <button
                        type="button"
                        onClick={() =>
                          setMintQuantity((current) =>
                            Math.min(clampQuantity(current + 1), maxSelectableQuantity),
                          )
                        }
                        disabled={mintQuantity >= maxSelectableQuantity || isSoldOut}
                        aria-label="Increase quantity"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <small>Max 100 per wallet</small>
                  </div>
                  <button className="primary-action" type="button" onClick={mint} disabled={isMinting || isSoldOut}>
                    {isMinting ? <Loader2 className="spin" size={18} /> : <Cat size={18} />}
                    {isSoldOut ? "Sold Out" : address ? "Mint Ocicat" : "Connect to Mint"}
                  </button>
                  {address && !connectedToBsc && (
                    <button className="secondary-action" type="button" onClick={switchToBsc}>
                      Switch to BNB Chain
                      <ExternalLink size={18} />
                    </button>
                  )}
                </div>
              </div>
            </section>

            <div className="ticker-strip" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => (
                <span key={index}>$OCICAT</span>
              ))}
            </div>
          </>
        )}

        <section className={`status-band ${activeView === "mint" ? "" : "with-top-offset"}`}>
          <div className={connectedToBsc ? "network-dot ok" : "network-dot"} />
          <span>{status}</span>
        </section>

        {shouldShowGiftNotice && (
          <section className="gift-notice">
            <div>
              <Gift size={22} />
              <span>🎁 {formatGiftCount(remainingGiftCount)}</span>
            </div>
            <div>
              <button type="button" onClick={claimGift} disabled={giftState.isClaiming}>
                {giftState.isClaiming ? <Loader2 className="spin" size={16} /> : <Gift size={16} />}
                Claim Free Gift
              </button>
              <button type="button" onClick={() => setIsGiftNoticeDismissed(true)} aria-label="Dismiss gift notice">
                <X size={16} />
              </button>
            </div>
          </section>
        )}

        {activeView === "mint" && (
          <section className="content-section">
            <div className="section-heading">
              <p>Collection Tiers</p>
              <h2>Tiger Blood. Wildclaw. Alley Cat.</h2>
            </div>
            <div className="tier-grid">
              {tiers.map((tier) => (
                <article className={`tier-card ${tier.tone}`} key={tier.name}>
                  <img src={tier.sample} alt={`${tier.name} sample`} />
                  <div>
                    <p>{tier.range}</p>
                    <h3>{tier.name}</h3>
                    <span>{tier.copy}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeView === "dashboard" && (
          <section className="content-section dashboard-layout">
            <aside className="info-panel">
              <div className="panel-title">
                <Database size={20} />
                Contract Data
              </div>
              <dl className="read-list">
                <div>
                  <dt>Name</dt>
                  <dd>{contractInfo.name}</dd>
                </div>
                <div>
                  <dt>Symbol</dt>
                  <dd>{contractInfo.symbol}</dd>
                </div>
                <div>
                  <dt>Mint Price</dt>
                  <dd>{formatBnb(contractInfo.priceRaw)}</dd>
                </div>
                <div>
                  <dt>Total Supply</dt>
                  <dd>
                    {formatNumber(contractInfo.totalSupplyRaw)} / {formatNumber(contractInfo.maxSupplyRaw)}
                  </dd>
                </div>
                <div>
                  <dt>Remaining</dt>
                  <dd>{remainingSupplyRaw === null ? "--" : formatNumber(remainingSupplyRaw)}</dd>
                </div>
                <div>
                  <dt>Metadata Status</dt>
                  <dd>Live IPFS</dd>
                </div>
                <div>
                  <dt>Contract</dt>
                  <dd>
                    <a
                      href={`https://bscscan.com/address/${CONTRACT_ADDRESS}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Verified on BscScan
                    </a>
                  </dd>
                </div>
              </dl>
            </aside>

            <div className="nft-panel">
              <div className="panel-header">
                <div>
                  <p>Owned NFTs</p>
                  <h2>{ownedNfts.length ? `${ownedNfts.length} detected` : "No NFTs loaded"}</h2>
                </div>
                <div className="panel-actions">
                  <span className="selected-count">
                    Selected: {selectedTokenIds.length} NFT{selectedTokenIds.length === 1 ? "" : "s"}
                  </span>
                  <button
                    className="secondary-action compact"
                    type="button"
                    onClick={() => setActiveView("transfer")}
                    disabled={selectedTokenIds.length === 0}
                  >
                    Send Selected
                    <Send size={16} />
                  </button>
                  <button
                    className="secondary-action compact"
                    type="button"
                    onClick={() => loadOwnedNfts()}
                    disabled={!address || isLoadingOwned}
                  >
                    {isLoadingOwned ? <Loader2 className="spin" size={16} /> : <ImageIcon size={16} />}
                    Load
                  </button>
                </div>
              </div>

              {ownedNfts.length === 0 ? (
                <div className="empty-state">
                  <img src="/brand/platformcat.jpeg" alt="Ocicat with rocket" />
                  <p>
                    {address
                      ? "No Ocicat NFTs found in this wallet yet."
                      : "Connect the holding wallet to load your Ocicat NFTs here."}
                  </p>
                </div>
              ) : (
                <div className="owned-grid">
                  {ownedNfts.map((nft) => (
                    <article
                      className={`nft-card ${selectedTokenIds.includes(nft.tokenId) ? "selected" : ""}`}
                      key={nft.tokenId}
                    >
                      <NftImage nft={nft} />
                      <div>
                        <p>{nft.tier}</p>
                        <h3>{nft.metadata?.name || `Ocicat #${nft.tokenId}`}</h3>
                        <strong className="token-id-pill">Token ID #{nft.tokenId}</strong>
                        <span>{nft.error ? "Metadata unavailable" : "Live IPFS metadata"}</span>
                      </div>
                      <div className="trait-row">
                        {traitPreview(nft.metadata).map((attribute) => (
                          <span key={`${attribute.trait_type}-${attribute.value}`}>
                            {attribute.trait_type}: {attribute.value}
                          </span>
                        ))}
                      </div>
                      <div className="card-actions">
                        <label className="select-toggle">
                          <input
                            type="checkbox"
                            checked={selectedTokenIds.includes(nft.tokenId)}
                            onChange={() => toggleSelectedToken(nft.tokenId)}
                          />
                          Select
                        </label>
                        <button
                          className="secondary-action compact"
                          type="button"
                          onClick={() => openTransferWithToken(nft.tokenId)}
                        >
                          Send
                          <Send size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeView === "transfer" && (
          <section className="content-section transfer-layout">
            <div className="transfer-panel">
              <div className="panel-title">
                <Send size={20} />
                Transfer NFTs
              </div>
              {transferSuccess && (
                <div className="success-state">
                  <CheckCircle2 size={18} />
                  <span>{transferSuccess}</span>
                </div>
              )}
              <label className="field">
                <span>Add owned token</span>
                <select
                  value=""
                  onChange={(event) => addSelectedToken(event.target.value)}
                  disabled={!ownedNfts.length}
                >
                  <option value="">Select token to add</option>
                  {ownedNfts
                    .filter((nft) => !selectedTokenIds.includes(nft.tokenId))
                    .map((nft) => (
                    <option value={nft.tokenId} key={nft.tokenId}>
                      #{nft.tokenId} - {nft.tier}
                    </option>
                  ))}
                </select>
              </label>

              <div className="selected-transfer-list">
                <span>Selected NFTs</span>
                {selectedNfts.length === 0 ? (
                  <p>No NFTs selected yet. Choose from the dropdown or click Send on a card.</p>
                ) : (
                  <div>
                    {selectedNfts.map((nft) => (
                      <button type="button" key={nft.tokenId} onClick={() => toggleSelectedToken(nft.tokenId)}>
                        #{nft.tokenId}
                        <X size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <p className="transfer-warning">{BATCH_TRANSFER_NOTICE}</p>
              <p className="transfer-helper">
                If approval is not active, your wallet will ask to approve the NFT contract before sending.
              </p>

              <label className="field">
                <span>Recipient</span>
                <div className="recipient-row">
                  <input
                    value={recipient}
                    onChange={(event) => {
                      setRecipient(event.target.value);
                      setTransferSuccess("");
                      setTransferReceipts([]);
                    }}
                    placeholder="0x..."
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                  />
                  <button className="icon-button" type="button" onClick={pasteRecipient} aria-label="Paste recipient">
                    <Clipboard size={17} />
                  </button>
                </div>
              </label>

              <div className="transfer-actions">
                <button
                  className="secondary-action compact"
                  type="button"
                  onClick={clearTransferSelection}
                  disabled={!selectedTokenIds.length || isTransferring}
                >
                  Clear Selection
                </button>
              </div>

              <button
                className="primary-action"
                type="button"
                onClick={transfer}
                disabled={isTransferring || !selectedTokenIds.length}
              >
                {isTransferring ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
                Send Selected NFTs
              </button>

              {transferReceipts.length > 0 && (
                <div className="tx-list">
                  <span>Transactions</span>
                  {transferReceipts.map((receipt) => (
                    <a
                      href={`https://bscscan.com/tx/${receipt.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      key={receipt.hash}
                    >
                      Ocicat {receipt.tokenIds.map((tokenId) => `#${tokenId}`).join(", ")}
                      <ExternalLink size={14} />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="info-panel">
              <div className="panel-title">
                <Coins size={20} />
                Selected Collection
              </div>
              <div className="transfer-preview-grid">
                {selectedNfts.length === 0 ? (
                  <div className="empty-state compact">
                    <p>Select NFTs from the Dashboard, then send them to one wallet.</p>
                  </div>
                ) : (
                  selectedNfts.map((nft) => (
                    <article className="transfer-preview-card" key={nft.tokenId}>
                      <NftImage nft={nft} />
                      <strong>#{nft.tokenId}</strong>
                      <span>{nft.tier}</span>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>Ocicat NFT</span>
        <nav aria-label="Social links">
          {SOCIAL_LINKS.map((link) => (
            <a href={link.href} target="_blank" rel="noreferrer" key={link.href}>
              {link.label}
              <ExternalLink size={14} />
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
