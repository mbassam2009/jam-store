# JAM store

Storefront for JAM (women's matching sets). Static site: `index.html`, `css/style.css`, `js/data.js`, `js/app.js`.

- Products, prices, stock and shipping rules live in `js/data.js`.
- Photos are still loaded from the Salla CDN (`IMG_BASE` in `js/data.js`). Copy them into `img/` before closing the Salla store.
- Checkout is in preview mode: the form validates but no order or payment is created yet.
