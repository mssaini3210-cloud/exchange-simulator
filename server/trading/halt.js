// Stops all trading until a restart. Called when the engine and the
// database disagree, which only a bug can cause. A restart cancels every
// open order and releases its reservation, which makes them agree again.
function halt(trading, err) {
  trading.halted = true;
  console.error('TRADING HALTED: engine and database disagree.', err);
}

module.exports = halt;
