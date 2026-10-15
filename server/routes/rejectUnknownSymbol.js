// Sends a 404 and returns true if the engine doesn't trade this symbol.
function rejectUnknownSymbol(engine, res, symbol) {
  if (engine.hasSymbol(symbol)) {
    return false;
  }
  res.status(404).json({ error: 'Unknown symbol: ' + symbol });
  return true;
}

module.exports = rejectUnknownSymbol;
