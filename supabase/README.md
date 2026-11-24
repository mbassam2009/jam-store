# JAM shop backend

Orders, stock and payment checks for https://sa-jam.com. Runs on Supabase.

- `migrations/001_shop.sql`: tables and the order logic (hold stock for 20 minutes, release unpaid holds, close paid orders).
- `migrations/002_seed_products.sql`: starting stock.
- `migrations/003_versailles_prices_shipping.sql`: the Versailles sets, sets at 379 SAR, free shipping from 700 SAR.
- `functions/shop/index.ts`: the API the site talks to. Deploy with JWT verification off, because shoppers and Moyasar's webhook call it without a Supabase login.

## Secrets to set on the function

| Name | What it is |
|---|---|
| `MOYASAR_SECRET_KEY` | Moyasar secret key (`sk_test_...` while testing, `sk_live_...` after activation) |
| `MOYASAR_PUBLISHABLE_KEY` | Moyasar publishable key, same mode as the secret key (`pk_live_...` with `sk_live_...`). Optional in test mode |
| `MOYASAR_WEBHOOK_SECRET` | Any long random text. Type the same text into Moyasar > Settings > Webhooks |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Where the new-order message is sent |

## Turning payments on for the site

`js/data.js` holds `API`, the function address. The site asks `GET /stock` whether payments are on, which mode they are in and which publishable key to use, so switching from test to live is only a matter of saving the two live keys above. No change to the site is needed.

- Both keys live: checkout is open to everyone.
- Test keys: checkout opens only through `https://sa-jam.com/?test=1`; everyone else sees preview mode.
- Missing or mismatched keys (one live, one test): payments stay off and the function logs why.

Moyasar webhook: `https://<project>.supabase.co/functions/v1/shop/webhook`, event `payment_paid`.

## How a sale goes

1. Shopper sends the delivery form. The API holds the pieces and opens an order with a total it computed itself.
2. Shopper pays in Moyasar's form. The payment carries the order id.
3. Back on the site, the API asks Moyasar for that payment and checks status, amount and currency before marking the order paid.
4. Stock drops. The order message is sent only if the Telegram secrets are set (off for now).

Changing stock by hand: edit the `stock` column of `products` in the Supabase table editor.
