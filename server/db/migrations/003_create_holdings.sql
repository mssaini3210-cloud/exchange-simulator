-- One row per user per stock.
-- quantity is the total; reserved_quantity is the part locked by open
-- sell orders. Available to sell = quantity - reserved_quantity.
CREATE TABLE holdings (
  user_id           BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  symbol            TEXT NOT NULL,
  quantity          BIGINT NOT NULL,
  reserved_quantity BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, symbol),
  CHECK (quantity >= 0),
  CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity)
);
