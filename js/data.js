/* JAM store data. One row per color. Stock is 1 or 0 and is never shown to shoppers. */
window.JAM = (function () {
  // Photos are stored in this repo under img/, copied from the Salla store by .github/workflows/photos.yml.
  var IMG_BASE = 'img/';
  var IMG_SUFFIX = '.webp';

  // Payments. While either value is empty the site stays in preview mode and charges nothing.
  // API is the address of the shop function (supabase/functions/shop).
  // PAY_KEY is Moyasar's publishable key, the one that starts with pk_. The secret key never goes in this repo.
  // With a pk_test_ key, checkout only opens for a visitor who came in through https://sa-jam.com/?test=1.
  // Everyone else keeps seeing preview mode, so nobody can "buy" stock with a test card.
  var API = 'https://divkgblwymgiyknynyen.supabase.co/functions/v1/shop';
  var PAY_KEY = 'pk_test_yyME5RfJFp27wJoDdzqBfdbYoQ1XrAYVUhFiv5U5';

  var PRICE = 340;
  var COMPARE_AT = 499;
  var SHIPPING = { carrier: 'أرامكس', fee: 29, freeFrom: 400 };

  var CITIES = {
    paris:    { ar: 'باريس',    code: 'CDG' },
    nyc:      { ar: 'نيويورك',  code: 'JFK' },
    london:   { ar: 'لندن',     code: 'LHR' },
    rome:     { ar: 'روما',     code: 'FCO' },
    istanbul: { ar: 'إسطنبول',  code: 'IST' },
    sydney:   { ar: 'سيدني',    code: 'SYD' }
  };

  var SETS = {
    amalfi:  { ar: 'أمالفي',   en: 'Amalfi',  top: 'قميص بياقة وأكمام قصيرة',            pieces: 'القميص والبنطلون' },
    capri:   { ar: 'كابري',    en: 'Capri',   top: 'بلوزة بياقة V وأكمام قصيرة',          pieces: 'البلوزة والبنطلون' },
    suzhou:  { ar: 'سوجو',     en: 'Suzhou',  top: 'بلوزة بأكمام طويلة وأزرار صينية',     pieces: 'البلوزة والبنطلون' },
    riviera: { ar: 'ريفييرا',  en: 'Riviera', top: 'قميص بأكمام قصيرة وقصّة مريحة',       pieces: 'القميص والبنطلون' }
  };
  var SET_ORDER = ['amalfi', 'capri', 'suzhou', 'riviera'];

  // [sallaId, set, key, colorAr, hex, city, modelImg, flatImg, stock]
  var ROWS = [
    [621341529,  'amalfi',  'pink',       'وردي',         '#E88DB4', 'sydney',   'd11874d1-84f4-42a4-9dd8-678c914a0441', 'f9e4cb59-cbd0-457a-9d37-ef668efe31a1', 1],
    [1120560981, 'amalfi',  'sage',       'أخضر ميرمية',  '#9CAF94', 'nyc',      '970225a8-97ef-41ec-8564-5bbf990f7456', 'ceb051d7-9be4-483c-beb2-a746969d4797', 1],
    [1039846783, 'amalfi',  'terracotta', 'تيراكوتا',     '#C4532F', 'paris',    'd3fa837a-0d42-458c-8e00-a65e74581eab', 'e8d0d069-2df4-494c-b8e3-3a20b68b53e3', 1],
    [400561152,  'amalfi',  'navy',       'كحلي',         '#1E2A4A', 'istanbul', '499641e3-395b-418a-a3cf-0ee82f123359', 'df9ab61c-1a01-498a-93ba-8f733e370841', 1],
    [448295020,  'amalfi',  'sand',       'بيج',          '#C9B08A', 'london',   'd56450f8-3ca4-498d-b79b-86cc929f529d', '6faeea2f-d95f-4cf2-a017-e680c796acc1', 0],
    [939763477,  'amalfi',  'mint',       'نعناعي',       '#A9D6C5', 'rome',     '0455110c-8dd8-4c58-a28d-69b5f74f284a', 'f2d1273b-222a-4be2-b15b-5a9c4b8eadaa', 0],

    [403896564,  'capri',   'denim',      'أزرق جينز',    '#4F74B5', 'rome',     '838ed41d-3280-4da2-b68b-cb5e6715f276', '27987367-c9dc-45b5-9a5d-287ad1e52468', 1],
    [1064096227, 'capri',   'navy',       'كحلي',         '#1F2B4D', 'sydney',   'a25c93e2-9beb-4318-a990-e7a6a0b69bf7', 'e7cc24cc-538d-4731-bd34-b92c8dc77986', 1],
    [748415387,  'capri',   'brown',      'بني',          '#5A4033', 'paris',    'b3a3647a-4048-4e35-8d72-9fbf529e7b08', '68b4a42c-79c9-4db0-bc75-8e733ef7b3ef', 1],
    [48888203,   'capri',   'rust',       'قرميدي',       '#B2362B', 'istanbul', 'd3ec5ddc-6874-4f3a-a8ee-73c9cb757e42', '194a2e81-5ba2-4013-b7a0-b639fbd84f56', 1],
    [391310010,  'capri',   'olive',      'زيتي',         '#8B8F6A', 'london',   'ba871974-d2ca-4b0c-8b34-76f2b260f362', '05e178a2-722b-4d68-9122-6eb55aa33135', 1],
    [1279101945, 'capri',   'plum',       'باذنجاني',     '#5A2A3C', 'nyc',      '495fa327-c304-4ab9-a974-399e59e9ff89', 'ec21a3ad-8dde-4490-8929-daf07fd9730a', 0],

    [883167651,  'suzhou',  'black',      'أسود',         '#1A1A1A', 'paris',    'e9bb704a-8dd0-403e-8dde-3b39656ab163', 'aa8c4e86-3c9e-4d6b-9a9c-c287219fb4ee', 1],
    [743230808,  'suzhou',  'wine',       'عنابي',        '#7A1E2E', 'nyc',      'b7ac4b3f-dbb3-4906-9896-2cc414f7157d', 'ef27b3a3-e2b5-475d-93cc-9886e2f2402d', 1],
    [776215370,  'suzhou',  'sage',       'أخضر ميرمية',  '#8E9B80', 'london',   '748cce1f-f87d-419d-8701-3f327097a985', '24cb3fd6-557c-4e20-bd39-39e5f7b86177', 1],
    [710256502,  'suzhou',  'mocha',      'بني موكا',     '#8A6A58', 'sydney',   '4359007a-6c2c-44a4-a658-889249376a3d', '0e3d9a04-ec5a-417a-a7a6-aacbd308ae98', 1],
    [1827768676, 'suzhou',  'beige',      'بيج',          '#D9C3A0', 'rome',     '10e782b1-c5e1-4f94-9d00-c60614b953e5', 'a0bbd2a4-8a95-499e-aa07-498623534ea0', 1],
    [1584876155, 'suzhou',  'navy',       'كحلي',         '#23305A', 'istanbul', '9ab76d33-b053-4f48-99b5-428d29c32cfa', 'a9b276f9-f358-4356-831a-1a47f6ed5696', 0],

    [1301983691, 'riviera', 'coral',      'مرجاني',       '#E86A55', 'rome',     'df3d6e49-84aa-4b51-9682-5f1b3ffa4a48', 'f2baccba-13fc-42a9-b363-e08d68f8dbb5', 1],
    [539487750,  'riviera', 'beige',      'بيج',          '#C9BFAE', 'london',   '459862ca-04a9-4da8-85b6-a071d708ae2b', '39dff510-100f-4630-8c82-cf16852b4f3f', 1],
    [1799638471, 'riviera', 'yellow',     'أصفر',         '#F2C319', 'sydney',   '62588b9f-75b1-46ac-8de8-18b61466f561', '4235f0b4-b6ce-4eda-a95a-b702e1d6e58b', 1],
    [703708049,  'riviera', 'rust',       'قرميدي',       '#A8452F', 'istanbul', 'addb6366-f276-4420-a8f9-88c8b93b47f1', '39fd1b64-8501-4a67-a093-b32a3f70e6f8', 1],
    [1608282197, 'riviera', 'black',      'أسود',         '#161616', 'nyc',      '1a26ac2a-c7a4-41ab-b83e-6ce0e495d9ba', null, 1],
  ];

  var PRODUCTS = ROWS.map(function (r) {
    return { id: r[0], set: r[1], key: r[2], sku: r[1] + '-' + r[2], color: r[3], hex: r[4], city: r[5], model: r[6], flat: r[7], stock: r[8] };
  });

  // One look per city for the opening sequence, all in stock.
  var HERO = ['amalfi-terracotta', 'suzhou-wine', 'capri-olive', 'capri-denim', 'amalfi-navy', 'amalfi-pink'];

  return {
    API: API, PAY_KEY: PAY_KEY,
    PRICE: PRICE, COMPARE_AT: COMPARE_AT, SHIPPING: SHIPPING,
    CITIES: CITIES, SETS: SETS, SET_ORDER: SET_ORDER, PRODUCTS: PRODUCTS, HERO: HERO,
    img: function (id) { return IMG_BASE + id + IMG_SUFFIX; },
    bySku: function (sku) { return PRODUCTS.find(function (p) { return p.sku === sku; }); },
    inSet: function (set) {
      return PRODUCTS.filter(function (p) { return p.set === set; })
        .sort(function (a, b) { return b.stock - a.stock; });
    }
  };
})();
