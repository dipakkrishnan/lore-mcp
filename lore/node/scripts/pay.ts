import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { toClientEvmSigner } from "@x402/evm";
import { withX402Client } from "agents/x402";
import { createPublicClient, formatUnits, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { PRICE_USD, usdcBaseUnits } from "../src/price.js";

const BUYER_ENV = new URL("../.buyer.env", import.meta.url);
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// The throwaway buyer provisions itself: no wallet-app key export (passkey
// accounts have none to give), no hand-edited env file to destroy a key with.
function buyerKey(): `0x${string}` {
  try {
    const match = readFileSync(BUYER_ENV, "utf8").match(
      /^BUYER_TEST_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m
    );
    if (match) return match[1] as `0x${string}`;
    console.error("A malformed .buyer.env is not worth repairing — replacing it.");
    unlinkSync(BUYER_ENV);
  } catch {
    // No file yet: first run.
  }
  const key = generatePrivateKey();
  writeFileSync(
    BUYER_ENV,
    "# Dedicated Base Sepolia test key only. Never use a funded mainnet key.\n" +
      `BUYER_TEST_PRIVATE_KEY=${key}\n`,
    { mode: 0o400 }
  );
  return key;
}

const endpoint = process.argv[2];
if (!endpoint) {
  console.error("usage: npm run pay -- https://<worker>/mcp");
  process.exit(1);
}

const account = privateKeyToAccount(buyerKey());

const balance = await createPublicClient({
  chain: baseSepolia,
  transport: http()
}).readContract({
  address: USDC_BASE_SEPOLIA,
  abi: [
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "uint256" }]
    }
  ],
  functionName: "balanceOf",
  args: [account.address]
});

if (balance < usdcBaseUnits(PRICE_USD)) {
  console.error(
    `The test buyer holds ${formatUnits(balance, 6)} USDC on Base Sepolia and ` +
      `needs $${PRICE_USD}.\n\n` +
      `Fund this address with testnet USDC, then re-run:\n\n` +
      `  ${account.address}\n\n` +
      `Faucets: https://portal.cdp.coinbase.com/products/faucet (defaults to\n` +
      `Base Sepolia) or https://faucet.circle.com (set the network dropdown to\n` +
      `Base Sepolia — it defaults elsewhere, and a wrong-network send reports\n` +
      `success anyway). Already sent? It went to another network or another\n` +
      `address: https://sepolia.basescan.org/address/${account.address}`
  );
  process.exit(1);
}

const client = new Client({ name: "lore-canary-buyer", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

const paidClient = withX402Client(client, {
  account: toClientEvmSigner(account),
  network: "eip155:84532",
  maxPaymentValue: usdcBaseUnits(PRICE_USD)
});

try {
  // null selects withX402Client's default payment-approval callback.
  const result = await paidClient.callTool(null, {
    name: "answer",
    arguments: { query: "What is Lore?" }
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
