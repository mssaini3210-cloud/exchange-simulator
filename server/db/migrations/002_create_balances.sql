-- One row per user. Amounts are in paise.
-- cash is the total; reserved_cash is the part locked by open buy orders.
-- Available to spend = cash - reserved_cash.
CREATE TABLE balances (
  user_id       BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  cash          BIGINT NOT NULL,
  reserved_cash BIGINT NOT NULL DEFAULT 0,
  CHECK (cash >= 0),
  CHECK (reserved_cash >= 0 AND reserved_cash <= cash)
);
