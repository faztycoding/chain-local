// ============================================================
// หน้าสถิติ & แดชบอร์ด - ลอจิกกราฟและตาราง
// ============================================================
// ไฟล์นี้จัดการการแสดงผลเป็นกราฟและตารางทั้งหมด
// ใช้ Chart.js Library วาดกราฟ
// ทำไมใช้ Chart.js? → เพราะใช้ง่าย สวย รองรับหลายประเภทกราฟ
//   แค่โหลดผ่าน CDN ไม่ต้องติดตั้งเพิ่ม
// ข้อมูลดึงจาก API ของ Server (ที่ดึงจาก SQLite อีกที)

// สลับแท็บ - เมื่อคลิกแท็บใด จะซ่อนเนื้อหาเดิม + แสดงเนื้อหาใหม่
// ทำไมใช้ classList? → เพิ่ม/ลบ CSS class ได้โดยไม่กระทบ class อื่น
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  event.target.classList.add('active');

  // โหลดข้อมูลของแต่ละแท็บเมื่อคลิกเปิด (ไม่โหลดทั้งหมดตั้งแต่แรก เพื่อประหยัดเวลา)
  if (tabName === 'pchart') loadPchartData();
  if (tabName === 'daily') loadDailyReport();
  if (tabName === 'history') loadHistory();
}

// เก็บตัวแปรอ้างอิงกราฟ (Chart Instance)
// ทำไมต้องเก็บ? → เพื่อใช้ .destroy() ทำลายกราฟเก่าก่อนสร้างใหม่
//   ถ้าไม่ทำลาย กราฟจะซ้อนทับกันทุกครั้งที่โหลดข้อมูลใหม่
let chartDefectByColor = null;
let chartDailyCount = null;
let chartDefectRatio = null;
let chartConfidenceTrend = null;
let chartPchart = null;

// โหลดข้อมูลภาพรวมจาก API หลายเส้นทาง
// ทำไมเรียก API หลายตัว? → เพราะต้องการข้อมูลจากหลายมุมมารวมเป็นภาพรวม
async function loadOverview() {
  try {
    // ดึงข้อมูลจาก 4 API พร้อมกัน
    const exportRes = await fetch('/api/stats/export');
    const exportData = await exportRes.json();

    const dailyRes = await fetch('/api/stats/daily');
    const dailyData = await dailyRes.json();

    const colorRes = await fetch('/api/stats/defect-by-color');
    const colorData = await colorRes.json();

    const ordersRes = await fetch('/api/orders');
    const orders = await ordersRes.json();

    // คำนวณตัวเลขสรุปสำหรับการ์ดด้านบน
    // .filter() → กรองเอาเฉพาะตำหนิ
    // .reduce() → รวมค่าทั้งหมดเป็นตัวเดียว
    // .toFixed(1) → ปัดทศนิยม 1 ตำแหน่ง
    const totalInspections = exportData.length;
    const totalDefects = exportData.filter(d => d.is_defect === 1).length;
    const defectRate = totalInspections > 0 ? ((totalDefects / totalInspections) * 100).toFixed(1) : 0;
    const avgConf = totalInspections > 0 ? (exportData.reduce((sum, d) => sum + d.confidence, 0) / totalInspections * 100).toFixed(1) : 0;

    document.getElementById('totalOrders').textContent = orders.length;
    document.getElementById('totalInspections').textContent = totalInspections;
    document.getElementById('totalDefects').textContent = totalDefects;
    document.getElementById('defectRate').textContent = defectRate + '%';
    document.getElementById('avgConfidence').textContent = avgConf + '%';

    // วาดกราฟ: ตำหนิแยกตามสี (กราฟแท่ง)
    if (colorData.length > 0) {
      renderDefectByColor(colorData);
    }

    // วาดกราฟ: จำนวนตรวจรายวัน (กราฟเส้น)
    if (dailyData.length > 0) {
      renderDailyCount(dailyData);
      renderConfidenceTrend(dailyData);
    }

    // วาดกราฟ: สัดส่วนตำหนิ vs ผ่าน (กราฟโดนัท)
    if (totalInspections > 0) {
      renderDefectRatio(totalDefects, totalInspections - totalDefects);
    }

  } catch (err) {
    console.error('โหลดข้อมูลภาพรวมไม่สำเร็จ:', err);
  }
}

