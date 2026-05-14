// @ts-nocheck
import express from "express";

import routes from "./routes";

const app = express();

app.use("/api", routes.router);

export default app;
