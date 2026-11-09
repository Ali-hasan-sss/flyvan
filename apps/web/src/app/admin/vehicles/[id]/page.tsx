"use client";

import { useParams } from "next/navigation";
import { VehicleProfileView } from "../../../../components/vehicle-profile";

export default function VehicleProfilePage() {
  const params = useParams<{ id: string }>();
  return <VehicleProfileView vehicleId={params.id} />;
}
