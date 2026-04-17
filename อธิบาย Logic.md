# 📘 คู่มืออธิบายโปรเจค — สำหรับนำเสนออาจารย์

> เอกสารนี้สรุปทุกอย่างที่ระบบทำได้ พร้อมเหตุผลทางเทคนิค เพื่อให้ตอบคำถามอาจารย์ได้ครบทุกประเด็น

---

## 1. ภาพรวมโปรเจค

**ชื่อระบบ:** Chain Counter & AI Defect Detection System
**วัตถุประสงค์:** ระบบ HMI (Human-Machine Interface) สำหรับโรงงานผลิตโซ่
ใช้ AI (YOLOv8) ตรวจจับ:
- จำนวนข้อโซ่ (Count Links)
- ตำหนิบนโซ่ (Defect Detection: รอยขีดข่วน, รอยแตก, สนิม, การบิดงอ)

**Architecture แบบย่อ:**
```
┌────────────┐   POST     ┌──────────────┐    Socket.io    ┌──────────────┐
│  YOLOv8 AI │ ─────────▶ │   Server     │ ──────────────▶ │  Web HMI     │
│  (Python)  │  /api/detect│ Node.js+SQLite│   (real-time)   │ 3 หน้าเว็บ   │
└────────────┘            └──────────────┘                 └──────────────┘
```

---

## 2. Tech Stack ที่ใช้ และเหตุผล

| เทคโนโลยี | ใช้ทำอะไร | ทำไมถึงเลือกใช้ |
|---|---|---|
| **Node.js + Express** | Web Server | เบา รันได้บนเครื่องโรงงาน (localhost) ไม่ต้องลง stack ใหญ่ |
| **SQLite (better-sqlite3)** | ฐานข้อมูล | ไฟล์เดียวจบ ไม่ต้องลง DB Server แยก เหมาะกับ prototype |
| **Socket.io** | Real-time communication | ส่งข้อมูลจาก Server → หน้าเว็บทันที ไม่ต้อง refresh |
| **Chart.js** | กราฟสถิติ | ฟรี ใช้งานง่าย รองรับ p-chart, bar, line, doughnut |
| **HTML/CSS/JS (Vanilla)** | Frontend | ไม่ใช้ framework หนักๆ เพราะเป็น HMI ในโรงงาน เน้นเรียบง่าย โหลดเร็ว |

---

## 3. โครงสร้าง 3 หน้าเว็บ

### 🔹 หน้า 1: Inspection Orders (page1_input.html)
- ฟอร์มสร้างคำสั่งตรวจสอบใหม่
- เลือก: **Mode** (Count/Defect/Both), **Chain Size**, **Detection Light Color**
- บันทึกลง DB → ส่งไปหน้า Output ทันทีผ่าน Socket.io
- มีตารางคำสั่งล่าสุด

### 🔹 หน้า 2: Control Panel (page2_output.html)
- หน้าหลักของผู้ควบคุมเครื่อง (operator)
- แสดงสถานะ Real-time:
  - Camera Status / Chain Status / Chain Count / Detection Status / System Status
- ปุ่มควบคุม: **Start / Stop / Complete / Emergency Stop**
- แสดงผลตรวจจับล่าสุดจาก AI (ประเภทตำหนิ, confidence, จำนวนข้อ)
- Activity Log แสดงเหตุการณ์ทั้งหมด

### 🔹 หน้า 3: Production Stats (page3_stats.html)
แดชบอร์ดวิเคราะห์คุณภาพ มี 6 แท็บ:
1. **Overview** - สรุปตัวเลขรวม + กราฟ 4 ตัว
2. **Control Chart (p-chart)** - กราฟควบคุมคุณภาพแบบ Statistical Process Control
3. **Daily Report** - รายงานรายวัน
4. **Weekly Report** - รายงานรายสัปดาห์
5. **Monthly Report** - รายงานรายเดือน
6. **Inspection History** - ประวัติการตรวจทั้งหมด

---

## 4. Logic การทำงานของ Status (สำคัญ!)

Order มี 5 สถานะ ที่เปลี่ยนได้ดังนี้:

```
            สร้าง order
                │
                ▼
          ┌─────────┐
          │ Pending │  ← เริ่มต้นทุกครั้งที่สร้าง
          └────┬────┘
               │
       ┌───────┼───────┬───────────┐
       ▼       ▼       ▼           ▼
  ┌────────┐┌──────┐┌──────────┐┌───────────┐
  │ Running││ Stop ││ Complete ││ Emergency │
  └────────┘└──────┘└──────────┘└───────────┘
       ↑      ↑          ↑            ↑
      [กดปุ่มที่ Sidebar หน้า Control Panel]
```

