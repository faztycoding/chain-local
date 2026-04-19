// ============================================================
// Database Viewer Page - แสดงข้อมูลดิบในฐานข้อมูล
// ============================================================
// ดึงข้อมูลจาก:
//   GET /api/orders              → ตาราง orders
//   GET /api/stats/history?limit=1000 → ตาราง inspection_results (+ join)
//
// ฟีเจอร์:
//   - ดูข้อมูลเป็นตาราง / JSON
//   - Refresh / Export ออกเป็นไฟล์ JSON
//   - Auto-update ผ่าน Socket.io เมื่อมี order/inspection ใหม่

const socket = io();

let cachedOrders = [];
let cachedInspections = [];

// สลับแท็บการดูข้อมูล (Orders / Inspections / Raw JSON)
function switchTable(name) {
  document.querySelectorAll('.db-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.db-btn[data-table]').forEach(b => b.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  document.querySelector(`.db-btn[data-table="${name}"]`).classList.add('active');
}

// โหลดข้อมูลจาก API ทั้งสอง endpoint พร้อมกัน
async function loadData() {
  try {
    const [ordersRes, inspectionsRes] = await Promise.all([
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/stats/history?limit=1000').then(r => r.json())
    ]);

    cachedOrders = ordersRes || [];
    cachedInspections = inspectionsRes || [];

    renderOrders(cachedOrders);
    renderInspections(cachedInspections);
    renderRawJson();

    document.getElementById('countOrders').textContent = cachedOrders.length;
    document.getElementById('countInspections').textContent = cachedInspections.length;
    document.getElementById('lastRefresh').textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Failed to load database:', err);
    showToast('Cannot load data from server', 'error');
  }
}

// แสดงข้อมูลในตาราง orders
function renderOrders(data) {
  const tbody = document.getElementById('ordersBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:#aaa; padding:20px;">No data</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(o => `
    <tr>
      <td>#${o.id}</td>
      <td>${o.mode}</td>
      <td>${o.chain_size}</td>
      <td>${o.chain_color}</td>
      <td>${o.product_attribution || '-'}</td>
      <td>${o.total_chain_count}</td>
      <td>${o.total_defect_count}</td>
      <td><span class="badge ${statusBadgeClass(o.status)}">${o.status}</span></td>
      <td>${o.created_at}</td>
      <td>${o.updated_at}</td>
    </tr>
  `).join('');
}

// แสดงข้อมูลในตาราง inspection_results
function renderInspections(data) {
  const tbody = document.getElementById('inspectionsBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#aaa; padding:20px;">No data</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => `
    <tr>
      <td>#${r.inspection_id ?? r.id}</td>
      <td>#${r.order_id}</td>
      <td>${r.chain_count}</td>
      <td><span class="badge ${r.defect_type === 'none' ? 'badge-pass' : 'badge-defect'}">${r.defect_type}</span></td>
      <td>${r.defect_detail || '-'}</td>
      <td>${r.confidence != null ? (r.confidence * 100).toFixed(1) + '%' : '-'}</td>
      <td style="font-size:11px; color:#667;">${r.image_path || '-'}</td>
      <td>${r.timestamp}</td>
    </tr>
  `).join('');
}

// แสดงข้อมูลในรูปแบบ Raw JSON
function renderRawJson() {
  const payload = {
    orders: cachedOrders,
    inspection_results: cachedInspections,
    meta: {
      total_orders: cachedOrders.length,
      total_inspections: cachedInspections.length,
      exported_at: new Date().toISOString()
    }
  };
  document.getElementById('rawJson').textContent = JSON.stringify(payload, null, 2);
}

// กำหนดสี badge ตามสถานะ
function statusBadgeClass(status) {
  if (status === 'running' || status === 'completed') return 'badge-pass';
  if (status === 'emergency') return 'badge-defect';
  return 'badge-defect';
}

// Export ข้อมูลทั้งหมดออกเป็นไฟล์ JSON
function exportJSON() {
  const payload = {
    orders: cachedOrders,
    inspection_results: cachedInspections,
    meta: {
      exported_at: new Date().toISOString(),
      total_orders: cachedOrders.length,
      total_inspections: cachedInspections.length
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chain_database_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported to JSON file', 'success');
}

// แจ้งเตือน Toast
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = 'toast'; }, 3000);
}

// Real-time update เมื่อมีข้อมูลใหม่
socket.on('new_order', loadData);
socket.on('detection_result', loadData);
socket.on('order_status_changed', loadData);
socket.on('system_reset', loadData);

// โหลดข้อมูลครั้งแรก
loadData();
