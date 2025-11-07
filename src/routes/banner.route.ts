import { createRouter } from "@/lib/create-app";
import { getAllBannerHandler, getBannerHandler } from "@/handlers/banner.handler";

const bannerRoute = createRouter()
  .basePath("/banners")
  .get("/", ...getAllBannerHandler)
  .get("/:id", ...getBannerHandler);

export default bannerRoute;