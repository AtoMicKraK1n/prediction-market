use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use anchor_lang::solana_program::hash::hash;
use crate::state::Market;
use crate::errors::PredictionMarketError;

#[derive(Accounts)]
#[instruction(question_hash: [u8; 32], question: String)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", admin.key().as_ref(), &question_hash],
        bump
    )]
    pub market: Account<'info, Market>,

    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_market(
    ctx: Context<InitializeMarket>,
    question_hash: [u8; 32],
    question: String,
    duration_seconds: i64,
    min_bet_amount: u64,
) -> Result<()> {
    let recomputed_hash = hash(question.as_bytes()).to_bytes();
    require!(
        recomputed_hash == question_hash,
        PredictionMarketError::InvalidQuestionHash
    );

    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    pub const MAX_QUESTION_LENGTH: usize = 280;

    require!(
        question.len() <= MAX_QUESTION_LENGTH,
        PredictionMarketError::QuestionTooLong
    );

    require!(
        duration_seconds > 0,
        PredictionMarketError::InvalidDuration
    );

    require!(
        min_bet_amount > 0,
        PredictionMarketError::InvalidMinBetAmount
    );

    market.admin = ctx.accounts.admin.key();
    market.question = question;
    market.created_at = clock.unix_timestamp;
    market.expires_at = clock.unix_timestamp.saturating_add(duration_seconds);
    market.min_bet_amount = min_bet_amount;
    market.total_yes_amount = 0;
    market.total_no_amount = 0;
    market.yes_bettors_count = 0;
    market.no_bettors_count = 0;
    market.is_settled = false;
    market.is_cancelled = false;
    market.winning_outcome = None;
    market.bump = ctx.bumps.market;

    msg!(
        "Market initialized: {} | Expires at: {} | Min bet: {}",
        market.question,
        market.expires_at,
        market.min_bet_amount
    );

    Ok(())
}