// @ts-nocheck
import express, { Router } from "express";

import { listReports } from "./handlers";

const app = express();

function createReportsRouter() {
  const router = Router();
  router.get("/reports", listReports);
  return router;
}

const createAuditRouter = () => {
  const router = express.Router();
  router.post("/audits", listReports);
  return router;
};

app.use("/api", createReportsRouter());
app.use("/api", createAuditRouter());

export default app;
