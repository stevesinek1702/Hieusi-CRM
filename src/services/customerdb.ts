/**
 * Customer Database - Lưu trữ thông tin khách hàng (Xưng hô, Tên gọi)
 * Dữ liệu được lưu vào data/customer_db.json
 * Khi gửi tin, hệ thống match danh bạ Zalo với DB này để lấy Xưng hô + Tên
 */
import * as XLSX from "xlsx";

export interface CustomerEntry {
  danhBaZalo: string;   // Tên danh bạ Zalo (alias bạn đặt)
  danhXung: string;     // Anh/Chị/Em...
  tenGoi: string;       // Tên gọi ngắn
  tenZalo: string;      // Tên Zalo gốc
  userId: string;       // Zalo userId
  label: string;        // Label/nhóm
  isFriend: boolean;    // Đã kết bạn chưa
}

const DB_PATH = "./data/customer_db.json";
let customerDb: CustomerEntry[] = [];

export function getCustomerDb() { return customerDb; }
export function setCustomerDb(db: CustomerEntry[]) { customerDb = db; }

export async function loadCustomerDb(): Promise<CustomerEntry[]> {
  try {
    const f = Bun.file(DB_PATH);
    if (await f.exists()) {
      customerDb = await f.json();
      console.log("[CustomerDB] Loaded", customerDb.length, "entries");
      return customerDb;
    }
  } catch (err: any) {
    console.log("[CustomerDB] Load error:", err.message);
  }
  return customerDb;
}

export async function saveCustomerDb(): Promise<number> {
  await Bun.write(DB_PATH, JSON.stringify(customerDb, null, 2));
  console.log("[CustomerDB] Saved", customerDb.length, "entries");
  return customerDb.length;
}

export function parseCustomerFile(buffer: Buffer): CustomerEntry[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Skip header row
  const startIdx = rows.length > 0 && isHeader(rows[0]) ? 1 : 0;
  const parsed: CustomerEntry[] = [];

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || (!row[0] && !row[3])) continue;
    parsed.push({
      danhBaZalo: String(row[0] || "").trim(),
      danhXung: String(row[1] || "").trim(),
      tenGoi: String(row[2] || "").trim(),
      tenZalo: String(row[3] || "").trim(),
      userId: String(row[4] || "").trim(),
      label: String(row[5] || "").trim(),
      isFriend: String(row[6] || "").trim().toLowerCase() === "true",
    });
  }
  return parsed;
}
