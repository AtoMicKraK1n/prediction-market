use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub admin: Pubkey,
    #[max_len(280)]
    pub question: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub min_bet_amount: u64,
    pub total_yes_amount: u64,
    pub total_no_amount: u64,
    pub yes_bettors_count: u32,
    pub no_bettors_count: u32,
    pub is_settled: bool,
    pub is_cancelled: bool,
    pub winning_outcome: Option<bool>,
    pub mint: Pubkey,
    pub bump: u8,
}

impl Market {

    pub fn is_active(&self) -> bool {
        let clock = Clock::get().unwrap();
        !self.is_settled && 
        !self.is_cancelled && 
        clock.unix_timestamp < self.expires_at
    }

    pub fn is_expired(&self) -> bool {
        let clock = Clock::get().unwrap();
        clock.unix_timestamp >= self.expires_at
    }

    pub fn total_pool(&self) -> u64 {
        self.total_yes_amount.saturating_add(self.total_no_amount)
    }

    pub fn calculate_payout(&self, bet_amount: u64, bet_outcome: bool) -> u64 {
        if self.winning_outcome != Some(bet_outcome) {
            return 0;
        }

        let total_pool = self.total_pool();
        if total_pool == 0 {
            return bet_amount;
        }

        let winning_side_total = if bet_outcome {
            self.total_yes_amount
        } else {
            self.total_no_amount
        };

        if winning_side_total == 0 {
            return bet_amount;
        }

        // Payout = (bet_amount / winning_side_total) * total_pool
        bet_amount
            .checked_mul(total_pool)
            .unwrap_or(0)
            .checked_div(winning_side_total)
            .unwrap_or(bet_amount)
    }
}