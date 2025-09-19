use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{Market, UserPosition};
use crate::errors::PredictionMarketError;

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = market.is_active() @ PredictionMarketError::MarketNotActive
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == market.mint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault.mint == market.mint,
        constraint = vault.owner == market.key(),
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        space = UserPosition::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn place_bet(
    ctx: Context<PlaceBet>,
    outcome: bool,
    amount: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let user_position = &mut ctx.accounts.user_position;

    require!(
        amount >= market.min_bet_amount,
        PredictionMarketError::BetAmountTooLow
    );

    require!(
        market.is_active(),
        PredictionMarketError::MarketNotActive
    );

    // Transfer SPL tokens from user to market vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Initialize user position if it's new
    if user_position.market == Pubkey::default() {
        user_position.market = market.key();
        user_position.user = ctx.accounts.user.key();
        user_position.yes_amount = 0;
        user_position.no_amount = 0;
        user_position.has_claimed = false;
        user_position.bump = ctx.bumps.user_position;
    }

    // Check if this is the user's first bet on this outcome
    let is_new_bettor = if outcome {
        user_position.yes_amount == 0
    } else {
        user_position.no_amount == 0
    };

    // Update user position
    if outcome {
        user_position.yes_amount = user_position.yes_amount.saturating_add(amount);
        market.total_yes_amount = market.total_yes_amount.saturating_add(amount);
        if is_new_bettor {
            market.yes_bettors_count = market.yes_bettors_count.saturating_add(1);
        }
    } else {
        user_position.no_amount = user_position.no_amount.saturating_add(amount);
        market.total_no_amount = market.total_no_amount.saturating_add(amount);
        if is_new_bettor {
            market.no_bettors_count = market.no_bettors_count.saturating_add(1);
        }
    }

    msg!(
        "Bet placed: {} SOL on {} | Total pool: {} SOL",
        amount,
        if outcome { "Yes" } else { "No" },
        market.total_pool()
    );

    Ok(())
}
