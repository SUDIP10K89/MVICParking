from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4


def parse_source(source: str) -> int | str:
    """Allow OpenCV camera indexes like 0 while keeping URLs/file paths as strings."""
    try:
        return int(source)
    except ValueError:
        return source


DATA_FILE = Path(__file__).with_name("parking_areas.json")
ENV_FILE = Path(__file__).with_name(".env")
parking_area_lock = threading.Lock()
status_lock = threading.Lock()
URL_PATTERN = re.compile(r"^(https?://|rtsp://)", re.IGNORECASE)
mongo_collection = None
mongo_checked = False


def load_env_file() -> dict[str, str]:
    if not ENV_FILE.exists():
        return {}

    values = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


def get_config_value(key: str, default: str = "") -> str:
    return os.environ.get(key) or load_env_file().get(key, default)


def get_parking_area_collection():
    global mongo_checked, mongo_collection

    if mongo_checked:
        return mongo_collection

    mongo_checked = True
    mongo_uri = get_config_value("MONGODB_URI")
    if not mongo_uri:
        return None

    try:
        from pymongo import MongoClient

        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
        client.admin.command("ping")
        db_name = get_config_value("MONGODB_DB", "parkwise")
        mongo_collection = client[db_name]["parking_areas"]
        mongo_collection.create_index([("location", "2dsphere")])
        seed_mongo_from_json(mongo_collection)
    except Exception as exc:
        print(f"MongoDB unavailable, using local JSON storage: {exc}")
        mongo_collection = None

    return mongo_collection


def mongo_document(area: dict[str, Any]) -> dict[str, Any]:
    doc = dict(area)
    lat = float(doc["lat"])
    lng = float(doc.get("lng", doc.get("lon")))
    doc["lat"] = lat
    doc["lng"] = lng
    doc["location"] = {"type": "Point", "coordinates": [lng, lat]}
    return doc


def app_area(area: dict[str, Any]) -> dict[str, Any]:
    result = dict(area)
    if "_id" in result and "id" not in result:
        result["id"] = str(result["_id"])
    result.pop("_id", None)

    location = result.get("location")
    if isinstance(location, dict):
        coordinates = location.get("coordinates")
        if isinstance(coordinates, list) and len(coordinates) == 2:
            result.setdefault("lng", coordinates[0])
            result.setdefault("lat", coordinates[1])

    return result


def load_json_parking_areas() -> list[dict[str, Any]]:
    if not DATA_FILE.exists():
        return []

    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []

    return data if isinstance(data, list) else []


