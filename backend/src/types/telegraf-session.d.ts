import type { SessionData } from "./index";

declare module "telegraf" {
  interface Context {
    session: SessionData;
  }
}

export {};