| สถานะ | ความหมาย | เปลี่ยนยังไง |
|---|---|---|
| `Pending` | สร้างคำสั่งแล้ว รอเริ่มงาน | สถานะเริ่มต้นอัตโนมัติ |
| `Running` | กำลังตรวจสอบอยู่ | กดปุ่ม **Start** |
| `Stopped` | หยุดชั่วคราว | กดปุ่ม **Stop** |
| `Completed` | จบงานแล้ว | กดปุ่ม **Complete** |
| `Emergency` | หยุดฉุกเฉิน | กดปุ่ม **Emergency Stop** |

**สำคัญ:** สถานะเปลี่ยนแบบ **manual โดย operator** ไม่ใช่อัตโนมัติ
เพราะในโรงงานจริง คนคุมเครื่องต้องตัดสินใจเองว่างานเสร็จเมื่อไหร่

---

## 5. Logic การนับตำหนิ (คำถามที่ลูกค้าถาม)

**ระบบนับแบบ "1 inspection = 1 ผลตรวจ"** ไม่ได้นับจำนวนจุดตำหนิ

### ตัวอย่าง:
| โซ่เส้นที่ | AI ตรวจเจอ | บันทึกเป็น |
|---|---|---|
| #1 | ปกติ | 1 Pass |
| #2 | รอยขีด 3 จุด | **1 Defect** (ไม่ใช่ 3) |
| #3 | รอยแตก 1 จุด | 1 Defect |

**Defect Rate** = จำนวน defective inspections ÷ total inspections × 100%

### Data Flow ของตัวเลขในแดชบอร์ด:
```
[Total Defects: 2]  →  [Defect Rate: 50%]  →  [Defect vs Pass Pie Chart]
       ↑                      ↑                        ↑
  ตัวเลขดิบ              คำนวณ %              แสดงเป็นกราฟวงกลม
```
**ตัวเลขทั้งหมดมาจากข้อมูลชุดเดียวกัน** แค่แสดงคนละรูปแบบ

---

## 6. Logic การส่งข้อมูลจาก AI (YOLOv8)

AI ฝั่ง Python ต้องส่ง POST มาที่ `http://localhost:3000/api/detect` พร้อม JSON:

```json
{
  "order_id": 1,
  "chain_count": 5,
  "defect_type": "scratch",
  "defect_detail": "scratch on link #3",
  "confidence": 0.95,
  "image_path": "/path/to/image.jpg"
}
```

**Field อธิบาย:**
- `order_id` — รหัสคำสั่ง (จากตอนสร้าง order)
- `chain_count` — จำนวนข้อโซ่ที่นับเจอใน frame นั้น
- `defect_type` — ประเภทตำหนิ: `none` / `scratch` / `crack` / `rust` / `deformation`
- `defect_detail` — รายละเอียดเพิ่มเติม (ตำแหน่ง, ลักษณะ)
- `confidence` — ความมั่นใจของ AI (0.0 ถึง 1.0)
- `image_path` — path ของรูปที่ตรวจ (ใช้ได้ทั้ง URL และ local path)

**สิ่งที่เกิดขึ้นหลัง POST:**
1. Server บันทึกลง DB (ตาราง `inspection_results`)
2. อัปเดตยอดสะสมใน orders (`total_chain_count`, `total_defect_count`)
3. emit Socket.io event ไปยังทุกหน้าเว็บที่เปิดอยู่
4. หน้า Output อัปเดตแสดงผลทันที

---

## 7. Database Schema

### ตาราง `orders` — เก็บคำสั่งตรวจสอบ
```
id, mode, chain_size, chain_color, product_attribution,
total_chain_count, total_defect_count, status, created_at, updated_at
```

### ตาราง `inspection_results` — เก็บผลตรวจจับจาก AI
```
id, order_id, chain_count, defect_type, defect_detail,
confidence, image_path, timestamp
```

### Views (สำหรับ Power BI / รายงาน)
- `power_bi_inspection_summary` — สรุปสำหรับ export ไป Power BI
- `daily_qa_summary` — สรุปรายวัน
- `pchart_data` — ข้อมูลสำหรับสร้าง p-chart

---

## 8. Reset System (รีเซตระบบ)

