// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Custom errors for gas optimization
error OnlyGelato();
error OnlyGelatoOrOwner();
error OnlyServerRelayer();
error OnlyOwner();
error WalletAlreadyLinked();
error UserAlreadyLinked();
error NoOngoingMinting();
error WrongMintingDay();
error WrongUserIndex();
error WrongStartIndex();
error SystemNotEnabled();
error UserNotExist();
error WalletNotLinked();
error InvalidSignature();
error WalletAlreadyRegistered();
error CallerNotRegistered();
error CannotRemoveUserActiveWorkers();
error WalletNotRegistered();
error UserNotFoundInUnifiedSystem();
error WalletAlreadyHasUnifiedUser();
error TwitterIdAlreadyLinked();
error FarcasterFidAlreadyLinked();
error CannotMergeSameUser();
error FromUserNotExist();
error ToUserNotExist();
error FarcasterAccountAlreadyLinked();
error WalletAlreadyLinkedToFid();
error DayToMintTooFar();
error MintingAlreadyStarted();
