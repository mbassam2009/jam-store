# JAM store

Storefront for JAM (women's matching sets). Static site: `index.html`, `css/style.css`, `js/data.js`, `js/app.js`.

- Products, prices, stock and shipping rules live in `js/data.js`.
- Photos live in `img/`. `.github/workflows/photos.yml` copied them from the Salla store; run it again from the Actions tab if a photo is added to `js/data.js`.
- Checkout is in preview mode: the form validates but no order or payment is created yet.
