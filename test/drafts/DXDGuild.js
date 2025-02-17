import * as helpers from "../helpers";
const {
  createDAO,
  createAndSetupGuildToken,
  setAllVotesOnProposal,
} = require("../helpers/guild");
const {
  BN,
  expectEvent,
  expectRevert,
  time,
} = require("@openzeppelin/test-helpers");

const DXDGuild = artifacts.require("DXDGuild.sol");
const ActionMock = artifacts.require("ActionMock.sol");

require("chai").should();

contract("DXDGuild", function (accounts) {
  const constants = helpers.constants;
  const TIMELOCK = new BN("60");
  const VOTE_GAS = new BN("50000"); // 50k
  const MAX_GAS_PRICE = new BN("8000000000"); // 8 gwei

  let walletScheme,
    org,
    actionMock,
    votingMachine,
    guildToken,
    dxdGuild,
    tokenVault,
    walletSchemeProposalId,
    walletSchemeProposalData;

  beforeEach(async function () {
    guildToken = await createAndSetupGuildToken(accounts.slice(0, 5), [
      0,
      50,
      100,
      150,
      200,
    ]);
    dxdGuild = await DXDGuild.new();

    const createDaoResult = await createDAO(dxdGuild, accounts);
    walletScheme = createDaoResult.walletScheme;
    votingMachine = createDaoResult.votingMachine;
    org = createDaoResult.org;
    actionMock = await ActionMock.new();
    await dxdGuild.initialize(
      guildToken.address,
      30,
      30,
      40,
      20,
      VOTE_GAS,
      MAX_GAS_PRICE,
      TIMELOCK,
      votingMachine.address
    );
    tokenVault = await dxdGuild.tokenVault();

    await guildToken.approve(tokenVault, 50, { from: accounts[1] });
    await guildToken.approve(tokenVault, 100, { from: accounts[2] });
    await guildToken.approve(tokenVault, 150, { from: accounts[3] });
    await guildToken.approve(tokenVault, 200, { from: accounts[4] });

    await dxdGuild.lockTokens(50, { from: accounts[1] });
    await dxdGuild.lockTokens(100, { from: accounts[2] });
    await dxdGuild.lockTokens(150, { from: accounts[3] });
    await dxdGuild.lockTokens(200, { from: accounts[4] });

    tokenVault = await dxdGuild.tokenVault();

    walletSchemeProposalData = helpers.encodeGenericCallData(
      org.avatar.address,
      actionMock.address,
      helpers.testCallFrom(org.avatar.address),
      0
    );
    const tx = await walletScheme.proposeCalls(
      [org.controller.address],
      [walletSchemeProposalData],
      [0],
      "Test Title",
      constants.SOME_HASH
    );
    walletSchemeProposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    await new web3.eth.Contract(votingMachine.contract.abi).methods
      .vote(walletSchemeProposalId, 1, 0, constants.NULL_ADDRESS)
      .encodeABI();
  });

  describe("DXDGuild", function () {
    it("execute a positive vote on the voting machine from the dxd-guild", async function () {
      await expectRevert(
        dxdGuild.createVotingMachineVoteProposal(walletSchemeProposalId, {
          from: accounts[1],
        }),
        "DXDGuild: Not enough tokens to create proposal"
      );
      const tx = await dxdGuild.createVotingMachineVoteProposal(
        walletSchemeProposalId,
        { from: accounts[2] }
      );

      const positiveVoteProposalId = tx.logs[0].args.proposalId;
      const negativeVoteProposalId = tx.logs[1].args.proposalId;

      await setAllVotesOnProposal({
        guild: dxdGuild,
        proposalId: positiveVoteProposalId,
        account: accounts[2],
      });

      await expectRevert(
        dxdGuild.endProposal(positiveVoteProposalId),
        "DXDGuild: Use endVotingMachineVoteProposal to end proposals to voting machine"
      );
      await expectRevert(
        dxdGuild.endProposal(positiveVoteProposalId),
        "DXDGuild: Use endVotingMachineVoteProposal to end proposals to voting machine"
      );
      await expectRevert(
        dxdGuild.endVotingMachineVoteProposal(walletSchemeProposalId),
        "DXDGuild: Positive proposal hasnt ended yet"
      );

      const txVote = await setAllVotesOnProposal({
        guild: dxdGuild,
        proposalId: positiveVoteProposalId,
        account: accounts[4],
      });

      if (constants.ARC_GAS_PRICE > 1)
        expect(txVote.receipt.gasUsed).to.be.below(80000);

      expectEvent(txVote, "VoteAdded", { proposalId: positiveVoteProposalId });
      await time.increase(time.duration.seconds(31));
      await expectRevert(
        dxdGuild.endProposal(positiveVoteProposalId),
        "DXDGuild: Use endVotingMachineVoteProposal to end proposals to voting machine"
      );
      await expectRevert(
        dxdGuild.endProposal(negativeVoteProposalId),
        "DXDGuild: Use endVotingMachineVoteProposal to end proposals to voting machine"
      );
      const receipt = await dxdGuild.endVotingMachineVoteProposal(
        walletSchemeProposalId
      );
      expectEvent(receipt, "ProposalExecuted", {
        proposalId: positiveVoteProposalId,
      });
      await expectRevert(
        dxdGuild.endVotingMachineVoteProposal(walletSchemeProposalId),
        "DXDGuild: Positive proposal already executed"
      );
      await time.increase(time.duration.seconds(31));
      const proposalInfo = await dxdGuild.getProposal(positiveVoteProposalId);
      assert.equal(
        proposalInfo.state,
        constants.WalletSchemeProposalState.executionSuccedd
      );
      assert.equal(proposalInfo.to[0], votingMachine.address);
      assert.equal(proposalInfo.value[0], 0);
    });
  });
});
