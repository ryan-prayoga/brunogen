function listReports(_req, res) {
  return res.status(200).json({
    reports: [],
  });
}

function adminStats(_req, res) {
  return res.status(200).json({
    stats: {
      users: 12,
    },
  });
}

module.exports = {
  listReports,
  adminStats,
};
