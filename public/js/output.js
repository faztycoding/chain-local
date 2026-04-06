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

// รับคำสั่งใหม่จากหน้า Input (ผ่าน Socket.io)
// ทำไมไม่ใช้ API ดึงข้อมูล?
// → Socket.io เป็นแบบ "push" Server ส่งข้อมูลมาหาเราเอง
//   ไม่ต้องคอยถามซ้ำๆ (polling) เร็วกว่าและไม่เปลืองทรัพยากร
socket.on('new_order', (order) => {
  currentOrderId = order.id;
  addLog('คำสั่ง', `รับคำสั่งใหม่: #${order.id} | โหมด: ${order.mode} | ขนาด: ${order.chain_size} | สี: ${order.chain_color}`);
  updateOrderDisplay(order);
  showToast(`รับคำสั่งใหม่ #${order.id} แล้ว!`, 'success');
});

// รับการเปลี่ยนสถานะ (เมื่อกดปุ่ม เริ่ม/หยุด/ฉุกเฉิน)
socket.on('order_status_changed', (order) => {
  if (order.id === currentOrderId) {
    updateOrderDisplay(order);
    updateSystemStatus(order.status);
    addLog('สถานะ', `คำสั่ง #${order.id} เปลี่ยนสถานะเป็น: ${order.status.toUpperCase()}`);
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

    // อัปเดตจำนวนข้อโซ่สะสม
    document.getElementById('chainCount').textContent = order.total_chain_count;

    // อัปเดตสถานะการตรวจจับ → เปลี่ยนสีตามผล (เขียว=ปกติ, แดง=ตำหนิ)
    const detStatus = document.getElementById('detectionStatus');
    if (inspection.defect_type === 'none') {
      detStatus.textContent = 'ไม่พบตำหนิ';
      detStatus.className = 'value green';
    } else {
      detStatus.textContent = 'พบตำหนิ!';
      detStatus.className = 'value red';
    }

    // อัปเดตพาเนลผล AI
    document.getElementById('defectType').textContent = inspection.defect_type === 'none' ? 'โซ่ปกติ' : inspection.defect_type;
    document.getElementById('confidence').textContent = (inspection.confidence * 100).toFixed(1) + '%';
    document.getElementById('detectedLink').textContent = inspection.chain_count > 0 ? inspection.chain_count + ' ข้อ' : '-';
    document.getElementById('defectDetail').textContent = inspection.defect_detail || '-';
    document.getElementById('lastUpdated').textContent = inspection.timestamp;

    // อัปเดตรูปภาพถ้าฝั่ง AI ส่ง path มา
    if (inspection.image_path) {
      document.getElementById('aiImage').src = inspection.image_path;
      document.getElementById('aiImage').style.display = 'block';
      document.getElementById('aiImagePlaceholder').style.display = 'none';
    }

    // อัปเดตจำนวนตำหนิสะสม
    document.getElementById('orderDefects').textContent = order.total_defect_count;

    // เพิ่มบันทึกใน Log
    const logType = inspection.defect_type === 'none' ? 'ผ่าน' : 'ตำหนิ';
    addLog(logType, `จำนวน: ${inspection.chain_count} | ประเภท: ${inspection.defect_type} | ความมั่นใจ: ${(inspection.confidence * 100).toFixed(1)}%`);
  }
});

// อัปเดตพาเนลข้อมูลคำสั่งปัจจุบัน
// เปิดพาเนลที่ซ่อนไว้ (display:none) และเติมข้อมูลทุกช่อง
function updateOrderDisplay(order) {
  document.getElementById('orderPanel').style.display = 'block';
  document.getElementById('orderId').textContent = '#' + order.id;
  document.getElementById('orderMode').textContent = getModeLabel(order.mode);
  document.getElementById('orderSize').textContent = order.chain_size;
  document.getElementById('orderColor').textContent = order.chain_color;
  document.getElementById('orderAttribution').textContent = order.product_attribution || '-';
  document.getElementById('orderDefects').textContent = order.total_defect_count;
  document.getElementById('chainCount').textContent = order.total_chain_count;
  updateSystemStatus(order.status);
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
      addLog('ควบคุม', `ส่งคำสั่ง ${status.toUpperCase()} สำหรับคำสั่ง #${currentOrderId}`);
      showToast(`ระบบ ${status.toUpperCase()}`, status === 'running' ? 'success' : 'error');
    }
  } catch (err) {
    showToast('ส่งคำสั่งไม่สำเร็จ', 'error');
    console.error(err);
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

// แปลงรหัสโหมดเป็นภาษาไทย
function getModeLabel(mode) {
  const labels = {
    'count': 'นับข้อโซ่',
    'defect': 'ตรวจจับตำหนิ',
    'both': 'นับข้อ + ตรวจตำหนิ'
  };
  return labels[mode] || mode;
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
