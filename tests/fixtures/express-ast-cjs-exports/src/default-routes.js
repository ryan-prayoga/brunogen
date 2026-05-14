const { Router } = require("express");

const { getStatus } = require("./handlers");

const router = Router();

router.get("/status", getStatus);

module.exports = router;
