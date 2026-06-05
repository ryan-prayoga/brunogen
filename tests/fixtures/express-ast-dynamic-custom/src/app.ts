// @ts-nocheck
import express, { Router } from "express";

import { listReports } from "./handlers";

const app = express();

function makeRouter() {
  return Router();
}

const customRouter = makeRouter();
customRouter.get("/custom/reports", listReports);

app.use("/api", customRouter);
app.use("/dynamic", (await import("./dynamic-routes")).default);
app.use("/named", (await import("./dynamic-routes")).namedRouter);

export default app;
