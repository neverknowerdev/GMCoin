// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract GMCoinPreLunch is Initializable, OwnableUpgradeable, ERC20Upgradeable, UUPSUpgradeable
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner
    ) public initializer {
        __Context_init();
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ERC20_init("GM Coin", "GM");
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {

    }

    function answerForEveryQuestion() public pure returns (int) {
        return 42;
    }
}