// ---- ฟังก์ชันวาดกราฟ ----
// Chart.js ต้องการ: Canvas element + ข้อมูลในรูปแบบที่กำหนด
// .getContext('2d') → ดึงพื้นที่วาดของ Canvas
// .destroy() → ทำลายกราฟเก่าก่อนสร้างใหม่ (ไม่งั้นกราฟซ้อนทับ)

function renderDefectByColor(data) {
  const ctx = document.getElementById('chartDefectByColor').getContext('2d');
  if (chartDefectByColor) chartDefectByColor.destroy();

  const colorMap = {
    'silver': '#c0c0c0', 'gold': '#ffd700', 'black': '#333',
    'red': '#e74c3c', 'blue': '#3498db', 'green': '#27ae60'
  };

  chartDefectByColor = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.chain_color),
      datasets: [{
        label: 'Defect Rate (%)',
        data: data.map(d => d.defect_rate_percent),
        backgroundColor: data.map(d => colorMap[d.chain_color] || '#2c3e6b'),
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Defect Rate (%)' } }
      }
    }
  });
}

function renderDailyCount(data) {
  const ctx = document.getElementById('chartDailyCount').getContext('2d');
  if (chartDailyCount) chartDailyCount.destroy();

  // รวมข้อมูลตามวันที่
  // ทำไมต้องรวม? → ข้อมูลอาจมีหลายแถวในวันเดียว (แยกตามสี/ขนาด)
  //   จึงต้องรวมเป็นวันละ 1 แถวก่อน
  // ใช้ Object เป็น Map? → เขียนง่ายกว่า Map จริง
  const dateMap = {};
  data.forEach(d => {
    if (!dateMap[d.report_date]) dateMap[d.report_date] = { total: 0, defect: 0 };
    dateMap[d.report_date].total += d.total_inspections;
    dateMap[d.report_date].defect += d.defect_count;
  });

  const dates = Object.keys(dateMap).sort();

  chartDailyCount = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: 'Total Inspections',
          data: dates.map(d => dateMap[d].total),
          borderColor: '#2c3e6b',
          backgroundColor: 'rgba(44,62,107,0.1)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'Defects',
          data: dates.map(d => dateMap[d].defect),
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231,76,60,0.1)',
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

function renderDefectRatio(defects, passes) {
  const ctx = document.getElementById('chartDefectRatio').getContext('2d');
  if (chartDefectRatio) chartDefectRatio.destroy();

  chartDefectRatio = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Pass', 'Defect'],
      datasets: [{
        data: [passes, defects],
        backgroundColor: ['#27ae60', '#e74c3c'],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

function renderConfidenceTrend(data) {
  const ctx = document.getElementById('chartConfidenceTrend').getContext('2d');
  if (chartConfidenceTrend) chartConfidenceTrend.destroy();

  // รวมค่าความมั่นใจตามวันที่ แล้วหาค่าเฉลี่ย
  const dateMap = {};
  data.forEach(d => {
    if (!dateMap[d.report_date]) dateMap[d.report_date] = [];
    dateMap[d.report_date].push(d.avg_confidence_percent);
  });

  const dates = Object.keys(dateMap).sort();
  const avgValues = dates.map(d => {
    const vals = dateMap[d];
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  });

  chartConfidenceTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'Avg Confidence (%)',
        data: avgValues,
        borderColor: '#f39c12',
        backgroundColor: 'rgba(243,156,18,0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, max: 100, title: { display: true, text: 'Confidence (%)' } }
      }
    }
  });
}

// ---- กราฟควบคุม p-Chart ----
// p-Chart คืออะไร? → กราฟ QA จริง ดูว่า "สัดส่วนของเสีย" ในแต่ละวัน
//   อยู่ในเกณฑ์ควบคุม (UCL/LCL) หรือไม่
// UCL = ขีดจำกัดบน (Upper Control Limit)
// LCL = ขีดจำกัดล่าง (Lower Control Limit)
// สูตร 3-sigma: UCL = p̸ + 3√(p̸(1-p̸)/n)

