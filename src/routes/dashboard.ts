import { Hono } from "hono";
import { readFileSync } from "fs";
import { join } from "path";

export const dashboardRoute = new Hono();

dashboardRoute.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Content-Type", "text/html; charset=utf-8");
  const html = readFileSync(join(process.cwd(), "src/public/index.html"), "utf-8");
  return c.body(html);
});
