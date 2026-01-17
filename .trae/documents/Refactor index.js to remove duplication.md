I will refactor `d:\my_programs\Trade\ema-atr-trade\index.js` to remove duplicate code and improve maintainability without changing any functionality.

**Refactoring Steps:**

1.  **Dynamic State Initialization**:
    *   Replace the manual initialization of `positionState`, `tradingEnabled`, `ignoreShortSignals`, `longOnly`, `longEntryPrice`, and `longAddedHalfOnce` with a dynamic loop based on `TRADING_PAIRS`. This removes the need to manually add new pairs to every state object.

2.  **Extract `closeAndLogPosition` Helper**:
    *   Create a reusable function to handle the common pattern: `getPositions` -> `closePosition` -> `logTrade` -> `logCloseSummary`.
    *   This will replace the 4 repetitive blocks where positions are closed and summaries are logged.

3.  **Extract `reevaluateAndOpen` Helper**:
    *   Create a reusable function to handle the "Close -> Re-evaluate -> Open" logic.
    *   This function will:
        *   Fetch fresh K-line data (`fetchKlines`).
        *   Recalculate indicators (`EMA`, `ATR`, `priceDistance`).
        *   Check entry conditions (Long or Short).
        *   Place order if conditions are met (`placeOrder`).
        *   Update state variables.
    *   This will replace the repetitive logic found in `processSymbol` (after closing Long/Short) and in `processTelegramCommand` (for `/只做多`).

4.  **Apply Helpers to `processSymbol`**:
    *   Refactor the main logic flow to use these new helper functions, significantly reducing the size and complexity of the function.

5.  **Apply Helpers to `processTelegramCommand`**:
    *   Refactor the `/只做多` command logic to use the `closeAndLogPosition` and `reevaluateAndOpen` helpers, ensuring consistent behavior with the main loop.

**Verification:**
*   I will verify that the code structure is valid and that all variable references are correct.
*   Since I cannot run live trading tests, I will ensure the logic flow remains identical to the original by carefully mapping the extracted code back to the original locations.
