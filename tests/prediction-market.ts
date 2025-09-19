import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PredictionMarket } from "../target/types/prediction_market";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { createHash } from "crypto";

describe("prediction-market", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .PredictionMarket as Program<PredictionMarket>;

  const admin = Keypair.generate();
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();

  let marketMint: PublicKey;
  let marketPda: PublicKey;
  let vaultAta: PublicKey;

  let question: string = "Will Solana price be above $200 by EOY 2025?";
  let questionHash: Buffer = null;

  before(async () => {
    const airdropAndConfirm = async (publicKey: anchor.web3.PublicKey) => {
      const airdropSignature = await provider.connection.requestAirdrop(
        publicKey,
        2 * LAMPORTS_PER_SOL
      );

      const { blockhash, lastValidBlockHeight } =
        await provider.connection.getLatestBlockhash();

      await provider.connection.confirmTransaction({
        signature: airdropSignature,
        blockhash,
        lastValidBlockHeight,
      });
    };

    await airdropAndConfirm(admin.publicKey);
    await airdropAndConfirm(user1.publicKey);
    await airdropAndConfirm(user2.publicKey);

    marketMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

    questionHash = createHash("sha256").update(question).digest();
  });

  it("Initializes a new market", async () => {
    try {
      const question = "Will Solana price be above $200 by EOY 2025?";
      const durationSeconds = new anchor.BN(60 * 60 * 24 * 30);
      const minBetAmount = new anchor.BN(1_000_000);

      const questionHash = createHash("sha256").update(question).digest();

      [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), admin.publicKey.toBuffer(), questionHash],
        program.programId
      );

      vaultAta = await getAssociatedTokenAddress(marketMint, marketPda, true);

      await program.methods
        .initializeMarket(
          Array.from(questionHash),
          question,
          durationSeconds,
          minBetAmount
        )
        .accountsPartial({
          admin: admin.publicKey,
          mint: marketMint,
          market: marketPda,
          vault: vaultAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      const marketAccountInfo = await provider.connection.getAccountInfo(
        marketPda
      );
      expect(marketAccountInfo.owner.toBase58()).to.equal(
        program.programId.toBase58()
      );

      const vaultAccountInfo = await provider.connection.getAccountInfo(
        vaultAta
      );
      expect(vaultAccountInfo.owner.toBase58()).to.equal(
        TOKEN_PROGRAM_ID.toBase58()
      );

      const marketAccountData = await program.account.market.fetch(marketPda);
      expect(marketAccountData.admin.toBase58()).to.equal(
        admin.publicKey.toBase58()
      );
      expect(marketAccountData.question).to.equal(question);
    } catch (error) {
      console.error("Test failed with error:", error);
      throw error;
    }
  });

  it("Allows a user to place a bet", async () => {
    try {
      const betAmount = new anchor.BN(10 * 1_000_000);
      const outcome = true;

      const user1TokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user1,
        marketMint,
        user1.publicKey
      );

      await mintTo(
        provider.connection,
        admin,
        marketMint,
        user1TokenAccount.address,
        admin,
        100 * 1_000_000
      );

      const [userPositionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          marketPda.toBuffer(),
          user1.publicKey.toBuffer(),
        ],
        program.programId
      );

      await program.methods
        .placeBet(outcome, betAmount)
        .accountsPartial({
          user: user1.publicKey,
          market: marketPda,
          userTokenAccount: user1TokenAccount.address,
          vault: vaultAta,
          userPosition: userPositionPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const vaultAccount = await getAccount(provider.connection, vaultAta);
      expect(vaultAccount.amount.toString()).to.equal(betAmount.toString());

      const marketAccount = await program.account.market.fetch(marketPda);
      expect(marketAccount.totalYesAmount.toString()).to.equal(
        betAmount.toString()
      );
      expect(marketAccount.totalNoAmount.toString()).to.equal("0");

      const userPositionAccount = await program.account.userPosition.fetch(
        userPositionPda
      );
      expect(userPositionAccount.yesAmount.toString()).to.equal(
        betAmount.toString()
      );
      expect(userPositionAccount.noAmount.toString()).to.equal("0");
      expect(userPositionAccount.user.toBase58()).to.equal(
        user1.publicKey.toBase58()
      );
    } catch (error) {
      throw error;
    }
  });

  it("Allows the admin to settle an expired market", async () => {
    const expiredMarketQuestion = "Will this test pass?";
    const expiredMarketHash = createHash("sha256")
      .update(expiredMarketQuestion)
      .digest();

    const [expiredMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), admin.publicKey.toBuffer(), expiredMarketHash],
      program.programId
    );

    const expiredVaultAta = await getAssociatedTokenAddress(
      marketMint,
      expiredMarketPda,
      true
    );

    await program.methods
      .initializeMarket(
        Array.from(expiredMarketHash),
        expiredMarketQuestion,
        new anchor.BN(-10),
        new anchor.BN(1_000_000)
      )
      .accountsPartial({
        admin: admin.publicKey,
        market: expiredMarketPda,
        mint: marketMint,
        vault: expiredVaultAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    const winningOutcome = true;
    await program.methods
      .settleMarket(winningOutcome)
      .accounts({
        admin: admin.publicKey,
        market: expiredMarketPda,
      })
      .signers([admin])
      .rpc();

    const settledMarketAccount = await program.account.market.fetch(
      expiredMarketPda
    );

    expect(settledMarketAccount.isSettled).to.be.true;
    expect(settledMarketAccount.winningOutcome).to.equal(winningOutcome);
  });

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  it("Allows a winning user to withdraw their payout", async () => {
    try {
      const withdrawMarketQuestion = "Will this withdraw test succeed?";
      const withdrawMarketHash = createHash("sha256")
        .update(withdrawMarketQuestion)
        .digest();
      const [withdrawMarketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), admin.publicKey.toBuffer(), withdrawMarketHash],
        program.programId
      );
      const withdrawVaultAta = await getAssociatedTokenAddress(
        marketMint,
        withdrawMarketPda,
        true
      );

      await program.methods
        .initializeMarket(
          Array.from(withdrawMarketHash),
          withdrawMarketQuestion,
          new anchor.BN(10),
          new anchor.BN(1_000_000)
        )
        .accountsPartial({
          admin: admin.publicKey,
          market: withdrawMarketPda,
          mint: marketMint,
          vault: withdrawVaultAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      const winnerAmount = new anchor.BN(20 * 1_000_000);
      const loserAmount = new anchor.BN(10 * 1_000_000);
      const totalPool = new anchor.BN(
        winnerAmount.toNumber() + loserAmount.toNumber()
      );

      const winnerAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user1,
        marketMint,
        user1.publicKey
      );
      const loserAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user2,
        marketMint,
        user2.publicKey
      );
      await mintTo(
        provider.connection,
        admin,
        marketMint,
        winnerAta.address,
        admin,
        100 * 1_000_000
      );
      await mintTo(
        provider.connection,
        admin,
        marketMint,
        loserAta.address,
        admin,
        100 * 1_000_000
      );

      const [winnerPositionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          withdrawMarketPda.toBuffer(),
          user1.publicKey.toBuffer(),
        ],
        program.programId
      );
      await program.methods
        .placeBet(true, winnerAmount)
        .accountsPartial({
          user: user1.publicKey,
          market: withdrawMarketPda,
          userTokenAccount: winnerAta.address,
          vault: withdrawVaultAta,
          userPosition: winnerPositionPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const [loserPositionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          withdrawMarketPda.toBuffer(),
          user2.publicKey.toBuffer(),
        ],
        program.programId
      );
      await program.methods
        .placeBet(false, loserAmount)
        .accountsPartial({
          user: user2.publicKey,
          market: withdrawMarketPda,
          userTokenAccount: loserAta.address,
          vault: withdrawVaultAta,
          userPosition: loserPositionPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      console.log("Waiting for market to expire...");
      await sleep(3000);

      await program.methods
        .settleMarket(true)
        .accounts({ admin: admin.publicKey, market: withdrawMarketPda })
        .signers([admin])
        .rpc();

      const balanceBefore = (
        await getAccount(provider.connection, winnerAta.address)
      ).amount;

      await program.methods
        .withdrawWinnings()
        .accountsPartial({
          user: user1.publicKey,
          market: withdrawMarketPda,
          userPosition: winnerPositionPda,
          vault: withdrawVaultAta,
          userTokenAccount: winnerAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const balanceAfter = (
        await getAccount(provider.connection, winnerAta.address)
      ).amount;
      expect(balanceAfter).to.equal(
        balanceBefore + BigInt(totalPool.toString())
      );

      const vaultBalance = (
        await getAccount(provider.connection, withdrawVaultAta)
      ).amount;
      expect(vaultBalance).to.equal(BigInt(0));

      const winnerPositionAccount = await program.account.userPosition.fetch(
        winnerPositionPda
      );
      expect(winnerPositionAccount.hasClaimed).to.be.true;
    } catch (e) {
      if (e instanceof anchor.AnchorError) {
        console.error("Anchor Error Found!");
        console.error("Error Code:", e.error.errorCode.code);
        console.error("Error Number:", e.error.errorCode.number);
        console.error("Error Message:", e.error.errorMessage);
        console.error("--- Full Program Logs ---");
        e.logs.forEach((log) => console.log(log));
        console.error("-------------------------");
      } else {
        console.error("An unknown error occurred:", e);
      }
      throw e;
    }
  });

  it("Allows the admin to cancel an active market", async () => {
    const cancelMarketQuestion = "Will this market be cancelled?";
    const cancelMarketHash = createHash("sha256")
      .update(cancelMarketQuestion)
      .digest();

    const [cancelMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), admin.publicKey.toBuffer(), cancelMarketHash],
      program.programId
    );

    const cancelVaultAta = await getAssociatedTokenAddress(
      marketMint,
      cancelMarketPda,
      true
    );

    await program.methods
      .initializeMarket(
        Array.from(cancelMarketHash),
        cancelMarketQuestion,
        new anchor.BN(60),
        new anchor.BN(1_000_000)
      )
      .accountsPartial({
        admin: admin.publicKey,
        market: cancelMarketPda,
        mint: marketMint,
        vault: cancelVaultAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    await program.methods
      .cancelMarket()
      .accounts({
        admin: admin.publicKey,
        market: cancelMarketPda,
      })
      .signers([admin])
      .rpc();

    const cancelledMarketAccount = await program.account.market.fetch(
      cancelMarketPda
    );

    expect(cancelledMarketAccount.isCancelled).to.be.true;
  });
});
