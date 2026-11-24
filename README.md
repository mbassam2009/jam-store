# JAM store

Storefront for JAM (women's matching sets), live at https://sa-jam.com. Static site, no build step, Arabic and right to left.

## Files

- `index.html`: the page shell (header, footer, cart drawer). Every view is drawn into `<main id="app">`.
- `css/style.css`: the whole look. The color of the look on show is the CSS variable `--tone`, and it lights the page.
- `js/data.js`: products, prices, stock, shipping rules, and each city's place on the globe.
- `js/land.js`: the land dots of the globe, built from Natural Earth 110m land (public domain).
- `js/globe.js`: the globe on the home page. Drag it to spin; it settles on the nearest city.
- `js/app.js`: pages (home, product, checkout, returns), cart, and the calls to the shop API.
- `fonts/`: Kufam (headlines), Alexandria (text), Handjet (airport codes and numbers). All under the SIL Open Font License.
- `img/`: product photos. `.github/workflows/photos.yml` copied the ones with long id names from the Salla store; run it again from the Actions tab if a Salla photo is added to `js/data.js`. The Versailles photos (`versailles-*.webp`, 900 by 1200) were added by hand.
- `supabase/`: the shop API (orders, stock, payment check). See `supabase/README.md`.

## Pages

Addresses are hash routes: `#/` home, `#/set/amalfi` jumps to a set, `#/p/amalfi/pink` a product, `#/checkout`, `#/returns`.

## Changing things

- New color or set: add a row to `ROWS` in `js/data.js` (and the set to `SETS` and `SET_ORDER`), add the stock row in Supabase, add the photos.
- Price or shipping: `PRICE`, `COMPARE_AT`, `SHIPPING` in `js/data.js`. A set with its own price carries `price`, `compareAt` and `offer` in `SETS` (Versailles does). The database has its own copy of the prices and of the free shipping limit (`products.price`, `create_order`) and must match.
- After any change to a CSS or JS file, raise the `?v=` number on its tag in `index.html` so browsers fetch the new file.

## Checkout

Payments are by Moyasar (mada, Visa, Mastercard). Checkout only takes payments when the shop API says payments are on. Until then the form validates and shows a preview notice. While the API is in test mode, checkout opens only for a visitor who came in through `/?test=1`. Live mode starts by itself once the live Moyasar keys are saved in Supabase (see `supabase/README.md`).
