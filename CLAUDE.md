# Exchange Simulator

A simulated stock exchange: users place buy/sell orders, a matching engine
matches them by price-time priority, and updates go out live over WebSocket.

## Stack
Node.js, Express, PostgreSQL (pg), Socket.io, JWT, Jest, React (Vite), Tailwind.

## Rules
- I am a student building this to learn. Explain your plan before writing code.
- Work in small steps: one class or one endpoint at a time.
- Write Jest tests for all engine code.
- The matching engine is plain JavaScript with no framework or database imports.
- Prices are integers in paise, never floats.
- Keep code simple and readable; no clever abstractions.