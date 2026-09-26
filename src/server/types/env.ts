import type { TelegramUser } from "@/shared/types/api";

export type { TelegramUser } from "@/shared/types/api";

export interface QueueBinding<T = unknown> {
  send(body: T, options?: { delaySeconds?: number }): Promise<void>;
}

export interface AppEnv {
  APP_SECRET?: string;
  ASSETS?: Fetcher;
  DB: D1Database;
  QUEUE_NOTIFY?: QueueBinding<Record<string, unknown>>;
  TGBOT_TOKEN?: string;
  /** 机器开通守卫（fork 补丁；缺失 → /api/bootstrap 404 不暴露） */
  BOOTSTRAP_TOKEN?: string;
}

export interface AppVariables {
  requestId: string;
  tgUser?: TelegramUser;
}

export interface HonoEnv {
  Bindings: AppEnv;
  Variables: AppVariables;
}
