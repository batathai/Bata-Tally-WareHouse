# ภาพคลังสินค้า 3D (Bata WMS)

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `warehouse-dashboard-design.html` | แบบร่างหน้าแดชบอร์ด 3D (เปิดในเบราว์เซอร์ได้เลย) |
| `menus-3d-design.html` | แบบร่าง 3D ของทุกเมนู |
| `src/bata-warehouse-3d.js` | โค้ดต้นฉบับของภาพ 3D หน้าแดชบอร์ด → build เป็น `Index/bata-warehouse-3d.bundle.js` |
| `src/bata-menus-3d.engine.js`, `src/bata-menus-3d.entry.js` | โค้ดต้นฉบับของ 3D เมนูอื่นๆ → build เป็น `Index/bata-menus-3d.bundle.js` |

ไฟล์ที่ระบบใช้งานจริงอยู่ใน `Index/` (`bata-warehouse-3d.bundle.js`, `bata-menus-3d.bundle.js`) และถูกเรียกจาก `Index/index.html` ตรงจุดที่มีหมายเหตุ `3D-WAREHOUSE` / `3D-MENUS`

## build ใหม่ (เมื่อแก้โค้ดต้นฉบับ)
```bash
npm i three@0.128.0 esbuild@0.20.2
# หน้าแดชบอร์ด
echo "export { mountWarehouse3D } from './bata-warehouse-3d.js';" > entry-dash.js
npx esbuild entry-dash.js --bundle --minify --format=iife --global-name=BataWarehouse3D --outfile=../../Index/bata-warehouse-3d.bundle.js
# เมนูอื่นๆ 
npx esbuild bata-menus-3d.entry.js --bundle --minify --format=iife --global-name=BataMenus3D --outfile=../../Index/bata-menus-3d.bundle.js
```
ต้องใช้ three.js เวอร์ชัน 0.128.0 เท่านั้น เวอร์ชันใหม่กว่าแสงและสีจะเพี้ยน

ตัวเลขในภาพมาจากข้อมูลจริงเฉพาะ แดชบอร์ด, รับสินค้าเข้า, จ่ายสินค้าออก ส่วนการเคลื่อนไหว (รถ โฟล์คลิฟต์ สายพาน) เป็นภาพจำลอง
