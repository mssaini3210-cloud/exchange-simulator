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

## Day 2

### What I built

**Market orders**: "buy (or sell) now, at whatever price is there". They have
no price. They fill against the best prices until they're done or the book is
empty. Anything left is cancelled, never left waiting.

- Sellers waiting: 3 shares at ₹100, 4 shares at ₹101.
- Market buy for 10 shares: takes 3 at ₹100, then 4 at ₹101.
- 3 shares are left, so they're cancelled (`cancelledQuantity: 3`).
- Market order on an empty book: no trades, all of it cancelled.

**userId**: every order now says who placed it, and every trade says who
bought and who sold (`buyUserId`, `sellUserId`).

- Alice is waiting to sell 5 at ₹100. Bob buys 5 at ₹100.
- Trade: 5 shares at ₹100, buyer = bob, seller = alice.

**MatchingEngine**: holds one order book per stock and sends each order to
the right one. A stock it doesn't know about is rejected.

- Engine made with `['INFY', 'TCS']`.
- A sell for INFY at ₹100 and a buy for TCS at ₹100 never trade. They're
  different books.
- An order for `'WIPRO'` throws "Unknown symbol: WIPRO".
- Cancel needs the stock too, because order id 1 can exist in INFY and TCS.

**Self-trade prevention**: a user can't trade with themselves. If an incoming
order reaches a waiting order from the same user, matching stops and the rest
of the incoming order is cancelled.

- Bob is waiting to sell 3 at ₹100, then Alice sells 3 at ₹100 behind him.
- Alice buys 8 at ₹100.
- She gets 3 from Bob, then reaches her own order and stops.
- 5 are cancelled (`cancelledQuantity: 5`). Her sell order is untouched.

### Interview points

**What stops a market order filling at a terrible price on a thin book?**
A thin book has only a few orders. A big market order eats through all of
them and can end up paying a crazy price. In my engine, a market buy can pay
₹999 if that's the only seller left. Real exchanges protect against this:

- **Price bands**: orders can't trade more than a set % away from a reference
  price (for example, the last trade).
- **Sweep limits**: a market order may only go a set distance from the best
  price it started at. Anything beyond that is cancelled.

**Self-trade: "cancel newest" vs "cancel oldest"?**
- **Cancel newest** (what I built): the incoming order is cancelled and the
  waiting order stays.
- **Cancel oldest**: the waiting order is cancelled and the incoming order
  keeps matching.
- Some exchanges also offer "cancel both". Usually the user picks which rule
  they want.

## Day 3

### What I built

An **HTTP API** around the matching engine, using Express. Other programs
(later, my React frontend) send requests to it and get JSON back. Everything
lives in memory: restart the server and the book is empty again. No database
and no real login yet.

- One engine with three stocks: INFY, TCS, RELIANCE.
- The API gives out order ids (1, 2, 3...) itself.
- Each trade gets the stock symbol, a UTC `timestamp` and a readable
  `timeIST` (for example "15 Oct 2026, 10:40:12 am").
- It keeps the last 100 trades per stock.
- Prices are still whole paise: ₹1500.00 is sent as `150000`.

### The endpoints

| Request | What it does |
|---|---|
| `GET /symbols` | List the stocks |
| `POST /orders` | Place an order. Body: `{ symbol, side, type, price, quantity }` |
| `DELETE /orders/INFY/1` | Cancel my order 1 in INFY |
| `GET /book/INFY` | Top 10 price levels on each side |
| `GET /trades/INFY` | Last 100 trades, newest first |

Example: Alice posts a sell for 5 INFY at `150000`. Bob posts a buy for 2 at
`150000`. Bob's response has one trade (2 shares at ₹1500), and
`GET /book/INFY` now shows 3 shares left on the ask side.

### Why app.js and index.js are separate

- **app.js** builds the app: the routes, the engine, the trade list. It
  doesn't start a server.
- **index.js** just starts it: `createApp().listen(3000)`.

Tests use supertest to send fake requests straight to the app, with no real
server or port needed. Each test calls `createApp()` to get a fresh app with
an empty book, so one test can't mess up another.

### What middleware is

Code that runs on **every request before it reaches the route**, like a
security guard at the door. Each one does its job, then calls `next()` to
pass the request along, or sends a response itself to stop it there.

My middleware, in order:

1. `express.json()`: turns the JSON body into `req.body`.
2. `requireUser`: no `x-user-id` header? Reply 401 and stop. Otherwise set
   `req.userId` and call `next()`.
