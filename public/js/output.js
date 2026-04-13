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

// เมื่อเชื่อมต่อ Server ได้ → สถานะกล้องเป็นสีเขียว "เชื่อมต่อแล้ว"
socket.on('connect', () => {
  addLog('ระบบ', 'เชื่อมต่อ Server สำเร็จ');
  document.getElementById('cameraStatus').textContent = 'เชื่อมต่อแล้ว';
  document.getElementById('cameraStatus').className = 'value green';
});

// หลุดการเชื่อมต่อ → สถานะเป็นสีแดง "ขาดการเชื่อมต่อ"
socket.on('disconnect', () => {
  addLog('ระบบ', 'ขาดการเชื่อมต่อกับ Server');
  document.getElementById('cameraStatus').textContent = 'ขาดการเชื่อมต่อ';
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
    select.innerHTML = '<option value="">-- เลือกคำสั่ง --</option>' +
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
    updateOrderDisplay(data.order);
    if (data.inspection) {
      updateInspectionDisplay(data.inspection, data.order);
    } else {
      document.getElementById('defectType').textContent = 'ยังไม่มีผลตรวจ';
      document.getElementById('confidence').textContent = '-';
      document.getElementById('detectedLink').textContent = '-';
      document.getElementById('defectDetail').textContent = '-';
      document.getElementById('lastUpdated').textContent = '-';
      document.getElementById('aiImage').style.display = 'none';
      document.getElementById('aiImagePlaceholder').style.display = 'block';
    }
    addLog('เลือกคำสั่ง', `สลับไปดูคำสั่ง #${orderId}`);
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
  addLog('คำสั่ง', `รับคำสั่งใหม่: #${order.id} | โหมด: ${getModeLabel(order.mode)} | ขนาด: ${order.chain_size} | สี: ${getColorLabel(order.chain_color)}`);
  updateOrderDisplay(order);
  loadOrdersList();
  showToast(`รับคำสั่งใหม่ #${order.id} แล้ว!`, 'success');
});

// รับการเปลี่ยนสถานะ (เมื่อกดปุ่ม เริ่ม/หยุด/ฉุกเฉิน)
socket.on('order_status_changed', (order) => {
  if (order.id === currentOrderId) {
    updateOrderDisplay(order);
    updateSystemStatus(order.status);
    addLog('สถานะ', `คำสั่ง #${order.id} เปลี่ยนสถานะเป็น: ${getStatusLabel(order.status)}`);
  }
});

// รับผลตรวจจับจาก AI (Real-time จาก YOLOv8)
// นี่คือ Event สำคัญที่สุด!
// Flow: YOLOv8 ส่ง JSON ไป POST /api/detect → Server เก็บ DB + emit มาที่นี่
socket.on('detection_result', (data) => {
  // Destructuring → ดึงข้อมูลออกจาก Object
  // ทำไมใช้? → สั้นกว่าเขียน data.inspection / data.order ทุกครั้ง
  const { inspection, order } = data;

  // เช็คว่าเป็น Order ที่แสดงอยู่ หรือยังไม่มี Order (รับทั้งหมด)
  if (order.id === currentOrderId || !currentOrderId) {
    currentOrderId = order.id;
    updateOrderDisplay(order);
    updateInspectionDisplay(inspection, order);

    // เพิ่มบันทึกใน Log
    const logType = inspection.defect_type === 'none' ? 'ผ่าน' : 'ตำหนิ';
    addLog(logType, `จำนวน: ${inspection.chain_count} | ประเภท: ${getDefectLabel(inspection.defect_type)} | ความมั่นใจ: ${(inspection.confidence * 100).toFixed(1)}%`);
  }
});

// อัปเดตพาเนลข้อมูลคำสั่งปัจจุบัน
// เปิดพาเนลที่ซ่อนไว้ (display:none) และเติมข้อมูลทุกช่อง
function updateOrderDisplay(order) {
  setFirstUseState(false);
  document.getElementById('orderId').textContent = '#' + order.id;
  document.getElementById('orderMode').textContent = getModeLabel(order.mode);
  document.getElementById('orderSize').textContent = order.chain_size;
  document.getElementById('orderColor').textContent = getColorLabel(order.chain_color);
  document.getElementById('orderAttribution').textContent = order.product_attribution || '-';
  document.getElementById('orderDefects').textContent = order.total_defect_count;
  document.getElementById('chainCount').textContent = order.total_chain_count;
  updateSystemStatus(order.status);
}

// อัปเดตส่วน "ผลการตรวจจับจาก AI" ทั้งหมด
// ใส่: สถานะตรวจจับ, ประเภทตำหนิ, ความมั่นใจ, รูปภาพ, เวลา
// ถ้ามีรูป → โชว์รูป / ถ้าไม่มี → โชว์ placeholder
function updateInspectionDisplay(inspection, order) {
  document.getElementById('chainCount').textContent = order.total_chain_count;

  const detStatus = document.getElementById('detectionStatus');
  if (inspection.defect_type === 'none') {
    detStatus.textContent = 'ไม่พบตำหนิ';
    detStatus.className = 'value green';
  } else {
    detStatus.textContent = 'พบตำหนิ!';
    detStatus.className = 'value red';
  }

  document.getElementById('defectType').textContent = inspection.defect_type === 'none' ? 'โซ่ปกติ' : getDefectLabel(inspection.defect_type);
  document.getElementById('confidence').textContent = (inspection.confidence * 100).toFixed(1) + '%';
  document.getElementById('detectedLink').textContent = inspection.chain_count > 0 ? inspection.chain_count + ' ข้อ' : '-';
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

  document.getElementById('orderDefects').textContent = order.total_defect_count;
}

