const ValidationError = require('../engine/ValidationError');
const formatIST = require('../formatIST');
const { MAX_PRICE, MAX_QUANTITY } = require('../config');
const TradingHaltedError = require('./TradingHaltedError');
const db = require('../db/orders');

// Places one order. Must run inside the SerialQueue.
//
// 1. Preview: ask the engine what WOULD happen, without changing the book.
// 2. Database: in one transaction, check and reserve the user's cash or
//    shares, save the order (this gives its id), settle every fill, and
//    cancel any remainder. If anything fails, ROLLBACK: the book was never
//    touched, so the book and the database still agree.
// 3. Apply: only after COMMIT, make the same changes in the engine.
//
// trading is { engine, halted } (see app.js).
// request is { userId, symbol, side, type, price, quantity }.
async function placeOrder(pool, trading, request) {
  if (trading.halted) {
    throw new TradingHaltedError();
  }
  checkLimits(request.price, request.quantity);

  // 1. Preview (also validates the order: a bad one throws here, before
  //    the database is touched).
  const preview = trading.engine.previewOrder(request);
  const isBuy = request.side === 'buy';
  const isMarket = request.type === 'market';
  const price = isMarket ? null : request.price;

  // 2. Database transaction.
  const client = await pool.connect();
  let orderId;
  const trades = [];
  try {
    await client.query('BEGIN');

    let reservedCash = 0;
    if (isBuy) {
      // A limit buy may pay up to its price for every share. A market buy
      // pays exactly what the preview found in the book.
      reservedCash = isMarket ? costOf(preview.fills) : price * request.quantity;
      const balance = await db.lockBalance(client, request.userId);
      if (balance.cash - balance.reserved_cash < reservedCash) {
        throw new ValidationError('Insufficient funds');
      }
      await db.changeReservedCash(client, request.userId, reservedCash);
    } else {
      const holding = await db.lockHolding(client, request.userId, request.symbol);
      if (holding.quantity - holding.reserved_quantity < request.quantity) {
        throw new ValidationError('Insufficient shares');
      }
      await db.changeReservedShares(client, request.userId, request.symbol, request.quantity);
    }

    orderId = await db.insertOrder(client, {
      userId: request.userId,
      symbol: request.symbol,
      side: request.side,
      type: isMarket ? 'market' : 'limit',
      price: price,
      quantity: request.quantity,
      reservedCash: reservedCash,
    });

    for (const fill of preview.fills) {
      const cost = fill.price * fill.quantity;
      let buyerReleases = cost; // a resting buy trades at its own price
      if (isBuy) {
        buyerReleases = isMarket ? cost : price * fill.quantity;
      }
      const executedAt = await db.settleTrade(client, {
        symbol: request.symbol,
        buyUserId: isBuy ? request.userId : fill.restingUserId,
        sellUserId: isBuy ? fill.restingUserId : request.userId,
        buyOrderId: isBuy ? orderId : fill.restingOrderId,
        sellOrderId: isBuy ? fill.restingOrderId : orderId,
        price: fill.price,
        quantity: fill.quantity,
        buyerReleases: buyerReleases,
      });
      trades.push({
        symbol: request.symbol,
        price: fill.price,
        quantity: fill.quantity,
        timestamp: executedAt.toISOString(), // UTC, for machines
        timeIST: formatIST(executedAt), // Indian time, for people
      });
    }

    if (preview.cancelledQuantity > 0) {
      await db.cancelAndRelease(client, orderId, preview.cancelReason);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 3. Apply to the engine. Nothing else can have changed the book since
  //    the preview (we're in the queue), so this must give the same fills.
  //    If it doesn't, the database has something the book doesn't: halt.
  let result;
  try {
    result = trading.engine.addOrder({
      symbol: request.symbol,
      id: orderId,
      userId: request.userId,
      side: request.side,
      type: request.type,
      price: request.price,
      quantity: request.quantity,
    });
  } catch (err) {
    halt(trading, err);
    throw err;
  }
  if (!sameAsPreview(result, preview, request.side)) {
    const err = new Error('Engine result differs from preview for order ' + orderId);
    halt(trading, err);
    throw err;
  }

  return {
    orderId: orderId,
    symbol: request.symbol,
    status: statusOf(preview),
    trades: trades,
    restingOrder: result.restingOrder,
    cancelledQuantity: preview.cancelledQuantity,
    cancelReason: preview.cancelReason,
  };
}

// Stop all trading until a restart. A restart cancels every open order
// and releases its reservation, which makes the book and database agree.
function halt(trading, err) {
  trading.halted = true;
  console.error('TRADING HALTED: engine and database disagree.', err);
}

function checkLimits(price, quantity) {
  if (Number.isInteger(price) && price > MAX_PRICE) {
    throw new ValidationError('Price must be at most ' + MAX_PRICE + ' paise');
  }
  if (Number.isInteger(quantity) && quantity > MAX_QUANTITY) {
    throw new ValidationError('Quantity must be at most ' + MAX_QUANTITY);
  }
}

function costOf(fills) {
  let total = 0;
  for (const fill of fills) {
    total += fill.price * fill.quantity;
  }
  return total;
}

function statusOf(preview) {
  if (preview.wouldRest) {
    return 'open';
  }
  if (preview.cancelledQuantity > 0) {
    return 'cancelled';
  }
  return 'filled';
}

// Did the engine do exactly what the preview said?
function sameAsPreview(result, preview, side) {
  if (result.trades.length !== preview.fills.length) {
    return false;
  }
  for (let i = 0; i < preview.fills.length; i++) {
    const trade = result.trades[i];
    const fill = preview.fills[i];
    const restingOrderId = side === 'buy' ? trade.sellOrderId : trade.buyOrderId;
    if (restingOrderId !== fill.restingOrderId || trade.price !== fill.price || trade.quantity !== fill.quantity) {
      return false;
    }
  }
  return (
    result.cancelledQuantity === preview.cancelledQuantity &&
    result.cancelReason === preview.cancelReason &&
    (result.restingOrder !== null) === preview.wouldRest
  );
}

module.exports = placeOrder;
