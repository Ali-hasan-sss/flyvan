"use client";

import { useParams } from "next/navigation";
import { DriverProfileView } from "../../../../components/driver-profile";

export default function DriverProfilePage() {
  const params = useParams<{ id: string }>();
  return <DriverProfileView driverId={params.id} />;
}