// อัปเดตสถานะระบบบนการ์ดสถานะ
// ทำไมใช้ switch-case ไม่ใช่ if-else?
// → อ่านง่ายกว่าเมื่อมีหลายสถานะที่ต้องจัดการต่างกัน
function updateSystemStatus(status) {
  const sysStatus = document.getElementById('systemStatus');
  const chainStatus = document.getElementById('chainStatus');

  switch (status) {
    case 'running':
      sysStatus.textContent = 'กำลังทำงาน';
      sysStatus.className = 'value green';
      chainStatus.textContent = 'กำลังทำงาน';
      chainStatus.className = 'value green';
      break;
    case 'stopped':
      sysStatus.textContent = 'หยุดทำงาน';
      sysStatus.className = 'value red';
      chainStatus.textContent = 'หยุดทำงาน';
      chainStatus.className = 'value orange';
      break;
    case 'emergency':
      sysStatus.textContent = 'หยุดฉุกเฉิน';
      sysStatus.className = 'value red';
      chainStatus.textContent = 'หยุดฉุกเฉิน';
      chainStatus.className = 'value red';
      break;
    case 'completed':
      sysStatus.textContent = 'เสร็จสิ้น';
      sysStatus.className = 'value blue';
      chainStatus.textContent = 'เสร็จสิ้น';
      chainStatus.className = 'value blue';
      break;
    default:
      sysStatus.textContent = 'รอดำเนินการ';
      sysStatus.className = 'value orange';
      chainStatus.textContent = 'รอคำสั่ง';
      chainStatus.className = 'value orange';
  }
}

// ปุ่มควบคุม (Mockup Logic)
// ทำไมเป็น Mockup? → เพราะเป็นแค่ Prototype ยังไม่ได้เชื่อมเครื่องจักรจริง
//   แค่เปลี่ยนสถานะใน DB + หน้าจอเท่านั้น
// ใช้ PATCH ไม่ใช่ PUT? → เพราะแก้แค่บางฟิลด์ (สถานะ) ไม่ใช่แก้ทั้งก้อน
async function controlAction(status) {
  if (!currentOrderId) {
    showToast('ยังไม่มีคำสั่ง กรุณาสร้างคำสั่งจากหน้า Input ก่อน', 'error');
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
      addLog('ควบคุม', `ส่งคำสั่ง ${getStatusLabel(status)} สำหรับคำสั่ง #${currentOrderId}`);
      showToast(`สถานะระบบ: ${getStatusLabel(status)}`, status === 'running' ? 'success' : 'error');
    }
  } catch (err) {
    showToast('ส่งคำสั่งไม่สำเร็จ', 'error');
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
    updateOrderDisplay(data.order);

    if (data.inspection) {
      updateInspectionDisplay(data.inspection, data.order);
    }
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
    'count': 'นับข้อโซ่',
    'defect': 'ตรวจจับตำหนิ',
    'both': 'นับข้อ + ตรวจตำหนิ'
  };
  return labels[mode] || mode;
}

function getStatusLabel(status) {
  const labels = {
    'pending': 'รอดำเนินการ',
    'running': 'กำลังทำงาน',
    'completed': 'เสร็จสิ้น',
    'stopped': 'หยุดทำงาน',
    'emergency': 'หยุดฉุกเฉิน'
  };
  return labels[status] || status;
}

function getDefectLabel(defectType) {
  const labels = {
    'none': 'ผ่าน',
    'scratch': 'รอยขีดข่วน',
    'crack': 'รอยร้าว',
    'rust': 'สนิม',
    'deformation': 'รูปทรงผิดปกติ'
  };
  return labels[defectType] || defectType;
}

function getColorLabel(color) {
  const labels = {
    'silver': 'เงิน',
    'gold': 'ทอง',
    'black': 'ดำ',
    'red': 'แดง',
    'blue': 'น้ำเงิน',
    'green': 'เขียว'
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
    showToast('ยังไม่มีคำสั่ง กรุณาสร้างคำสั่งจากหน้า Input ก่อน', 'error');
    return;
  }

  const scenarios = [
    { defect_type: 'none', defect_detail: '', image_path: '/images/demo_pass.svg' },
    { defect_type: 'none', defect_detail: '', image_path: '/images/demo_pass.svg' },
    { defect_type: 'none', defect_detail: '', image_path: '/images/demo_pass.svg' },
    { defect_type: 'scratch', defect_detail: 'รอยขีดข่วนที่ผิวข้อโซ่', image_path: '/images/demo_detect_001.svg' },
    { defect_type: 'crack', defect_detail: 'รอยร้าวขนาดเล็กบริเวณข้อต่อ', image_path: '/images/demo_crack.svg' },
    { defect_type: 'rust', defect_detail: 'สนิมเกาะบนผิวโซ่', image_path: '/images/demo_rust.svg' },
    { defect_type: 'deformation', defect_detail: 'ข้อโซ่บิดงอผิดรูป', image_path: '/images/demo_detect_001.svg' },
  ];

  const pick = scenarios[Math.floor(Math.random() * scenarios.length)];
  const chainCount = Math.floor(Math.random() * 20) + 5;
  const confidence = (Math.random() * 0.25 + 0.75).toFixed(3);

  try {
    const res = await fetch('/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: currentOrderId,
        chain_count: chainCount,
        defect_type: pick.defect_type,
        defect_detail: pick.defect_detail,
        confidence: parseFloat(confidence),
        image_path: pick.image_path
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`จำลองผล AI สำเร็จ: ${pick.defect_type === 'none' ? 'ผ่าน ✓' : getDefectLabel(pick.defect_type) + ' ✗'}`, pick.defect_type === 'none' ? 'success' : 'error');
    }
  } catch (err) {
    showToast('จำลองผล AI ไม่สำเร็จ', 'error');
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
