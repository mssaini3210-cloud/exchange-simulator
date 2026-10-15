-- Not used until Day 5. Order ids will come from this table's sequence,
-- so they stay unique across server restarts.
CREATE TABLE orders (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users (id),
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  type          TEXT NOT NULL CHECK (type IN ('limit', 'market')),
  price         BIGINT CHECK (price > 0), -- paise; NULL for market orders
  quantity      BIGINT NOT NULL CHECK (quantity > 0),
  remaining     BIGINT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open', 'filled', 'cancelled')),
  cancel_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((type = 'market') = (price IS NULL)),
  CHECK (remaining >= 0 AND remaining <= quantity)
);

CREATE INDEX orders_user_id_idx ON orders (user_id);
