# JAM shop backend

Orders, stock and payment checks for https://sa-jam.com. Runs on Supabase.

- `migrations/001_shop.sql`: tables and the order logic (hold stock for 20 minutes, release unpaid holds, close paid orders).
- `migrations/002_seed_products.sql`: starting stock.
- `functions/shop/index.ts`: the API the site talks to. Deploy with JWT verification off, because shoppers and Moyasar's webhook call it without a Supabase login.

## Secrets to set on the function

| Name | What it is |
|---|---|
| `MOYASAR_SECRET_KEY` | Moyasar secret key (`sk_test_...` while testing, `sk_live_...` after activation) |
| `MOYASAR_WEBHOOK_SECRET` | Any long random text. Type the same text into Moyasar > Settings > Webhooks |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Where the new-order message is sent |

## Turning payments on for the site

In `js/data.js` set `API` to the function address (`https://<project>.supabase.co/functions/v1/shop`) and `PAY_KEY` to Moyasar's publishable key (`pk_...`). With either one empty the site stays in preview mode.

Moyasar webhook: `https://<project>.supabase.co/functions/v1/shop/webhook`, event `payment_paid`.

## How a sale goes

1. Shopper sends the delivery form. The API holds the pieces and opens an order with a total it computed itself.
2. Shopper pays in Moyasar's form. The payment carries the order id.
3. Back on the site, the API asks Moyasar for that payment and checks status, amount and currency before marking the order paid.
4. Stock drops, and the owner gets one message per order.

Changing stock by hand: edit the `stock` column of `products` in the Supabase table editor.