3. The routes.
4. The error handler: catches anything a route throws and picks the status
   code.

### What each status code means

| Code | Meaning | Example in this project |
|---|---|---|
| **200** OK | It worked | `GET /book/INFY` returns the book |
| **201** Created | It worked and made something new | `POST /orders` creates order 1 |
| **400** Bad Request | Your input is wrong | Price `1500.5`: "Price must be a positive integer in paise" |
| **401** Unauthorized | I don't know who you are | No `x-user-id` header |
| **403** Forbidden | I know who you are, but you can't do this | Bob tries to cancel Alice's order |
| **404** Not Found | That thing doesn't exist | `GET /book/WIPRO`, or cancelling an order that already filled |
| **500** Server Error | My code broke | An unexpected bug: logged, and the user sees only "Internal server error" |

Easy way to remember: **4xx = the caller's fault, 5xx = my fault.**
401 vs 403: 401 = "who are you?", 403 = "I know you, and no".

### Why ValidationError exists

The engine used to throw a plain `Error` for everything. Then the API can't
tell **"the user sent a bad price"** (their fault → 400) apart from **"my
code has a bug"** (my fault → 500).

Now the engine throws `ValidationError` for bad input. The error handler
checks `err instanceof ValidationError`:

- yes → 400 with the message, so the user can fix their request
- no → 500 with a generic message, and the real error goes to the log

That way bugs never leak internal details to users, and they're never
hidden as "bad input" either.

### Why timestamps are stored in UTC

- UTC is the same everywhere, with no time zones and no daylight saving. A
  server in Mumbai and one in London write the same value for the same
  moment.
- Sorting and comparing times is simple when they all use one zone.
- Converting UTC to any local time is easy. Going the other way is
  error-prone.

So `timestamp` (UTC) is the real value, and `timeIST` is only for people to
read. Rule: **store in UTC, show in local time.**

### Why the x-user-id header is not secure yet

The server just **believes** whatever the header says. Anyone can send
`x-user-id: alice` and act as Alice: place orders in her name, or cancel
her orders. Nothing proves who you really are.

It's a placeholder so I can build "whose order is this?" now. Real auth
(JWT) will fix it: the user logs in with a password, the server signs a
token, and every request must carry that token. The server checks the
signature, so a faked token is rejected.

## Day 4

### What's in PostgreSQL now, and what's still in memory

| In PostgreSQL (survives a restart) | Still in memory (gone on restart) |
|---|---|
| Users and their password hashes | The order books |
| Each user's cash | The last 100 trades |
| Each user's shares | The order id counter |

The `orders` and `trades` tables exist but stay empty until Day 5.
Balances aren't checked yet either: anyone can still buy anything.

### The five tables

- **users**: who can log in. Id, username (unique), password hash, when
  they signed up.
- **balances**: one row per user. How much cash they have, and how much of
  it is reserved.
- **holdings**: one row per user per stock. How many shares they have, and
  how many are reserved.
- **orders**: every order ever placed (from Day 5).
- **trades**: every trade that happened (from Day 5).

### What "reserved" means

Money or shares that are **promised to an open order**, so you can't spend
them twice. Used from Day 5.

- Alice has ₹10,00,000. She places a buy for 10 INFY at ₹1,500.
- ₹15,000 is now reserved. Cash stays ₹10,00,000, but she can only spend
  ₹9,85,000 on new orders.
- If the order fills, the ₹15,000 is really paid. If she cancels, it's
  unreserved.

Same for shares: Alice has 100 TCS and places a sell for 30. 30 are
reserved, so she can only sell 70 more.

The table stores the **total** and the **reserved** part, and the database
checks `reserved <= total`. So it's impossible to reserve money you don't
have, even if my code has a bug.

### What a migration is

A numbered SQL file that changes the database structure, like
`001_create_users.sql`. A small script runs the files in order and
remembers which ones already ran (in a `schema_migrations` table), so
running it again does nothing.

- Every computer (mine, the test database, a server later) ends up with
  exactly the same tables.
- Each file runs in a transaction: if it fails halfway, nothing from it is
  applied.
- **Rule: never edit a migration that already ran.** To change something,
  add a new file (`006_...sql`).

### Why passwords are hashed with bcrypt

I never store the password, only a **hash**: a scrambled version that
can't be turned back into the password. At login, bcrypt hashes what was
typed and compares the two.

