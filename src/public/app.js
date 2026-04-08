var lastQrTimestamp = 0;
var statusTimer = null;

function switchTab(tab) {
  var panels = document.querySelectorAll(".tab-panel");
  var btns = document.querySelectorAll(".tab-btn");
  panels.forEach(function(p) { p.style.display = "none"; });
  btns.forEach(function(b) { b.classList.remove("active"); });

  var panelId = "panel" + tab.charAt(0).toUpperCase() + tab.slice(1);
  var panel = document.getElementById(panelId);
  if (panel) panel.style.display = "block";

  // Highlight active tab button
  btns.forEach(function(b) {
    if (b.textContent.toLowerCase().indexOf(
      tab === "send" ? "gửi tin hàng" : tab === "addfriend" ? "kết bạn" : "người lạ"
    ) !== -1) {
      b.classList.add("active");
    }
  });
}

startPolling();

function startPolling() {
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(pollStatus, 1000);
  pollStatus();
}

async function pollStatus() {
  try {
    var res = await fetch("/api/zalo/status");
    var data = await res.json();
    updateLoginUI(data);
  } catch (e) {
    console.error("Poll error:", e);
  }
}

function updateLoginUI(data) {
  var statusEl = document.getElementById("loginStatus");
  var qrSection = document.getElementById("qrSection");
  var btnFriends = document.getElementById("btnFriends");
  var btnLogout = document.getElementById("btnLogout");
  var btnRetry = document.getElementById("btnRetry");

  if (data.loggedIn) {
    statusEl.innerHTML =
      '<span class="status-dot online"></span> ✅ Đã đăng nhập Zalo';
    qrSection.style.display = "none";
    btnFriends.style.display = "inline-block";
    btnLogout.style.display = "inline-block";
    document.getElementById("btnRefreshFriends").style.display = "inline-block";
    btnRetry.style.display = "none";
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  } else if (data.state === "waiting_qr") {
    btnFriends.style.display = "none";
    btnLogout.style.display = "none";
    btnRetry.style.display = "none";
    if (data.qrReady) {
      statusEl.innerHTML =
        '<span class="status-dot waiting"></span> Quét mã QR bằng app Zalo';
      qrSection.style.display = "block";
      if (data.qrTimestamp && data.qrTimestamp !== lastQrTimestamp) {
        lastQrTimestamp = data.qrTimestamp;
        document.getElementById("qrImg").src =
          "/api/zalo/qr?t=" + data.qrTimestamp;
      }
    } else {
      statusEl.innerHTML =
        '<span class="status-dot waiting"></span> Đang tạo mã QR...';
      qrSection.style.display = "none";
    }
  } else if (data.state === "error") {
    statusEl.innerHTML =
      '<span class="status-dot offline"></span> Lỗi: ' + data.error;
    qrSection.style.display = "none";
    btnFriends.style.display = "none";
    btnLogout.style.display = "none";
    btnRetry.style.display = "inline-block";
  } else {
    statusEl.innerHTML =
      '<span class="status-dot waiting"></span> Đang khởi tạo...';
    qrSection.style.display = "none";
    btnFriends.style.display = "none";
    btnLogout.style.display = "none";
    btnRetry.style.display = "none";
  }
}

async function retryLogin() {
  document.getElementById("loginStatus").innerHTML =
    '<span class="status-dot waiting"></span> Đang tạo mã QR...';
  document.getElementById("btnRetry").style.display = "none";
  try { await fetch("/api/zalo/login", { method: "POST" }); } catch (e) {}
  lastQrTimestamp = 0;
  startPolling();
}

async function doLogout() {
  await fetch("/api/zalo/logout", { method: "POST" });
  lastQrTimestamp = 0;
  document.getElementById("friendListWrap").style.display = "none";
  document.getElementById("friendInfo").textContent = "";
  try { await fetch("/api/zalo/login", { method: "POST" }); } catch (e) {}
  document.getElementById("loginStatus").innerHTML =
    '<span class="status-dot waiting"></span> Đang tạo mã QR...';
  startPolling();
}

var allFriends = [];

async function loadFriends() {
  document.getElementById("friendInfo").textContent = "Đang tải...";
  try {
    var res = await fetch("/api/zalo/friends");
    var data = await res.json();
    if (data.ok) {
      allFriends = data.friends;
      document.getElementById("friendInfo").textContent = "Tổng bạn bè: " + data.count;
      document.getElementById("friendSearchWrap").style.display = "block";
      document.getElementById("friendListWrap").style.display = "block";
      renderFriends(allFriends);
      loadLabels();
    } else {
      document.getElementById("friendInfo").textContent = "Lỗi: " + data.error;
    }
  } catch (e) {
    document.getElementById("friendInfo").textContent = "Lỗi kết nối";
  }
}

async function refreshFriendsList() {
  document.getElementById("friendInfo").textContent = "Đang cập nhật từ Zalo...";
  try {
    var res = await fetch("/api/zalo/friends/refresh", { method: "POST" });
    var data = await res.json();
    if (data.ok) {
      loadFriends();
    } else {
      document.getElementById("friendInfo").textContent = "Lỗi: " + data.error;
    }
  } catch (e) {
    document.getElementById("friendInfo").textContent = "Lỗi kết nối";
  }
}

