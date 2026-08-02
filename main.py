from __future__ import annotations

import argparse
import datetime as dt
import json
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


def parse_source(source: str) -> int | str:
    """Allow OpenCV camera indexes like 0 while keeping URLs/file paths as strings."""
    try:
        return int(source)
    except ValueError:
        return source


# Configure only CCTV-backed parking areas here. The frontend will show live
# availability only when an OpenStreetMap place matches one of these entries.
PARKING_AREAS: dict[str, dict[str, Any]] = {
    "demo-parking": {
        "name": "Bajeko Bhojanalaya",
        "source": "rtsp://172.18.0.82:8080/h264.sdp",
        "capacity": 60,
        "lat": 27.705168,
        "lng": 85.328717,
        "match_radius_meters": 200,
        "process_every_n_frames": 20,
        "resize_width": 640,
    }
}


# COCO class ids used by YOLOv8: person, car, motorcycle, bus, truck.
DETECTION_CLASSES = [0, 2, 3, 5, 7]
COUNTED_CLASSES = {0, 2, 3, 5, 7}
SPACE_UNITS = {
    0: 1,
    2: 3,
    3: 1,
    5: 6,
    7: 6,
}


@dataclass
class ParkingStatus:
    area_id: str
    name: str
    capacity: int
    lat: float
    lng: float
    match_radius_meters: int
    occupied: int = 0
    available: int = 0
    running: bool = False
    error: str | None = None
    last_updated: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def update(self, occupied: int, error: str | None = None) -> None:
        with self.lock:
            self.occupied = max(0, min(self.capacity, occupied))
            self.available = self.capacity - self.occupied
            self.error = error
            self.last_updated = dt.datetime.now(dt.UTC).isoformat()

    def set_running(self, running: bool) -> None:
        with self.lock:
            self.running = running
            self.last_updated = dt.datetime.now(dt.UTC).isoformat()

    def set_error(self, error: str) -> None:
        with self.lock:
            self.error = error
            self.running = False
            self.last_updated = dt.datetime.now(dt.UTC).isoformat()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "areaId": self.area_id,
                "name": self.name,
                "capacity": self.capacity,
                "occupied": self.occupied,
                "available": self.available,
                "lat": self.lat,
                "lng": self.lng,
                "matchRadiusMeters": self.match_radius_meters,
                "running": self.running,
                "error": self.error,
                "lastUpdated": self.last_updated,
            }


def build_statuses() -> dict[str, ParkingStatus]:
    statuses = {}

    for area_id, config in PARKING_AREAS.items():
        capacity = int(config["capacity"])
        statuses[area_id] = ParkingStatus(
            area_id=area_id,
            name=str(config["name"]),
            capacity=capacity,
            available=capacity,
            lat=float(config["lat"]),
            lng=float(config["lng"]),
            match_radius_meters=int(config.get("match_radius_meters", 200)),
        )

    return statuses