- **If the database leaks, the passwords don't.**
- **Salt**: bcrypt adds random data first, so two users with the same
  password get different hashes. Ready-made tables of precomputed hashes
  are useless against it.
- **Slow on purpose**: each guess takes a fraction of a second. That's
  nothing for one login, but it makes trying billions of guesses far too
  slow.
- **Limit**: bcrypt ignores anything after 72 bytes, so I reject longer
  passwords instead of pretending they're stronger.

### What a JWT is, and why it can't be forged

A **JWT** (JSON Web Token) is the "ticket" login gives you. It has three
parts separated by dots: `header.payload.signature`.

- The **payload** says `{ sub: "1", exp: <tomorrow> }`, meaning "this is
  user 1, valid until tomorrow".
- The **signature** is made from the header, the payload and my
  `JWT_SECRET`. Only the server knows the secret.

Change one letter of the payload (say, user 1 → user 2) and the signature
no longer matches, so the server rejects it. Making a new valid signature
needs the secret. So nobody can forge a token.

But: the payload is only **encoded, not encrypted**, so anyone can read it.
Never put secrets in a JWT. And whoever holds the token *is* you until it
expires (1 day), so it must be kept safe.

How it's used: send `Authorization: Bearer <token>` with each request. My
middleware checks the signature and expiry, then sets `req.userId`.

### Why login gives the same error for a wrong username and a wrong password

If I said "no such user" vs "wrong password", an attacker could try names
and learn **which usernames exist**, then focus on those. So both get:
`401 Invalid username or password`.

**The timing trick**: the message isn't the only clue. Checking a password
with bcrypt is slow on purpose. If the username doesn't exist and I return
straight away, that answer comes back much **faster**, and the speed gives
the secret away. So for an unknown username I still run bcrypt against a
**dummy hash**. Both cases take about the same time.

### Why signup uses a transaction

Signup does 5 inserts: the user, their balance, and 3 holdings. A
**transaction** means "all of these or none of them". If the 4th insert
fails, the first 3 are undone (`ROLLBACK`). Without it, I could end up with
a user who has no cash row and breaks every later query. A test forces a
failure halfway and checks that nothing was saved.

### What 409 means

**409 Conflict**: your request is fine, but it clashes with something that
already exists. Example: signing up as `alice` when `alice` is taken.
PostgreSQL rejects the duplicate (error code `23505`) because `username` is
`UNIQUE`, and I turn that into a 409.

Compare: **400** = your input is wrong. **409** = your input is fine, but
it conflicts with current data.

### Why money uses BIGINT

- `INTEGER` tops out at about 2.1 billion. In paise, that's only about
  **₹2.1 crore**, and a good trader could pass that.
- `BIGINT` goes up to about 9 × 10¹⁸, which is more than enough.
- Catch: the `pg` library returns BIGINT as a **string**, because
  JavaScript numbers lose precision above 2⁵³. I convert it back to a
  number. That's safe up to about ₹90 lakh crore, far more than this app
  will ever see.

## Day 5

### What I built

Money is real now. Every order, fill, trade and cancel is saved in
PostgreSQL, and trades actually move cash and shares.

- Order ids come from the `orders` table, so they keep counting after a
  restart.
- You can't buy without the cash or sell without the shares.
- `GET /orders` shows my own orders (`?status=open`, `filled` or
  `cancelled`).
- `GET /trades` and `GET /me` read from the database.

### Preview → database → apply

**The problem:** the engine changes the in-memory book *while* it matches,
and it can't undo that. If the database then failed, the book would show
trades that were never saved, with orders gone from the book but still
"open" in the database.

**The fix: don't touch the book until the database has saved
everything.**

1. **Preview:** ask the engine "what *would* happen?" It walks the book
   but changes nothing.
2. **Database:** in one transaction, check the money, reserve it, save the
   order, settle every fill, then `COMMIT`. If anything fails: `ROLLBACK`.
   The book was never touched, so nothing is out of step.
3. **Apply:** only now does the engine really do it.

Why the preview and the apply always agree: the engine uses **the same
code** for both (`planFills`), and the queue stops anything else changing
the book in between.

### What reserving means

Reserving is **putting money or shares aside the moment an order is
placed**, so the same rupee can't be promised to two orders.

- Bob has ₹10,00,000 and places a buy for 2 TCS at ₹3,400.
- ₹6,800 is reserved. His cash is still ₹10,00,000, but he can only
  spend ₹9,93,200 on new orders.
