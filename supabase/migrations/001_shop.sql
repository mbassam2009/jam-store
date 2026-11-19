-- JAM shop: products, orders and stock holds.
-- Money is stored in halalas (1 SAR = 100). Only the "shop" edge function touches these tables.

create table if not exists public.products (
  sku      text primary key,
  set_key  text not null,
  name_ar  text not null,
  color_ar text not null,
  price    integer not null check (price > 0),
  stock    integer not null default 0 check (stock >= 0)
);

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  number         bigint generated always as identity (start with 1001) unique,
  created_at     timestamptz not null default now(),
  -- pending: stock is held while the shopper pays. paid: done. expired: hold released.
  -- oversold: money arrived after the hold ran out and the piece had gone. Needs a refund.
  status         text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'oversold')),
  expires_at     timestamptz not null,
  name           text not null,
  phone          text not null,
  city           text not null,
  district       text not null,
  address        text not null,
  items          jsonb not null,
  subtotal       integer not null,
  shipping       integer not null,
  total          integer not null,
  attempt_payment_id text,
  payment_id     text unique,
  payment_method text,
  paid_at        timestamptz,
  notified_at    timestamptz,
  ip             text
);
create index if not exists orders_status_expires on public.orders (status, expires_at);
create index if not exists orders_phone on public.orders (phone);

alter table public.products enable row level security;
alter table public.orders   enable row level security;

-- Put held pieces back on sale when the shopper never paid.
create or replace function public.release_expired()
returns void language plpgsql security definer set search_path = public as $$
begin
  with ex as (
    update orders set status = 'expired'
    where status = 'pending' and expires_at < now()
    returning items
  ), c as (
    select i->>'sku' as sku, count(*)::int as n
    from ex, jsonb_array_elements(ex.items) i group by 1
  )
  update products p set stock = p.stock + c.n from c where p.sku = c.sku;
end $$;

-- What the storefront may know: which colors can be bought. Never the count.
create or replace function public.stock_public()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform release_expired();
  return (select coalesce(jsonb_object_agg(sku, stock > 0), '{}'::jsonb) from products);
end $$;

-- Hold the pieces for 20 minutes and open an order. Prices come from the products table, never from the browser.
create or replace function public.create_order(p_skus text[], p_customer jsonb, p_ip text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_skus    text[];
  v_missing text[];
  v_items   jsonb;
  v_sub     integer;
  v_ship    integer;
  v_phone   text := p_customer->>'phone';
  o         orders;
begin
  perform release_expired();

  -- One open order per phone number: a new attempt replaces the old hold.
  with old as (
    update orders set status = 'expired'
    where status = 'pending' and phone = v_phone
    returning items
  ), c as (
    select i->>'sku' as sku, count(*)::int as n
    from old, jsonb_array_elements(old.items) i group by 1
  )
  update products p set stock = p.stock + c.n from c where p.sku = c.sku;

  if (select count(*) from orders where status = 'pending' and ip = p_ip) >= 3 then
    return jsonb_build_object('error', 'too_many');
  end if;

  select array_agg(distinct s order by s) into v_skus from unnest(p_skus) s;
  if v_skus is null or array_length(v_skus, 1) > 12 then
    return jsonb_build_object('error', 'bad_items');
  end if;

  perform 1 from products where sku = any(v_skus) order by sku for update;
  select array_agg(s) into v_missing
  from unnest(v_skus) s
  where not exists (select 1 from products p where p.sku = s and p.stock > 0);
  if v_missing is not null then
    return jsonb_build_object('error', 'sold_out', 'skus', to_jsonb(v_missing));
  end if;

  update products set stock = stock - 1 where sku = any(v_skus);

  select jsonb_agg(jsonb_build_object('sku', sku, 'name', name_ar, 'color', color_ar, 'price', price) order by sku),
         sum(price)::int
    into v_items, v_sub
  from products where sku = any(v_skus);

  v_ship := case when v_sub >= 40000 then 0 else 2900 end;

  insert into orders (expires_at, name, phone, city, district, address, items, subtotal, shipping, total, ip)
  values (now() + interval '20 minutes',
          p_customer->>'name', v_phone, p_customer->>'city', p_customer->>'district', p_customer->>'address',
          v_items, v_sub, v_ship, v_sub + v_ship, p_ip)
  returning * into o;

  return jsonb_build_object('id', o.id, 'number', o.number, 'total', o.total,
                            'subtotal', o.subtotal, 'shipping', o.shipping, 'expires_at', o.expires_at);
end $$;

-- Called only after Moyasar itself confirmed the payment. Safe to call twice.
create or replace function public.mark_paid(p_order uuid, p_payment text, p_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o      orders;
  v_skus text[];
begin
  select * into o from orders where id = p_order for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if o.status in ('paid', 'oversold') then
    return jsonb_build_object('status', o.status, 'first', false, 'order', to_jsonb(o));
  end if;

  if o.status = 'expired' then
    -- The hold ran out before the money arrived. If the same shopper started again,
    -- free that newer unpaid hold first, then take the pieces back if they are still there.
    with old as (
      update orders set status = 'expired'
      where status = 'pending' and phone = o.phone and id <> o.id
      returning items
    ), c as (
      select i->>'sku' as sku, count(*)::int as n
      from old, jsonb_array_elements(old.items) i group by 1
    )
    update products p set stock = p.stock + c.n from c where p.sku = c.sku;
    select array_agg(i->>'sku' order by i->>'sku') into v_skus from jsonb_array_elements(o.items) i;
    perform 1 from products where sku = any(v_skus) order by sku for update;
    if exists (select 1 from unnest(v_skus) s
               where not exists (select 1 from products p where p.sku = s and p.stock > 0)) then
      update orders set status = 'oversold', payment_id = p_payment, payment_method = p_method, paid_at = now()
      where id = o.id returning * into o;
      return jsonb_build_object('status', 'oversold', 'first', true, 'order', to_jsonb(o));
    end if;
    update products set stock = stock - 1 where sku = any(v_skus);
  end if;

  update orders set status = 'paid', payment_id = p_payment, payment_method = p_method, paid_at = now()
  where id = o.id returning * into o;
  return jsonb_build_object('status', 'paid', 'first', true, 'order', to_jsonb(o));
end $$;

revoke all on function public.release_expired()                 from public, anon, authenticated;
revoke all on function public.stock_public()                    from public, anon, authenticated;
revoke all on function public.create_order(text[], jsonb, text) from public, anon, authenticated;
revoke all on function public.mark_paid(uuid, text, text)       from public, anon, authenticated;
grant execute on function public.release_expired()                 to service_role;
grant execute on function public.stock_public()                    to service_role;
grant execute on function public.create_order(text[], jsonb, text) to service_role;
grant execute on function public.mark_paid(uuid, text, text)       to service_role;
