// ============================================================
// หน้า Output - ลอจิกแสดงผลแบบ Real-time (HMI)
// ============================================================
// หัวใจของระบบ! รับข้อมูลจาก 2 แหล่ง:
// 1) จากหน้า Input (เมื่อมี Order ใหม่)
// 2) จาก AI YOLOv8 (เมื่อตรวจจับโซ่แต่ละเฟรม)
// และอัปเดตหน้าจอทันทีผ่าน Socket.io โดยไม่ต้อง Refresh

// เชื่อมต่อ Socket.io
const socket = io();

// เก็บรหัส Order ที่กำลังแสดงอยู่
// ทำไมต้องเก็บ? → เพราะต้องรู้ว่ากำลังโชว์ของ Order ไหน เพื่ออัปเดตข้อมูลให้ถูกตัว
let currentOrderId = null;

// เก็บ defect points ของ order ปัจจุบันไว้แสดงใน Timeline panel
let defectPointsBuffer = [];

// เมื่อเชื่อมต่อ Server ได้ → สถานะกล้องเป็นสีเขียว "เชื่อมต่อแล้ว"
socket.on('connect', () => {
  addLog('System', 'Connected to server');
  document.getElementById('cameraStatus').textContent = 'Connected';
  document.getElementById('cameraStatus').className = 'value green';
});

// หลุดการเชื่อมต่อ → สถานะเป็นสีแดง "ขาดการเชื่อมต่อ"
socket.on('disconnect', () => {
  addLog('System', 'Disconnected from server');
  document.getElementById('cameraStatus').textContent = 'Disconnected';
  document.getElementById('cameraStatus').className = 'value red';
});

// สลับระหว่าง "หน้าว่าง" กับ "หน้าแสดงข้อมูล"
// ตอนเปิดครั้งแรก ยังไม่มี order → โชว์ empty state ให้กดไปหน้า Input
// พอมี order แล้ว → ซ่อน empty state แล้วโชว์ข้อมูลจริง + dropdown เลือก order
function setFirstUseState(isFirstUse) {
  const firstUseState = document.getElementById('firstUseState');
  const orderPanel = document.getElementById('orderPanel');
  const selectorPanel = document.getElementById('orderSelectorPanel');
  if (!firstUseState || !orderPanel) return;

  firstUseState.style.display = isFirstUse ? 'block' : 'none';
  orderPanel.style.display = isFirstUse ? 'none' : 'block';
  if (selectorPanel) selectorPanel.style.display = isFirstUse ? 'none' : 'block';
}

// โหลดรายการ order ทั้งหมดใส่ dropdown ให้เลือก
// ทำไมต้องมี? → ให้ผู้ใช้ดูคำสั่งเก่าได้ ไม่ใช่แค่อันล่าสุด
// เรียกตอน: เปิดหน้าครั้งแรก + มี order ใหม่เข้ามา
async function loadOrdersList() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();
    const select = document.getElementById('orderSelector');
    if (!select || orders.length === 0) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Select Order --</option>' +
      orders.map(o => `<option value="${o.id}" ${o.id == currentOrderId ? 'selected' : ''}>#${o.id} | ${getModeLabel(o.mode)} | ${o.chain_size} | ${getColorLabel(o.chain_color)} | ${getStatusLabel(o.status)}</option>`).join('');
  } catch (err) {
    console.error('โหลดรายการคำสั่งไม่สำเร็จ:', err);
  }
}