var allLabels = [];
var selectedLabels = new Set();

async function loadLabels() {
  try {
    var res = await fetch("/api/zalo/labels");
    var data = await res.json();
    if (data.ok && data.labels.length) {
      allLabels = data.labels;
      var wrap = document.getElementById("labelWrap");
      wrap.style.display = "block";
      renderLabelTags();
    }
  } catch (e) {}
}

function renderLabelTags() {
  var tags = document.getElementById("labelTags");
  tags.innerHTML =
    '<label style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:0.75rem;cursor:pointer;background:#222;color:#ccc;margin:2px;border:1px solid #444" onclick="event.preventDefault();toggleLabel(null)"><input type="checkbox" ' + (selectedLabels.size === 0 ? 'checked' : '') + ' style="accent-color:#00a8ff;pointer-events:none" readonly> Tất cả</label>' +
    allLabels.map(function(l) {
      var active = selectedLabels.has(String(l.id));
      return '<label style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:0.75rem;cursor:pointer;background:' + (active ? '#1a3a5c' : '#222') + ';color:' + (active ? '#4fc3f7' : '#ccc') + ';margin:2px;border:1px solid ' + (active ? '#00a8ff' : '#444') + '" onclick="event.preventDefault();toggleLabel(\'' + l.id + '\')"><input type="checkbox" ' + (active ? 'checked' : '') + ' style="accent-color:#00a8ff;pointer-events:none" readonly> ' +
        (l.emoji || '') + ' ' + l.text + ' (' + l.conversations.length + ')</label>';
    }).join("");

  // Update selected info
  var total = 0;
  selectedLabels.forEach(function(id) {
    var label = allLabels.find(function(l) { return String(l.id) === id; });
    if (label) total += label.conversations.length;
  });

  var btnAdd = document.getElementById("btnAddFromLabels");
  var info = document.getElementById("labelSelectedInfo");
  if (selectedLabels.size > 0) {
    btnAdd.style.display = "inline-block";
    info.textContent = selectedLabels.size + " nhóm, ~" + total + " người";
  } else {
    btnAdd.style.display = "none";
    info.textContent = "";
  }
}

function toggleLabel(labelId) {
  if (!labelId) {
    selectedLabels.clear();
  } else {
    var id = String(labelId);
    if (selectedLabels.has(id)) selectedLabels.delete(id);
    else selectedLabels.add(id);
  }
  renderLabelTags();

  // Also filter friend list view
  if (selectedLabels.size === 0) {
    renderFriends(allFriends);
    document.getElementById("friendInfo").textContent = "Tổng bạn bè: " + allFriends.length;
  } else {
    var filtered = getFriendsBySelectedLabels();
    renderFriends(filtered);
    document.getElementById("friendInfo").textContent = "Đã chọn: " + filtered.length + " bạn bè";
  }
}

function getFriendsBySelectedLabels() {
  var ids = new Set();
  selectedLabels.forEach(function(labelId) {
    var label = allLabels.find(function(l) { return String(l.id) === labelId; });
    if (label) label.conversations.forEach(function(uid) { ids.add(uid); });
  });
  return allFriends.filter(function(f) { return ids.has(f.userId); });
}

async function addLabelContactsToList() {
  var friends = getFriendsBySelectedLabels();
  if (!friends.length) { alert("Không có bạn bè nào trong các nhóm đã chọn"); return; }

  // Build userId -> first label name
  var uidLabel = {};
  selectedLabels.forEach(function(labelId) {
    var label = allLabels.find(function(l) { return String(l.id) === labelId; });
    if (label) {
      label.conversations.forEach(function(uid) {
        if (!uidLabel[uid]) uidLabel[uid] = label.text;
      });
    }
  });

  var added = 0;
  for (var i = 0; i < friends.length; i++) {
    var f = friends[i];
    var labelName = uidLabel[f.userId] || "";
    try {
      await fetch("/api/contacts/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenDanhBa: f.displayName || f.zaloName || "",
          danhXung: "",
          tenGoi: f.displayName || f.zaloName || "",
          label: labelName
        }),
      });
      added++;
    } catch (e) {}
  }
  alert("Đã thêm " + added + " người vào DS người nhận");
  loadContactTable();
}

function filterByLabel(labelId) {
  toggleLabel(labelId);
}

