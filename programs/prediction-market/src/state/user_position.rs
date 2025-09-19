use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub market: Pubkey,
    pub user: Pubkey,
    pub yes_amount: u64,
    pub no_amount: u64,
    pub has_claimed: bool,
    pub bump: u8,
}

impl UserPosition {
    pub fn total_bet_amount(&self) -> u64 {
        self.yes_amount.saturating_add(self.no_amount)
    }

    pub fn get_bet_amount_for_outcome(&self, outcome: bool) -> u64 {
        if outcome {
            self.yes_amount
        } else {
            self.no_amount
        }
    }
}