-- 25 Nov 2026: a hidden 1 SAR item for testing real payments (sa-jam.com/#/p/test/pay).
-- An order holding only test items pays no shipping, so the total is exactly 1 SAR.
-- Remove when testing is over: delete from products where sku = 'test-pay'; and drop the test rule below.
insert into public.products (sku, set_key, name_ar, color_ar, price, stock)
values ('test-pay', 'test', 'تجربة الدفع', 'تجربة', 100, 5)
on conflict (sku) do update set price = 100, stock = 5;

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

  v_ship := case when v_sub >= 70000 then 0
                 when not exists (select 1 from unnest(v_skus) s where s not like 'test-%') then 0
                 else 2900 end;

  insert into orders (expires_at, name, phone, city, district, address, items, subtotal, shipping, total, ip)
  values (now() + interval '20 minutes',
          p_customer->>'name', v_phone, p_customer->>'city', p_customer->>'district', p_customer->>'address',
          v_items, v_sub, v_ship, v_sub + v_ship, p_ip)
  returning * into o;

  return jsonb_build_object('id', o.id, 'number', o.number, 'total', o.total,
                            'subtotal', o.subtotal, 'shipping', o.shipping, 'expires_at', o.expires_at);
end $$;


revoke all on function public.create_order(text[], jsonb, text) from public, anon, authenticated;
grant execute on function public.create_order(text[], jsonb, text) to service_role;
