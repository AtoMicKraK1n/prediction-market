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

  let marketMint: PublicKey = null;

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
  });

  it("Initializes a new market", async () => {
    try {
      const question = "Will Solana price be above $200 by EOY 2025?";
      const durationSeconds = new anchor.BN(60 * 60 * 24 * 30);
      const minBetAmount = new anchor.BN(1_000_000);

      const questionHash = createHash("sha256").update(question).digest();

      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), admin.publicKey.toBuffer(), questionHash],
        program.programId
      );

      const vaultAta = await getAssociatedTokenAddress(
        marketMint,
        marketPda,
        true
      );

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
});
