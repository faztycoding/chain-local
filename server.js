// ============================================================
// Server หลักของระบบ Chain Counter
// ============================================================
// ไฟล์นี้คือ "สมอง" ของระบบทั้งหมดครับ ทำ 3 หน้าที่:
// 1) Web Server     → ส่งหน้า HTML ให้ Browser แสดงผล
// 2) API Server     → รับ-ส่งข้อมูลระหว่างหน้าเว็บ กับ ฐานข้อมูล
// 3) WebSocket      → ส่งข้อมูลแบบ Real-time ผ่าน Socket.io
//
// ทำไมต้องรวมไว้ไฟล์เดียว?
// → เพราะเป็น Prototype ขนาดเล็ก รวมไว้จัดการง่ายกว่า
//   ถ้าเป็นระบบใหญ่จริงๆ ควรแยกเป็น Microservice

// นำเข้า Library ที่จำเป็น
// express   → เฟรมเวิร์ค Web Server ยอดนิยมที่สุดของ Node.js
//              ทำไมใช้? เพราะสร้าง API ได้ง่าย เขียนสั้น เอกสารเยอะ
// http      → ต้องใช้สร้าง HTTP Server แยก เพราะ Socket.io ต้องการมัน
// socket.io → ส่งข้อมูล Real-time แบบ 2 ทาง (Server ↔ Browser)
//              ทำไมไม่ใช้ AJAX polling? เพราะ Socket.io เร็วกว่ามาก
//              Server "push" ข้อมูลไปหา Browser ได้เลย ไม่ต้องรอถาม
// cors      → อนุญาตให้โปรแกรมอื่น (เช่น Python AI) เรียก API ข้ามโดเมนได้
// better-sqlite3 → ฐานข้อมูลเป็นไฟล์เดียว ไม่ต้องติดตั้ง MySQL แยก
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database/init');

// สร้าง Express App + HTTP Server
// ทำไมต้อง http.createServer แยก?
// → ถ้าใช้แค่ app.listen() ปกติ Socket.io จะทำงานไม่ได้
//   เพราะ Socket.io ต้องการ HTTP Server โดยตรงเพื่อ Upgrade เป็น WebSocket
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // อนุญาตทุกโดเมน เพราะ AI อาจส่งมาจาก port อื่น
});

// เริ่มต้นฐานข้อมูล → สร้างตาราง + View อัตโนมัติถ้ายังไม่มี
const db = initDatabase();

function getCurrentOrder() {
  return db.prepare(`
    SELECT * FROM orders
    ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END,
             updated_at DESC,
             created_at DESC,
             id DESC
    LIMIT 1
  `).get() || null;
}

function getLatestInspectionForOrder(orderId) {
  if (!orderId) return null;

  return db.prepare(`
    SELECT * FROM inspection_results
    WHERE order_id = ?
    ORDER BY timestamp DESC, id DESC
    LIMIT 1
  `).get(orderId) || null;
}

// Middleware → ตัวกลางที่ทำงานก่อน Request จะถึง Route
// ทำไมต้องมี? เพราะ Express ต้องรู้วิธีอ่านข้อมูลก่อนจัดการ
// cors()           → ให้ AI (Python) หรือโปรแกรมอื่นเรียก API ได้
// express.json()   → แปลง JSON ที่ส่งมาเป็น Object ให้ใช้ใน req.body ได้
// express.static() → ให้ Browser เปิดไฟล์ HTML/CSS/JS ในโฟลเดอร์ public ได้โดยตรง
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// เมื่อเปิด http://localhost:3000/ ให้วิ่งไปหน้า Input อัตโนมัติ
// ทำไมต้องมี? เพราะเราไม่มีไฟล์ index.html ที่ root ถ้าไม่ redirect จะเจอ "Cannot GET /"
app.get('/', (req, res) => {
  res.redirect('/page1_input.html');
});

// ============================================================
// REST API Routes (เส้นทางรับ-ส่งข้อมูล)
// ============================================================
// API คืออะไร? → คือ "ประตู" ที่ให้หน้าเว็บ (หรือโปรแกรม AI) ส่งข้อมูลมาหา Server
// ใช้รูปแบบ RESTful:
//   GET    = ดึงข้อมูล (อ่าน)
//   POST   = สร้างข้อมูลใหม่
//   PATCH  = แก้ไขข้อมูลบางส่วน
//   DELETE = ลบข้อมูล (ยังไม่ได้ใช้ในโปรเจคนี้)

