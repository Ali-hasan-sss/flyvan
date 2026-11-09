export function driverMapDocument(tileTemplate: string): string {
  const tiles = JSON.stringify(tileTemplate);
  return `<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body, #map { margin: 0; height: 100%; background: #d7ebf8; overflow: hidden; touch-action: none; }
    #map { position: relative; }
    #stage { position: absolute; transform-origin: center center; }
    .tile, .line, .pins { position: absolute; inset: 0; }
    .tile img { position: absolute; width: 256px; height: 256px; pointer-events: none; }
    .pin {
      position: absolute; width: max-content; max-width: 168px; margin: 0; border: 0; background: transparent;
      color: #0f2742; pointer-events: none; display: flex; flex-direction: column; align-items: center;
      font: 700 13px "Segoe UI", sans-serif;
    }
    .pin .mark {
      width: 36px; height: 36px; border: 3px solid #fff; border-radius: 999px; color: #fff;
      display: flex; align-items: center; justify-content: center; font-size: 18px;
      box-shadow: 0 2px 8px rgba(15, 39, 66, 0.28); background: #0d9488;
    }
    .pin.driver .mark { background: #0284c7; }
    .pin.passed .mark { box-shadow: 0 0 0 6px #f59e0b, 0 2px 8px rgba(180, 83, 9, 0.45); }
    .pin .missed { color: #b45309; font-size: 11px; }
    .pin.destination .mark { width: auto; height: auto; border: 0; background: transparent; color: #f5c518; font-size: 30px; line-height: 1; box-shadow: none; }
    .pin.selected .mark { outline: 4px solid #38bdf8; }
    .pin .card {
      margin-top: 4px; padding: 4px 8px; border-radius: 10px; background: #fff; text-align: center;
      box-shadow: 0 2px 8px rgba(15, 39, 66, 0.2); display: flex; flex-direction: column; gap: 2px;
    }
    .pin .card strong { font-size: 13px; line-height: 1.3; }
    .pin .paid { color: #0f766e; font-size: 11px; }
    .pin .unpaid { color: #b45309; font-size: 11px; }
    .tools { position: absolute; top: 16px; left: 12px; display: flex; flex-direction: column; gap: 8px; }
    button {
      width: 48px; height: 48px; border: 0; border-radius: 14px; background: #fff; color: #0f2742;
      font-size: 26px; box-shadow: 0 8px 24px rgba(15, 39, 66, 0.16);
    }
    .credit { position: absolute; right: 12px; bottom: 124px; margin: 0; color: #64748b; font: 11px "Segoe UI", sans-serif; }
  </style>
</head>
<body>
  <div id="map">
    <div id="stage">
      <div class="tile" id="tiles"></div>
      <svg class="line" id="line"></svg>
      <div class="pins" id="pins"></div>
    </div>
    <div class="tools">
      <button type="button" id="zoom-in" aria-label="تكبير">+</button>
      <button type="button" id="zoom-out" aria-label="تصغير">−</button>
      <button type="button" id="locate" aria-label="موقعي">◎</button>
    </div>
    <p class="credit">© OpenStreetMap</p>
  </div>
  <script>
    const TILE = ${tiles};
    const state = {
      lat: 34.889, lng: 35.8866, zoom: 13, bearing: 0, route: null, selected: "",
      follow: false, showAll: false, tracking: false, driver: null, course: null, followPaused: false, followZoomed: false, sheet: 0,
      passedPassengerId: "",
      progress: 1, trimStamp: "",
    };
    const map = document.getElementById("map");
    const stage = document.getElementById("stage");
    const tiles = document.getElementById("tiles");
    const line = document.getElementById("line");
    const pins = document.getElementById("pins");
    const tileNodes = new Map();
    let markers = [];
    let gesture = null;
    let frame = 0;
    let lastTap = 0;
    window.expectRoutePaint = false;

    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

    function project(lat, lng, zoom) {
      const scale = 256 * 2 ** zoom;
      const x = ((lng + 180) / 360) * scale;
      const sine = Math.sin((lat * Math.PI) / 180);
      const y = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale;
      return { x, y };
    }

    function unproject(x, y, zoom) {
      const scale = 256 * 2 ** zoom;
      const lng = (x / scale) * 360 - 180;
      const north = Math.PI - (2 * Math.PI * y) / scale;
      const lat = (180 / Math.PI) * Math.atan(Math.sinh(north));
      return { lat, lng };
    }

    function size() {
      return { width: map.clientWidth || 360, height: map.clientHeight || 640 };
    }

    function requestDraw() {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; draw(); });
    }

    function legColor(index, kind) {
      if (index === 0) return "#0284C7";
      if (kind === "destination") return "#0F2742";
      return ["#0D9488", "#7C3AED", "#0369A1"][(index - 1) % 3];
    }

    function cellKey(point) {
      return Math.round(point.latitude * 4000) + ":" + Math.round(point.longitude * 4000);
    }

    function markOverlap(occupied, from, to) {
      const steps = Math.max(1, Math.ceil(Math.hypot(to.latitude - from.latitude, to.longitude - from.longitude) / 0.00025));
      let repeat = false;
      for (let step = 0; step <= steps; step += 1) {
        const point = {
          latitude: from.latitude + ((to.latitude - from.latitude) * step) / steps,
          longitude: from.longitude + ((to.longitude - from.longitude) * step) / steps,
        };
        const key = cellKey(point);
        if (step > 0 && occupied.has(key)) repeat = true;
        occupied.add(key);
      }
      return repeat;
    }

    function samePoint(left, right) {
      return left && right && Math.abs(left.x - right.x) < 0.5 && Math.abs(left.y - right.y) < 0.5;
    }

    function stroke(group) {
      const commands = group.points.map((point, index) => (index === 0 ? "M" : "L") + point.x + " " + point.y).join(" ");
      return '<path d="' + commands + '" fill="none" stroke="#ffffff" stroke-width="' + (group.width + 5) + '" stroke-linecap="round" stroke-linejoin="round" />'
        + '<path d="' + commands + '" fill="none" stroke="' + group.color + '" stroke-width="' + group.width + '" stroke-linecap="round" stroke-linejoin="round" />';
    }

    function arrows(group) {
      let carry = 36;
      let marks = "";
      for (let index = 1; index < group.points.length; index += 1) {
        const from = group.points[index - 1];
        const to = group.points[index];
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (length < 1) continue;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        let consumed = 0;
        while (carry + length - consumed >= 78) {
          const need = 78 - carry;
          consumed += need;
          carry = 0;
          const progress = consumed / length;
          const x = from.x + (to.x - from.x) * progress;
          const y = from.y + (to.y - from.y) * progress;
          const tip = [x + Math.cos(angle) * 10, y + Math.sin(angle) * 10];
          const left = [x + Math.cos(angle + 2.45) * 8, y + Math.sin(angle + 2.45) * 8];
          const right = [x + Math.cos(angle - 2.45) * 8, y + Math.sin(angle - 2.45) * 8];
          marks += '<polygon points="' + tip.join(",") + " " + left.join(",") + " " + right.join(",") + '" fill="' + group.color + '" stroke="#ffffff" stroke-width="1.5" />';
        }
        carry += length - consumed;
      }
      return marks;
    }

    function draw() {
      const box = size();
      const cover = Math.ceil(Math.hypot(box.width, box.height));
      stage.style.width = cover + "px";
      stage.style.height = cover + "px";
      stage.style.left = ((box.width - cover) / 2) + "px";
      stage.style.top = ((box.height - cover) / 2) + "px";
      stage.style.transform = "rotate(" + state.bearing + "deg)";
      const tileZ = clamp(Math.round(state.zoom) + 1, 1, 19);
      const scale = 2 ** (state.zoom - tileZ);
      const center = project(state.lat, state.lng, tileZ);
      const left = center.x - cover / (2 * scale);
      const top = center.y - cover / (2 * scale);
      const worldWidth = cover / scale;
      const worldHeight = cover / scale;
      const tileCount = 2 ** tileZ;
      const x0 = Math.floor(left / 256);
      const y0 = Math.floor(top / 256);
      const x1 = Math.floor((left + worldWidth) / 256);
      const y1 = Math.floor((top + worldHeight) / 256);
      const needed = new Set();
      const tileSize = 256 * scale;
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          if (y < 0 || y >= tileCount) continue;
          const wrapped = ((x % tileCount) + tileCount) % tileCount;
          const key = tileZ + "/" + wrapped + "/" + y;
          needed.add(key);
          let image = tileNodes.get(key);
          if (!image) {
            image = document.createElement("img");
            image.alt = "";
            image.draggable = false;
            image.src = TILE.replace("{z}", String(tileZ)).replace("{x}", String(wrapped)).replace("{y}", String(y));
            tiles.appendChild(image);
            tileNodes.set(key, image);
          }
          image.style.width = tileSize + "px";
          image.style.height = tileSize + "px";
          image.style.left = ((x * 256 - left) * scale) + "px";
          image.style.top = ((y * 256 - top) * scale) + "px";
        }
      }
      for (const [key, image] of tileNodes) {
        if (!needed.has(key)) {
          image.remove();
          tileNodes.delete(key);
        }
      }

      function screenPoint(lat, lng) {
        const point = project(lat, lng, tileZ);
        return { x: (point.x - left) * scale, y: (point.y - top) * scale };
      }

      const routeLegs = visibleLegs();
      const occupied = new Set();
      const groups = [];
      const repeats = [];
      routeLegs.forEach((leg, legIndex) => {
        const color = legColor(legIndex, leg.targetKind);
        const width = legIndex === 0 ? 7 : 5;
        const points = legPoints(leg, legIndex);
        for (let index = 1; index < points.length; index += 1) {
          const from = points[index - 1];
          const to = points[index];
          const repeat = markOverlap(occupied, from, to);
          const start = screenPoint(from.latitude, from.longitude);
          const end = screenPoint(to.latitude, to.longitude);
          const bucket = repeat ? repeats : groups;
          const paint = repeat ? "#C2410C" : color;
          const last = bucket[bucket.length - 1];
          if (last && last.color === paint && last.width === (repeat ? 7 : width) && samePoint(last.points[last.points.length - 1], start)) {
            last.points.push(end);
          } else {
            bucket.push({ color: paint, width: repeat ? 7 : width, points: [start, end] });
          }
        }
      });
      line.setAttribute("viewBox", "0 0 " + cover + " " + cover);
      line.setAttribute("preserveAspectRatio", "none");
      let zone = "";
      if (state.tracking) {
        const destinationStop = (state.route && state.route.stops ? state.route.stops : []).find((stop) => stop.kind === "destination");
        if (destinationStop) {
          const zoneLat = Number(destinationStop.latitude);
          const zoneLng = Number(destinationStop.longitude);
          if (Number.isFinite(zoneLat) && Number.isFinite(zoneLng)) {
            const screen = screenPoint(zoneLat, zoneLng);
            const metersPerPixel = 156543.03392 * Math.cos((zoneLat * Math.PI) / 180) / (2 ** state.zoom);
            const radius = metersPerPixel > 0 ? 500 / metersPerPixel : 0;
            if (radius > 0) {
              zone = '<circle cx="' + screen.x.toFixed(1) + '" cy="' + screen.y.toFixed(1) + '" r="' + radius.toFixed(1) + '" fill="rgba(2,132,199,0.14)" stroke="#0284C7" stroke-width="2" />';
            }
          }
        }
      }
      line.innerHTML = zone + [...groups, ...repeats].map((group) => stroke(group) + arrows(group)).join("");
      pins.innerHTML = "";
      markers = [];
      for (const stop of visibleStops()) {
        const latitude = stop.kind === "driver" && state.driver ? state.driver.latitude : Number(stop.latitude);
        const longitude = stop.kind === "driver" && state.driver ? state.driver.longitude : Number(stop.longitude);
        const screen = screenPoint(latitude, longitude);
        const pin = document.createElement("div");
        const key = stop.kind + "-" + stop.order;
        const selected = state.selected === key;
        const passed = stop.kind === "pickup" && stop.passengerId && stop.passengerId === state.passedPassengerId;
        pin.className = "pin " + stop.kind + (selected ? " selected" : "") + (passed ? " passed" : "");
        pin.style.left = screen.x + "px";
        pin.style.top = screen.y + "px";
        pin.style.transformOrigin = "50% 18px";
        pin.style.transform = "translate(-50%, -18px) rotate(" + (-state.bearing) + "deg)" + (selected ? " scale(1.12)" : "");
        const mark = document.createElement("div");
        mark.className = "mark";
        mark.textContent = stop.kind === "destination" ? "★" : stop.kind === "driver" ? (state.tracking ? "▲" : "📍") : "👤";
        pin.appendChild(mark);
        if (stop.kind === "pickup") {
          const card = document.createElement("div");
          card.className = "card";
          const name = document.createElement("strong");
          name.textContent = stop.label || "راكب";
          card.appendChild(name);
          const fare = document.createElement("span");
          fare.className = stop.farePaidToCompany ? "paid" : "unpaid";
          fare.textContent = fareCaption(stop);
          card.appendChild(fare);
          if (passed) {
            const missed = document.createElement("span");
            missed.className = "missed";
            missed.textContent = "تم تجاوزه";
            card.appendChild(missed);
          }
          pin.appendChild(card);
        }
        pins.appendChild(pin);
        markers.push({ x: screen.x, y: screen.y, kind: stop.kind, order: stop.order });
      }
      if (window.expectRoutePaint && (groups.length > 0 || repeats.length > 0) && window.ReactNativeWebView) {
        window.expectRoutePaint = false;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "route-ready" }));
      }
    }

    function fit(points) {
      if (points.length === 0) return;
      const box = size();
      const width = box.width - 72;
      const height = box.height - 210;
      let zoom = 17;
      while (zoom > 5) {
        const projected = points.map((point) => project(point.latitude, point.longitude, zoom));
        const minX = Math.min(...projected.map((point) => point.x));
        const maxX = Math.max(...projected.map((point) => point.x));
        const minY = Math.min(...projected.map((point) => point.y));
        const maxY = Math.max(...projected.map((point) => point.y));
        if (maxX - minX <= width && maxY - minY <= height) break;
        zoom -= 1;
      }
      state.zoom = zoom;
      const projected = points.map((point) => project(point.latitude, point.longitude, zoom));
      const center = unproject(
        (Math.min(...projected.map((point) => point.x)) + Math.max(...projected.map((point) => point.x))) / 2,
        (Math.min(...projected.map((point) => point.y)) + Math.max(...projected.map((point) => point.y))) / 2 - 48,
        zoom,
      );
      state.lat = center.lat;
      state.lng = center.lng;
    }

    function visibleLegs() {
      const legs = state.route?.legs?.length
        ? state.route.legs
        : [{ coordinates: state.route?.coordinates ?? [], targetKind: "destination" }];
      return state.showAll ? legs : legs.slice(0, 1);
    }

    function visibleStops() {
      const stops = state.route?.stops ?? [];
      if (state.showAll) return stops;
      const next = stops.find((stop) => stop.kind === "pickup") ?? stops.find((stop) => stop.kind === "destination");
      return stops.filter((stop) => stop.kind === "driver" || stop === next);
    }

    function roadMeters(from, to) {
      const toRadians = (value) => (value * Math.PI) / 180;
      const latDelta = toRadians(to.latitude - from.latitude);
      const lngDelta = toRadians(to.longitude - from.longitude);
      const lat1 = toRadians(from.latitude);
      const lat2 = toRadians(to.latitude);
      const arc = Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
      return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(arc)));
    }

    function anchorToDriver(points, driver) {
      const here = { latitude: Number(driver.latitude), longitude: Number(driver.longitude) };
      if (!Number.isFinite(here.latitude) || !Number.isFinite(here.longitude)) return points;
      if (points.length === 0) return [here];
      if (roadMeters(here, points[0]) <= 12) return [here, ...points.slice(1)];
      return [here, ...points];
    }

    function legPoints(leg, index) {
      let points = (leg.coordinates ?? []).map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) }));
      if (index !== 0 || !state.driver) return points;
      if (state.tracking) points = trimPassed(points, state.driver);
      return anchorToDriver(points, state.driver);
    }

    function headingDegrees(from, to) {
      const lat1 = (from.latitude * Math.PI) / 180;
      const lat2 = (to.latitude * Math.PI) / 180;
      const lngDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
      const y = Math.sin(lngDelta) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lngDelta);
      return (Math.atan2(y, x) * 180) / Math.PI;
    }

    function rawFirstLeg() {
      const legs = state.route?.legs?.length ? state.route.legs : [{ coordinates: state.route?.coordinates ?? [] }];
      return (legs[0]?.coordinates ?? []).map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) }));
    }

    function projectBest(points, driver, fromIndex, toIndex) {
      let bestIndex = fromIndex;
      let bestDistance = Infinity;
      let bestPoint = points[Math.max(0, fromIndex - 1)];
      for (let index = fromIndex; index < toIndex; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        const length = Math.hypot(end.latitude - start.latitude, end.longitude - start.longitude) || 0.0000001;
        const progress = Math.max(0, Math.min(1, ((driver.latitude - start.latitude) * (end.latitude - start.latitude) + (driver.longitude - start.longitude) * (end.longitude - start.longitude)) / (length * length)));
        const point = {
          latitude: start.latitude + (end.latitude - start.latitude) * progress,
          longitude: start.longitude + (end.longitude - start.longitude) * progress,
        };
        const distance = roadMeters(driver, point);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
          bestPoint = point;
        }
      }
      return { index: bestIndex, distance: bestDistance, point: bestPoint };
    }

    function trimPassed(points, driver) {
      if (points.length < 2) return points;
      const stamp = points.length + ":" + points[0].latitude.toFixed(4) + ":" + points[points.length - 1].longitude.toFixed(4);
      if (stamp !== state.trimStamp) {
        state.trimStamp = stamp;
        state.progress = 1;
      }
      const origin = Math.max(1, Math.min(state.progress, points.length - 1));
      const forward = projectBest(points, driver, origin, Math.min(points.length, origin + 50));
      let best = forward;
      if (forward.distance > 80 && origin > 1) {
        const back = projectBest(points, driver, Math.max(1, origin - 4), Math.min(points.length, origin + 2));
        if (back.distance + 8 < forward.distance) best = back;
      }
      if (best.distance > 110) return points;
      state.progress = best.index;
      return [best.point, ...points.slice(best.index)];
    }

    function travelHeading(points) {
      if (points.length >= 2) {
        for (let index = 1; index < points.length; index += 1) {
          if (roadMeters(points[0], points[index]) >= 18) return headingDegrees(points[0], points[index]);
        }
      }
      return Number.isFinite(state.course) ? state.course : 0;
    }

    function placeNavigationCamera(forceZoom) {
      if (!state.driver) return;
      const remaining = state.tracking ? trimPassed(rawFirstLeg(), state.driver) : rawFirstLeg();
      const heading = travelHeading(remaining.length ? remaining : [state.driver]);
      const targetBearing = -heading;
      const delta = ((targetBearing - state.bearing + 540) % 360) - 180;
      state.bearing += forceZoom ? delta : delta * 0.55;
      const zoom = forceZoom || !state.followZoomed ? 17 : state.zoom;
      state.zoom = zoom;
      state.followZoomed = true;
      const box = size();
      const inset = Math.max(0, Math.min(Number(state.sheet) || 0, Math.max(0, box.height - 96)));
      const shifted = screenGeo(box.width / 2, box.height / 2 + inset / 2, zoom, state.driver.latitude, state.driver.longitude, state.bearing);
      state.lat = shifted.lat;
      state.lng = shifted.lng;
    }

    function focusDriver(forceZoom) {
      if (!state.driver) return;
      if (state.tracking && state.follow) {
        placeNavigationCamera(forceZoom);
        return;
      }
      state.lat = Number(state.driver.latitude);
      state.lng = Number(state.driver.longitude);
      if (forceZoom || !state.followZoomed) {
        state.zoom = 17;
        state.followZoomed = true;
      }
    }

    function collect(scope) {
      const legs = state.route?.legs?.length
        ? state.route.legs
        : [{ coordinates: state.route?.coordinates ?? [] }];
      const chosen = scope === "leg" ? legs.slice(0, 1) : legs;
      const points = [];
      for (const leg of chosen) {
        for (const point of leg.coordinates ?? []) {
          const latitude = Number(point.latitude);
          const longitude = Number(point.longitude);
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push({ latitude, longitude });
        }
      }
      if (state.driver && Number.isFinite(state.driver.latitude) && Number.isFinite(state.driver.longitude)) points.push(state.driver);
      return points;
    }

    function applyCamera(mode) {
      if (state.tracking && state.driver) {
        state.follow = true;
        state.followPaused = false;
        focusDriver(mode === "driver");
        return;
      }
      if (mode === "driver") {
        if (!state.followPaused) focusDriver(true);
        return;
      }
      if (mode === "all" || mode === "leg") {
        const points = collect(mode);
        if (points.length > 0) fit(points);
        state.follow = false;
        state.followPaused = false;
        state.followZoomed = false;
      } else if (state.follow && state.driver && !state.followPaused) {
        focusDriver(false);
      }
    }

    window.setSheetInset = function setSheetInset(px) {
      state.sheet = Number(px) || 0;
      if (state.tracking && state.driver) placeNavigationCamera(false);
      requestDraw();
    };

    window.renderRoute = function renderRoute(route) {
      const hasGeometry = (route.coordinates && route.coordinates.length) || (route.legs && route.legs.length) || (route.stops && route.stops.length);
      if (hasGeometry) {
        state.route = {
          coordinates: route.coordinates ?? state.route?.coordinates ?? [],
          legs: route.legs ?? state.route?.legs ?? [],
          stops: route.stops ?? state.route?.stops ?? [],
        };
      }
      if (typeof route.follow === "boolean") state.follow = route.follow;
      if (typeof route.tracking === "boolean") state.tracking = route.tracking;
      if (typeof route.showAll === "boolean") state.showAll = route.showAll;
      if (typeof route.passedPassengerId === "string") state.passedPassengerId = route.passedPassengerId;
      if (route.driver) {
        state.driver = { latitude: Number(route.driver.latitude), longitude: Number(route.driver.longitude) };
        const course = Number(route.driver.heading);
        if (Number.isFinite(course) && course >= 0) state.course = course;
      }
      if (route.resume) state.followPaused = false;
      applyCamera(route.fit);
      requestDraw();
    };

    window.selectStop = function selectStop(key) {
      state.selected = key || "";
      requestDraw();
    };

    function fareCaption(stop) {
      if (!stop.fareAmount) return "الأجرة غير مثبتة";
      const money = !stop.fareCurrency || stop.fareCurrency === "SYP" ? stop.fareAmount + " ل.س" : stop.fareAmount + " " + stop.fareCurrency;
      return money + " (" + (stop.farePaidToCompany ? "مدفوعة" : "غير مدفوعة") + ")";
    }

    function hitMarker(x, y) {
      return markers.find((marker) => Math.hypot(marker.x - x, marker.y - y) < (marker.kind === "pickup" ? 72 : 36)) ?? null;
    }

    function postStop(marker) {
      state.selected = marker.kind + "-" + marker.order;
      requestDraw();
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "stop", kind: marker.kind, order: marker.order }));
      }
    }

    function touchesOf(list) {
      return Array.from(list, (touch) => ({ x: touch.clientX, y: touch.clientY }));
    }

    function fingerAngle(first, second) {
      return Math.atan2(second.y - first.y, second.x - first.x);
    }

    function screenGeo(x, y, zoom, lat, lng, bearing) {
      const box = size();
      const dx = x - box.width / 2;
      const dy = y - box.height / 2;
      const rad = (-bearing * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const center = project(lat, lng, zoom);
      return unproject(center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos, zoom);
    }

    function toStage(x, y) {
      const box = size();
      const cover = Math.hypot(box.width, box.height);
      const dx = x - box.width / 2;
      const dy = y - box.height / 2;
      const rad = (-state.bearing * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return { x: dx * cos - dy * sin + cover / 2, y: dx * sin + dy * cos + cover / 2 };
    }

    map.addEventListener("touchstart", (event) => {
      if (event.target.closest(".tools")) return;
      event.preventDefault();
      const points = touchesOf(event.touches);
      if (points.length === 1) {
        gesture = { kind: "drag", x: points[0].x, y: points[0].y, lat: state.lat, lng: state.lng, moved: 0 };
      } else if (points.length >= 2) {
        const mx = (points[0].x + points[1].x) / 2;
        const my = (points[0].y + points[1].y) / 2;
        const anchor = screenGeo(mx, my, state.zoom, state.lat, state.lng, state.bearing);
        gesture = {
          kind: "pinch",
          dist: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1,
          zoom: state.zoom,
          bearing: state.bearing,
          angle: fingerAngle(points[0], points[1]),
          lat: anchor.lat,
          lng: anchor.lng,
        };
      }
    }, { passive: false });

    map.addEventListener("touchmove", (event) => {
      if (!gesture || event.target.closest(".tools")) return;
      event.preventDefault();
      const points = touchesOf(event.touches);
      if (gesture.kind === "pinch" && points.length >= 2) {
        const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
        const mx = (points[0].x + points[1].x) / 2;
        const my = (points[0].y + points[1].y) / 2;
        const nextZoom = clamp(gesture.zoom + Math.log2(dist / gesture.dist), 5, 19);
        if (state.tracking && state.follow) {
          state.zoom = nextZoom;
          state.followZoomed = true;
          placeNavigationCamera(false);
          requestDraw();
          return;
        }
        const nextBearing = gesture.bearing + ((fingerAngle(points[0], points[1]) - gesture.angle) * 180) / Math.PI;
        const box = size();
        const dx = mx - box.width / 2;
        const dy = my - box.height / 2;
        const rad = (-nextBearing * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const moved = project(gesture.lat, gesture.lng, nextZoom);
        const center = unproject(moved.x - (dx * cos - dy * sin), moved.y - (dx * sin + dy * cos), nextZoom);
        state.followPaused = true;
        state.follow = false;
        state.zoom = nextZoom;
        state.bearing = ((nextBearing + 540) % 360) - 180;
        state.lat = center.lat;
        state.lng = center.lng;
      } else if (gesture.kind === "drag" && points.length === 1) {
        if (state.tracking && state.follow) return;
        const dx = points[0].x - gesture.x;
        const dy = points[0].y - gesture.y;
        gesture.moved = Math.hypot(dx, dy);
        if (gesture.moved > 12) {
          state.followPaused = true;
          state.follow = false;
        }
        const rad = (-state.bearing * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const origin = project(gesture.lat, gesture.lng, state.zoom);
        const next = unproject(origin.x - (dx * cos - dy * sin), origin.y - (dx * sin + dy * cos), state.zoom);
        state.lat = next.lat;
        state.lng = next.lng;
      }
      requestDraw();
    }, { passive: false });

    map.addEventListener("touchend", (event) => {
      if (event.target.closest(".tools")) return;
      const ended = event.changedTouches[0];
      if (gesture?.kind === "drag" && gesture.moved < 12 && ended) {
        const tapped = toStage(ended.clientX, ended.clientY);
        const marker = hitMarker(tapped.x, tapped.y);
        if (marker) postStop(marker);
        else if (Date.now() - lastTap < 280) {
          state.zoom = clamp(state.zoom + 1, 5, 19);
          lastTap = 0;
          requestDraw();
        } else lastTap = Date.now();
      }
      if (event.touches.length === 0) gesture = null;
      else if (event.touches.length === 1) {
        const point = event.touches[0];
        gesture = { kind: "drag", x: point.clientX, y: point.clientY, lat: state.lat, lng: state.lng, moved: 20 };
      }
    }, { passive: false });

    map.addEventListener("touchcancel", () => { gesture = null; });
    document.getElementById("zoom-in").onclick = () => {
      if (!state.tracking) state.followPaused = true;
      state.zoom = clamp(state.zoom + 1, 5, 19);
      if (state.tracking && state.follow) placeNavigationCamera(false);
      requestDraw();
    };
    document.getElementById("zoom-out").onclick = () => {
      if (!state.tracking) state.followPaused = true;
      state.zoom = clamp(state.zoom - 1, 5, 19);
      if (state.tracking && state.follow) placeNavigationCamera(false);
      requestDraw();
    };
    document.getElementById("locate").onclick = () => {
      state.follow = true;
      state.followPaused = false;
      focusDriver(true);
      requestDraw();
    };
    window.addEventListener("resize", requestDraw);
    draw();
  </script>
</body>
</html>`;
}