// เมื่อเลือก order จาก dropdown → โหลดข้อมูล order + ผลตรวจของ order นั้น
// ถ้า order นั้นยังไม่มีผลตรวจ → โชว์ "-" ทุกช่อง
async function onOrderSelect(orderId) {
  if (!orderId) return;
  try {
    const res = await fetch(`/api/output/${orderId}`);
    const data = await res.json();
    if (!data.order) return;

    currentOrderId = data.order.id;
    updateOrderDisplay(data.order, data.stats);
    if (data.inspection) {
      updateInspectionDisplay(data.inspection, data.order, data.stats);
    } else {
      document.getElementById('defectType').textContent = 'No results yet';
      document.getElementById('confidence').textContent = '-';
      document.getElementById('detectedLink').textContent = '-';
      document.getElementById('defectDetail').textContent = '-';
      document.getElementById('lastUpdated').textContent = '-';
      document.getElementById('chainDefectCount').textContent = '0';
      document.getElementById('aiImage').style.display = 'none';
      document.getElementById('aiImagePlaceholder').style.display = 'block';
    }
    defectPointsBuffer = data.defect_points || [];
    renderDefectTimeline(defectPointsBuffer);
    addLog('Select', `Switched to order #${orderId}`);
  } catch (err) {
    console.error('โหลดข้อมูลคำสั่งไม่สำเร็จ:', err);
  }
}

// รับคำสั่งใหม่จากหน้า Input (ผ่าน Socket.io)
// ทำไมไม่ใช้ API ดึงข้อมูล?
// → Socket.io เป็นแบบ "push" Server ส่งข้อมูลมาหาเราเอง
//   ไม่ต้องคอยถามซ้ำๆ (polling) เร็วกว่าและไม่เปลืองทรัพยากร
socket.on('new_order', (order) => {
  currentOrderId = order.id;
  addLog('Order', `New order: #${order.id} | Mode: ${getModeLabel(order.mode)} | Size: ${order.chain_size} | Color: ${getColorLabel(order.chain_color)}`);
  updateOrderDisplay(order);
  loadOrdersList();
  showToast(`New order #${order.id} received!`, 'success');
});

// รับเหตุการณ์ "ระบบถูกรีเซต" → รีโหลดหน้าให้กลับสู่สภาพแรก
socket.on('system_reset', () => {
  showToast('System has been reset. Reloading...', 'success');
  setTimeout(() => location.reload(), 1500);
});

// รับการเปลี่ยนสถานะ (เมื่อกดปุ่ม เริ่ม/หยุด/ฉุกเฉิน)
socket.on('order_status_changed', (order) => {
  if (order.id === currentOrderId) {
    updateOrderDisplay(order);
    updateSystemStatus(order.status);
    addLog('Status', `Order #${order.id} changed to: ${getStatusLabel(order.status)}`);
  }
});

// รับผลตรวจจับจาก AI (Real-time จาก YOLOv8)
// นี่คือ Event สำคัญที่สุด!
// Flow: YOLOv8 ส่ง JSON ไป POST /api/detect → Server เก็บ DB + emit มาที่นี่
socket.on('detection_result', (data) => {
  const { inspection, order, defect_points, stats } = data;

  // เช็คว่าเป็น Order ที่แสดงอยู่ หรือยังไม่มี Order (รับทั้งหมด)
  if (order.id === currentOrderId || !currentOrderId) {
    currentOrderId = order.id;
    updateOrderDisplay(order, stats);
    updateInspectionDisplay(inspection, order, stats);

    // เพิ่ม defect points จุดใหม่เข้า Timeline (ใส่ด้านบน)
    if (Array.isArray(defect_points) && defect_points.length > 0) {
      defectPointsBuffer = [...defect_points, ...defectPointsBuffer].slice(0, 50);
      renderDefectTimeline(defectPointsBuffer);

      // log แต่ละจุด defect
      defect_points.forEach(p => {
        addLog('Defect', `Link #${p.link_number ?? '?'} | ${getDefectLabel(p.defect_type)} | ${(p.confidence * 100).toFixed(1)}% | ${p.detected_at}`);
      });
    } else {
      const logType = (inspection.defect_count || 0) > 0 ? 'Defect' : 'Pass';
      addLog(logType, `Count: ${inspection.chain_count} | ${inspection.defect_count || 0} defect points | Confidence: ${(inspection.confidence * 100).toFixed(1)}%`);
    }
  }
});

