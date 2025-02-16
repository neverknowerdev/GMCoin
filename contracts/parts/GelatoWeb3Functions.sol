import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../vendor/gelato/AutomateModuleHelper.sol";
import "../vendor/gelato/AutomateTaskCreatorUpgradeable.sol";
import "../vendor/gelato/Types.sol";


contract GMWeb3Functions is ERC165, IERC1271, Initializable, OwnableUpgradeable, AutomateTaskCreatorUpgradeable {
    bytes32 public twitterVerificationTaskId;
    bytes32 public twitterWorkerTaskId;
    address public trustedSigner;

    // old deployments -- Base Mainnet && Base Sepolia
    address public constant gelatoAutomateTaskCreator = 0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0;
    uint256[255] private __gap;

    function __GelatoWeb3Functions__init(address _owner) public onlyInitializing {
        __Ownable_init(_owner);
        trustedSigner = _owner;

        __AutomateTaskCreator_init(gelatoAutomateTaskCreator);
    }

    function createTwitterVerificationFunction(string calldata _w3fHash, bytes calldata argsHash, bytes32[][] calldata topics) public onlyOwner onlyDedicatedMsgSender {
        require(twitterVerificationTaskId == "", "task already initialized");

        twitterVerificationTaskId = createWeb3Functions(_w3fHash, argsHash, topics);
    }

    function createTwitterWorkerFunction(string calldata _w3fHash, bytes calldata argsHash, bytes32[][] calldata topics) public onlyOwner {
        require(twitterWorkerTaskId == "", "task already initialized");

        twitterWorkerTaskId = createWeb3Functions(_w3fHash, argsHash, topics);
    }

    function createWeb3Functions(string calldata _gelatoW3fHash, bytes calldata w3fArgsHash, bytes32[][] memory topics) private returns (bytes32) {
//        bytes memory execData = abi.encodeCall(this.increaseCount, (- 3));
//        bytes memory w3fArgsHash = abi.encode(_address);

        ModuleData memory moduleData = ModuleData({
            modules: new Module[](3),
            args: new bytes[](3)
        });
        moduleData.modules[0] = Module.PROXY;
        moduleData.modules[1] = Module.WEB3_FUNCTION;
        moduleData.modules[2] = Module.TRIGGER;

        moduleData.args[0] = _proxyModuleArg();
        moduleData.args[1] = _web3FunctionModuleArg(_gelatoW3fHash, w3fArgsHash);
        moduleData.args[2] = _eventTriggerModuleArg(
            address(this),
            topics,
            0
        );

        return _createTask(
            address(this),
            "0x",
            moduleData,
            address(0)
        );
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