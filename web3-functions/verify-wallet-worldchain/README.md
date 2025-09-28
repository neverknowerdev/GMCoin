# Worldchain Verification Web3 Function

This Web3 Function handles Worldchain verification by listening to the `requestWorldchainVerification` event from the smart contract and verifying the proof against Worldchain's cloud verification service.

## Overview

The function:
1. Listens for `requestWorldchainVerification` events from the smart contract
2. Extracts verification data from the event payload
3. Calls Worldchain's cloud verification API
4. On success: calls `verifyWalletWorldchain` on the smart contract
5. On failure: calls `verifyWalletWorldchainError` on the smart contract

## Configuration

### Environment Variables

Set the following in your Gelato Web3 Function secrets:

- `WORLDCHAIN_APP_ID`: Your Worldchain application ID from the Developer Portal

### User Arguments

- `verifierContractAddress`: The address of the Verification smart contract

## Event Structure

The function expects the `requestWorldchainVerification` event with:
- `wallet`: The wallet address to verify
- `signatureSignal`: The signature signal (not used in cloud verification)
- `payload`: JSON string containing verification data

### Payload Format

The payload should contain:
```json
{
  "nullifier_hash": "0x...",
  "merkle_root": "0x...",
  "proof": "0x...",
  "verification_level": "orb",
  "action": "verify_human",
  "signal": "optional custom signal"
}
```

## API Integration

The function integrates with Worldchain's Cloud Verification API:
- Endpoint: `https://developer.world.org/api/v2/verify/{app_id}`
- Method: POST
- Content-Type: application/json

## Error Handling

The function handles various error scenarios:
- Missing environment variables
- Invalid payload format
- HTTP errors from Worldchain API
- Verification failures
- Network timeouts

## Smart Contract Functions

### Success Case
Calls `verifyWalletWorldchain(address wallet)` to mark the wallet as verified.

### Error Case
Calls `verifyWalletWorldchainError(address wallet, uint8 verificationType, string errorMsg)` to log the error.

## Testing

Use the `userArgs.json` file to configure test parameters:
```json
{
  "verifierContractAddress": "0xYourContractAddress"
}
```

## References

- [Worldchain Cloud Verification Documentation](https://docs.world.org/world-id/id/cloud)
- [Gelato Web3 Functions Documentation](https://docs.gelato.network/developer-products/web3-functions)
