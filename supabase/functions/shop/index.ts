// JAM shop API. One Supabase edge function, four jobs:
//   GET  /stock                 which colors can be bought (true/false only)
//   POST /orders                hold the pieces and open an order
//   POST /orders/:id/payment    remember the payment a shopper just started
//   POST /confirm               check a payment with Moyasar and close the order
//   POST /webhook               same check, called by Moyasar itself
//
// Secrets (set in Supabase, never in this repo):
//   MOYASAR_SECRET_KEY      sk_test_... or sk_live_...
//   MOYASAR_WEBHOOK_SECRET  any long random text, also typed into Moyasar's webhook form
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   where the "new order" message goes (optional)
//   ALLOWED_ORIGINS         optional, comma separated. Defaults to the live site.

import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});
const ORIGINS = (env("ALLOWED_ORIGINS") || "https://sa-jam.com,https://www.sa-jam.com")
  .split(",").map((s) => s.trim()).filter(Boolean);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The Moyasar secret key, or "" when it is missing or was pasted wrong (for example with the dashboard's hiding dots).
function secretKey(): string {
  const key = env("MOYASAR_SECRET_KEY").trim();
  if (!key) return "";
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(key)) {
    console.error(`MOYASAR_SECRET_KEY does not look like a Moyasar secret key (length ${key.length}, starts with sk_: ${key.startsWith("sk_")})`);
    return "";
  }
  return key;
}

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
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    ? `⚠️ طلب #${o.number} مدفوع لكن القطعة انباعت قبل وصول الدفع. لازم ترجّع المبلغ للعميلة من لوحة ميسّر.`
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
// Send once per order, even when the shopper's browser and Moyasar's webhook both report the payment.
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

async function settle(paymentId: string): Promise<Settled> {
  if (!UUID.test(paymentId)) return { http: 400, body: { error: "bad_payment_id" } };
  const key = secretKey();
  if (!key) return { http: 503, body: { error: "payments_off" } };

  const res = await fetch(`https://api.moyasar.com/v1/payments/${paymentId}`, {
    headers: { Authorization: "Basic " + btoa(key + ":") },
  });
  if (res.status === 404) return { http: 404, body: { error: "payment_not_found" } };
  if (!res.ok) {
    console.error(`Moyasar answered ${res.status} when asked for payment ${paymentId}`);
    return { http: 502, body: { error: "moyasar_refused", moyasar_status: res.status } };
  }
  const pay = await res.json();

  const orderId = String(pay?.metadata?.order_id ?? "");
  if (!UUID.test(orderId)) return { http: 422, body: { error: "payment_has_no_order" } };
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return { http: 404, body: { error: "order_not_found" } };

  const summary = { number: order.number, total: order.total, items: order.items };

  if (pay.status !== "paid") {
    // A failed card does not undo an order that another payment already closed.
    if (order.status === "paid") return { http: 200, body: { status: "paid", ...summary } };
    const waiting = pay.status === "initiated" || pay.status === "authorized";
    return {
      http: 200,
      body: {
        status: waiting ? "waiting" : "failed",
        message: clean(pay?.source?.message, 200),
        order_id: order.id,
        order_open: order.status === "pending" && new Date(order.expires_at) > new Date(),
        ...summary,
      },
    };
  }

  if (pay.currency !== "SAR" || pay.amount !== order.total) {
    await telegram(
      `⚠️ دفعة ما تطابق الطلب #${order.number}: وصل ${sar(Number(pay.amount) || 0)} ${pay.currency} والمطلوب ${sar(order.total)} ر.س. ` +
        `الطلب ما تأكد. رقم الدفعة: ${pay.id}`,
    );
    return { http: 409, body: { status: "mismatch", ...summary } };
  }

  const method = clean(pay?.source?.company || pay?.source?.type, 30) || null;
  const { data: r, error } = await db.rpc("mark_paid", { p_order: order.id, p_payment: pay.id, p_method: method });
  if (error || !r || r.error) {
    console.error("mark_paid failed", error?.message ?? r?.error);
    return { http: 500, body: { error: "could_not_close_order" } };
  }

  await notifyOnce(r.order, r.status);
  return { http: 200, body: { status: r.status, ...summary } };
}

/* ---------- routes ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });

  const path = new URL(req.url).pathname.replace(/^.*?\/shop(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  try {
    if (req.method === "GET" && path === "/stock") {
      const { data, error } = await db.rpc("stock_public");
      if (error) return json(req, { error: "stock_unavailable" }, 500);
      return json(req, { stock: data, payments: Boolean(secretKey()) });
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
      return json(req, data, 201);
    }

    const attach = path.match(/^\/orders\/([0-9a-f-]{36})\/payment$/i);
    if (req.method === "POST" && attach) {
      const body = await req.json().catch(() => null);
      const paymentId = String(body?.payment_id ?? "");
      if (!UUID.test(attach[1]) || !UUID.test(paymentId)) return json(req, { error: "bad_request" }, 400);
      await db.from("orders").update({ attempt_payment_id: paymentId }).eq("id", attach[1]).eq("status", "pending");
      return json(req, { ok: true });
    }

    if (req.method === "POST" && path === "/confirm") {
      const body = await req.json().catch(() => null);
      const out = await settle(String(body?.payment_id ?? ""));
      return json(req, out.body, out.http);
    }

    if (req.method === "POST" && path === "/webhook") {
      const secret = env("MOYASAR_WEBHOOK_SECRET");
      const body = await req.json().catch(() => null);
      if (!secret || !sameText(String(body?.secret_token ?? ""), secret)) return json(req, { error: "forbidden" }, 403);
      // The payload is only a hint. settle() asks Moyasar for the real payment.
      if (body?.type === "payment_paid" && body?.data?.id) await settle(String(body.data.id));
      return json(req, { ok: true });
    }

    return json(req, { error: "not_found" }, 404);
  } catch (e) {
    console.error("shop error on", path, (e as Error)?.name, (e as Error)?.message);
    return json(req, { error: "server_error" }, 500);
  }
});
