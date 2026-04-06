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

## Request JSON Format

```json
{
  "order_id": 1,
  "chain_count": 5,
  "defect_type": "none",
  "defect_detail": "",
  "confidence": 0.95,
  "image_path": "/images/detection_001.jpg"
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | Integer | **Yes** | The order ID from the input page. Get this from `GET /api/orders` |
| `chain_count` | Integer | No | Number of chain links detected in this frame (default: 0) |
| `defect_type` | String | No | Type of defect detected. Use `"none"` for normal chain. Examples: `"scratch"`, `"crack"`, `"rust"`, `"deformation"`, `"none"` |
| `defect_detail` | String | No | Additional detail about the defect (e.g., location, severity) |
| `confidence` | Float | No | Detection confidence score from 0.0 to 1.0 (e.g., 0.95 = 95%) |
| `image_path` | String | No | Path to the detection image with bounding boxes (optional) |

---

## Example Requests

### Normal Chain (No Defect)
```json
{
  "order_id": 1,
  "chain_count": 3,
  "defect_type": "none",
  "defect_detail": "",
  "confidence": 0.92,
  "image_path": ""
}
```

### Defect Found
```json
{
  "order_id": 1,
  "chain_count": 1,
  "defect_type": "scratch",
  "defect_detail": "Surface scratch on link #3, severity: medium",
  "confidence": 0.87,
  "image_path": "/images/defect_frame_042.jpg"
}
```

### Counting Only
```json
{
  "order_id": 1,
  "chain_count": 10,
  "defect_type": "none",
  "confidence": 0.98
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
    "timestamp": "2025-04-07 10:30:15",
    "chain_count": 3,
    "defect_type": "none",
    "defect_detail": "",
    "confidence": 0.92,
    "image_path": ""
  },
  "order": {
    "id": 1,
    "mode": "both",
    "chain_size": "10mm",
    "chain_color": "silver",
    "total_chain_count": 15,
    "total_defect_count": 0,
    "status": "running"
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
import json

API_URL = "http://localhost:3000/api/detect"

# After YOLOv8 processes a frame:
def send_detection(order_id, count, defect, confidence, detail="", img_path=""):
    payload = {
        "order_id": order_id,
        "chain_count": count,
        "defect_type": defect,       # "none", "scratch", "crack", "rust", etc.
        "defect_detail": detail,
        "confidence": confidence,     # 0.0 - 1.0
        "image_path": img_path
    }
    
    try:
        response = requests.post(API_URL, json=payload)
        result = response.json()
        print(f"Sent: count={count}, defect={defect}, conf={confidence}")
        return result
    except Exception as e:
        print(f"Error sending detection: {e}")
        return None

# Usage example:
# send_detection(order_id=1, count=5, defect="none", confidence=0.95)
# send_detection(order_id=1, count=1, defect="scratch", confidence=0.87, detail="Link #3")
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