// อัปเดตพาเนลข้อมูลคำสั่งปัจจุบัน
// เปิดพาเนลที่ซ่อนไว้ (display:none) และเติมข้อมูลทุกช่อง
function updateOrderDisplay(order, stats) {
  setFirstUseState(false);
  document.getElementById('orderId').textContent = '#' + order.id;
  document.getElementById('orderMode').textContent = getModeLabel(order.mode);
  document.getElementById('orderSize').textContent = order.chain_size;
  document.getElementById('orderColor').textContent = getColorLabel(order.chain_color);
  document.getElementById('orderAttribution').textContent = order.product_attribution || '-';
  document.getElementById('orderDefects').textContent = stats ? stats.total_defect_points : order.total_defect_count;
  const dcEl = document.getElementById('orderDefectiveChains');
  if (dcEl) dcEl.textContent = stats ? stats.defective_chains : 0;
  document.getElementById('chainCount').textContent = order.total_chain_count;
  updateSystemStatus(order.status);
}

// อัปเดตส่วน "ผลการตรวจจับจาก AI" ทั้งหมด
// ใส่: สถานะตรวจจับ, ประเภทตำหนิ, ความมั่นใจ, รูปภาพ, เวลา
// ถ้ามีรูป → โชว์รูป / ถ้าไม่มี → โชว์ placeholder
function updateInspectionDisplay(inspection, order, stats) {
  document.getElementById('chainCount').textContent = order.total_chain_count;

  const detStatus = document.getElementById('detectionStatus');
  const dCount = inspection.defect_count || 0;
  if (dCount === 0) {
    detStatus.textContent = 'No Defect';
    detStatus.className = 'value green';
  } else {
    detStatus.textContent = `${dCount} Defect Point${dCount > 1 ? 's' : ''} Found!`;
    detStatus.className = 'value red';
  }

  document.getElementById('defectType').textContent = dCount === 0 ? 'Normal' : getDefectLabel(inspection.defect_type);
  document.getElementById('chainDefectCount').textContent = dCount;
  document.getElementById('confidence').textContent = (inspection.confidence * 100).toFixed(1) + '%';
  document.getElementById('detectedLink').textContent = inspection.chain_count > 0 ? inspection.chain_count + ' links' : '-';
  document.getElementById('defectDetail').textContent = inspection.defect_detail || '-';
  document.getElementById('lastUpdated').textContent = inspection.timestamp;

  if (inspection.image_path) {
    document.getElementById('aiImage').src = inspection.image_path;
    document.getElementById('aiImage').style.display = 'block';
    document.getElementById('aiImagePlaceholder').style.display = 'none';
  } else {
    document.getElementById('aiImage').src = '';
    document.getElementById('aiImage').style.display = 'none';
    document.getElementById('aiImagePlaceholder').style.display = 'block';
  }

  if (stats) {
    document.getElementById('orderDefects').textContent = stats.total_defect_points;
    const dcEl = document.getElementById('orderDefectiveChains');
    if (dcEl) dcEl.textContent = stats.defective_chains;
  } else {
    document.getElementById('orderDefects').textContent = order.total_defect_count;
  }
}

