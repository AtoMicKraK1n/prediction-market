use anchor_lang::prelude::*;

#[error_code]
pub enum PredictionMarketError {
    #[msg("Question is too long")]
    QuestionTooLong,
    
    #[msg("Invalid duration specified")]
    InvalidDuration,
    
    #[msg("Invalid minimum bet amount")]
    InvalidMinBetAmount,
    
    #[msg("Market is not active")]
    MarketNotActive,
    
    #[msg("Bet amount is below minimum")]
    BetAmountTooLow,
    
    #[msg("Market is not expired yet")]
    MarketNotExpired,
    
    #[msg("Market is already settled")]
    MarketAlreadySettled,
    
    #[msg("Market is not settled yet")]
    MarketNotSettled,
    
    #[msg("Market is cancelled")]
    MarketCancelled,
    
    #[msg("Market is already cancelled")]
    MarketAlreadyCancelled,
    
    #[msg("Unauthorized admin")]
    UnauthorizedAdmin,
    
    #[msg("Invalid user position")]
    InvalidUserPosition,
    
    #[msg("Winnings already claimed")]
    AlreadyClaimed,
    
    #[msg("No winning bet found")]
    NoWinningBet,
    
    #[msg("No winnings to withdraw")]
    NoWinningsToWithdraw,
    
    #[msg("Insufficient funds")]
    InsufficientFunds,
    
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid market address")]
    InvalidMarketAddress,

    #[msg("Invalid Question Hash")]
    InvalidQuestionHash,
}