// --- คำสั่งตรวจสอบ (Orders) ---

// สร้างคำสั่งใหม่ → ถูกเรียกเมื่อกดปุ่ม "ส่งคำสั่งตรวจสอบ" บนหน้า Input
// Logic: รับข้อมูลจากฟอร์ม → บันทึกลง DB → แจ้งหน้า Output ผ่าน Socket.io
app.post('/api/orders', (req, res) => {
  try {
    const { mode, chain_size, chain_color, product_attribution } = req.body;

    if (!mode || !chain_size || !chain_color) {
      return res.status(400).json({ error: 'mode, chain_size, chain_color are required' });
    }

    const stmt = db.prepare(`
      INSERT INTO orders (mode, chain_size, chain_color, product_attribution)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(mode, chain_size, chain_color, product_attribution || '');

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);

    // ส่งข้อมูล Order ไปยัง "ทุกคน" ที่เปิดหน้าเว็บอยู่ ผ่าน Socket.io
    // ทำไมใช้ io.emit? → เพราะ emit = ส่งแบบ broadcast ทุก Browser ที่เชื่อมต่ออยู่จะได้รับ
    // ทำให้หน้า Output อัปเดตทันทีโดยไม่ต้อง Refresh หน้า
    io.emit('new_order', order);

    res.status(201).json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ดึงคำสั่งทั้งหมด → เรียงจากใหม่สุดก่อน
// ใช้ตอนไหน? → หน้า Input โหลดตาราง "คำสั่งล่าสุด"
app.get('/api/orders', (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ดึงคำสั่งเดียวตามรหัส
// :id คืออะไร? → คือ Parameter ในURL เช่น /api/orders/1 จะได้ id=1
// Express จะเก็บไว้ใน req.params.id ให้เราใช้
app.get('/api/orders/:id', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// อัปเดตสถานะคำสั่ง → ถูกเรียกเมื่อกดปุ่ม เริ่มทำงาน/หยุด/ฉุกเฉิน
// ทำไมใช้ PATCH ไม่ใช่ PUT?
// → PATCH = แก้แค่บางฟิลด์ (สถานะ) ส่วน PUT = แก้ทั้งก้อน
// → ประหยัดข้อมูลที่ส่ง เพราะส่งแค่ {status: "running"}
app.patch('/api/orders/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'running', 'completed', 'stopped', 'emergency'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    db.prepare(`
      UPDATE orders SET status = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
      WHERE id = ?
    `).run(status, req.params.id);

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // แจ้งทุกหน้าเว็บว่าสถานะเปลี่ยนแล้ว → หน้า Output จะเปลี่ยนสีสถานะทันที
    io.emit('order_status_changed', order);

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- จุดรับข้อมูลจาก AI (สำหรับ YOLOv8) ---
// นี่คือ API สำคัญที่สุดของระบบ!
// Flow: YOLOv8 ตรวจจับโซ่ → ส่ง JSON มาที่นี่ → Server เก็บ DB → ส่งไปหน้า Output
// ทำไมใช้ POST? → เพราะ AI "สร้าง" ข้อมูลใหม่ทุกครั้งที่ตรวจจับ
app.post('/api/detect', (req, res) => {
  try {
    const { order_id, chain_count, defect_type, defect_detail, confidence, image_path } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    // ตรวจสอบว่า Order มีอยู่จริงไหม → ป้องกัน AI ส่งมาผิด order_id
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // บันทึกผลตรวจจับลง DB
    // ทำไมต้องเก็บ? → เพื่อนำไปทำกราฟ/รายงาน/p-chart ภายหลัง
    // ใช้ ? (Parameterized Query) ป้องกัน SQL Injection
    const stmt = db.prepare(`
      INSERT INTO inspection_results (order_id, chain_count, defect_type, defect_detail, confidence, image_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      order_id,
      chain_count || 0,
      defect_type || 'none',
      defect_detail || '',
      confidence || 0.0,
      image_path || ''
    );

    // อัปเดตยอดรวมในคำสั่ง (จำนวนโซ่สะสม + จำนวนตำหนิสะสม)
    // ทำไมต้องอัปเดต? → เพื่อให้หน้า Output เห็นตัวเลขรวมได้เลยไม่ต้องนับใหม่
    // CASE WHEN คือ if-else ใน SQL → ถ้าเป็นตำหนิ +1 ถ้าไม่ใช่ +0
    const updateOrder = db.prepare(`
      UPDATE orders 
      SET total_chain_count = total_chain_count + ?,
          total_defect_count = total_defect_count + CASE WHEN ? != 'none' THEN 1 ELSE 0 END,
          updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
      WHERE id = ?
    `);
    updateOrder.run(chain_count || 0, defect_type || 'none', order_id);

    const inspection = db.prepare('SELECT * FROM inspection_results WHERE id = ?').get(result.lastInsertRowid);
    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);

    // ส่งผลตรวจจับไปยังทุกหน้าเว็บแบบ Real-time
    // ทำไมส่งทั้ง inspection + order? → เพราะหน้า Output ต้องการทั้ง:
    //   1) ผลตรวจจับล่าสุด (inspection) เพื่อแสดงรายละเอียด
    //   2) ข้อมูล Order ที่อัปเดตแล้ว (order) เพื่อแสดงยอดรวม
    io.emit('detection_result', {
      inspection,
      order: updatedOrder
    });

    res.status(201).json({ success: true, inspection, order: updatedOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- สถิติและรายงาน ---
// API กลุ่มนี้ดึงข้อมูลจาก View ในฐานข้อมูล
// View คืออะไร? → เหมือนตารางสำเร็จรูปที่คำนวณไว้ล่วงหน้า
//   ดึงมาใช้ได้เลย ไม่ต้องเขียน SQL ยาวๆ ทุกครั้ง

// สรุปรายวันสำหรับ QA Engineer
// ใช้ตอนไหน? → แท็บ "รายงานประจำวัน" ในหน้า Stats
app.get('/api/stats/daily', (req, res) => {
  try {
    const data = db.prepare('SELECT * FROM daily_qa_summary').all();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/weekly', (req, res) => {
  try {
    const data = db.prepare(`
      SELECT
        strftime('%Y-W%W', ir.timestamp) AS report_week,
        MIN(DATE(ir.timestamp)) AS week_start_date,
        MAX(DATE(ir.timestamp)) AS week_end_date,
        COUNT(*) AS total_inspections,
        SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS defect_count,
        COUNT(*) - SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS pass_count,
        ROUND(CAST(SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) AS defect_rate_percent,
        ROUND(AVG(ir.confidence) * 100, 2) AS avg_confidence_percent,
        SUM(ir.chain_count) AS total_chains_counted
      FROM inspection_results ir
      GROUP BY strftime('%Y-W%W', ir.timestamp)
      ORDER BY report_week DESC
    `).all();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/monthly', (req, res) => {
  try {
    const data = db.prepare(`
      SELECT
        strftime('%Y-%m', ir.timestamp) AS report_month,
        COUNT(*) AS total_inspections,
        SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS defect_count,
        COUNT(*) - SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS pass_count,
        ROUND(CAST(SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) AS defect_rate_percent,
        ROUND(AVG(ir.confidence) * 100, 2) AS avg_confidence_percent,
        SUM(ir.chain_count) AS total_chains_counted
      FROM inspection_results ir
      GROUP BY strftime('%Y-%m', ir.timestamp)
      ORDER BY report_month DESC
    `).all();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ข้อมูลสำหรับกราฟ p-Chart (กราฟควบคุมคุณภาพ)
// p-Chart คืออะไร? → กราฟที่ใช้ในงาน QA จริง ดูว่าสัดส่วนของเสียอยู่ในเกณฑ์ไหม
app.get('/api/stats/pchart', (req, res) => {
  try {
    const data = db.prepare('SELECT * FROM pchart_data').all();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ข้อมูลทั้งหมดแบบ Flat Table → สำหรับส่งออกไป Power BI
// ทำไมต้อง Flat? → Power BI ชอบตารางแบน ที่มีทุกคอลัมน์อยู่ในตารางเดียว
//   ดึงไปทำ Dashboard ได้ทันที ไม่ต้องเขียนสูตร JOIN เพิ่ม
app.get('/api/stats/export', (req, res) => {
  try {
    const data = db.prepare('SELECT * FROM power_bi_inspection_summary').all();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// สรุปตำหนิแยกตามสีโซ่ → ใช้แสดงกราฟแท่งในหน้า Stats
// ทำไมต้องแยกตามสี? → เพราะแต่ละสีโซ่สะท้อนแสงต่างกัน
//   ทำให้ AI ตรวจจับได้แม่นยำไม่เท่ากัน ข้อมูลนี้ช่วยเช็ค Accuracy
app.get('/api/stats/defect-by-color', (req, res) => {
  try {
    const data = db.prepare(`
      SELECT 
        o.chain_color,
        COUNT(*) AS total_inspections,
        SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS defect_count,
        ROUND(CAST(SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) AS defect_rate_percent
      FROM inspection_results ir
      JOIN orders o ON ir.order_id = o.id
      GROUP BY o.chain_color
    `).all();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ประวัติการตรวจสอบล่าสุด → แท็บ "ประวัติการตรวจสอบ" ในหน้า Stats
// ใช้ query parameter ?limit=100 เพื่อจำกัดจำนวนแถว
// ทำไมต้องจำกัด? → ถ้าข้อมูลเยอะมาก ดึงทั้งหมดจะช้า
app.get('/api/stats/history', (req, res) => {
  try {
    const limit = req.query.limit || 100;
    const data = db.prepare(`
      SELECT * FROM power_bi_inspection_summary LIMIT ?
    `).all(limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/output/current', (req, res) => {
  try {
    const order = getCurrentOrder();
    const inspection = order ? getLatestInspectionForOrder(order.id) : null;
    res.json({ order, inspection });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// การเชื่อมต่อ Socket.io
// ============================================================
// Socket.io ทำงานยังไง?
// 1) Browser เปิดหน้า Output → เชื่อมต่อ Socket มาที่ Server
// 2) Server รู้ว่ามีใครเชื่อมต่อ → เก็บ socket ไว้
// 3) เมื่อมีข้อมูลใหม่ → Server ส่ง (emit) ไปหาทุกคนทันที
// ต่างจาก AJAX ยังไง?
// → AJAX = Browser ต้องถาม Server ซ้ำๆ (polling) เสียเวลา+ทรัพยากร
// → Socket.io = Server ส่งมาเอง ทันที ไม่ต้องถาม

io.on('connection', (socket) => {
  console.log(`🔌 เชื่อมต่อใหม่: ${socket.id}`);

  const currentOrder = getCurrentOrder();
  if (currentOrder) {
    socket.emit('new_order', currentOrder);

    const latestInspection = getLatestInspectionForOrder(currentOrder.id);
    if (latestInspection) {
      socket.emit('detection_result', {
        inspection: latestInspection,
        order: currentOrder
      });
    }
  }

  socket.on('disconnect', () => {
    console.log(`❌ หลุดการเชื่อมต่อ: ${socket.id}`);
  });
});

// ============================================================
// เริ่มต้น Server
// ============================================================
// process.env.PORT → อ่าน Port จากตัวแปรสภาพแวดล้อม (ถ้ามี)
// || 3000          → ถ้าไม่มีก็ใช้ 3000 เป็นค่าเริ่มต้น
// ทำไมต้องทำแบบนี้? → เพื่อให้ยืดหยุ่น เปลี่ยน Port ได้โดยไม่ต้องแก้โค้ด

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(55));
  console.log('  🔗 ระบบนับข้อโซ่ & ตรวจจับตำหนิด้วย AI');
  console.log('='.repeat(55));
  console.log(`  📋 หน้าสั่งงาน:   http://localhost:${PORT}/page1_input.html`);
  console.log(`  🖥️  หน้าควบคุม:  http://localhost:${PORT}/page2_output.html`);
  console.log(`  📊 หน้าสถิติ:    http://localhost:${PORT}/page3_stats.html`);
  console.log(`  🤖 AI Endpoint: POST http://localhost:${PORT}/api/detect`);
  console.log('='.repeat(55));
  console.log('');
});
