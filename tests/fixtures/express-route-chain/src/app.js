const express = require('express');
const { Router } = require('express');
const app = express();
const router = Router();

function requireAuth(req, res, next) {
  next();
}

function listReports(req, res) {
  res.json({ reports: [] });
}

function createReport(req, res) {
  res.status(201).json({ id: req.body.id, title: req.body.title });
}

router.route('/reports').get(requireAuth, listReports).post(requireAuth, createReport);

app.use('/api', router);

module.exports = app;
