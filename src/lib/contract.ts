export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = "0x38";
export const BSC_RPC_URL =
  import.meta.env.VITE_BSC_RPC_URL || "https://bsc-dataseed.binance.org";

export const CONTRACT_ADDRESS = "0x90bdea0ddb6160faf6115dc35317c05cc911be22";

export const CONTRACT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function minted() view returns (uint256)",
  "function currentTokenId() view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function MAX_NFT_SUPPLY() view returns (uint256)",
  "function collectionSize() view returns (uint256)",
  "function baseURI() view returns (string)",
  "function mintPrice() view returns (uint256)",
  "function mintPriceInWei() view returns (uint256)",
  "function publicMintPrice() view returns (uint256)",
  "function price() view returns (uint256)",
  "function cost() view returns (uint256)",
  "function MINT_PRICE() view returns (uint256)",
  "function mintCost() view returns (uint256)",
  "function quote(uint256 amount) view returns (uint256)",
  "function remainingSupply() view returns (uint256)",
  "function soldOut() view returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function whitelist(address account) view returns (uint256)",
  "function claimed(address account) view returns (uint256)",
  "function mint(uint256 quantity) payable",
  "function claim()",
  "function publicMint(uint256 quantity) payable",
  "function mintNFT(uint256 quantity) payable",
  "function safeMint(uint256 quantity) payable",
  "function mint() payable",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function batchTransfer(address[] recipients, uint256[] tokenIds)",
  "function batchTransferTo(address recipient, uint256[] tokenIds)",
  "function setBaseURI(string baseURI)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
] as const;

export const BNBSmartChainParams = {
  chainId: BSC_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain Mainnet",
  nativeCurrency: {
    name: "BNB",
    symbol: "BNB",
    decimals: 18,
  },
  rpcUrls: [BSC_RPC_URL],
  blockExplorerUrls: ["https://bscscan.com"],
};

export const METADATA_BASE_URI = import.meta.env.VITE_METADATA_BASE_URI || "";
