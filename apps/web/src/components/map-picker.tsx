"use client";

import { useCallback, useEffect, useState } from "react";
import { isShortMapsLink, parseSharedLocation } from "@flyvan/types";
import { MapContainer, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiBaseUrl, apiRequest, readError } from "../lib/api";

type MapPin = {
  latitude: string;
  longitude: string;
  label: string;
  tone?: "pickup" | "destination" | "driver";
};

type MapPickerProps = {
  latitude: string;
  longitude: string;
  onChange?: (latitude: string, longitude: string) => void;
  readOnly?: boolean;
  markerTone?: "pickup" | "destination" | "driver";
  extraPins?: MapPin[];
  routeLine?: [number, number][];
  caption?: string;
  placeSearch?: boolean;
  searchPath?: string;
};

const initialView = { latitude: 33.5138, longitude: 36.2765, zoom: 12 };

function coordinateFromMap(value: number, kind: "lat" | "lng"): string {
  if (!Number.isFinite(value)) return "";
  const scaled = Math.round(value * 1_000_000);
  const limit = kind === "lat" ? 90_000_000 : 180_000_000;
  if (Math.abs(scaled) > limit) return "";
  const sign = scaled < 0 ? "-" : "";
  const absolute = Math.abs(scaled);
  const whole = Math.trunc(absolute / 1_000_000);
  const fraction = String(absolute % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

function parsePoint(latitude: string, longitude: string): [number, number] | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function pinIcon(tone: "pickup" | "destination" | "driver") {
  const className = tone === "destination" ? "fv-pin-destination" : tone === "driver" ? "fv-pin-driver" : "fv-pin";
  return L.divIcon({
    className,
    html: "<span></span>",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function RefreshMapSize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const refresh = () => {
      map.invalidateSize();
    };
    refresh();
    const frame = window.requestAnimationFrame(refresh);
    const later = window.setTimeout(refresh, 250);
    const afterDialog = window.setTimeout(refresh, 600);
    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(later);
      window.clearTimeout(afterDialog);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

function FocusPoint({ point, token }: { point: [number, number] | null; token: number }) {
  const map = useMap();
  useEffect(() => {
    if (!point || token === 0) return;
    map.setView(point, 16);
  }, [map, point, token]);
  return null;
}

function FitToPoints({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((point) => point.join(",")).join(";");
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(points, { padding: [28, 28] });
  }, [map, key, points]);
  return null;
}

function ClickCatcher({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function MapTiles({ onFailure }: { onFailure: () => void }) {
  const map = useMap();
  useEffect(() => {
    const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    const primary = L.tileLayer(`${apiBaseUrl()}/api/maps/tiles/{z}/{x}/{y}`, {
      maxZoom: 19,
      attribution,
    });
    const backup = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution,
    });
    const loadedTiles = () => map.getContainer().querySelectorAll("img.leaflet-tile-loaded").length;
    let reported = false;
    const reportIfEmpty = () => {
      if (reported || loadedTiles() > 0) return;
      reported = true;
      onFailure();
    };
    primary.on("tileerror", () => {
      if (!map.hasLayer(backup)) backup.addTo(map);
    });
    backup.on("tileerror", () => {
      if (loadedTiles() === 0) reportIfEmpty();
    });
    primary.addTo(map);
    const switchToDirect = window.setTimeout(() => {
      if (loadedTiles() === 0 && !map.hasLayer(backup)) backup.addTo(map);
    }, 4000);
    const giveUp = window.setTimeout(reportIfEmpty, 9000);
    return () => {
      window.clearTimeout(switchToDirect);
      window.clearTimeout(giveUp);
      primary.remove();
      backup.remove();
    };
  }, [map, onFailure]);
  return null;
}

export function MapPicker({
  latitude,
  longitude,
  onChange,
  readOnly = false,
  markerTone = "destination",
  extraPins = [],
  routeLine = [],
  caption,
  placeSearch = false,
  searchPath = "/api/maps/search",
}: MapPickerProps) {
  const selected = parsePoint(latitude, longitude);
  const [center] = useState<[number, number]>(() => parsePoint(latitude, longitude) ?? [initialView.latitude, initialView.longitude]);
  const [draft, setDraft] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<{ label: string; latitude: string; longitude: string }[]>([]);
  const [chosenPlace, setChosenPlace] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const reportTileFailure = useCallback(() => setTilesFailed(true), []);
  const editable = Boolean(onChange) && !readOnly;

  function applyPoint(nextLatitude: number, nextLongitude: number) {
    if (!onChange) return;
    onChange(coordinateFromMap(nextLatitude, "lat"), coordinateFromMap(nextLongitude, "lng"));
    setFocus([nextLatitude, nextLongitude]);
    setFocusToken((value) => value + 1);
    setNotice("");
  }

  async function searchPlace() {
    const query = placeQuery.trim();
    if (query.length < 2) {
      setNotice("اكتب اسم المنطقة أو العنوان.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await apiRequest(`${searchPath}?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        setPlaces([]);
        setNotice(await readError(response, "تعذر البحث عن العنوان."));
        return;
      }
      const body = (await response.json()) as { items?: { label: string; latitude: string; longitude: string }[] };
      const items = body.items ?? [];
      setPlaces(items);
      if (items.length === 0) setNotice("لم يُعثر على هذه المنطقة. جرّب اسمًا أوضح أو انقر على الخريطة.");
    } catch {
      setNotice("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  function choosePlace(place: { label: string; latitude: string; longitude: string }) {
    applyPoint(Number(place.latitude), Number(place.longitude));
    setChosenPlace(place.label);
    setPlaces([]);
  }

  async function applyDraft() {
    const local = parseSharedLocation(draft);
    if (local) {
      applyPoint(local.latitude, local.longitude);
      return;
    }
    if (!isShortMapsLink(draft)) {
      setNotice("تعذر قراءة الموقع. الصق رابط خرائط جوجل أو رسالة واتساب، أو إحداثيات مثل 33.5138, 36.2765.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiRequest("/api/locations/expand", {
        method: "POST",
        body: JSON.stringify({ value: draft }),
      });
      if (!response.ok) {
        setNotice("تعذر فتح رابط الخرائط المختصر.");
        return;
      }
      const body = (await response.json()) as { url?: string };
      const parsed = body.url ? parseSharedLocation(body.url) : null;
      if (!parsed) {
        setNotice("الرابط لا يحتوي إحداثيات. انسخ الموقع من خرائط جوجل أو واتساب مرة أخرى.");
        return;
      }
      applyPoint(parsed.latitude, parsed.longitude);
    } catch {
      setNotice("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  function useHere() {
    if (!navigator.geolocation) {
      setNotice("المتصفح لا يدعم قراءة الموقع.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyPoint(position.coords.latitude, position.coords.longitude);
        setBusy(false);
      },
      () => {
        setNotice("تعذر قراءة موقعك. اسمح للمتصفح باستخدام الموقع ثم أعد المحاولة.");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  return (
    <div className="grid gap-2">
      <MapContainer
        center={center}
        zoom={selected ? 14 : initialView.zoom}
        className="fv-map"
        style={{ height: 280, width: "100%" }}
        scrollWheelZoom
      >
        <RefreshMapSize />
        <MapTiles onFailure={reportTileFailure} />
        <FocusPoint point={focus} token={focusToken} />
        {editable ? (
          <ClickCatcher onPick={(lat, lng) => onChange?.(coordinateFromMap(lat, "lat"), coordinateFromMap(lng, "lng"))} />
        ) : null}
        {routeLine.length > 1 ? (
          <>
            <Polyline positions={routeLine} pathOptions={{ color: "#0d9488", weight: 4 }} />
            <FitToPoints points={routeLine} />
          </>
        ) : null}
        {selected ? <Marker position={selected} icon={pinIcon(markerTone)} /> : null}
        {extraPins.map((pin) => {
          const point = parsePoint(pin.latitude, pin.longitude);
          if (!point) return null;
          return <Marker key={`${pin.label}-${pin.latitude}-${pin.longitude}`} position={point} icon={pinIcon(pin.tone ?? "pickup")} title={pin.label} />;
        })}
      </MapContainer>
      {tilesFailed ? (
        <p className="m-0 text-sm text-danger">تعذر تحميل خريطة OpenStreetMap. يمكنك لصق الرابط أو استخدام موقعك الحالي.</p>
      ) : null}
      {editable && placeSearch ? (
        <div className="grid gap-2">
          <label className="fv-field">
            <span className="fv-label">بحث عن عنوان أو منطقة</span>
            <input
              className="fv-input"
              value={placeQuery}
              onChange={(event) => setPlaceQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void searchPlace();
              }}
              placeholder="مثال: طرطوس، الشيخ سعد"
              disabled={busy}
            />
          </label>
          <button type="button" className="fv-button fv-button-secondary" onClick={() => void searchPlace()} disabled={busy || placeQuery.trim().length < 2}>
            بحث على الخريطة
          </button>
          {places.length > 0 ? (
            <div className="grid gap-1">
              {places.map((place) => (
                <button
                  key={`${place.latitude}-${place.longitude}-${place.label}`}
                  type="button"
                  className="fv-button fv-button-secondary"
                  style={{ justifyContent: "flex-start", textAlign: "right", whiteSpace: "normal" }}
                  onClick={() => choosePlace(place)}
                >
                  {place.label}
                </button>
              ))}
            </div>
          ) : null}
          {chosenPlace ? <p className="m-0 text-sm text-muted">تم تحديد: {chosenPlace}</p> : null}
        </div>
      ) : null}
      {editable ? (
        <div className="grid gap-2">
          <label className="fv-field">
            <span className="fv-label">موقع من واتساب أو خرائط جوجل</span>
            <input
              className="fv-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="الصق الرابط أو الإحداثيات"
              disabled={busy}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="fv-button fv-button-secondary" onClick={() => void applyDraft()} disabled={busy || draft.trim().length === 0}>
              استخدام الرابط
            </button>
            <button type="button" className="fv-button fv-button-teal" onClick={useHere} disabled={busy}>
              موقعي الحالي
            </button>
          </div>
        </div>
      ) : null}
      {notice ? <p className="m-0 text-sm text-danger">{notice}</p> : null}
      <p className="m-0 text-sm text-muted">
        {caption ??
          (readOnly
            ? "الدبوس الأخضر هو الوجهة، والأزرق نقطة الالتقاط."
            : placeSearch
              ? "ابحث عن منطقة الطالب أو عنوانه، ثم اختر النتيجة ليُوضع دبوس الالتقاط. يمكنك أيضًا النقر على الخريطة."
              : markerTone === "pickup"
                ? "انقر على الخريطة، أو الصق رابط واتساب أو خرائط جوجل، أو استخدم موقعك الحالي."
                : "انقر على الخريطة، أو الصق رابط واتساب أو خرائط جوجل، أو استخدم موقعك الحالي.")}
      </p>
    </div>
  );
}