// แสดง Timeline ของ defect points (เวลา + ข้อที่ + ประเภท)
function renderDefectTimeline(points) {
  const tbody = document.getElementById('defectTimelineBody');
  if (!tbody) return;
  if (!points || points.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#aaa; padding:20px;">No defect points detected yet</td></tr>';
    return;
  }
  tbody.innerHTML = points.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${p.detected_at}</td>
      <td><strong>${p.link_number != null ? '#' + p.link_number : '-'}</strong></td>
      <td><span class="badge badge-defect">${getDefectLabel(p.defect_type)}</span></td>
      <td>${p.defect_detail || '-'}</td>
      <td>${p.confidence != null ? (p.confidence * 100).toFixed(1) + '%' : '-'}</td>
    </tr>
  `).join('');
}

// อัปเดตสถานะระบบบนการ์ดสถานะ
// ทำไมใช้ switch-case ไม่ใช่ if-else?
// → อ่านง่ายกว่าเมื่อมีหลายสถานะที่ต้องจัดการต่างกัน
function updateSystemStatus(status) {
  const sysStatus = document.getElementById('systemStatus');
  const chainStatus = document.getElementById('chainStatus');

  switch (status) {
    case 'running':
      sysStatus.textContent = 'Running';
      sysStatus.className = 'value green';
      chainStatus.textContent = 'Running';
      chainStatus.className = 'value green';
      break;
    case 'stopped':
      sysStatus.textContent = 'Stopped';
      sysStatus.className = 'value red';
      chainStatus.textContent = 'Stopped';
      chainStatus.className = 'value orange';
      break;
    case 'emergency':
      sysStatus.textContent = 'Emergency Stop';
      sysStatus.className = 'value red';
      chainStatus.textContent = 'Emergency Stop';
      chainStatus.className = 'value red';
      break;
    case 'completed':
      sysStatus.textContent = 'Finished';
      sysStatus.className = 'value blue';
      chainStatus.textContent = 'Finished';
      chainStatus.className = 'value blue';
      break;
    default:
      sysStatus.textContent = 'Pending';
      sysStatus.className = 'value orange';
      chainStatus.textContent = 'Waiting for order';
      chainStatus.className = 'value orange';
  }
}

// ปุ่มควบคุม (Mockup Logic)
// ทำไมเป็น Mockup? → เพราะเป็นแค่ Prototype ยังไม่ได้เชื่อมเครื่องจักรจริง
//   แค่เปลี่ยนสถานะใน DB + หน้าจอเท่านั้น
// ใช้ PATCH ไม่ใช่ PUT? → เพราะแก้แค่บางฟิลด์ (สถานะ) ไม่ใช่แก้ทั้งก้อน
async function controlAction(status) {
  if (!currentOrderId) {
    showToast('No order yet. Please create one from the Input page.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/orders/${currentOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    const data = await res.json();
    if (data.success) {
      addLog('Control', `Sent ${getStatusLabel(status)} command for order #${currentOrderId}`);
      showToast(`System status: ${getStatusLabel(status)}`, status === 'running' ? 'success' : 'error');
    }
  } catch (err) {
    showToast('Failed to send command', 'error');
    console.error(err);
  }
}

// โหลดข้อมูลล่าสุดจาก API ตอนเปิดหน้า/refresh
// ทำไมต้องมี? → Socket.io ส่งแค่ข้อมูลใหม่ ถ้า refresh หน้าข้อมูลหาย
//   API นี้ช่วยดึงข้อมูลล่าสุดกลับมา
async function loadCurrentOutput() {
  try {
    const res = await fetch('/api/output/current');
    const data = await res.json();

    if (!data.order) {
      setFirstUseState(true);
      return;
    }

    currentOrderId = data.order.id;
    updateOrderDisplay(data.order, data.stats);

    if (data.inspection) {
      updateInspectionDisplay(data.inspection, data.order, data.stats);
    }

    defectPointsBuffer = data.defect_points || [];
    renderDefectTimeline(defectPointsBuffer);
  } catch (err) {
    console.error('โหลดข้อมูลหน้าควบคุมไม่สำเร็จ:', err);
  }
}

// เพิ่มบันทึกในกล่อง Log
// ทำไมใช้ createElement ไม่ใช่ innerHTML?
// → ต้องการ "append" (เพิ่มท้าย) ไม่ใช่ "replace" (แทนทั้งหมด)
// scrollTop = scrollHeight → เลื่อนลงล่างสุดอัตโนมัติ เหมือน Terminal ในโรงงาน
function addLog(type, message) {
  const logArea = document.getElementById('logArea');
  const now = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">[${now}]</span> <strong>[${type}]</strong> ${message}`;
  logArea.appendChild(entry);
  logArea.scrollTop = logArea.scrollHeight;
}

// --- ฟังก์ชันแปลงรหัสเป็นภาษาไทย ---
// ทำไมทำเป็นฟังก์ชันแยก? → ใช้ซ้ำได้หลายที่ เปลี่ยนคำแปลที่เดียวจบ

