import * as XLSX from "xlsx";
import { existsSync } from "fs";

export interface Contact {
  tenDanhBa: string;
  danhXung: string;
  tenGoi: string;
  zaloId?: string;
  zaloName?: string;  // tên friend đã match
  matched?: boolean;
  matchScore?: number; // 0-100, 100 = exact
  label?: string;      // label/nhóm phân loại
}

// Saved contacts & stranger/addfriend results as fallback sources
interface SavedEntry {
  userId: string;
  name: string;
  zaloName?: string;
}

async function loadSavedSources(): Promise<SavedEntry[]> {
  const entries: SavedEntry[] = [];

  // 1. contacts_saved.json - danh bạ đã lưu trước đó (có zaloId)
  try {
    const f = Bun.file("./data/contacts_saved.json");
    if (await f.exists()) {
      const saved: any[] = await f.json();
      for (const s of saved) {
        if (s.zaloId && s.tenDanhBa) {
          entries.push({ userId: s.zaloId, name: s.tenDanhBa, zaloName: s.zaloName || "" });
        }
      }
    }
  } catch {}

  // 2. addfriend_results.json - kết quả kết bạn (có zaloUid)
  try {
    const f = Bun.file("./data/addfriend_results.json");
    if (await f.exists()) {
      const results: any[] = await f.json();
      for (const r of results) {
        if (r.zaloUid && r.name) {
          entries.push({ userId: r.zaloUid, name: r.name, zaloName: r.zaloName || "" });
        }
      }
    }
  } catch {}

  // 3. stranger_results.json - kết quả gửi stranger (có zaloUid)
  try {
    const f = Bun.file("./data/stranger_results.json");
    if (await f.exists()) {
      const results: any[] = await f.json();
      for (const r of results) {
        if (r.zaloUid && r.name) {
          entries.push({ userId: r.zaloUid, name: r.name, zaloName: r.zaloName || "" });
        }
      }
    }
  } catch {}

  return entries;
}

let contacts: Contact[] = [];

export function getContacts() { return contacts; }
export function setContacts(c: Contact[]) { contacts = c; }

export function parseContactFile(buffer: Buffer, filename: string): Contact[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const startIdx = isHeader(rows[0]) ? 1 : 0;
  const parsed: Contact[] = [];

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    parsed.push({
      tenDanhBa: String(row[0]).trim(),
      danhXung: String(row[1] || "").trim(),
      tenGoi: String(row[2] || "").trim(),
      matched: false,
    });
  }
  return parsed;
}

function isHeader(row: any[]): boolean {
  if (!row) return false;
  const first = String(row[0]).toLowerCase();
  return first.includes("tên") || first.includes("ten") || first.includes("name") || first.includes("danh");
}

// Normalize Vietnamese text: remove diacritics, lowercase
function normalize(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .replace(/\s+/g, " ");
}

