// ============================================================
// การเริ่มต้นฐานข้อมูล (Database Initialization)
// ============================================================
// ไฟล์นี้ทำหน้าที่สร้างตารางและ View ทั้งหมดในฐานข้อมูล
//
// ทำไมใช้ SQLite?
// → เป็นไฟล์เดียว (chain_data.db) ไม่ต้องติดตั้ง MySQL/PostgreSQL แยก
// → ก็อปไฟล์ chain_data.db ไปวางในเครื่องโรงงานก็ใช้ได้ทันที
// → Power BI สามารถเชื่อมต่อไฟล์นี้ดึงข้อมูลไปทำกราฟได้เลย
//
// ทำไมใช้ better-sqlite3 ไม่ใช่ sqlite3 ธรรมดา?
// → better-sqlite3 เป็นแบบ Synchronous (ทำงานทีละบรรทัด) เขียนง่ายและเร็วกว่า
// → sqlite3 เป็นแบบ Callback เขียนยากกว่าและช้ากว่า

const Database = require('better-sqlite3');
const path = require('path');

function initDatabase() {
  // สร้าง path ไปยังไฟล์ฐานข้อมูล
  // __dirname = โฟลเดอร์ที่ไฟล์นี้อยู่ (database/)
  // '..' = กลับขึ้นไป 1 ชั้น (โฟลเดอร์หลัก) เพื่อวาง chain_data.db ตรง root
  const dbPath = path.join(__dirname, '..', 'chain_data.db');
  const db = new Database(dbPath);

  // เปิดโหมด WAL (Write-Ahead Logging)
  // ทำไมต้องเปิด? → WAL ทำให้อ่านและเขียนพร้อมกันได้
  //   โหมดปกติจะ Lock ไฟล์ทั้งหมดตอนเขียน ทำให้อ่านไม่ได้
  //   แต่ WAL เขียนไปไฟล์แยก (.db-wal) ทำให้ไม่ Lock
  db.pragma('journal_mode = WAL');

  // สร้างตาราง orders (คำสั่งตรวจสอบ)
  // เก็บ: โหมดการทำงาน, ขนาดโซ่, สีโซ่, สถานะ, ยอดรวม
  //
  // อธิบาย Logic แต่ละบรรทัด:
  // - AUTOINCREMENT → สร้างรหัสเพิ่มทีละ 1 อัตโนมัติ ไม่ซ้ำกัน
  // - NOT NULL      → ห้ามเป็นค่าว่าง บังคับให้กรอก
  // - CHECK()       → กำหนดค่าที่ยอมรับ ป้องกันข้อมูลผิดปกติในระดับ DB
  // - DEFAULT       → ค่าเริ่มต้น ไม่ต้องส่งทุกค่าทุกครั้ง
  // - strftime()    → สร้าง timestamp อัตโนมัติ รูปแบบ YYYY-MM-DD HH:MM:SS
  //                    ทำไมรูปแบบนี้? → เพราะ Power BI อ่านได้ทันที
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('count', 'defect', 'both')),
      chain_size TEXT NOT NULL,
      chain_color TEXT NOT NULL,
      product_attribution TEXT,
      total_chain_count INTEGER DEFAULT 0,
      total_defect_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'stopped', 'emergency')),
      created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
    );
  `);

  // สร้างตาราง inspection_results (ผลการตรวจสอบ)
  // เก็บผลจาก AI ทุกครั้งที่ตรวจจับ
  //
  // อธิบาย Logic:
  // - FOREIGN KEY  → เชื่อมโยงกับตาราง orders ทำให้รู้ว่าผลนี้เป็นของ Order ไหน
  //                   ต้องมี order_id ที่มีอยู่จริง ไม่งั้น DB จะไม่ยอมบันทึก
  // - timestamp    → เวลาที่ตรวจจับ รูปแบบ YYYY-MM-DD HH:MM:SS
  //                   ทำไมต้องมี timestamp? → Power BI ต้องการเวลาที่ชัดเจน
  // - confidence   → ค่าความมั่นใจ 0.0-1.0 จาก AI
  //                   ทำไมเก็บ? → เพื่อดูว่า AI มั่นใจแค่ไหน ใช้วิเคราะห์ Accuracy
  db.exec(`
    CREATE TABLE IF NOT EXISTS inspection_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      timestamp TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
      chain_count INTEGER DEFAULT 0,
      defect_type TEXT DEFAULT 'none',
      defect_detail TEXT,
      confidence REAL DEFAULT 0.0,
      image_path TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
  `);

  // สร้าง View #1: ตารางแบน (Flat Table) สำหรับ Power BI
  //
  // View คืออะไร?
  // → เหมือนตารางสำเร็จรูป สร้างจากคำสั่ง SQL
  // → ไม่ได้เก็บข้อมูลจริง แค่คำนวณใหม่ทุกครั้งที่เรียก
  //
  // ทำไมต้องทำ Flat?
  // → Power BI ชอบตารางแบนที่มีทุกคอลัมน์อยู่ในตารางเดียว
  // → น้องเอาไปทำกราฟได้ทันทีไม่ต้องเขียนสูตร JOIN เพิ่ม
  //
  // Logic ของ SQL:
  // - JOIN       → รวม 2 ตารางเข้าด้วยกัน (ผลตรวจจับ + คำสั่ง)
  // - CASE WHEN  → if-else ใน SQL แปลงตำหนิเป็น 1/0
  // - DATE/TIME  → แยก timestamp ออกเป็นวันที่และเวลา สะดวกกรองข้อมูล
  db.exec(`
    CREATE VIEW IF NOT EXISTS power_bi_inspection_summary AS
    SELECT 
      ir.id AS inspection_id,
      ir.order_id,
      o.mode,
      o.chain_size,
      o.chain_color,
      o.product_attribution,
      ir.timestamp,
      DATE(ir.timestamp) AS inspection_date,
      TIME(ir.timestamp) AS inspection_time,
      ir.chain_count,
      ir.defect_type,
      ir.defect_detail,
      ir.confidence,
      ir.image_path,
      o.status AS order_status,
      CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END AS is_defect,
      o.total_chain_count,
      o.total_defect_count
    FROM inspection_results ir
    JOIN orders o ON ir.order_id = o.id
    ORDER BY ir.timestamp DESC;
  `);

  // สร้าง View #2: สรุปรายวันสำหรับ QA Engineer
  //
  // Logic ของ SQL:
  // - GROUP BY  → รวมข้อมูลตามวันที่+สี+ขนาด+โหมด เป็นแถวเดียว
  //              เช่น วันนี้+โซ่เงิน+10มม+ทั้งสองอย่าง = 1 แถว
  // - COUNT(*)  → นับจำนวนทั้งหมดในกลุ่ม
  // - SUM(CASE WHEN ...) → นับเฉพาะตำหนิ (defect_type != 'none' = 1)
  // - ROUND()   → ปัดทศนิยม 2 ตำแหน่ง
  // - AVG()     → หาค่าเฉลี่ยความมั่นใจ
  db.exec(`
    CREATE VIEW IF NOT EXISTS daily_qa_summary AS
    SELECT 
      DATE(ir.timestamp) AS report_date,
      o.chain_color,
      o.chain_size,
      o.mode,
      COUNT(*) AS total_inspections,
      SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS defect_count,
      COUNT(*) - SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS pass_count,
      ROUND(CAST(SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) AS defect_rate_percent,
      ROUND(AVG(ir.confidence) * 100, 2) AS avg_confidence_percent,
      SUM(ir.chain_count) AS total_chains_counted
    FROM inspection_results ir
    JOIN orders o ON ir.order_id = o.id
    GROUP BY DATE(ir.timestamp), o.chain_color, o.chain_size, o.mode
    ORDER BY report_date DESC;
  `);

  // สร้าง View #3: ข้อมูลสำหรับ p-Chart (กราฟควบคุมคุณภาพ)
  //
  // p-Chart คืออะไร?
  // → กราฟที่ใช้ในงาน QA จริงๆ ดูว่า "สัดส่วนของเสีย" ในแต่ละวัน
  //   อยู่ในเกณฑ์ควบคุม (UCL/LCL) หรือไม่
  //
  // Logic: คำนวณ defect_proportion = จำนวนตำหนิ / จำนวนตรวจทั้งหมด
  // หน้า Stats จะดึงข้อมูลนี้ไปคำนวณ UCL/LCL และวาดกราฟต่อ
  db.exec(`
    CREATE VIEW IF NOT EXISTS pchart_data AS
    SELECT 
      DATE(ir.timestamp) AS sample_date,
      COUNT(*) AS sample_size,
      SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS defect_count,
      ROUND(CAST(SUM(CASE WHEN ir.defect_type != 'none' THEN 1 ELSE 0 END) AS REAL) / COUNT(*), 4) AS defect_proportion
    FROM inspection_results ir
    GROUP BY DATE(ir.timestamp)
    ORDER BY sample_date ASC;
  `);

  console.log('✅ เริ่มต้นฐานข้อมูลสำเร็จ');
  return db;
}

// ส่งออกฟังก์ชัน initDatabase ให้ server.js เรียกใช้ได้
// module.exports คืออะไร? → คือวิธีส่งออกโค้ดใน Node.js
//   ให้ไฟล์อื่น require() มาใช้ได้
//   เหมือน export ใน Python
module.exports = { initDatabase };
