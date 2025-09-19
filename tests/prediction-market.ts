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
});
