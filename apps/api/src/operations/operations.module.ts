import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { MapsController } from "./map-tiles.controller";
import { BookingsController, DestinationsController, LocationsController, PublicBookingController, TripOffersController, TripsController } from "./operations.controller";
import { OperationsService } from "./operations.service";

@Module({
  imports: [FinanceModule],
  controllers: [BookingsController, PublicBookingController, TripsController, TripOffersController, DestinationsController, LocationsController, MapsController],
  providers: [OperationsService],
})
export class OperationsModule {}
