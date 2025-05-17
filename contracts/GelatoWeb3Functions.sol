// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./vendor/gelato/AutomateModuleHelper.sol";
import "./vendor/gelato/AutomateTaskCreatorUpgradeable.sol";
import "./vendor/gelato/Types.sol";
import {GMStorage} from "./Storage.sol";

contract GMWeb3Functions is
    GMStorage,
    ERC165,
    IERC1271,
    Initializable,
    OwnableUpgradeable,
    AutomateTaskCreatorUpgradeable
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    event Web3FunctionChanged(bytes32 oldHash, bytes32 newHash);

    function __GelatoWeb3Functions__init(
        address _owner
    ) public onlyInitializing {
        __Ownable_init(_owner);
        gelatoConfig.trustedSigner = _owner;

        __AutomateTaskCreator_init(gelatoAutomateTaskCreator);
    }

    function cancelWeb3Function(bytes32 hash) public onlyOwner {
        _cancelTask(hash);
    }

    function createTwitterVerificationFunction(
        string calldata _w3fHash,
        bytes calldata argsHash,
        bytes32[][] calldata topics
    ) public onlyOwner {
        // for devs purpose. Until contact will go to Live finally
        //        require(twitterVerificationTaskId == bytes32(""), "task already initialized");
        bytes32 oldGelatoId = gelatoConfig.gelatoTaskId_twitterVerification;
        if (gelatoConfig.gelatoTaskId_twitterVerification != bytes32("")) {
            _cancelTask(gelatoConfig.gelatoTaskId_twitterVerification);
        }

        gelatoConfig.gelatoTaskId_twitterVerification = createWeb3FunctionEvent(
            _w3fHash,
            argsHash,
            topics
        );
        emit Web3FunctionChanged(
            oldGelatoId,
            gelatoConfig.gelatoTaskId_twitterVerification
        );
    }

    function createTwitterVerificationThirdwebFunction(
        string calldata _w3fHash,
        bytes calldata argsHash,
        bytes32[][] calldata topics
    ) public onlyOwner {
        bytes32 oldGelatoId = gelatoConfig
            .gelatoTaskId_twitterVerificationThirdweb;
        if (
            gelatoConfig.gelatoTaskId_twitterVerificationThirdweb != bytes32("")
        ) {
            _cancelTask(gelatoConfig.gelatoTaskId_twitterVerificationThirdweb);
        }

        gelatoConfig
            .gelatoTaskId_twitterVerificationThirdweb = createWeb3FunctionEvent(
            _w3fHash,
            argsHash,
            topics
        );
        emit Web3FunctionChanged(
            oldGelatoId,
            gelatoConfig.gelatoTaskId_twitterVerificationThirdweb
        );
    }

    function createTwitterVerificationAuthcodeFunction(
        string calldata _w3fHash,
        bytes calldata argsHash,
        bytes32[][] calldata topics
    ) public onlyOwner {
        bytes32 oldGelatoId = gelatoConfig
            .gelatoTaskId_twitterVerificationAuthcode;
        if (
            gelatoConfig.gelatoTaskId_twitterVerificationAuthcode != bytes32("")
        ) {
            _cancelTask(gelatoConfig.gelatoTaskId_twitterVerificationAuthcode);
        }

        gelatoConfig
            .gelatoTaskId_twitterVerificationAuthcode = createWeb3FunctionEvent(
            _w3fHash,
            argsHash,
            topics
        );
        emit Web3FunctionChanged(
            oldGelatoId,
            gelatoConfig.gelatoTaskId_twitterVerificationAuthcode
        );
    }

    function createTwitterWorkerFunction(
        string calldata _w3fHash,
        bytes calldata argsHash,
        bytes32[][] calldata topics
    ) public onlyOwner {
        //        require(twitterWorkerTaskId == bytes32(""), "task already initialized");
        bytes32 oldGelatoId = gelatoConfig.gelatoTaskId_twitterWorker;
        if (gelatoConfig.gelatoTaskId_twitterWorker != bytes32("")) {
            _cancelTask(gelatoConfig.gelatoTaskId_twitterWorker);
        }

        gelatoConfig.gelatoTaskId_twitterWorker = createWeb3FunctionEvent(
            _w3fHash,
            argsHash,
            topics
        );
        emit Web3FunctionChanged(
            oldGelatoId,
            gelatoConfig.gelatoTaskId_twitterWorker
        );
    }

    function createDailyFunction(
        uint128 startTime,
        uint128 interval,
        bytes calldata execData
    ) public onlyOwner {
        //        require(dailyTriggerTaskId == bytes32(""), "task already initialized");
        bytes32 oldGelatoId = gelatoConfig.gelatoTaskId_dailyTrigger;
        if (gelatoConfig.gelatoTaskId_dailyTrigger != bytes32("")) {
            _cancelTask(gelatoConfig.gelatoTaskId_dailyTrigger);
        }

        gelatoConfig.gelatoTaskId_dailyTrigger = createWeb3FunctionTime(
            startTime,
            interval,
            execData
        );
        emit Web3FunctionChanged(
            oldGelatoId,
            gelatoConfig.gelatoTaskId_dailyTrigger
        );
    }

    function createWeb3FunctionEvent(
        string calldata _gelatoW3fHash,
        bytes calldata w3fArgsHash,
        bytes32[][] memory topics
    ) private returns (bytes32) {
        ModuleData memory moduleData = ModuleData({
            modules: new Module[](3),
            args: new bytes[](3)
        });
        moduleData.modules[0] = Module.PROXY;
        moduleData.modules[1] = Module.WEB3_FUNCTION;
        moduleData.modules[2] = Module.TRIGGER;

        moduleData.args[0] = _proxyModuleArg();
        moduleData.args[1] = _web3FunctionModuleArg(
            _gelatoW3fHash,
            w3fArgsHash
        );
        moduleData.args[2] = _eventTriggerModuleArg(address(this), topics, 0);

        return
            _createTask(
                address(this),
                abi.encode(this.supportsInterface.selector),
                moduleData,
                address(0)
            );
    }

    function createWeb3FunctionTime(
        uint128 startTime,
        uint128 interval,
        bytes calldata execData
    ) private returns (bytes32) {
        ModuleData memory moduleData = ModuleData({
            modules: new Module[](2),
            args: new bytes[](2)
        });
        moduleData.modules[0] = Module.PROXY;
        moduleData.modules[1] = Module.TRIGGER;

        moduleData.args[0] = _proxyModuleArg();
        moduleData.args[1] = _timeTriggerModuleArg(
            startTime * 1000,
            interval * 1000
        );

        return _createTask(address(this), execData, moduleData, address(0));
    }

    function _eventTriggerModuleArg(
        address _address,
        bytes32[][] memory _topics,
        uint256 _blockConfirmations
    ) internal pure returns (bytes memory) {
        bytes memory triggerConfig = abi.encode(
            _address,
            _topics,
            _blockConfirmations
        );

        return abi.encode(TriggerType.EVENT, triggerConfig);
    }

    // EIP-1271 implementation
    function isValidSignature(
        bytes32 hash,
        bytes memory signature
    ) external view override returns (bytes4) {
        // Remove the toEthSignedMessageHash call
        address recoveredSigner = ECDSA.recover(hash, signature);
        // Check if the recovered signer matches the trusted signer
        if (recoveredSigner == gelatoConfig.trustedSigner) {
            return this.isValidSignature.selector; // Return the magic value 0x1626ba7e
        } else {
            return 0xffffffff; // Return invalid signature value
        }
    }

    // Override supportsInterface to support ERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC165) returns (bool) {
        return
            interfaceId == type(IERC1271).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
