// @ts-nocheck
import express from "express";

import * as routes from "./routes";

const app = express();

app.use("/api", routes.apiRouter);

export default app;
