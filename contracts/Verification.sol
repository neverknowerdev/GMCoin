// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';

import { GMStorage } from './Storage.sol';

contract Verification is GMStorage {
  event requestWorldchainVerification(address wallet, bytes signatureSignal, string payload);

  event walletVerified(address wallet, VerificationType verificationType);
  event walletVerificationErrored(address wallet, VerificationType verificationType, string errorMsg);
  function requestWorldchainVerificationRelayer(
    bytes calldata signatureSignal,
    string calldata payload,
    address wallet
  ) public onlyServerRelayer {
    require(wallet != address(0), 'empty wallet');

    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash("I verify I'm human using Worldchain"),
      signatureSignal
    );

    require(recoveredSigner != address(0), 'empty signer');
    require(recoveredSigner == wallet, 'wrong signer or signature');

    emit requestWorldchainVerification(wallet, signatureSignal, payload);
  }

  function verifyWalletWorldchain(address wallet) public onlyGelato {
    mintingData.walletVerification[wallet] = VerificationType.WorldChainDevice;

    emit walletVerified(wallet, VerificationType.WorldChainDevice);
  }

  function verifyWalletWorldchainError(
    address wallet,
    VerificationType verificationType,
    string calldata errorMsg
  ) public onlyGelato {
    emit walletVerificationErrored(wallet, verificationType, errorMsg);
  }

  modifier onlyGelato() virtual {
    _;
  }

  modifier onlyServerRelayer() virtual {
    _;
  }
}
