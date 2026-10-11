# Decisions Log

## Day 1

### What I built

- **Order book:** a list of everyone waiting to buy (bids) and everyone
  waiting to sell (asks) for one stock.
- **Price level:** all the orders waiting at one price, standing in a queue.
  Whoever came first gets served first.
- **Matching:** when a new order comes in, check if someone on the other side
  has a price that works. If yes, they trade. If not, the new order waits.
- **Cancel:** take a waiting order out of the queue.
- **38 tests** that check all of this works.

### The rule: price-time priority

1. Best price goes first.
   - Best bid = the HIGHEST buy price (that buyer pays the most).
   - Best ask = the LOWEST sell price (that seller charges the least).
2. Same price? Whoever came first goes first.

### Example to remember

Sellers waiting: 5 shares at ₹100, 5 shares at ₹101.
A buyer comes: "buy 8 shares, up to ₹101".

- Takes 5 shares at ₹100 (cheapest first).
- Takes 3 shares at ₹101.
- 2 shares at ₹101 are still waiting in the book.

### Why I built it this way

**Why give each order a number (seq) and not a clock time?**
Two orders can come in at the exact same millisecond. A counter (1, 2, 3...)
always tells me who came first.

**Why a linked list for the queue at each price?**
Each order holds hands with the one before and after it. To cancel an order
in the middle, I just join its two neighbours' hands. Nothing else moves.
With an array, everyone behind would have to shift up one place.

**Why is the best price kept at the END of the price list?**
Taking the last item off a list is instant. Taking the first item makes
everything else shift. Matching always uses the best price, so I keep it
where it's fastest to reach.

**Why does the trade happen at the waiting order's price?**
The waiting order was there first and showed its price. The new order only
said the worst price it would accept. So: buyer says "up to ₹101", seller is
waiting at ₹100, they trade at ₹100. The buyer gets a better deal.

**Why not a heap?**
A heap is good at finding the best price, but bad at removing something from
the middle (needed for cancels) and bad at listing prices in order (needed to
show the order book on screen).

### How fast is each operation

- Find best price: instant.
- Add an order at a price that already exists: instant.
- Add an order at a brand-new price: may need to shift the price list.
- Cancel: instant (I keep a lookup from order id to its place in the queue).
- Match: one step per trade.

"Instant" is written O(1) in interviews.

### What I got wrong (study these again)

- **Which bid is best?** I said the lower one. Wrong: the HIGHEST bid is best.
  Bids: highest wins. Asks: lowest wins.
- **Where does a new sell order go in the price list?** Asks are stored from
  expensive to cheap, so the cheapest is last. A new cheapest ask goes at the
  end. Anything else slots into the middle.

### Still to finish

- Walkthrough parts 4, 5 and 6 with Claude Code.