def parking_area_version(areas: list[dict[str, Any]]) -> str:
    canonical = json.dumps(areas, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parking_area_last_modified(areas: list[dict[str, Any]]) -> str | None:
    values = [
        str(area.get("updatedAt") or area.get("createdAt") or "")
        for area in areas
        if area.get("updatedAt") or area.get("createdAt")
    ]
    if values:
        return max(values)

    if DATA_FILE.exists():
        return dt.datetime.fromtimestamp(DATA_FILE.stat().st_mtime, dt.UTC).isoformat()

    return None


def seed_mongo_from_json(collection) -> None:
    if collection.estimated_document_count() > 0:
        return

    areas = load_json_parking_areas()
    if areas:
        collection.insert_many([mongo_document(area) for area in areas])


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
    stop_event: threading.Event = field(default_factory=threading.Event, repr=False)

    def update(self, occupied: int, error: str | None = None) -> str:
        with self.lock:
            self.occupied = max(0, min(self.capacity, occupied))
            self.available = self.capacity - self.occupied
            self.error = error
            self.last_updated = dt.datetime.now(dt.UTC).isoformat()
            return self.last_updated

    def set_running(self, running: bool) -> None:
        with self.lock:
            self.running = running
            self.last_updated = dt.datetime.now(dt.UTC).isoformat()

    def set_error(self, error: str) -> None:
        with self.lock:
            self.error = error
            self.running = False
            self.last_updated = dt.datetime.now(dt.UTC).isoformat()

    def stop(self) -> None:
        self.stop_event.set()

    def should_stop(self) -> bool:
        return self.stop_event.is_set()

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


def detector_config_from_area(area: dict[str, Any]) -> dict[str, Any] | None:
    source = str(area.get("cameraUrl") or area.get("source") or "").strip()
    if not source:
        return None

    try:
        return {
            "id": str(area["id"]),
            "name": str(area["name"]),
            "source": source,
            "capacity": int(area.get("totalSlots", area.get("capacity", 0))),
            "occupied": int(area.get("occupiedSlots", area.get("occupied", 0))),
            "lat": float(area["lat"]),
            "lng": float(area.get("lng", area.get("lon"))),
            "match_radius_meters": int(area.get("matchRadiusMeters", area.get("match_radius_meters", 200))),
            "process_every_n_frames": int(area.get("processEveryNFrames", area.get("process_every_n_frames", 1))),
            "resize_width": int(area.get("resizeWidth", area.get("resize_width", 640))),
        }
    except (KeyError, TypeError, ValueError):
        return None


def detector_config_key(config: dict[str, Any]) -> str:
    values = {
        "name": config["name"],
        "source": config["source"],
        "capacity": config["capacity"],
        "lat": config["lat"],
        "lng": config["lng"],
        "match_radius_meters": config["match_radius_meters"],
        "process_every_n_frames": config["process_every_n_frames"],
        "resize_width": config["resize_width"],
    }
    return json.dumps(values, sort_keys=True, separators=(",", ":"))


def status_from_config(config: dict[str, Any]) -> ParkingStatus:
    capacity = int(config["capacity"])
    occupied = max(0, min(capacity, int(config.get("occupied", 0))))
    return ParkingStatus(
        area_id=str(config["id"]),
        name=str(config["name"]),
        capacity=capacity,
        occupied=occupied,
        available=capacity - occupied,
        lat=float(config["lat"]),
        lng=float(config["lng"]),
        match_radius_meters=int(config.get("match_radius_meters", 200)),
    )


def saved_detector_configs() -> dict[str, dict[str, Any]]:
    configs = {}
    for area in load_saved_parking_areas():
        config = detector_config_from_area(area)
        if config is not None:
            configs[str(config["id"])] = config
    return configs


def sync_statuses(
    statuses: dict[str, ParkingStatus],
    detector_threads: dict[str, threading.Thread],
    detector_keys: dict[str, str],
    display: bool,
    start_detectors: bool,
) -> None:
    configs = saved_detector_configs()

    with status_lock:
        for area_id in list(statuses):
            if area_id not in configs:
                statuses[area_id].stop()
                statuses.pop(area_id, None)
                detector_keys.pop(area_id, None)

        for area_id, config in configs.items():
            config_key = detector_config_key(config)
            if area_id in statuses and detector_keys.get(area_id) == config_key:
                continue

            if area_id in statuses:
                statuses[area_id].stop()

            status = status_from_config(config)
            statuses[area_id] = status
            detector_keys[area_id] = config_key

            if not start_detectors:
                continue

            detector_thread = threading.Thread(
                target=run_detector,
                args=(area_id, config, status, display),
                daemon=True,
            )
            detector_threads[area_id] = detector_thread
            detector_thread.start()


def load_saved_parking_areas() -> list[dict[str, Any]]:
    collection = get_parking_area_collection()
    if collection is not None:
        return [app_area(area) for area in collection.find({}).sort("createdAt", -1)]

    with parking_area_lock:
        return load_json_parking_areas()


def save_parking_areas(areas: list[dict[str, Any]]) -> None:
    collection = get_parking_area_collection()
    if collection is not None:
        collection.delete_many({})
        if areas:
            collection.insert_many([mongo_document(area) for area in areas])
        return

    with parking_area_lock:
        DATA_FILE.write_text(json.dumps(areas, indent=2), encoding="utf-8")


def save_detected_occupancy(area_id: str, occupied_slots: int, detected_at: str) -> None:
    collection = get_parking_area_collection()
    if collection is not None:
        collection.update_one(
            {"id": area_id},
            {
                "$set": {
                    "occupiedSlots": occupied_slots,
                    "occupied": occupied_slots,
                    "lastDetectedAt": detected_at,
                    "updatedAt": detected_at,
                }
            },
        )
        return

    with parking_area_lock:
        areas = load_json_parking_areas()
        changed = False
        for area in areas:
            if str(area.get("id")) != area_id:
                continue

            area["occupiedSlots"] = occupied_slots
            area["occupied"] = occupied_slots
            area["lastDetectedAt"] = detected_at
            area["updatedAt"] = detected_at
            changed = True
            break

        if changed:
            DATA_FILE.write_text(json.dumps(areas, indent=2), encoding="utf-8")


def public_area(area: dict[str, Any]) -> dict[str, Any]:
    total_slots = int(area.get("totalSlots", area.get("capacity", 0)))
    occupied_slots = int(area.get("occupiedSlots", area.get("occupied", 0)))
    available_slots = max(0, total_slots - occupied_slots)

    return {
        "id": str(area["id"]),
        "name": str(area["name"]),
        "lat": float(area["lat"]),
        "lng": float(area["lng"]),
        "lon": float(area["lng"]),
        "cameraUrl": str(area.get("cameraUrl", "")),
        "totalSlots": total_slots,
        "occupiedSlots": occupied_slots,
        "availableSlots": available_slots,
        "createdAt": area.get("createdAt"),
        "updatedAt": area.get("updatedAt"),
        "lastDetectedAt": area.get("lastDetectedAt"),
    }


def validate_area_payload(payload: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    name = str(payload.get("name", "")).strip()
    camera_url = str(payload.get("cameraUrl", "")).strip()

    try:
        lat = float(payload.get("lat"))
        lng = float(payload.get("lng", payload.get("lon")))
        total_slots = int(payload.get("totalSlots"))
        occupied_slots = int(payload.get("occupiedSlots"))
    except (TypeError, ValueError):
        return None, "Enter a name, valid coordinates, and valid slot counts."

    if not name:
        return None, "Parking area name is required."
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return None, "Coordinates are outside the valid latitude/longitude range."
    if total_slots < 1 or occupied_slots < 0 or occupied_slots > total_slots:
        return None, "Occupied slots must be between 0 and the total slot count."
    if camera_url and not URL_PATTERN.match(camera_url):
        return None, "Camera URL must start with http://, https://, or rtsp://."

    return {
        "id": uuid4().hex,
        "name": name[:120],
        "lat": lat,
        "lng": lng,
        "cameraUrl": camera_url,
        "totalSlots": total_slots,
        "occupiedSlots": occupied_slots,
        "createdAt": dt.datetime.now(dt.UTC).isoformat(),
    }, None


def run_detector(area_id: str, config: dict[str, Any], status: ParkingStatus, display: bool) -> None:
    import cv2
    from ultralytics import YOLO

    capacity = int(config["capacity"])
    source = str(config["source"])
    window_title = f"Parking Detection - {status.name}"
    process_every_n_frames = max(1, int(config.get("process_every_n_frames", 1)))
    resize_width = int(config.get("resize_width", 0))
    occupied_units = max(0, min(capacity, int(config.get("occupied", 0))))
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
        detected_at = status.update(occupied_units)
        save_detected_occupancy(area_id, occupied_units, detected_at)

        while not status.should_stop():
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
                            detected_at = status.update(occupied_units)
                            save_detected_occupancy(area_id, occupied_units, detected_at)

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
                cv2.imshow(window_title, annotated_frame)

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
                cv2.destroyWindow(window_title)
            except cv2.error:
                pass


def write_json(
    handler: BaseHTTPRequestHandler,
    payload: dict[str, Any],
    status_code: int = 200,
) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
    handler.send_header("Pragma", "no-cache")
    handler.send_header("Expires", "0")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length > 100_000:
        raise ValueError("Request body too large")

    raw_body = handler.rfile.read(length).decode("utf-8") if length else "{}"
    payload = json.loads(raw_body or "{}")

    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object")

    return payload


def create_handler(
    statuses: dict[str, ParkingStatus],
    detector_threads: dict[str, threading.Thread],
    detector_keys: dict[str, str],
    display: bool,
    start_detectors: bool,
):
    class ParkingApiHandler(BaseHTTPRequestHandler):
        def do_OPTIONS(self) -> None:
            write_json(self, {"ok": True})

        def do_GET(self) -> None:
            path = urlparse(self.path).path.rstrip("/")

            if path == "/api/health":
                write_json(self, {"ok": True})
                return

            if path == "/api/parking-status":
                sync_statuses(statuses, detector_threads, detector_keys, display, start_detectors)
                with status_lock:
                    areas = [status.snapshot() for status in statuses.values()]
                write_json(self, {"areas": areas})
                return

            if path == "/api/parking-areas":
                areas = [public_area(area) for area in load_saved_parking_areas()]
                areas.sort(key=lambda area: str(area.get("createdAt") or ""), reverse=True)
                last_modified = parking_area_last_modified(areas)
                write_json(
                    self,
                    {
                        "areas": areas,
                        "dataVersion": parking_area_version(areas),
                        "lastModified": last_modified,
                    },
                )
                return

            prefix = "/api/parking-status/"
            if path.startswith(prefix):
                area_id = path[len(prefix):]
                sync_statuses(statuses, detector_threads, detector_keys, display, start_detectors)
                with status_lock:
                    status = statuses.get(area_id)

                if not status:
                    write_json(self, {"error": "Unknown parking area"}, 404)
                    return

                write_json(self, status.snapshot())
                return

            write_json(self, {"error": "Not found"}, 404)

        def do_POST(self) -> None:
            path = urlparse(self.path).path.rstrip("/")

            if path != "/api/parking-areas":
                write_json(self, {"error": "Not found"}, 404)
                return

            try:
                payload = read_json_body(self)
            except (json.JSONDecodeError, ValueError) as exc:
                write_json(self, {"error": str(exc)}, 400)
                return

            area, error = validate_area_payload(payload)
            if error or area is None:
                write_json(self, {"error": error or "Invalid parking area"}, 400)
                return

            areas = load_saved_parking_areas()
            areas.insert(0, area)
            save_parking_areas(areas)
            sync_statuses(statuses, detector_threads, detector_keys, display, start_detectors)
            write_json(self, public_area(area), 201)

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
    statuses: dict[str, ParkingStatus] = {}
    detector_threads: dict[str, threading.Thread] = {}
    detector_keys: dict[str, str] = {}
    start_detectors = not args.no_detector
    sync_statuses(statuses, detector_threads, detector_keys, args.display, start_detectors)

    server = ThreadingHTTPServer(
        (args.host, args.port),
        create_handler(statuses, detector_threads, detector_keys, args.display, start_detectors),
    )
    print(f"Parking status API running at http://{args.host}:{args.port}/api/parking-status")
    server.serve_forever()


if __name__ == "__main__":
    main()
