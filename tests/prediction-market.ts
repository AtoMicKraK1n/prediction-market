import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
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

// Helper function to format token amounts for logging
const formatTokens = (amount: bigint | anchor.BN, decimals = 6) => {
  return Number(amount) / 10 ** decimals;
};

describe("prediction-market", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .PredictionMarket as Program<PredictionMarket>;

  // Wallets
  const admin = Keypair.generate();
  const user1 = Keypair.generate(); // Will be our "winner"
  const user2 = Keypair.generate(); // Will be our "loser"

  // Shared state for tests
  let marketMint: PublicKey;
  let marketPda: PublicKey;
  let vaultAta: PublicKey;
  let question: string = "Will Solana price be above $200 by EOY 2025?";
  let questionHash: Buffer = null;

  before(async () => {
    console.log("--- SETUP ---");
    console.log("⚙️  Airdropping SOL to test wallets...");

    const airdropAndConfirm = async (wallet: Keypair, name: string) => {
      const airdropSignature = await provider.connection.requestAirdrop(
        wallet.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      const { blockhash, lastValidBlockHeight } =
        await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({
        signature: airdropSignature,
        blockhash,
        lastValidBlockHeight,
      });
      console.log(`   ✅ ${name} (${wallet.publicKey.toBase58()}) funded.`);
    };

    await airdropAndConfirm(admin, "Admin");
    await airdropAndConfirm(user1, "User 1");
    await airdropAndConfirm(user2, "User 2");

    console.log("\n⚙️  Creating a new SPL Token Mint for the market...");
    marketMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );
    console.log(`   ✅ Mint created: ${marketMint.toBase58()}`);
    console.log("--------------------------------\n");

    questionHash = createHash("sha256").update(question).digest();
  });

  it("Initializes a new market", async () => {
    console.log("\n--- TEST 1: Initialize a New Market ---");
    console.log(`📝 Question: "${question}"`);

    const durationSeconds = new anchor.BN(60 * 60 * 24 * 30); // 30 days
    const minBetAmount = new anchor.BN(1_000_000); // 1 token

    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), admin.publicKey.toBuffer(), questionHash],
      program.programId
    );
    vaultAta = await getAssociatedTokenAddress(marketMint, marketPda, true);
    console.log(`   Market PDA: ${marketPda.toBase58()}`);
    console.log(`   Vault ATA: ${vaultAta.toBase58()}`);

    console.log("\n➡️  Sending transaction to initialize market...");
    await program.methods
      .initializeMarket(
        Array.from(questionHash),
        question,
        durationSeconds,
        minBetAmount
      )
      .accountsPartial({
        admin: admin.publicKey,
        market: marketPda,
        mint: marketMint,
        vault: vaultAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();
    console.log("✅ Market initialized successfully!");

    const marketAccountData = await program.account.market.fetch(marketPda);
    console.log("\n🔎 Verifying on-chain data...");
    console.table([
      {
        Question: marketAccountData.question,
        "Is Settled": marketAccountData.isSettled,
        Admin: marketAccountData.admin.toBase58(),
      },
    ]);
    expect(marketAccountData.question).to.equal(question);
  });

  it("Allows a user to place a bet", async () => {
    console.log("\n--- TEST 2: Place a Bet ---");
    const betAmount = new anchor.BN(10 * 1_000_000); // 10 tokens

    console.log(`💰 Funding User 1's token account...`);
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
    console.log(`   ✅ User 1 now has 100 tokens.`);

    const [userPositionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        marketPda.toBuffer(),
        user1.publicKey.toBuffer(),
      ],
      program.programId
    );

    console.log(
      `\n➡️  User 1 placing a 'YES' bet of ${formatTokens(betAmount)} tokens...`
    );
    await program.methods
      .placeBet(true, betAmount)
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
    console.log("✅ Bet placed successfully!");

    console.log("\n🔎 Verifying on-chain data...");
    const vaultAccount = await getAccount(provider.connection, vaultAta);
    const marketAccount = await program.account.market.fetch(marketPda);
    console.log(
      `   Vault now contains: ${formatTokens(vaultAccount.amount)} tokens`
    );
    console.table([
      {
        "Total Yes Amount": formatTokens(marketAccount.totalYesAmount),
        "Total No Amount": formatTokens(marketAccount.totalNoAmount),
      },
    ]);
    expect(vaultAccount.amount.toString()).to.equal(betAmount.toString());
  });

  it("Allows the admin to settle an expired market", async () => {
    console.log("\n--- TEST 3: Settle an Expired Market ---");
    console.log("⚙️  Creating a new, instantly-expired market...");
    const expiredMarketQuestion = "Is this test market expired?";
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
    console.log(`   ✅ Expired market created: ${expiredMarketPda.toBase58()}`);

    const winningOutcome = true;
    console.log(
      `\n➡️  Admin settling the market with outcome: '${
        winningOutcome ? "YES" : "NO"
      }'...`
    );
    await program.methods
      .settleMarket(winningOutcome)
      .accounts({ admin: admin.publicKey, market: expiredMarketPda })
      .signers([admin])
      .rpc();
    console.log("✅ Market settled successfully!");

    console.log("\n🔎 Verifying on-chain data...");
    const settledMarketAccount = await program.account.market.fetch(
      expiredMarketPda
    );
    console.table([
      {
        "Is Settled": settledMarketAccount.isSettled,
        "Winning Outcome": settledMarketAccount.winningOutcome,
      },
    ]);
    expect(settledMarketAccount.isSettled).to.be.true;
  });

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("Allows a winning user to withdraw their payout", async () => {
    console.log("\n--- TEST 4: Full Lifecycle - Bet, Settle, Withdraw ---");
    console.log("⚙️  Creating a new market with a 10-second duration...");
    const withdrawMarketQuestion = "Will the winner get paid?";
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
    console.log(`   ✅ Market created: ${withdrawMarketPda.toBase58()}`);

    const winnerAmount = new anchor.BN(20 * 1_000_000);
    const loserAmount = new anchor.BN(10 * 1_000_000);
    const totalPool = new anchor.BN(
      winnerAmount.toNumber() + loserAmount.toNumber()
    );

    console.log("\n💰 Funding two bettors...");
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
    console.log(`   - Winner (User 1) funded with 100 tokens.`);
    console.log(`   - Loser (User 2) funded with 100 tokens.`);

    console.log("\n➡️  Placing bets...");
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
    console.log(
      `   - Winner places a 'YES' bet of ${formatTokens(winnerAmount)} tokens.`
    );

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
    console.log(
      `   - Loser places a 'NO' bet of ${formatTokens(loserAmount)} tokens.`
    );
    console.log(`   Total pool is now: ${formatTokens(totalPool)} tokens.`);

    console.log("\n⏳ Waiting for market to expire (11 seconds)...");
    await sleep(11000);

    console.log("\n➡️  Admin settling the market, 'YES' wins...");
    await program.methods
      .settleMarket(true)
      .accounts({ admin: admin.publicKey, market: withdrawMarketPda })
      .signers([admin])
      .rpc();
    console.log("   ✅ Market settled.");

    const balanceBefore = (
      await getAccount(provider.connection, winnerAta.address)
    ).amount;
    console.log(
      `\n💰 Winner's balance before withdrawal: ${formatTokens(
        balanceBefore
      )} tokens`
    );
    console.log("➡️  Winner is now withdrawing their payout...");
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
    console.log("✅ Withdrawal successful!");

    console.log("\n🔎 Verifying final state...");
    const balanceAfter = (
      await getAccount(provider.connection, winnerAta.address)
    ).amount;
    const vaultBalance = (
      await getAccount(provider.connection, withdrawVaultAta)
    ).amount;
    const winnerPositionAccount = await program.account.userPosition.fetch(
      winnerPositionPda
    );

    console.log(
      `   Winner's balance after withdrawal: ${formatTokens(
        balanceAfter
      )} tokens`
    );
    console.log(
      `   Vault balance after withdrawal: ${formatTokens(vaultBalance)} tokens`
    );
    console.table([
      { "Has Winner Claimed?": winnerPositionAccount.hasClaimed },
    ]);

    expect(balanceAfter).to.equal(balanceBefore + BigInt(totalPool.toString()));
    expect(vaultBalance).to.equal(BigInt(0));
  });

  it("Allows the admin to cancel an active market", async () => {
    console.log("\n--- TEST 5: Cancel an Active Market ---");
    console.log("⚙️  Creating a new, active market...");
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
    console.log(`   ✅ Active market created: ${cancelMarketPda.toBase58()}`);

    console.log("\n➡️  Admin is cancelling the market...");
    await program.methods
      .cancelMarket()
      .accounts({ admin: admin.publicKey, market: cancelMarketPda })
      .signers([admin])
      .rpc();
    console.log("✅ Market cancelled successfully!");

    console.log("\n🔎 Verifying on-chain data...");
    const cancelledMarketAccount = await program.account.market.fetch(
      cancelMarketPda
    );
    console.table([{ "Is Cancelled": cancelledMarketAccount.isCancelled }]);
    expect(cancelledMarketAccount.isCancelled).to.be.true;
  });
});