function normalizeSearch(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function filterFriends() {
  var q = normalizeSearch(document.getElementById("friendSearch").value.trim());
  var source = selectedLabels.size > 0 ? getFriendsBySelectedLabels() : allFriends;
  if (!q) { renderFriends(source); return; }
  var filtered = source.filter(function(f) {
    return normalizeSearch(f.displayName || "").indexOf(q) !== -1 ||
           normalizeSearch(f.zaloName || "").indexOf(q) !== -1 ||
           normalizeSearch(f.alias || "").indexOf(q) !== -1 ||
           (f.phoneNumber || "").indexOf(q) !== -1;
  });
  renderFriends(filtered);
}

function getFilteredByLabel() {
  return selectedLabels.size > 0 ? getFriendsBySelectedLabels() : allFriends;
}

function renderFriends(friends) {
  document.getElementById("friendTableBody").innerHTML = friends
    .map(function(f, i) {
      var aliasCol = f.alias ? '<span style="color:#4fc3f7">' + f.alias + '</span>' : '<span style="color:#555">-</span>';
      return "<tr style='border-bottom:1px solid #222;cursor:pointer' onclick='addFriendToContacts(\"" + encodeURIComponent(JSON.stringify({id:f.userId,name:f.alias||f.displayName||f.zaloName||"",zalo:f.zaloName||""})) + "\")' onmouseenter='this.style.background=\"#252525\"' onmouseleave='this.style.background=\"transparent\"'>" +
        "<td style='padding:4px 6px;color:#666'>" + (i + 1) + "</td>" +
        "<td style='padding:4px 6px'>" + (f.displayName || "-") + "</td>" +
        "<td style='padding:4px 6px'>" + aliasCol + "</td>" +
        "<td style='padding:4px 6px;color:#999'>" + (f.zaloName || "-") + "</td>" +
        "<td style='padding:4px 6px;color:#666'>" + (f.phoneNumber || "-") + "</td>" +
        "<td style='padding:4px 6px'><span style='color:#00a8ff;font-size:0.75rem'>+ Thêm</span></td>" +
        "</tr>";
    }).join("");
}

function getLabelForUser(userId) {
  for (var i = 0; i < allLabels.length; i++) {
    if (allLabels[i].conversations.indexOf(userId) !== -1) {
      return allLabels[i].text;
    }
  }
  return "";
}

async function addFriendToContacts(encoded) {
  var f = JSON.parse(decodeURIComponent(encoded));
  var labelName = getLabelForUser(f.id);
  try {
    var res = await fetch("/api/contacts/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenDanhBa: f.name,
        danhXung: "",
        tenGoi: f.name,
        label: labelName
      }),
    });
    var data = await res.json();
    if (data.ok) {
      loadContactTable();
    } else {
      alert(data.error);
    }
  } catch (e) {}
}

async function uploadContacts() {
  var input = document.getElementById("contactFile");
  if (!input.files.length) { alert("Chọn file trước"); return; }
  var formData = new FormData();
  formData.append("file", input.files[0]);
  try {
    var res = await fetch("/api/contacts/upload", { method: "POST", body: formData });
    var data = await res.json();
    if (data.ok) {
      if (data.note) alert(data.note);
      loadContactTable();
    } else {
      alert(data.error || "Upload failed");
    }
  } catch (e) {
    alert("Lỗi upload");
  }
}

async function addManualContact() {
  var name = document.getElementById("manualName").value.trim();
  var title = document.getElementById("manualTitle").value.trim();
  var call = document.getElementById("manualCall").value.trim();
  if (!name) { alert("Nhập tên danh bạ Zalo"); return; }

  try {
    var res = await fetch("/api/contacts/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenDanhBa: name, danhXung: title, tenGoi: call }),
    });
    var data = await res.json();
    if (data.ok) {
      loadContactTable();
      document.getElementById("manualName").value = "";
      document.getElementById("manualTitle").value = "";
      document.getElementById("manualCall").value = "";
    } else {
      alert(data.error);
    }
  } catch (e) {
    alert("Lỗi thêm contact");
  }
}

async function deleteContact(index) {
  try {
    var res = await fetch("/api/contacts/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: index }),
    });
    var data = await res.json();
    if (data.ok) loadContactTable();
    else alert(data.error);
  } catch (e) {}
}

async function clearAllContacts() {
  if (!confirm("Xóa hết danh sách?")) return;
  try {
    var res = await fetch("/api/contacts/clear", { method: "POST" });
    var data = await res.json();
    if (data.ok) loadContactTable();
  } catch (e) {}
}

async function saveContacts() {
  try {
    var res = await fetch("/api/contacts/save", { method: "POST" });
    var data = await res.json();
    if (data.ok) alert("Đã lưu " + data.saved + " contacts");
    else alert(data.error);
  } catch (e) { alert("Lỗi lưu"); }
}

async function loadSavedContacts() {
  try {
    var res = await fetch("/api/contacts/load", { method: "POST" });
    var data = await res.json();
    if (data.ok) {
      loadContactTable();
    } else {
      alert(data.error);
    }
  } catch (e) { alert("Lỗi tải"); }
}

