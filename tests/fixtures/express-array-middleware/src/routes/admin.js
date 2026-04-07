const { Router } = require("express");

const { adminStats } = require("../controllers");
const { audit } = require("../middleware");

const router = Router();

router.get("/stats", [audit], adminStats);

module.exports = router;
