"use client";

import { useParams } from "next/navigation";
import { TripDetail } from "../../../../components/trip-detail";

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const tripId = typeof params.id === "string" ? params.id : "";
  return <TripDetail tripId={tripId} />;
}
