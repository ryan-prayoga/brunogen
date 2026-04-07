const { Router } = require("express");

const { listReports } = require("./controllers");
const adminRouter = require("./routes/admin");
const { audit, authenticate, authorize } = require("./middleware");

const router = Router();

router.get("/api/reports", [authenticate, audit], listReports);
router.use("/api/admin", [authenticate, authorize("admin")], adminRouter);

module.exports = { router };