async function loadContactTable() {
  try {
    var res = await fetch("/api/contacts");
    var data = await res.json();
    var total = data.total;
    var matched = data.matched;

    document.getElementById("contactSummary").textContent =
      "Tổng: " + total + " | Đã match: " + matched;

    if (total === 0) {
      document.getElementById("contactTableWrap").style.display = "none";
      document.getElementById("btnRematch").style.display = "none";
      return;
    }

    document.getElementById("contactTableWrap").style.display = "block";
    document.getElementById("btnRematch").style.display = "inline-block";
    document.getElementById("btnUnmatchLow").style.display = "inline-block";

    var tbody = document.getElementById("contactTableBody");
    tbody.innerHTML = data.contacts
      .map(function (c, i) {
        var matchCell = "-";
        if (c.matched) {
          var color = c.matchScore >= 90 ? "#69f0ae" : c.matchScore >= 70 ? "#ffc107" : "#ff9800";
          matchCell = '<span style="color:' + color + '">' + (c.zaloName || "✓") + " (" + (c.matchScore || 100) + "%)</span>" +
            ' <button onclick="unmatchContact(' + i + ')" style="background:#555;padding:2px 6px;font-size:.65rem;margin-left:4px" title="Bỏ match">✗</button>';
        }
        var labelCell = c.label ? '<span style="padding:2px 6px;border-radius:4px;background:#333;color:#aaa;font-size:0.7rem">' + c.label + '</span>' : '-';
        return (
          "<tr style='border-bottom:1px solid #222'>" +
          "<td style='padding:6px;color:#666'>" + (i + 1) + "</td>" +
          "<td style='padding:6px'>" + c.tenDanhBa + "</td>" +
          "<td style='padding:6px'><input value='" + escAttr(c.danhXung) + "' onchange='editContact(" + i + ",\"danhXung\",this.value)' style='background:#111;border:1px solid #333;color:#e0e0e0;padding:4px 6px;border-radius:4px;width:70px;font-size:0.8rem' /></td>" +
          "<td style='padding:6px'><input value='" + escAttr(c.tenGoi) + "' onchange='editContact(" + i + ",\"tenGoi\",this.value)' style='background:#111;border:1px solid #333;color:#e0e0e0;padding:4px 6px;border-radius:4px;width:90px;font-size:0.8rem' /></td>" +
          "<td style='padding:6px'><input value='" + escAttr(c.label || "") + "' onchange='editContact(" + i + ",\"label\",this.value)' style='background:#111;border:1px solid #333;color:#aaa;padding:4px 6px;border-radius:4px;width:80px;font-size:0.75rem' /></td>" +
          "<td style='padding:6px'>" + matchCell + "</td>" +
          "<td style='padding:6px'><button onclick='deleteContact(" + i + ")' class='danger' style='padding:4px 8px;font-size:0.75rem'>✗</button></td>" +
          "</tr>"
        );
      })
      .join("");
  } catch (e) {}
}

function escAttr(s) {
  return String(s || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

async function editContact(index, field, value) {
  try {
    await fetch("/api/contacts/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: index, field: field, value: value }),
    });
  } catch (e) {}
}

async function rematch() {
  var btn = document.getElementById("btnRematch");
  btn.disabled = true;
  btn.textContent = "Đang match...";
  try {
    var res = await fetch("/api/contacts/match", { method: "POST" });
    var data = await res.json();
    if (data.ok) {
      loadContactTable();
    } else {
      alert(data.error);
    }
  } catch (e) {}
  btn.disabled = false;
  btn.textContent = "🔗 Match với danh bạ Zalo";
}

// --- Template autocomplete ---
var SUGGESTIONS = [
  { label: "{danh_xung}", desc: "Danh xưng (Anh/Chị/Em...)" },
  { label: "{ten}", desc: "Tên gọi" }
];
var suggestIdx = -1;

function onTemplateInput(e) {
  var ta = e.target;
  var pos = ta.selectionStart;
  var text = ta.value;

  // Find if cursor is right after a `{`
  var bracePos = text.lastIndexOf("{", pos - 1);
  if (bracePos === -1 || text.indexOf("}", bracePos) < pos && text.indexOf("}", bracePos) !== -1) {
    hideSuggest();
    return;
  }

  // Check no closing brace between bracePos and cursor
  var between = text.substring(bracePos, pos);
  if (between.indexOf("}") !== -1) { hideSuggest(); return; }

  var typed = between.substring(1).toLowerCase(); // after {
  var filtered = SUGGESTIONS.filter(function(s) {
    return s.label.substring(1).toLowerCase().indexOf(typed) === 0;
  });

  if (filtered.length === 0) { hideSuggest(); return; }

  suggestIdx = 0;
  showSuggest(filtered, ta, bracePos);
}

function onTemplateKeydown(e) {
  var box = document.getElementById("suggestBox");
  if (box.style.display === "none") return;

  var items = box.querySelectorAll("[data-suggest]");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    suggestIdx = Math.min(suggestIdx + 1, items.length - 1);
    highlightSuggest(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    suggestIdx = Math.max(suggestIdx - 1, 0);
    highlightSuggest(items);
  } else if (e.key === "Enter" || e.key === "Tab") {
    if (suggestIdx >= 0 && suggestIdx < items.length) {
      e.preventDefault();
      pickSuggest(items[suggestIdx].getAttribute("data-suggest"));
    }
  } else if (e.key === "Escape") {
    hideSuggest();
  }
}

function showSuggest(filtered, ta, bracePos) {
  var box = document.getElementById("suggestBox");
  var rect = ta.getBoundingClientRect();
  box.style.left = rect.left + "px";
  box.style.top = (rect.bottom + 4) + "px";
  box.style.minWidth = "250px";
  box.style.display = "block";
  box.innerHTML = filtered.map(function(s, i) {
    var bg = i === suggestIdx ? "#333" : "transparent";
    return '<div data-suggest="' + s.label + '" style="padding:8px 12px;cursor:pointer;background:' + bg + '" ' +
      'onmouseenter="this.style.background=\'#333\'" onmouseleave="this.style.background=\'transparent\'" ' +
      'onclick="pickSuggest(\'' + s.label + '\')">' +
      '<span style="color:#00a8ff">' + s.label + '</span> ' +
      '<span style="color:#666;font-size:0.75rem">' + s.desc + '</span></div>';
  }).join("");
}

function highlightSuggest(items) {
  for (var i = 0; i < items.length; i++) {
    items[i].style.background = i === suggestIdx ? "#333" : "transparent";
  }
}

function pickSuggest(value) {
  var ta = document.activeElement;
  if (!ta || (!ta.id)) ta = document.getElementById("msgTemplate");
  var pos = ta.selectionStart;
  var text = ta.value;
  var bracePos = text.lastIndexOf("{", pos - 1);
  ta.value = text.substring(0, bracePos) + value + text.substring(pos);
  var newPos = bracePos + value.length;
  ta.selectionStart = newPos;
  ta.selectionEnd = newPos;
  ta.focus();
  hideSuggest();
}

function hideSuggest() {
  document.getElementById("suggestBox").style.display = "none";
  suggestIdx = -1;
}

// --- End autocomplete ---

async function previewMsg() {
  var template = document.getElementById("msgTemplate").value;
  if (!template) return;
  try {
    var res = await fetch("/api/messages/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: template }),
    });
    var data = await res.json();
    var box = document.getElementById("previewBox");
    box.style.display = "block";
    box.textContent = data.ok
      ? "📨 " + data.contact + ":\n\n" + data.preview
      : data.error;
  } catch (e) {}
}

