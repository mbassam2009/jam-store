# JAM shop backend

Orders, stock and payment checks for https://sa-jam.com. Runs on Supabase.

- `migrations/001_shop.sql`: tables and the order logic (hold stock for 20 minutes, release unpaid holds, close paid orders).
- `migrations/002_seed_products.sql`: starting stock.
- `migrations/003_versailles_prices_shipping.sql`: the Versailles sets, sets at 379 SAR, free shipping from 700 SAR.
- `functions/shop/index.ts`: the API the site talks to. Deploy with JWT verification off, because shoppers call it without a Supabase login.

## Payments: Paylink

The function talks to Paylink (https://developer.paylink.sa). With no secrets set it runs on Paylink's **test** system using the test keys Paylink publishes, and the site only opens checkout through `https://sa-jam.com/?test=1`.

To go live, set these two secrets on the function (Supabase > Edge Functions > Secrets). They come from my.paylink.sa:

| Name | What it is |
|---|---|
| `PAYLINK_API_ID` | Paylink API ID |
| `PAYLINK_SECRET_KEY` | Paylink secret key |

Optional: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to get a message per order.

## How a sale goes

1. Shopper sends the delivery form. The API holds the pieces, opens an order with a total it computed itself, and creates a Paylink invoice for exactly that amount.
2. Shopper pays on Paylink's page, shown inside the checkout page.
3. Paylink sends the shopper back to the site with the invoice number. The API asks Paylink for that invoice and checks status and amount before marking the order paid.
4. Stock drops. If the shopper paid but never came back, `POST /reconcile` finds the payment; a database timer calls it every few minutes.

Changing stock by hand: edit the `stock` column of `products` in the Supabase table editor.

An earlier version used Moyasar. It is in the git history before the commit that introduced Paylink.
