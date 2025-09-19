use anchor_lang::prelude::*;
use crate::state::Market;
use crate::errors::PredictionMarketError;

#[derive(Accounts)]
pub struct SettleMarket<'info> {
    #[account(
        constraint = admin.key() == market.admin @ PredictionMarketError::UnauthorizedAdmin
    )]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        constraint = !market.is_settled @ PredictionMarketError::MarketAlreadySettled,
        constraint = !market.is_cancelled @ PredictionMarketError::MarketCancelled,
    )]
    pub market: Account<'info, Market>,
}

pub fn settle_market(
    ctx: Context<SettleMarket>,
    winning_outcome: bool,
) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(
        market.is_expired(),
        PredictionMarketError::MarketNotExpired
    );

    market.is_settled = true;
    market.winning_outcome = Some(winning_outcome);

    let winning_side_amount = if winning_outcome {
        market.total_yes_amount
    } else {
        market.total_no_amount
    };

    msg!(
        "Market settled: {} wins | Winning pool: {} SOL | Total pool: {} SOL",
        if winning_outcome { "Yes" } else { "No" },
        winning_side_amount,
        market.total_pool()
    );

    Ok(())
}