async function startSend() {
  var template = document.getElementById("msgTemplate").value;
  if (!template) {
    alert("Nhập template tin nhắn trước");
    return;
  }
  var btn = document.getElementById("btnSend");
  btn.disabled = true;
  btn.textContent = "Đang gửi...";

  var formData = new FormData();
  formData.append("template", template);
  var imgInput = document.getElementById("imageFile");
  if (imgInput.files.length) formData.append("image", imgInput.files[0]);

  try {
    var res = await fetch("/api/messages/send", {
      method: "POST",
      body: formData,
    });
    var data = await res.json();
    if (data.ok) {
      document.getElementById("progressBar").style.display = "block";
      document.getElementById("sendStats").style.display = "flex";
      pollProgress();
    } else {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = "Bắt đầu gửi";
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Bắt đầu gửi";
  }
}

var pollTimer = null;
function pollProgress() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async function () {
    try {
      var res = await fetch("/api/messages/progress");
      var p = await res.json();
      var pct =
        p.total > 0
          ? Math.round(((p.sent + p.failed) / p.total) * 100)
          : 0;
      document.getElementById("progressFill").style.width = pct + "%";
      document.getElementById("progressText").textContent = pct + "%";
      document.getElementById("sentCount").textContent = p.sent;
      document.getElementById("failCount").textContent = p.failed;
      document.getElementById("currentContact").textContent =
        p.current || "-";
      if (p.errors.length) {
        document.getElementById("errorList").innerHTML = p.errors
          .map(function (e) {
            return "❌ " + e.name + ": " + e.error;
          })
          .join("<br>");
      }
      if (p.status === "done") {
        clearInterval(pollTimer);
        document.getElementById("btnSend").disabled = false;
        document.getElementById("btnSend").textContent = "Gửi lại";
        document.getElementById("currentContact").textContent = "✅ Hoàn tất";
      }
    } catch (e) {}
  }, 1500);
}

// --- Add Friend ---
function updateLookupTen(prefix, idx, value) {
  if (lookupResults[prefix] && lookupResults[prefix][idx]) {
    lookupResults[prefix][idx].tenGoi = value;
  }
}

async function startAddFriend() {
  // Use lookup results if available, otherwise parse textarea
  var entries;
  if (lookupResults["af"] && lookupResults["af"].length) {
    entries = lookupResults["af"].filter(function(r) { return r.status === "found" || r.status === "manual"; }).map(function(r) {
      return { phone: r.phone, name: r.tenGoi || r.name || "", danhXung: r.danhXung || "" };
    });
  } else {
    var raw = document.getElementById("addFriendPhones").value.trim();
    if (!raw) { alert("Nhập danh sách SĐT"); return; }
    entries = raw.split(/\n+/).map(function(line) {
      var parts = line.split(/[,\t]+/);
      return { phone: (parts[0] || "").trim(), name: (parts[1] || "").trim() };
    }).filter(function(e) { return e.phone.length >= 9; });
  }

  if (!entries.length) { alert("Không có SĐT hợp lệ hoặc chưa tra cứu"); return; }

  var msg = document.getElementById("addFriendMsg").value.trim();
  var btn = document.getElementById("btnAddFriend");
  btn.disabled = true;
  btn.textContent = "Đang gửi...";

  try {
    var res = await fetch("/api/addfriend/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: entries, message: msg }),
    });
    var data = await res.json();
    if (data.ok) {
      document.getElementById("addFriendBar").style.display = "block";
      document.getElementById("addFriendStats").style.display = "flex";
      pollAddFriend();
    } else {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = "🚀 Bắt đầu kết bạn";
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "🚀 Bắt đầu kết bạn";
  }
}

