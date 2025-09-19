use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
pub mod errors;

use instructions::*;
use errors::PredictionMarketError;

declare_id!("H3qPqHvi36uVLUXCaL3WVvMVgw7uAfG8KwFj3Zc2NTis");

#[program]
pub mod prediction_market {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        question_hash: [u8; 32],
        question: String,
        duration_seconds: i64,
        min_bet_amount: u64,
    ) -> Result<()> {
        instructions::initialize_market(ctx, question_hash, question, duration_seconds, min_bet_amount)
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        outcome: bool, // true for Yes, false for No
        amount: u64,
    ) -> Result<()> {
        instructions::place_bet(ctx, outcome, amount)
    }

    pub fn settle_market(
        ctx: Context<SettleMarket>,
        winning_outcome: bool,
    ) -> Result<()> {
        instructions::settle_market(ctx, winning_outcome)
    }

    pub fn withdraw_winnings(ctx: Context<WithdrawWinnings>) -> Result<()> {
        instructions::withdraw_winnings(ctx)
    }

    pub fn cancel_market(ctx: Context<CancelMarket>) -> Result<()> {
        instructions::cancel_market(ctx)
    }
}