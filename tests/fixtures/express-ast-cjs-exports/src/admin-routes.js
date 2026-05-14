const { Router } = require("express");

const { listAdmins } = require("./handlers");

const router = Router();

router.get("/users", listAdmins);

exports.adminRouter = router;
