// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import './vendor/gelato/AutomateTaskCreatorUpgradeable.sol';
import './vendor/gelato/Types.sol';


contract GGCoin is ERC165, IERC1271, Initializable, OwnableUpgradeable, ERC20Upgradeable, UUPSUpgradeable, AutomateTaskCreatorUpgradeable
{
    int public counter;
    bytes32 public taskID;
    address public trustedSigner;

    function newInitializer(address _owner) public onlyOwner {
        trustedSigner = _owner;
    }
//    function initialize(address _owner, uint256 _initialSupply) public initializer {
//        counter = 0;
//        taskID = bytes32("");
//
//        __Ownable_init(_owner);
//        __UUPSUpgradeable_init();
//        __ERC20_init("Test Gelato coin", "GGCOIN");
//
//        __AutomateTaskCreator_init(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0);
//
//        trustedSigner = _owner;
//        _mint(address(_owner), _initialSupply);
//    }

    function cancelWeb3Function(bytes32 _taskID) public onlyOwner {
        _cancelTask(_taskID);
        taskID = "";
    }

    function createWeb3Functions(string calldata _gelatoW3fHash, string calldata _address) public onlyOwner {
//        if (taskID.length != 0) {
//            _cancelTask(taskID);
//        }
        counter = 0;

        bytes memory execData = abi.encodeCall(this.increaseCount, (- 3));
        bytes memory w3fArgsHash = abi.encode(_address);

        ModuleData memory moduleData = ModuleData({
            modules: new Module[](3),
            args: new bytes[](3)
        });
        moduleData.modules[0] = Module.PROXY;
        moduleData.modules[1] = Module.WEB3_FUNCTION;
        moduleData.modules[2] = Module.TRIGGER;

        moduleData.args[0] = _proxyModuleArg();
        moduleData.args[1] = _web3FunctionModuleArg(_gelatoW3fHash, w3fArgsHash);
        moduleData.args[2] = _timeTriggerModuleArg(
            uint128(block.timestamp + 5 minutes) * 1000,
            uint128(5 minutes) * 1000
        );

        taskID = _createTask(
            address(this),
            execData,
            moduleData,
            address(0)
        );
    }


    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
    }

    function increaseCount(int delta) public onlyDedicatedMsgSender {
        counter += delta;

        if (counter >= 10) {
            _cancelTask(taskID);
        }
    }

    // EIP-1271 implementation
    function isValidSignature(bytes32 hash, bytes memory signature) external view override returns (bytes4) {
        // Remove the toEthSignedMessageHash call
        address recoveredSigner = ECDSA.recover(hash, signature);
        // Check if the recovered signer matches the trusted signer
        if (recoveredSigner == trustedSigner) {
            return this.isValidSignature.selector; // Return the magic value 0x1626ba7e
        } else {
            return 0xffffffff; // Return invalid signature value
        }
    }

    // Override supportsInterface to support ERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165) returns (bool) {
        return
            interfaceId == type(IERC1271).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}