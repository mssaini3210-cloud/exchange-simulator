-- The cash a buy order still holds in reserve (paise). Sell orders reserve
-- shares instead, and the number they hold is always their remaining.
ALTER TABLE orders ADD COLUMN reserved_cash BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD CHECK (reserved_cash >= 0);
ALTER TABLE orders ADD CHECK (side = 'buy' OR reserved_cash = 0);

-- Status, remaining and cancel_reason must always agree.
ALTER TABLE orders ADD CHECK ((status = 'filled') = (remaining = 0));
ALTER TABLE orders ADD CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL));
ALTER TABLE orders ADD CHECK (
  cancel_reason IN ('cancelled by user', 'self-trade', 'no liquidity', 'server restart')
);

-- For finding open orders (startup cleanup, GET /orders?status=open).
CREATE INDEX orders_status_idx ON orders (status);
