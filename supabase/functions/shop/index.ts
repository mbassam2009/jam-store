// JAM shop API. One Supabase edge function:
//   GET  /stock       which colors can be bought (true/false only), and whether payments are in test or live mode
//   POST /orders      hold the pieces, open an order and create its Paylink invoice
//   POST /confirm     ask Paylink whether an invoice was paid and close the order
//   POST /reconcile   same check for recent unpaid orders, for shoppers who paid but never came back to the site
//
// Payments go through Paylink (https://developer.paylink.sa).
// Secrets (set in Supabase, never in this repo):
//   PAYLINK_API_ID, PAYLINK_SECRET_KEY   the live keys from my.paylink.sa. While they are missing the function
//                                        runs against Paylink's test system with the test keys Paylink publishes.
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID where the "new order" message goes (optional)
//   ALLOWED_ORIGINS                      optional, comma separated. Defaults to the live site.

import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});
const ORIGINS = (env("ALLOWED_ORIGINS") || "https://sa-jam.com,https://www.sa-jam.com")
  .split(",").map((s) => s.trim()).filter(Boolean);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = "https://sa-jam.com/";

/* ---------- Paylink ---------- */
// Paylink's published sandbox credentials (developer.paylink.sa, "Authentication"). They move no money.
const PAYLINK_TEST = { apiId: "APP_ID_1123453311", secretKey: "0662abb5-13c7-38ab-cd12-236e58f43766" };
function paylink() {
  const apiId = env("PAYLINK_API_ID").trim(), secretKey = env("PAYLINK_SECRET_KEY").trim();
  const live = Boolean(apiId && secretKey);
  return {
    mode: live ? "live" : "test",
    base: live ? "https://restapi.paylink.sa" : "https://restpilot.paylink.sa",
    apiId: live ? apiId : PAYLINK_TEST.apiId,
    secretKey: live ? secretKey : PAYLINK_TEST.secretKey,
  };
}
let cachedToken = { value: "", until: 0, mode: "" };
async function paylinkToken(): Promise<string> {
  const cfg = paylink();
  if (cachedToken.value && cachedToken.mode === cfg.mode && Date.now() < cachedToken.until) return cachedToken.value;
  const res = await fetch(cfg.base + "/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ apiId: cfg.apiId, secretKey: cfg.secretKey, persistToken: "false" }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id_token) throw new Error(`Paylink auth failed with status ${res.status}`);
  // Paylink's short token lasts 30 minutes. Keep it for 20.
  cachedToken = { value: data.id_token, until: Date.now() + 20 * 60 * 1000, mode: cfg.mode };
  return cachedToken.value;
}
// deno-lint-ignore no-explicit-any
async function paylinkCall(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(paylink().base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + await paylinkToken(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}
// deno-lint-ignore no-explicit-any
const invoiceRef = (order: any) => `JAM-${order.number}-${String(order.id).slice(0, 6)}`;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type, authorization, apikey",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function clean(v: unknown, max: number): string {
  // deno-lint-ignore no-control-regex
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
const sar = (halalas: number) => (halalas / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

/* ---------- message to the owner ---------- */
async function telegram(text: string): Promise<boolean> {
  const token = env("TELEGRAM_BOT_TOKEN"), chat = env("TELEGRAM_CHAT_ID");
  if (!token || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch (_e) {
    return false;
  }
}
// deno-lint-ignore no-explicit-any
function orderMessage(o: any, status: string): string {
  // deno-lint-ignore no-explicit-any
  const items = (o.items as any[]).map((i) => `• ${i.name}، ${i.color}`).join("\n");
  const head = status === "oversold"
    ? `⚠️ طلب #${o.number} مدفوع لكن القطعة انباعت قبل وصول الدفع. لازم ترجّع المبلغ للعميلة من لوحة بيلينك.`
    : `🛍️ طلب جديد #${o.number}`;
  return [
    head,
    "",
    items,
    "",
    `الإجمالي: ${sar(o.total)} ر.س` + (o.shipping ? ` (منها شحن ${sar(o.shipping)})` : " (شحن مجاني)"),
    `الدفع: ${o.payment_method ?? "بطاقة"}`,
    "",
    `الاسم: ${o.name}`,
    `الجوال: ${o.phone}`,
    `العنوان: ${o.city}، ${o.district}، ${o.address}`,
  ].join("\n");
}
// Send once per order, even when the shopper's browser and the reconcile timer both report the payment.
// deno-lint-ignore no-explicit-any
async function notifyOnce(order: any, status: string) {
  const { data: claimed } = await db.from("orders")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", order.id).is("notified_at", null).select("id");
  if (!claimed || !claimed.length) return;
  const sent = await telegram(orderMessage(order, status));
  if (!sent) await db.from("orders").update({ notified_at: null }).eq("id", order.id);
}

/* ---------- payment check ---------- */
type Settled = { http: number; body: Record<string, unknown> };

// deno-lint-ignore no-explicit-any
async function settleOrder(order: any): Promise<Settled> {
  const summary = { number: order.number, total: order.total, items: order.items };
  if (order.status === "paid" || order.status === "oversold") return { http: 200, body: { status: order.status, ...summary } };

  const tx = String(order.attempt_payment_id ?? "");
  const inv = await paylinkCall("/api/getInvoice/" + encodeURIComponent(tx));
  if (!inv.ok || !inv.data) {
    console.error(`Paylink answered ${inv.status} for invoice ${tx}`);
    return { http: 502, body: { error: "paylink_refused", ...summary } };
  }
  const status = String(inv.data.orderStatus ?? "").toLowerCase();
  const open = order.status === "pending" && new Date(order.expires_at) > new Date();

  if (status !== "paid") {
    const errors = Array.isArray(inv.data.paymentErrors) ? inv.data.paymentErrors : [];
    const last = errors[errors.length - 1];
    const failed = status === "canceled" || errors.length > 0;
    return {
      http: 200,
      body: {
        status: failed ? "failed" : "waiting",
        message: clean(last?.errorTitle || last?.errorMessage, 200),
        order_open: open && status !== "canceled",
        ...summary,
      },
    };
  }

  // Paid at Paylink. Trust it only if it is this order's invoice for this order's amount.
  const paidHalalas = Math.round(Number(inv.data.amount) * 100);
  const ref = inv.data.gatewayOrderRequest?.orderNumber;
  if (paidHalalas !== order.total || (ref && ref !== invoiceRef(order))) {
    console.error(`Invoice ${tx} does not match order ${order.number}: paid ${paidHalalas}, expected ${order.total}, ref ${ref}`);
    await telegram(`⚠️ دفعة ما تطابق الطلب #${order.number}: وصل ${sar(paidHalalas || 0)} والمطلوب ${sar(order.total)} ر.س. الطلب ما تأكد. رقم العملية: ${tx}`);
    return { http: 409, body: { status: "mismatch", ...summary } };
  }

  const method = clean(inv.data.paymentReceipt?.paymentMethod, 30).toLowerCase() || null;
  const { data: r, error } = await db.rpc("mark_paid", { p_order: order.id, p_payment: tx, p_method: method });
  if (error || !r || r.error) {
    console.error("mark_paid failed", error?.message ?? r?.error);
    return { http: 500, body: { error: "could_not_close_order", ...summary } };
  }
  await notifyOnce(r.order, r.status);
  return { http: 200, body: { status: r.status, ...summary } };
}

async function settle(transactionNo: string): Promise<Settled> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(transactionNo)) return { http: 400, body: { error: "bad_transaction" } };
  const { data: order } = await db.from("orders").select("*").eq("attempt_payment_id", transactionNo).maybeSingle();
  if (!order) return { http: 404, body: { error: "order_not_found" } };
  return await settleOrder(order);
}

/* ---------- routes ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });

  const path = new URL(req.url).pathname.replace(/^.*?\/shop(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  try {
    if (req.method === "GET" && path === "/stock") {
      const { data, error } = await db.rpc("stock_public");
      if (error) return json(req, { error: "stock_unavailable" }, 500);
      return json(req, { stock: data, payments: true, mode: paylink().mode });
    }

    if (req.method === "POST" && path === "/orders") {
      const body = await req.json().catch(() => null);
      const c = body?.customer ?? {};
      const customer = {
        name: clean(c.name, 80),
        phone: clean(c.phone, 20).replace(/\s/g, ""),
        city: clean(c.city, 60),
        district: clean(c.district, 60),
        address: clean(c.address, 200),
      };
      const skus = Array.isArray(body?.items) ? body.items.map((s: unknown) => clean(s, 40)).filter(Boolean) : [];
      const bad = customer.name.length < 3 || !/^05\d{8}$/.test(customer.phone) || !customer.city ||
        !customer.district || customer.address.length < 5 || skus.length === 0 || skus.length > 12;
      if (bad) return json(req, { error: "bad_request" }, 400);

      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
      const { data, error } = await db.rpc("create_order", { p_skus: skus, p_customer: customer, p_ip: ip });
      if (error || !data) return json(req, { error: "could_not_open_order" }, 500);
      if (data.error === "sold_out") return json(req, data, 409);
      if (data.error === "too_many") return json(req, data, 429);
      if (data.error) return json(req, data, 400);

      // The order exists and the pieces are held. Now open its invoice at Paylink.
      const { data: order } = await db.from("orders").select("*").eq("id", data.id).single();
      // deno-lint-ignore no-explicit-any
      const products = (order.items as any[]).map((i) => ({ title: `${i.name} ${i.color}`, price: i.price / 100, qty: 1 }));
      if (order.shipping > 0) products.push({ title: "الشحن (أرامكس)", price: order.shipping / 100, qty: 1 });
      // deno-lint-ignore no-explicit-any
      let inv: { ok: boolean; status: number; data: any } = { ok: false, status: 0, data: null };
      try {
        inv = await paylinkCall("/api/addInvoice", {
          orderNumber: invoiceRef(order),
          amount: order.total / 100,
          currency: "SAR",
          callBackUrl: SITE,
          cancelUrl: SITE + "#/checkout",
          clientName: order.name,
          clientMobile: order.phone,
          products,
          note: `طلب JAM رقم ${order.number}`,
        });
      } catch (e) {
        console.error("addInvoice threw", (e as Error)?.message);
      }
      if (!inv.ok || !inv.data?.transactionNo || !inv.data?.url) {
        console.error(`Paylink addInvoice answered ${inv.status}`, JSON.stringify(inv.data ?? {}).slice(0, 300));
        // No way to pay, so give the pieces back right away.
        await db.from("orders").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", order.id);
        await db.rpc("release_expired");
        return json(req, { error: "payment_unavailable" }, 502);
      }
      await db.from("orders").update({ attempt_payment_id: String(inv.data.transactionNo) }).eq("id", order.id);
      return json(req, {
        ...data,
        transaction_no: String(inv.data.transactionNo),
        pay_url: inv.data.url,
        frame_url: inv.data.mobileUrl ?? null,
        mode: paylink().mode,
      }, 201);
    }

    if (req.method === "POST" && path === "/confirm") {
      const body = await req.json().catch(() => null);
      const out = await settle(String(body?.transaction_no ?? ""));
      return json(req, out.body, out.http);
    }

    // For the shopper who paid on Paylink's page and closed the tab before coming back.
    // Looks only at this shop's own recent unpaid orders, so it is safe to call from a timer.
    if (req.method === "POST" && path === "/reconcile") {
      const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      const { data: open } = await db.from("orders").select("*")
        .in("status", ["pending", "expired"]).not("attempt_payment_id", "is", null)
        .gte("created_at", since).order("created_at", { ascending: false }).limit(15);
      let closed = 0;
      for (const order of open ?? []) {
        const out = await settleOrder(order).catch(() => null);
        if (out?.body?.status === "paid" || out?.body?.status === "oversold") closed++;
      }
      return json(req, { checked: (open ?? []).length, closed });
    }

    return json(req, { error: "not_found" }, 404);
  } catch (e) {
    console.error("shop error on", path, (e as Error)?.name, (e as Error)?.message);
    return json(req, { error: "server_error" }, 500);
  }
});