var afTimer = null;
function pollAddFriend() {
  if (afTimer) clearInterval(afTimer);
  afTimer = setInterval(async function() {
    try {
      var res = await fetch("/api/addfriend/progress");
      var p = await res.json();
      var pct = p.total > 0 ? Math.round(((p.sent + p.failed) / p.total) * 100) : 0;
      document.getElementById("addFriendFill").style.width = pct + "%";
      document.getElementById("addFriendPct").textContent = pct + "%";
      document.getElementById("afSent").textContent = p.sent;
      document.getElementById("afFail").textContent = p.failed;
      document.getElementById("afCurrent").textContent = p.current || "-";

      // Render result table
      if (p.results && p.results.length) {
        document.getElementById("afResultTable").style.display = "block";
        document.getElementById("afResultBody").innerHTML = p.results.map(function(r, i) {
          var statusText = r.status === "sent" ? '<span style="color:#69f0ae">✓ Đã gửi</span>' :
            r.status === "failed" ? '<span style="color:#ff5252">✗ ' + (r.error || "Lỗi") + '</span>' :
            '<span style="color:#999">⏳</span>';
          var nameCol = r.zaloName ? r.name + ' <span style="color:#666">(' + r.zaloName + ')</span>' : r.name || '-';
          return "<tr style='border-bottom:1px solid #222'>" +
            "<td style='padding:4px 6px;color:#666'>" + (i+1) + "</td>" +
            "<td style='padding:4px 6px'>" + r.phone + "</td>" +
            "<td style='padding:4px 6px'>" + nameCol + "</td>" +
            "<td style='padding:4px 6px'>" + statusText + "</td></tr>";
        }).join("");
      }

      if (p.status === "done") {
        clearInterval(afTimer);
        document.getElementById("btnAddFriend").disabled = false;
        document.getElementById("btnAddFriend").textContent = "🚀 Bắt đầu kết bạn";
        document.getElementById("afCurrent").textContent = "✅ Hoàn tất";

        // Auto save to contacts if checked
        if (document.getElementById("afAutoSave").checked) {
          saveAddFriendToContacts(p.results);
        }
      }
    } catch (e) {}
  }, 1500);
}

async function saveAddFriendToContacts(results) {
  var sent = results.filter(function(r) { return r.status === "sent"; });
  for (var i = 0; i < sent.length; i++) {
    var r = sent[i];
    try {
      await fetch("/api/contacts/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenDanhBa: r.name || r.zaloName || r.phone,
          danhXung: "",
          tenGoi: r.name || r.zaloName || "",
          label: "KH tiềm năng"
        }),
      });
    } catch (e) {}
  }
  if (sent.length) loadContactTable();
}

