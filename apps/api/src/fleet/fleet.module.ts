import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import {
  DispatchPreviewController,
  DriverDocumentsController,
  DriverServiceAreasController,
  DriversController,
  ServiceAreasController,
  VehicleDocumentsController,
  VehiclesController,
} from "./fleet.controller";
import { FleetService } from "./fleet.service";

@Module({
  imports: [AuthModule],
  controllers: [
    DriversController,
    DriverDocumentsController,
    VehiclesController,
    VehicleDocumentsController,
    ServiceAreasController,
    DriverServiceAreasController,
    DispatchPreviewController,
  ],
  providers: [FleetService],
})
export class FleetModule {}
