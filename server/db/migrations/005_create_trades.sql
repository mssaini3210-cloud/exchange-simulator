-- Not used until Day 5.
CREATE TABLE trades (
  id            BIGSERIAL PRIMARY KEY,
  symbol        TEXT NOT NULL,
  buy_order_id  BIGINT NOT NULL REFERENCES orders (id),
  sell_order_id BIGINT NOT NULL REFERENCES orders (id),
  buy_user_id   BIGINT NOT NULL REFERENCES users (id),
  sell_user_id  BIGINT NOT NULL REFERENCES users (id),
  price         BIGINT NOT NULL CHECK (price > 0), -- paise
  quantity      BIGINT NOT NULL CHECK (quantity > 0),
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (buy_user_id <> sell_user_id) -- no self-trades
);

CREATE INDEX trades_symbol_executed_at_idx ON trades (symbol, executed_at DESC);
