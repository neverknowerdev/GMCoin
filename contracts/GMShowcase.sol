// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/access/AccessControl.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/Pausable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';


contract GMShowcase is AccessControl, ReentrancyGuard, Pausable {
  // ========================================
  // ROLES & ACCESS CONTROL
  // ========================================

  bytes32 public constant ADMIN_ROLE = keccak256('ADMIN_ROLE');

  // ========================================
  // STRUCTS & ENUMS
  // ========================================

  struct Proposal {
    uint256 id;
    address proposer;
    string content;
    string metadata;
    uint256 votes;
    uint256 stake;
    uint256 roundId;
    bool isActive;
    uint256 timestamp;
  }

  struct Round {
    uint256 id;
    uint256 startTime;
    uint256 endTime;
    bool isActive;
    bool isFinalized;
    uint256 winnerProposalId;
    uint256 totalProposals;
    uint256 totalVotes;
  }

  // ========================================
  // STATE VARIABLES - CONFIGURATION
  // ========================================

  // Round configuration
  uint256 public roundDuration = 24 hours;
  uint256 public maxProposalsPerRound = 100;
  uint256 public minProposalStake = 0.01 ether;

  // Content limits
  uint256 public maxContentLength = 500;
  uint256 public maxMetadataLength = 200;

  // Voting power configuration
  IERC20 public votingToken; // GM Token contract
  uint256 public minimumTokenBalance = 1 ether; // Minimum 1 GM token to vote
  uint256 public maxVotingPower = 1000000 ether; // Maximum voting power cap

  // Gas optimization
  uint256 public constant MAX_VOTERS_TO_CHECK = 200; // Gas limit protection

  // ========================================
  // STATE VARIABLES - CORE DATA
  // ========================================

  // Round management
  uint256 public currentRoundId = 0;
  mapping(uint256 => Round) public rounds;

  // Proposal management
  uint256 public nextProposalId = 1;
  mapping(uint256 => Proposal) public proposals;
  mapping(uint256 => uint256[]) public roundProposals; // roundId => proposalIds[]

  // Voting management
  mapping(uint256 => mapping(address => bool)) public hasVotedInRound; // roundId => user => hasVoted
  mapping(uint256 => mapping(address => uint256)) public userVoteInRound; // roundId => user => proposalId
  mapping(uint256 => address[]) public proposalVotersList; // proposalId => voters[]

  // Dual-check voting power snapshots
  mapping(uint256 => mapping(address => uint256)) public votingPowerSnapshot; // roundId => user => tokenBalance

  // Financial tracking
  mapping(address => uint256) public pendingWithdrawals;
  uint256 public totalStakes;

  // ========================================
  // EVENTS
  // ========================================

  // Round events
  event RoundStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime);
  event RoundFinalized(uint256 indexed roundId, uint256 winnerProposalId, address winner, uint256 totalVotes);

  // Proposal events
  event ProposalSubmitted(uint256 indexed proposalId, address indexed proposer, uint256 indexed roundId, uint256 stake);
  event ProposalVoted(uint256 indexed proposalId, address indexed voter, uint256 votingPower, uint256 indexed roundId);

  // Admin events
  event RoundDurationUpdated(uint256 newDuration);
  event MaxProposalsPerRoundUpdated(uint256 newMax);
  event MinProposalStakeUpdated(uint256 newStake);
  event MaxContentLengthUpdated(uint256 newLength);
  event MaxMetadataLengthUpdated(uint256 newLength);
  event VotingTokenUpdated(address indexed newToken);
  event MinimumTokenBalanceUpdated(uint256 newBalance);
  event MaxVotingPowerUpdated(uint256 newMax);

  // Emergency events
  event EmergencyWithdrawal(address indexed admin, uint256 amount);
  event StakeWithdrawn(address indexed user, uint256 amount);

  // ========================================
  // MODIFIERS
  // ========================================

  modifier onlyAdmin() {
    require(hasRole(ADMIN_ROLE, msg.sender), 'Not an admin');
    _;
  }

  modifier onlyActiveRound() {
    require(currentRoundId > 0, 'No active round');
    require(rounds[currentRoundId].isActive, 'Round not active');
    require(block.timestamp <= rounds[currentRoundId].endTime, 'Round ended');
    _;
  }

  modifier validProposal(uint256 _proposalId) {
    require(_proposalId > 0 && _proposalId < nextProposalId, 'Invalid proposal ID');
    require(proposals[_proposalId].isActive, 'Proposal not active');
    _;
  }

  // ========================================
  // CONSTRUCTOR
  // ========================================

  constructor(address _votingTokenAddress, address _admin) {
    // Setup roles
    _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    _grantRole(ADMIN_ROLE, _admin);

    // Setup voting token
    require(_votingTokenAddress != address(0), 'Invalid voting token address');
    votingToken = IERC20(_votingTokenAddress);

    // Start first round
    _startNewRound();

    emit VotingTokenUpdated(_votingTokenAddress);
  }

  // ========================================
  // VOTING POWER FUNCTIONS
  // ========================================

  /**
   * @dev Get current voting power for a user (calls external GM token contract)
   * @param _user Address to check voting power for
   * @return Voting power based on GM token balance
   */
  function getVotingPower(address _user) public view returns (uint256) {
    if (address(votingToken) == address(0)) {
      return 0;
    }

    uint256 balance = votingToken.balanceOf(_user);

    if (balance < minimumTokenBalance) {
      return 0;
    }

    // Cap at maximum voting power
    return balance > maxVotingPower ? maxVotingPower : balance;
  }

  /**
   * @dev Get voting power snapshot for a user in a specific round
   * @param _user Address to check
   * @param _roundId Round ID to check
   * @return Stored voting power from when user voted
   */
  function getVotingPowerSnapshot(address _user, uint256 _roundId) public view returns (uint256) {
    return votingPowerSnapshot[_roundId][_user];
  }

  /**
   * @dev Validate that user still holds enough tokens (dual-check system)
   * @param _user Address to validate
   * @param _roundId Round ID to check against
   * @return True if user still holds at least the amount they had when voting
   */
  function validateVotingPower(address _user, uint256 _roundId) public view returns (bool) {
    uint256 currentBalance = getVotingPower(_user);
    uint256 snapshotBalance = votingPowerSnapshot[_roundId][_user];

    // User must still hold at least the amount they had when voting
    return currentBalance >= snapshotBalance && snapshotBalance > 0;
  }

  // ========================================
  // CORE SHOWCASE FUNCTIONS
  // ========================================

  /**
   * @dev Submit a new proposal to the current round
   * @param _content Proposal content (max maxContentLength characters)
   * @param _metadata Additional metadata (max maxMetadataLength characters)
   */
  function submitProposal(
    string memory _content,
    string memory _metadata
  ) external payable onlyActiveRound nonReentrant whenNotPaused {
    require(msg.value >= minProposalStake, 'Insufficient stake');
    require(bytes(_content).length > 0 && bytes(_content).length <= maxContentLength, 'Invalid content length');
    require(bytes(_metadata).length <= maxMetadataLength, 'Metadata too long');
    require(rounds[currentRoundId].totalProposals < maxProposalsPerRound, 'Max proposals reached');

    uint256 proposalId = nextProposalId++;

    proposals[proposalId] = Proposal({
      id: proposalId,
      proposer: msg.sender,
      content: _content,
      metadata: _metadata,
      votes: 0,
      stake: msg.value,
      roundId: currentRoundId,
      isActive: true,
      timestamp: block.timestamp
    });

    roundProposals[currentRoundId].push(proposalId);
    rounds[currentRoundId].totalProposals++;

    totalStakes += msg.value;

    emit ProposalSubmitted(proposalId, msg.sender, currentRoundId, msg.value);
  }

  /**
   * @dev Vote for a proposal (with dual-check voting power system)
   * @param _proposalId ID of the proposal to vote for
   */
  function voteForProposal(
    uint256 _proposalId
  ) external onlyActiveRound validProposal(_proposalId) nonReentrant whenNotPaused {
    require(proposals[_proposalId].roundId == currentRoundId, 'Proposal not in current round');
    require(!hasVotedInRound[currentRoundId][msg.sender], 'Already voted in this round');

    // FIRST CHECK: Get current voting power and store snapshot
    uint256 votingPower = getVotingPower(msg.sender);
    require(votingPower > 0, 'No voting power');

    // Store snapshot for dual-check system
    votingPowerSnapshot[currentRoundId][msg.sender] = votingPower;

    // Record vote
    hasVotedInRound[currentRoundId][msg.sender] = true;
    userVoteInRound[currentRoundId][msg.sender] = _proposalId;
    proposalVotersList[_proposalId].push(msg.sender);

    // Update proposal votes (this will be recalculated during finalization)
    proposals[_proposalId].votes += votingPower;
    rounds[currentRoundId].totalVotes += votingPower;

    emit ProposalVoted(_proposalId, msg.sender, votingPower, currentRoundId);
  }

  /**
   * @dev Finalize the current round and determine winner
   */
  function finalizeCurrentRound() external nonReentrant whenNotPaused {
    require(currentRoundId > 0, 'No active round');
    require(rounds[currentRoundId].isActive, 'Round already finalized');
    require(block.timestamp > rounds[currentRoundId].endTime, 'Round still active');
    require(!rounds[currentRoundId].isFinalized, 'Round already finalized');

    uint256[] memory proposalIds = roundProposals[currentRoundId];
    uint256 winnerProposalId = 0;
    uint256 maxValidVotes = 0;

    // Calculate valid votes for each proposal using dual-check system
    for (uint256 i = 0; i < proposalIds.length; i++) {
      uint256 proposalId = proposalIds[i];
      uint256 validVotes = _calculateValidVotes(proposalId, currentRoundId);

      if (validVotes > maxValidVotes) {
        maxValidVotes = validVotes;
        winnerProposalId = proposalId;
      }
    }

    // Finalize round
    rounds[currentRoundId].isActive = false;
    rounds[currentRoundId].isFinalized = true;
    rounds[currentRoundId].winnerProposalId = winnerProposalId;
    rounds[currentRoundId].totalVotes = maxValidVotes;

    // If there's a winner, add their stake to withdrawals
    if (winnerProposalId > 0) {
      address winner = proposals[winnerProposalId].proposer;
      pendingWithdrawals[winner] += proposals[winnerProposalId].stake;
      totalStakes -= proposals[winnerProposalId].stake;
    }

    emit RoundFinalized(
      currentRoundId,
      winnerProposalId,
      winnerProposalId > 0 ? proposals[winnerProposalId].proposer : address(0),
      maxValidVotes
    );

    // Start new round
    _startNewRound();
  }

  /**
   * @dev Calculate valid votes for a proposal using dual-check system
   * @param _proposalId Proposal to check
   * @param _roundId Round to check
   * @return validVoteCount Total valid voting power
   */
  function _calculateValidVotes(uint256 _proposalId, uint256 _roundId) internal view returns (uint256 validVoteCount) {
    address[] memory voters = proposalVotersList[_proposalId];

    // Gas limit protection: limit validation to reasonable number of voters
    uint256 maxVotersToCheck = voters.length > MAX_VOTERS_TO_CHECK ? MAX_VOTERS_TO_CHECK : voters.length;

    for (uint256 i = 0; i < maxVotersToCheck; i++) {
      address voter = voters[i];

      // SECOND CHECK: Validate that voter still holds tokens
      if (validateVotingPower(voter, _roundId)) {
        // Add their original voting power (from snapshot)
        uint256 originalPower = getVotingPowerSnapshot(voter, _roundId);
        validVoteCount += originalPower;
      }
      // If validation fails, we don't count their vote
    }

    return validVoteCount;
  }

  /**
   * @dev Start a new round
   */
  function _startNewRound() internal {
    currentRoundId++;

    rounds[currentRoundId] = Round({
      id: currentRoundId,
      startTime: block.timestamp,
      endTime: block.timestamp + roundDuration,
      isActive: true,
      isFinalized: false,
      winnerProposalId: 0,
      totalProposals: 0,
      totalVotes: 0
    });

    emit RoundStarted(currentRoundId, block.timestamp, block.timestamp + roundDuration);
  }

  // ========================================
  // WITHDRAWAL FUNCTIONS
  // ========================================

  /**
   * @dev Withdraw pending stake (for winners)
   */
  function withdrawStake() external nonReentrant {
    uint256 amount = pendingWithdrawals[msg.sender];
    require(amount > 0, 'No pending withdrawals');

    pendingWithdrawals[msg.sender] = 0;

    (bool success, ) = payable(msg.sender).call{ value: amount }('');
    require(success, 'Withdrawal failed');

    emit StakeWithdrawn(msg.sender, amount);
  }

  // ========================================
  // ADMIN CONFIGURATION FUNCTIONS
  // ========================================

  /**
   * @dev Set round duration (admin only)
   * @param _duration New duration in seconds
   */
  function setRoundDuration(uint256 _duration) external onlyAdmin {
    require(_duration >= 1 hours && _duration <= 7 days, 'Invalid duration');
    roundDuration = _duration;
    emit RoundDurationUpdated(_duration);
  }

  /**
   * @dev Set maximum proposals per round (admin only)
   * @param _max New maximum (10-1000)
   */
  function setMaxProposalsPerRound(uint256 _max) external onlyAdmin {
    require(_max >= 10 && _max <= 1000, 'Invalid max proposals');
    maxProposalsPerRound = _max;
    emit MaxProposalsPerRoundUpdated(_max);
  }

  /**
   * @dev Set minimum proposal stake (admin only)
   * @param _stake New minimum stake in wei
   */
  function setMinProposalStake(uint256 _stake) external onlyAdmin {
    require(_stake <= 1 ether, 'Stake too high');
    minProposalStake = _stake;
    emit MinProposalStakeUpdated(_stake);
  }

  /**
   * @dev Set maximum content length (admin only)
   * @param _length New maximum length
   */
  function setMaxContentLength(uint256 _length) external onlyAdmin {
    require(_length >= 100 && _length <= 2000, 'Invalid content length');
    maxContentLength = _length;
    emit MaxContentLengthUpdated(_length);
  }

  /**
   * @dev Set maximum metadata length (admin only)
   * @param _length New maximum length
   */
  function setMaxMetadataLength(uint256 _length) external onlyAdmin {
    require(_length >= 50 && _length <= 500, 'Invalid metadata length');
    maxMetadataLength = _length;
    emit MaxMetadataLengthUpdated(_length);
  }

  /**
   * @dev Set voting token contract (admin only)
   * @param _token New voting token contract address
   */
  function setVotingToken(address _token) external onlyAdmin {
    require(_token != address(0), 'Invalid token address');
    votingToken = IERC20(_token);
    emit VotingTokenUpdated(_token);
  }

  /**
   * @dev Set minimum token balance for voting (admin only)
   * @param _balance New minimum balance
   */
  function setMinimumTokenBalance(uint256 _balance) external onlyAdmin {
    require(_balance > 0, 'Balance must be positive');
    minimumTokenBalance = _balance;
    emit MinimumTokenBalanceUpdated(_balance);
  }

  /**
   * @dev Set maximum voting power cap (admin only)
   * @param _max New maximum voting power
   */
  function setMaxVotingPower(uint256 _max) external onlyAdmin {
    require(_max >= 1000 ether, 'Max too low');
    maxVotingPower = _max;
    emit MaxVotingPowerUpdated(_max);
  }

  // ========================================
  // EMERGENCY FUNCTIONS
  // ========================================

  /**
   * @dev Emergency pause (admin only)
   */
  function emergencyPause() external onlyAdmin {
    _pause();
  }

  /**
   * @dev Emergency unpause (admin only)
   */
  function emergencyUnpause() external onlyAdmin {
    _unpause();
  }

  /**
   * @dev Emergency finalize current round (admin only)
   */
  function emergencyFinalizeRound() external onlyAdmin {
    require(currentRoundId > 0, 'No active round');
    require(rounds[currentRoundId].isActive, 'Round not active');

    rounds[currentRoundId].isActive = false;
    rounds[currentRoundId].isFinalized = true;

    emit RoundFinalized(currentRoundId, 0, address(0), 0);
    _startNewRound();
  }

  /**
   * @dev Emergency withdrawal (admin only)
   * @param _amount Amount to withdraw
   */
  function emergencyWithdraw(uint256 _amount) external onlyAdmin {
    require(_amount <= address(this).balance, 'Insufficient balance');
    require(_amount <= totalStakes, 'Cannot withdraw more than stakes');

    totalStakes -= _amount;

    (bool success, ) = payable(msg.sender).call{ value: _amount }('');
    require(success, 'Withdrawal failed');

    emit EmergencyWithdrawal(msg.sender, _amount);
  }

  // ========================================
  // VIEW FUNCTIONS
  // ========================================

  /**
   * @dev Get current round information
   */
  function getCurrentRound() external view returns (Round memory) {
    return rounds[currentRoundId];
  }

  /**
   * @dev Get proposal IDs for a specific round
   * @param _roundId Round ID to query
   * @return Array of proposal IDs
   */
  function getRoundProposals(uint256 _roundId) external view returns (uint256[] memory) {
    return roundProposals[_roundId];
  }

  /**
   * @dev Get voters for a specific proposal
   * @param _proposalId Proposal ID to query
   * @return Array of voter addresses
   */
  function getProposalVoters(uint256 _proposalId) external view returns (address[] memory) {
    return proposalVotersList[_proposalId];
  }

  /**
   * @dev Check if user voted in a specific round
   * @param _user User address
   * @param _roundId Round ID
   * @return True if user voted
   */
  function getUserVotedInRound(address _user, uint256 _roundId) external view returns (bool) {
    return hasVotedInRound[_roundId][_user];
  }

  /**
   * @dev Get which proposal a user voted for in a round
   * @param _user User address
   * @param _roundId Round ID
   * @return Proposal ID (0 if didn't vote)
   */
  function getUserVoteInRound(address _user, uint256 _roundId) external view returns (uint256) {
    return userVoteInRound[_roundId][_user];
  }

  /**
   * @dev Get contract balance
   */
  function getContractBalance() external view returns (uint256) {
    return address(this).balance;
  }

  /**
   * @dev Get pending withdrawal amount for user
   * @param _user User address
   * @return Pending amount
   */
  function getPendingWithdrawal(address _user) external view returns (uint256) {
    return pendingWithdrawals[_user];
  }

  // ========================================
  // FALLBACK FUNCTIONS
  // ========================================

  /**
   * @dev Receive function for direct ETH transfers
   */
  receive() external payable {
    // Allow contract to receive ETH
  }

  /**
   * @dev Fallback function
   */
  fallback() external payable {
    revert('Function not found');
  }
}
