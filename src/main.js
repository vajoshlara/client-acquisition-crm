/* ============================================================ start */
(function start() {
  UI.init();
  wireEvents();
  UI.render();
  Sync.init().then(() => {
    if (Sync.mode === 'local') Engine.start();
    UI.render();
  });
  // exposed for debugging and automated tests
  window.CRM = { Store, Sync, Auth, UI, Clock, Engine, Modal, api: { createProspect, moveStage, mergeData, computeMetrics, processDueJobs, sha256Hex, normalizeData, newData } };
})();