- If it fills, the reserved money is really paid. If he cancels, it's
  released.
- A sell reserves shares the same way.
- A market buy has no price, so I preview it against the book and reserve
  exactly what it would cost.

If you don't have enough available, the order is rejected with
`400 Insufficient funds` or `400 Insufficient shares`, and it isn't saved
at all.

### The price improvement refund

A limit buy reserves at its **own** price, but it trades at the
**seller's** price, which can be lower. The difference is given back.

- Alice is selling INFY at ₹1,500. Bob places a buy for 4 at ₹1,510.
- Reserved: 4 × ₹1,510 = **₹6,040**.
- It trades at ₹1,500: Bob pays 4 × ₹1,500 = **₹6,000**.
- The other **₹40** goes back to "available". Bob only paid ₹6,000.

(Checked on the real server: Bob's cash went down by exactly ₹6,000.)

Every way an order ends gives back what it still holds:

- cancelled by the user
- stopped by a self-trade
- a market order that ran out of sellers
- a server restart

### Why a queue, even though Node is single-threaded

Node runs one piece of code at a time, **but a request pauses every time
it waits for the database**, and Node runs other requests in those gaps.

Without a queue, two orders can get mixed up:
- Order A previews the book... *waits for the database*...
- Order B changes the book in the meantime...
- Order A then applies to a book that's different from what it previewed.

So every place and cancel goes through a **SerialQueue**: jobs run strictly
one at a time, in arrival order. Reads (`/book`, `/me`, `/orders`,
`/trades`) skip the queue.

Two guards protect money:
- **The queue** keeps the engine and the database in step.
- **`SELECT ... FOR UPDATE`** locks the user's balance row inside the
  transaction, so two transactions can't both spend the same cash.

### What the queue costs

- Every order waits for the previous order's **whole** database
  transaction (about 10 database round trips).
- That's a few hundred orders per second **in total**, for all users and
  all stocks together. Busy times mean waiting, and extra CPU cores sit
  idle.
- Fine for a simulator. Real exchanges run one matcher per stock in
  memory, check money in a separate system, and write to a log instead of
  a database transaction per order.
- Next step for me: one queue per stock, with the row locks protecting
  shared cash.

### What "halt trading" means

If the engine ever does something different from what the preview said,
the database and the book disagree. Only a bug can cause that, but if it
happens:

- That order gets a 500 and the error is logged.
- **Every order and cancel after it gets `503 Trading halted, restart
  required`.** Reads still work.
- Restarting fixes it (see below).

Stopping is safer than trading on a book I can't trust. Real exchanges halt
too.

### What happens on restart

The in-memory book starts empty, so orders left "open" in the database can
never match. Before the server accepts any request, in one transaction:

- every open buy order gives back its reserved cash
- every open sell order gives back its reserved shares
- the orders are marked `cancelled` with reason `server restart`

Trades that already happened stay done. (On the real server: 2 open orders
were cancelled, everyone's reserved went back to 0, and the book was
empty.) Rebuilding the book from the database comes later.

### What the invariant and concurrency tests prove

**Invariant test:** 5 users, 300 random orders and cancels, sent 10 at a
time. Then it checks things that must **always** be true:

- Total cash and total shares of each stock are exactly what everyone
  started with. Nothing was created or lost.
- Nobody has a negative balance.
- Each user's reserved cash and shares match their open orders exactly.
- Each order's filled amount equals the sum of its trades.
- The in-memory book shows exactly the open orders in the database.

It uses a **seeded** random generator: the same seed gives the same run,
so a failure can be replayed exactly. Ten different seeds all passed.

**Concurrency test:** one user sends 20 orders at the same moment
(`Promise.all`), each costing a tenth of her cash. Exactly 10 succeed and
10 get "Insufficient funds". It's the same with shares, and with market
buys.

**What I learned by removing the queue to test the tests:**
- The concurrency test **still passed**, because the `FOR UPDATE` row lock
  alone stops overspending.
- The invariant test **failed**: the book and the database got out of
  step, and trading halted.

So the queue's real job is keeping the engine and the database in step,
and the invariant test is the one that proves it.

### Gotcha I hit

PostgreSQL's `SUM` of a `BIGINT` column returns `NUMERIC`, which `pg`
gives back as a **string** (`"0"`, not `0`). Add `::bigint`:
`SELECT SUM(cash)::bigint ...`.

## Still to finish

- Walkthrough parts 4, 5 and 6 with Claude Code.