-- Starting stock, copied from js/data.js on the day payments were set up.
-- Running it again never overwrites stock that has changed since.
insert into public.products (sku, set_key, name_ar, color_ar, price, stock) values
  ('amalfi-pink', 'amalfi', 'طقم أمالفي', 'وردي', 34000, 1),
  ('amalfi-sage', 'amalfi', 'طقم أمالفي', 'أخضر ميرمية', 34000, 1),
  ('amalfi-terracotta', 'amalfi', 'طقم أمالفي', 'تيراكوتا', 34000, 1),
  ('amalfi-navy', 'amalfi', 'طقم أمالفي', 'كحلي', 34000, 1),
  ('amalfi-sand', 'amalfi', 'طقم أمالفي', 'بيج', 34000, 0),
  ('amalfi-mint', 'amalfi', 'طقم أمالفي', 'نعناعي', 34000, 0),
  ('capri-denim', 'capri', 'طقم كابري', 'أزرق جينز', 34000, 1),
  ('capri-navy', 'capri', 'طقم كابري', 'كحلي', 34000, 1),
  ('capri-brown', 'capri', 'طقم كابري', 'بني', 34000, 1),
  ('capri-rust', 'capri', 'طقم كابري', 'قرميدي', 34000, 1),
  ('capri-olive', 'capri', 'طقم كابري', 'زيتي', 34000, 1),
  ('capri-plum', 'capri', 'طقم كابري', 'باذنجاني', 34000, 0),
  ('suzhou-black', 'suzhou', 'طقم سوجو', 'أسود', 34000, 1),
  ('suzhou-wine', 'suzhou', 'طقم سوجو', 'عنابي', 34000, 1),
  ('suzhou-sage', 'suzhou', 'طقم سوجو', 'أخضر ميرمية', 34000, 1),
  ('suzhou-mocha', 'suzhou', 'طقم سوجو', 'بني موكا', 34000, 1),
  ('suzhou-beige', 'suzhou', 'طقم سوجو', 'بيج', 34000, 1),
  ('suzhou-navy', 'suzhou', 'طقم سوجو', 'كحلي', 34000, 0),
  ('riviera-coral', 'riviera', 'طقم ريفييرا', 'مرجاني', 34000, 1),
  ('riviera-beige', 'riviera', 'طقم ريفييرا', 'بيج', 34000, 1),
  ('riviera-yellow', 'riviera', 'طقم ريفييرا', 'أصفر', 34000, 1),
  ('riviera-rust', 'riviera', 'طقم ريفييرا', 'قرميدي', 34000, 1),
  ('riviera-black', 'riviera', 'طقم ريفييرا', 'أسود', 34000, 1)
on conflict (sku) do nothing;
