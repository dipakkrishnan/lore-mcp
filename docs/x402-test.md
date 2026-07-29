# Lore x402 two-person test

Lore is the seller. Shane supplies the x402-aware buyer and runs the live
Base Sepolia exchange.

## Seller setup

1. Create a CDP project and API key in the
   [Coinbase Developer Platform](https://portal.cdp.coinbase.com/).
2. Choose an EVM address that will receive test USDC. The seller never shares
   its private key with Lore or Coinbase's facilitator.
3. On this branch, install and configure Lore:

   ```sh
   uv sync --extra payments
   uv run --extra payments lore price 0.01

   export LORE_X402_PAY_TO=0xSellerAddress
   export LORE_X402_NETWORK=eip155:84532
   export CDP_API_KEY_ID=organizations/.../apiKeys/...
   export CDP_API_KEY_SECRET='-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n'

   uv run --extra payments lore serve --transport http --host 127.0.0.1 --port 8765
   ```

4. Expose `POST /mcp` through the agreed tunnel. If the origin is bound
   off-loopback, also set `LORE_MCP_TOKEN` and give Shane that bearer token.

Lore contacts Coinbase only for `/supported`, `/verify`, and `/settle`.
The CDP API secret is used only to generate short-lived authentication JWTs.

## Shane's buyer setup

Shane needs:

- the Lore MCP URL and optional bearer token;
- an EVM wallet private key he controls;
- Base Sepolia test USDC, and test ETH if his wallet tooling requires it;
- an MCP client wrapped by the official x402 Python MCP client.

Use Coinbase's
[buyer quickstart](https://docs.cdp.coinbase.com/x402/quickstart-for-buyers),
[CDP faucet](https://portal.cdp.coinbase.com/products/faucet), and the official
[Python MCP client example](https://github.com/x402-foundation/x402/tree/main/examples/python/clients/mcp).

## Expected test

1. `discover` succeeds without payment.
2. The first `answer` call returns an MCP error result containing structured
   x402 payment requirements for `$0.01` USDC on `eip155:84532`.
3. Shane explicitly approves the payment.
4. His client signs the authorization and retries with
   `_meta["x402/payment"]`.
5. Lore verifies it with Coinbase, retrieves only owner-approved external
   memories, settles it, and returns the answer plus
   `_meta["x402/payment-response"]`.
6. Confirm the receipt's transaction on Base Sepolia and confirm the seller
   address received the test USDC.

Do not use a mainnet wallet or mainnet USDC for this test.

## Reference

- [Coinbase seller quickstart](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers)
- [Coinbase x402 facilitator API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/x402-facilitator)
- [Coinbase JWT authentication](https://docs.cdp.coinbase.com/get-started/authentication/jwt-authentication)
- [x402 Python SDK](https://pypi.org/project/x402/)
