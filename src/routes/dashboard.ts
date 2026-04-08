import { Hono } from "hono";
import { readFileSync } from "fs";
import { join } from "path";
import { getUsage } from "../services/ratelimit";

export const dashboardRoute = new Hono();

dashboardRoute.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Content-Type", "text/html; charset=utf-8");
  const html = readFileSync(join(process.cwd(), "src/public/index.html"), "utf-8");
  return c.body(html);
});

dashboardRoute.get("/api/ratelimit", (c) => {
  return c.json({
    bulk: getUsage("bulk"),
    addfriend: getUsage("addfriend"),
    stranger: getUsage("stranger"),
  });
});