async function loadPchartData() {
  try {
    const res = await fetch('/api/stats/pchart');
    const data = await res.json();

    if (data.length === 0) return;

    // คำนวณ p-bar (ค่าเฉลี่ยสัดส่วนของเสียทั้งหมด)
    const totalDefects = data.reduce((sum, d) => sum + d.defect_count, 0);
    const totalSamples = data.reduce((sum, d) => sum + d.sample_size, 0);
    const pBar = totalSamples > 0 ? totalDefects / totalSamples : 0;

    // คำนวณขีดจำกัดควบคุม (สูตร 3-sigma ที่ใช้ในงาน QA จริง)
    const dates = data.map(d => d.sample_date);
    const proportions = data.map(d => d.defect_proportion);
    const nAvg = totalSamples / data.length;

    const ucl = pBar + 3 * Math.sqrt(pBar * (1 - pBar) / nAvg);
    const lcl = Math.max(0, pBar - 3 * Math.sqrt(pBar * (1 - pBar) / nAvg));

    // วาดกราฟ
    const ctx = document.getElementById('chartPchart').getContext('2d');
    if (chartPchart) chartPchart.destroy();

    chartPchart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [
          {
            label: 'Proportion (p)',
            data: proportions,
            borderColor: '#2c3e6b',
            backgroundColor: 'rgba(44,62,107,0.1)',
            pointBackgroundColor: proportions.map(p => p > ucl || p < lcl ? '#e74c3c' : '#2c3e6b'),
            pointRadius: 5,
            fill: false,
            tension: 0
          },
          {
            label: 'p-bar (Center Line)',
            data: dates.map(() => pBar.toFixed(4)),
            borderColor: '#27ae60',
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false
          },
          {
            label: 'UCL (Upper Control Limit)',
            data: dates.map(() => ucl.toFixed(4)),
            borderColor: '#e74c3c',
            borderDash: [10, 5],
            pointRadius: 0,
            fill: false
          },
          {
            label: 'LCL (Lower Control Limit)',
            data: dates.map(() => lcl.toFixed(4)),
            borderColor: '#e74c3c',
            borderDash: [10, 5],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Proportion Defective (p)' }
          },
          x: {
            title: { display: true, text: 'Sample Date' }
          }
        }
      }
    });

    // สร้างตารางข้อมูล p-chart ด้านล่าง
    const tbody = document.getElementById('pchartTable');
    tbody.innerHTML = data.map(d => {
      const outOfControl = d.defect_proportion > ucl || d.defect_proportion < lcl;
      return `
        <tr>
          <td>${d.sample_date}</td>
          <td>${d.sample_size}</td>
          <td>${d.defect_count}</td>
          <td>${d.defect_proportion.toFixed(4)}</td>
          <td><span class="badge ${outOfControl ? 'badge-defect' : 'badge-pass'}">${outOfControl ? 'OUT OF CONTROL' : 'IN CONTROL'}</span></td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('โหลดข้อมูล p-chart ไม่สำเร็จ:', err);
  }
}

// ---- รายงานประจำวัน ----

async function loadDailyReport() {
  try {
    const res = await fetch('/api/stats/daily');
    const data = await res.json();

    const tbody = document.getElementById('dailyTable');
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:#aaa; padding:20px;">No data available</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(d => `
      <tr>
        <td>${d.report_date}</td>
        <td>${d.chain_color}</td>
        <td>${d.chain_size}</td>
        <td>${d.mode}</td>
        <td>${d.total_inspections}</td>
        <td>${d.pass_count}</td>
        <td>${d.defect_count}</td>
        <td>${d.defect_rate_percent}%</td>
        <td>${d.avg_confidence_percent}%</td>
        <td>${d.total_chains_counted}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('โหลดรายงานประจำวันไม่สำเร็จ:', err);
  }
}

// ---- ประวัติการตรวจสอบ ----

async function loadHistory() {
  try {
    const res = await fetch('/api/stats/history?limit=100');
    const data = await res.json();

    const tbody = document.getElementById('historyTable');
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#aaa; padding:20px;">No data available</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(d => `
      <tr>
        <td>#${d.inspection_id}</td>
        <td>#${d.order_id}</td>
        <td>${d.timestamp}</td>
        <td>${d.chain_color}</td>
        <td>${d.chain_size}</td>
        <td>${d.chain_count}</td>
        <td><span class="badge ${d.defect_type === 'none' ? 'badge-pass' : 'badge-defect'}">${d.defect_type === 'none' ? 'PASS' : d.defect_type.toUpperCase()}</span></td>
        <td>${(d.confidence * 100).toFixed(1)}%</td>
        <td>${d.order_status}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('โหลดประวัติไม่สำเร็จ:', err);
  }
}

// ---- เริ่มทำงาน ----
// โหลดภาพรวมตอนเปิดหน้า Stats
loadOverview();