มีปุ่ม **"Reset System"** ที่หน้า Inspection Orders (sidebar ซ้าย)
กดแล้วจะ:
- ลบคำสั่งทั้งหมด
- ลบผลการตรวจสอบทั้งหมด
- รีเซตเลข ID กลับไปเริ่มที่ 1 ใหม่
- หน้าเว็บที่เปิดอยู่ทุกหน้าจะรีเฟรชอัตโนมัติ

> เหมือนระบบเปิดใช้งานครั้งแรก เหมาะสำหรับ demo ให้อาจารย์ดูใหม่

**API Endpoint:** `POST /api/admin/reset`

---

## 9. คำถามที่อาจารย์อาจถาม + วิธีตอบ

### Q: ทำไมเลือกใช้ SQLite แทน MySQL/PostgreSQL?
**A:** เพราะเป็นระบบ HMI ที่รันบนเครื่องในโรงงาน ใช้คนเดียวต่อเครื่อง ไม่ต้องการการเชื่อมต่อจากหลายเครื่อง SQLite จึงเพียงพอและไม่ต้องติดตั้ง DB Server แยก

### Q: ทำไมใช้ Socket.io ไม่ใช้ AJAX polling?
**A:** Socket.io เป็น push-based (server ส่งมาเอง) ทำให้ข้อมูลขึ้นจอทันที ไม่ต้องรอ
ส่วน polling ต้องส่ง request ทุกๆ X วินาที ทำให้ช้าและเปลือง resource

### Q: Defect Rate คำนวณยังไง?
**A:** `(จำนวน inspection ที่เจอตำหนิ ÷ inspection ทั้งหมด) × 100`
นับ "ต่อครั้งที่ตรวจ" ไม่ใช่ต่อจุดตำหนิ

### Q: p-chart คืออะไร?
**A:** Control Chart สำหรับ Proportion (สัดส่วนของเสีย) ใช้ใน Statistical Process Control (SPC)
มี UCL (Upper Control Limit) และ LCL คำนวณที่ 3-sigma
ถ้าจุดอยู่นอก UCL/LCL = กระบวนการผลิตผิดปกติ ต้องตรวจสอบ

### Q: ระบบรองรับเชื่อมต่อ AI จริงๆ ไหม?
**A:** รองรับครับ มี API endpoint `POST /api/detect` พร้อมใช้งาน
AI ฝั่ง Python (YOLOv8) แค่ส่ง JSON ตามรูปแบบที่กำหนด
ระบบจะรับ → บันทึก → แสดงผลให้ทันที (ดูเอกสาร `API_SPEC.md`)

### Q: Detection Light Color คืออะไร? ทำไมต้องเลือก?
**A:** ในการตรวจสอบโซ่ด้วย AI vision ต้องใช้ไฟส่องเพื่อให้กล้องเห็นชัด
สีของไฟ (เช่น ขาว, แดง, น้ำเงิน) มีผลต่อความชัดของรอยตำหนิแต่ละแบบ
ผู้ใช้จึงต้องเลือกสีไฟที่ใช้ตอนตรวจ เพื่อให้ระบบบันทึกและวิเคราะห์ได้ว่า
สีไฟแบบไหนตรวจตำหนิได้ดีที่สุด (กราฟ "Defect Rate by Inspection Light Color")

### Q: ทำไมไม่มีหน้า login?
**A:** เพราะเป็น HMI ในโรงงาน ใช้บนเครื่องเฉพาะที่อยู่ในไลน์ผลิต
ความปลอดภัยจัดการที่ระดับ network ของโรงงาน ไม่ต้องมี user authentication

---

## 10. ไฟล์สำคัญในโปรเจค

```
chain-local/
├── server.js                    ← Backend หลัก (API + Socket.io)
├── package.json                 ← ระบุ dependencies
├── database/
│   └── init.js                  ← สร้าง tables + views ตอน start
├── public/
│   ├── page1_input.html         ← หน้าสร้างคำสั่ง
│   ├── page2_output.html        ← หน้าควบคุม (HMI)
│   ├── page3_stats.html         ← หน้าสถิติ
│   ├── css/style.css            ← Style ทั้งหมด
│   └── js/
│       ├── input.js             ← Logic หน้า input
│       ├── output.js            ← Logic หน้า output (Socket.io)
│       └── stats.js             ← Logic หน้า stats (Chart.js)
├── API_SPEC.md                  ← เอกสาร API สำหรับทีม AI
└── README.md                    ← วิธีติดตั้งและรัน
```

---

## 11. คำสั่งรันโปรเจค

```bash
npm install      # ติดตั้ง dependencies (ครั้งแรก)
npm start        # เริ่ม server ที่ port 3000
```

จากนั้นเปิด: `http://localhost:3000`
