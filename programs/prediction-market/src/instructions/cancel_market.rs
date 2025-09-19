use anchor_lang::prelude::*;
use crate::state::Market;
use crate::errors::PredictionMarketError;

#[derive(Accounts)]
pub struct CancelMarket<'info> {
    #[account(
        constraint = admin.key() == market.admin @ PredictionMarketError::UnauthorizedAdmin
    )]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        constraint = !market.is_settled @ PredictionMarketError::MarketAlreadySettled,
        constraint = !market.is_cancelled @ PredictionMarketError::MarketAlreadyCancelled,
    )]
    pub market: Account<'info, Market>,
}

pub fn cancel_market(ctx: Context<CancelMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    
    market.is_cancelled = true;
    
    msg!("Market cancelled: {}", market.question);
    
    Ok(())
}