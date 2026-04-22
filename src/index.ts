import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { zaloRoutes } from "./routes/zalo";
import { contactRoutes } from "./routes/contacts";
import { messageRoutes } from "./routes/messages";
import { addFriendRoutes } from "./routes/addfriend";
import { strangerRoutes } from "./routes/stranger";
import { schedulerRoutes } from "./routes/scheduler";
import { dashboardRoute } from "./routes/dashboard";
import { customerDbRoutes } from "./routes/customerdb";
import { tryAutoLogin, loginQR } from "./services/zalo";
import { loadSchedule } from "./services/scheduler";
import { loadCustomerDb } from "./services/customerdb";

const app = new Hono();

// Static JS
app.use("/public/*", serveStatic({ root: "./src" }));

// Routes
app.route("/", dashboardRoute);
app.route("/api/zalo", zaloRoutes);
app.route("/api/contacts", contactRoutes);
app.route("/api/messages", messageRoutes);
app.route("/api/addfriend", addFriendRoutes);
app.route("/api/stranger", strangerRoutes);
app.route("/api/schedule", schedulerRoutes);
app.route("/api/customerdb", customerDbRoutes);

const PORT = 10001;

// Try auto-login, if fail → auto start QR
tryAutoLogin().then((ok) => {
  if (ok) {
    console.log("✅ Auto-login Zalo thành công");
  } else {
    console.log("ℹ️ Chưa có credentials, tự động tạo QR...");
    loginQR();
  }
  // Load schedule after login
  loadSchedule();
  // Load customer DB
  loadCustomerDb();
});

console.log(`🚀 Hieusi-CRM running at http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
