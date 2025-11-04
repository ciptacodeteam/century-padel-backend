import { createRouter } from "@/lib/create-app";
import { getAllCourtHandler, getCourtHandler, getCourtSlotsHandler } from "@/handlers/court.handler";

const courtRoute = createRouter()
  .basePath("/courts")
  .get("/", ...getAllCourtHandler)
  .get("/:id/slots", ...getCourtSlotsHandler)
  .get("/:id", ...getCourtHandler);

export default courtRoute;