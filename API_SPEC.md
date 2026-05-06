# API Specification for AI Team (YOLOv8 Integration)

## Overview

This document explains how the AI (YOLOv8) system should send detection results to the Chain Counter web application.

---

## Endpoint

```
POST http://localhost:3000/api/detect
Content-Type: application/json
```

---

## Request JSON Format (NEW — Multiple Defect Points Per Chain)

> **Important:** As of v2, each POST = **one chain inspection**. A chain may have **multiple defect points**, sent as an array. The system tracks each defect point with its **link number** and **timestamp**.

```json
{
  "order_id": 1,
  "chain_count": 12,
  "defects": [
    { "link_number": 3, "defect_type": "scratch",     "confidence": 0.92, "defect_detail": "scratch at link #3" },
    { "link_number": 7, "defect_type": "rust",        "confidence": 0.88, "defect_detail": "rust spot" },
    { "link_number": 9, "defect_type": "deformation", "confidence": 0.81, "defect_detail": "twisted link" }
  ],
  "image_path": "/images/detection_001.jpg"
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | Integer | **Yes** | The order ID from input page. Get from `GET /api/orders` |
| `chain_count` | Integer | No | Number of chain links detected in this frame (default: 0) |
| `defects` | Array | No | List of defect points found in this chain. Empty array `[]` = pass |
| `defects[].link_number` | Integer | No | Which chain link the defect is at (1-based) |
| `defects[].defect_type` | String | **Yes** (per defect) | `"scratch"`, `"crack"`, `"rust"`, `"deformation"` |
| `defects[].defect_detail` | String | No | Additional info about this point |
| `defects[].confidence` | Float | No | Confidence 0.0–1.0 |
| `image_path` | String | No | Path to the detection image (optional) |

### Backward-Compatible Format (Old AI Code Still Works)

If your AI was built against the v1 spec, the old format is still accepted:
```json
{
  "order_id": 1,
  "chain_count": 5,
  "defect_type": "scratch",
  "defect_detail": "scratch on link #3",
  "confidence": 0.92,
  "image_path": ""
}
```
The server will internally convert it to a single-element `defects` array.

---

## Example Requests

### Pass (No Defects)
```json
{
  "order_id": 1,
  "chain_count": 12,
  "defects": [],
  "image_path": ""
}
```

### Single Defect
```json
{
  "order_id": 1,
  "chain_count": 12,
  "defects": [
    { "link_number": 5, "defect_type": "scratch", "confidence": 0.91 }
  ]
}
```

### Multiple Defects on One Chain
```json
{
  "order_id": 1,
  "chain_count": 15,
  "defects": [
    { "link_number": 2,  "defect_type": "rust",     "confidence": 0.85 },
    { "link_number": 8,  "defect_type": "crack",    "confidence": 0.93 },
    { "link_number": 14, "defect_type": "scratch",  "confidence": 0.78 }
  ],
  "image_path": "/images/multi_defect.jpg"
}
```

### Counting Only (No Defect Detection)
```json
{
  "order_id": 1,
  "chain_count": 10,
  "defects": []
}
```

---

## Response Format

### Success (201)
```json
{
  "success": true,
  "inspection": {
    "id": 1,
    "order_id": 1,
    "timestamp": "2026-05-06 19:30:15",
    "chain_count": 12,
    "defect_type": "mixed",
    "defect_detail": "link#3:scratch, link#7:rust, link#9:deformation",
    "defect_count": 3,
    "confidence": 0.87,
    "image_path": ""
  },
  "order": {
    "id": 1,
    "mode": "both",
    "chain_size": "10mm",
    "chain_color": "silver",
    "total_chain_count": 12,
    "total_defect_count": 3,
    "status": "running"
  },
  "defect_points": [
    { "id": 1, "inspection_id": 1, "order_id": 1, "link_number": 3, "defect_type": "scratch", "confidence": 0.92, "detected_at": "2026-05-06 19:30:15" },
    { "id": 2, "inspection_id": 1, "order_id": 1, "link_number": 7, "defect_type": "rust", "confidence": 0.88, "detected_at": "2026-05-06 19:30:15" },
    { "id": 3, "inspection_id": 1, "order_id": 1, "link_number": 9, "defect_type": "deformation", "confidence": 0.81, "detected_at": "2026-05-06 19:30:15" }
  ],
  "stats": {
    "total_inspections": 1,
    "defective_chains": 1,
    "total_defect_points": 3
  }
}
```

### Error (400/404/500)
```json
{
  "error": "order_id is required"
}
```

---

## Other Useful Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/orders` | Get all orders (to find `order_id`) |
| `GET` | `/api/orders/:id` | Get single order detail |
| `PATCH` | `/api/orders/:id/status` | Update order status (`running`, `stopped`, `completed`) |
| `GET` | `/api/stats/export` | Export all data (for Power BI) |

---

## Python Example (YOLOv8 Integration)

```python
import requests

API_URL = "http://localhost:3000/api/detect"

# After YOLOv8 finishes one chain frame, build a list of defect points:
#   each detection box from YOLO becomes one item in `defects[]`
def send_chain_inspection(order_id, chain_count, yolo_detections, image_path=""):
    """
    Send one chain inspection with all defect points found in that chain.

    Parameters:
        order_id (int): The order ID from /api/orders
        chain_count (int): Total links in the chain frame
        yolo_detections (list): List of detection dicts from YOLOv8, e.g.:
            [
                {"link_number": 3, "defect_type": "scratch", "confidence": 0.92},
                {"link_number": 7, "defect_type": "rust",    "confidence": 0.88},
            ]
            Empty list = pass (no defects).
        image_path (str): Optional path to annotated image
    """
    payload = {
        "order_id": order_id,
        "chain_count": chain_count,
        "defects": yolo_detections,
        "image_path": image_path
    }

    try:
        response = requests.post(API_URL, json=payload)
        result = response.json()
        print(f"Sent {len(yolo_detections)} defect points for chain with {chain_count} links")
        return result
    except Exception as e:
        print(f"Error sending detection: {e}")
        return None


# --- Usage examples ---

# 1) Pass (no defects)
send_chain_inspection(order_id=1, chain_count=12, yolo_detections=[])

# 2) Single defect on link #5
send_chain_inspection(order_id=1, chain_count=12, yolo_detections=[
    {"link_number": 5, "defect_type": "scratch", "confidence": 0.91}
])

# 3) Multiple defects on the same chain
send_chain_inspection(order_id=1, chain_count=15, yolo_detections=[
    {"link_number": 2,  "defect_type": "rust",    "confidence": 0.85},
    {"link_number": 8,  "defect_type": "crack",   "confidence": 0.93},
    {"link_number": 14, "defect_type": "scratch", "confidence": 0.78},
], image_path="/images/multi_defect.jpg")
```

---

## Flow Diagram

```
[YOLOv8 Camera] 
    → Process Frame
    → Send JSON to POST /api/detect
    → Server saves to SQLite DB
    → Server emits via Socket.io
    → Output page updates in real-time
    → Data available for Power BI export
```

---

## Notes

- The server runs on `localhost:3000` by default
- All data is stored in `chain_data.db` (SQLite file)
- Detection results are displayed on the Output page in real-time via Socket.io
- Data can be exported for Power BI analysis via `GET /api/stats/export`