function getModeLabel(mode) {
  const labels = {
    'count': 'Count Links',
    'defect': 'Defect Detection',
    'both': 'Count + Defect'
  };
  return labels[mode] || mode;
}

function getStatusLabel(status) {
  const labels = {
    'pending': 'Pending',
    'running': 'Running',
    'completed': 'Finished',
    'stopped': 'Stopped',
    'emergency': 'Emergency Stop'
  };
  return labels[status] || status;
}

function getDefectLabel(defectType) {
  const labels = {
    'none': 'Pass',
    'scratch': 'Scratch',
    'crack': 'Crack',
    'rust': 'Rust',
    'deformation': 'Deformation',
    'mixed': 'Mixed Defects'
  };
  return labels[defectType] || defectType;
}

function getColorLabel(color) {
  const labels = {
    'red': 'Red',
    'blue': 'Blue',
    'green': 'Green',
    'yellow': 'Yellow',
    'white': 'White'
  };
  return labels[color] || color;
}

// แสดงกล่องแจ้งเตือน
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// ปุ่ม "จำลองผล AI" → สุ่มผลตรวจแล้วยิงเข้า API เหมือน YOLOv8 จริง
// มีไว้ให้อาจารย์/ลูกค้าทดสอบ flow ครบโดยไม่ต้องมี AI จริง
// สุ่มจาก 7 สถานการณ์: ผ่าน 3 อัน + ตำหนิ 4 แบบ
// ค่า confidence สุ่มระหว่าง 75%-100% / chain_count สุ่ม 5-24
async function simulateDetection() {
  if (!currentOrderId) {
    showToast('No order yet. Please create one from the Input page.', 'error');
    return;
  }

  const defectTypes = ['scratch', 'crack', 'rust', 'deformation'];
  const chainCount = Math.floor(Math.random() * 20) + 5;

  // 30% โอกาสเส้นปกติ (ไม่มี defect)
  // 70% โอกาสมี defect 1-3 จุดในเส้นเดียว
  const isPass = Math.random() < 0.3;
  const defects = [];
  let imagePath = '/images/demo_pass.svg';

  if (!isPass) {
    const numPoints = Math.floor(Math.random() * 3) + 1; // 1-3 จุด
    const usedLinks = new Set();
    for (let i = 0; i < numPoints; i++) {
      let link;
      do { link = Math.floor(Math.random() * chainCount) + 1; } while (usedLinks.has(link));
      usedLinks.add(link);
      const type = defectTypes[Math.floor(Math.random() * defectTypes.length)];
      defects.push({
        link_number: link,
        defect_type: type,
        defect_detail: `${type} detected at link #${link}`,
        confidence: parseFloat((Math.random() * 0.25 + 0.75).toFixed(3))
      });
    }
    const imgMap = {
      scratch: '/images/demo_detect_001.svg',
      crack: '/images/demo_crack.svg',
      rust: '/images/demo_rust.svg',
      deformation: '/images/demo_detect_001.svg'
    };
    imagePath = imgMap[defects[0].defect_type];
  }

  try {
    const res = await fetch('/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: currentOrderId,
        chain_count: chainCount,
        defects,
        image_path: imagePath
      })
    });

    const data = await res.json();
    if (data.success) {
      const msg = defects.length === 0
        ? 'AI Simulation: Pass ✓'
        : `AI Simulation: ${defects.length} defect point${defects.length > 1 ? 's' : ''} ✗`;
      showToast(msg, defects.length === 0 ? 'success' : 'error');
    }
  } catch (err) {
    showToast('AI Simulation failed', 'error');
    console.error(err);
  }
}

// --- เริ่มต้นหน้า Output ---
// 1) ตั้ง empty state ไว้ก่อน (ซ่อนข้อมูล โชว์ข้อความ "ยังไม่มีคำสั่ง")
// 2) โหลดข้อมูลล่าสุดจาก API → ถ้ามี order จะปิด empty state เอง
// 3) โหลดรายการ order ใส่ dropdown
setFirstUseState(true);
loadCurrentOutput();
loadOrdersList();
