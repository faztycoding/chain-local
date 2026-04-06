// ============================================================
// หน้า Input - ลอจิกฟอร์มสั่งงานตรวจสอบ
// ============================================================
// ไฟล์นี้ทำหน้าที่จัดการทุกอย่างบนหน้า Input:
// 1) รับข้อมูลจากฟอร์ม (โหมด/ขนาด/สี/รายละเอียด)
// 2) ส่งไป Server ผ่าน API (POST /api/orders)
// 3) แสดงตารางคำสั่งทั้งหมด
// 4) รับแจ้งเตือนจาก Socket.io เมื่อมี Order ใหม่

// สร้างการเชื่อมต่อ Socket.io
// ทำไมต้องใช้ Socket.io ที่หน้า Input ด้วย?
// → เพราะต้องการให้หน้า Output รู้ทันทีว่ามี Order ใหม่
//   โดยไม่ต้อง Refresh หน้า
const socket = io();

// ฟังเหตุการณ์เชื่อมต่อสำเร็จ → เอาไว้ debug
socket.on('connect', () => {
  console.log('เชื่อมต่อ Server สำเร็จ');
});

// จัดการเมื่อกดปุ่ม "ส่งคำสั่งตรวจสอบ"
// ทำไมใช้ addEventListener แทน onclick ใน HTML?
// → เพราะแยก Logic (JS) ออกจากหน้าตา (HTML) ทำให้โค้ดสะอาดขึ้น
//   และสามารถใส่ Event ได้หลายตัวบน Element เดียวกัน
document.getElementById('orderForm').addEventListener('submit', async (e) => {
  // e.preventDefault() สำคัญมาก!
  // ทำไมต้องมี? → ถ้าไม่มี ฟอร์มจะ Submit แบบปกติ (รีเฟรชหน้า)
  //   แต่เราต้องการส่งผ่าน JS (AJAX) แทน เพื่อไม่ให้หน้ากระตุก
  e.preventDefault();

  // ดึงค่าจากฟอร์ม → .value คือค่าที่ผู้ใช้เลือก/กรอกไว้
  const mode = document.getElementById('mode').value;
  const chain_size = document.getElementById('chain_size').value;
  const chain_color = document.getElementById('chain_color').value;
  const product_attribution = document.getElementById('product_attribution').value;

  // Validation ฝั่ง Client
  // ทำไมต้องเช็คทั้งที่ HTML มี required แล้ว?
  // → เพราะ required ข้ามได้ง่ายผ่าน DevTools จึงต้องเช็คซ้ำใน JS ด้วย
  if (!mode || !chain_size || !chain_color) {
    showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบ', 'error');
    return;
  }

  try {
    // ส่งข้อมูลไป Server ผ่าน fetch API
    // ทำไมใช้ fetch ไม่ใช่ axios?
    // → fetch เป็น API มาตรฐานของ Browser ไม่ต้องลง Library เพิ่ม
    //   ส่งเป็น JSON เพราะ Server (Express) ถูกตั้งค่าให้รับ JSON
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, chain_size, chain_color, product_attribution })
    });

    const data = await res.json();

    if (data.success) {
      showToast(`คำสั่ง #${data.order.id} สร้างสำเร็จแล้ว!`, 'success');
      document.getElementById('orderForm').reset(); // เคลียร์ฟอร์มเพื่อกรอกใหม่
      loadOrders(); // โหลดตารางใหม่เพื่อแสดงคำสั่งที่เพิ่งสร้าง
    } else {
      showToast(data.error || 'สร้างคำสั่งไม่สำเร็จ', 'error');
    }
  } catch (err) {
    showToast('เชื่อมต่อ Server ไม่ได้', 'error');
    console.error(err);
  }
});

// โหลดรายการคำสั่งทั้งหมดจาก Server มาแสดงในตาราง
// ทำไมใช้ async/await?
// → เพราะ fetch เป็น Asynchronous (ไม่ได้ผลทันที ต้องรอ)
//   async/await ทำให้เขียนโค้ดที่"รอ" ได้อ่านง่ายเหมือนโค้ดปกติ
async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();
    const tbody = document.getElementById('ordersTable');

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#aaa; padding:20px;">ยังไม่มีคำสั่งตรวจสอบ</td></tr>';
      return;
    }

    // ใช้ .map() แปลงแต่ละ Order เป็นแถว HTML
    // ทำไมใช้ .map()? → เพราะสั้นกว่า for loop และได้ Array ใหม่กลับมา
    // ทำไมต้อง .join('')? → เพราะ .map() คืน Array แต่ innerHTML ต้องการ String
    tbody.innerHTML = orders.map(o => `
      <tr>
        <td>#${o.id}</td>
        <td>${getModeLabel(o.mode)}</td>
        <td>${o.chain_size}</td>
        <td>${o.chain_color}</td>
        <td>${o.product_attribution || '-'}</td>
        <td><span class="badge ${o.status === 'running' ? 'badge-pass' : o.status === 'completed' ? 'badge-pass' : 'badge-defect'}">${o.status.toUpperCase()}</span></td>
        <td>${o.created_at}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('โหลดรายการคำสั่งไม่สำเร็จ:', err);
  }
}

// แปลงรหัสโหมดเป็นภาษาไทยที่อ่านง่าย
// ทำไมทำเป็นฟังก์ชันแยก? → เพราะใช้ซ้ำได้หลายที่ ทั้งหน้า Input และ Output
function getModeLabel(mode) {
  const labels = {
    'count': 'นับข้อโซ่',
    'defect': 'ตรวจจับตำหนิ',
    'both': 'นับข้อ + ตรวจตำหนิ'
  };
  return labels[mode] || mode;
}

// แสดงกล่องแจ้งเตือน (Toast) ที่มุมบนขวา
// ทำไมใช้ setTimeout? → เพื่อให้ Toast หายไปเองหลัง 3 วินาที
// parameter 'type' กำหนดสี Toast (success=เขียว, error=แดง)
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// ฟังจาก Socket.io เมื่อมี Order ใหม่ (จาก Client อื่น)
// ทำไมต้องมี? → ถ้ามีคนเปิดหน้า Input หลายเครื่อง ตารางจะอัปเดตทุกเครื่อง
socket.on('new_order', (order) => {
  loadOrders();
});

// โหลดรายการคำสั่งครั้งแรกตอนเปิดหน้า
// ทำไมต้องเรียกตรงนี้? → เพราะเมื่อเปิดหน้า ตารางยังว่าง
//   ต้องดึงข้อมูลจาก Server มาแสดงก่อน
loadOrders();
