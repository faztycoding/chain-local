# Chain Counter & AI Defect Inspection System

ระบบ Localhost Web App สำหรับนับข้อโซ่และตรวจจับตำหนิ พร้อมเชื่อมต่อ AI (YOLOv8)

## Quick Start (วิธีรัน)

### 1. ติดตั้ง Node.js
- ดาวน์โหลดจาก https://nodejs.org (LTS version)
- ติดตั้งตามขั้นตอนปกติ

### 2. ติดตั้ง Dependencies
```bash
cd chain-local
npm install
```

### 3. รันระบบ
```bash
npm start
```

### 4. เปิดใช้งาน
- **หน้า Input (สั่ง Order):** http://localhost:3000/page1_input.html
- **หน้า Output (HMI):** http://localhost:3000/page2_output.html
- **หน้า Stats (Dashboard):** http://localhost:3000/page3_stats.html

---

## โครงสร้างโปรเจค

```
chain-local/
├── server.js                 # Express + Socket.io + SQLite server
├── package.json              # Dependencies
├── chain_data.db             # SQLite database (auto-created)
├── database/
│   └── init.js               # Database schema & views
├── public/
│   ├── css/
│   │   └── style.css         # Styling
│   ├── js/
│   │   ├── input.js          # Input page logic
│   │   ├── output.js         # Output page logic (Socket.io)
│   │   └── stats.js          # Stats/Dashboard logic (Chart.js)
│   ├── page1_input.html      # Order input form
│   ├── page2_output.html     # HMI output display
│   └── page3_stats.html      # Stats & QA Dashboard
├── API_SPEC.md               # API spec สำหรับทีม AI
└── README.md                 # ไฟล์นี้
```

---

## การเชื่อมต่อกับ AI (YOLOv8)

ดูรายละเอียดที่ไฟล์ `API_SPEC.md`

**สรุปสั้นๆ:** ส่ง JSON ไปที่ `POST http://localhost:3000/api/detect`

```json
{
  "order_id": 1,
  "chain_count": 5,
  "defect_type": "none",
  "confidence": 0.95
}
```

---

## การดึงข้อมูลไป Power BI

1. เปิด Power BI Desktop
2. เลือก Get Data > ODBC หรือใช้ SQLite connector
3. เชื่อมต่อกับไฟล์ `chain_data.db` ในโฟลเดอร์โปรเจค
4. เลือก View ที่เตรียมไว้:
   - `power_bi_inspection_summary` - ข้อมูลรวมทั้งหมด (Flat Table)
   - `daily_qa_summary` - สรุปรายวัน
   - `pchart_data` - ข้อมูลสำหรับทำ p-chart

หรือใช้ API: `GET http://localhost:3000/api/stats/export` เพื่อดึงข้อมูล JSON

---

## หมายเหตุ

- ระบบรันบน Localhost เท่านั้น ไม่ต้องต่อ Internet
- Database เป็นไฟล์ SQLite ไฟล์เดียว ก๊อปวางได้ทันที
- ปุ่ม Start/Stop/Emergency เป็น Mockup Logic (เปลี่ยนสถานะบนหน้าจอ)
