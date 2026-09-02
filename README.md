# Auto Reconcile & Daily Stock Cycle Count

โปรแกรม single-file HTML สำหรับกระทบยอดสต็อกอัตโนมัติและนับ Cycle Count รายวัน
ของ SYNNEX WMS — ใส่ Raw Data (Inbound / Outbound / StockTake redbox) แล้วระบบ
สร้าง Item Master + Reconcile + วินิจฉัยผลต่างให้ทันที

## วิธีใช้
เปิด `index.html` ด้วย Chrome/Edge (ดับเบิลคลิกได้เลย ไม่ต้องลง server) แล้ว
ลากไฟล์ `Prototype Cycle Count.xlsx` มาวางในหน้า **Input Raw Data**

## ทดลองด้วยข้อมูล Demo
- เมื่อเปิดโปรแกรม หน้า **Kuma Dashboard** จะแสดงข้อมูลตัวอย่าง 24 SKU พร้อม Count และ History จำลอง 7 วันให้อัตโนมัติ
- กดปุ่ม **✦ โหลดข้อมูล Demo** ในหน้า Input Raw Data เมื่อต้องการรีเซ็ตกลับสู่ชุดตัวอย่าง
- หรือทดลอง Import ไฟล์ `Auto_Reconcile_Demo_Data.xlsx` ซึ่งมีชีต StockTake, Inbound, Outbound และ Master ครบ
- ข้อมูลทั้งหมดเป็นข้อมูลสมมติ ไม่มีความเกี่ยวข้องกับสินค้าคงคลังจริง

## Kuma Theme
หน้าจอใช้ธีมหมีสีน้ำตาล โทนโกโก้–คาราเมล–ครีม พร้อมสีสถานะที่ยังแยก Match, Warning และ Variance ได้ชัดเจน

## โครงสร้างไฟล์ Excel ที่ระบบอ่าน
| ชีต | ใช้ทำอะไร |
|---|---|
| **StockTake (redbox)** | Inventory Onhand — G=D365, H=ASRS, I=Robot Miniload, J=Onfloor (= D365−ASRS−Robot) |
| **Inbound** | ยอดรับเข้า (Receive Qty) รายวัน |
| **Outbound** | ยอดขายออก (QTY บวก=ออก, ลบ=รับคืน) |
| **Master** | ใช้เป็น reference: Cost, มิติ, Avg Sales, Synnex ID, Barcode (Description = Stock Code) |

> ระบบตรวจจับชีตอัตโนมัติจากชื่อ และหาแถว header เอง (รองรับค่าที่ format เป็น `$150`, `1,000`, `(50)`)

## 7 หน้าจอ
1. **Dashboard / Inventory Control Tower** — KPI, Location Breakdown, Variance Summary/Value, Accuracy Trend, Top Variance, Root Cause, Smart Suggestions และสรุปงานนับวันนี้
2. **Input Raw Data** — อัปโหลด/พรีวิว raw data + KPI ภาพรวม (บันทึก snapshot ของวันอัตโนมัติ)
3. **Item Master** — ทะเบียนสินค้า (สร้างอัตโนมัติ) แก้ Cost/Class, จัดกลุ่ม ABC ตามมูลค่า
4. **Summary / Reconcile** — KPI, Count Accuracy, กราฟสาเหตุผลต่าง, ตาราง reconcile
5. **Daily Cycle Count** — จอนับ (รองรับ Mobile) + ระบบแนะนำว่าควรนับอะไร (Smart / มูลค่า / Movement / ไม่เคลื่อนไหว / ผิดปกติ)
6. **Compare & Tracking** — วินิจฉัยว่าผลต่างมาจาก **ขาเข้า / ขาออก / ระบบ** + จับคู่รายการที่อาจนับสลับกัน (Swap)
7. **History** — สถิติรายวันสะสมต่อเนื่อง (onhand / รับเข้า / จ่ายออก / ดิฟ ต่อรายการต่อวัน) + กราฟเทรนด์ + **ไล่ประวัติรายตัว** + Repeat Offenders

> วาง `index.html` และ `app.js` ไว้ในโฟลเดอร์เดียวกัน แล้วดับเบิลคลิก `index.html` เพื่อเปิดใช้งาน

## Filter / ค้นหา
ทุกตารางค้นได้ด้วย **Stock Code / Synnex ID / Brand / Description / Code** และกรองด้วย **Brand** และ **ผลต่าง** (เกิน + / ขาด − / ตรง 0 / มีผลต่าง)

## การใช้งานรายวัน (Daily workflow)
1. ต้นวัน: นำเข้าไฟล์ Excel ของวันนั้น (ระบบบันทึก snapshot อัตโนมัติ)
2. เดินนับตามที่ระบบแนะนำในหน้า Daily Cycle Count → กรอกยอดนับ (snapshot อัปเดตเอง)
3. กด **💾 บันทึกวันนี้** (มุมขวาบน) เพื่อยืนยัน snapshot หลังนับเสร็จ
4. ดูเทรนด์/ไล่ย้อนหลังในหน้า History & Dashboard
- ประวัติเก็บใน localStorage (สูงสุด 120 วันล่าสุด) · ย้ายเครื่อง/สำรองได้ด้วยปุ่ม Export/นำเข้าไฟล์ประวัติ (.xlsx)

## Logic การวินิจฉัย (feature หลัก)
- **Variance = ยอดนับจริง (Cnt) − Onfloor**
- ของ **เกิน** ระบบ + ใกล้เคียงยอด Inbound → *รับเข้าแล้วระบบยังไม่บันทึก/ยัง put-away ไม่ครบ*
- ของ **ขาด** ระบบ + ใกล้เคียงยอด Outbound → *จ่ายออก/หยิบแล้วระบบยังไม่ตัด*
- ไม่เข้าเงื่อนไข movement → *ผลต่างจากระบบ/การนับ* (และเช็ค Swap ต่อ)

## เก็บข้อมูล
ยอดนับและการตั้งค่า Cost/Class เก็บใน **localStorage** ของเบราว์เซอร์ (ต่อเครื่อง)
กด **Export** ในแต่ละหน้าเพื่อดาวน์โหลดผลเป็น .xlsx

## เทคโนโลยี
Vanilla JS + [SheetJS](https://sheetjs.com) (อ่าน/เขียน xlsx) + [Chart.js](https://www.chartjs.org) — ทำงานฝั่ง browser ล้วน ไม่มี backend
