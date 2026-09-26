/**
 * POST /api/bootstrap —— 机器开通入口（ShopKrs 部署管线一次性调用；Apache-2.0 fork 补丁）。
 *
 * 守卫 = BOOTSTRAP_TOKEN env（缺失 → 404 端点不暴露；错值 → 401 归一化）。
 * 职责：建商户（服务端生成 RSA 密钥对，私钥仅本次返回）→ 写收款渠道 →
 * （可选）写 domain 配置；另提供测试期订单确认（联调用，同 token 守卫）。
 *
 * 设计：不依赖 Telegram（管理台/通知均为可选安装）；不影响既有 admin 路由。
 */
import { Hono } from "hono";
import { AppError } from "@/server/http/api";
import { one, run, setConfig } from "@/server/db";
import { createMerchant } from "@/server/services/merchants";
import { savePayment } from "@/server/payments/channels";
import { confirmOrder } from "@/server/services/orders/checkout";
import { deliverNotify } from "@/server/services/orders/notifications";
import { timingSafeEqualString } from "@/server/utils/crypto";
import type { HonoEnv } from "@/server/types/env";

const app = new Hono<HonoEnv>();

function requireToken(env: HonoEnv["Bindings"], provided: string | undefined): void {
  const expected = (env.BOOTSTRAP_TOKEN ?? "").trim();
  if (!expected) throw new AppError(404, "errors.not_found");
  if (!provided || !timingSafeEqualString(expected, provided.trim())) {
    throw new AppError(401, "errors.bad_request");
  }
}

app.post("/bootstrap", async (c) => {
  requireToken(c.env, c.req.header("x-bootstrap-token"));
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const domain = typeof body.domain === "string" && body.domain.trim() ? body.domain.trim() : null;
  if (domain) await setConfig(c.env, "domain", domain);

  const merchantInput = (body.merchant ?? {}) as Record<string, unknown>;
  const callbackLocal = typeof merchantInput.callbackLocal === "string" ? merchantInput.callbackLocal.trim() : "";
  const created = await createMerchant(c.env, {
    // callbackLocal（联调专用）：本地回调绕过 https/私网校验，建商户后直写回调地址
    callback: callbackLocal ? "https://bootstrap.invalid/callback" : String(merchantInput.callback ?? ""),
    name: String(merchantInput.name ?? "ShopKrs"),
    status: "enabled",
    type: String(merchantInput.type ?? "website"),
  } as never);
  if (callbackLocal) {
    await run(c.env, "UPDATE merchants SET callback = ? WHERE id = ?", callbackLocal, created.merchant.id);
  }

  let paymentId: number | null = null;
  const channel = body.channel as Record<string, unknown> | undefined;
  if (channel && typeof channel.driver === "string" && typeof channel.address === "string") {
    const saved = await savePayment(c.env, {
      address: channel.address,
      assets: Array.isArray(channel.assets) ? (channel.assets as string[]) : [],
      data: (channel.data as Record<string, string>) ?? {},
      driver: channel.driver,
      name: String(channel.name ?? channel.driver),
      status: "enabled",
    });
    paymentId = saved.id;
  }

  return c.json({
    ok: true,
    merchantId: created.merchant.id,
    privateKeyPem: created.credential,
    paymentId,
  });
});

/** 测试期订单确认（联调：模拟买家已付 → markPaid → 同步投递回调）。 */
app.post("/bootstrap/orders/:id/confirm", async (c) => {
  requireToken(c.env, c.req.header("x-bootstrap-token"));
  const orderId = c.req.param("id");
  await confirmOrder(c.env, orderId);
  const notify = await one<{ id: number }>(c.env, "SELECT id FROM notify WHERE order_id = ? ORDER BY id DESC LIMIT 1", orderId);
  if (notify) await deliverNotify(c.env, notify.id);
  return c.json({ ok: true, delivered: Boolean(notify) });
});

export default app;