// --- Stranger Send ---
async function startStrangerSend() {
  var entries;
  if (lookupResults["st"] && lookupResults["st"].length) {
    entries = lookupResults["st"].filter(function(r) { return r.status === "found" || r.status === "manual"; }).map(function(r) {
      return { phone: r.phone, name: r.tenGoi || r.name || "" };
    });
  } else {
    var raw = document.getElementById("strangerPhones").value.trim();
    if (!raw) { alert("Nhập danh sách SĐT"); return; }
    entries = raw.split(/\n+/).map(function(line) {
      var parts = line.split(/[,\t]+/);
      return { phone: (parts[0] || "").trim(), name: (parts[1] || "").trim() };
    }).filter(function(e) { return e.phone.length >= 9; });
  }

  if (!entries.length) { alert("Không có SĐT hợp lệ"); return; }
  if (entries.length > 30) {
    if (!confirm("Bạn đang gửi " + entries.length + " tin. Khuyến nghị tối đa 30 tin/ngày để tránh bị khóa TK. Tiếp tục?")) return;
  }

  var msg = document.getElementById("strangerMsg").value.trim();
  if (!msg) { alert("Nhập tin nhắn"); return; }

  var btn = document.getElementById("btnStranger");
  btn.disabled = true;
  btn.textContent = "Đang gửi...";

  var formData = new FormData();
  formData.append("entries", JSON.stringify(entries));
  formData.append("message", msg);
  var imgInput = document.getElementById("strangerImage");
  if (imgInput.files.length) formData.append("image", imgInput.files[0]);

  try {
    var res = await fetch("/api/stranger/send", { method: "POST", body: formData });
    var data = await res.json();
    if (data.ok) {
      document.getElementById("strangerBar").style.display = "block";
      document.getElementById("strangerStats").style.display = "flex";
      document.getElementById("strangerLimit").textContent = entries.length + "/30 tin hôm nay";
      pollStranger();
    } else {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = "🚀 Bắt đầu gửi";
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "🚀 Bắt đầu gửi";
  }
}

var stTimer = null;
function pollStranger() {
  if (stTimer) clearInterval(stTimer);
  stTimer = setInterval(async function() {
    try {
      var res = await fetch("/api/stranger/progress");
      var p = await res.json();
      var pct = p.total > 0 ? Math.round(((p.sent + p.failed) / p.total) * 100) : 0;
      document.getElementById("strangerFill").style.width = pct + "%";
      document.getElementById("strangerPct").textContent = pct + "%";
      document.getElementById("stSent").textContent = p.sent;
      document.getElementById("stFail").textContent = p.failed;
      document.getElementById("stCurrent").textContent = p.current || "-";

      if (p.results && p.results.length) {
        document.getElementById("stResultTable").style.display = "block";
        document.getElementById("stResultBody").innerHTML = p.results.map(function(r, i) {
          var st = r.status === "sent" ? '<span style="color:#69f0ae">✓ Đã gửi</span>' :
            r.status === "failed" ? '<span style="color:#ff5252">✗ ' + (r.error || "Lỗi") + '</span>' :
            '<span style="color:#999">⏳</span>';
          var nm = r.zaloName ? r.name + ' <span style="color:#666">(' + r.zaloName + ')</span>' : r.name || '-';
          return "<tr style='border-bottom:1px solid #222'><td style='padding:4px 5px;color:#666'>" + (i+1) + "</td><td style='padding:4px 5px'>" + r.phone + "</td><td style='padding:4px 5px'>" + nm + "</td><td style='padding:4px 5px'>" + st + "</td></tr>";
        }).join("");
      }

      if (p.status === "done") {
        clearInterval(stTimer);
        document.getElementById("btnStranger").disabled = false;
        document.getElementById("btnStranger").textContent = "🚀 Bắt đầu gửi";
        document.getElementById("stCurrent").textContent = "✅ Hoàn tất";
      }
    } catch (e) {}
  }, 1500);
}

// --- Bulk Phone Lookup ---
var lookupResults = {};

async function bulkLookup(prefix) {
  var taId = prefix === "af" ? "addFriendPhones" : "strangerPhones";
  var raw = document.getElementById(taId).value.trim();
  if (!raw) { alert("Nhập danh sách SĐT trước"); return; }

  var lines = raw.split(/\n+/);
  var phones = lines.map(function(line) {
    var parts = line.split(/[,\t]+/);
    return { phone: (parts[0] || "").trim(), name: (parts[1] || "").trim() };
  }).filter(function(e) { return e.phone.length >= 9; });

  if (!phones.length) { alert("Không có SĐT hợp lệ"); return; }

  var btn = document.getElementById(prefix === "af" ? "btnAfLookup" : "btnStLookup");
  var statusEl = document.getElementById(prefix + "LookupStatus");
  var tableEl = document.getElementById(prefix + "LookupTable");
  var bodyEl = document.getElementById(prefix + "LookupBody");
  var apiPath = prefix === "af" ? "/api/addfriend/lookup" : "/api/stranger/lookup";

  btn.disabled = true;
  btn.textContent = "Đang tra cứu...";
  tableEl.style.display = "block";
  lookupResults[prefix] = [];

  var newLines = [];
  for (var i = 0; i < phones.length; i++) {
    var p = phones[i];
    statusEl.textContent = "Tra cứu " + (i + 1) + "/" + phones.length + "...";

    var result = { phone: p.phone, name: p.name, danhXung: "", status: "pending" };

    if (!p.name) {
      try {
        var res = await fetch(apiPath + "?phone=" + encodeURIComponent(p.phone));
        var data = await res.json();
        if (data.ok) {
          result.name = data.name;
          result.tenGoi = data.tenGoi || data.name;
          result.danhXung = data.danhXung || "";
          result.status = "found";
        } else {
          result.status = "not_found";
          result.error = data.error || "";
        }
      } catch (e) {
        result.status = "error";
      }
      // Delay between lookups
      if (i < phones.length - 1) await new Promise(function(r) { setTimeout(r, 1500); });
    } else {
      result.status = "manual";
      result.tenGoi = p.name;
    }

    lookupResults[prefix].push(result);
    newLines.push(result.phone + ", " + (result.name || p.name || ""));

    // Update table live
    bodyEl.innerHTML = lookupResults[prefix].map(function(r, idx) {
      var st = r.status === "found" ? '<span style="color:#69f0ae">✓ Tìm thấy</span>' :
        r.status === "not_found" ? '<span style="color:#ff5252">✗ ' + (r.error || "Không thấy") + '</span>' :
        r.status === "manual" ? '<span style="color:#999">Đã có tên</span>' :
        r.status === "error" ? '<span style="color:#ff5252">Lỗi</span>' : '⏳';
      var tenGoiVal = escAttr(r.tenGoi || "");
      return "<tr style='border-bottom:1px solid #222'>" +
        "<td style='padding:4px 5px;color:#666'>" + (idx+1) + "</td>" +
        "<td style='padding:4px 5px'>" + r.phone + "</td>" +
        "<td style='padding:4px 5px;color:#999'>" + (r.name || "-") + "</td>" +
        "<td style='padding:4px 5px'><input value='" + tenGoiVal + "' onchange='updateLookupTen(\"" + prefix + "\"," + idx + ",this.value)' style='background:#111;border:1px solid #333;color:#4fc3f7;padding:3px 5px;border-radius:4px;width:80px;font-size:.78rem' /></td>" +
        "<td style='padding:4px 5px'>" + (r.danhXung || "-") + "</td>" +
        "<td style='padding:4px 5px'>" + st + "</td></tr>";
    }).join("");
  }

  // Update textarea with names filled in
  document.getElementById(taId).value = newLines.join("\n");

  statusEl.textContent = "Hoàn tất: " + lookupResults[prefix].filter(function(r) { return r.status === "found"; }).length + " tìm thấy / " + phones.length;
  btn.disabled = false;
  btn.textContent = "🔍 Tra cứu tất cả";
}

// --- Schedule (Care) ---
loadScheduleStatus();

async function loadScheduleStatus() {
  try {
    var res = await fetch("/api/schedule");
    var data = await res.json();
    if (data.ok && data.schedule) {
      var s = data.schedule;
      document.getElementById("schedInfo").innerHTML =
        "📅 <b>" + s.status.toUpperCase() + "</b> | " +
        s.remaining + " còn lại / " + s.total + " tổng | " +
        s.perDay + " tin/ngày, " + s.fromHour + "h-" + s.toHour + "h" +
        " | ~" + s.daysLeft + " ngày nữa";

      if (s.status === "active") {
        document.getElementById("btnSchedPause").style.display = "inline-block";
        document.getElementById("btnSchedResume").style.display = "none";
      } else if (s.status === "paused") {
        document.getElementById("btnSchedPause").style.display = "none";
        document.getElementById("btnSchedResume").style.display = "inline-block";
      }
      document.getElementById("btnSchedDelete").style.display = "inline-block";

      if (s.log && s.log.length) {
        document.getElementById("schedLog").innerHTML = "Lịch sử: " +
          s.log.map(function(l) { return l.date + ": " + l.sent + " gửi, " + l.failed + " lỗi"; }).join(" | ");
      }
    }
  } catch (e) {}
}

async function createCareSchedule() {
  // Load contacts from server (matched ones)
  var res = await fetch("/api/contacts");
  var data = await res.json();
  var matched = data.contacts.filter(function(c) { return c.matched && c.zaloId; });

  if (!matched.length) { alert("Chưa có KH nào đã match. Vào tab 'Gửi tin hàng loạt' upload và match danh sách trước."); return; }

  var msg = document.getElementById("careMsg").value.trim();
  if (!msg) { alert("Nhập tin nhắn chăm sóc"); return; }

  var perDay = parseInt(document.getElementById("schedPerDay").value) || 30;
  var fromHour = parseInt(document.getElementById("schedFromHour").value) || 8;
  var toHour = parseInt(document.getElementById("schedToHour").value) || 17;

  var entries = matched.map(function(c) {
    return { tenDanhBa: c.tenDanhBa, danhXung: c.danhXung || "", tenGoi: c.tenGoi || "", zaloId: c.zaloId };
  });

  var days = Math.ceil(entries.length / perDay);
  if (!confirm("Tạo lịch chăm sóc: " + entries.length + " KH, " + perDay + " tin/ngày (" + fromHour + "h-" + toHour + "h), ~" + days + " ngày. OK?")) return;

  try {
    var r = await fetch("/api/schedule/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: entries, message: msg, perDay: perDay, fromHour: fromHour, toHour: toHour }),
    });
    var d = await r.json();
    if (d.ok) {
      alert("Đã tạo lịch: " + d.total + " KH, ~" + d.daysNeeded + " ngày");
      loadScheduleStatus();
    } else { alert(d.error); }
  } catch (e) { alert("Lỗi"); }
}