def run_detector(area_id: str, config: dict[str, Any], status: ParkingStatus, display: bool) -> None:
    import cv2
    from ultralytics import YOLO

    capacity = int(config["capacity"])
    source = str(config["source"])
    process_every_n_frames = max(1, int(config.get("process_every_n_frames", 1)))
    resize_width = int(config.get("resize_width", 0))
    occupied_units = 0
    frame_count = 0
    track_sides: dict[int, str] = {}
    counted_crossings: set[tuple[int, str, str]] = set()

    try:
        model = YOLO("yolov8n.pt")
        cap = cv2.VideoCapture(parse_source(source))
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        if not cap.isOpened():
            status.set_error(f"Could not open video source: {source}")
            return

        status.set_running(True)
        status.update(occupied_units)

        while True:
            ret, frame = cap.read()

            if not ret:
                # File sources end naturally; camera streams may reconnect later in a fuller version.
                break

            frame_count += 1
            if frame_count % process_every_n_frames != 0:
                if display:
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
                continue

            if resize_width > 0 and frame.shape[1] > resize_width:
                scale = resize_width / frame.shape[1]
                frame = cv2.resize(frame, (resize_width, int(frame.shape[0] * scale)))

            frame_height, frame_width = frame.shape[:2]
            line_x = frame_width // 2

            results = model.track(
                frame,
                persist=True,
                classes=DETECTION_CLASSES,
                tracker="bytetrack.yaml",
                verbose=False,
            )

            annotated_frame = results[0].plot() if display else frame
            boxes = results[0].boxes

            if boxes is not None and boxes.id is not None:
                for box, track_id, class_id in zip(boxes.xyxy, boxes.id, boxes.cls):
                    track_id = int(track_id)
                    class_id = int(class_id)
                    if class_id not in COUNTED_CLASSES:
                        continue

                    space_units = SPACE_UNITS.get(class_id, 1)
                    x1, _y1, x2, _y2 = map(int, box)
                    center_x = (x1 + x2) // 2

                    current_side = "left" if center_x < line_x else "right"
                    previous_side = track_sides.get(track_id)

                    if previous_side and previous_side != current_side:
                        crossing_key = (track_id, previous_side, current_side)

                        if crossing_key not in counted_crossings:
                            if previous_side == "right" and current_side == "left":
                                occupied_units = min(capacity, occupied_units + space_units)
                            elif previous_side == "left" and current_side == "right":
                                occupied_units = max(0, occupied_units - space_units)

                            counted_crossings.add(crossing_key)
                            status.update(occupied_units)

                    track_sides[track_id] = current_side

            if display:
                available_units = capacity - occupied_units
                cv2.line(annotated_frame, (line_x, 0), (line_x, frame_height), (255, 0, 0), 2)
                cv2.putText(
                    annotated_frame,
                    f"{status.name}: occupied {occupied_units}/{capacity}",
                    (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    1,
                    (0, 255, 0),
                    2,
                )
                cv2.putText(
                    annotated_frame,
                    f"Available units: {available_units}",
                    (20, 80),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    1,
                    (0, 255, 0),
                    2,
                )
                cv2.imshow(f"Parking Detection - {area_id}", annotated_frame)

                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            time.sleep(0.001)

        cap.release()
        status.set_running(False)

    except Exception as exc:
        status.set_error(str(exc))
    finally:
        if display:
            try:
                cv2.destroyWindow(f"Parking Detection - {area_id}")
            except cv2.error:
                pass


def write_json(handler: BaseHTTPRequestHandler, payload: dict[str, Any], status_code: int = 200) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


def create_handler(statuses: dict[str, ParkingStatus]):
    class ParkingApiHandler(BaseHTTPRequestHandler):
        def do_OPTIONS(self) -> None:
            write_json(self, {"ok": True})

        def do_GET(self) -> None:
            path = urlparse(self.path).path.rstrip("/")

            if path == "/api/health":
                write_json(self, {"ok": True})
                return

            if path == "/api/parking-status":
                write_json(self, {"areas": [status.snapshot() for status in statuses.values()]})
                return

            prefix = "/api/parking-status/"
            if path.startswith(prefix):
                area_id = path[len(prefix):]
                status = statuses.get(area_id)

                if not status:
                    write_json(self, {"error": "Unknown parking area"}, 404)
                    return

                write_json(self, status.snapshot())
                return

            write_json(self, {"error": "Not found"}, 404)

        def log_message(self, format: str, *args: Any) -> None:
            return

    return ParkingApiHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect CCTV parking availability and expose it to the web app.")
    parser.add_argument("--host", default="127.0.0.1", help="API host.")
    parser.add_argument("--port", type=int, default=5000, help="API port.")
    parser.add_argument("--display", action="store_true", help="Show OpenCV detection windows.")
    parser.add_argument(
        "--no-detector",
        action="store_true",
        help="Run only the API with configured areas, useful for frontend wiring tests.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    statuses = build_statuses()

    if not args.no_detector:
        for area_id, config in PARKING_AREAS.items():
            detector_thread = threading.Thread(
                target=run_detector,
                args=(area_id, config, statuses[area_id], args.display),
                daemon=True,
            )
            detector_thread.start()

    server = ThreadingHTTPServer((args.host, args.port), create_handler(statuses))
    print(f"Parking status API running at http://{args.host}:{args.port}/api/parking-status")
    server.serve_forever()


if __name__ == "__main__":
    main()
