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

function isHeader(row: any[]): boolean {
  if (!row) return false;
  const first = String(row[0]).toLowerCase();
  return first.includes("danh") || first.includes("tên") || first.includes("ten") || first.includes("name");
}

export function exportCustomerDbToXlsx(entries: CustomerEntry[]): Buffer {
  const data = entries.map((e) => ({
    "Danh bạ Zalo": e.danhBaZalo,
    "Xưng hô": e.danhXung,
    "Tên gọi": e.tenGoi,
    "Tên Zalo": e.tenZalo,
    "userId": e.userId,
    "Label": e.label,
    "Bạn bè": e.isFriend ? "true" : "false",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Khách hàng");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// Normalize Vietnamese text for matching
function normalize(str: string): string {
  return str.trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .replace(/[.\-_,]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Lookup Xưng hô + Tên gọi từ Customer DB cho 1 contact
 * Match bằng userId (chính xác nhất) hoặc tên danh bạ Zalo
 */
export function lookupCustomer(userId: string, danhBaZalo: string): { danhXung: string; tenGoi: string } | null {
  // 1. Match chính xác bằng userId
  if (userId) {
    const byId = customerDb.find(e => e.userId === userId);
    if (byId && (byId.danhXung || byId.tenGoi)) {
      return { danhXung: byId.danhXung, tenGoi: byId.tenGoi };
    }
  }

  // 2. Match bằng tên danh bạ Zalo (normalize)
  if (danhBaZalo) {
    const searchNorm = normalize(danhBaZalo);
    const byName = customerDb.find(e => {
      if (!e.danhBaZalo) return false;
      return normalize(e.danhBaZalo) === searchNorm;
    });
    if (byName && (byName.danhXung || byName.tenGoi)) {
      return { danhXung: byName.danhXung, tenGoi: byName.tenGoi };
    }
  }

  return null;
}

/**
 * Merge: import entries mới vào DB, update nếu userId đã tồn tại
 */
export function mergeIntoDb(entries: CustomerEntry[]): { added: number; updated: number } {
  let added = 0, updated = 0;
  const existingMap = new Map<string, number>();
  for (let i = 0; i < customerDb.length; i++) {
    if (customerDb[i].userId) existingMap.set(customerDb[i].userId, i);
  }

  for (const entry of entries) {
    if (entry.userId && existingMap.has(entry.userId)) {
      const idx = existingMap.get(entry.userId)!;
      // Update nếu có dữ liệu mới
      if (entry.danhXung) customerDb[idx].danhXung = entry.danhXung;
      if (entry.tenGoi) customerDb[idx].tenGoi = entry.tenGoi;
      if (entry.danhBaZalo) customerDb[idx].danhBaZalo = entry.danhBaZalo;
      if (entry.label) customerDb[idx].label = entry.label;
      updated++;
    } else {
      customerDb.push(entry);
      if (entry.userId) existingMap.set(entry.userId, customerDb.length - 1);
      added++;
    }
  }

  return { added, updated };
}