// Calculate similarity score between two strings (0-100)
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);

  // Exact match
  if (na === nb) return 100;

  // One contains the other
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return Math.round(70 + ratio * 25); // 70-95
  }

  // Check if last word(s) match (Vietnamese names: last word = tên gọi)
  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");
  const lastA = wordsA[wordsA.length - 1];
  const lastB = wordsB[wordsB.length - 1];

  if (lastA === lastB && wordsA.length > 1 && wordsB.length > 1) {
    // Last name matches, check more overlap
    const commonWords = wordsA.filter((w) => wordsB.includes(w));
    const ratio = commonWords.length / Math.max(wordsA.length, wordsB.length);
    return Math.round(50 + ratio * 40); // 50-90
  }

  // Levenshtein-based similarity
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 100;
  const score = Math.round((1 - dist / maxLen) * 100);
  return Math.max(0, score);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
    for (let j = 1; j <= n; j++) {
      if (i === 0) { dp[0][j] = j; continue; }
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

// Normalize for matching: remove diacritics, dots, extra spaces
function normalizeMatch(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .replace(/[.\-_,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Split into words for word-level matching
function getWords(str: string): string[] {
  return normalizeMatch(str).split(" ").filter(w => w.length > 0);
}

// Count how many words from `search` appear in `target` (in order)
function wordMatchScore(search: string, target: string): number {
  const searchWords = getWords(search);
  const targetWords = getWords(target);
  if (!searchWords.length || !targetWords.length) return 0;

  let matched = 0;
  let lastIdx = -1;
  for (const sw of searchWords) {
    for (let i = lastIdx + 1; i < targetWords.length; i++) {
      if (targetWords[i] === sw || targetWords[i].startsWith(sw) || sw.startsWith(targetWords[i])) {
        matched++;
        lastIdx = i;
        break;
      }
    }
  }

  // Score based on how many search words matched
  const ratio = matched / searchWords.length;
  return Math.round(ratio * 100);
}

const MATCH_THRESHOLD = 80; // nâng lên 80 để tránh match nhầm

export async function matchContactsWithFriends(contacts: Contact[], friends: any[]): Promise<Contact[]> {
  const friendList = friends.map((f: any) => ({
    userId: f.userId,
    displayName: f.displayName || "",
    zaloName: f.zaloName || "",
    alias: f.alias || "",
  }));

  // Build all name entries from friends
  const friendNames: { friend: typeof friendList[0]; raw: string; norm: string }[] = [];
  for (const f of friendList) {
    for (const name of [f.alias, f.displayName, f.zaloName]) {
      if (name) {
        friendNames.push({ friend: f, raw: name, norm: normalizeMatch(name) });
      }
    }
  }

  // Load saved sources as fallback (contacts_saved, addfriend_results, stranger_results)
  const savedSources = await loadSavedSources();
  const savedNames: { entry: SavedEntry; raw: string; norm: string }[] = [];
  for (const s of savedSources) {
    if (s.name) savedNames.push({ entry: s, raw: s.name, norm: normalizeMatch(s.name) });
    if (s.zaloName) savedNames.push({ entry: s, raw: s.zaloName, norm: normalizeMatch(s.zaloName) });
  }

  return contacts.map((c) => {
    const searchNorm = normalizeMatch(c.tenDanhBa);

    // 1. Score all friends first
    let bestScore = 0;
    let bestFn: typeof friendNames[0] | null = null;

    for (const fn of friendNames) {
      const score = calcMatchScore(searchNorm, fn.norm);
      if (score > bestScore) {
        bestScore = score;
        bestFn = fn;
      }
    }

    if (bestFn && bestScore >= MATCH_THRESHOLD) {
      return { ...c, zaloId: bestFn.friend.userId, zaloName: bestFn.raw, matched: true, matchScore: bestScore };
    }

    // 2. Fallback: match from saved sources (contacts_saved, addfriend, stranger)
    let bestSavedScore = 0;
    let bestSaved: typeof savedNames[0] | null = null;

    for (const sn of savedNames) {
      const score = calcMatchScore(searchNorm, sn.norm);
      if (score > bestSavedScore) {
        bestSavedScore = score;
        bestSaved = sn;
      }
    }

    if (bestSaved && bestSavedScore >= MATCH_THRESHOLD) {
      return { ...c, zaloId: bestSaved.entry.userId, zaloName: bestSaved.raw, matched: true, matchScore: bestSavedScore };
    }

    return { ...c, matched: false, matchScore: 0 };
  });
}

// Strict scoring: chỉ match khi thực sự chắc chắn, không match lung tung
function calcMatchScore(searchNorm: string, targetNorm: string): number {
  // Exact match
  if (targetNorm === searchNorm) return 100;

  // Target chứa toàn bộ search (alias dài hơn nhưng chứa đầy đủ tên danh bạ)
  // e.g. target="chu tao mbb 0913044884" contains search="chu tao mbb 0913044884"
  if (targetNorm.includes(searchNorm)) {
    return 95;
  }

  // Search chứa toàn bộ target - CHỈ khi target đủ dài (>= 70% search)
  // Tránh "a vu" match với "a vu 735903"
  if (searchNorm.includes(targetNorm)) {
    const ratio = targetNorm.length / searchNorm.length;
    if (ratio >= 0.7) return 90;
    // Quá ngắn → không match
    return 0;
  }

  return 0;
}

export function exportContactsToXlsx(contacts: Contact[]): Buffer {
  const data = contacts.map((c) => ({
    "Danh bạ Zalo": c.tenDanhBa,
    "Danh xưng": c.danhXung,
    "Tên gọi": c.tenGoi,
    "Label": c.label || "",
    "Match": c.matched ? (c.zaloName || "✓") : "",
    "Score": c.matchScore || "",
    "Zalo ID": c.zaloId || "",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Danh bạ");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
