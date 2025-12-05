pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract WaterRightsFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error InvalidBatchState();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error AlreadyProcessed();
    error NotInitialized();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PausedSet(bool paused);
    event CooldownSet(uint256 cooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event WaterDataSubmitted(address indexed provider, uint256 indexed batchId, uint256 encryptedAmount);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalAmount);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    mapping(address => bool) public isProvider;
    mapping(uint256 => euint32) public batchTotalEncryptedWater;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    address public owner;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;
    bool public batchOpen;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown(address _address) {
        if (block.timestamp < lastSubmissionTime[_address] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown(address _address) {
        if (block.timestamp < lastDecryptionRequestTime[_address] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        paused = false;
        cooldownSeconds = 60;
        currentBatchId = 0;
        batchOpen = false;
    }

    function addProvider(address _provider) external onlyOwner {
        isProvider[_provider] = true;
        emit ProviderAdded(_provider);
    }

    function removeProvider(address _provider) external onlyOwner {
        isProvider[_provider] = false;
        emit ProviderRemoved(_provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function setCooldown(uint256 _cooldownSeconds) external onlyOwner {
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSet(_cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert InvalidBatchState();
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert InvalidBatchState();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitWaterData(uint256 _encryptedAmount) external onlyProvider whenNotPaused checkSubmissionCooldown(msg.sender) {
        if (!batchOpen) revert InvalidBatchState();
        _initIfNeeded(currentBatchId);
        euint32 memory encryptedAmount = FHE.asEuint32(_encryptedAmount);
        batchTotalEncryptedWater[currentBatchId] = FHE.add(batchTotalEncryptedWater[currentBatchId], encryptedAmount);
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit WaterDataSubmitted(msg.sender, currentBatchId, _encryptedAmount);
    }

    function requestTotalWaterDecryption() external onlyProvider whenNotPaused checkDecryptionCooldown(msg.sender) {
        if (batchOpen) revert InvalidBatchState();
        _initIfNeeded(currentBatchId);
        bytes32[] memory cts = _prepareCiphertextsForDecryption(currentBatchId);
        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: currentBatchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, currentBatchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        uint256 batchId = decryptionContexts[requestId].batchId;
        bytes32[] memory cts = _prepareCiphertextsForDecryption(batchId);
        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();
        uint256 totalAmount = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, totalAmount);
    }

    function _prepareCiphertextsForDecryption(uint256 batchId) internal view returns (bytes32[] memory) {
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(batchTotalEncryptedWater[batchId]);
        return cts;
    }

    function _hashCiphertexts(bytes32[] memory cts) internal view returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(uint256 batchId) internal {
        if (!FHE.isInitialized(batchTotalEncryptedWater[batchId])) {
            batchTotalEncryptedWater[batchId] = FHE.asEuint32(0);
        }
    }
}