async function pauseResumeSchedule() {
  await fetch("/api/schedule/pause", { method: "POST" });
  loadScheduleStatus();
}

async function resumeScheduleAction() {
  await fetch("/api/schedule/resume", { method: "POST" });
  loadScheduleStatus();
}

async function deleteScheduleAction() {
  if (!confirm("Xóa lịch chăm sóc?")) return;
  await fetch("/api/schedule/delete", { method: "POST" });
  document.getElementById("schedInfo").textContent = "";
  document.getElementById("schedLog").textContent = "";
  document.getElementById("btnSchedPause").style.display = "none";
  document.getElementById("btnSchedResume").style.display = "none";
  document.getElementById("btnSchedDelete").style.display = "none";
}

// --- Unmatch contact ---
async function unmatchContact(index) {
  try {
    var res = await fetch("/api/contacts/unmatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: index }),
    });
    var data = await res.json();
    if (data.ok) loadContactTable();
    else alert(data.error);
  } catch (e) {}
}

// --- Export contacts to xlsx ---
function exportContacts() {
  window.location.href = "/api/contacts/export";
}

// --- Auto-load saved contacts on page load ---
(async function() {
  try {
    var res = await fetch("/api/contacts/load", { method: "POST" });
    var data = await res.json();
    if (data.ok && data.total > 0) {
      loadContactTable();
    }
  } catch (e) {}
})();
