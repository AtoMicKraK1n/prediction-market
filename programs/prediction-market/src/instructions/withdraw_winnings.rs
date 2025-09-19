use anchor_lang::prelude::*;
use crate::state::{Market, UserPosition};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::errors::PredictionMarketError;

#[derive(Accounts)]
pub struct WithdrawWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = market.is_settled @ PredictionMarketError::MarketNotSettled
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.user == user.key() @ PredictionMarketError::InvalidUserPosition,
        constraint = !user_position.has_claimed @ PredictionMarketError::AlreadyClaimed,
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(
        mut,
        constraint = vault.owner == market.key(),
        constraint = vault.mint == market.mint,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == market.mint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn withdraw_winnings(ctx: Context<WithdrawWinnings>) -> Result<()> {
    let market = &ctx.accounts.market;
    let user_position = &mut ctx.accounts.user_position;

    let winning_outcome = market.winning_outcome.unwrap();
    let user_bet_on_winning_side = user_position.get_bet_amount_for_outcome(winning_outcome);

    require!(
        user_bet_on_winning_side > 0,
        PredictionMarketError::NoWinningBet
    );

    let payout = market.calculate_payout(user_bet_on_winning_side, winning_outcome);

    require!(
        payout > 0,
        PredictionMarketError::NoWinningsToWithdraw
    );

    // SPL token transfer from vault (market's PDA) to user's token account
    let seeds = &[
        b"market",
        market.admin.as_ref(),
        market.question.as_bytes(),
        &[market.bump],
    ];
    let signer = &[&seeds[..]];
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.market.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
    token::transfer(cpi_ctx, payout)?;

    user_position.has_claimed = true;

    msg!(
        "Winnings withdrawn: {} tokens | Original bet: {} tokens",
        payout,
        user_bet_on_winning_side
    );

    Ok(())
}